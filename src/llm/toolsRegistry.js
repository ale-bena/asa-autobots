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
        description: "Directs an agent to navigate to a specific grid coordinate.",
        getArgsSchema: () => `{ "id": "${AGENT_IDS.BDI_AGENT_ID} or ${AGENT_IDS.LLM_AGENT_ID}", "x": number, "y": number }`,
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

            await coordinator.P2P(
                args.id,
                {
                    type: 'MOVE_TO',
                    x: targetX,
                    y: targetY
                });
            return { success: true, message: `Directed agent to (${targetX}, ${targetY})` };
        }
    },

    apply_agent_rules: {
        description: `Modifies behavioral policies/rules of the environment for an agent. 
        Rules override in order, so the first rule that applies takes priority.
        
        - all_tiles: if true, the rule applies to all tiles
        - tiles: an array of coordinates, the rule applies to those tiles, if empty, the rule applies to no tiles
        - stackSizeBounds: an array of bounds, the rule applies if the agent's stack size is within these bounds, if empty, the rule applies to all stack sizes
        - minReward: the minimum reward of a parcel for it to count
        - maxReward: the maximum reward of a parcel for it to count
        - multiplier: the multiplier to apply to the agent's reward (may be negative)
        - bonus: the bonus to apply to the agent's reward (may be negative)
    `,
        getArgsSchema: () => `{ 
        "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}", 
        "rules": [{
            "all_tiles": boolean,
            "tiles": ["x,y", ...],
            "stackSizeBounds": [{"min": number | null, "max": number | null}], // the max is not inclusive, for an unbounded use null
            "minReward": number | null, 
            "maxReward": number | null,
            "multiplier": number  | null,
            "bonus": number | null
        }]
     }`,
        isAction: true,
        handler: async (args, coordinator) => {
            await coordinator.P2P(
                args.id,
                {
                    type: 'APPLY_RULES',
                    rules: args.rules
                });
            return { success: true };
        }
    },

    cooperate_with_agent: {
        description: "Proposes a Peer-to-Peer rendezvous or gate clearing contract, or cancels/closes active cooperation.",
        getArgsSchema: () => `{ 
            "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}",
            "contract": { 
                "type": "RENDEZVOUS" | "CLEARING" | "CLOSE", 
                "x": number, 
                "y": number,
                "radius": number | null,
            } 
        }`,
        isAction: true,
        handler: async (args, coordinator) => {
            const contract = args.contract;
            if (contract.type === 'CLOSE') {
                for (const coopId of coordinator.beliefs.activeContracts.keys()) {
                    if (coopId === 'admin_move') continue;
                    await coordinator.P2P(
                        args.id,
                        {
                            type: 'CLOSE_CONTRACT',
                            coopId: coopId
                        });
                    coordinator.beliefs.activeContracts.delete(coopId);
                }
                return { success: true, message: 'Closed active cooperation contracts.' };
            }

            await coordinator.P2P(
                args.id,
                {
                    type: 'PROPOSE_CONTRACT',
                    coopId: contract.coopId || `coop_${Date.now()}`,
                    type: contract.type,
                    x: Number(contract.x),
                    y: Number(contract.y)
                });
            return { success: true, message: 'Broadcast proposed contract.' };
        }
    },

    get_local_context: {
        description: "Fetches an agent's current state (id/name/position/score/status, variables, carried items, rules, parcels, and peers).",
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
        getArgsSchema: () => `{ 
            "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}",
            "name": "var_name",
            "value": any 
        }`,
        isAction: true,
        handler: async (args, coordinator) => {
            coordinator.beliefs.variables[args.name] = args.value;
            await coordinator.P2P(
                args.id,
                {
                    type: 'SET_VARIABLE',
                    name: args.name,
                    value: args.value
                });
            return { success: true, message: `Successfully set variable '${args.name}' to ${JSON.stringify(args.value)}` };
        }
    },

    hold_agent: {
        description: "Stops/pauses an agent (red light). The agent will cease all movement and actions until explicitly resumed. Use this for 'stop', 'freeze', 'red light', or 'hold' commands.",
        getArgsSchema: () => `{ "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}" }`,
        isAction: true,
        handler: async (args, coordinator) => {
            coordinator.beliefs.hold = true;
            await coordinator.P2P(
                args.id,
                {
                    type: 'HOLD'
                });
            return { success: true, message: 'Agent paused (HOLD state activated).' };
        }
    },

    resume_agent: {
        description: "Resumes an agent (green light). Cancels a previous hold and lets the agent continue normal operation. Use this for 'go', 'resume', 'green light', or 'continue' commands.",
        getArgsSchema: () => `{ "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}" }`,
        isAction: true,
        handler: async (args, coordinator) => {
            coordinator.beliefs.hold = false;
            await coordinator.P2P(
                args.id,
                {
                    type: 'RESUME'
                });
            return { success: true, message: 'Agent resumed (HOLD state deactivated).' };
        }
    }
};

/**
 * Generates the tools list text formatted for the LLM system prompt.
 * @returns {string} Text snippet containing the tools manifest.
 */
export function generateToolsPrompt() {
    let index = 0;
    let promptStr = '';
    for (const [name, tool] of Object.entries(TOOLS_REGISTRY)) {
        promptStr += `<tool${index}>\n`;
        promptStr += `   ${index}. ${name}\n`;
        promptStr += `   - Description: ${tool.description}\n`;
        promptStr += `   - Args: ${tool.getArgsSchema()}\n`;
        promptStr += `</tool${index}>\n`;
        index++;
    }
    return promptStr.trim();
}
