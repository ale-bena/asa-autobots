/**
 * @file toolsRegistry.js
 * @description Registry of available tools and their corresponding execution handlers, along with descriptions and argument schemas.
 */

import { evaluateExpression } from '../policy/PolicyEngine.js';
import { AGENT_IDS } from '../config/config.js';

/**
 * Helper to retrieve an agent's current coordinates.
 */
function getAgentPosition(agentId, beliefs) {
    if (agentId === beliefs.me.id) {
        return { x: beliefs.me.x, y: beliefs.me.y };
    }
    const peer = beliefs.peers.get(agentId);
    if (peer) {
        return { x: peer.x, y: peer.y };
    }
    return null;
}

/**
 * Blocking wait until the agent has reached the target coordinates or timed out.
 */
async function waitUntilReached(agentId, targetX, targetY, coordinator) {
    const beliefs = coordinator.beliefs;
    const initialPos = getAgentPosition(agentId, beliefs);
    let distance = 10;
    if (initialPos) {
        distance = Math.abs(initialPos.x - targetX) + Math.abs(initialPos.y - targetY);
    }
    const timeoutMs = Math.max(30000, distance * 2000); // 2 seconds per tile, min 30s
    const startTime = Date.now();

    console.log(`[LLM Tool Wait] Waiting for agent ${agentId} to reach (${targetX}, ${targetY}). Distance: ${distance}. Timeout: ${timeoutMs / 1000}s`);

    while (Date.now() - startTime < timeoutMs) {
        const pos = getAgentPosition(agentId, beliefs);
        if (pos) {
            const rx = Math.round(pos.x);
            const ry = Math.round(pos.y);
            if (rx === targetX && ry === targetY) {
                console.log(`[LLM Tool Wait] Agent ${agentId} successfully reached (${targetX}, ${targetY}).`);
                return { success: true, message: `Agent reached (${targetX}, ${targetY})` };
            }
        }

        // If it's ourselves and the admin_move contract was cleared (indicating path failure)
        if (agentId === beliefs.me.id) {
            if (!beliefs.activeContracts.has('admin_move')) {
                console.log(`[LLM Tool Wait] admin_move contract cleared for coordinator agent.`);
                break;
            }
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.warn(`[LLM Tool Wait] Timeout/failure waiting for agent ${agentId} to reach (${targetX}, ${targetY}).`);
    return { success: false, error: `Agent failed to reach (${targetX}, ${targetY}) within timeout.` };
}

/**
 * Blocking wait until the agent has successfully picked up the specified parcel or timed out.
 */
async function waitUntilPickedUp(agentId, parcelId, coordinator) {
    const beliefs = coordinator.beliefs;
    const timeoutMs = 45000; // 45 seconds
    const startTime = Date.now();

    console.log(`[LLM Tool Wait] Waiting for agent ${agentId} to pick up parcel ${parcelId}. Timeout: ${timeoutMs / 1000}s`);

    while (Date.now() - startTime < timeoutMs) {
        if (agentId === beliefs.me.id) {
            if (beliefs.carried.includes(parcelId)) {
                console.log(`[LLM Tool Wait] Coordinator successfully picked up parcel ${parcelId}.`);
                return { success: true, message: `Agent picked up parcel ${parcelId}` };
            }
            if (!beliefs.activeContracts.has('admin_pickup')) {
                console.log(`[LLM Tool Wait] admin_pickup contract cleared for coordinator.`);
                break;
            }
        } else {
            const peer = beliefs.peers.get(agentId);
            if (peer && peer.carried && peer.carried.includes(parcelId)) {
                console.log(`[LLM Tool Wait] Agent ${agentId} successfully picked up parcel ${parcelId}.`);
                return { success: true, message: `Agent ${agentId} picked up parcel ${parcelId}` };
            }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.warn(`[LLM Tool Wait] Timeout/failure waiting for agent ${agentId} to pick up parcel ${parcelId}.`);
    return { success: false, error: `Agent failed to pick up parcel ${parcelId} within timeout.` };
}

/**
 * Blocking wait until the agent has successfully delivered/dropped the specified parcel or timed out.
 */
async function waitUntilDelivered(agentId, parcelId, coordinator) {
    const beliefs = coordinator.beliefs;
    const timeoutMs = 45000; // 45 seconds
    const startTime = Date.now();

    console.log(`[LLM Tool Wait] Waiting for agent ${agentId} to deliver parcel ${parcelId}. Timeout: ${timeoutMs / 1000}s`);

    while (Date.now() - startTime < timeoutMs) {
        if (agentId === beliefs.me.id) {
            if (!beliefs.carried.includes(parcelId)) {
                console.log(`[LLM Tool Wait] Coordinator successfully delivered parcel ${parcelId}.`);
                return { success: true, message: `Agent delivered parcel ${parcelId}` };
            }
            if (!beliefs.activeContracts.has('admin_deliver')) {
                console.log(`[LLM Tool Wait] admin_deliver contract cleared for coordinator.`);
                break;
            }
        } else {
            const peer = beliefs.peers.get(agentId);
            if (peer) {
                if (peer.carried && !peer.carried.includes(parcelId)) {
                    console.log(`[LLM Tool Wait] Agent ${agentId} successfully delivered parcel ${parcelId}.`);
                    return { success: true, message: `Agent ${agentId} delivered parcel ${parcelId}` };
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.warn(`[LLM Tool Wait] Timeout/failure waiting for agent ${agentId} to deliver parcel ${parcelId}.`);
    return { success: false, error: `Agent failed to deliver parcel ${parcelId} within timeout.` };
}

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
        description: "Directs an agent to navigate to a specific grid coordinate. Set holdOnArrival to true if the agent should pause/stay still immediately upon reaching the destination. You can optionally specify a holdDuration in seconds.",
        getArgsSchema: () => `{ "id": "${AGENT_IDS.BDI_AGENT_ID} or ${AGENT_IDS.LLM_AGENT_ID}", "x": number, "y": number, "holdOnArrival": boolean, "holdDuration": number | null }`,
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
            const holdOnArrival = args.holdOnArrival === true;
            const holdDuration = args.holdDuration ? Number(args.holdDuration) : null;

            if (coordinator.beliefs.map) {
                targetX = Math.max(0, Math.min(targetX, coordinator.beliefs.map.width - 1));
                targetY = Math.max(0, Math.min(targetY, coordinator.beliefs.map.height - 1));
            }

            if (args.id === coordinator.beliefs.me.id) {
                coordinator.beliefs.activeContracts.set('admin_move', {
                    coopId: 'admin_move',
                    type: 'MOVE_TO',
                    x: targetX,
                    y: targetY,
                    holdOnArrival: holdOnArrival,
                    holdDuration: holdDuration,
                    status: 'ACTIVE'
                });
            }

            await coordinator.P2P(
                args.id,
                {
                    type: 'MOVE_TO',
                    x: targetX,
                    y: targetY,
                    holdOnArrival: holdOnArrival,
                    holdDuration: holdDuration
                });

            // Blocking wait until coordinate is reached
            const result = await waitUntilReached(args.id, targetX, targetY, coordinator);
            return result;
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
        "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}" or "all", 
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
            const targetId = args.id || 'all';

            if (targetId === 'all' || targetId === coordinator.beliefs.me.id) {
                coordinator.beliefs.applyPolicyRules(args.rules);
            }

            if (targetId === 'all' || targetId === coordinator.getPeerAgentId()) {
                await coordinator.P2P(
                    coordinator.getPeerAgentId(),
                    {
                        type: 'APPLY_RULES',
                        rules: args.rules
                    });
            }

            return { success: true };
        }
    },

    cooperate_with_agent: {
        description: "Proposes a Peer-to-Peer rendezvous, handoff, or gate clearing contract, or cancels/closes active cooperation.",
        getArgsSchema: () => `{ 
            "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}",
            "contract": { 
                "type": "RENDEZVOUS" | "CLEARING" | "HANDOFF" | "CLOSE", 
                "x": number, 
                "y": number,
                "radius": number | null,
                "holdDuration": number | "indefinite" | null // Duration (in seconds) to wait after BOTH agents arrive. Defaults to 3 seconds if null or not set. Use -1 or "indefinite" for indefinite waiting (no timer, wait until manual resume).
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

            const coopId = contract.coopId || `coop_${Date.now()}`;
            const radius = contract.radius !== undefined ? Number(contract.radius) : null;
            
            let holdDuration = null;
            if (contract.holdDuration !== undefined && contract.holdDuration !== null) {
                if (contract.holdDuration === 'indefinite') {
                    holdDuration = -1;
                } else {
                    const parsed = Number(contract.holdDuration);
                    holdDuration = isNaN(parsed) ? null : parsed;
                }
            }

            // CRITICAL: Store proposed contract locally in coordinator's beliefs so coordinator also acts on it
            coordinator.beliefs.activeContracts.set(coopId, {
                coopId: coopId,
                type: contract.type,
                x: Number(contract.x),
                y: Number(contract.y),
                radius: radius,
                holdDuration: holdDuration,
                status: 'ACTIVE'
            });

            await coordinator.P2P(
                args.id,
                {
                    type: 'PROPOSE_CONTRACT',
                    coopId: coopId,
                    contractType: contract.type,
                    x: Number(contract.x),
                    y: Number(contract.y),
                    radius: radius,
                    holdDuration: holdDuration
                });
            return { success: true, message: `Broadcast proposed ${contract.type} contract.` };
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
        description: "Stops/pauses an agent (red light). The agent will cease all movement and actions. Use this for 'stop', 'freeze', 'red light', or 'hold' commands. You can specify a duration in seconds to automatically resume.",
        getArgsSchema: () => `{ "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}" or "all", "duration": number | null }`,
        isAction: true,
        handler: async (args, coordinator) => {
            const holdId = args.id || 'all';
            const duration = args.duration ? Number(args.duration) : null;

            if (holdId === 'all' || holdId === coordinator.beliefs.me.id) {
                coordinator.beliefs.hold = true;
            }
            if (holdId === 'all' || holdId === coordinator.getPeerAgentId()) {
                await coordinator.P2P(
                    coordinator.getPeerAgentId(),
                    {
                        type: 'HOLD'
                    });
            }

            if (duration && duration > 0) {
                console.log(`[LLM Tool] Scheduling automatic resume for ${holdId} in ${duration} seconds.`);
                setTimeout(async () => {
                    console.log(`[LLM Tool] Timer expired. Automatically resuming agent(s) [${holdId}].`);
                    if (holdId === 'all' || holdId === coordinator.beliefs.me.id) {
                        coordinator.beliefs.hold = false;
                    }
                    if (holdId === 'all' || holdId === coordinator.getPeerAgentId()) {
                        await coordinator.P2P(
                            coordinator.getPeerAgentId(),
                            {
                                type: 'RESUME'
                            });
                    }

                    // Auto-clear active RENDEZVOUS contracts on timer expiration
                    for (const [coopId, contract] of coordinator.beliefs.activeContracts.entries()) {
                        if (coopId === 'admin_move') continue;
                        if (contract.type === 'RENDEZVOUS') {
                            if (holdId === 'all' || holdId === coordinator.getPeerAgentId()) {
                                await coordinator.P2P(
                                    coordinator.getPeerAgentId(),
                                    {
                                        type: 'CLOSE_CONTRACT',
                                        coopId: coopId
                                    });
                            }
                            coordinator.beliefs.activeContracts.delete(coopId);
                        }
                    }
                }, duration * 1000);
            }

            return { success: true, message: `Agent(s) [${holdId}] paused (HOLD state activated)${duration ? ` for ${duration}s` : ''}.` };
        }
    },

    resume_agent: {
        description: "Resumes an agent (green light). Cancels a previous hold and lets the agent continue normal operation. Use this for 'go', 'resume', 'green light', or 'continue' commands.",
        getArgsSchema: () => `{ "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}" or "all" }`,
        isAction: true,
        handler: async (args, coordinator) => {
            const resumeId = args.id || 'all';

            if (resumeId === 'all' || resumeId === coordinator.beliefs.me.id) {
                coordinator.beliefs.hold = false;
            }
            if (resumeId === 'all' || resumeId === coordinator.getPeerAgentId()) {
                await coordinator.P2P(
                    coordinator.getPeerAgentId(),
                    {
                        type: 'RESUME'
                    });
            }

            // CRITICAL: Automatically close all active RENDEZVOUS contracts to release agents from wait loops
            for (const [coopId, contract] of coordinator.beliefs.activeContracts.entries()) {
                if (coopId === 'admin_move') continue;
                if (contract.type === 'RENDEZVOUS') {
                    if (resumeId === 'all' || resumeId === coordinator.getPeerAgentId()) {
                        await coordinator.P2P(
                            coordinator.getPeerAgentId(),
                            {
                                type: 'CLOSE_CONTRACT',
                                coopId: coopId
                            });
                    }
                    coordinator.beliefs.activeContracts.delete(coopId);
                }
            }

            return { success: true, message: `Agent(s) [${resumeId}] resumed and cooperative contracts cleared.` };
        }
    },

    apply_custom_parcel_rule: {
        description: "Applies a custom reward multiplier or bonus modifier for parcels that meet a specific condition (e.g. previously carried by another agent). Example condition: 'parcel.previouslyCarriedByOther == true'.",
        getArgsSchema: () => `{
            "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}" or "all",
            "condition": "string",
            "multiplier": number | null,
            "bonus": number | null
        }`,
        isAction: true,
        handler: async (args, coordinator) => {
            const rule = {
                condition: args.condition,
                multiplier: args.multiplier !== undefined && args.multiplier !== null ? Number(args.multiplier) : null,
                bonus: args.bonus !== undefined && args.bonus !== null ? Number(args.bonus) : null
            };

            const targetId = args.id || 'all';

            if (targetId === 'all' || targetId === coordinator.beliefs.me.id) {
                if (rule.multiplier !== null) coordinator.beliefs.policyRules.multiplierRules.push(rule);
                if (rule.bonus !== null) coordinator.beliefs.policyRules.bonusRules.push(rule);
            }

            if (targetId === 'all' || targetId === coordinator.getPeerAgentId()) {
                await coordinator.P2P(
                    coordinator.getPeerAgentId(),
                    {
                        type: 'APPLY_CUSTOM_PARCEL_RULE',
                        rule: rule
                    });
            }

            return { success: true, message: `Applied custom parcel rule to ${targetId}.` };
        }
    },

    pickup_parcel_by_id: {
        description: "Directs a specific agent to navigate to a parcel and pick it up by its ID. Blocks until picked up or timeout.",
        getArgsSchema: () => `{ "id": "${AGENT_IDS.BDI_AGENT_ID} or ${AGENT_IDS.LLM_AGENT_ID}", "parcelId": "string" }`,
        isAction: true,
        handler: async (args, coordinator) => {
            const targetId = args.id;
            const parcelId = args.parcelId;

            if (targetId === coordinator.beliefs.me.id) {
                coordinator.beliefs.activeContracts.set('admin_pickup', {
                    coopId: 'admin_pickup',
                    type: 'PICKUP',
                    parcelId: parcelId,
                    status: 'ACTIVE'
                });
            }

            await coordinator.P2P(
                targetId,
                {
                    type: 'PICKUP_PARCEL',
                    parcelId: parcelId
                });

            const result = await waitUntilPickedUp(targetId, parcelId, coordinator);
            return result;
        }
    },

    deliver_parcel_by_id: {
        description: "Directs a specific agent to navigate to a coordinate (or nearest delivery zone if x/y are null) and deliver/drop a specific parcel by its ID. Blocks until delivered or timeout.",
        getArgsSchema: () => `{ "id": "${AGENT_IDS.BDI_AGENT_ID} or ${AGENT_IDS.LLM_AGENT_ID}", "parcelId": "string", "x": number | null, "y": number | null }`,
        isAction: true,
        handler: async (args, coordinator) => {
            const targetId = args.id;
            const parcelId = args.parcelId;
            const tx = args.x !== undefined ? args.x : null;
            const ty = args.y !== undefined ? args.y : null;

            if (targetId === coordinator.beliefs.me.id) {
                coordinator.beliefs.activeContracts.set('admin_deliver', {
                    coopId: 'admin_deliver',
                    type: 'DELIVER',
                    parcelId: parcelId,
                    x: tx,
                    y: ty,
                    status: 'ACTIVE'
                });
            }

            await coordinator.P2P(
                targetId,
                {
                    type: 'DELIVER_PARCEL',
                    parcelId: parcelId,
                    x: tx,
                    y: ty
                });

            const result = await waitUntilDelivered(targetId, parcelId, coordinator);
            return result;
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
