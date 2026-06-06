/**
 * @module llm/LLMCoordinator
 * @description Master Coordinator Agent (Agent 2) that intercepts natural language mission prompts,
 * runs the LLM reasoning loop with Chain-of-Thought (CoT) and XML boundaries, evaluates math expressions,
 * and issues P2P coordination tool commands.
 */

import OpenAI from 'openai';
import { OPENAI_CONFIG, AGENT_IDS } from '../config/config.js';
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
        this.systemPrompt = `
<system_prompt>
You are the cognitive reasoning brain of a cooperative, autonomous Deliveroo multi-agent system.
Your team consists of:
1. Yourself (the LLM Agent - Coordinator, ID: ${AGENT_IDS.LLM_AGENT_ID})
2. A PDDL Agent (the Partner/Executor, ID: ${AGENT_IDS.BDI_AGENT_ID})

While you possess the reasoning engine, your partner agent executes physical actions under your high-level guidance or cooperates with you directly through a message-based communication scheme.

────────────────────────────────────────────────────────────────────────────────
CORE OPERATIONAL PROTOCOLS & GOALS
────────────────────────────────────────────────────────────────────────────────
1. MATH EVALUATION & PREPARATION
   - Before executing any navigation or cooperative command containing arithmetic expressions (e.g. "go to cell 4+2, 10-3"), you MUST call the "evaluate_math_expression" tool.
   - Wait for the mathematical result in the next turn, and only then use the evaluated numeric coordinates for routing or coordination.
   - If a query contains multiple calculations, you MUST call the evaluation tool sequentially, one by one, across multiple turns. Do NOT invoke parallel tool calls, as the backend only supports a single tool call at once.
   
2. GOAL FILTERING & FEASIBILITY
   - If a task offers a negative or zero reward, or the path is determined to be blocked, declare the task unfeasible. Do not waste agent resources on tasks with zero/negative reward utility.

3. COOPERATIVE EXECUTION (RENDEZVOUS & TRADING)
   - When coordinating a package handoff or gate clearance, establish a coordination contract.
   - Coordinate using specific, sequential states: PROPOSE, ACCEPT, READY, DROP, PICKUP, COMPLETE.
   - If you are carrying a package to trade, drop it at the rendezvous coordinate, move away, and signal your partner to step forward and retrieve it.

────────────────────────────────────────────────────────────────────────────────
RESPONSE FORMATTING LIMITS
────────────────────────────────────────────────────────────────────────────────
- When executing tools, output ONLY the tool calls.
- Only call a single tool per turn. Parallel tool calling is strictly unsupported.
- Use <thought> tags for Chain-of-Thought reasoning.
- If asked a factual question by the admin, reply directly with the raw answer text. Avoid conversational preambles (e.g. output "4" instead of "The answer is 4").
- For multi-turn workflows where you are waiting for a tool result, output a status prefix like "[WAITING]" or "[REPLAN]" followed by a brief reason.

────────────────────────────────────────────────────────────────────────────────
FEW-SHOT WORKFLOW DEMONSTRATIONS
────────────────────────────────────────────────────────────────────────────────
Example 1:
Admin: "Evaluate if we should avoid tiles at x=3+2, y=8-2 and move the partner agent there."
Assistant:
<thought>
The request requires moving the partner agent to coordinates which are written as expressions: x=3+2, y=8-2.
First, I must resolve the math expression. The rules require calling "evaluate_math_expression" sequentially for expressions before using them.
I will evaluate "3+2" first.
</thought>
evaluate_math_expression(expression="3+2")

Example 2 (continuation after tool output):
Admin: "[TOOL_RESULT] evaluate_math_expression output: {\"success\":true,\"result\":\"5\"}"
Assistant:
<thought>
"3+2" evaluated to 5. Now I need to evaluate the Y coordinate expression: "8-2".
</thought>
evaluate_math_expression(expression="8-2")

Example 3 (continuation after second tool output):
Admin: "[TOOL_RESULT] evaluate_math_expression output: {\"success\":true,\"result\":\"6\"}"
Assistant:
<thought>
"8-2" evaluated to 6. Now I have the final coordinates (5, 6).
The admin also asked to "evaluate if we should avoid tiles at x=3+2, y=8-2". Since this was a request to avoid those tiles and move there, I will first apply a rule to avoid the tile (5,6) and then direct the agent to move.
The partner agent ID is ${AGENT_IDS.BDI_AGENT_ID}.
I will call apply_agent_rules to avoid tile "5,6".
</thought>
apply_agent_rules(agentId="${AGENT_IDS.BDI_AGENT_ID}", rules={"avoidTiles": ["5,6"]})

Example 4:
Admin: "Is the path clear?"
Assistant:
<thought>
This is a factual question. I must reply directly with the answer, without preambles or conversation.
Based on the current state, there are no crates blocking the path. So the answer is "Yes".
</thought>
Yes
</system_prompt>
`.trim();
    }

    /**
     * Handles and processes natural language prompts from the Admin.
     * Runs multi-turn tool evaluation cycles.
     * @param {string} promptText - The raw instruction from the Admin.
     * @returns {Promise<string>} The LLM text output or action status.
     */
    async handleAdminPrompt(promptText) {
        // Append user prompt to chat history
        this.chatHistory.push({ role: 'user', content: promptText });

        try {
            console.log('[LLM] Invoking LLM reasoning cycle...');
            const response = await this.openai.chat.completions.create({
                model: OPENAI_CONFIG.model,
                messages: [
                    { role: 'system', content: this.systemPrompt },
                    ...this.chatHistory
                ],
                tools: this.getToolsManifest(),
                tool_choice: 'auto'
            });

            const choice = response.choices[0];
            const message = choice.message;

            // Keep log of Assistant response
            this.chatHistory.push(message);

            // Handle tool calls if returned
            if (message.tool_calls && message.tool_calls.length > 0) {
                const toolCall = message.tool_calls[0]; // Strict single tool execution per turn
                const result = await this.executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments));

                // Append tool response and run recursive tick
                this.chatHistory.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: toolCall.function.name,
                    content: JSON.stringify(result)
                });

                // Yield tool result and tick recursively
                return await this.handleAdminPrompt(`[TOOL_RESULT] ${toolCall.function.name} output: ${JSON.stringify(result)}`);
            }

            return message.content || '';
        } catch (e) {
            console.error('[LLM] Failed OpenAI Chat completion:', e.message);
            return 'Error in processing instruction.';
        }
    }

    /**
     * Executes the requested tool call locally.
     * @param {string} name - Name of the tool function.
     * @param {Object} args - Function arguments.
     * @returns {Promise<Object>} Execution status response.
     */
    async executeTool(name, args) {
        console.log(`[LLM] Executing tool: ${name}`, args);

        switch (name) {
            case 'evaluate_math_expression': {
                const res = evaluateExpression(args.expression, this.beliefs);
                return { success: true, result: String(res) };
            }

            case 'move_agent_to_coordinate': {
                this.broadcastP2P({
                    type: 'MOVE_TO',
                    x: Number(args.x),
                    y: Number(args.y)
                });
                return { success: true, message: `Directed agent to (${args.x}, ${args.y})` };
            }

            case 'apply_agent_rules': {
                this.broadcastP2P({
                    type: 'APPLY_RULES',
                    rules: args.rules
                });
                return { success: true };
            }

            case 'cooperate_with_agent': {
                const contract = args.contract;
                this.broadcastP2P({
                    type: 'PROPOSE_CONTRACT',
                    coopId: contract.coopId || `coop_${Date.now()}`,
                    type: contract.type,
                    x: Number(contract.x),
                    y: Number(contract.y)
                });
                return { success: true, message: 'Broadcast proposed contract.' };
            }

            case 'instruct_agent_to_say': {
                this.broadcastP2P({
                    type: 'INSTRUCT_SAY',
                    message: args.message
                });
                return { success: true };
            }

            default:
                return { error: 'Unknown tool call.' };
        }
    }

    /**
     * Broadcasts a JSON message to peer game chat.
     * @param {Object} payload - Message details.
     */
    broadcastP2P(payload) {
        const rawString = JSON.stringify(payload);
        this.socket.emitShout(rawString);
    }

    /**
     * Returns the manifest of tools available to the LLM Coordinator.
     * @returns {Array<Object>} List of tools formats.
     */
    getToolsManifest() {
        return [
            {
                type: 'function',
                function: {
                    name: 'evaluate_math_expression',
                    description: 'Resolves raw string arithmetic formulas into numeric values.',
                    parameters: {
                        type: 'object',
                        properties: {
                            expression: { type: 'string', description: 'Arithmetic expression to solve (e.g. "4+5").' }
                        },
                        required: ['expression']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'move_agent_to_coordinate',
                    description: 'Directs the physical BDI partner agent to navigate to a specific grid coordinate.',
                    parameters: {
                        type: 'object',
                        properties: {
                            agentId: { type: 'string', description: 'Target agent ID.' },
                            x: { type: 'integer' },
                            y: { type: 'integer' }
                        },
                        required: ['agentId', 'x', 'y']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'apply_agent_rules',
                    description: 'Modifies behavioral policies and environmental constraints in the partner agent.',
                    parameters: {
                        type: 'object',
                        properties: {
                            agentId: { type: 'string', description: 'Target agent ID.' },
                            rules: {
                                type: 'object',
                                properties: {
                                    avoidTiles: { type: 'array', items: { type: 'string' } },
                                    maxRewardLimit: { type: 'number' },
                                    minRewardThreshold: { type: 'number' },
                                    requiredStackSize: { type: 'integer' }
                                }
                            }
                        },
                        required: ['agentId', 'rules']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'cooperate_with_agent',
                    description: 'Initiates a structured Peer-to-Peer contract proposal with the partner agent.',
                    parameters: {
                        type: 'object',
                        properties: {
                            agentId: { type: 'string', description: 'Target partner ID.' },
                            contract: {
                                type: 'object',
                                properties: {
                                    coopId: { type: 'string' },
                                    type: { type: 'string', enum: ['RENDEZVOUS', 'CLEARING'] },
                                    x: { type: 'integer' },
                                    y: { type: 'integer' }
                                },
                                required: ['type', 'x', 'y']
                            }
                        },
                        required: ['agentId', 'contract']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'instruct_agent_to_say',
                    description: 'Instructs the partner agent to speak a specific message.',
                    parameters: {
                        type: 'object',
                        properties: {
                            agentId: { type: 'string' },
                            message: { type: 'string' }
                        },
                        required: ['agentId', 'message']
                    }
                }
            }
        ];
    }
}
