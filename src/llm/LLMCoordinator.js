/**
 * @module llm/LLMCoordinator
 * @description Master Coordinator Agent (Agent 2) that intercepts natural language mission prompts,
 * runs the LLM reasoning loop with Chain-of-Thought (CoT) and XML boundaries, evaluates math expressions,
 * and issues P2P coordination tool commands.
 */

import OpenAI from 'openai';
import { OPENAI_CONFIG, AGENT_IDS } from '../config/config.js';
import { SYSTEM_PROMPT } from './system_prompt.js';
import { TOOLS_REGISTRY } from './toolsRegistry.js';
import { logger } from '../utils/logger.js';


/**
 * Imperative one-shot task tools that require a confirmed positive reward
 * (via evaluate_math_expression) before they are allowed to execute.
 * Rule-application tools (apply_agent_rules) are deliberately NOT gated:
 * standing scoring-rule announcements must always be registered regardless of
 * the rule's effect sign, since applying them is how the agents adapt to penalties.
 * @type {Set<string>}
 */
const REWARD_GATED_TOOLS = new Set([
    'move_agent_to_coordinate',
    'set_agent_variable',
    'cooperate_with_agent'
]);

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
         * Conversation buffer for the active reasoning cycle.
         * Contains all user prompts, assistant reasoning, tool outputs, etc.
         * @type {Array<Object>}
         */
        this.conversationBuffer = [];

        /**
         * Current chat history (keeps only the user questions and assistant answers).
         * @type {Array<Object>}
         */
        this.chatHistory = [];

        /**
         * Chat history database queried by get_history tool.
         * @type {Array<{prompt: string, answer: string}>}
         */
        this.history = [];

        /**
         * Log history database for multi-turn admin prompts.
         * @type {Array<Object>}
         */
        this.log = [];

        /**
         * Tracks whether the current admin prompt has a confirmed positive reward
         * (set by a successful evaluate_math_expression call evaluating to "true").
         * Gates execution of reward-gated task tools.
         * @type {boolean}
         */
        this.rewardConfirmed = false;

        this.systemPrompt = SYSTEM_PROMPT;
    }

    /**
     * Executes a single OpenAI Chat Completion cycle.
     * Appends the given prompt text to the conversation buffer, constructs the message history,
     * calls the OpenAI model, cleans the JSON response of reasoning boundaries, parses it,
     * and performs schema validation. Automatically retries up to 3 times on parse or validation
     * failure, feeding the errors back to the model's context to guide self-correction.
     * @param {string} prompt_text - User prompt or tool execution result.
     * @returns {Promise<Object>} The parsed and validated JSON command instruction object.
     * @throws {Error} If a valid JSON schema response is not obtained within the retry limits.
     */
    async model_call(prompt_text) {
        // Append user prompt/tool output to conversation buffer
        this.conversationBuffer.push({ role: 'user', content: prompt_text });

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
                    ...this.conversationBuffer,
                    ...retryMessages
                ];

                const response = await this.openai.chat.completions.create({
                    model: OPENAI_CONFIG.model,
                    messages: messagesToSend,
                    temperature: 0
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

                // If valid, we keep the raw content in the conversation buffer
                this.conversationBuffer.push({ role: 'assistant', content: content });
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
     * Resets the task action tool gate state, and runs the step-by-step tool execution loop.
     * Executes requested tool calls, feeds results back to model_call, and accumulates answers.
     * The loop runs until the model decides to stop and issues the final answers.
     * @param {string} promptText - The raw instruction from the Admin.
     * @param {Array<string>} accumulatedAnswers - Accumulated answers from previous tool calls.
     * @returns {Promise<string>} The LLM text output or action status.
     */
    async handleAdminPrompt(promptText, accumulatedAnswers = []) {
        this.conversationBuffer = [];
        this.chatHistory = [];
        this.rewardConfirmed = false;

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

            const finalAnswer = accumulatedAnswers.length > 0 ? accumulatedAnswers.join('\n') : null;
            if (finalAnswer) {
                this.chatHistory.push({ role: 'user', content: promptText });
                this.chatHistory.push({ role: 'assistant', content: finalAnswer });
                this.history.push({ prompt: promptText, answer: finalAnswer });
            } else {
                this.chatHistory.push({ role: 'user', content: promptText });
                this.chatHistory.push({ role: 'assistant', content: '[No response text generated]' });
                this.history.push({ prompt: promptText, answer: '[No response text generated]' });
            }

            this.conversationBuffer = [];

            return finalAnswer;
        } catch (error) {
            this.conversationBuffer = [];
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
        if (!tool) {
            return { error: `Unknown tool call: ${name}` };
        }

        // Reward gate: task actions that change world/rule state require a
        // confirmed positive reward for the current admin prompt.
        // cooperate_with_agent is exempt for CLOSE (cancellation) and RELAY
        // (the strategy companion of a standing bonus-rule announcement, which
        // is itself ungated by design).
        const cooperateType = args?.contract?.type;
        const isCooperateExempt = name === 'cooperate_with_agent' &&
            (cooperateType === 'CLOSE' || cooperateType === 'RELAY');
        if (REWARD_GATED_TOOLS.has(name) && !isCooperateExempt && !this.rewardConfirmed) {
            return {
                success: false,
                error: 'No positive reward confirmed for this task - action not executed.'
            };
        }

        try {
            const result = await tool.handler(args, this);

            // Specific logger category triggers
            if (name === 'move_agent_to_coordinate' && result.success) {
                logger.movement(args.id || AGENT_IDS.BDI_AGENT_ID, args.x, args.y);
            } else if (name === 'apply_agent_rules' && result.success) {
                logger.policyUpdate(args.id || AGENT_IDS.BDI_AGENT_ID, args.rules);
            } else if (name === 'evaluate_math_expression' && result.success) {
                logger.math(args.expression, result.result);
                // A passing feasibility check unlocks gated tools for the rest of
                // this admin prompt; numeric evaluations (e.g. coordinates) must
                // not re-lock the gate, so the flag is sticky once true.
                if (String(result.result) === 'true') {
                    this.rewardConfirmed = true;
                }
            }

            return result;
        } catch (e) {
            logger.error(`executeTool:${name}`, e);
            return { error: `Execution error: ${e.message}` };
        }
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
            console.warn(`[LLM] Private emitSay to ${id} returned status: ${status}. Falling back to emitShout.`);
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
        try {
            let cleaned = text.trim();

            // 1. Strip reasoning tags or extract answer tags if present
            const answerMatch = cleaned.match(/\[ANSWER\]([\s\S]*?)\[\/ANSWER\]/i);
            if (answerMatch) {
                cleaned = answerMatch[1].trim();
            } else {
                cleaned = cleaned.replace(/\[REASONING\][\s\S]*?\[\/REASONING\]/i, '').trim();
            }

            // 2. Remove standard markdown json block wrappers if they surround the remaining text
            if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```(?:json)?\n?/i, '');
                cleaned = cleaned.replace(/\n?```$/, '');
                cleaned = cleaned.trim();
            }

            // 3. Extract exactly the first balanced JSON object
            let firstOpenBrace = cleaned.indexOf('{');
            if (firstOpenBrace !== -1) {
                let braceCount = 0;
                let inStringChar = null; // can be '"', "'", or '`'
                let escape = false;
                for (let i = firstOpenBrace; i < cleaned.length; i++) {
                    const char = cleaned[i];
                    if (escape) {
                        escape = false;
                        continue;
                    }
                    if (char === '\\') {
                        escape = true;
                        continue;
                    }
                    if (inStringChar) {
                        if (char === inStringChar) {
                            inStringChar = null;
                        }
                    } else {
                        if (char === '"' || char === "'" || char === '`') {
                            inStringChar = char;
                        } else if (char === '{') {
                            braceCount++;
                        } else if (char === '}') {
                            braceCount--;
                            if (braceCount === 0) {
                                cleaned = cleaned.substring(firstOpenBrace, i + 1);
                                break;
                            }
                        }
                    }
                }
            }
            return cleaned.trim();
        } catch (e) {
            console.error('[LLM] Error while cleaning JSON response:', e.message);
            return text.trim();
        }
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

    /**
     * Resolves the peer agent ID.
     * @returns {string} Peer ID.
     */
    getPeerAgentId() {
        return (this.beliefs.me.id === AGENT_IDS.BDI_AGENT_ID) ? AGENT_IDS.LLM_AGENT_ID : AGENT_IDS.BDI_AGENT_ID;
    }
}
