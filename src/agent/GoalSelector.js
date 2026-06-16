/**
 * @module agent/GoalSelector
 * @description Goal selection and utility scoring for the BDI intention engine.
 * Evaluates parcel pickup, delivery, admin_move, rendezvous, and patrol goals
 * with expiration-aware utility calculation and policy rule adjustments.
 */

import { findNearestDeliveryZone, findNearestSpawnZone, findPatrolSpawnZone, findAdjacentClearTile, findAdjacentClearNonSpawnTile, pathDistance } from './PlanLibrary.js';
import { evaluatePolicyReward, getWaitDecayTimeForValue } from '../policy/PolicyEngine.js';
import { findAStarPath } from '../mapping/Pathfinding.js';
import { optimizeDeliveryStack } from '../policy/DeliveryOptimizer.js';
import { AGENT_IDS } from '../config/config.js';
import { MapRepresentation } from '../mapping/MapRepresentation.js';
import { logger } from '../utils/logger.js';

// evaluatePolicyReward moved to PolicyEngine.js (also needed by PlanLibrary for
// delivery-tile scoring). Re-exported here for existing importers (Intentions.js).
export { evaluatePolicyReward };

/**
 * Checks if a parcel is targeted/locked by our teammate.
 */
function isTeammateTarget(beliefs, parcel) {
    if (beliefs.lockedTargets.has(parcel.id)) {
        return true;
    }
    const teammateIds = [AGENT_IDS.BDI_AGENT_ID, AGENT_IDS.LLM_AGENT_ID];
    for (const peer of beliefs.peers.values()) {
        if (teammateIds.includes(peer.id)) {
            if (peer.path && peer.path.length > 0) {
                const dest = peer.path[peer.path.length - 1];
                if (Math.round(dest.x) === Math.round(parcel.x) && Math.round(dest.y) === Math.round(parcel.y)) {
                    return true;
                }
            }
        }
    }
    return false;
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

    if (!beliefs || !beliefs.me) {
        return { type: 'patrol', targetId: null, x: null, y: null, engineUpdates: null };
    }
    if (!beliefs.carried) beliefs.carried = [];
    if (!beliefs.variables) beliefs.variables = {};
    if (!beliefs.activeContracts) beliefs.activeContracts = new Map();
    if (!beliefs.parcels) beliefs.parcels = new Map();

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

    // 1.2 Prioritize coordinator direct PICKUP commands
    const adminPickup = beliefs.activeContracts.get('admin_pickup');
    if (adminPickup && adminPickup.status === 'ACTIVE') {
        const parcel = beliefs.parcels.get(adminPickup.parcelId);
        if (parcel) {
            return {
                type: 'admin_pickup',
                targetId: adminPickup.parcelId,
                x: parcel.x,
                y: parcel.y,
                engineUpdates: null
            };
        } else {
            console.log(`[BDI] admin_pickup target parcel ${adminPickup.parcelId} not found. Clearing contract.`);
            beliefs.activeContracts.delete('admin_pickup');
        }
    }

    // 1.3 Prioritize coordinator direct DELIVER commands
    const adminDeliver = beliefs.activeContracts.get('admin_deliver');
    if (adminDeliver && adminDeliver.status === 'ACTIVE') {
        let tx = adminDeliver.x;
        let ty = adminDeliver.y;
        if (tx === null || ty === null || tx === undefined || ty === undefined) {
            const zone = findNearestDeliveryZone(beliefs, beliefs.me.x, beliefs.me.y, engineState.blockedDeliveryZones);
            if (zone) {
                tx = zone.x;
                ty = zone.y;
            }
        }
        if (tx !== null && ty !== null && tx !== undefined && ty !== undefined) {
            return {
                type: 'admin_deliver',
                targetId: adminDeliver.parcelId,
                x: tx,
                y: ty,
                engineUpdates: null
            };
        } else {
            console.log(`[BDI] admin_deliver: No target destination (no zone found). Clearing contract.`);
            beliefs.activeContracts.delete('admin_deliver');
        }
    }

    // 2. Prioritize active cooperative contracts (e.g. RENDEZVOUS / HANDOFF)
    for (const [coopId, contract] of beliefs.activeContracts.entries()) {
        if (coopId === 'admin_move' || coopId === 'admin_pickup' || coopId === 'admin_deliver') continue;
        // RELAY contracts are persistent and do not force a goal here: the
        // courier's drop runs go through the normal carrying logic below (so
        // batching/detour/stack valuation apply), the receiver through normal
        // pickup valuation plus the idle anchor in section 4.5.
        if (contract.type === 'RELAY') continue;
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

    // RELAY bookkeeping: as courier, deliver-like runs target the drop tile and
    // parcels sitting on it must not be re-targeted (they're our own drops); as
    // receiver, we anchor near the drop tile when idle (section 4.5).
    const relayDropTiles = new Set();
    let courierRelayContract = null;
    let receiverRelayContract = null;
    for (const contract of beliefs.activeContracts.values()) {
        if (contract.type !== 'RELAY') continue;
        if (!(contract.status === 'ACTIVE' || contract.status === 'ACCEPTED' || contract.status === 'READY')) continue;
        if (contract.courierId === beliefs.me.id) {
            relayDropTiles.add(`${contract.x},${contract.y}`);
            if (!courierRelayContract) courierRelayContract = contract;
        } else {
            if (!receiverRelayContract) receiverRelayContract = contract;
        }
    }
    // As courier, carried cargo goes to the drop tile instead of a delivery zone.
    const deliverType = courierRelayContract ? 'handoff_drop' : 'deliver';

    // Check if policy rule for requiredStackSize or maxStackSize changed and update dynamic baseline
    const currentRequiredStack = beliefs.policyRules.requiredStackSize;
    const currentMaxStack = beliefs.policyRules.maxStackSize;
    if (currentRequiredStack !== engineState.lastRequiredStackSize || currentMaxStack !== engineState.lastMaxStackSize) {
        engineUpdates.lastRequiredStackSize = currentRequiredStack;
        engineUpdates.lastMaxStackSize = currentMaxStack;
        
        let targetLimit = currentRequiredStack;
        if (currentMaxStack !== null && currentMaxStack !== undefined) {
            targetLimit = currentMaxStack;
        }
        
        if (targetLimit !== null && targetLimit !== undefined) {
            engineUpdates.dynamicCapacityLimit = targetLimit;
            console.log(`[BDI Adapt] Reset dynamicCapacityLimit to policy rule limit: ${targetLimit}`);
        }
    }

    // --- Compute time-per-step and decay values ---
    const msPerStep = beliefs.movementDurationMs || 500;
    const decayMs = beliefs.parcelDecayIntervalMs;
    const decayEnabled = isFinite(decayMs) && decayMs > 0;

    const dynamicCapacityLimit = engineUpdates.dynamicCapacityLimit || (engineState ? engineState.dynamicCapacityLimit : 20);

    const stats = engineState && engineState.actionStats ? engineState.actionStats : {};
    const avgMoveTime = stats.move && stats.move.count > 0 
        ? stats.move.avgTime 
        : (beliefs.movementDurationMs || 100);
    const avgPickupTime = stats.pickup && stats.pickup.count > 0 
        ? stats.pickup.avgTime 
        : 20;
    const avgPutdownTime = stats.putdown && stats.putdown.count > 0 
        ? stats.putdown.avgTime 
        : 20;
    const decayPerMs = decayEnabled ? (1 / decayMs) : 0;

    // 2. If carrying parcels, evaluate: deliver now vs. pick up one more
    if (beliefs.carried.length > 0) {
        let capacity = beliefs.config?.GAME?.player?.capacity;
        if (capacity === undefined || capacity < 0) {
            capacity = Infinity;
        }

        // Dynamically compute the maximum stack size S <= capacity that has a positive policy reward
        let dynamicCapacityLimit = capacity;
        if (beliefs.policyRules && beliefs.policyRules.rules) {
            let maxValidS = 0;
            const maxSearchCap = isFinite(capacity) ? capacity : 20;
            const deliveryZoneForCap = courierRelayContract
                ? { x: courierRelayContract.x, y: courierRelayContract.y }
                : findNearestDeliveryZone(beliefs, beliefs.me.x, beliefs.me.y, engineState.blockedDeliveryZones);
            const deliveryPathForCap = deliveryZoneForCap
                ? findAStarPath(
                    beliefs.map,
                    { x: beliefs.me.x, y: beliefs.me.y },
                    { x: deliveryZoneForCap.x, y: deliveryZoneForCap.y },
                    beliefs.policyRules,
                    null
                  )
                : null;
            for (let S = 1; S <= maxSearchCap; S++) {
                const testReward = evaluatePolicyReward(beliefs, 100 * S, {
                    carriedSize: S,
                    x: deliveryZoneForCap ? deliveryZoneForCap.x : beliefs.me.x,
                    y: deliveryZoneForCap ? deliveryZoneForCap.y : beliefs.me.y,
                    path: deliveryPathForCap || [],
                    parcel: { reward: 100 }
                });
                if (testReward > 0) {
                    maxValidS = S;
                }
            }
            if (maxValidS > 0) {
                dynamicCapacityLimit = maxValidS;
            }
        }

        console.log(`[BDI Debug] selectBestGoal carrying: capacity=${capacity}, dynamicLimit=${dynamicCapacityLimit}, carried=${beliefs.carried.length}`);
        
        const deliveryZone = courierRelayContract
            ? { x: courierRelayContract.x, y: courierRelayContract.y }
            : findNearestDeliveryZone(beliefs, beliefs.me.x, beliefs.me.y, engineState.blockedDeliveryZones);
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
                    type: deliverType,
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

        // Compute utility of delivering now, adjusted by policy rules and including potential wait time
        const dx = deliveryZone ? deliveryZone.x : beliefs.me.x;
        const dy = deliveryZone ? deliveryZone.y : beliefs.me.y;
        const targetParcelsDirect = beliefs.carried.map(cid => {
            const cp = beliefs.parcels.get(cid) || { id: cid, reward: 20 };
            const cpDecay = decayEnabled ? (T_direct * decayPerMs) : 0;
            const cpVal = Math.max(0, cp.reward - cpDecay);
            return { ...cp, reward: cpVal };
        });
        const optDirect = optimizeDeliveryStack(beliefs, targetParcelsDirect, dx, dy);
        const carriedValueAtDelivery = optDirect.bestReward;
        const T_total = T_direct + optDirect.bestWaitMs;
        const utilityDeliver = carriedValueAtDelivery / (T_total + 1);

        let bestPickup = null;
        let bestPickupUtility = -Infinity;

        const candidates = [];
        for (const parcel of beliefs.parcels.values()) {
            if (parcel.carriedBy) continue;
            if (beliefs.carried.includes(parcel.id)) continue;
            
            const isTeammateTgt = isTeammateTarget(beliefs, parcel);
            if (isTeammateTgt) continue;
            
            if (beliefs.blockedTargets.has(parcel.id) || beliefs.blockedTargets.has(`${parcel.x},${parcel.y}`)) continue;
            
            // Evaluate denial candidacy at the TARGET valid stack size, not current.
            // Stack-size rules ("cannot deliver < 3") are delivery-time constraints,
            // not pickup-time constraints. A parcel deliverable at the right stack
            // size should never be flagged as a denial candidate.
            const denialStackSize = beliefs.policyRules.requiredStackSize || beliefs.policyRules.maxStackSize || (beliefs.carried.length + 1);
            const currentRewardVal = evaluatePolicyReward(beliefs, parcel.reward, { parcel, carriedSize: denialStackSize });
            const delZone = findNearestDeliveryZone(beliefs, parcel.x, parcel.y, engineState.blockedDeliveryZones);
            const dx = delZone ? delZone.x : beliefs.me.x;
            const dy = delZone ? delZone.y : beliefs.me.y;
            const canDecayToAllowed = getWaitDecayTimeForValue(beliefs, parcel.reward, denialStackSize, dx, dy, parcel) > 0;
            
            const isDenialCandidate = (currentRewardVal <= 0 && !canDecayToAllowed) || (parcel.reward < beliefs.policyRules.minRewardThreshold);
            if (isDenialCandidate) {
                // If it is next to a delivery zone and yields no reward to us, do not pick it up (prevents loops)
                const nearDelivery = delZone && (Math.abs(parcel.x - delZone.x) + Math.abs(parcel.y - delZone.y) <= 2);
                if (nearDelivery) continue;
            }
            
            if (relayDropTiles.has(`${Math.round(parcel.x)},${Math.round(parcel.y)}`)) continue;

            const mDist = Math.abs(parcel.x - beliefs.me.x) + Math.abs(parcel.y - beliefs.me.y);
            candidates.push({ parcel, mDist, roughUtil: parcel.reward / (mDist + 1), isDenialCandidate });
        }
        candidates.sort((a, b) => b.roughUtil - a.roughUtil);

        for (const { parcel, isDenialCandidate } of candidates.slice(0, 5)) {
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

            // Project remaining reward of carried parcels after detour, including wait time if needed
            const detourParcels = [...beliefs.carried, parcel.id].map(cid => {
                const cp = cid === parcel.id ? parcel : (beliefs.parcels.get(cid) || { id: cid, reward: 20 });
                const cpDecay = decayEnabled ? ((T_detour + safetyMarginMs) * decayPerMs) : 0;
                const cpVal = Math.max(0, cp.reward - cpDecay);
                return { ...cp, reward: cpVal };
            });
            const optDetour = optimizeDeliveryStack(
                beliefs,
                detourParcels,
                deliveryZoneFromParcel.x,
                deliveryZoneFromParcel.y,
                beliefs.policyRules.requiredStackSize || null
            );

            const totalRewardAfterDetour = optDetour.bestReward;
            const totalRewardDirect = optDirect.bestReward;

            const newParcelDelivered = optDetour.bestSubset.includes(parcel.id);
            const canDeliverInTimeAfterDetour = newParcelDelivered && (totalRewardAfterDetour >= totalRewardDirect * 0.8);

            const extraSteps = (distToParcel + deliveryDistFromP) - deliveryDist;
            const isMovingBackwards = (deliveryDistFromP > deliveryDist);

            const buildingStack = beliefs.policyRules.requiredStackSize &&
                beliefs.carried.length < beliefs.policyRules.requiredStackSize;

            let allowed = false;
            if (newParcelDelivered) {
                if (atDynamicLimit) {
                    if (canDeliverInTimeAfterDetour && extraSteps <= 15 && !isMovingBackwards) {
                        allowed = true;
                    }
                } else {
                    if (canDeliverInTimeAfterDetour || (extraSteps <= 30 && totalRewardAfterDetour > 0)) {
                        if (extraSteps <= 120) {
                            allowed = true;
                        }
                    }
                }
            } else {
                // Denial detour: the optimizer couldn't deliver this combo yet.
                // If we're still building toward a required stack size, be much
                // more permissive: the agent MUST collect parcels to reach the
                // minimum, so direction/distance limits shouldn't block pickup.
                if (beliefs.carried.length < dynamicCapacityLimit) {
                    if (buildingStack) {
                        // Actively building a required stack — allow long detours in any direction
                        if (extraSteps <= 120) {
                            allowed = true;
                        }
                    } else if (extraSteps <= 10 && !isMovingBackwards) {
                        allowed = true;
                    }
                }
            }

            if (!allowed) {
                logger.bdi(`[BDI] Detour/pickup parcel ${parcel.id} NOT allowed: newParcelDelivered=${newParcelDelivered}, canDeliver=${canDeliverInTimeAfterDetour}, extraSteps=${extraSteps}, isMovingBackwards=${isMovingBackwards}`);
                continue;
            }

            // Assign small virtual reward if we are picking it up for denial, so utility is positive.
            // Also, when building toward a required stack, if totalRewardAfterDetour is 0 (due to decay),
            // use the sum of rewards of detourParcels as virtual value.
            let adjustedDetourReward;
            if (buildingStack && totalRewardAfterDetour <= 0) {
                const sumRewards = detourParcels.reduce((sum, p) => sum + p.reward, 0);
                adjustedDetourReward = Math.max(0.5, sumRewards);
            } else {
                adjustedDetourReward = Math.max(isDenialCandidate ? 0.5 : 0.0, totalRewardAfterDetour);
            }
            if (adjustedDetourReward <= 0) continue;

            const T_total_detour = T_detour + optDetour.bestWaitMs;
            const utility = adjustedDetourReward / (T_total_detour + 1);
            logger.bdi(`[BDI] Detour/pickup candidate ${parcel.id}: distToP=${distToParcel}, delivDistFromP=${deliveryDistFromP}, utility=${utility.toFixed(3)} (vs deliver: ${utilityDeliver.toFixed(3)})`);

            if (utility > bestPickupUtility) {
                bestPickupUtility = utility;
                bestPickup = parcel;
            }
        }

        if (bestPickup && bestPickupUtility > utilityDeliver) {
            logger.bdi(`[BDI] Selecting pickup detour: ${bestPickup.id} (utility ${bestPickupUtility.toFixed(3)} > deliver ${utilityDeliver.toFixed(3)})`);
            return {
                type: 'pickup',
                targetId: bestPickup.id,
                x: bestPickup.x,
                y: bestPickup.y,
                engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null
            };
        } else if (deliveryZone) {
            // Generalized required stack size check
            let shouldHuntInstead = false;
            let targetStackForHunt = null;
            let targetStackValue = 0;

            if (beliefs.carried.length < capacity) {
                if (carriedValueAtDelivery <= 0) {
                    shouldHuntInstead = true;
                    targetStackForHunt = beliefs.policyRules.requiredStackSize || (beliefs.carried.length + 1);
                } else {
                    const searchBudgetMs = 40 * avgMoveTime;
                    const maxSearchCap = isFinite(capacity) ? capacity : 20;
                    for (let S = beliefs.carried.length + 1; S <= maxSearchCap; S++) {
                        const decayLoss = decayEnabled ? ((T_direct + searchBudgetMs) * decayPerMs) : 0;
                        const huntParcels = beliefs.carried.map(cid => {
                            const cp = beliefs.parcels.get(cid) || { id: cid, reward: 20 };
                            const cpVal = Math.max(0, cp.reward - decayLoss);
                            return { ...cp, reward: cpVal };
                        });
                        const optHunt = optimizeDeliveryStack(beliefs, huntParcels, deliveryZone.x, deliveryZone.y, S);
                        const S_value = optHunt.bestReward;

                        // If waiting to reach stack S yields a positive reward that is better than delivering now:
                        if (S_value > carriedValueAtDelivery) {
                            shouldHuntInstead = true;
                            targetStackForHunt = S;
                            targetStackValue = S_value;
                            break;
                        }
                    }
                }
            }

            if (shouldHuntInstead) {
                const huntZone = findPatrolSpawnZone(beliefs, beliefs.me.x, beliefs.me.y);
                if (huntZone) {
                    const safeTile = findAdjacentClearNonSpawnTile(beliefs, huntZone.x, huntZone.y);
                    console.log(`[BDI] Current stack (${beliefs.carried.length}) has value ${carriedValueAtDelivery.toFixed(1)}, but waiting/hunting for stack size ${targetStackForHunt} yields value ${targetStackValue.toFixed(1)}. Hunting near spawn zone (${huntZone.x}, ${huntZone.y}), standing at (${safeTile.x}, ${safeTile.y}) instead of early delivery.`);
                    return { type: 'patrol_spawn', targetId: null, x: safeTile.x, y: safeTile.y, engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null };
                }
            }
            logger.bdi(`[BDI] Heading to ${deliverType} (utilityDeliver=${utilityDeliver.toFixed(3)} >= bestPickupUtility=${bestPickupUtility.toFixed(3)})`);
            return {
                type: deliverType,
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
        
        const isTeammateTgt = isTeammateTarget(beliefs, parcel);
        if (isTeammateTgt) continue;
        
        if (beliefs.blockedTargets.has(parcel.id) || beliefs.blockedTargets.has(`${parcel.x},${parcel.y}`)) continue;
        
        // Evaluate denial candidacy at the TARGET valid stack size, not current.
        // Stack-size rules ("cannot deliver < 3") are delivery-time constraints,
        // not pickup-time constraints.
        const denialStackSize = beliefs.policyRules.requiredStackSize || beliefs.policyRules.maxStackSize || 1;
        const currentRewardVal = evaluatePolicyReward(beliefs, parcel.reward, { parcel, carriedSize: denialStackSize });
        const delZone = findNearestDeliveryZone(beliefs, parcel.x, parcel.y, engineState.blockedDeliveryZones);
        const dx = delZone ? delZone.x : beliefs.me.x;
        const dy = delZone ? delZone.y : beliefs.me.y;
        const canDecayToAllowed = getWaitDecayTimeForValue(beliefs, parcel.reward, denialStackSize, dx, dy, parcel) > 0;
        
        const isDenialCandidate = (currentRewardVal <= 0 && !canDecayToAllowed) || (parcel.reward < beliefs.policyRules.minRewardThreshold);
        if (isDenialCandidate) {
            // If it is next to a delivery zone and yields no reward to us, do not pick it up (prevents loops)
            const nearDelivery = delZone && (Math.abs(parcel.x - delZone.x) + Math.abs(parcel.y - delZone.y) <= 2);
            if (nearDelivery) continue;
        }

        if (relayDropTiles.has(`${Math.round(parcel.x)},${Math.round(parcel.y)}`)) continue;

        const mDist = Math.abs(parcel.x - beliefs.me.x) + Math.abs(parcel.y - beliefs.me.y);
        const roughUtility = parcel.reward / (mDist + 1);
        parcelCandidates.push({ parcel, roughUtility, isDenialCandidate });
    }
    parcelCandidates.sort((a, b) => b.roughUtility - a.roughUtility);

    for (const { parcel, isDenialCandidate } of parcelCandidates.slice(0, 5)) {
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

        const dx = deliveryZoneForScoring ? deliveryZoneForScoring.x : beliefs.me.x;
        const dy = deliveryZoneForScoring ? deliveryZoneForScoring.y : beliefs.me.y;

        const optSingle = optimizeDeliveryStack(
            beliefs, [{ ...parcel, reward: projectedReward }], dx, dy,
            beliefs.policyRules.requiredStackSize || null  // evaluate at target stack size
        );
        // When building toward a required stack, even if the single-parcel optimizer
        // returns 0 (because the stack isn't full yet), use the parcel's own reward
        // as virtual value so the agent picks it up.
        const buildingStack = beliefs.policyRules.requiredStackSize && beliefs.carried.length < beliefs.policyRules.requiredStackSize;
        let adjustedReward;
        if (buildingStack && optSingle.bestReward <= 0) {
            adjustedReward = projectedReward;  // trust the raw reward for stack-building
        } else {
            adjustedReward = Math.max(isDenialCandidate ? 0.5 : 0.0, optSingle.bestReward);
        }
        const waitMs = optSingle.bestWaitMs;

        if (adjustedReward <= 0) continue;

        const totalTripWithWaitMs = totalTripMs + waitMs;
        const utility = adjustedReward / (totalTripWithWaitMs + 1);
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
        const fallbackDelivery = courierRelayContract
            ? { x: courierRelayContract.x, y: courierRelayContract.y }
            : findNearestDeliveryZone(beliefs, beliefs.me.x, beliefs.me.y, engineState.blockedDeliveryZones);
        if (fallbackDelivery) {
            return {
                type: deliverType,
                targetId: null,
                x: fallbackDelivery.x,
                y: fallbackDelivery.y,
                engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null
            };
        }
    }

    // 4.5 RELAY receiver anchoring: when idle, wait beside the drop tile so
    // incoming batches are shuttled to delivery quickly. Anchoring on an
    // adjacent tile (not the drop tile itself) keeps it clear for the courier.
    // Pickups preempt this anchor as soon as a batch lands.
    // We sort neighbors by distance to the delivery zone so the receiver anchors
    // towards the delivery side, keeping the spawn-facing side clear for the courier.
    if (receiverRelayContract && beliefs.map) {
        const neighbors = beliefs.map.getNeighbors({ x: receiverRelayContract.x, y: receiverRelayContract.y });
        const delZone = findNearestDeliveryZone(beliefs, receiverRelayContract.x, receiverRelayContract.y);
        if (delZone) {
            neighbors.sort((a, b) => {
                const distA = Math.abs(a.x - delZone.x) + Math.abs(a.y - delZone.y);
                const distB = Math.abs(b.x - delZone.x) + Math.abs(b.y - delZone.y);
                return distA - distB;
            });
        }
        const anchor = neighbors.find(n => {
            const code = beliefs.map.getTileCode(n.x, n.y);
            const hasCrate = Array.from(beliefs.crates.values()).some(c => c.x === n.x && c.y === n.y);
            const hasPeer = Array.from(beliefs.peers.values()).some(p => p.x === n.x && p.y === n.y);
            return code !== MapRepresentation.TILE_CODES.SPAWN && !hasCrate && !hasPeer;
        }) || neighbors[0];

        if (anchor) {
            return { type: 'patrol_spawn', targetId: null, x: anchor.x, y: anchor.y, engineUpdates: Object.keys(engineUpdates).length > 0 ? engineUpdates : null };
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
