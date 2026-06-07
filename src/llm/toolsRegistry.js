/**
 * @file toolsRegistry.js
 * @description Registry of available tools and their corresponding execution handlers, along with descriptions and argument schemas.
 */

import { evaluateExpression } from '../policy/PolicyEngine.js';
import { AGENT_IDS } from '../config/config.js';

/**
 * Registry of tool objects.
 * Each tool object contains description, getArgsSchema function, isAction flag, and its handler function.
 */
export const TOOLS_REGISTRY = {
    evaluate_math_expression: {
        description: "Resolves arithmetic formulas into numeric values.",
        getArgsSchema: () => `{ "expression": "expression_string" }`,
        isAction: false,
        handler: async (args, coordinator) => {
            const res = evaluateExpression(args.expression, coordinator.beliefs);
            return { success: true, result: String(res) };
        }
    },

    move_agent_to_coordinate: {
        description: "Directs the BDI partner agent to navigate to a specific grid coordinate.",
        getArgsSchema: () => `{ "agentId": "${AGENT_IDS.BDI_AGENT_ID}", "x": number, "y": number }`,
        isAction: true,
        handler: async (args, coordinator) => {
            // Guardrail: check if any stored variable related to reward is <= 0
            for (const [key, val] of Object.entries(coordinator.beliefs.variables)) {
                if (key.toLowerCase().includes('reward')) {
                    const numVal = Number(val);
                    if (!isNaN(numVal) && numVal <= 0) {
                        return { 
                            success: false, 
                            error: `Movement rejected: variable '${key}' has non-positive value (${val}). Tasks with negative or zero rewards are unfeasible and should not be executed.` 
                        };
                    }
                }
            }

            let targetX = Math.round(Number(args.x));
            let targetY = Math.round(Number(args.y));

            if (coordinator.beliefs.map) {
                targetX = Math.max(0, Math.min(targetX, coordinator.beliefs.map.width - 1));
                targetY = Math.max(0, Math.min(targetY, coordinator.beliefs.map.height - 1));
            }

            await coordinator.broadcastP2P({
                type: 'MOVE_TO',
                x: targetX,
                y: targetY
            });
            return { success: true, message: `Directed agent to (${targetX}, ${targetY})` };
        }
    },

    apply_agent_rules: {
        description: "Modifies behavioral policies/rules in the partner agent. Supports avoidTiles, minRewardThreshold, maxRewardLimit, requiredStackSize, multiplierRules (condition and multiplier), and bonusRules (condition and bonus).",
        getArgsSchema: () => `{ 
       "agentId": "${AGENT_IDS.BDI_AGENT_ID}", 
       "rules": { 
         "avoidTiles": ["x,y", ...], 
         "minRewardThreshold": number, 
         "maxRewardLimit": number,
         "requiredStackSize": number,
         "multiplierRules": [ { "condition": "carrying.size == 3", "multiplier": 2 } ],
         "bonusRules": [ { "condition": "path.traverses_15_15", "bonus": -200 } ]
       } 
     }`,
        isAction: true,
        handler: async (args, coordinator) => {
            await coordinator.broadcastP2P({
                type: 'APPLY_RULES',
                rules: args.rules
            });
            return { success: true };
        }
    },

    cooperate_with_agent: {
        description: "Proposes a Peer-to-Peer rendezvous or gate clearing contract, or cancels/closes active cooperation.",
        getArgsSchema: () => `{ "agentId": "${AGENT_IDS.BDI_AGENT_ID}", "contract": { "type": "RENDEZVOUS" | "CLEARING" | "CLOSE", "x": number, "y": number } }`,
        isAction: true,
        handler: async (args, coordinator) => {
            const contract = args.contract;
            if (contract.type === 'CLOSE') {
                for (const coopId of coordinator.beliefs.activeContracts.keys()) {
                    if (coopId === 'admin_move') continue;
                    await coordinator.broadcastP2P({
                        type: 'CLOSE_CONTRACT',
                        coopId: coopId
                    });
                    coordinator.beliefs.activeContracts.delete(coopId);
                }
                return { success: true, message: 'Closed active cooperation contracts.' };
            }

            await coordinator.broadcastP2P({
                type: 'PROPOSE_CONTRACT',
                coopId: contract.coopId || `coop_${Date.now()}`,
                type: contract.type,
                x: Number(contract.x),
                y: Number(contract.y)
            });
            return { success: true, message: 'Broadcast proposed contract.' };
        }
    },

    instruct_agent_to_say: {
        description: "Instructs the partner agent to speak a message publicly.",
        getArgsSchema: () => `{ "agentId": "${AGENT_IDS.BDI_AGENT_ID}", "message": "text" }`,
        isAction: true,
        handler: async (args, coordinator) => {
            await coordinator.broadcastP2P({
                type: 'INSTRUCT_SAY',
                message: args.message
            });
            return { success: true };
        }
    },

    get_local_context: {
        description: "Fetches the agent's current state (me position/score/status, variables, carried items, rules, parcels, and peers).",
        getArgsSchema: () => `{}`,
        isAction: false,
        handler: async (args, coordinator) => {
            const b = coordinator.beliefs;
            const context = {
                me: b.me,
                carried: b.carried,
                variables: b.variables,
                policyRules: b.policyRules,
                map: b.map ? {
                    width: b.map.width,
                    height: b.map.height,
                    minX: 0,
                    maxX: b.map.width - 1,
                    minY: 0,
                    maxY: b.map.height - 1
                } : null,
                parcels: Array.from(b.parcels.values()).map(p => ({
                    id: p.id,
                    x: p.x,
                    y: p.y,
                    reward: p.reward,
                    carriedBy: p.carriedBy
                })),
                peers: Array.from(b.peers.values()).map(p => ({
                    id: p.id,
                    name: p.name,
                    x: p.x,
                    y: p.y,
                    score: p.score
                })),
                crates: Array.from(b.crates.values()).map(c => ({
                    id: c.id,
                    x: c.x,
                    y: c.y
                }))
            };
            return { success: true, context };
        }
    },

    set_agent_variable: {
        description: "Saves a variable to agent memory.",
        getArgsSchema: () => `{ "name": "var_name", "value": any }`,
        isAction: true,
        handler: async (args, coordinator) => {
            coordinator.beliefs.variables[args.name] = args.value;
            await coordinator.broadcastP2P({
                type: 'SET_VARIABLE',
                name: args.name,
                value: args.value
            });
            return { success: true, message: `Successfully set variable '${args.name}' to ${JSON.stringify(args.value)}` };
        }
    }
};

/**
 * Generates the tools list text formatted for the LLM system prompt.
 * @returns {string} Text snippet containing the tools manifest.
 */
export function generateToolsPrompt() {
    let index = 1;
    let promptStr = '';
    for (const [name, tool] of Object.entries(TOOLS_REGISTRY)) {
        promptStr += `${index}. ${name}\n`;
        promptStr += `   - Description: ${tool.description}\n`;
        promptStr += `   - Args: ${tool.getArgsSchema()}\n`;
        index++;
    }
    return promptStr.trim();
}
