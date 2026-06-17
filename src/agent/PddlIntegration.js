/**
 * @module agent/PddlIntegration
 * @description PDDL solver integration for BDI agent. Handles crate obstacle detection,
 * local push solving, PDDL plan translation, and execution recipe generation.
 * Uses A* for pathfinding with the heuristic that crates can only exist on tile codes 4 (CRATE_SPAWN) 
 * and 5 (CRATE_MOVE), with code 4 being the most probable spawn location.
 */

import { findAStarPath } from '../mapping/Pathfinding.js';
import { NavigateTo } from './PlanLibrary.js';
import { PddlServiceBridge } from '../planning/PddlServiceBridge.js';
import { MapRepresentation } from '../mapping/MapRepresentation.js';

/**
 * Finds a nearby clear tile capable of holding a crate.
 * Searches BFS style up to distance 4.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {{x: number, y: number}} cratePos - Position of the crate.
 * @returns {{x: number, y: number}|null} Goal tile.
 */
export function findClearCrateCapableTile(beliefs, cratePos) {
    if (!beliefs.map) return null;

    const neighborsOfCrate = beliefs.map.getNeighbors(cratePos);
    const queue = [];
    const visited = new Set([`${cratePos.x},${cratePos.y}`]);

    for (const n of neighborsOfCrate) {
        visited.add(`${n.x},${n.y}`);
        queue.push({ x: n.x, y: n.y, firstStep: n });
    }

    while (queue.length > 0) {
        const current = queue.shift();
        const dist = Math.abs(current.x - cratePos.x) + Math.abs(current.y - cratePos.y);
        if (dist > 4) continue;

        const code = beliefs.map.getTileCode(current.x, current.y);
        const isCrateCapable = (code === MapRepresentation.TILE_CODES.CRATE_SPAWN || code === MapRepresentation.TILE_CODES.CRATE);
        const hasOtherCrate = Array.from(beliefs.crates.values()).some(
            c => c.x === current.x && c.y === current.y && !(c.x === cratePos.x && c.y === cratePos.y)
        );
        const isAgentHere = (beliefs.me.x === current.x && beliefs.me.y === current.y);
        const isPeerHere = Array.from(beliefs.peers.values()).some(
            p => Math.round(p.x) === current.x && Math.round(p.y) === current.y
        );
        const isBlockedTarget = beliefs.blockedTargets.has(`${current.x},${current.y}`);

        if (isCrateCapable && !hasOtherCrate && !isAgentHere && !isPeerHere && !isBlockedTarget) {
            // Verify if agent can reach the push-position opposite to firstStep
            const dx = current.firstStep.x - cratePos.x;
            const dy = current.firstStep.y - cratePos.y;
            const agentPushTile = { x: cratePos.x - dx, y: cratePos.y - dy };

            if (beliefs.map.isWalkableTile(agentPushTile.x, agentPushTile.y)) {
                return { x: current.x, y: current.y };
            }
        }

        const neighbors = beliefs.map.getNeighbors(current);
        for (const n of neighbors) {
            const key = `${n.x},${n.y}`;
            if (!visited.has(key)) {
                visited.add(key);
                queue.push({ x: n.x, y: n.y, firstStep: current.firstStep });
            }
        }
    }
    return null;
}

/**
 * Attempts to find a direct push sequence locally using A* to navigate to the push-from position.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {{x: number, y: number}} crate - Crate location.
 * @param {{x: number, y: number}} targetTile - Destination tile for the crate.
 * @returns {Array<{x: number, y: number}>|null} Array of steps to execute the push, or null if blocked.
 */
export function solveObstaclePushLocally(beliefs, crate, targetTile) {
    if (!beliefs.map) return null;

    // Direction of push
    const dx = crate.x - targetTile.x;
    const dy = crate.y - targetTile.y;

    if (Math.abs(dx) + Math.abs(dy) !== 1) {
        return null;
    }

    const pushFromX = crate.x + dx;
    const pushFromY = crate.y + dy;

    // Verify pushFrom is walkable
    if (!beliefs.map.isWalkableTile(pushFromX, pushFromY)) {
        return null;
    }

    // Path to the push-from position treating the target crate as blocked.
    const path = (beliefs.me.x === pushFromX && beliefs.me.y === pushFromY)
        ? [{ x: pushFromX, y: pushFromY }]
        : findAStarPath(
            beliefs.map,
            { x: beliefs.me.x, y: beliefs.me.y },
            { x: pushFromX, y: pushFromY },
            beliefs.policyRules,
            beliefs
        );

    if (!path || path.length === 0) {
        return null;
    }

    // Map path to moves (excluding current position)
    const moves = path.slice(1).map(step => ({ x: step.x, y: step.y }));

    // Final move is onto the crate's current tile to execute the push
    moves.push({ x: crate.x, y: crate.y });

    return moves;
}

/**
 * Translates a parsed PDDL plan into simple grid moves.
 * @param {Array<Object>} pddlPlan - PDDL action steps.
 * @returns {Array<{x: number, y: number}>} Grid moves list.
 */
export function translatePddlPlanToMoves(pddlPlan) {
    const moves = [];
    for (const step of pddlPlan) {
        let targetTileStr = null;
        const actionLower = step.action.toLowerCase();
        if (actionLower.startsWith('move')) {
            targetTileStr = step.args[2];
        } else if (actionLower.startsWith('push')) {
            targetTileStr = step.args[3];
        }
        if (targetTileStr) {
            const parts = targetTileStr.split('_');
            const x = parseInt(parts[1], 10);
            const y = parseInt(parts[2], 10);
            moves.push({ x, y });
        }
    }
    return moves;
}

/**
 * Checks if the path to a goal is blocked by a crate and attempts to resolve via
 * local push solving or PDDL solver. Returns the PDDL moves if found.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {Object} bestGoal - The target goal.
 * @param {Object} engineState - Engine state containing failedPddlSolves, blockedDeliveryZones, blockedTargets.
 * @returns {Promise<Array<{x: number, y: number}>|null>} PDDL moves or null.
 */
export async function resolveCrateBlockedPath(beliefs, bestGoal, engineState) {
    if (!beliefs.map) return null;
    if (bestGoal.x === null || bestGoal.y === null) return null;

    const pathNormal = findAStarPath(
        beliefs.map,
        { x: beliefs.me.x, y: beliefs.me.y },
        { x: bestGoal.x, y: bestGoal.y },
        beliefs.policyRules,
        beliefs
    );
    if (pathNormal && pathNormal.length >= 1) return null; // Path exists (or agent already at goal), no crate blocking

    // Identify unpushable crates (crates that have failed PDDL solve recently, within 30s)
    const unpushableCrates = new Map();
    if (beliefs.crates && engineState.failedPddlSolves) {
        const now = Date.now();
        for (const [cId, crate] of beliefs.crates.entries()) {
            const cratePrefix = `${crate.x},${crate.y}->`;
            const crateKeyExact = `${crate.x},${crate.y}`;
            let hasRecentFail = false;
            for (const [key, ts] of engineState.failedPddlSolves.entries()) {
                if ((key === crateKeyExact || key.startsWith(cratePrefix)) && (now - ts < 30000)) {
                    hasRecentFail = true;
                    break;
                }
            }
            if (hasRecentFail) {
                unpushableCrates.set(cId, crate);
            }
        }
    }

    // Find path ignoring all pushable crates, but treating unpushable/recently-failed crates as walls.
    const pathIgnoreCrates = findAStarPath(
        beliefs.map,
        { x: beliefs.me.x, y: beliefs.me.y },
        { x: bestGoal.x, y: bestGoal.y },
        beliefs.policyRules,
        { crates: unpushableCrates }
    );

    // If no path exists even when ignoring pushable crates (i.e. blocked by unpushable ones), block the goal.
    if (!pathIgnoreCrates || pathIgnoreCrates.length < 2) {
        if (pathIgnoreCrates && pathIgnoreCrates.length === 1) {
            return null; // Already at goal, no crate blocking
        }
        _blockGoal(beliefs, bestGoal, engineState);
        return null;
    }

    // Find the first crate along this path (which is guaranteed not to be in unpushableCrates)
    let firstCrate = null;
    for (const step of pathIgnoreCrates) {
        const crate = Array.from(beliefs.crates.values()).find(
            c => c.x === step.x && c.y === step.y && !unpushableCrates.has(c.id)
        );
        if (crate) {
            firstCrate = crate;
            break;
        }
    }
    if (!firstCrate) return null;

    // Check if we recently failed to solve for this crate
    const targetTile = findClearCrateCapableTile(beliefs, firstCrate);
    const pddlKey = targetTile
        ? `${firstCrate.x},${firstCrate.y}->${targetTile.x},${targetTile.y}`
        : `${firstCrate.x},${firstCrate.y}->null`;
    const lastFail = engineState.failedPddlSolves.get(pddlKey);
    const pddlCooldownMs = 1000; // 1s cooldown

    if (lastFail && (Date.now() - lastFail) < pddlCooldownMs) {
        const lastLogKey = `log_${pddlKey}`;
        const lastLogTime = engineState.failedPddlSolves.get(lastLogKey) || 0;
        if (Date.now() - lastLogTime > 5000) {
            console.log(`[PDDL Throttle] Skipping solver for crate at (${firstCrate.x}, ${firstCrate.y}) — failed ${((Date.now() - lastFail) / 1000).toFixed(1)}s ago (cooldown: ${pddlCooldownMs / 1000}s).`);
            engineState.failedPddlSolves.set(lastLogKey, Date.now());
        }
        return null;
    }

    if (!targetTile) {
        engineState.failedPddlSolves.set(pddlKey, Date.now());
        return null;
    }

    console.log(`[PDDL Trigger] Path to goal (${bestGoal.x}, ${bestGoal.y}) blocked by crate at (${firstCrate.x}, ${firstCrate.y}). Resolving push to (${targetTile.x}, ${targetTile.y}).`);

    // Try local push solver first (0ms, no block)
    const localMoves = solveObstaclePushLocally(beliefs, firstCrate, targetTile);
    if (localMoves && localMoves.length > 0) {
        console.log(`[BDI Plan] Found local push plan of ${localMoves.length} steps. Executing without PDDL solver.`);
        return localMoves;
    }

    console.log(`[BDI Plan] Local push solver failed or blocked. Falling back to PDDL solver...`);
    const bridge = new PddlServiceBridge();
    const pddlPlan = await bridge.solveObstaclePush(
        beliefs.map,
        beliefs,
        firstCrate,
        targetTile
    );
    if (pddlPlan && pddlPlan.length > 0) {
        return translatePddlPlanToMoves(pddlPlan);
    }

    console.log(`[PDDL] Solver failed. Recording cooldown for key: ${pddlKey}`);
    console.log(`[PDDL Debug] Target Crate: (${firstCrate.x}, ${firstCrate.y}), Target Goal: (${targetTile.x}, ${targetTile.y})`);
    console.log(`[PDDL Debug] Agent position: (${beliefs.me.x}, ${beliefs.me.y})`);
    const peersStr = Array.from(beliefs.peers.values()).map(p => `(${Math.round(p.x)}, ${Math.round(p.y)})`).join(', ');
    console.log(`[PDDL Debug] Peers: [${peersStr}]`);
    const cratesStr = Array.from(beliefs.crates.values()).map(c => `(${c.x}, ${c.y})`).join(', ');
    console.log(`[PDDL Debug] Crates: [${cratesStr}]`);
    
    engineState.failedPddlSolves.set(pddlKey, Date.now());
    return null;
}

/**
 * Blocks a goal target temporarily due to impassable crate.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Agent beliefs.
 * @param {Object} bestGoal - Goal to block.
 * @param {Object} engineState - Engine state.
 * @private
 */
function _blockGoal(beliefs, bestGoal, engineState) {
    console.log(`[BDI Block] Goal (${bestGoal.x}, ${bestGoal.y}) blocked by unpushable crate (or solver failed). Temporarily blocking target.`);
    const blockKey = `${bestGoal.x},${bestGoal.y}`;
    beliefs.blockedTargets.set(blockKey, Date.now());
    if (bestGoal.targetId) {
        beliefs.blockedTargets.set(bestGoal.targetId, Date.now());
    }
    if (bestGoal.type === 'deliver') {
        engineState.blockedDeliveryZones.set(blockKey, Date.now());
    }
}

/**
 * Simple recipe generator to execute PDDL movements.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Agent beliefs.
 * @param {Array<{x: number, y: number}>} moves - Steps list.
 * @yields {Object} Yields move actions.
 */
export function* executePddlPlanRecipe(beliefs, moves) {
    if (moves.length === 0) return;

    // The PDDL solver is async; the agent may have moved while we waited.
    // Navigate to the first PDDL step using A* if we're not already adjacent.
    const firstStep = moves[0];
    if (beliefs.me.x !== firstStep.x || beliefs.me.y !== firstStep.y) {
        if (beliefs.map && !beliefs.map.isAdjacent(beliefs.me, firstStep)) {
            console.log(`[BDI PDDL] Agent at (${beliefs.me.x}, ${beliefs.me.y}) not adjacent to first PDDL step (${firstStep.x}, ${firstStep.y}). Using A* to navigate there.`);
            yield* NavigateTo(beliefs, firstStep.x, firstStep.y);

            // Verify we reached the target
            if (Math.round(beliefs.me.x) !== firstStep.x || Math.round(beliefs.me.y) !== firstStep.y) {
                console.log(`[BDI PDDL] Failed to reach first PDDL step. Aborting recipe.`);
                return;
            }
        }
    }

    let i = 0;
    for (const step of moves) {
        // Skip steps where we're already at the target (e.g., after a crate push)
        if (Math.round(beliefs.me.x) === step.x && Math.round(beliefs.me.y) === step.y) {
            i++;
            continue;
        }

        // Pre-check adjacency to abort early if PDDL plan is out of sync
        if (beliefs.map && !beliefs.map.isAdjacent(beliefs.me, step)) {
            console.log(`[BDI PDDL] Step (${step.x}, ${step.y}) not adjacent to agent at (${beliefs.me.x}, ${beliefs.me.y}). Aborting recipe.`);
            break;
        }

        beliefs.me.nextStep = step;
        beliefs.me.path = moves.slice(i);

        const success = yield { action: 'move', target: step };
        if (!success) {
            console.log(`[BDI PDDL] Move to (${step.x}, ${step.y}) failed, aborting PDDL recipe.`);
            break;
        }
        i++;
    }
    beliefs.me.nextStep = null;
    beliefs.me.path = [];
}
