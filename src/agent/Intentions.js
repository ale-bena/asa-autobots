/**
 * @module agent/Intentions
 * @description Intention execution engine (BDI Control Loop). Handles priority goal selection,
 * action dispatching, collision back-off (Tier 1/2), and plan preemption stack (HFSM).
 */

import fs from 'fs';
import { NavigateTo, CollectAndDeliver, findNearestDeliveryZone, findNearestSpawnZone, findPatrolSpawnZone, pathDistance } from './PlanLibrary.js';
import { evaluateExpression } from '../policy/PolicyEngine.js';
import { AGENT_IDS } from '../config/config.js';
import { findAStarPath } from '../mapping/Pathfinding.js';
import { PddlServiceBridge } from '../planning/PddlServiceBridge.js';

/**
 * Main execution and reasoning engine for the BDI Agent.
 */
export class IntentionEngine {
    /**
     * Creates an IntentionEngine instance.
     * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
     * @param {Object} socket - Deliveroo Socket.io client.
     */
    constructor(beliefs, socket) {
        /** @type {import('./BeliefBase.js').BeliefBase} */
        this.beliefs = beliefs;
        /** @type {Object} */
        this.socket = socket;

        /**
         * The active generator plan.
         * @type {Generator|null}
         */
        this.activeGenerator = null;

        /**
         * History stack for pre-empted plan generators.
         * @type {Array<{generator: Generator, goal: Object}>}
         */
        this.suspendedStack = [];

        /**
         * Current executing goal descriptor.
         * @type {{type: string, targetId: string|null, x: number|null, y: number|null}|null}
         */
        this.currentGoal = null;

        /**
         * Collision count history for the current path step.
         * @type {number}
         */
        this.collisionCounter = 0;

        /**
         * The execution success status of the last dispatched action.
         * @type {boolean}
         */
        this.lastActionSuccess = true;

        /**
         * Tick counter for throttling goal re-evaluation.
         * Full A* scoring runs every GOAL_EVAL_INTERVAL ticks.
         * @type {number}
         */
        this.tickCounter = 0;

        /**
         * How often (in ticks) to re-evaluate goals. At 60Hz, 12 ticks ≈ 200ms.
         * @type {number}
         */
        this.GOAL_EVAL_INTERVAL = 12;

        /**
         * When true, the agent MUST deliver before considering any new pickups.
         * Set after a successful pickup, cleared after a successful putdown.
         * This is a high-priority override that prevents the evaluation engine
         * from interrupting delivery with new pickup goals.
         * @type {boolean}
         */
        this.mustDeliver = false;
        
        /**
         * Cached size of carried inventory to detect changes.
         * @type {number}
         */
        this.lastCarriedLength = 0;

        /**
         * Track execution performance stats dynamically.
         * Initialized to low, realistic default values.
         */
        this.actionStats = {
            move: { count: 0, totalTime: 0, avgTime: 50 },
            pickup: { count: 0, totalTime: 0, avgTime: 20 },
            putdown: { count: 0, totalTime: 0, avgTime: 20 }
        };

        /**
         * Dynamically computed capacity limit.
         * Default to 8 if not configured to allow active detours from start.
         */
        this.dynamicCapacityLimit = 8;

        /**
         * Track sequence start time and carried count for efficiency calculation.
         */
        this.sequenceStartTime = null;
        this.sequenceCarriedCount = 0;

        /**
         * Track last required stack size to detect coordinator policy changes.
         */
        this.lastRequiredStackSize = null;

        /**
         * Throttled timestamp to send status updates directly to peers.
         */
        this.lastBroadcastTime = 0;

        /**
         * Tracks recently failed PDDL solve attempts to prevent solver spam.
         * Key: "crateX,crateY->goalX,goalY", Value: timestamp.
         * @type {Map<string, number>}
         */
        this.failedPddlSolves = new Map();

        /**
         * Tracks delivery zones that are confirmed unreachable (all paths blocked).
         * Key: "x,y", Value: timestamp.
         * Expires after 10 seconds.
         * @type {Map<string, number>}
         */
        this.blockedDeliveryZones = new Map();
    }

    /**
     * Determines the direction string between two adjacent coordinates.
     * @param {{x: number, y: number}} me - Agent current coordinate.
     * @param {{x: number, y: number}} target - Target coordinate.
     * @returns {"up"|"down"|"left"|"right"|null} Direction string.
     */
    getDirection(me, target) {
        if (me.x < target.x) return 'right';
        if (me.x > target.x) return 'left';
        if (me.y < target.y) return 'up';
        if (me.y > target.y) return 'down';
        return null;
    }

    /**
     * Evaluates policy rules (multipliers, bonuses) for a projected delivery.
     * @param {number} baseReward - The base reward before modifications.
     * @param {Object} projectedState - Mock state representing delivery conditions.
     * @returns {number} The policy-adjusted reward.
     */
    evaluatePolicyReward(baseReward, projectedState) {
        let reward = baseReward;
        
        // Context object for evaluateExpression
        const context = {
            beliefs: this.beliefs,
            variables: this.beliefs.variables,
            me: {
                x: projectedState.x !== undefined ? projectedState.x : this.beliefs.me.x,
                y: projectedState.y !== undefined ? projectedState.y : this.beliefs.me.y,
                score: this.beliefs.me.score,
                status: this.beliefs.me.status
            },
            carried: {
                length: projectedState.carriedSize !== undefined ? projectedState.carriedSize : this.beliefs.carried.length
            }
        };

        // 1. Apply multiplier rules
        if (this.beliefs.policyRules && this.beliefs.policyRules.multiplierRules) {
            for (const rule of this.beliefs.policyRules.multiplierRules) {
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
        if (this.beliefs.policyRules && this.beliefs.policyRules.bonusRules) {
            for (const rule of this.beliefs.policyRules.bonusRules) {
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
     * @returns {{type: string, targetId: string|null, x: number|null, y: number|null}} Goal descriptor.
     */
    selectBestGoal() {
        // 1. Prioritize coordinator direct MOVE_TO commands
        const adminMove = this.beliefs.activeContracts.get('admin_move');
        if (adminMove && adminMove.status === 'ACTIVE') {
            return {
                type: 'admin_move',
                targetId: null,
                x: adminMove.x,
                y: adminMove.y
            };
        }

        // Check if policy rule for requiredStackSize changed and update dynamic baseline
        const currentRequiredStack = this.beliefs.policyRules.requiredStackSize;
        if (currentRequiredStack !== this.lastRequiredStackSize) {
            this.lastRequiredStackSize = currentRequiredStack;
            if (currentRequiredStack !== null && currentRequiredStack !== undefined) {
                this.dynamicCapacityLimit = currentRequiredStack;
                console.log(`[BDI Adapt] Reset dynamicCapacityLimit to policy rule: ${currentRequiredStack}`);
            }
        }

        // --- Compute time-per-step and decay values ---
        const msPerStep = this.beliefs.movementDurationMs || 500;
        const decayMs = this.beliefs.parcelDecayIntervalMs;
        const decayEnabled = isFinite(decayMs) && decayMs > 0;

        const avgMoveTime = this.actionStats.move.count > 0 
            ? this.actionStats.move.avgTime 
            : (this.beliefs.movementDurationMs || 100);
        const avgPickupTime = this.actionStats.pickup.count > 0 
            ? this.actionStats.pickup.avgTime 
            : 20;
        const avgPutdownTime = this.actionStats.putdown.count > 0 
            ? this.actionStats.putdown.avgTime 
            : 20;
        const decayPerMs = decayEnabled ? (1 / decayMs) : 0;

        // 2. If carrying parcels, evaluate: deliver now vs. pick up one more
        if (this.beliefs.carried.length > 0) {
            let capacity = this.beliefs.config?.GAME?.player?.capacity;
            if (capacity === undefined || capacity < 0) {
                capacity = Infinity;
            }
            console.log(`[BDI Debug] selectBestGoal carrying: capacity=${capacity}, dynamicLimit=${this.dynamicCapacityLimit}, carried=${this.beliefs.carried.length}`);
            
            const deliveryZone = findNearestDeliveryZone(this.beliefs, this.beliefs.me.x, this.beliefs.me.y, this.blockedDeliveryZones);
            const deliveryDist = deliveryZone
                ? pathDistance(this.beliefs, this.beliefs.me.x, this.beliefs.me.y, deliveryZone.x, deliveryZone.y, true)
                : Infinity;

            // At capacity → must deliver
            if (this.beliefs.carried.length >= capacity) {
                if (deliveryZone) {
                    return {
                        type: 'deliver',
                        targetId: null,
                        x: deliveryZone.x,
                        y: deliveryZone.y
                    };
                }
                // All delivery zones blocked — fall through to patrol
                console.log(`[BDI] At capacity but ALL delivery zones blocked. Falling through to patrol.`);
                const spawnZone = findPatrolSpawnZone(this.beliefs, this.beliefs.me.x, this.beliefs.me.y);
                if (spawnZone) {
                    return { type: 'patrol_spawn', targetId: null, x: spawnZone.x, y: spawnZone.y };
                }
                return { type: 'patrol', targetId: null, x: null, y: null };
            }

            // Estimate direct delivery time
            const T_direct = isFinite(deliveryDist)
                ? (deliveryDist * avgMoveTime + avgPutdownTime)
                : Infinity;

            const safetyMarginMs = 1 * avgMoveTime;
            const atDynamicLimit = (this.beliefs.carried.length >= this.dynamicCapacityLimit);

            // Compute utility of delivering now, adjusted by policy rules
            let carriedRewardSum = 0;
            for (const cid of this.beliefs.carried) {
                const cp = this.beliefs.parcels.get(cid);
                if (cp) {
                    carriedRewardSum += cp.reward;
                }
            }

            const carriedDecay = decayEnabled ? (T_direct * decayPerMs) * this.beliefs.carried.length : 0;
            const carriedValueAtDelivery = Math.max(0, carriedRewardSum - carriedDecay);
            const utilityDeliver = this.evaluatePolicyReward(carriedValueAtDelivery, {
                carriedSize: this.beliefs.carried.length,
                x: deliveryZone ? deliveryZone.x : this.beliefs.me.x,
                y: deliveryZone ? deliveryZone.y : this.beliefs.me.y
            }) / (T_direct + 1);

            let bestPickup = null;
            let bestPickupUtility = -Infinity;

            const candidates = [];
            for (const parcel of this.beliefs.parcels.values()) {
                if (parcel.carriedBy) continue;
                if (this.beliefs.carried.includes(parcel.id)) continue;
                if (this.beliefs.lockedTargets.has(parcel.id)) continue;
                if (this.beliefs.blockedTargets.has(parcel.id) || this.beliefs.blockedTargets.has(`${parcel.x},${parcel.y}`)) continue;
                if (parcel.reward < this.beliefs.policyRules.minRewardThreshold) continue;
                if (parcel.reward > this.beliefs.policyRules.maxRewardLimit) continue;
                
                const mDist = Math.abs(parcel.x - this.beliefs.me.x) + Math.abs(parcel.y - this.beliefs.me.y);
                candidates.push({ parcel, mDist, roughUtil: parcel.reward / (mDist + 1) });
            }
            candidates.sort((a, b) => b.roughUtil - a.roughUtil);

            for (const { parcel } of candidates.slice(0, 5)) {
                const distToParcel = pathDistance(
                    this.beliefs, this.beliefs.me.x, this.beliefs.me.y, parcel.x, parcel.y, true
                );
                if (!isFinite(distToParcel)) continue;

                const deliveryZoneFromParcel = findNearestDeliveryZone(this.beliefs, parcel.x, parcel.y);
                const deliveryDistFromP = deliveryZoneFromParcel
                    ? pathDistance(this.beliefs, parcel.x, parcel.y, deliveryZoneFromParcel.x, deliveryZoneFromParcel.y, true)
                    : Infinity;
                if (!isFinite(deliveryDistFromP)) continue;

                const T_detour = (distToParcel + deliveryDistFromP) * avgMoveTime + avgPickupTime + avgPutdownTime;

                // Project remaining reward of carried parcels after detour
                let carriedRewardAfterDetour = 0;
                let carriedRewardDirect = 0;
                for (const cid of this.beliefs.carried) {
                    const cp = this.beliefs.parcels.get(cid);
                    if (cp) {
                        if (decayEnabled) {
                            carriedRewardAfterDetour += Math.max(0, cp.reward - ((T_detour + safetyMarginMs) * decayPerMs));
                            carriedRewardDirect += Math.max(0, cp.reward - (T_direct * decayPerMs));
                        } else {
                            carriedRewardAfterDetour += cp.reward;
                            carriedRewardDirect += cp.reward;
                        }
                    }
                }

                // Project remaining reward of new parcel after detour
                let newParcelRewardAfterDetour = 0;
                if (decayEnabled) {
                    newParcelRewardAfterDetour = Math.max(0, parcel.reward - ((T_detour + safetyMarginMs) * decayPerMs));
                } else {
                    newParcelRewardAfterDetour = parcel.reward;
                }

                const totalRewardAfterDetour = carriedRewardAfterDetour + newParcelRewardAfterDetour;
                const totalRewardDirect = carriedRewardDirect;

                // We detour if the new parcel doesn't completely decay,
                // and the total reward obtained is competitive (at least 80% of direct reward, allowing detour tolerance).
                const canDeliverInTimeAfterDetour = (newParcelRewardAfterDetour > 0) && (totalRewardAfterDetour >= totalRewardDirect * 0.8);
                
                const extraSteps = (distToParcel + deliveryDistFromP) - deliveryDist;
                const isMovingBackwards = (deliveryDistFromP > deliveryDist);

                let allowed = false;
                if (atDynamicLimit) {
                    // At limit: only detour if it's very cheap/safe and along the path (extraSteps <= 15)
                    if ((canDeliverInTimeAfterDetour || (extraSteps <= 15 && carriedRewardAfterDetour > 0)) && extraSteps <= 15 && !isMovingBackwards) {
                        allowed = true;
                    }
                } else {
                    // Below limit: allowed if safe and profitable (up to 120 steps detour), or cheap detour along the path (extraSteps <= 30)
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

                // Total reward value at delivery with detour, adjusted by policy rules
                const remainingReward = Math.max(0, totalRewardAfterDetour);
                const adjustedDetourReward = this.evaluatePolicyReward(remainingReward, {
                    carriedSize: this.beliefs.carried.length + 1,
                    x: deliveryZoneFromParcel.x,
                    y: deliveryZoneFromParcel.y
                });

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
                    y: bestPickup.y
                };
            } else if (deliveryZone) {
                console.log(`[BDI] Heading to deliver (utilityDeliver=${utilityDeliver.toFixed(3)} >= bestPickupUtility=${bestPickupUtility.toFixed(3)})`);
                return {
                    type: 'deliver',
                    targetId: null,
                    x: deliveryZone.x,
                    y: deliveryZone.y
                };
            } else {
                console.log(`[BDI] Want to deliver but ALL delivery zones blocked. Falling through.`);
            }
        }

        // 3. Evaluate available parcels with expiration-aware utility.
        //    Use Manhattan pre-filter to limit expensive A* calls to top candidates.
        let bestParcel = null;
        let bestUtility = -Infinity;

        const deliveryZoneForScoring = findNearestDeliveryZone(this.beliefs, this.beliefs.me.x, this.beliefs.me.y);

        // Fast pre-filter: score all parcels with Manhattan, only A* the top 5
        const parcelCandidates = [];
        for (const parcel of this.beliefs.parcels.values()) {
            if (parcel.carriedBy) continue;
            if (this.beliefs.carried.includes(parcel.id)) continue;
            if (this.beliefs.lockedTargets.has(parcel.id)) continue;
            if (this.beliefs.blockedTargets.has(parcel.id) || this.beliefs.blockedTargets.has(`${parcel.x},${parcel.y}`)) continue;
            if (parcel.reward < this.beliefs.policyRules.minRewardThreshold) continue;
            if (parcel.reward > this.beliefs.policyRules.maxRewardLimit) continue;

            const mDist = Math.abs(parcel.x - this.beliefs.me.x) + Math.abs(parcel.y - this.beliefs.me.y);
            const roughUtility = parcel.reward / (mDist + 1);
            parcelCandidates.push({ parcel, roughUtility });
        }
        parcelCandidates.sort((a, b) => b.roughUtility - a.roughUtility);

        for (const { parcel } of parcelCandidates.slice(0, 5)) {
            // Full A* distance for accurate pathing
            const distToParcel = pathDistance(
                this.beliefs, this.beliefs.me.x, this.beliefs.me.y, parcel.x, parcel.y, true
            );
            if (!isFinite(distToParcel)) continue;

            // Estimate distance from parcel to nearest delivery zone
            const distToDelivery = deliveryZoneForScoring
                ? pathDistance(this.beliefs, parcel.x, parcel.y, deliveryZoneForScoring.x, deliveryZoneForScoring.y, true)
                : Infinity;
            if (!isFinite(distToDelivery)) continue;

            const totalTripMs = (distToParcel + distToDelivery) * avgMoveTime + avgPickupTime + avgPutdownTime;

            // Project reward at delivery time
            let projectedReward;
            if (decayEnabled) {
                projectedReward = parcel.reward - (totalTripMs * decayPerMs);
            } else {
                projectedReward = parcel.reward;
            }

            if (projectedReward <= 0) continue; // Would expire before delivery

            const adjustedReward = this.evaluatePolicyReward(projectedReward, {
                carriedSize: 1,
                x: deliveryZoneForScoring ? deliveryZoneForScoring.x : this.beliefs.me.x,
                y: deliveryZoneForScoring ? deliveryZoneForScoring.y : this.beliefs.me.y
            });
            if (adjustedReward <= 0) continue;

            const utility = adjustedReward / (totalTripMs + 1);
            if (utility > bestUtility) {
                bestUtility = utility;
                bestParcel = parcel;
            }
        }

        if (bestParcel) {
            return { type: 'pickup', targetId: bestParcel.id, x: bestParcel.x, y: bestParcel.y };
        }

        // 4. If carrying parcels but found nothing better, deliver what we have
        if (this.beliefs.carried.length > 0) {
            const fallbackDelivery = findNearestDeliveryZone(this.beliefs, this.beliefs.me.x, this.beliefs.me.y, this.blockedDeliveryZones);
            if (fallbackDelivery) {
                return {
                    type: 'deliver',
                    targetId: null,
                    x: fallbackDelivery.x,
                    y: fallbackDelivery.y
                };
            }
        }

        // 5. Fallback to navigating to a spawn zone to collect parcels (smart patrolling).
        const spawnZone = findPatrolSpawnZone(this.beliefs, this.beliefs.me.x, this.beliefs.me.y);
        if (spawnZone) {
            return { type: 'patrol_spawn', targetId: null, x: spawnZone.x, y: spawnZone.y };
        }

        // 6. Absolute fallback to random patrolling.
        return { type: 'patrol', targetId: null, x: null, y: null };
    }

    /**
     * Checks if a newly selected goal should preempt the active plan.
     * @param {{type: string, targetId: string|null, x: number|null, y: number|null}} bestGoal - New goal.
     * @returns {boolean} True if the engine should preempt.
     */
    shouldPreemptActivePlan(bestGoal) {
        if (!this.activeGenerator) return true;
        if (!this.currentGoal) return true;

        // clear_corridor should never be preempted except by admin_move.
        if (this.currentGoal.type === 'clear_corridor' && bestGoal.type !== 'admin_move') {
            return false;
        }

        // admin_move always preempts everything.
        if (bestGoal.type === 'admin_move' && this.currentGoal.type !== 'admin_move') {
            return true;
        }

        // Cooperative contracts (e.g. rendezvous drop) always preempt normal tasks.
        const activeContracts = Array.from(this.beliefs.activeContracts.values());
        if (activeContracts.length > 0 && this.currentGoal.type !== 'rendezvous' && this.currentGoal.type !== 'admin_move') {
            return true;
        }

        // deliveries preempt everything except admin_move and active deliveries.
        if (bestGoal.type === 'deliver' && 
            this.currentGoal.type !== 'deliver' && 
            this.currentGoal.type !== 'admin_move') {
            return true;
        }

        // If we are currently delivering, allow pickup to preempt (e.g. for along-the-path detours).
        if (this.currentGoal.type === 'deliver' && bestGoal.type === 'pickup') {
            return true;
        }

        // pickups preempt patrols.
        if (bestGoal.type === 'pickup' && 
            (this.currentGoal.type === 'patrol' || this.currentGoal.type === 'patrol_spawn') && 
            this.currentGoal.type !== 'admin_move') {
            return true;
        }

        // If target parcel changed (and we're not in delivery phase).
        if (bestGoal.type === 'pickup' && this.currentGoal.type === 'pickup' && bestGoal.targetId !== this.currentGoal.targetId) {
            return true;
        }

        return false;
    }

    /**
     * Generator function representing the default patrolling behavior.
     * @yields {Object} Yields move action steps.
     * @private
     */
    * _patrolRecipe() {
        if (!this.beliefs.map) return;
        const neighbors = this.beliefs.map.getNeighbors(this.beliefs.me);
        const clearNeighbors = neighbors.filter(n => {
            const hasCrate = Array.from(this.beliefs.crates.values()).some(c => Math.round(c.x) === n.x && Math.round(c.y) === n.y);
            const hasPeer = Array.from(this.beliefs.peers.values()).some(p => Math.round(p.x) === n.x && Math.round(p.y) === n.y);
            return !hasCrate && !hasPeer;
        });
        const candidates = clearNeighbors.length > 0 ? clearNeighbors : neighbors;
        if (candidates.length > 0) {
            const randNeighbor = candidates[Math.floor(Math.random() * candidates.length)];
            yield { action: 'move', target: randNeighbor };
        }
    }

    /**
     * Generator function representing delivery of carried parcels.
     * @yields {Object} Yields delivery steps.
     * @private
     */
    * _deliverRecipe(targetX, targetY) {
        if (targetX !== null && targetY !== null) {
            yield* NavigateTo(this.beliefs, targetX, targetY);
            // Only drop if we actually reached a delivery zone tile (tile code 2)
            if (this.beliefs.map && this.beliefs.map.getTileCode(this.beliefs.me.x, this.beliefs.me.y) === 2) {
                yield { action: 'putdown' };
            }
        }
    }

    /**
     * Instantiates the generator plan recipe corresponding to the target goal.
     * @param {{type: string, targetId: string|null, x: number|null, y: number|null}} goal - Target goal.
     * @returns {Generator} The instantiated generator.
     */
    instantiatePlanRecipe(goal) {
        this.currentGoal = goal;
        switch (goal.type) {
            case 'admin_move':
                return (function* (beliefs, tx, ty, self) {
                    yield* NavigateTo(beliefs, tx, ty);
                    beliefs.activeContracts.delete('admin_move');
                })(this.beliefs, goal.x, goal.y, this);
            case 'deliver':
                return this._deliverRecipe(goal.x, goal.y);
            case 'pickup':
                return CollectAndDeliver(this.beliefs, goal.targetId);
            case 'patrol_spawn':
                return (function* (beliefs, tx, ty) {
                    yield* NavigateTo(beliefs, tx, ty);
                })(this.beliefs, goal.x, goal.y);
            case 'clear_corridor':
                return this._patrolRecipe();
            case 'patrol':
            default:
                return this._patrolRecipe();
        }
    }

    /**
     * Executes a single reasoning and action cycle tick of the BDI agent.
     */
    async tick() {
        // Enforce coordinator holds (e.g. red light constraints)
        if (this.beliefs.hold) {
            console.log('[BDI] Agent is currently in a HOLD state (movement paused).');
            return;
        }

        // 0. Opportunistic pickup: if there is a parcel on our current tile, and we are below capacity, pick it up!
        let capacity = this.beliefs.config?.GAME?.player?.capacity;
        if (capacity === undefined || capacity < 0) capacity = Infinity;
        if (this.beliefs.carried.length < capacity) {
            const currentX = Math.round(this.beliefs.me.x);
            const currentY = Math.round(this.beliefs.me.y);
            const parcelHere = Array.from(this.beliefs.parcels.values()).find(
                p => !p.carriedBy && Math.round(p.x) === currentX && Math.round(p.y) === currentY
            );
            if (parcelHere) {
                console.log(`[BDI Opportunistic] Found parcel ${parcelHere.id} on our current tile (${currentX}, ${currentY}). Picking it up.`);
                const success = await this.dispatchAction({ action: 'pickup', target: parcelHere.id });
                if (success) {
                    this.tickCounter = this.GOAL_EVAL_INTERVAL; // Force immediate goal evaluation on next tick
                    return;
                }
            }
        }

        // Periodically send peer status directly to the peer agent ID
        const now = Date.now();
        if (now - this.lastBroadcastTime >= 300) {
            this.lastBroadcastTime = now;
            await this.broadcastStatus();

            // Periodic cleanup of stale PDDL failure records
            for (const [key, ts] of this.failedPddlSolves.entries()) {
                if (now - ts > 30000) this.failedPddlSolves.delete(key);
            }
            for (const [key, ts] of this.blockedDeliveryZones.entries()) {
                if (now - ts > 10000) this.blockedDeliveryZones.delete(key);
            }
        }

        if (this.beliefs.carried.length !== this.lastCarriedLength) {
            this.tickCounter = this.GOAL_EVAL_INTERVAL;
            this.lastCarriedLength = this.beliefs.carried.length;
        }

        // 1. Evaluate option utilities periodically (throttled to avoid expensive A* on every tick)
        this.tickCounter++;
        if (this.tickCounter >= this.GOAL_EVAL_INTERVAL || !this.activeGenerator) {
            this.tickCounter = 0;
            const bestGoal = this.selectBestGoal();

            // Check if this goal is blocked by a crate (only if not already clearing one)
            let pddlMoves = null;
            if (this.currentGoal?.type !== 'clear_corridor' && bestGoal && bestGoal.x !== null && bestGoal.y !== null && this.beliefs.map) {
                const pathNormal = findAStarPath(
                    this.beliefs.map,
                    { x: this.beliefs.me.x, y: this.beliefs.me.y },
                    { x: bestGoal.x, y: bestGoal.y },
                    this.beliefs.policyRules,
                    this.beliefs
                );
                if (!pathNormal || pathNormal.length < 2) {
                    const pathIgnoreCrates = findAStarPath(
                        this.beliefs.map,
                        { x: this.beliefs.me.x, y: this.beliefs.me.y },
                        { x: bestGoal.x, y: bestGoal.y },
                        this.beliefs.policyRules,
                        null
                    );
                    if (pathIgnoreCrates && pathIgnoreCrates.length >= 2) {
                        let firstCrate = null;
                        for (const step of pathIgnoreCrates) {
                            const crate = Array.from(this.beliefs.crates.values()).find(c => c.x === step.x && c.y === step.y);
                            if (crate) {
                                firstCrate = crate;
                                break;
                            }
                        }
                        if (firstCrate) {
                            // Check if we recently failed to solve for this crate
                            const targetTile = this.findClearCrateCapableTile(firstCrate);
                            const pddlKey = targetTile
                                ? `${firstCrate.x},${firstCrate.y}->${targetTile.x},${targetTile.y}`
                                : `${firstCrate.x},${firstCrate.y}->null`;
                            const lastFail = this.failedPddlSolves.get(pddlKey);
                            const pddlCooldownMs = 30000; // 30s cooldown

                            if (lastFail && (Date.now() - lastFail) < pddlCooldownMs) {
                                console.log(`[PDDL Throttle] Skipping solver for crate at (${firstCrate.x}, ${firstCrate.y}) — failed ${((Date.now() - lastFail) / 1000).toFixed(1)}s ago (cooldown: ${pddlCooldownMs / 1000}s).`);
                            } else if (targetTile) {
                                console.log(`[PDDL Trigger] Path to goal (${bestGoal.x}, ${bestGoal.y}) blocked by crate at (${firstCrate.x}, ${firstCrate.y}). Resolving push to (${targetTile.x}, ${targetTile.y}).`);
                                // Try local push solver first (0ms, no block)
                                const localMoves = this.solveObstaclePushLocally(firstCrate, targetTile);
                                if (localMoves && localMoves.length > 0) {
                                    console.log(`[BDI Plan] Found local push plan of ${localMoves.length} steps. Executing without PDDL solver.`);
                                    pddlMoves = localMoves;
                                } else {
                                    console.log(`[BDI Plan] Local push solver failed or blocked. Falling back to PDDL solver...`);
                                    const bridge = new PddlServiceBridge();
                                    const pddlPlan = await bridge.solveObstaclePush(
                                        this.beliefs.map,
                                        this.beliefs,
                                        firstCrate,
                                        targetTile
                                    );
                                    if (pddlPlan && pddlPlan.length > 0) {
                                        pddlMoves = this.translatePddlPlanToMoves(pddlPlan);
                                    } else {
                                        console.log(`[PDDL] Solver failed. Recording cooldown for key: ${pddlKey}`);
                                        this.failedPddlSolves.set(pddlKey, Date.now());
                                    }
                                }
                            }
                            if (!pddlMoves || pddlMoves.length === 0) {
                                console.log(`[BDI Block] Goal (${bestGoal.x}, ${bestGoal.y}) blocked by unpushable crate at (${firstCrate.x}, ${firstCrate.y}) (or solver failed). Temporarily blocking target.`);
                                const blockKey = `${bestGoal.x},${bestGoal.y}`;
                                this.beliefs.blockedTargets.set(blockKey, Date.now());
                                if (bestGoal.targetId) {
                                    this.beliefs.blockedTargets.set(bestGoal.targetId, Date.now());
                                }
                                // Also mark delivery zone as blocked for a longer period
                                if (bestGoal.type === 'deliver') {
                                    this.blockedDeliveryZones.set(blockKey, Date.now());
                                }
                            }
                        }
                    }
                }
            }

            if (pddlMoves && pddlMoves.length > 0) {
                if (this.activeGenerator) {
                    if (this.currentGoal.type !== 'clear_corridor') {
                        console.log(`[BDI] Path blocked by crate. Suspending active plan (${this.currentGoal.type}) to clear corridor.`);
                        this.suspendedStack.push({ generator: this.activeGenerator, goal: this.currentGoal });
                    } else {
                        console.log(`[BDI] Discarding active clear_corridor plan as it is overridden by a new corridor clear task.`);
                    }
                }
                this.currentGoal = { type: 'clear_corridor', targetId: null, x: null, y: null };
                this.activeGenerator = this._executePddlPlanRecipe(pddlMoves);
            } else if (this.shouldPreemptActivePlan(bestGoal)) {
                if (this.activeGenerator) {
                    // When switching to delivery, discard all stale plans
                    // instead of pushing them — prevents resuming old generators
                    // that walk the agent back to where it came from.
                    if (bestGoal.type === 'deliver') {
                        console.log(`[BDI] Transitioning to delivery: discarding plan (${this.currentGoal.type}) and clearing ${this.suspendedStack.length} suspended plans.`);
                        this.suspendedStack = [];
                    } else if (this.currentGoal.type === 'clear_corridor') {
                        console.log(`[BDI] Discarding active clear_corridor plan on goal transition to ${bestGoal.type}.`);
                    } else {
                        console.log(`[BDI] Preempting active plan (${this.currentGoal.type}). Suspending context...`);
                        this.suspendedStack.push({ generator: this.activeGenerator, goal: this.currentGoal });
                    }
                }
                this.beliefs.me.nextStep = null;
                this.beliefs.me.path = [];
                this.activeGenerator = this.instantiatePlanRecipe(bestGoal);
            }
        }

        // 2. Step the active plan generator by one step, passing last action feedback
        if (this.activeGenerator) {
            const stepResult = this.activeGenerator.next(this.lastActionSuccess);

            if (stepResult.done) {
                console.log(`[BDI] Plan ${this.currentGoal.type} completed.`);
                // Resume previous plan from the stack, but skip stale ones
                let resumed = false;
                while (this.suspendedStack.length > 0) {
                    const suspended = this.suspendedStack.pop();
                    // Skip stale clear_corridor plans
                    if (suspended.goal.type === 'clear_corridor') {
                        console.log(`[BDI] Discarding stale suspended plan (${suspended.goal.type}).`);
                        continue;
                    }
                    // Skip stale pickup plans if the target parcel no longer exists
                    if (suspended.goal.type === 'pickup') {
                        const targetExists = this.beliefs.parcels.has(suspended.goal.targetId);
                        if (!targetExists) {
                            console.log(`[BDI] Discarding stale suspended plan (${suspended.goal.type}) for parcel ${suspended.goal.targetId} (no longer exists).`);
                            continue;
                        }
                    }
                    this.activeGenerator = suspended.generator;
                    this.currentGoal = suspended.goal;
                    console.log(`[BDI] Resumed suspended plan (${this.currentGoal.type}).`);
                    resumed = true;
                    break;
                }
                if (!resumed) {
                    this.activeGenerator = null;
                    this.currentGoal = null;
                }
                this.lastActionSuccess = true; // reset on completion
                this.tickCounter = this.GOAL_EVAL_INTERVAL; // Force immediate goal evaluation on next tick
            } else {
                // Execute physical action yielded by the generator
                const action = stepResult.value;
                this.lastActionSuccess = await this.dispatchAction(action);
            }
        }
    }

    /**
     * Dispatches the yielded action token to the simulation server socket.
     * @param {{action: string, target: any, payload: Object}} action - The action token.
     */
    async dispatchAction(action) {
        if (!action) return false;
        const startTime = Date.now();
        let success = false;

        switch (action.action) {
            case 'move': {
                const target = action.target;
                if (!this.beliefs.map?.isAdjacent(this.beliefs.me, target)) {
                    console.warn(`[BDI] Invalid move attempt to (${target.x}, ${target.y}) blocked by map constraints.`);
                    success = false;
                    break;
                }
                const dir = this.getDirection(this.beliefs.me, target);
                if (!dir) {
                    success = false;
                    break;
                }

                // Check for head-on collision (peer is on target tile, and peer's nextStep is our current position)
                const peerConflict = Array.from(this.beliefs.peers.values()).find(peer => {
                    const px = Math.round(peer.x);
                    const py = Math.round(peer.y);
                    return px === target.x && py === target.y;
                });

                if (peerConflict) {
                    const peerNext = peerConflict.nextStep;
                    const isHeadOn = peerNext && Math.round(peerNext.x) === this.beliefs.me.x && Math.round(peerNext.y) === this.beliefs.me.y;

                    // Lower priority (higher alphabetical ID) yields to avoid deadlocks
                    if (isHeadOn && this.beliefs.me.id > peerConflict.id) {
                        console.log(`[BDI Yield] Head-on conflict with ${peerConflict.id} at (${target.x}, ${target.y}). Yielding priority.`);
                        await new Promise(resolve => setTimeout(resolve, 150));
                        success = false;
                        break;
                    }
                }

                // Check for target collision race (peer nextStep is also target tile)
                const peerNextConflict = Array.from(this.beliefs.peers.values()).find(peer => {
                    const peerNext = peer.nextStep;
                    return peerNext && Math.round(peerNext.x) === target.x && Math.round(peerNext.y) === target.y;
                });

                if (peerNextConflict && this.beliefs.me.id > peerNextConflict.id) {
                    console.log(`[BDI Yield] Target collision race with ${peerNextConflict.id} for tile (${target.x}, ${target.y}). Yielding priority.`);
                    await new Promise(resolve => setTimeout(resolve, 150));
                    success = false;
                    break;
                }

                console.log(`[BDI] Attempting move: ${dir} to (${target.x}, ${target.y})`);

                const result = await this.socket.emitMove(dir);

                if (result) {
                    const oldX = this.beliefs.me.x;
                    const oldY = this.beliefs.me.y;
                    this.beliefs.me.x = result.x;
                    this.beliefs.me.y = result.y;
                    
                    // If a crate was on the tile we moved to, it was pushed collinear
                    const pushedCrate = Array.from(this.beliefs.crates.values()).find(
                        c => c.x === result.x && c.y === result.y
                    );
                    if (pushedCrate) {
                        const dx = result.x - oldX;
                        const dy = result.y - oldY;
                        pushedCrate.x = result.x + dx;
                        pushedCrate.y = result.y + dy;
                        console.log(`[BDI] Crate ${pushedCrate.id} pushed from (${result.x}, ${result.y}) to (${pushedCrate.x}, ${pushedCrate.y})`);
                    }
                    
                    this.collisionCounter = 0; // Reset collision count
                    success = true;
                } else {
                    console.warn(`[BDI] Move failed to (${target.x}, ${target.y}) - Collision detected.`);
                    this.logActionFailure(action, 'Move failed (collision detected)');
                    this.collisionCounter++;

                    if (this.collisionCounter >= 2) {
                        const blockKey = `${target.x},${target.y}`;
                        this.beliefs.blockedTargets.set(blockKey, Date.now());
                        console.log(`[BDI] Path step ${blockKey} blocked due to repeated collisions, forcing bypass.`);
                    }

                    if (this.collisionCounter <= 2) {
                        console.log(`[BDI] Tier 1 Collision: Waiting 1 tick (Count: ${this.collisionCounter}).`);
                        await new Promise(resolve => setTimeout(resolve, 100)); // Short wait
                    } else {
                        console.log('[BDI] Tier 2 Collision: Preempting current path to compute bypass.');
                        if (this.currentGoal && this.currentGoal.type === 'clear_corridor') {
                            console.log('[BDI] Corridor clearing failed repeatedly. Aborting clear_corridor plan.');
                            this.activeGenerator = null;
                            this.currentGoal = null;
                        } else {
                            this.activeGenerator = this.instantiatePlanRecipe(this.currentGoal);
                        }
                        this.collisionCounter = 0;
                    }
                    success = false;
                }
                break;
            }

            case 'pickup': {
                const parcelId = action.target;
                console.log(`[BDI] Attempting pickup for parcel: ${parcelId}`);
                const picked = await this.socket.emitPickup();

                if (picked && picked.length > 0) {
                    console.log(`[BDI] Pickup successful:`, picked);
                    const matchedIds = new Set();
                    for (const p of picked) {
                        let id = (p && typeof p === 'object') ? p.id : p;
                        if (!id && p && typeof p === 'object' && p.xy) {
                            const match = Array.from(this.beliefs.parcels.values()).find(
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
                        if (id && !this.beliefs.carried.includes(id)) {
                            this.beliefs.carried.push(id);
                        }
                    }
                    this.mustDeliver = true;
                    console.log('[BDI] mustDeliver flag SET — will deliver before considering new pickups.');
                    success = true;
                } else {
                    console.warn(`[BDI] Pickup failed for parcel ${parcelId}.`);
                    this.logActionFailure(action, 'Pickup failed (decayed or already collected)');
                    this.beliefs.parcels.delete(parcelId);
                    this.beliefs.lockedTargets.delete(parcelId);
                    success = false;
                }
                break;
            }

            case 'putdown': {
                console.log('[BDI] Attempting cargo drop (putdown).');
                const dropped = await this.socket.emitPutdown(action.target ? [action.target] : []);

                if (dropped) {
                    console.log('[BDI] Cargo successfully dropped:', dropped);
                    if (action.target) {
                        this.beliefs.carried = this.beliefs.carried.filter(id => id !== action.target);
                    } else {
                        this.beliefs.carried = [];
                    }
                    this.mustDeliver = false;
                    console.log('[BDI] mustDeliver flag CLEARED — free to evaluate new pickups.');
                    success = true;
                } else {
                    console.warn('[BDI] Cargo drop failed.');
                    this.logActionFailure(action, 'Putdown failed');
                    success = false;
                }
                break;
            }

            case 'say': {
                const message = action.payload;
                console.log('[BDI] Sending P2P chat sync message:', message);
                const peerId = this.getPeerAgentId();
                if (peerId) {
                    try {
                        await this.socket.emitSay(peerId, JSON.stringify(message));
                        success = true;
                        break;
                    } catch (e) {
                        // fallback to shout
                    }
                }
                await this.socket.emitShout(JSON.stringify(message));
                success = true;
                break;
            }
        }

        const elapsed = Date.now() - startTime;
        if (action.action in this.actionStats) {
            const stats = this.actionStats[action.action];
            stats.count++;
            stats.totalTime += elapsed;
            stats.avgTime = stats.totalTime / stats.count;
            console.log(`[BDI Stats] ${action.action} took ${elapsed}ms (avg: ${stats.avgTime.toFixed(1)}ms). Count=${stats.count}`);
        }

        if (success) {
            if (action.action === 'pickup') {
                if (this.beliefs.carried.length === 1) {
                    this.sequenceStartTime = Date.now();
                    this.sequenceCarriedCount = 1;
                } else if (this.beliefs.carried.length > 1) {
                    this.sequenceCarriedCount = Math.max(this.sequenceCarriedCount, this.beliefs.carried.length);
                }
            } else if (action.action === 'putdown') {
                if (this.beliefs.carried.length === 0 && this.sequenceStartTime !== null) {
                    const seqDuration = Date.now() - this.sequenceStartTime;
                    const count = this.sequenceCarriedCount;
                    if (count > 0) {
                        const timePerParcel = seqDuration / count;
                        console.log(`[BDI Stats] Finished delivery sequence: delivered=${count} parcels in ${seqDuration}ms (avg ${timePerParcel.toFixed(1)}ms per parcel).`);
                        
                        const targetTimePerParcel = 10000;
                        if (timePerParcel < targetTimePerParcel) {
                            this.dynamicCapacityLimit = Math.min(
                                this.beliefs.config?.GAME?.player?.capacity || Infinity,
                                this.dynamicCapacityLimit + 1
                            );
                            console.log(`[BDI Adapt] Good efficiency! Increased dynamicCapacityLimit to ${this.dynamicCapacityLimit}`);
                        } else {
                            this.dynamicCapacityLimit = Math.max(
                                3,
                                this.dynamicCapacityLimit - 1
                            );
                            console.log(`[BDI Adapt] Poor efficiency (took too long). Decreased dynamicCapacityLimit to ${this.dynamicCapacityLimit}`);
                        }
                    }
                    this.sequenceStartTime = null;
                    this.sequenceCarriedCount = 0;
                }
            }
        }

        return success;
    }

    /**
     * Appends a structured JSON failure log entry to action_errors.log.
     * @param {Object} action - The action that failed.
     * @param {string} reason - The failure reason string.
     */
    logActionFailure(action, reason) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            agentId: this.beliefs.me.id,
            agentName: this.beliefs.me.name,
            position: { x: this.beliefs.me.x, y: this.beliefs.me.y },
            action: action,
            reason: reason,
            carried: this.beliefs.carried,
            lockedTargets: Array.from(this.beliefs.lockedTargets),
            peers: Array.from(this.beliefs.peers.entries()).map(([id, p]) => ({ id, x: p.x, y: p.y })),
            crates: Array.from(this.beliefs.crates.entries()).map(([id, c]) => ({ id, x: c.x, y: c.y })),
            map: this.beliefs.map ? { width: this.beliefs.map.width, height: this.beliefs.map.height } : null
        };
        try {
            fs.appendFileSync('action_errors.log', JSON.stringify(logEntry) + '\n', 'utf8');
        } catch (e) {
            console.error('[Logger] Failed to write action failure log:', e.message);
        }
    }

    /**
     * Resolves the coordinate peer agent ID.
     * @returns {string|null} Peer ID.
     */
    getPeerAgentId() {
        if (this.beliefs.me.id === AGENT_IDS.BDI_AGENT_ID) {
            return AGENT_IDS.LLM_AGENT_ID;
        }
        if (this.beliefs.me.id === AGENT_IDS.LLM_AGENT_ID) {
            return AGENT_IDS.BDI_AGENT_ID;
        }
        for (const peerId of this.beliefs.peers.keys()) {
            if (peerId !== this.beliefs.me.id) return peerId;
        }
        return null;
    }

    /**
     * Sends PEER_STATUS message directly to the peer agent ID via socket.emitSay.
     */
    async broadcastStatus() {
        const peerId = this.getPeerAgentId();
        if (!peerId) return;

        const payload = {
            type: 'PEER_STATUS',
            payload: {
                x: this.beliefs.me.x,
                y: this.beliefs.me.y,
                score: this.beliefs.me.score,
                nextStep: this.beliefs.me.nextStep || null,
                path: this.beliefs.me.path || [],
                crates: Array.from(this.beliefs.crates.values()).map(c => ({ id: c.id, x: c.x, y: c.y }))
            }
        };

        try {
            await this.socket.emitSay(peerId, JSON.stringify(payload));
        } catch (e) {
            // Ignore socket disconnects
        }
    }

    /**
     * Finds a nearby clear tile capable of holding a crate.
     * Searches BFS style up to distance 4.
     * @param {{x: number, y: number}} cratePos - Position of the crate.
     * @returns {{x: number, y: number}|null} Goal tile.
     */
    findClearCrateCapableTile(cratePos) {
        if (!this.beliefs.map) return null;
        
        const neighborsOfCrate = this.beliefs.map.getNeighbors(cratePos);
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

            const code = this.beliefs.map.getTileCode(current.x, current.y);
            // 4: crate_spawn, 5: crate_move
            const isCrateCapable = (code === 4 || code === 5);
            const hasOtherCrate = Array.from(this.beliefs.crates.values()).some(
                c => c.x === current.x && c.y === current.y && !(c.x === cratePos.x && c.y === cratePos.y)
            );
            const isAgentHere = (this.beliefs.me.x === current.x && this.beliefs.me.y === current.y);
            const isPeerHere = Array.from(this.beliefs.peers.values()).some(
                p => Math.round(p.x) === current.x && Math.round(p.y) === current.y
            );
            const isBlockedTarget = this.beliefs.blockedTargets.has(`${current.x},${current.y}`);

            if (isCrateCapable && !hasOtherCrate && !isAgentHere && !isPeerHere && !isBlockedTarget) {
                // Verify if agent can reach the push-position opposite to firstStep
                const dx = current.firstStep.x - cratePos.x;
                const dy = current.firstStep.y - cratePos.y;
                const agentPushTile = { x: cratePos.x - dx, y: cratePos.y - dy };
                
                if (this.beliefs.map.isWalkableTile(agentPushTile.x, agentPushTile.y)) {
                    // Check path to agentPushTile treating cratePos as blocked
                    const hasPath = (this.beliefs.me.x === agentPushTile.x && this.beliefs.me.y === agentPushTile.y) || 
                        findAStarPath(
                            this.beliefs.map,
                            { x: this.beliefs.me.x, y: this.beliefs.me.y },
                            agentPushTile,
                            this.beliefs.policyRules,
                            {
                                crates: new Map([['temp_crate', cratePos]]),
                                blockedTargets: new Map(),
                                peers: new Map()
                            }
                        ) !== null;
                        
                    if (hasPath) {
                        return { x: current.x, y: current.y };
                    }
                }
            }

            const neighbors = this.beliefs.map.getNeighbors(current);
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
     * @param {{x: number, y: number}} crate - Crate location.
     * @param {{x: number, y: number}} targetTile - Destination tile for the crate.
     * @returns {Array<{x: number, y: number}>|null} Array of steps to execute the push, or null if blocked.
     */
    solveObstaclePushLocally(crate, targetTile) {
        if (!this.beliefs.map) return null;
        
        // Direction of push
        const dx = crate.x - targetTile.x;
        const dy = crate.y - targetTile.y;
        
        const pushFromX = crate.x + dx;
        const pushFromY = crate.y + dy;
        
        // Verify pushFrom is walkable
        if (!this.beliefs.map.isWalkableTile(pushFromX, pushFromY)) {
            return null;
        }
        
        // Path to the push-from position treating the target crate as blocked.
        const path = (this.beliefs.me.x === pushFromX && this.beliefs.me.y === pushFromY)
            ? [{ x: pushFromX, y: pushFromY }]
            : findAStarPath(
                this.beliefs.map,
                { x: this.beliefs.me.x, y: this.beliefs.me.y },
                { x: pushFromX, y: pushFromY },
                this.beliefs.policyRules,
                this.beliefs
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
    translatePddlPlanToMoves(pddlPlan) {
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
     * Simple recipe generator to execute PDDL movements.
     * @param {Array<{x: number, y: number}>} moves - Steps list.
     * @yields {Object} Yields move actions.
     */
    * _executePddlPlanRecipe(moves) {
        if (moves.length === 0) return;

        // The PDDL solver is async; the agent may have moved while we waited.
        // Navigate to the first PDDL step using A* if we're not already adjacent.
        const firstStep = moves[0];
        if (this.beliefs.me.x !== firstStep.x || this.beliefs.me.y !== firstStep.y) {
            if (this.beliefs.map && !this.beliefs.map.isAdjacent(this.beliefs.me, firstStep)) {
                console.log(`[BDI PDDL] Agent at (${this.beliefs.me.x}, ${this.beliefs.me.y}) not adjacent to first PDDL step (${firstStep.x}, ${firstStep.y}). Using A* to navigate there.`);
                yield* NavigateTo(this.beliefs, firstStep.x, firstStep.y);

                // Verify we reached the target
                if (Math.round(this.beliefs.me.x) !== firstStep.x || Math.round(this.beliefs.me.y) !== firstStep.y) {
                    console.log(`[BDI PDDL] Failed to reach first PDDL step. Aborting recipe.`);
                    return;
                }
            }
        }

        for (const step of moves) {
            // Skip steps where we're already at the target (e.g., after a crate push)
            if (Math.round(this.beliefs.me.x) === step.x && Math.round(this.beliefs.me.y) === step.y) {
                continue;
            }

            // Pre-check adjacency to abort early if PDDL plan is out of sync
            if (this.beliefs.map && !this.beliefs.map.isAdjacent(this.beliefs.me, step)) {
                console.log(`[BDI PDDL] Step (${step.x}, ${step.y}) not adjacent to agent at (${this.beliefs.me.x}, ${this.beliefs.me.y}). Aborting recipe.`);
                break;
            }

            const success = yield { action: 'move', target: step };
            if (!success) {
                console.log(`[BDI PDDL] Move to (${step.x}, ${step.y}) failed, aborting PDDL recipe.`);
                break;
            }
        }
    }
}
