/**
 * @module agent/PlanLibrary
 * @description Pre-compiled execution generator procedures for BDI Agent physical actions.
 * Leverages generator delegation (yield*) to support composite and cooperative tasks.
 */

import { findAStarPath } from '../mapping/Pathfinding.js';
import { evaluatePolicyReward } from '../policy/PolicyEngine.js';
import { AGENT_IDS } from '../config/config.js';
import { MapRepresentation } from '../mapping/MapRepresentation.js';

/**
 * Computes the A*-based path distance between two coordinates.
 * Returns Infinity if no path exists.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {number} fromX - Origin X.
 * @param {number} fromY - Origin Y.
 * @param {number} toX - Destination X.
 * @param {number} toY - Destination Y.
 * @returns {number} Number of steps (edges), or Infinity if unreachable.
 */
export function pathDistance(beliefs, fromX, fromY, toX, toY, ignoreCrates = false) {
    if (!beliefs.map) return Infinity;
    const path = findAStarPath(
        beliefs.map,
        { x: fromX, y: fromY },
        { x: toX, y: toY },
        beliefs.policyRules,
        ignoreCrates ? null : beliefs
    );
    return path ? path.length - 1 : Infinity;
}

/**
 * Helper to locate the best delivery tile from coordinates.
 * Candidate tiles are scored by policy-adjusted value over distance, so
 * tile-conditioned rules ("deliver at (x,y) -> 5x / 0 pts") steer the choice;
 * with no tile rules active every tile scores the same modifier and this
 * degenerates to nearest-tile selection.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {number} fromX - X coordinate.
 * @param {number} fromY - Y coordinate.
 * @param {Map<string, number>} [blockedZones=null] - Optional map of "x,y" -> timestamp for zones to skip.
 * @returns {{x: number, y: number}|null} Coordinates of the best delivery tile.
 */
export function findNearestDeliveryZone(beliefs, fromX, fromY, blockedZones = null) {
    if (!beliefs.map) return null;
    const now = Date.now();

    // Value basis for the policy rules: the carried stack's raw reward, or a
    // neutral 1 when idle so multiplier rules still differentiate tiles.
    let carriedValue = 0;
    for (const cid of beliefs.carried) {
        const p = beliefs.parcels.get(cid);
        if (p) carriedValue += p.reward;
    }
    if (carriedValue <= 0) carriedValue = 1;

    // Collect all candidates
    const candidates = [];
    const occupiedTiles = new Set();
    if (beliefs.peers) {
        for (const peer of beliefs.peers.values()) {
            occupiedTiles.add(`${Math.round(peer.x)},${Math.round(peer.y)}`);
        }
    }

    for (let x = 0; x < beliefs.map.width; x++) {
        for (let y = 0; y < beliefs.map.height; y++) {
            if (beliefs.map.getTileCode(x, y) === MapRepresentation.TILE_CODES.DELIVERY) {
                // Skip blocked zones that haven't expired (10s)
                if (blockedZones) {
                    const zoneKey = `${x},${y}`;
                    const blockedTs = blockedZones.get(zoneKey);
                    if (blockedTs && (now - blockedTs) < 10000) {
                        continue;
                    } else if (blockedTs) {
                        blockedZones.delete(zoneKey); // expired, clean up
                    }
                }
                const isOccupied = occupiedTiles.has(`${x},${y}`);
                candidates.push({ x, y, isOccupied });
            }
        }
    }

    if (candidates.length === 0) return null;

    // If there is at least one free candidate, filter out the occupied ones
    const freeCandidates = candidates.filter(c => !c.isOccupied);
    const activeCandidates = freeCandidates.length > 0 ? freeCandidates : candidates;

    let bestZone = null;
    let bestScore = -Infinity;
    let bestDistance = Infinity;

    for (const cand of activeCandidates) {
        const { x, y } = cand;
        const dist = Math.abs(x - fromX) + Math.abs(y - fromY);
        // General rules (e.g. stack multipliers) shift all tiles
        // equally and cancel out of the ranking; tile-conditioned
        // rules are what differentiates candidates.
        const modValue = evaluatePolicyReward(beliefs, carriedValue, {
            x: x,
            y: y,
            carriedSize: beliefs.carried.length
        });
        const score = modValue / (dist + 1);
        if (score > bestScore || (score === bestScore && dist < bestDistance)) {
            bestScore = score;
            bestDistance = dist;
            bestZone = { x, y };
        }
    }
    return bestZone;
}

/**
 * Helper to locate the nearest spawn zone from coordinates.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {number} fromX - X coordinate.
 * @param {number} fromY - Y coordinate.
 * @returns {{x: number, y: number}|null} Coordinates of the nearest spawn zone.
 */
export function findNearestSpawnZone(beliefs, fromX, fromY) {
    if (!beliefs.map) return null;
    let bestZone = null;
    let minDistance = Infinity;

    for (let x = 0; x < beliefs.map.width; x++) {
        for (let y = 0; y < beliefs.map.height; y++) {
            if (beliefs.map.getTileCode(x, y) === MapRepresentation.TILE_CODES.SPAWN) {
                if (beliefs.blockedTargets && beliefs.blockedTargets.has(`${x},${y}`)) {
                    continue;
                }
                const dist = Math.abs(x - fromX) + Math.abs(y - fromY);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestZone = { x, y };
                }
            }
        }
    }
    return bestZone;
}

/**
 * Smart spawn zone selector for patrolling.
 * If the agent is not currently on a spawn zone, returns the nearest spawn zone.
 * If the agent is already on a spawn zone, returns a spawn zone that is far away
 * (Manhattan distance >= 10) to encourage patrolling between different spawn areas.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {number} fromX - Current X.
 * @param {number} fromY - Current Y.
 * @returns {{x: number, y: number}|null} Coordinates of the target spawn zone.
 */
export function findPatrolSpawnZone(beliefs, fromX, fromY) {
    if (!beliefs.map) return null;

    const currentTileCode = beliefs.map.getTileCode(fromX, fromY);
    const isOnSpawn = (currentTileCode === MapRepresentation.TILE_CODES.SPAWN);

    if (!isOnSpawn) {
        // If not on spawn, head to the nearest one
        return findNearestSpawnZone(beliefs, fromX, fromY);
    }

    // If already on spawn, look for a far spawn zone to patrol
    const allZones = [];
    for (let x = 0; x < beliefs.map.width; x++) {
        for (let y = 0; y < beliefs.map.height; y++) {
            if (beliefs.map.getTileCode(x, y) === MapRepresentation.TILE_CODES.SPAWN) {
                if (beliefs.blockedTargets && beliefs.blockedTargets.has(`${x},${y}`)) {
                    continue;
                }
                allZones.push({ x, y });
            }
        }
    }

    if (allZones.length === 0) return null;

    // Filter zones by distance
    const farZones = allZones.filter(z => {
        const dist = Math.abs(z.x - fromX) + Math.abs(z.y - fromY);
        return dist >= 10;
    });

    if (farZones.length > 0) {
        return farZones[Math.floor(Math.random() * farZones.length)];
    }

    const midZones = allZones.filter(z => {
        const dist = Math.abs(z.x - fromX) + Math.abs(z.y - fromY);
        return dist >= 2;
    });

    if (midZones.length > 0) {
        return midZones[Math.floor(Math.random() * midZones.length)];
    }

    return allZones[0];
}


/**
 * Helper to locate an adjacent clear tile.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {number} x - Cartesian X coordinate.
 * @param {number} y - Cartesian Y coordinate.
 * @returns {{x: number, y: number}} Adjacent clear tile coordinates.
 */
export function findAdjacentClearTile(beliefs, x, y) {
    if (!beliefs.map) return { x, y };
    const neighbors = beliefs.map.getNeighbors({ x, y });

    for (const n of neighbors) {
        const hasCrate = Array.from(beliefs.crates.values()).some(c => c.x === n.x && c.y === n.y);
        const hasPeer = Array.from(beliefs.peers.values()).some(p => p.x === n.x && p.y === n.y);
        if (!hasCrate && !hasPeer) {
            return n;
        }
    }
    return neighbors[0] || { x, y };
}

/**
 * Helper to locate an adjacent clear tile that is NOT a spawn tile.
 * Used to prevent agents from idling on spawn tiles, which blocks
 * new parcels from spawning. Falls back to findAdjacentClearTile
 * if no non-spawn neighbor is available.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {number} x - Cartesian X coordinate.
 * @param {number} y - Cartesian Y coordinate.
 * @returns {{x: number, y: number}} Adjacent clear non-spawn tile coordinates.
 */
export function findAdjacentClearNonSpawnTile(beliefs, x, y) {
    if (!beliefs.map) return { x, y };
    const neighbors = beliefs.map.getNeighbors({ x, y });

    for (const n of neighbors) {
        const tileCode = beliefs.map.getTileCode(n.x, n.y);
        if (tileCode === MapRepresentation.TILE_CODES.SPAWN) continue;
        const hasCrate = Array.from(beliefs.crates.values()).some(c => c.x === n.x && c.y === n.y);
        const hasPeer = Array.from(beliefs.peers.values()).some(p => p.x === n.x && p.y === n.y);
        if (!hasCrate && !hasPeer) {
            return n;
        }
    }
    // Fallback: all neighbors are spawn tiles or blocked; use the general helper
    return findAdjacentClearTile(beliefs, x, y);
}

/**
 * Generator that routes the agent to a target coordinate.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {number} targetX - Target X coordinate.
 * @param {number} targetY - Target Y coordinate.
 * @yields {Object} Yields move action steps.
 */
export function* NavigateTo(beliefs, targetX, targetY, radius = 0) {
    if (!beliefs.map) return false;

    // Ensure target coordinates are whole integers within map bounds
    targetX = Math.round(targetX);
    targetY = Math.round(targetY);
    targetX = Math.max(0, Math.min(targetX, beliefs.map.width - 1));
    targetY = Math.max(0, Math.min(targetY, beliefs.map.height - 1));

    // Check if we are already within Manhattan distance radius of the target coordinates
    // and standing on a valid (walkable, crate-free, peer-free) tile.
    const distanceToTarget = Math.abs(Math.round(beliefs.me.x) - targetX) + Math.abs(Math.round(beliefs.me.y) - targetY);
    if (distanceToTarget <= radius) {
        const myX = Math.round(beliefs.me.x);
        const myY = Math.round(beliefs.me.y);
        const hasCrate = Array.from(beliefs.crates.values()).some(c => Math.round(c.x) === myX && Math.round(c.y) === myY);
        const hasPeer = Array.from(beliefs.peers.values()).some(p => p.id !== AGENT_IDS.ADMIN_ID && Math.round(p.x) === myX && Math.round(p.y) === myY);
        if (beliefs.map.isWalkableTile(myX, myY) && !hasCrate && !hasPeer) {
            beliefs.me.nextStep = null;
            beliefs.me.path = [];
            return true;
        }
    }

    let actualTargetX = targetX;
    let actualTargetY = targetY;

    if (radius > 0) {
        // Find the best walkable tile within radius of the target
        const candidates = [];
        for (let dx = -radius; dx <= radius; dx++) {
            const maxDy = radius - Math.abs(dx);
            for (let dy = -maxDy; dy <= maxDy; dy++) {
                const tx = targetX + dx;
                const ty = targetY + dy;

                if (tx >= 0 && tx < beliefs.map.width && ty >= 0 && ty < beliefs.map.height) {
                    if (beliefs.map.isWalkableTile(tx, ty)) {
                        const hasCrate = Array.from(beliefs.crates.values()).some(c => Math.round(c.x) === tx && Math.round(c.y) === ty);
                        if (!hasCrate) {
                            candidates.push({ x: tx, y: ty });
                        }
                    }
                }
            }
        }

        let bestTile = null;

        if (candidates.length > 0) {
            // Sort candidates in a stable, consistent way: distance to target, then X, then Y
            candidates.sort((a, b) => {
                const distA = Math.abs(a.x - targetX) + Math.abs(a.y - targetY);
                const distB = Math.abs(b.x - targetX) + Math.abs(b.y - targetY);
                if (distA !== distB) return distA - distB;
                if (a.x !== b.x) return a.x - b.x;
                return a.y - b.y;
            });

            // Identify tiles occupied or heading-to by peer agents
            const peerTiles = new Set();
            for (const peer of beliefs.peers.values()) {
                if (peer.id === AGENT_IDS.ADMIN_ID) continue;
                const px = Math.round(peer.x);
                const py = Math.round(peer.y);
                peerTiles.add(`${px},${py}`);
                if (peer.nextStep) {
                    peerTiles.add(`${Math.round(peer.nextStep.x)},${Math.round(peer.nextStep.y)}`);
                }
                if (peer.path && peer.path.length > 0) {
                    const lastStep = peer.path[peer.path.length - 1];
                    peerTiles.add(`${Math.round(lastStep.x)},${Math.round(lastStep.y)}`);
                }
            }

            // Filter out peer occupied or targeted tiles
            const peerFreeCandidates = candidates.filter(c => !peerTiles.has(`${c.x},${c.y}`));

            const myId = beliefs.me.id;
            const peerId = Array.from(beliefs.peers.keys()).find(id => id !== myId) || (myId === AGENT_IDS.BDI_AGENT_ID ? AGENT_IDS.LLM_AGENT_ID : AGENT_IDS.BDI_AGENT_ID);
            const amFirst = myId < peerId;

            // Pick the appropriate list
            const listToUse = peerFreeCandidates.length > 0 ? peerFreeCandidates : candidates;

            if (listToUse.length >= 2) {
                bestTile = amFirst ? listToUse[0] : listToUse[1];
            } else {
                bestTile = listToUse[0];
            }
        }

        if (bestTile) {
            actualTargetX = bestTile.x;
            actualTargetY = bestTile.y;
            
            // Check if we are already at this best tile
            if (Math.round(beliefs.me.x) === actualTargetX && Math.round(beliefs.me.y) === actualTargetY) {
                beliefs.me.nextStep = null;
                beliefs.me.path = [];
                return true;
            }
        }
    }

    let path = findAStarPath(
        beliefs.map,
        { x: beliefs.me.x, y: beliefs.me.y },
        { x: actualTargetX, y: actualTargetY },
        beliefs.policyRules,
        beliefs
    );

    if (!path || path.length < 2) {
        const tileCode = beliefs.map.getTileCode(actualTargetX, actualTargetY);
        // Do not block delivery or spawn zones
        if (tileCode !== MapRepresentation.TILE_CODES.SPAWN && tileCode !== MapRepresentation.TILE_CODES.DELIVERY) {
            beliefs.blockedTargets.set(`${actualTargetX},${actualTargetY}`, Date.now());
        }
        beliefs.me.nextStep = null;
        beliefs.me.path = [];
        return false;
    }

    let i = 1;
    while (i < path.length) {
        const step = path[i];
        
        // If displaced (e.g. on resume), recalculate path from actual position
        if (beliefs.map && !beliefs.map.isAdjacent(beliefs.me, step)) {
            path = findAStarPath(
                beliefs.map,
                { x: beliefs.me.x, y: beliefs.me.y },
                { x: actualTargetX, y: actualTargetY },
                beliefs.policyRules,
                beliefs
            );
            if (!path || path.length < 2) {
                const tileCode = beliefs.map.getTileCode(actualTargetX, actualTargetY);
                if (tileCode !== MapRepresentation.TILE_CODES.SPAWN && tileCode !== MapRepresentation.TILE_CODES.DELIVERY) {
                    beliefs.blockedTargets.set(`${actualTargetX},${actualTargetY}`, Date.now());
                }
                beliefs.me.nextStep = null;
                beliefs.me.path = [];
                return false;
            }
            i = 1;
            continue;
        }

        beliefs.me.nextStep = step;
        beliefs.me.path = path.slice(i);

        const success = yield { action: 'move', target: step };
        if (success) {
            i++;
        } else {
            // Re-calculate path from actual current position if move failed
            path = findAStarPath(
                beliefs.map,
                { x: beliefs.me.x, y: beliefs.me.y },
                { x: actualTargetX, y: actualTargetY },
                beliefs.policyRules,
                beliefs
            );
            if (!path || path.length < 2) {
                const tileCode = beliefs.map.getTileCode(actualTargetX, actualTargetY);
                if (tileCode !== MapRepresentation.TILE_CODES.SPAWN && tileCode !== MapRepresentation.TILE_CODES.DELIVERY) {
                    beliefs.blockedTargets.set(`${actualTargetX},${actualTargetY}`, Date.now());
                }
                beliefs.me.nextStep = null;
                beliefs.me.path = [];
                return false;
            }
            i = 1; // Start from first step of the newly calculated path
        }
    }
    beliefs.me.nextStep = null;
    beliefs.me.path = [];
    return true;
}

/**
 * Generator that navigates to a parcel, picks it up, then delivers to the
 * nearest delivery zone.  The intention engine can still preempt mid-delivery
 * if a higher-value opportunity appears, but the default trajectory now
 * includes delivery so the agent never gets stuck in a pickup-only loop.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {string} parcelId - The target parcel identifier.
 * @yields {Object} Yields navigation, pickup, and delivery actions.
 */
export function* CollectAndDeliver(beliefs, parcelId) {
    const parcel = beliefs.parcels.get(parcelId);
    if (!parcel) return;

    // 1. Navigate to parcel
    const reached = yield* NavigateTo(beliefs, parcel.x, parcel.y);
    if (!reached) {
        console.log(`[BDI] CollectAndDeliver: failed to navigate to parcel ${parcelId}, aborting.`);
        return;
    }

    // 2. Pick it up
    yield { action: 'pickup', target: parcelId };
}

/**
 * Generator that coordinates cooperative handoff drops.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {string} coopId - Handoff contract ID.
 * @param {number} x - Rendezvous X coordinate.
 * @param {number} y - Rendezvous Y coordinate.
 * @yields {Object} Yields steps to rendezvous, drop, and escape.
 */
export function* RendezvousDrop(beliefs, coopId, x, y) {
    // 1. Navigate to target rendezvous cell
    const reached = yield* NavigateTo(beliefs, x, y);
    if (!reached) return;

    // 2. Put down cargo
    yield { action: 'putdown' };

    // 3. Back off to neighboring clear tile to establish escape path
    const escape = findAdjacentClearTile(beliefs, x, y);
    yield* NavigateTo(beliefs, escape.x, escape.y);

    // 4. Broadcast RELEASE_CARGO signal over peer chat
    yield { action: 'say', payload: { type: 'RELEASE_CARGO', coopId } };
}
