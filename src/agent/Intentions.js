/**
 * @module agent/Intentions
 * @description Intention execution engine (BDI Control Loop). Handles priority goal selection,
 * action dispatching, collision back-off (Tier 1/2), and plan preemption stack (HFSM).
 */

import fs from 'fs';
import { NavigateTo, CollectAndDeliver, findNearestDeliveryZone, findNearestSpawnZone, findPatrolSpawnZone, pathDistance } from './PlanLibrary.js';

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

        // --- Compute time-per-step from server movement duration ---
        // Each step in the A* path takes movementDurationMs on the server.
        // Decay: reward drops by 1 every parcelDecayIntervalMs.
        const msPerStep = this.beliefs.movementDurationMs || 500;
        const decayMs = this.beliefs.parcelDecayIntervalMs;
        const decayEnabled = isFinite(decayMs) && decayMs > 0;
        // How many reward points are lost per step of movement
        const decayPerStep = decayEnabled ? (msPerStep / decayMs) : 0;

        // 2. If carrying parcels, evaluate: deliver now vs. pick up one more
        if (this.beliefs.carried.length > 0) {
            let capacity = this.beliefs.config?.GAME?.player?.capacity;
            if (capacity === undefined || capacity < 0) {
                capacity = Infinity;
            }
            console.log(`[BDI Debug] selectBestGoal carrying: capacity=${capacity}, carried=${this.beliefs.carried.length}`);
            const deliveryZone = findNearestDeliveryZone(this.beliefs, this.beliefs.me.x, this.beliefs.me.y);
            const deliveryDist = deliveryZone
                ? pathDistance(this.beliefs, this.beliefs.me.x, this.beliefs.me.y, deliveryZone.x, deliveryZone.y)
                : Infinity;

            // At capacity → must deliver
            if (this.beliefs.carried.length >= capacity) {
                return {
                    type: 'deliver',
                    targetId: null,
                    x: deliveryZone ? deliveryZone.x : null,
                    y: deliveryZone ? deliveryZone.y : null
                };
            }

            // If decay is disabled, enforce stack size heuristic
            if (!decayEnabled) {
                const requiredStack = this.beliefs.policyRules.requiredStackSize || 3;
                if (this.beliefs.carried.length >= requiredStack) {
                    return {
                        type: 'deliver',
                        targetId: null,
                        x: deliveryZone ? deliveryZone.x : null,
                        y: deliveryZone ? deliveryZone.y : null
                    };
                }

                // If not at requiredStack, try to find the closest visible parcel to pick up
                let bestParcel = null;
                let bestDist = Infinity;
                for (const parcel of this.beliefs.parcels.values()) {
                    if (parcel.carriedBy) continue;
                    if (this.beliefs.carried.includes(parcel.id)) continue;
                    if (this.beliefs.lockedTargets.has(parcel.id)) continue;
                    if (this.beliefs.blockedTargets.has(parcel.id) || this.beliefs.blockedTargets.has(`${parcel.x},${parcel.y}`)) continue;
                    if (parcel.reward < this.beliefs.policyRules.minRewardThreshold) continue;
                    if (parcel.reward > this.beliefs.policyRules.maxRewardLimit) continue;
                    const dist = pathDistance(this.beliefs, this.beliefs.me.x, this.beliefs.me.y, parcel.x, parcel.y);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestParcel = parcel;
                    }
                }

                if (bestParcel) {
                    return {
                        type: 'pickup',
                        targetId: bestParcel.id,
                        x: bestParcel.x,
                        y: bestParcel.y
                    };
                } else {
                    return {
                        type: 'deliver',
                        targetId: null,
                        x: deliveryZone ? deliveryZone.x : null,
                        y: deliveryZone ? deliveryZone.y : null
                    };
                }
            }

            if (isFinite(deliveryDist)) {
                // Find the least time remaining (steps Left) in inventory
                let minStepsLeft = Infinity;
                let carriedRewardSum = 0;
                for (const cid of this.beliefs.carried) {
                    const cp = this.beliefs.parcels.get(cid);
                    if (cp) {
                        carriedRewardSum += cp.reward;
                        const stepsLeft = decayPerStep > 0 ? (cp.reward / decayPerStep) : Infinity;
                        if (stepsLeft < minStepsLeft) {
                            minStepsLeft = stepsLeft;
                        }
                    }
                }

                // Safety margin (in steps) to ensure parcels don't expire
                const safetyMargin = 3;
                const slackSteps = minStepsLeft - deliveryDist;
                const additionalAllowed = Math.floor(slackSteps / 2);
                const theoreticalMax = Math.min(capacity, this.beliefs.carried.length + Math.max(0, additionalAllowed));

                const isCritical = (minStepsLeft <= deliveryDist + safetyMargin);
                const atTheoreticalMax = (this.beliefs.carried.length >= theoreticalMax);

                console.log(`[BDI] Detour check: carried=${this.beliefs.carried.length}, capacity=${capacity}, theoreticalMax=${theoreticalMax}, minStepsLeft=${isFinite(minStepsLeft) ? minStepsLeft.toFixed(1) : 'Infinity'}, deliveryDist=${deliveryDist}, isCritical=${isCritical}, atTheoreticalMax=${atTheoreticalMax}`);

                // Calculate utility of delivering now
                const carriedDecay = deliveryDist * decayPerStep * this.beliefs.carried.length;
                const carriedValueAtDelivery = carriedRewardSum - carriedDecay;
                const utilityDeliver = carriedValueAtDelivery / (deliveryDist + 1);

                // Evaluate detour/pickup candidates
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

                if (candidates.length > 0) {
                    console.log(`[BDI] Top pickup candidates:`, candidates.slice(0, 3).map(c => `id=${c.parcel.id}, mDist=${c.mDist}, reward=${c.parcel.reward}`));
                }

                for (const { parcel } of candidates.slice(0, 5)) {
                    const distToParcel = pathDistance(
                        this.beliefs, this.beliefs.me.x, this.beliefs.me.y, parcel.x, parcel.y
                    );
                    if (!isFinite(distToParcel)) continue;

                    const deliveryZoneFromParcel = findNearestDeliveryZone(this.beliefs, parcel.x, parcel.y);
                    const deliveryDistFromP = deliveryZoneFromParcel
                        ? pathDistance(this.beliefs, parcel.x, parcel.y, deliveryZoneFromParcel.x, deliveryZoneFromParcel.y)
                        : Infinity;
                    if (!isFinite(deliveryDistFromP)) continue;

                    const totalDetourDist = distToParcel + deliveryDistFromP;
                    const extraSteps = totalDetourDist - deliveryDist;
                    const isMovingBackwards = (deliveryDistFromP > deliveryDist);

                    // Crucial Check: Will any carried parcel expire/be lost due to this detour?
                    const canDeliverInTimeAfterDetour = (totalDetourDist < minStepsLeft - safetyMargin);

                    let allowed = false;
                    if (isCritical || atTheoreticalMax) {
                        // When critical or at theoretical max, we MUST deliver, and only detour if it's safe and along the path
                        if (canDeliverInTimeAfterDetour) {
                            allowed = true; // Can detour if we can still deliver in time after detouring (moving backwards is fine)
                        } else if (extraSteps <= 1 && !isMovingBackwards && totalDetourDist < minStepsLeft) {
                            allowed = true; // Along the path, no backwards movement, and won't completely expire the critical parcel
                        }
                    } else {
                        // Not critical, not at max, we can detour/pickup as long as we can deliver in time
                        if (canDeliverInTimeAfterDetour) {
                            allowed = true;
                        }
                    }

                    if (!allowed) {
                        console.log(`[BDI] Detour/pickup parcel ${parcel.id} NOT allowed: canDeliver=${canDeliverInTimeAfterDetour}, extraSteps=${extraSteps}, isMovingBackwards=${isMovingBackwards}`);
                        continue;
                    }

                    // Total reward value at delivery if we pick up this parcel and then deliver everything
                    const rewardAtDelivery = carriedRewardSum + parcel.reward - totalDetourDist * decayPerStep * (this.beliefs.carried.length + 1);
                    if (rewardAtDelivery <= 0) {
                        console.log(`[BDI] Detour/pickup parcel ${parcel.id} rejected: total reward at delivery <= 0 (${rewardAtDelivery.toFixed(1)})`);
                        continue;
                    }

                    const utility = rewardAtDelivery / (totalDetourDist + 1);
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
                } else {
                    console.log(`[BDI] Heading to deliver (utilityDeliver=${utilityDeliver.toFixed(3)} >= bestPickupUtility=${bestPickupUtility.toFixed(3)})`);
                    return {
                        type: 'deliver',
                        targetId: null,
                        x: deliveryZone ? deliveryZone.x : null,
                        y: deliveryZone ? deliveryZone.y : null
                    };
                }
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
                this.beliefs, this.beliefs.me.x, this.beliefs.me.y, parcel.x, parcel.y
            );
            if (!isFinite(distToParcel)) continue;

            // Estimate distance from parcel to nearest delivery zone
            const distToDelivery = deliveryZoneForScoring
                ? pathDistance(this.beliefs, parcel.x, parcel.y, deliveryZoneForScoring.x, deliveryZoneForScoring.y)
                : Infinity;
            if (!isFinite(distToDelivery)) continue;

            const totalTrip = distToParcel + distToDelivery;

            // Project reward at delivery time
            let projectedReward;
            if (decayEnabled) {
                projectedReward = parcel.reward - (totalTrip * decayPerStep);
            } else {
                projectedReward = parcel.reward;
            }

            if (projectedReward <= 0) continue; // Would expire before delivery

            const utility = projectedReward / (totalTrip + 1);
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
            const fallbackDelivery = findNearestDeliveryZone(this.beliefs, this.beliefs.me.x, this.beliefs.me.y);
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
        if (neighbors.length > 0) {
            const randNeighbor = neighbors[Math.floor(Math.random() * neighbors.length)];
            yield { action: 'move', target: randNeighbor };
        }
    }

    /**
     * Generator function representing delivery of carried parcels.
     * @yields {Object} Yields delivery steps.
     * @private
     */
    * _deliverRecipe() {
        const zone = findNearestDeliveryZone(this.beliefs, this.beliefs.me.x, this.beliefs.me.y);
        if (zone) {
            yield* NavigateTo(this.beliefs, zone.x, zone.y);
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
                return this._deliverRecipe();
            case 'pickup':
                return CollectAndDeliver(this.beliefs, goal.targetId);
            case 'patrol_spawn':
                return (function* (beliefs, tx, ty) {
                    yield* NavigateTo(beliefs, tx, ty);
                })(this.beliefs, goal.x, goal.y);
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

        if (this.beliefs.carried.length !== this.lastCarriedLength) {
            this.tickCounter = this.GOAL_EVAL_INTERVAL;
            this.lastCarriedLength = this.beliefs.carried.length;
        }

        // 1. Evaluate option utilities periodically (throttled to avoid expensive A* on every tick)
        this.tickCounter++;
        if (this.tickCounter >= this.GOAL_EVAL_INTERVAL || !this.activeGenerator) {
            this.tickCounter = 0;
            const bestGoal = this.selectBestGoal();

            if (this.shouldPreemptActivePlan(bestGoal)) {
                if (this.activeGenerator) {
                    // When switching to delivery, discard all stale plans
                    // instead of pushing them — prevents resuming old generators
                    // that walk the agent back to where it came from.
                    if (bestGoal.type === 'deliver') {
                        console.log(`[BDI] Transitioning to delivery: discarding plan (${this.currentGoal.type}) and clearing ${this.suspendedStack.length} suspended plans.`);
                        this.suspendedStack = [];
                    } else {
                        console.log(`[BDI] Preempting active plan (${this.currentGoal.type}). Suspending context...`);
                        this.suspendedStack.push({ generator: this.activeGenerator, goal: this.currentGoal });
                    }
                }
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

        switch (action.action) {
            case 'move': {
                const target = action.target;
                if (!this.beliefs.map?.isAdjacent(this.beliefs.me, target)) {
                    console.warn(`[BDI] Invalid move attempt to (${target.x}, ${target.y}) blocked by map constraints.`);
                    // Do not force replanning here; let NavigateTo handle path recomputation on failure.
                    return false;
                }
                const dir = this.getDirection(this.beliefs.me, target);
                if (!dir) return false;
                console.log(`[BDI] Attempting move: ${dir} to (${target.x}, ${target.y})`);

                // Emit move call and await server tick confirmation using SDK method
                const success = await this.socket.emitMove(dir);

                if (success) {
                    this.beliefs.me.x = success.x;
                    this.beliefs.me.y = success.y;
                    this.collisionCounter = 0; // Reset collision count
                    return true;
                } else {
                    console.warn(`[BDI] Move failed to (${target.x}, ${target.y}) - Collision detected.`);
                    this.logActionFailure(action, 'Move failed (collision detected)');
                    this.collisionCounter++;

                    // If we collide repeatedly, block this step coordinate temporarily to force pathing bypass or replanning
                    if (this.collisionCounter >= 2) {
                        const blockKey = `${target.x},${target.y}`;
                        this.beliefs.blockedTargets.set(blockKey, Date.now());
                        console.log(`[BDI] Path step ${blockKey} blocked due to repeated collisions, forcing bypass.`);
                    }

                    // Reactive Replanning: Tier 1 Collision Back-off
                    if (this.collisionCounter <= 2) {
                        console.log(`[BDI] Tier 1 Collision: Waiting 1 tick (Count: ${this.collisionCounter}).`);
                        await new Promise(resolve => setTimeout(resolve, 100)); // Short wait
                    } else {
                        // Tier 2 Local A* Re-routing: Reset generator to force pathing bypass
                        console.log('[BDI] Tier 2 Collision: Preempting current path to compute bypass.');
                        this.activeGenerator = this.instantiatePlanRecipe(this.currentGoal);
                        this.collisionCounter = 0;
                    }
                    return false;
                }
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
                            // Find parcel in beliefs.parcels by matching coordinates
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
                    // Activate mustDeliver: force delivery before any new pickups
                    this.mustDeliver = true;
                    console.log('[BDI] mustDeliver flag SET — will deliver before considering new pickups.');
                    return true;
                } else {
                    console.warn(`[BDI] Pickup failed for parcel ${parcelId}.`);
                    this.logActionFailure(action, 'Pickup failed (decayed or already collected)');
                    // Purge failed parcel from beliefs
                    this.beliefs.parcels.delete(parcelId);
                    this.beliefs.lockedTargets.delete(parcelId);
                    return false;
                }
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
                    // Clear mustDeliver: agent is free to pick up new parcels
                    this.mustDeliver = false;
                    console.log('[BDI] mustDeliver flag CLEARED — free to evaluate new pickups.');
                    return true;
                } else {
                    console.warn('[BDI] Cargo drop failed.');
                    this.logActionFailure(action, 'Putdown failed');
                    return false;
                }
            }

            case 'say': {
                const message = action.payload;
                console.log('[BDI] Broadcasting P2P chat sync message:', message);
                await this.socket.emitShout(JSON.stringify(message));
                return true;
            }
        }
        return false;
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
}
