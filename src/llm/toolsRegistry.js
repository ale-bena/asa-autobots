/**
 * @file toolsRegistry.js
 * @description Registry of available tools and their corresponding execution handlers, along with descriptions and argument schemas.
 */

import { evaluateExpression } from '../policy/PolicyEngine.js';
import { findNearestDeliveryZone } from '../agent/PlanLibrary.js';
import { AGENT_IDS } from '../config/config.js';
import { MapRepresentation } from '../mapping/MapRepresentation.js';

/**
 * Picks a relay drop tile: walkable, adjacent to the best delivery zone, but
 * NOT a delivery tile itself (a putdown there would count as the courier's own
 * delivery and void the cross-agent bonus).
 */
function pickRelayDropTile(beliefs) {
    if (!beliefs.map) return null;
    const zone = findNearestDeliveryZone(beliefs, beliefs.me.x, beliefs.me.y);
    if (!zone) return null;
    const neighbors = beliefs.map.getNeighbors({ x: zone.x, y: zone.y });
    return neighbors.find(n => beliefs.map.getTileCode(n.x, n.y) !== MapRepresentation.TILE_CODES.DELIVERY) || neighbors[0] || null;
}

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
async function waitUntilReached(agentId, targetX, targetY, coordinator, sendTime = null) {
    const beliefs = coordinator.beliefs;
    const initialPos = getAgentPosition(agentId, beliefs);
    let distance = 10;
    if (initialPos) {
        distance = Math.abs(initialPos.x - targetX) + Math.abs(initialPos.y - targetY);
    }
    const timeoutMs = Math.max(5000, distance * 1000); // 1 second per tile, min 5s
    const startTime = Date.now();
    const referenceTime = sendTime || startTime;

    console.log(`[LLM Tool Wait] Waiting for agent ${agentId} to reach (${targetX}, ${targetY}). Distance: ${distance}. Timeout: ${timeoutMs / 1000}s`);

    while (Date.now() - startTime < timeoutMs) {
        // Check for MOVE_TO_ACK message from the peer agent
        if (agentId !== beliefs.me.id) {
            const ack = beliefs.variables.moveToAck;
            if (ack && ack.x === targetX && ack.y === targetY && ack.timestamp >= referenceTime) {
                console.log(`[LLM Tool Wait] Received MOVE_TO_ACK from agent ${agentId} for coordinate (${targetX}, ${targetY}). Success: ${ack.success}`);
                delete beliefs.variables.moveToAck; // Clear the ACK to prevent reuse
                if (ack.success) {
                    return { success: true, message: `Agent reached (${targetX}, ${targetY})` };
                } else {
                    return { success: false, error: `Agent failed to reach (${targetX}, ${targetY})` };
                }
            }
        }

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
 * NOTE: Currently preserved as a utility function for direct physical action coordination
 * (e.g. for future/legacy physical coordination support or test assertions).
 */
async function waitUntilPickedUp(agentId, parcelId, coordinator) {
    const beliefs = coordinator.beliefs;
    const timeoutMs = 8000; // 8 seconds
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
 * NOTE: Preserved as part of the LLM tool wait-loop utility suite for future physical tool
 * coordination extensions or test suite assertions.
 */
async function waitUntilDelivered(agentId, parcelId, coordinator) {
    const beliefs = coordinator.beliefs;
    const timeoutMs = 5000; // 5 seconds
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
    get_history: {
        description: "Gets the history of the past conversations. The history is returned in the form of a JSON array of objects, where each object has a 'prompt' and 'answer' field.",
        getArgsSchema: () => `{}`,
        isAction: false,
        handler: async (args, coordinator) => {
            return { success: true, history: coordinator.history || [] };
        }
    },

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
        description: "Directs an agent to navigate to a specific grid coordinate. Set holdOnArrival to true if the agent should pause/stay still immediately upon reaching the destination. You can optionally specify a holdDuration in seconds. Set dropOnArrival to true if the agent should drop its carried parcels (and first search for/pickup a parcel if not carrying any) at the destination. Issuing a new move to a held agent automatically releases its hold.",
        getArgsSchema: () => `{ "id": "${AGENT_IDS.BDI_AGENT_ID} or ${AGENT_IDS.LLM_AGENT_ID}", "x": number, "y": number, "holdOnArrival": boolean, "holdDuration": number | null, "dropOnArrival": boolean | null }`,
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
            const dropOnArrival = args.dropOnArrival === true;

            if (coordinator.beliefs.map) {
                targetX = Math.max(0, Math.min(targetX, coordinator.beliefs.map.width - 1));
                targetY = Math.max(0, Math.min(targetY, coordinator.beliefs.map.height - 1));
            }

            if (args.id === coordinator.beliefs.me.id) {
                // Explicit move order implies green light (see P2P MOVE_TO handler)
                coordinator.beliefs.hold = false;
                coordinator.beliefs.activeContracts.set('admin_move', {
                    coopId: 'admin_move',
                    type: 'MOVE_TO',
                    x: targetX,
                    y: targetY,
                    holdOnArrival: holdOnArrival,
                    holdDuration: holdDuration,
                    dropOnArrival: dropOnArrival,
                    status: 'ACTIVE'
                });
            }

            // Clear any stale moveToAck and record sending timestamp before proposing the move
            let sendTime = null;
            if (args.id !== coordinator.beliefs.me.id) {
                delete coordinator.beliefs.variables.moveToAck;
                sendTime = Date.now();
            }

            await coordinator.P2P(
                args.id,
                {
                    type: 'MOVE_TO',
                    x: targetX,
                    y: targetY,
                    holdOnArrival: holdOnArrival,
                    holdDuration: holdDuration,
                    dropOnArrival: dropOnArrival
                });

            // Blocking wait until coordinate is reached
            const result = await waitUntilReached(args.id, targetX, targetY, coordinator, sendTime);
            return result;
        }
    },

    apply_agent_rules: {
        description: `Modifies behavioral policies/rules of the environment for an agent. 
        Rules override in order, so the first rule that applies takes priority.
        
        - all_tiles: if true, the rule applies to all tiles
        - tiles: an array of coordinates, the rule applies to those tiles, if empty, the rule applies to no tiles
        - stackSizeBounds: an array of bounds, the rule applies if the agent's stack size is within these bounds, if empty, the rule applies to all stack sizes
        - rewardBounds: an array of bounds, the rule applies if the parcel reward is within these bounds, if empty, the rule applies to all rewards. Same semantics as stackSizeBounds (min inclusive, max exclusive).
        - multiplier: SCALES the delivery reward (reward = reward * multiplier). Use for proportional
          effects: "you get 0 pts" -> multiplier 0, "double the reward" -> multiplier 2,
          "0.3 of the standard reward" -> multiplier 0.3. A bonus of 0 is a no-op; zeroing a reward
          REQUIRES multiplier 0.
        - bonus: flat points ADDED to the reward (reward = reward + bonus, may be negative). Use for
          absolute effects: "+5 pts" -> bonus 5, "lose 50 pts" -> bonus -50.
    `,
        getArgsSchema: () => `{ 
        "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}" or "all", 
        "rules": [{
            "all_tiles": boolean,
            "tiles": ["x,y", ...],
            "stackSizeBounds": [{"min": number | null, "max": number | null}], // min is inclusive, max is not inclusive, for an unbounded use null
            "rewardBounds": [{"min": number | null, "max": number | null}], // min is inclusive, max is not inclusive, for an unbounded use null
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
        description: "Proposes a Peer-to-Peer rendezvous, handoff, gate clearing, or persistent courier relay contract, or cancels/closes active cooperation. RELAY: the courier agent repeatedly farms parcels and drops them at the drop tile; the other agent picks them up and delivers them, earning cross-agent delivery bonuses useful when picking up parcels from other agents. For RELAY, x/y may be null to auto-pick a drop tile beside the best delivery zone.",
        getArgsSchema: () => `{
            "id": "${AGENT_IDS.BDI_AGENT_ID}" or "${AGENT_IDS.LLM_AGENT_ID}",
            "contract": {
                "type": "RENDEZVOUS" | "CLEARING" | "HANDOFF" | "RELAY" | "CLOSE",
                "x": number | null, // RELAY: null = auto-pick a drop tile next to the best delivery zone
                "y": number | null,
                "radius": number | null,
                "holdDuration": number | "indefinite" | null, // Duration (in seconds) to wait after BOTH agents arrive. Defaults to 3 seconds if null or not set. Use -1 or "indefinite" for indefinite waiting (no timer, wait until manual resume).
                "courierId": "agent id" | null // RELAY only: the agent that farms and drops parcels (defaults to ${AGENT_IDS.BDI_AGENT_ID}); the other agent delivers them
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

            let cx = (contract.x !== undefined && contract.x !== null) ? Math.round(Number(contract.x)) : null;
            let cy = (contract.y !== undefined && contract.y !== null) ? Math.round(Number(contract.y)) : null;
            let courierId = null;

            if (contract.type === 'RELAY') {
                courierId = contract.courierId || AGENT_IDS.BDI_AGENT_ID;
                const b = coordinator.beliefs;
                if (cx === null || cy === null) {
                    const drop = pickRelayDropTile(b);
                    if (!drop) {
                        return { success: false, error: 'Could not determine a relay drop tile (map not ready or no delivery zones).' };
                    }
                    cx = drop.x;
                    cy = drop.y;
                } else if (b.map && b.map.getTileCode(cx, cy) === MapRepresentation.TILE_CODES.DELIVERY) {
                    // Drop tile must not be a delivery tile, or the courier's
                    // putdown counts as its own delivery and voids the bonus.
                    const shifted = b.map.getNeighbors({ x: cx, y: cy }).find(n => b.map.getTileCode(n.x, n.y) !== MapRepresentation.TILE_CODES.DELIVERY);
                    if (shifted) {
                        cx = shifted.x;
                        cy = shifted.y;
                    }
                }
            }

            // CRITICAL: Store proposed contract locally in coordinator's beliefs so coordinator also acts on it
            coordinator.beliefs.hold = false; // Release hold so agent can execute its part of the contract
            coordinator.beliefs.activeContracts.set(coopId, {
                coopId: coopId,
                type: contract.type,
                x: cx,
                y: cy,
                radius: radius,
                holdDuration: holdDuration,
                courierId: courierId,
                status: 'ACTIVE'
            });

            await coordinator.P2P(
                args.id,
                {
                    type: 'PROPOSE_CONTRACT',
                    coopId: coopId,
                    contractType: contract.type,
                    x: cx,
                    y: cy,
                    radius: radius,
                    holdDuration: holdDuration,
                    courierId: courierId
                });
            return { success: true, message: `Broadcast proposed ${contract.type} contract${contract.type === 'RELAY' ? ` (drop tile (${cx}, ${cy}), courier ${courierId})` : ''}.` };
        }
    },

    get_local_context: {
        description: "Fetches an agent's current state (id/name/position/score/status, variables, carried items, rules, parcels, peers, and map info including the extreme walkable tiles - use map.extremes for 'leftmost/rightmost/topmost/bottommost tile' requests, NOT the raw bounds, since border coordinates may be walls).",
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
                    maxY: b.map.height - 1,
                    extremes: b.map.findExtremeWalkableTiles(b.me.x, b.me.y)
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

                    // Auto-clear active cooperative contracts on timer expiration
                    for (const [coopId, contract] of coordinator.beliefs.activeContracts.entries()) {
                        if (coopId === 'admin_move') continue;
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

            // CRITICAL: Automatically close all active cooperative contracts to release agents from wait loops
            for (const [coopId, contract] of coordinator.beliefs.activeContracts.entries()) {
                if (coopId === 'admin_move') continue;
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

            return { success: true, message: `Agent(s) [${resumeId}] resumed and cooperative contracts cleared.` };
        }
    },
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
