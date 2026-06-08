/**
 * @module llm/LLMCoordinator
 * @description Master Coordinator Agent (Agent 2) that intercepts natural language mission prompts,
 * runs the LLM reasoning loop with Chain-of-Thought (CoT) and XML boundaries, evaluates math expressions,
 * and issues P2P coordination tool commands.
 */

import OpenAI from 'openai';
import { OPENAI_CONFIG, AGENT_IDS } from '../config/config.js';
import { SYSTEM_PROMPT } from './prompts.js';
import { TOOLS_REGISTRY } from './toolsRegistry.js';
import { logger } from '../utils/logger.js';
import { evaluateExpression } from '../policy/PolicyEngine.js';

/**
 * Master Coordinator Agent class wrapping LLM API calls and tool execution.
 */
export class LLMCoordinator {
    /**
     * Creates an LLMCoordinator.
     * @param {import('../agent/BeliefBase.js').BeliefBase} beliefs - Current coordinator beliefs.
     * @param {Object} socket - Deliveroo socket client.
     */
    constructor(beliefs, socket) {
        /** @type {import('../agent/BeliefBase.js').BeliefBase} */
        this.beliefs = beliefs;
        /** @type {Object} */
        this.socket = socket;

        /** @type {OpenAI} */
        this.openai = new OpenAI({
            baseURL: OPENAI_CONFIG.baseURL,
            apiKey: OPENAI_CONFIG.apiKey
        });

        /**
         * Chat history database.
         * @type {Array<Object>}
         */
        this.chatHistory = [];

        /**
         * Log history database for multi-turn admin prompts.
         * @type {Array<Object>}
         */
        this.log = [];

        this._initializeSystemPrompt();
    }

    /**
     * Initializes the system prompt instructions with XML guardrails.
     * @private
     */
    _initializeSystemPrompt() {
        this.systemPrompt = SYSTEM_PROMPT;
    }

    async model_call(prompt_text) {
        // Append user prompt/tool output to chat history
        this.chatHistory.push({ role: 'user', content: prompt_text });

        let parsed = null;
        let retryMessages = [];
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            let content = '';
            try {
                console.log(`[LLM] Invoking LLM reasoning cycle (Attempt ${attempt}/${maxRetries})...`);

                const messagesToSend = [
                    { role: 'system', content: this.systemPrompt },
                    ...this.chatHistory,
                    ...retryMessages
                ];

                const response = await this.openai.chat.completions.create({
                    model: OPENAI_CONFIG.model,
                    messages: messagesToSend
                });

                content = response.choices[0]?.message?.content || '';
                const cleanedContent = this._cleanJsonResponse(content);
                console.log("\n" + cleanedContent + "\n");

                // Parse the response
                parsed = JSON.parse(cleanedContent);

                // Validate the response schema
                const validationError = this._validateJsonStructure(parsed);
                if (validationError) {
                    console.warn(`[LLM] Schema validation failed on attempt ${attempt}:`, validationError);
                    retryMessages.push({ role: 'assistant', content: content });
                    retryMessages.push({
                        role: 'user',
                        content: JSON.stringify({
                            error: 'JSON validation failed',
                            details: validationError
                        })
                    });
                    parsed = null;
                    continue;
                }

                // If valid, we keep the raw content in the permanent chat history
                this.chatHistory.push({ role: 'assistant', content: content });
                break;
            } catch (err) {
                console.warn(`[LLM] Parse/API error on attempt ${attempt}:`, err.message);
                retryMessages.push({ role: 'assistant', content: content || '[Empty/API Error]' });
                retryMessages.push({
                    role: 'user',
                    content: JSON.stringify({
                        error: 'Failed to parse JSON response',
                        details: err.message
                    })
                });
                parsed = null;
            }
        }

        if (!parsed) {
            throw new Error('[LLM] Failed to receive a valid JSON response from LLM after maximum retries.');
        }

        return parsed;
    }

    /**
     * Handles and processes natural language prompts from the Admin.
     * Entry point that resets the action tool execution state.
     * @param {string} promptText - The raw instruction from the Admin.
     * @param {Array<string>} accumulatedAnswers - Accumulated answers from previous tool calls.
     * @returns {Promise<string>} The LLM text output or action status.
     */
    async handleAdminPrompt(promptText, accumulatedAnswers = []) {
        const historyStartIndex = this.chatHistory.length;

        try {
            let response = await this.model_call(promptText + ".\nWhat is the first step?");
            let stop = false;

            while (!stop) {
                switch (response.type) {
                    case "tool":
                        const toolResult = await this.executeTool(response.name, response.args);
                        response = await this.model_call(
                            `[TOOL_RESULT] ${response.name} output: ${JSON.stringify(toolResult)}.
                            What is the next step? Remember only one response at a time, 
                            also don't provide the reasoning or the possible future outcomes.`
                        );
                        break;
                    case "answer":
                        accumulatedAnswers.push(response.body);
                        response = await this.model_call(
                            `[ACCUMULATED_ANSWERS] output: ${accumulatedAnswers.join('\n')}.
                            What is the next step? Remember only one response at a time, 
                            also don't provide the reasoning or the possible future outcomes.`
                        );
                        break;
                    case "stop":
                        stop = true;
                        break;
                    default:
                        logger.error('[LLM] Unknown response type:', response.type);
                        stop = true;
                }
            }

            if (accumulatedAnswers.length === 0) {
                // Remove intermediate chat history of this run
                this.chatHistory.splice(historyStartIndex);
                return null;
            }

            const answers = accumulatedAnswers.join('\n');
            // Clean up the intermediate chat history of this run and replace with the final summarization
            this.chatHistory.splice(historyStartIndex);
            this.chatHistory.push({ role: 'user', content: promptText });
            this.chatHistory.push({ role: 'assistant', content: answers });
            return answers;
        } catch (error) {
            this.chatHistory.splice(historyStartIndex);
            throw error;
        }
    }

    /**
     * Executes the requested tool call locally using the tools registry.
     * @param {string} name - Name of the tool function.
     * @param {Object} args - Function arguments.
     * @returns {Promise<Object>} Execution status response.
     */
    async executeTool(name, args) {
        logger.toolCall(name, args);
        const tool = TOOLS_REGISTRY[name];
        if (tool) {
            try {
                const result = await tool.handler(args, this);

                // Specific logger category triggers
                if (name === 'move_agent_to_coordinate' && result.success) {
                    logger.movement(args.agentId || AGENT_IDS.BDI_AGENT_ID, args.x, args.y);
                } else if (name === 'apply_agent_rules' && result.success) {
                    logger.policyUpdate(args.agentId || AGENT_IDS.BDI_AGENT_ID, args.rules);
                } else if (name === 'evaluate_math_expression' && result.success) {
                    logger.math(args.expression, result.result);
                }

                return result;
            } catch (e) {
                logger.error(`executeTool:${name}`, e);
                return { error: `Execution error: ${e.message}` };
            }
        }
        return { error: `Unknown tool call: ${name}` };
    }

    /**
     * Sends a private message to other agents to avoid cluttering the public chat.
     * @param {string} id - The ID of the receiver.
     * @param {Object} payload - Message details.
     */
    async P2P(id, payload) {
        const rawString = JSON.stringify(payload);

        try {
            console.log(`[LLM] Attempting private emitSay to ${id}...`);
            const status = await this.socket.emitSay(id, rawString);
            if (status === 'successful') {
                logger.p2p(payload.type, payload, id, true);
                return;
            }
            console.warn(`[LLM] Private emitSay to ${recipient} returned status: ${status}. Falling back to emitShout.`);
        } catch (e) {
            console.error(`[LLM] Private emitSay failed with error: ${e.message}. Falling back to emitShout.`);
        }

        await this.socket.emitShout(rawString);
        logger.p2p(payload.type, payload, 'global', false);
    }

    /**
     * Cleans code blocks and whitespaces from the LLM output.
     * @param {string} text - Raw text response.
     * @returns {string} Cleaned response.
     * @private
     */
    _cleanJsonResponse(text) {
        let cleaned = text.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\n?/i, '');
            cleaned = cleaned.replace(/\n?```$/, '');
        }
        return cleaned.trim();
    }

    /**
     * Validates that the parsed JSON object or array conforms to the expected schemas.
     * @param {any} item - Parsed JSON value.
     * @returns {string|null} Validation error message, or null if valid.
     * @private
     */
    _validateJsonStructure(item) {
        if (!item || typeof item !== 'object') {
            return 'Expected a JSON object';
        }
        if (!item.type) {
            return 'Missing required key: "type"';
        }
        if (!(item.type === 'tool' || item.type === 'stop' || item.type === 'answer')) {
            return `Invalid value for "type". Expected "answer" or "tool" or "stop", got "${item.type}"`;
        }
        switch (item.type) {
            case "tool":
                if (!item.name || typeof item.name !== 'string') {
                    return 'Missing or invalid key "name" for "tool" instruction';
                }
                if (!item.args || typeof item.args !== 'object' || Array.isArray(item.args)) {
                    return 'Missing or invalid key "args" for "tool" instruction';
                }
                break;
            case "answer":
                if (item.body === undefined) {
                    return 'Missing key "body" for "answer" instruction';
                }
        }
        return null;
    }
}
