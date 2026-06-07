/**
 * @file toolsRegistry.js
 * @description Registry of available tools and their corresponding execution handlers.
 */

import { evaluateExpression } from '../policy/PolicyEngine.js';

/**
 * Registry of tool execution handlers.
 * Each handler takes the tool arguments and the LLMCoordinator instance,
 * and returns the execution result.
 * @type {Object<string, function(Object, import('./LLMCoordinator.js').LLMCoordinator): Promise<Object>>}
 */
export const TOOLS_REGISTRY = {
    evaluate_math_expression: async (args, coordinator) => {
        const res = evaluateExpression(args.expression, coordinator.beliefs);
        return { success: true, result: String(res) };
    },

    move_agent_to_coordinate: async (args, coordinator) => {
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

        await coordinator.broadcastP2P({
            type: 'MOVE_TO',
            x: Number(args.x),
            y: Number(args.y)
        });
        return { success: true, message: `Directed agent to (${args.x}, ${args.y})` };
    },

    apply_agent_rules: async (args, coordinator) => {
        await coordinator.broadcastP2P({
            type: 'APPLY_RULES',
            rules: args.rules
        });
        return { success: true };
    },

    cooperate_with_agent: async (args, coordinator) => {
        const contract = args.contract;
        await coordinator.broadcastP2P({
            type: 'PROPOSE_CONTRACT',
            coopId: contract.coopId || `coop_${Date.now()}`,
            type: contract.type,
            x: Number(contract.x),
            y: Number(contract.y)
        });
        return { success: true, message: 'Broadcast proposed contract.' };
    },

    instruct_agent_to_say: async (args, coordinator) => {
        await coordinator.broadcastP2P({
            type: 'INSTRUCT_SAY',
            message: args.message
        });
        return { success: true };
    },

    get_local_context: async (args, coordinator) => {
        const b = coordinator.beliefs;
        const context = {
            me: b.me,
            carried: b.carried,
            variables: b.variables,
            policyRules: b.policyRules,
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
    },

    set_agent_variable: async (args, coordinator) => {
        coordinator.beliefs.variables[args.name] = args.value;
        await coordinator.broadcastP2P({
            type: 'SET_VARIABLE',
            name: args.name,
            value: args.value
        });
        return { success: true, message: `Successfully set variable '${args.name}' to ${JSON.stringify(args.value)}` };
    }
};
