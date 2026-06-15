/**
 * @module agent/ActionDispatcher
 * @description Action dispatch engine for the BDI agent. Handles physical move/pickup/putdown/say
 * actions, collision back-off (Tier 1/2), and performance tracking.
 */

import fs from 'fs';

/**
 * Determines the direction string between two adjacent coordinates.
 * @param {{x: number, y: number}} me - Agent current coordinate.
 * @param {{x: number, y: number}} target - Target coordinate.
 * @returns {"up"|"down"|"left"|"right"|null} Direction string.
 */
export function getDirection(me, target) {
    if (me.x < target.x) return 'right';
    if (me.x > target.x) return 'left';
    if (me.y < target.y) return 'up';
    if (me.y > target.y) return 'down';
    return null;
}

/**
 * Appends a structured JSON failure log entry to action_errors.log.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {Object} action - The action that failed.
 * @param {string} reason - The failure reason string.
 */
export function logActionFailure(beliefs, action, reason) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        agentId: beliefs.me.id,
        agentName: beliefs.me.name,
        position: { x: beliefs.me.x, y: beliefs.me.y },
        action: action,
        reason: reason,
        carried: beliefs.carried,
        lockedTargets: Array.from(beliefs.lockedTargets),
        peers: Array.from(beliefs.peers.entries()).map(([id, p]) => ({ id, x: p.x, y: p.y })),
        crates: Array.from(beliefs.crates.entries()).map(([id, c]) => ({ id, x: c.x, y: c.y })),
        map: beliefs.map ? { width: beliefs.map.width, height: beliefs.map.height } : null
    };
    try {
        fs.appendFileSync('action_errors.log', JSON.stringify(logEntry) + '\n', 'utf8');
    } catch (e) {
        console.error('[Logger] Failed to write action failure log:', e.message);
    }
}

/**
 * Dispatches the yielded action token to the simulation server socket.
 * @param {{action: string, target: any, payload: Object}} action - The action token.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {Object} socket - Deliveroo Socket.io client.
 * @param {Object} engineState - Mutable engine state for collision tracking, stats, etc.
 * @param {Function} getPeerAgentId - Function to resolve peer agent ID.
 * @param {Function} instantiatePlanRecipe - Function to reinstantiate current plan (for Tier 2 collisions).
 * @returns {Promise<boolean>} Whether the action succeeded.
 */
export async function dispatchAction(action, beliefs, socket, engineState, getPeerAgentId, instantiatePlanRecipe) {
    if (!action) return false;
    const startTime = Date.now();
    let success = false;

    switch (action.action) {
        case 'wait': {
            await new Promise(resolve => setTimeout(resolve, 100));
            success = true;
            break;
        }
        case 'move': {
            const target = action.target;
            if (!beliefs.map?.isAdjacent(beliefs.me, target)) {
                console.warn(`[BDI] Invalid move attempt to (${target.x}, ${target.y}) blocked by map constraints.`);
                success = false;
                break;
            }
            const dir = getDirection(beliefs.me, target);
            if (!dir) {
                success = false;
                break;
            }

            // Check for head-on collision (peer is on target tile, and peer's nextStep is our current position)
            const peerConflict = Array.from(beliefs.peers.values()).find(peer => {
                const px = Math.round(peer.x);
                const py = Math.round(peer.y);
                return px === target.x && py === target.y;
            });

            if (peerConflict) {
                const peerNext = peerConflict.nextStep;
                const isHeadOn = peerNext && Math.round(peerNext.x) === beliefs.me.x && Math.round(peerNext.y) === beliefs.me.y;

                // Lower priority (higher alphabetical ID) yields to avoid deadlocks
                if (isHeadOn && beliefs.me.id > peerConflict.id) {
                    console.log(`[BDI Yield] Head-on conflict with ${peerConflict.id} at (${target.x}, ${target.y}). Yielding priority.`);
                    await new Promise(resolve => setTimeout(resolve, 150));
                    success = false;
                    break;
                }
            }

            // Check for target collision race (peer nextStep is also target tile)
            const peerNextConflict = Array.from(beliefs.peers.values()).find(peer => {
                const peerNext = peer.nextStep;
                return peerNext && Math.round(peerNext.x) === target.x && Math.round(peerNext.y) === target.y;
            });

            if (peerNextConflict && beliefs.me.id > peerNextConflict.id) {
                console.log(`[BDI Yield] Target collision race with ${peerNextConflict.id} for tile (${target.x}, ${target.y}). Yielding priority.`);
                await new Promise(resolve => setTimeout(resolve, 150));
                success = false;
                break;
            }

            console.log(`[BDI] Attempting move: ${dir} to (${target.x}, ${target.y})`);

            const result = await socket.emitMove(dir);

            if (result) {
                const oldX = beliefs.me.x;
                const oldY = beliefs.me.y;
                beliefs.me.x = result.x;
                beliefs.me.y = result.y;
                
                // If a crate was on the tile we moved to, it was pushed collinear
                const pushedCrate = Array.from(beliefs.crates.values()).find(
                    c => c.x === result.x && c.y === result.y
                );
                if (pushedCrate) {
                    const dx = result.x - oldX;
                    const dy = result.y - oldY;
                    pushedCrate.x = result.x + dx;
                    pushedCrate.y = result.y + dy;
                    console.log(`[BDI] Crate ${pushedCrate.id} pushed from (${result.x}, ${result.y}) to (${pushedCrate.x}, ${pushedCrate.y})`);
                }
                
                engineState.collisionCounter = 0; // Reset collision count
                success = true;
            } else {
                console.warn(`[BDI] Move failed to (${target.x}, ${target.y}) - Collision detected.`);
                logActionFailure(beliefs, action, 'Move failed (collision detected)');
                engineState.collisionCounter++;

                if (engineState.collisionCounter >= 2) {
                    const blockKey = `${target.x},${target.y}`;
                    beliefs.blockedTargets.set(blockKey, Date.now());
                    console.log(`[BDI] Path step ${blockKey} blocked due to repeated collisions, forcing bypass.`);
                }

                if (engineState.collisionCounter <= 2) {
                    console.log(`[BDI] Tier 1 Collision: Waiting 1 tick (Count: ${engineState.collisionCounter}).`);
                    await new Promise(resolve => setTimeout(resolve, 100)); // Short wait
                } else {
                    console.log('[BDI] Tier 2 Collision: Preempting current path to compute bypass.');
                    if (engineState.currentGoal && engineState.currentGoal.type === 'clear_corridor') {
                        console.log('[BDI] Corridor clearing failed repeatedly. Aborting clear_corridor plan.');
                        engineState.activeGenerator = null;
                        engineState.currentGoal = null;
                    } else {
                        engineState.activeGenerator = instantiatePlanRecipe(engineState.currentGoal);
                    }
                    engineState.collisionCounter = 0;
                }
                success = false;
            }
            break;
        }

        case 'pickup': {
            const parcelId = action.target;
            console.log(`[BDI] Attempting pickup for parcel: ${parcelId}`);
            const picked = await socket.emitPickup();

            if (picked && picked.length > 0) {
                console.log(`[BDI] Pickup successful:`, picked);
                const matchedIds = new Set();
                for (const p of picked) {
                    let id = (p && typeof p === 'object') ? p.id : p;
                    if (!id && p && typeof p === 'object' && p.xy) {
                        const match = Array.from(beliefs.parcels.values()).find(
                            bp => bp.x === p.xy.x && bp.y === p.xy.y && !matchedIds.has(bp.id)
                        );
                        if (match) {
                            id = match.id;
                            matchedIds.add(id);
                        }
                    }
                    if (!id && !matchedIds.has(parcelId)) {
                        id = parcelId;
                        matchedIds.add(id);
                    }
                    if (id && !beliefs.carried.includes(id)) {
                        beliefs.carried.push(id);
                    }
                }
                engineState.mustDeliver = true;
                console.log('[BDI] mustDeliver flag SET — will deliver before considering new pickups.');
                success = true;
            } else {
                console.warn(`[BDI] Pickup failed for parcel ${parcelId}.`);
                logActionFailure(beliefs, action, 'Pickup failed (decayed or already collected)');
                if (!beliefs.carried.includes(parcelId)) {
                    beliefs.parcels.delete(parcelId);
                    beliefs.lockedTargets.delete(parcelId);
                }
                success = false;
            }
            break;
        }

        case 'putdown': {
            console.log('[BDI] Attempting cargo drop (putdown).');
            const dropped = await socket.emitPutdown(action.target ? [action.target] : []);

            if (dropped) {
                console.log('[BDI] Cargo successfully dropped:', dropped);
                if (action.target) {
                    beliefs.carried = beliefs.carried.filter(id => id !== action.target);
                } else {
                    beliefs.carried = [];
                }
                engineState.mustDeliver = false;
                console.log('[BDI] mustDeliver flag CLEARED — free to evaluate new pickups.');
                success = true;
            } else {
                console.warn('[BDI] Cargo drop failed.');
                logActionFailure(beliefs, action, 'Putdown failed');
                success = false;
            }
            break;
        }

        case 'say': {
            const message = action.payload;
            console.log('[BDI] Sending P2P chat sync message:', message);
            const peerId = getPeerAgentId();
            if (peerId) {
                try {
                    await socket.emitSay(peerId, JSON.stringify(message));
                    success = true;
                    break;
                } catch (e) {
                    // fallback to shout
                }
            }
            await socket.emitShout(JSON.stringify(message));
            success = true;
            break;
        }
    }

    const elapsed = Date.now() - startTime;
    if (action.action in engineState.actionStats) {
        const stats = engineState.actionStats[action.action];
        stats.count++;
        stats.totalTime += elapsed;
        stats.avgTime = stats.totalTime / stats.count;
        console.log(`[BDI Stats] ${action.action} took ${elapsed}ms (avg: ${stats.avgTime.toFixed(1)}ms). Count=${stats.count}`);
    }

    // Update sequence tracking for efficiency calculation
    if (success) {
        if (action.action === 'pickup') {
            if (beliefs.carried.length === 1) {
                engineState.sequenceStartTime = Date.now();
                engineState.sequenceCarriedCount = 1;
            } else if (beliefs.carried.length > 1) {
                engineState.sequenceCarriedCount = Math.max(engineState.sequenceCarriedCount, beliefs.carried.length);
            }
        } else if (action.action === 'putdown') {
            if (beliefs.carried.length === 0 && engineState.sequenceStartTime !== null) {
                const seqDuration = Date.now() - engineState.sequenceStartTime;
                const count = engineState.sequenceCarriedCount;
                if (count > 0) {
                    const timePerParcel = seqDuration / count;
                    console.log(`[BDI Stats] Finished delivery sequence: delivered=${count} parcels in ${seqDuration}ms (avg ${timePerParcel.toFixed(1)}ms per parcel).`);
                    
                    const targetTimePerParcel = 10000;
                    if (timePerParcel < targetTimePerParcel) {
                        engineState.dynamicCapacityLimit = Math.min(
                            beliefs.config?.GAME?.player?.capacity || Infinity,
                            engineState.dynamicCapacityLimit + 1
                        );
                        console.log(`[BDI Adapt] Good efficiency! Increased dynamicCapacityLimit to ${engineState.dynamicCapacityLimit}`);
                    } else {
                        engineState.dynamicCapacityLimit = Math.max(
                            3,
                            engineState.dynamicCapacityLimit - 1
                        );
                        console.log(`[BDI Adapt] Poor efficiency (took too long). Decreased dynamicCapacityLimit to ${engineState.dynamicCapacityLimit}`);
                    }
                }
                engineState.sequenceStartTime = null;
                engineState.sequenceCarriedCount = 0;
            }
        }
    }

    return success;
}
