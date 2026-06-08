/**
 * @module agent/GoalSelector
 * @description Goal selection and utility scoring for the BDI intention engine.
 * Evaluates parcel pickup, delivery, admin_move, rendezvous, and patrol goals
 * with expiration-aware utility calculation and policy rule adjustments.
 */

import { findNearestDeliveryZone, findNearestSpawnZone, findPatrolSpawnZone, pathDistance } from './PlanLibrary.js';
import { evaluateExpression } from '../policy/PolicyEngine.js';
import { findAStarPath } from '../mapping/Pathfinding.js';

/**
 * Evaluates policy rules (multipliers, bonuses) for a projected delivery.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {number} baseReward - The base reward before modifications.
 * @param {Object} projectedState - Mock state representing delivery conditions.
 * @returns {number} The policy-adjusted reward.
 */
export function evaluatePolicyReward(beliefs, baseReward, projectedState) {
    let reward = baseReward;
    
    // Context object for evaluateExpression
    const context = {
        beliefs: beliefs,
        variables: beliefs.variables,
        me: {
            x: projectedState.x !== undefined ? projectedState.x : beliefs.me.x,
            y: projectedState.y !== undefined ? projectedState.y : beliefs.me.y,
            score: beliefs.me.score,
            status: beliefs.me.status
        },
        carried: {
            length: projectedState.carriedSize !== undefined ? projectedState.carriedSize : beliefs.carried.length
        },
        path: projectedState.path || [],
        parcel: projectedState.parcel || null
    };

    // 1. Apply multiplier rules
    if (beliefs.policyRules && beliefs.policyRules.multiplierRules) {
        for (const rule of beliefs.policyRules.multiplierRules) {
            try {
                const matched = evaluateExpression(rule.condition, context, {
                    'carrying.size': context.carried.length,
                    'carrying.length': context.carried.length,
                    'stack_size': context.carried.length
                });
                if (matched) {
                    reward *= rule.multiplier;
                }
            } catch (e) {
                console.error('[BDI Policy] Error evaluating multiplier rule condition:', rule.condition, e.message);
            }
        }
    }

    // 2. Apply bonus rules
    if (beliefs.policyRules && beliefs.policyRules.bonusRules) {
        for (const rule of beliefs.policyRules.bonusRules) {
            try {
                const matched = evaluateExpression(rule.condition, context, {
                    'carrying.size': context.carried.length,
                    'carrying.length': context.carried.length,
                    'stack_size': context.carried.length
                });
                if (matched) {
                    reward += rule.bonus;
                }
            } catch (e) {
                console.error('[BDI Policy] Error evaluating bonus rule condition:', rule.condition, e.message);
            }
        }
    }

    return reward;
}

/**
 * Selects the highest utility goal based on current beliefs, policy rules,
 * and projected parcel reward at delivery time (expiration-aware).
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @param {Object} engineState - Engine state containing dynamicCapacityLimit, actionStats, blockedDeliveryZones, lastRequiredStackSize.
 * @returns {{type: string, targetId: string|null, x: number|null, y: number|null, engineUpdates: Object|null}} Goal descriptor.
 */
export function selectBestGoal(beliefs, engineState) {
    const engineUpdates = {};

    if (beliefs.carried.length === 0) {
        beliefs.variables.handoffCompleted = false;
    }

    // 1. Prioritize coordinator direct MOVE_TO commands
    const adminMove = beliefs.activeContracts.get('admin_move');
    if (adminMove && adminMove.status === 'ACTIVE') {
        return {
            type: 'admin_move',
            targetId: null,
            x: adminMove.x,
            y: adminMove.y,
            engineUpdates: null
        };
    }

    // 2. Prioritize active cooperative contracts (e.g. RENDEZVOUS / HANDOFF)
    for (const [coopId, contract] of beliefs.activeContracts.entries()) {
        if (coopId === 'admin_move') continue;
        if (contract.status === 'ACTIVE' || contract.status === 'ACCEPTED' || contract.status === 'READY') {
            if (contract.type === 'HANDOFF') {
                if (beliefs.carried.length > 0 && !beliefs.variables.handoffCompleted) {
                    return {
                        type: 'handoff',
                        targetId: coopId,
                        x: contract.x,
                        y: contract.y,
                        engineUpdates: null
                    };
                }
            } else {
                return {
                    type: 'rendezvous',
                    targetId: coopId,
                    x: contract.x,
                    y: contract.y,
                    engineUpdates: null
                };
            }
        }
    }

    // Check if policy rule for requiredStackSize changed and update dynamic baseline
    const currentRequiredStack = beliefs.policyRules.requiredStackSize;
    if (currentRequiredStack !== engineState.lastRequiredStackSize) {
        engineUpdates.lastRequiredStackSize = currentRequiredStack;
        if (currentRequiredStack !== null && currentRequiredStack !== undefined) {
            engineUpdates.dynamicCapacityLimit = currentRequiredStack;
            console.log(`[BDI Adapt] Reset dynamicCapacityLimit to policy rule: ${currentRequiredStack}`);
        }
    }

    // --- Compute time-per-step and decay values ---
    const msPerStep = beliefs.movementDurationMs || 500;
    const decayMs = beliefs.parcelDecayIntervalMs;
    const decayEnabled = isFinite(decayMs) && decayMs > 0;

    const dynamicCapacityLimit = engineUpdates.dynamicCapacityLimit || engineState.dynamicCapacityLimit;

    const avgMoveTime = engineState.actionStats.move.count > 0 
        ? engineState.actionStats.move.avgTime 
        : (beliefs.movementDurationMs || 100);
    const avgPickupTime = engineState.actionStats.pickup.count > 0 
        ? engineState.actionStats.pickup.avgTime 
        : 20;
    const avgPutdownTime = engineState.actionStats.putdown.count > 0 
        ? engineState.actionStats.putdown.avgTime 
        : 20;
    const decayPerMs = decayEnabled ? (1 / decayMs) : 0;

    // 2. If carrying parcels, evaluate: deliver now vs. pick up one more
    if (beliefs.carried.length > 0) {
        let capacity = beliefs.config?.GAME?.player?.capacity;
        if (capacity === undefined || capacity < 0) {
            capacity = Infinity;
        }
        console.log(`[BDI Debug] selectBestGoal carrying: capacity=${capacity}, dynamicLimit=${dynamicCapacityLimit}, carried=${beliefs.carried.length}`);
        
        const deliveryZone = findNearestDeliveryZone(beliefs, beliefs.me.x, beliefs.me.y, engineState.blockedDeliveryZones);
        const deliveryPath = deliveryZone
            ? findAStarPath(
                beliefs.map,
                { x: beliefs.me.x, y: beliefs.me.y },
                { x: deliveryZone.x, y: deliveryZone.y },
                beliefs.policyRules,
                null
              )
            : null;
        const deliveryDist = deliveryPath ? deliveryPath.length - 1 : Infinity;

        // At capacity → must deliver
        if (beliefs.carried.length >= capacity) {
            if (deliveryZone) {
                return {
                    type: 'deliver',
                    targetId: null,
                    x: deliveryZone.x,
                    y: deliveryZone.y,
                    engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null
                };
            }
            // All delivery zones blocked — fall through to patrol
            console.log(`[BDI] At capacity but ALL delivery zones blocked. Falling through to patrol.`);
            const spawnZone = findPatrolSpawnZone(beliefs, beliefs.me.x, beliefs.me.y);
            if (spawnZone) {
                return { type: 'patrol_spawn', targetId: null, x: spawnZone.x, y: spawnZone.y, engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null };
            }
            return { type: 'patrol', targetId: null, x: null, y: null, engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null };
        }

        // Estimate direct delivery time
        const T_direct = isFinite(deliveryDist)
            ? (deliveryDist * avgMoveTime + avgPutdownTime)
            : Infinity;

        const safetyMarginMs = 1 * avgMoveTime;
        const atDynamicLimit = (beliefs.carried.length >= dynamicCapacityLimit);

        // Compute utility of delivering now, adjusted by policy rules
        let carriedValueAtDelivery = 0;
        for (const cid of beliefs.carried) {
            const cp = beliefs.parcels.get(cid);
            if (cp) {
                const cpDecay = decayEnabled ? (T_direct * decayPerMs) : 0;
                const cpVal = Math.max(0, cp.reward - cpDecay);
                carriedValueAtDelivery += evaluatePolicyReward(beliefs, cpVal, {
                    carriedSize: beliefs.carried.length,
                    x: deliveryZone ? deliveryZone.x : beliefs.me.x,
                    y: deliveryZone ? deliveryZone.y : beliefs.me.y,
                    path: deliveryPath || [],
                    parcel: cp
                });
            }
        }
        const utilityDeliver = carriedValueAtDelivery / (T_direct + 1);

        let bestPickup = null;
        let bestPickupUtility = -Infinity;

        const candidates = [];
        for (const parcel of beliefs.parcels.values()) {
            if (parcel.carriedBy) continue;
            if (beliefs.carried.includes(parcel.id)) continue;
            if (beliefs.lockedTargets.has(parcel.id)) continue;
            if (beliefs.blockedTargets.has(parcel.id) || beliefs.blockedTargets.has(`${parcel.x},${parcel.y}`)) continue;
            if (parcel.reward < beliefs.policyRules.minRewardThreshold) continue;
            if (parcel.reward > beliefs.policyRules.maxRewardLimit) continue;
            
            const mDist = Math.abs(parcel.x - beliefs.me.x) + Math.abs(parcel.y - beliefs.me.y);
            candidates.push({ parcel, mDist, roughUtil: parcel.reward / (mDist + 1) });
        }
        candidates.sort((a, b) => b.roughUtil - a.roughUtil);

        for (const { parcel } of candidates.slice(0, 5)) {
            const pathToParcel = findAStarPath(
                beliefs.map,
                { x: beliefs.me.x, y: beliefs.me.y },
                { x: parcel.x, y: parcel.y },
                beliefs.policyRules,
                null
            );
            if (!pathToParcel) continue;
            const distToParcel = pathToParcel.length - 1;

            const deliveryZoneFromParcel = findNearestDeliveryZone(beliefs, parcel.x, parcel.y);
            const pathToDelivery = deliveryZoneFromParcel
                ? findAStarPath(
                    beliefs.map,
                    { x: parcel.x, y: parcel.y },
                    { x: deliveryZoneFromParcel.x, y: deliveryZoneFromParcel.y },
                    beliefs.policyRules,
                    null
                  )
                : null;
            if (!pathToDelivery) continue;
            const deliveryDistFromP = pathToDelivery.length - 1;

            const detourPath = pathToParcel.concat(pathToDelivery.slice(1));

            const T_detour = (distToParcel + deliveryDistFromP) * avgMoveTime + avgPickupTime + avgPutdownTime;

            // Project remaining reward of carried parcels after detour
            let carriedRewardAfterDetour = 0;
            let carriedRewardDirect = 0;
            for (const cid of beliefs.carried) {
                const cp = beliefs.parcels.get(cid);
                if (cp) {
                    const cpDecayDetour = decayEnabled ? ((T_detour + safetyMarginMs) * decayPerMs) : 0;
                    const cpDecayDirect = decayEnabled ? (T_direct * decayPerMs) : 0;
                    
                    const valDetour = Math.max(0, cp.reward - cpDecayDetour);
                    const valDirect = Math.max(0, cp.reward - cpDecayDirect);
                    
                    carriedRewardAfterDetour += evaluatePolicyReward(beliefs, valDetour, {
                        carriedSize: beliefs.carried.length + 1,
                        x: deliveryZoneFromParcel.x,
                        y: deliveryZoneFromParcel.y,
                        path: detourPath,
                        parcel: cp
                    });
                    
                    carriedRewardDirect += evaluatePolicyReward(beliefs, valDirect, {
                        carriedSize: beliefs.carried.length,
                        x: deliveryZone ? deliveryZone.x : beliefs.me.x,
                        y: deliveryZone ? deliveryZone.y : beliefs.me.y,
                        path: deliveryPath || [],
                        parcel: cp
                    });
                }
            }

            // Project remaining reward of new parcel after detour
            let newParcelRewardAfterDetour = 0;
            if (decayEnabled) {
                newParcelRewardAfterDetour = Math.max(0, parcel.reward - ((T_detour + safetyMarginMs) * decayPerMs));
            } else {
                newParcelRewardAfterDetour = parcel.reward;
            }

            const newParcelRewardAfterDetourVal = evaluatePolicyReward(beliefs, newParcelRewardAfterDetour, {
                carriedSize: beliefs.carried.length + 1,
                x: deliveryZoneFromParcel.x,
                y: deliveryZoneFromParcel.y,
                path: detourPath,
                parcel: parcel
            });

            const totalRewardAfterDetour = carriedRewardAfterDetour + newParcelRewardAfterDetourVal;
            const totalRewardDirect = carriedRewardDirect;

            const canDeliverInTimeAfterDetour = (newParcelRewardAfterDetourVal > 0) && (totalRewardAfterDetour >= totalRewardDirect * 0.8);
            
            const extraSteps = (distToParcel + deliveryDistFromP) - deliveryDist;
            const isMovingBackwards = (deliveryDistFromP > deliveryDist);

            let allowed = false;
            if (atDynamicLimit) {
                if ((canDeliverInTimeAfterDetour || (extraSteps <= 15 && carriedRewardAfterDetour > 0)) && extraSteps <= 15 && !isMovingBackwards) {
                    allowed = true;
                }
            } else {
                if (canDeliverInTimeAfterDetour || (extraSteps <= 30 && carriedRewardAfterDetour > 0)) {
                    if (extraSteps <= 120) {
                        allowed = true;
                    }
                }
            }

            if (!allowed) {
                console.log(`[BDI] Detour/pickup parcel ${parcel.id} NOT allowed: canDeliver=${canDeliverInTimeAfterDetour}, extraSteps=${extraSteps}, isMovingBackwards=${isMovingBackwards}`);
                continue;
            }

            const adjustedDetourReward = totalRewardAfterDetour;

            if (adjustedDetourReward <= 0) continue;

            const utility = adjustedDetourReward / (T_detour + 1);
            console.log(`[BDI] Detour/pickup candidate ${parcel.id}: distToP=${distToParcel}, delivDistFromP=${deliveryDistFromP}, utility=${utility.toFixed(3)} (vs deliver: ${utilityDeliver.toFixed(3)})`);

            if (utility > bestPickupUtility) {
                bestPickupUtility = utility;
                bestPickup = parcel;
            }
        }

        if (bestPickup && bestPickupUtility > utilityDeliver) {
            console.log(`[BDI] Selecting pickup detour: ${bestPickup.id} (utility ${bestPickupUtility.toFixed(3)} > deliver ${utilityDeliver.toFixed(3)})`);
            return {
                type: 'pickup',
                targetId: bestPickup.id,
                x: bestPickup.x,
                y: bestPickup.y,
                engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null
            };
        } else if (deliveryZone) {
            console.log(`[BDI] Heading to deliver (utilityDeliver=${utilityDeliver.toFixed(3)} >= bestPickupUtility=${bestPickupUtility.toFixed(3)})`);
            return {
                type: 'deliver',
                targetId: null,
                x: deliveryZone.x,
                y: deliveryZone.y,
                engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null
            };
        } else {
            console.log(`[BDI] Want to deliver but ALL delivery zones blocked. Falling through.`);
        }
    }

    // 3. Evaluate available parcels with expiration-aware utility.
    let bestParcel = null;
    let bestUtility = -Infinity;

    const deliveryZoneForScoring = findNearestDeliveryZone(beliefs, beliefs.me.x, beliefs.me.y);

    const parcelCandidates = [];
    for (const parcel of beliefs.parcels.values()) {
        if (parcel.carriedBy) continue;
        if (beliefs.carried.includes(parcel.id)) continue;
        if (beliefs.lockedTargets.has(parcel.id)) continue;
        if (beliefs.blockedTargets.has(parcel.id) || beliefs.blockedTargets.has(`${parcel.x},${parcel.y}`)) continue;
        if (parcel.reward < beliefs.policyRules.minRewardThreshold) continue;
        if (parcel.reward > beliefs.policyRules.maxRewardLimit) continue;

        const mDist = Math.abs(parcel.x - beliefs.me.x) + Math.abs(parcel.y - beliefs.me.y);
        const roughUtility = parcel.reward / (mDist + 1);
        parcelCandidates.push({ parcel, roughUtility });
    }
    parcelCandidates.sort((a, b) => b.roughUtility - a.roughUtility);

    for (const { parcel } of parcelCandidates.slice(0, 5)) {
        const pathToParcel = findAStarPath(
            beliefs.map,
            { x: beliefs.me.x, y: beliefs.me.y },
            { x: parcel.x, y: parcel.y },
            beliefs.policyRules,
            null
        );
        if (!pathToParcel) continue;
        const distToParcel = pathToParcel.length - 1;

        const pathToDelivery = deliveryZoneForScoring
            ? findAStarPath(
                beliefs.map,
                { x: parcel.x, y: parcel.y },
                { x: deliveryZoneForScoring.x, y: deliveryZoneForScoring.y },
                beliefs.policyRules,
                null
              )
            : null;
        if (!pathToDelivery) continue;
        const distToDelivery = pathToDelivery.length - 1;

        const tripPath = pathToParcel.concat(pathToDelivery.slice(1));

        const totalTripMs = (distToParcel + distToDelivery) * avgMoveTime + avgPickupTime + avgPutdownTime;

        let projectedReward;
        if (decayEnabled) {
            projectedReward = parcel.reward - (totalTripMs * decayPerMs);
        } else {
            projectedReward = parcel.reward;
        }

        if (projectedReward <= 0) continue;

        const adjustedReward = evaluatePolicyReward(beliefs, projectedReward, {
            carriedSize: 1,
            x: deliveryZoneForScoring ? deliveryZoneForScoring.x : beliefs.me.x,
            y: deliveryZoneForScoring ? deliveryZoneForScoring.y : beliefs.me.y,
            path: tripPath,
            parcel: parcel
        });
        if (adjustedReward <= 0) continue;

        const utility = adjustedReward / (totalTripMs + 1);
        if (utility > bestUtility) {
            bestUtility = utility;
            bestParcel = parcel;
        }
    }

    if (bestParcel) {
        return { type: 'pickup', targetId: bestParcel.id, x: bestParcel.x, y: bestParcel.y, engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null };
    }

    // 4. If carrying parcels but found nothing better, deliver what we have
    if (beliefs.carried.length > 0) {
        const fallbackDelivery = findNearestDeliveryZone(beliefs, beliefs.me.x, beliefs.me.y, engineState.blockedDeliveryZones);
        if (fallbackDelivery) {
            return {
                type: 'deliver',
                targetId: null,
                x: fallbackDelivery.x,
                y: fallbackDelivery.y,
                engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null
            };
        }
    }

    // 5. Fallback to navigating to a spawn zone to collect parcels (smart patrolling).
    const spawnZone = findPatrolSpawnZone(beliefs, beliefs.me.x, beliefs.me.y);
    if (spawnZone) {
        return { type: 'patrol_spawn', targetId: null, x: spawnZone.x, y: spawnZone.y, engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null };
    }

    // 6. Absolute fallback to random patrolling.
    return { type: 'patrol', targetId: null, x: null, y: null, engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null };
}
