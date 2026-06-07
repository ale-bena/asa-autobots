/**
 * @module mapping/Pathfinding
 * @description Implements A* graph search algorithm with Manhattan heuristics,
 * incorporating policy tile avoidance penalties and dynamic obstacles (crates).
 */

import { PATHFINDING_CONFIG } from '../config/config.js';

/**
 * Calculates Manhattan distance heuristic between two cells.
 * @param {{x: number, y: number}} a - First node.
 * @param {{x: number, y: number}} b - Second node.
 * @returns {number} Manhattan distance.
 */
function heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Standard A* search algorithm returning an array of coordinates representing the shortest path.
 * @param {import('./MapRepresentation.js').MapRepresentation} map - Map configuration.
 * @param {{x: number, y: number}} start - Start coordinate.
 * @param {{x: number, y: number}} goal - Destination coordinate.
 * @param {Object} [policy=null] - Dynamic behavioral policy rules.
 * @param {Object} [beliefs=null] - Agent belief base containing dynamic obstacles.
 * @returns {Array<{x: number, y: number}>|null} Array of steps from start (inclusive) to goal (inclusive), or null if unreachable.
 */
export function findAStarPath(map, start, goal, policy = null, beliefs = null) {
    // If start is same as goal, return trivial single-node path.
    if (start.x === goal.x && start.y === goal.y) {
        return [start];
    }

    const startKey = `${start.x},${start.y}`;
    const openSet = [start];
    const cameFrom = new Map();

    const gScore = new Map();
    gScore.set(startKey, 0);

    const fScore = new Map();
    fScore.set(startKey, heuristic(start, goal));

    const avoidTiles = new Set(policy && policy.avoidTiles ? policy.avoidTiles : []);

    // Create a fast lookup set of coordinates occupied by dynamic crates or peer agents.
    const crateTiles = new Set();
    if (beliefs && beliefs.crates) {
        for (const crate of beliefs.crates.values()) {
            crateTiles.add(`${crate.x},${crate.y}`);
        }
    }
    // NOTE: blockedTargets are NOT added to crateTiles here.
    // They represent temporarily blocked *goals* (delivery/spawn zones), not physical obstacles.
    // Treating them as hard blocks would prevent pathfinding to delivery zones entirely.

    const peerTiles = new Set();
    const peerNextTiles = new Set();
    const peerPathTiles = new Set();

    if (beliefs && beliefs.peers) {
        for (const peer of beliefs.peers.values()) {
            const px = Math.round(peer.x);
            const py = Math.round(peer.y);
            peerTiles.add(`${px},${py}`);

            if (peer.nextStep) {
                const npx = Math.round(peer.nextStep.x);
                const npy = Math.round(peer.nextStep.y);
                peerNextTiles.add(`${npx},${npy}`);
            }

            if (peer.path && Array.isArray(peer.path)) {
                for (const step of peer.path.slice(0, 5)) {
                    const spx = Math.round(step.x);
                    const spy = Math.round(step.y);
                    peerPathTiles.add(`${spx},${spy}`);
                }
            }
        }
    }

    while (openSet.length > 0) {
        // Sort openSet by fScore (lowest first) to fetch best node.
        openSet.sort((a, b) => {
            const fA = fScore.get(`${a.x},${a.y}`) ?? Infinity;
            const fB = fScore.get(`${b.x},${b.y}`) ?? Infinity;
            return fA - fB;
        });

        const current = openSet.shift();
        const currentKey = `${current.x},${current.y}`;

        // Reconstruct path if goal is reached.
        if (current.x === goal.x && current.y === goal.y) {
            const path = [current];
            let temp = currentKey;
            while (cameFrom.has(temp)) {
                const step = cameFrom.get(temp);
                path.unshift(step);
                temp = `${step.x},${step.y}`;
            }
            return path;
        }

        const neighbors = map.getNeighbors(current);

        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.x},${neighbor.y}`;

            // Treat tiles containing crates as blocked.
            const hasCrate = crateTiles.has(neighborKey);
            if (hasCrate) {
                continue;
            }

            const isGoal = neighbor.x === goal.x && neighbor.y === goal.y;

            // Treat intermediate blocked targets as blocked.
            const isBlockedTarget = beliefs && beliefs.blockedTargets && beliefs.blockedTargets.has(neighborKey);
            if (isBlockedTarget && !isGoal) {
                continue;
            }

            // Calculate cost to neighbor.
            let stepCost = 1;
            if (!isGoal) {
                if (peerTiles.has(neighborKey)) {
                    stepCost += 30;
                } else if (peerNextTiles.has(neighborKey)) {
                    stepCost += 20;
                } else if (peerPathTiles.has(neighborKey)) {
                    stepCost += 10;
                }
            }
            if (avoidTiles.has(neighborKey)) {
                stepCost += PATHFINDING_CONFIG.AVOID_TILE_PENALTY;
            }

            const tentativeGScore = (gScore.get(currentKey) ?? Infinity) + stepCost;

            if (tentativeGScore < (gScore.get(neighborKey) ?? Infinity)) {
                cameFrom.set(neighborKey, current);
                gScore.set(neighborKey, tentativeGScore);
                fScore.set(neighborKey, tentativeGScore + heuristic(neighbor, goal));

                if (!openSet.some(node => node.x === neighbor.x && node.y === neighbor.y)) {
                    openSet.push(neighbor);
                }
            }
        }
    }

    return null; // No path found.
}
