/**
 * @module agent/PlanLibrary
 * @description Pre-compiled execution generator procedures for BDI Agent physical actions.
 * Leverages generator delegation (yield*) to support composite and cooperative tasks.
 */

import { findAStarPath } from '../mapping/Pathfinding.js';

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
 * Helper to locate the nearest delivery zone from coordinates.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {number} fromX - X coordinate.
 * @param {number} fromY - Y coordinate.
 * @param {Map<string, number>} [blockedZones=null] - Optional map of "x,y" -> timestamp for zones to skip.
 * @returns {{x: number, y: number}|null} Coordinates of the nearest delivery zone.
 */
export function findNearestDeliveryZone(beliefs, fromX, fromY, blockedZones = null) {
    if (!beliefs.map) return null;
    let bestZone = null;
    let minDistance = Infinity;
    const now = Date.now();

    for (let x = 0; x < beliefs.map.width; x++) {
        for (let y = 0; y < beliefs.map.height; y++) {
            // TILE_CODES.DELIVERY is 2
            if (beliefs.map.getTileCode(x, y) === 2) {
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
            // TILE_CODES.SPAWN is 1
            if (beliefs.map.getTileCode(x, y) === 1) {
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
    const isOnSpawn = (currentTileCode === 1); // TILE_CODES.SPAWN is 1

    if (!isOnSpawn) {
        // If not on spawn, head to the nearest one
        return findNearestSpawnZone(beliefs, fromX, fromY);
    }

    // If already on spawn, look for a far spawn zone to patrol
    const allZones = [];
    for (let x = 0; x < beliefs.map.width; x++) {
        for (let y = 0; y < beliefs.map.height; y++) {
            if (beliefs.map.getTileCode(x, y) === 1) {
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
 * Generator that routes the agent to a target coordinate.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {number} targetX - Target X coordinate.
 * @param {number} targetY - Target Y coordinate.
 * @yields {Object} Yields move action steps.
 */
export function* NavigateTo(beliefs, targetX, targetY) {
    if (!beliefs.map) return false;

    // Ensure target coordinates are whole integers within map bounds
    targetX = Math.round(targetX);
    targetY = Math.round(targetY);
    targetX = Math.max(0, Math.min(targetX, beliefs.map.width - 1));
    targetY = Math.max(0, Math.min(targetY, beliefs.map.height - 1));

    if (Math.round(beliefs.me.x) === targetX && Math.round(beliefs.me.y) === targetY) {
        beliefs.me.nextStep = null;
        beliefs.me.path = [];
        return true;
    }

    let path = findAStarPath(
        beliefs.map,
        { x: beliefs.me.x, y: beliefs.me.y },
        { x: targetX, y: targetY },
        beliefs.policyRules,
        beliefs
    );

    if (!path || path.length < 2) {
        const tileCode = beliefs.map.getTileCode(targetX, targetY);
        // Do not block delivery (2) or spawn (1) zones
        if (tileCode !== 1 && tileCode !== 2) {
            beliefs.blockedTargets.set(`${targetX},${targetY}`, Date.now());
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
                { x: targetX, y: targetY },
                beliefs.policyRules,
                beliefs
            );
            if (!path || path.length < 2) {
                const tileCode = beliefs.map.getTileCode(targetX, targetY);
                if (tileCode !== 1 && tileCode !== 2) {
                    beliefs.blockedTargets.set(`${targetX},${targetY}`, Date.now());
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
                { x: targetX, y: targetY },
                beliefs.policyRules,
                beliefs
            );
            if (!path || path.length < 2) {
                const tileCode = beliefs.map.getTileCode(targetX, targetY);
                if (tileCode !== 1 && tileCode !== 2) {
                    beliefs.blockedTargets.set(`${targetX},${targetY}`, Date.now());
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

    // 3. Navigate to nearest delivery zone and deliver
    const zone = findNearestDeliveryZone(beliefs, beliefs.me.x, beliefs.me.y);
    if (zone) {
        const reachedZone = yield* NavigateTo(beliefs, zone.x, zone.y);
        if (reachedZone) {
            // Only drop if we actually reached a delivery zone tile (tile code 2)
            if (beliefs.map && beliefs.map.getTileCode(beliefs.me.x, beliefs.me.y) === 2) {
                yield { action: 'putdown' };
            }
        }
    }
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
