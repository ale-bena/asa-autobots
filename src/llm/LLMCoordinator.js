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
         * Chat history database for multi-turn admin prompts.
         * @type {Array<Object>}
         */
        this.chatHistory = [];

        this._initializeSystemPrompt();
    }

    /**
     * Initializes the system prompt instructions with XML guardrails.
     * @private
     */
    _initializeSystemPrompt() {
        this.systemPrompt = SYSTEM_PROMPT;
    }

    /**
     * Checks if the user prompt text contains a negative or zero reward pattern.
     * @param {string} promptText 
     * @returns {boolean} True if negative/zero reward is detected.
     * @private
     */
    _checkPromptForNegativeReward(promptText) {
        if (!promptText) return false;
        // Look for patterns like "reward of <expr>" or "reward: <expr>" or "reward = <expr>"
        const rewardRegex = /reward\s*(?:of|is|=|\:)?\s*([-\d\s\+\*\/\(\)]+)/i;
        const match = promptText.match(rewardRegex);
        if (match) {
            const expr = match[1].trim();
            const cleanExprMatch = expr.match(/^([-\d\s\+\*\/\(\)]+)/);
            if (cleanExprMatch) {
                const cleanExpr = cleanExprMatch[1].trim();
                if (cleanExpr) {
                    try {
                        const val = evaluateExpression(cleanExpr, this.beliefs);
                        const numVal = Number(val);
                        if (!isNaN(numVal) && numVal <= 0) {
                            return true;
                        }
                    } catch (e) {
                        // ignore evaluation errors
                    }
                }
            }
        }
        return false;
    }

    /**
     * Handles and processes natural language prompts from the Admin.
     * Entry point that resets the action tool execution state.
     * @param {string} promptText - The raw instruction from the Admin.
     * @returns {Promise<string>} The LLM text output or action status.
     */
    async handleAdminPrompt(promptText) {
        this.hasExecutedActionTool = false;
        this.isRewardNegative = false;
        if (this._checkPromptForNegativeReward(promptText)) {
            console.log('[LLM Guardrail] Negative/zero reward detected in prompt. Suppressing output to ignore the task.');
            this.isRewardNegative = true;
            return '';
        }
        const result = await this._handleAdminPromptInternal(promptText);
        if (this.isRewardNegative) {
            console.log('[LLM Guardrail] Negative/zero reward detected. Suppressing output to ignore the task.');
            return '';
        }
        if (this.hasExecutedActionTool && result) {
            logger.actionConfirmation(result);
            return ''; // Suppress from public chat
        }
        return result;
    }

    /**
     * Internal recursive handler for prompt processing.
     * @param {string} promptText - The raw instruction/tool result.
     * @returns {Promise<string>} The LLM text output.
     * @private
     */
    async _handleAdminPromptInternal(promptText, accumulatedAnswers = []) {
        // Append user prompt/tool output to chat history
        this.chatHistory.push({ role: 'user', content: promptText });

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

        // Process the instructions
        const instructions = Array.isArray(parsed) ? parsed : [parsed];

        // Execute any tool calls first
        const toolInst = instructions.find(inst => inst.instruction === 'tool');
        if (toolInst) {
            const toolResult = await this.executeTool(toolInst.name, toolInst.args);
            return await this._handleAdminPromptInternal(
                `[TOOL_RESULT] ${toolInst.name} output: ${JSON.stringify(toolResult)}`,
                accumulatedAnswers
            );
        }

        // If no more tool calls, accumulate and concatenate the answers from this final response
        const answers = instructions
            .filter(inst => inst.instruction === 'answer' && inst.body !== undefined && String(inst.body).trim() !== '')
            .map(ans => String(ans.body).trim());

        if (answers.length > 0) {
            accumulatedAnswers.push(...answers);
        }

        return accumulatedAnswers.join('\n');
    }

    /**
     * Executes the requested tool call locally using the tools registry.
     * @param {string} name - Name of the tool function.
     * @param {Object} args - Function arguments.
     * @returns {Promise<Object>} Execution status response.
     */
    async executeTool(name, args) {
        logger.toolCall(name, args);
        const handler = TOOLS_REGISTRY[name];
        if (handler) {
            try {
                // Check if it's an action tool
                const isActionTool = [
                    'move_agent_to_coordinate',
                    'apply_agent_rules',
                    'cooperate_with_agent',
                    'instruct_agent_to_say',
                    'set_agent_variable'
                ].includes(name);

                if (isActionTool) {
                    this.hasExecutedActionTool = true;
                }

                const result = await handler(args, this);

                // Specific logger category triggers
                if (name === 'move_agent_to_coordinate' && result.success) {
                    logger.movement(args.agentId || AGENT_IDS.BDI_AGENT_ID, args.x, args.y);
                } else if (name === 'apply_agent_rules' && result.success) {
                    logger.policyUpdate(args.agentId || AGENT_IDS.BDI_AGENT_ID, args.rules);
                } else if (name === 'evaluate_math_expression' && result.success) {
                    logger.math(args.expression, result.result);
                }

                // Programmatic checks for negative reward
                if (name === 'evaluate_math_expression' && result.success) {
                    const val = Number(result.result);
                    if (!isNaN(val) && val <= 0) {
                        const hasRewardInHistory = this.chatHistory.some(m => 
                            m.role === 'user' && m.content.toLowerCase().includes('reward')
                        );
                        if (hasRewardInHistory) {
                            console.log(`[LLM Guardrail] Math expression "${args.expression}" evaluated to non-positive reward: ${val}`);
                            this.isRewardNegative = true;
                        }
                    }
                } else if (name === 'set_agent_variable' && result.success) {
                    if (args.name && args.name.toLowerCase().includes('reward')) {
                        const val = Number(args.value);
                        if (!isNaN(val) && val <= 0) {
                            console.log(`[LLM Guardrail] Variable "${args.name}" set to non-positive reward: ${val}`);
                            this.isRewardNegative = true;
                        }
                    }
                } else if (name === 'move_agent_to_coordinate') {
                    if (!result.success && result.error && result.error.includes('reward')) {
                        console.log(`[LLM Guardrail] Move tool failed due to negative reward check: ${result.error}`);
                        this.isRewardNegative = true;
                    }
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
     * Resolves the BDI agent ID dynamically.
     * @returns {string} The BDI agent ID.
     */
    getBDIAgentId() {
        // Try to find a peer whose name contains 'pddl' or starts with 'autobots_pddl'
        for (const [peerId, peer] of this.beliefs.peers.entries()) {
            if (peerId !== this.beliefs.me.id && peer.name && (peer.name.includes('pddl') || peer.name.includes('executor') || peer.name.startsWith('autobots_pddl'))) {
                return peerId;
            }
        }
        // Fallback to the first peer that is not ourselves
        for (const peerId of this.beliefs.peers.keys()) {
            if (peerId !== this.beliefs.me.id) {
                return peerId;
            }
        }
        // Last fallback to config
        return AGENT_IDS.BDI_AGENT_ID;
    }

    /**
     * Sends a private message to the BDI partner agent to avoid cluttering the public chat.
     * @param {Object} payload - Message details.
     */
    async broadcastP2P(payload) {
        const rawString = JSON.stringify(payload);
        const recipient = this.getBDIAgentId();

        try {
            console.log(`[LLM] Attempting private emitSay to ${recipient}...`);
            const status = await this.socket.emitSay(recipient, rawString);
            if (status === 'successful') {
                logger.p2p(payload.type, payload, recipient, true);
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
     * @param {any} obj - Parsed JSON value.
     * @returns {string|null} Validation error message, or null if valid.
     * @private
     */
    _validateJsonStructure(obj) {
        if (!obj || typeof obj !== 'object') {
            return 'Response must be a JSON object or JSON array';
        }
        if (Array.isArray(obj)) {
            if (obj.length === 0) return 'JSON array cannot be empty';
            for (let i = 0; i < obj.length; i++) {
                const err = this._validateSingleObject(obj[i]);
                if (err) return `Item at index ${i}: ${err}`;
            }
            return null;
        }
        return this._validateSingleObject(obj);
    }

    /**
     * Validates a single instruction object.
     * @param {Object} item - Candidate instruction object.
     * @returns {string|null} Validation error message, or null if valid.
     * @private
     */
    _validateSingleObject(item) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return 'Expected a JSON object';
        }
        if (!item.instruction) {
            return 'Missing required key: "instruction"';
        }
        if (item.instruction !== 'answer' && item.instruction !== 'tool') {
            return `Invalid value for "instruction". Expected "answer" or "tool", got "${item.instruction}"`;
        }
        if (item.instruction === 'answer') {
            if (item.body === undefined) {
                return 'Missing key "body" for "answer" instruction';
            }
            if (this.hasExecutedActionTool && String(item.body).trim() !== '') {
                return `An action tool was executed. You must return an empty answer body (i.e. body: "") to signal completion, instead of outputting conversational text: "${item.body}"`;
            }
        }
        if (item.instruction === 'tool') {
            if (!item.name || typeof item.name !== 'string') {
                return 'Missing or invalid key "name" for "tool" instruction';
            }
            if (!item.args || typeof item.args !== 'object' || Array.isArray(item.args)) {
                return 'Missing or invalid key "args" for "tool" instruction';
            }
        }
        return null;
    }
}
