/**
 * @module agent/PlanLibrary
 * @description Pre-compiled execution generator procedures for BDI Agent physical actions.
 * Leverages generator delegation (yield*) to support composite and cooperative tasks.
 */

import { findAStarPath } from '../mapping/Pathfinding.js';

/**
 * Helper to locate the nearest delivery zone from coordinates.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {number} fromX - X coordinate.
 * @param {number} fromY - Y coordinate.
 * @returns {{x: number, y: number}|null} Coordinates of the nearest delivery zone.
 */
export function findNearestDeliveryZone(beliefs, fromX, fromY) {
    if (!beliefs.map) return null;
    let bestZone = null;
    let minDistance = Infinity;

    for (let x = 0; x < beliefs.map.width; x++) {
        for (let y = 0; y < beliefs.map.height; y++) {
            // TILE_CODES.DELIVERY is 2
            if (beliefs.map.getTileCode(x, y) === 2) {
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
    if (!beliefs.map) return;

    const path = findAStarPath(
        beliefs.map,
        { x: beliefs.me.x, y: beliefs.me.y },
        { x: targetX, y: targetY },
        beliefs.policyRules,
        beliefs
    );

    if (!path || path.length < 2) return;

    for (let i = 1; i < path.length; i++) {
        const step = path[i];
        yield { action: 'move', target: step };
    }
}

/**
 * Generator that navigates to a parcel, picks it up, and delivers it.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {string} parcelId - The target parcel identifier.
 * @yields {Object} Yields navigation, pickup, and deliver actions.
 */
export function* CollectAndDeliver(beliefs, parcelId) {
    const parcel = beliefs.parcels.get(parcelId);
    if (!parcel) return;

    // 1. Move to parcel
    yield* NavigateTo(beliefs, parcel.x, parcel.y);

    // 2. Pickup parcel
    yield { action: 'pickup', target: parcelId };

    // 3. Find nearest delivery zone
    const zone = findNearestDeliveryZone(beliefs, beliefs.me.x, beliefs.me.y);
    if (!zone) return;

    // 4. Move to delivery zone
    yield* NavigateTo(beliefs, zone.x, zone.y);

    // 5. Deliver parcel (putdown)
    yield { action: 'putdown', target: parcelId };
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
    yield* NavigateTo(beliefs, x, y);

    // 2. Put down cargo
    yield { action: 'putdown' };

    // 3. Back off to neighboring clear tile to establish escape path
    const escape = findAdjacentClearTile(beliefs, x, y);
    yield* NavigateTo(beliefs, escape.x, escape.y);

    // 4. Broadcast RELEASE_CARGO signal over peer chat
    yield { action: 'say', payload: { type: 'RELEASE_CARGO', coopId } };
}
