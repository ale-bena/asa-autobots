/**
 * @module agent/Intentions
 * @description Intention execution engine (BDI Control Loop). Handles priority goal selection,
 * action dispatching, collision back-off (Tier 1/2), and plan preemption stack (HFSM).
 */

import { NavigateTo, CollectAndDeliver, findNearestDeliveryZone } from './PlanLibrary.js';

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
         * @type {Array<Generator>}
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
     * Selects the highest utility goal based on current beliefs and policy rules.
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

        // 2. If we are carrying cargo, prioritize delivery.
        if (this.beliefs.carried.length > 0) {
            const deliveryZone = findNearestDeliveryZone(this.beliefs, this.beliefs.me.x, this.beliefs.me.y);
            return {
                type: 'deliver',
                targetId: null,
                x: deliveryZone ? deliveryZone.x : null,
                y: deliveryZone ? deliveryZone.y : null
            };
        }

        // 3. Evaluate available parcels.
        let bestParcel = null;
        let bestUtility = -Infinity;

        for (const parcel of this.beliefs.parcels.values()) {
            if (parcel.carriedBy) continue;
            if (this.beliefs.lockedTargets.has(parcel.id)) continue;

            // Enforce Level 2 Policy Rules
            if (parcel.reward < this.beliefs.policyRules.minRewardThreshold) continue;
            if (parcel.reward > this.beliefs.policyRules.maxRewardLimit) continue;

            // Calculate distance estimate
            const dist = Math.abs(parcel.x - this.beliefs.me.x) + Math.abs(parcel.y - this.beliefs.me.y);
            if (dist === 0) continue;

            const utility = parcel.reward / dist;
            if (utility > bestUtility) {
                bestUtility = utility;
                bestParcel = parcel;
            }
        }

        if (bestParcel) {
            return { type: 'pickup', targetId: bestParcel.id, x: bestParcel.x, y: bestParcel.y };
        }

        // 4. Fallback to patrolling.
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

        // deliveries preempt pickups/patrols.
        if (bestGoal.type === 'deliver' && this.currentGoal.type !== 'deliver' && this.currentGoal.type !== 'admin_move') {
            return true;
        }

        // pickups preempt patrols.
        if (bestGoal.type === 'pickup' && this.currentGoal.type === 'patrol' && this.currentGoal.type !== 'admin_move') {
            return true;
        }

        // If target parcel changed.
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
        // Search for a random walkable tile
        let attempts = 0;
        while (attempts < 10) {
            const rx = Math.floor(Math.random() * this.beliefs.map.width);
            const ry = Math.floor(Math.random() * this.beliefs.map.y || Math.floor(Math.random() * this.beliefs.map.height));
            if (this.beliefs.map.isWalkableTile(rx, ry)) {
                yield* NavigateTo(this.beliefs, rx, ry);
                return;
            }
            attempts++;
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
            yield { action: 'putdown' };
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

        // 1. Evaluate option utilities to see if we should preempt the active plan
        const bestGoal = this.selectBestGoal();

        if (this.shouldPreemptActivePlan(bestGoal)) {
            if (this.activeGenerator) {
                console.log(`[BDI] Preempting active plan (${this.currentGoal.type}). Suspending context...`);
                this.suspendedStack.push(this.activeGenerator);
            }
            this.activeGenerator = this.instantiatePlanRecipe(bestGoal);
        }

        // 2. Step the active plan generator by one step
        if (this.activeGenerator) {
            const stepResult = this.activeGenerator.next();

            if (stepResult.done) {
                console.log(`[BDI] Plan ${this.currentGoal.type} completed.`);
                // Resume previous plan if stack is not empty
                this.activeGenerator = this.suspendedStack.pop() || null;
                if (!this.activeGenerator) {
                    this.currentGoal = null;
                }
            } else {
                // Execute physical action yielded by the generator
                const action = stepResult.value;
                await this.dispatchAction(action);
            }
        }
    }

    /**
     * Dispatches the yielded action token to the simulation server socket.
     * @param {{action: string, target: any, payload: Object}} action - The action token.
     */
    async dispatchAction(action) {
        if (!action) return;

        switch (action.action) {
            case 'move': {
                const target = action.target;
                const dir = this.getDirection(this.beliefs.me, target);
                if (!dir) return;

                console.log(`[BDI] Attempting move: ${dir} to (${target.x}, ${target.y})`);

                // Emit move call and await server tick confirmation
                const success = await new Promise(resolve => {
                    this.socket.emit('move', dir, (res) => {
                        resolve(res);
                    });
                });

                if (success) {
                    this.beliefs.me.x = success.x;
                    this.beliefs.me.y = success.y;
                    this.collisionCounter = 0; // Reset collision count
                } else {
                    console.warn(`[BDI] Move failed to (${target.x}, ${target.y}) - Collision detected.`);
                    this.collisionCounter++;

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
                }
                break;
            }

            case 'pickup': {
                const parcelId = action.target;
                console.log(`[BDI] Attempting pickup for parcel: ${parcelId}`);
                const success = await new Promise(resolve => {
                    this.socket.emit('pickup', (res) => resolve(res));
                });

                if (success) {
                    console.log(`[BDI] Pickup successful: ${parcelId}`);
                    this.beliefs.carried.push(parcelId);
                } else {
                    console.warn(`[BDI] Pickup failed for parcel ${parcelId}.`);
                }
                break;
            }

            case 'putdown': {
                console.log('[BDI] Attempting cargo drop (putdown).');
                const success = await new Promise(resolve => {
                    this.socket.emit('putdown', (res) => resolve(res));
                });

                if (success) {
                    console.log('[BDI] Cargo successfully dropped.');
                    this.beliefs.carried = [];
                } else {
                    console.warn('[BDI] Cargo drop failed.');
                }
                break;
            }

            case 'say': {
                const message = action.payload;
                console.log('[BDI] Broadcasting P2P chat sync message:', message);
                this.socket.emit('say', JSON.stringify(message));
                break;
            }
        }
    }
}
