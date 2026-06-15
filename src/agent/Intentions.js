/**
 * @module agent/Intentions
 * @description Intention execution engine (BDI Control Loop). Orchestrates goal selection,
 * preemption, action dispatching, and plan management by delegating to focused sub-modules.
 * 
 * Sub-modules:
 * - GoalSelector.js — goal scoring and policy evaluation
 * - PreemptionManager.js — preemption decision matrix
 * - ActionDispatcher.js — physical action dispatch and collision handling
 * - PddlIntegration.js — crate solving and PDDL recipe execution
 */

import { NavigateTo, CollectAndDeliver, findNearestDeliveryZone, findNearestSpawnZone, findPatrolSpawnZone, findAdjacentClearTile } from './PlanLibrary.js';
import { selectBestGoal, evaluatePolicyReward } from './GoalSelector.js';
import { shouldPreemptActivePlan } from './PreemptionManager.js';
import { dispatchAction, getDirection } from './ActionDispatcher.js';
import { resolveCrateBlockedPath, executePddlPlanRecipe } from './PddlIntegration.js';
import { findAStarPath } from '../mapping/Pathfinding.js';
import { getWaitDecayTimeForValue } from '../policy/PolicyEngine.js';
import { optimizeDeliveryStack } from '../policy/DeliveryOptimizer.js';
import { AGENT_IDS } from '../config/config.js';
import { MapRepresentation } from '../mapping/MapRepresentation.js';

/** Maximum retry attempts for admin_move before clearing the contract. */
const ADMIN_MOVE_MAX_RETRIES = 3;

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
         */
        this.actionStats = {
            move: { count: 0, totalTime: 0, avgTime: 50 },
            pickup: { count: 0, totalTime: 0, avgTime: 20 },
            putdown: { count: 0, totalTime: 0, avgTime: 20 }
        };

        /**
         * Dynamically computed capacity limit.
         * @type {number}
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
        this.lastMaxStackSize = null;

        /**
         * Throttled timestamp to send status updates directly to peers.
         */
        this.lastBroadcastTime = 0;

        /**
         * Tracks recently failed PDDL solve attempts to prevent solver spam.
         * @type {Map<string, number>}
         */
        this.failedPddlSolves = new Map();

        /**
         * Tracks delivery zones that are confirmed unreachable.
         * @type {Map<string, number>}
         */
        this.blockedDeliveryZones = new Map();

        /**
         * Retry counter for admin_move attempts that fail navigation.
         * @type {number}
         */
        this.adminMoveRetries = 0;

        /**
         * Track synchronization handshake.
         */
        this.lastSyncReqTime = 0;
        this.lastSyncLogTime = 0;
        if (this.beliefs.variables.synced === undefined) {
            this.beliefs.variables.synced = false;
        }
    }

    /**
     * Returns a mutable state object that sub-modules can read and update.
     * This avoids spreading engine internals across module function signatures.
     * @returns {Object} Engine state snapshot.
     * @private
     */
    _getEngineState() {
        return {
            // Mutable references — changes are reflected on the engine
            actionStats: this.actionStats,
            blockedDeliveryZones: this.blockedDeliveryZones,
            failedPddlSolves: this.failedPddlSolves,
            // Value copies that sub-modules may update
            dynamicCapacityLimit: this.dynamicCapacityLimit,
            lastRequiredStackSize: this.lastRequiredStackSize,
            lastMaxStackSize: this.lastMaxStackSize,
            collisionCounter: this.collisionCounter,
            mustDeliver: this.mustDeliver,
            sequenceStartTime: this.sequenceStartTime,
            sequenceCarriedCount: this.sequenceCarriedCount,
            // References used by ActionDispatcher for Tier 2 collision recovery
            currentGoal: this.currentGoal,
            activeGenerator: this.activeGenerator
        };
    }

    /**
     * Applies engine state updates returned from sub-modules.
     * @param {Object} state - The engine state object (possibly modified by sub-modules).
     * @private
     */
    _applyEngineState(state) {
        this.dynamicCapacityLimit = state.dynamicCapacityLimit;
        this.lastRequiredStackSize = state.lastRequiredStackSize;
        this.lastMaxStackSize = state.lastMaxStackSize;
        this.collisionCounter = state.collisionCounter;
        this.mustDeliver = state.mustDeliver;
        this.sequenceStartTime = state.sequenceStartTime;
        this.sequenceCarriedCount = state.sequenceCarriedCount;
        this.currentGoal = state.currentGoal;
        this.activeGenerator = state.activeGenerator;
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
                return (function* (beliefs, tx, ty, engine) {
                    console.log(`[BDI] admin_move: Starting movement to target tile (${tx}, ${ty}). Current position: (${beliefs.me.x}, ${beliefs.me.y})`);
                    const contract = beliefs.activeContracts.get('admin_move');
                    const holdOnArrival = contract ? contract.holdOnArrival : false;
                    const holdDuration = contract ? contract.holdDuration : null;
                    const dropOnArrival = contract ? contract.dropOnArrival : false;

                    if (dropOnArrival && beliefs.carried.length === 0) {
                        console.log(`[BDI] admin_move: dropOnArrival is true but carrying 0 parcels. Searching for a parcel first...`);
                        while (beliefs.carried.length === 0) {
                            const parcel = findNearestAvailableParcel(beliefs);
                            if (parcel) {
                                console.log(`[BDI] admin_move: Found parcel ${parcel.id} at (${parcel.x}, ${parcel.y}). Navigating to collect it...`);
                                const reachedParcel = yield* NavigateTo(beliefs, parcel.x, parcel.y);
                                if (reachedParcel) {
                                    console.log(`[BDI] admin_move: Reached parcel ${parcel.id}. Picking it up.`);
                                    yield { action: 'pickup', target: parcel.id };
                                } else {
                                    console.log(`[BDI] admin_move: Failed to reach parcel ${parcel.id}.`);
                                    yield { action: 'wait' };
                                }
                            } else {
                                console.log(`[BDI] admin_move: No available parcels found on map to pick up. Waiting...`);
                                yield { action: 'wait' };
                            }
                        }
                    }

                    // Primary: try A* with crate awareness
                    let path = findAStarPath(
                        beliefs.map,
                        { x: beliefs.me.x, y: beliefs.me.y },
                        { x: tx, y: ty },
                        beliefs.policyRules,
                        beliefs
                    );

                    // Fallback: try ignoring crates (admin explicitly ordered this move)
                    if (!path || path.length < 2) {
                        console.log(`[BDI] admin_move: primary A* path blocked, trying ignoreCrates fallback.`);
                        path = findAStarPath(
                            beliefs.map,
                            { x: beliefs.me.x, y: beliefs.me.y },
                            { x: tx, y: ty },
                            beliefs.policyRules,
                            null
                        );
                    }

                    if (!path || path.length < 2) {
                        console.log(`[BDI] admin_move to (${tx}, ${ty}) failed: no path found.`);
                        engine.adminMoveRetries++;
                        if (engine.adminMoveRetries >= ADMIN_MOVE_MAX_RETRIES) {
                            console.log(`[BDI] admin_move to (${tx}, ${ty}) max retries (${ADMIN_MOVE_MAX_RETRIES}) reached. Clearing contract.`);
                            beliefs.activeContracts.delete('admin_move');
                            engine.adminMoveRetries = 0;
                        }
                        yield { action: 'say', payload: { type: 'MOVE_TO_ACK', success: false, x: tx, y: ty } };
                        return;
                    }

                    console.log(`[BDI] admin_move: Path found with length ${path.length}. Executing NavigateTo...`);
                    const success = yield* NavigateTo(beliefs, tx, ty);
                    // Always clear the contract when done — success or not
                    beliefs.activeContracts.delete('admin_move');
                    engine.adminMoveRetries = 0;

                    const reachedX = Math.round(beliefs.me.x);
                    const reachedY = Math.round(beliefs.me.y);
                    const reached = success && reachedX === tx && reachedY === ty;

                    yield { action: 'say', payload: { type: 'MOVE_TO_ACK', success: reached, x: tx, y: ty } };

                    if (reached) {
                        console.log(`[BDI] admin_move to (${tx}, ${ty}) completed successfully. Reached target tile (${reachedX}, ${reachedY}).`);
                        if (dropOnArrival && beliefs.carried.length > 0) {
                            console.log(`[BDI] admin_move: dropOnArrival is true. Dropping all carried parcels at destination.`);
                            while (beliefs.carried.length > 0) {
                                yield { action: 'putdown' };
                            }
                        }
                        if (holdOnArrival) {
                            console.log(`[BDI] holdOnArrival is true. Activating HOLD state for agent.`);
                            beliefs.hold = true;
                            if (holdDuration && holdDuration > 0) {
                                console.log(`[BDI] Auto-resume timer scheduled in ${holdDuration} seconds.`);
                                setTimeout(() => {
                                    console.log(`[BDI] Auto-resume timer expired. Releasing hold.`);
                                    beliefs.hold = false;
                                }, holdDuration * 1000);
                            }
                        }
                    } else {
                        console.log(`[BDI] admin_move to (${tx}, ${ty}) failed. Ended at (${reachedX}, ${reachedY}). Success flag: ${success}`);
                    }
                })(this.beliefs, goal.x, goal.y, this);

            case 'rendezvous':
                return (function* (beliefs, tx, ty, coopId) {
                    const contract = beliefs.activeContracts.get(coopId);
                    const radius = (contract && contract.radius !== undefined && contract.radius !== null) ? Number(contract.radius) : 0;
                    const holdDuration = (contract && contract.holdDuration !== undefined) ? contract.holdDuration : null;

                    const success = yield* NavigateTo(beliefs, tx, ty, radius);
                    if (success) {
                        console.log(`[BDI] Reached rendezvous coordinate (${tx}, ${ty}) (radius ${radius}) for contract ${coopId}. Waiting for peer to arrive...`);
                        
                        let timerStarted = false;

                        while (beliefs.activeContracts.has(coopId)) {
                            // Check if the peer has also arrived in the neighborhood
                            const peerArrived = Array.from(beliefs.peers.values()).some(peer => {
                                if (peer.id === AGENT_IDS.ADMIN_ID) return false;
                                const px = Math.round(peer.x);
                                const py = Math.round(peer.y);
                                const dist = Math.abs(px - tx) + Math.abs(py - ty);
                                return dist <= radius;
                            });

                            if (peerArrived && !timerStarted) {
                                timerStarted = true;
                                // Determine wait/hold duration.
                                // Defaults to 3 seconds if not set (null/undefined).
                                // If -1 or "indefinite", we do not set a timer (wait indefinitely for admin/coordinator resume).
                                // Otherwise, wait the specified holdDuration.
                                let duration = 3;
                                if (holdDuration === -1 || holdDuration === 'indefinite') {
                                    duration = null;
                                } else if (holdDuration !== null && holdDuration !== undefined) {
                                    duration = Number(holdDuration);
                                }

                                if (duration !== null) {
                                    console.log(`[BDI] Both agents arrived in neighborhood of (${tx}, ${ty}). Scheduling automatic resume in ${duration} seconds.`);
                                    setTimeout(() => {
                                        if (beliefs.activeContracts.has(coopId)) {
                                            console.log(`[BDI] Rendezvous timer expired. Deleting contract ${coopId} to resume.`);
                                            beliefs.activeContracts.delete(coopId);
                                        }
                                    }, duration * 1000);
                                } else {
                                    console.log(`[BDI] Both agents arrived. Configured for indefinite wait (until admin resume).`);
                                }
                            }

                            yield { action: 'wait' };
                        }
                    } else {
                        console.log(`[BDI] Rendezvous to (${tx}, ${ty}) failed/blocked, retrying...`);
                    }
                })(this.beliefs, goal.x, goal.y, goal.targetId);

            case 'handoff':
                return (function* (beliefs, hx, ty, coopId) {
                    const contract = beliefs.activeContracts.get(coopId);
                    const radius = (contract && contract.radius !== undefined) ? contract.radius : 0;
                    
                    console.log(`[BDI Handoff] Starting handoff. Navigating to (${hx}, ${ty}) with radius ${radius}`);
                    const reached = yield* NavigateTo(beliefs, hx, ty, radius);
                    if (!reached) {
                        console.log(`[BDI Handoff] Failed to navigate to handoff tile (${hx}, ${ty}). Retrying...`);
                        return;
                    }
                    
                    console.log(`[BDI Handoff] Arrived in handoff zone. Dropping all carried parcels...`);
                    while (beliefs.carried.length > 0) {
                        yield { action: 'putdown' };
                    }
                    
                    const escapeTile = findAdjacentClearTile(beliefs, hx, ty);
                    console.log(`[BDI Handoff] Stepping aside to (${escapeTile.x}, ${escapeTile.y}) to clear space.`);
                    yield* NavigateTo(beliefs, escapeTile.x, escapeTile.y);
                    
                    yield { action: 'say', payload: { type: 'SIGNAL_READY', coopId } };
                    
                    console.log(`[BDI Handoff] Cargo dropped. Waiting for peer agent to be ready or parcels to appear...`);
                    
                    let peerReady = false;
                    while (!peerReady) {
                        const currentContract = beliefs.activeContracts.get(coopId);
                        if (!currentContract) break;
                        
                        const parcelsOnHandoff = Array.from(beliefs.parcels.values()).some(
                            p => !p.carriedBy && Math.round(p.x) === hx && Math.round(p.y) === ty
                        );
                        if (currentContract.status === 'READY' || parcelsOnHandoff) {
                            peerReady = true;
                        } else {
                            yield { action: 'wait' };
                        }
                    }
                    
                    console.log(`[BDI Handoff] Peer ready or parcels detected. Navigating back to (${hx}, ${ty}) to collect swapped cargo.`);
                    yield* NavigateTo(beliefs, hx, ty);
                    
                    let capacity = beliefs.config?.GAME?.player?.capacity;
                    if (capacity === undefined || capacity < 0) capacity = Infinity;
                    
                    let pickedUpAny = false;
                    while (beliefs.carried.length < capacity) {
                        const parcelToPick = Array.from(beliefs.parcels.values()).find(
                            p => !p.carriedBy && Math.round(p.x) === hx && Math.round(p.y) === ty
                        );
                        if (parcelToPick) {
                            yield { action: 'pickup', target: parcelToPick.id };
                            pickedUpAny = true;
                        } else {
                            break;
                        }
                    }
                    
                    console.log(`[BDI Handoff] Swap complete. Picked up cargo: ${pickedUpAny}. Proceeding to deliver.`);
                    beliefs.variables.handoffCompleted = true;
                })(this.beliefs, goal.x, goal.y, goal.targetId);

            case 'handoff_drop':
                // One-way courier drop for persistent RELAY contracts: bring the
                // cargo to the drop tile, drop everything, step aside, done. No
                // wait/swap-back (that's the mutual HANDOFF recipe) - the peer
                // collects the parcels on its own via normal goal selection.
                return (function* (beliefs, hx, ty) {
                    console.log(`[BDI Relay] Courier run: bringing ${beliefs.carried.length} parcel(s) to drop tile (${hx}, ${ty}).`);
                    const reached = yield* NavigateTo(beliefs, hx, ty);
                    if (!reached) {
                        console.log(`[BDI Relay] Failed to reach drop tile (${hx}, ${ty}). Retrying next cycle.`);
                        return;
                    }

                    while (beliefs.carried.length > 0) {
                        yield { action: 'putdown' };
                    }
                    beliefs.variables.handoffCompleted = true;

                    // For escape, courier should prefer neighbor closest to the spawn zone
                    const neighbors = beliefs.map.getNeighbors({ x: hx, y: ty });
                    const spawn = findPatrolSpawnZone(beliefs, hx, ty);
                    if (spawn) {
                        neighbors.sort((a, b) => {
                            const distA = Math.abs(a.x - spawn.x) + Math.abs(a.y - spawn.y);
                            const distB = Math.abs(b.x - spawn.x) + Math.abs(b.y - spawn.y);
                            return distA - distB;
                        });
                    }
                    const escapeTile = neighbors.find(n => {
                        const hasCrate = Array.from(beliefs.crates.values()).some(c => c.x === n.x && c.y === n.y);
                        const hasPeer = Array.from(beliefs.peers.values()).some(p => p.x === n.x && p.y === n.y);
                        return !hasCrate && !hasPeer;
                    }) || neighbors[0];

                    console.log(`[BDI Relay] Cargo dropped. Stepping aside to (${escapeTile.x}, ${escapeTile.y}).`);
                    yield* NavigateTo(beliefs, escapeTile.x, escapeTile.y);
                })(this.beliefs, goal.x, goal.y);


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
        // Enforce synchronization handshake before BDI executor starts
        if (!this.beliefs.variables.synced) {
            const now = Date.now();
            if (now - this.lastSyncLogTime >= 2000) {
                this.lastSyncLogTime = now;
                console.log(`[BDI Sync] Agent is not synchronized yet. Waiting for peer...`);
            }
            if (now - this.lastSyncReqTime >= 500) {
                this.lastSyncReqTime = now;
                const recipient = this.getPeerAgentId();
                if (recipient) {
                    this.socket.emitSay(recipient, JSON.stringify({ type: 'SYNC_REQ' })).catch(() => {});
                }
            }
            return;
        }

        // Enforce coordinator holds (e.g. red light / stop constraints)
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
                p => !p.carriedBy && !this.beliefs.carried.includes(p.id) && Math.round(p.x) === currentX && Math.round(p.y) === currentY
            );
            if (parcelHere) {
                console.log(`[BDI Opportunistic] Found parcel ${parcelHere.id} on our current tile (${currentX}, ${currentY}). Picking it up.`);
                const engineState = this._getEngineState();
                const success = await dispatchAction(
                    { action: 'pickup', target: parcelHere.id },
                    this.beliefs,
                    this.socket,
                    engineState,
                    () => this.getPeerAgentId(),
                    (g) => this.instantiatePlanRecipe(g)
                );
                this._applyEngineState(engineState);
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

            await this._checkAndProposeRelayContract();

            const engineState = this._getEngineState();
            const bestGoal = selectBestGoal(this.beliefs, engineState);

            // Apply any engine state updates from goal selection (e.g. dynamicCapacityLimit changes)
            if (bestGoal.engineUpdates) {
                Object.assign(engineState, bestGoal.engineUpdates);
            }
            this._applyEngineState(engineState);

            // Check if this goal is blocked by a crate (only if not already clearing one)
            let pddlMoves = null;
            if (this.currentGoal?.type !== 'clear_corridor' && bestGoal && bestGoal.x !== null && bestGoal.y !== null && this.beliefs.map) {
                pddlMoves = await resolveCrateBlockedPath(this.beliefs, bestGoal, this);
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
                this.activeGenerator = executePddlPlanRecipe(this.beliefs, pddlMoves);
            } else if (shouldPreemptActivePlan(this.currentGoal, this.activeGenerator, bestGoal, this.beliefs)) {
                if (this.activeGenerator) {
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
                console.log(`[BDI] Plan ${this.currentGoal?.type || 'unknown'} completed.`);
                // Resume previous plan from the stack, but skip stale ones
                let resumed = false;
                while (this.suspendedStack.length > 0) {
                    const suspended = this.suspendedStack.pop();
                    if (suspended.goal.type === 'clear_corridor') {
                        console.log(`[BDI] Discarding stale suspended plan (${suspended.goal.type}).`);
                        continue;
                    }
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
                this.lastActionSuccess = true;
                this.tickCounter = this.GOAL_EVAL_INTERVAL; // Force immediate goal evaluation on next tick
            } else {
                // Execute physical action yielded by the generator
                const action = stepResult.value;
                const engineState = this._getEngineState();
                this.lastActionSuccess = await dispatchAction(
                    action,
                    this.beliefs,
                    this.socket,
                    engineState,
                    () => this.getPeerAgentId(),
                    (g) => this.instantiatePlanRecipe(g)
                );
                this._applyEngineState(engineState);
            }
        }
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
    /**
     * Generator function representing delivery of carried parcels.
     * @yields {Object} Yields delivery steps.
     * @private
     */
    * _deliverRecipe(targetX, targetY) {
        if (targetX !== null && targetY !== null) {
            yield* NavigateTo(this.beliefs, targetX, targetY);

            while (true) {
                if (!(this.beliefs && this.beliefs.me && this.beliefs.map && this.beliefs.map.getTileCode(this.beliefs.me.x, this.beliefs.me.y) === MapRepresentation.TILE_CODES.DELIVERY)) {
                    break;
                }
                const carriedList = this.beliefs.carried || [];
                if (carriedList.length === 0) {
                    break;
                }
                const parcelsMap = this.beliefs.parcels || new Map();
                const currentParcels = carriedList.map(cid => parcelsMap.get(cid) || { id: cid, reward: 20 });

                const opt = optimizeDeliveryStack(this.beliefs, currentParcels, this.beliefs.me.x, this.beliefs.me.y);

                if (opt.bestReward <= 0) {
                    // Discard non-optimal useless parcels if any, then break
                    if (opt.discardSubset && opt.discardSubset.length > 0) {
                        yield* this._discardParcelsAction(opt.discardSubset);
                    }
                    break;
                }

                // Discard non-optimal useless parcels
                if (opt.discardSubset && opt.discardSubset.length > 0) {
                    yield* this._discardParcelsAction(opt.discardSubset);
                }

                // Now wait for the optimal decay wait time if needed
                if (opt.bestWaitMs > 0) {
                    console.log(`[BDI Deliver] Waiting at delivery zone for ${opt.bestWaitMs}ms.`);
                    const waitSteps = Math.ceil(opt.bestWaitMs / 100);
                    for (let i = 0; i < waitSteps; i++) {
                        yield { action: 'wait' };
                    }
                }

                // Deliver remaining optimal cargo
                if (opt.bestSubset && opt.bestSubset.length > 0) {
                    for (const cid of opt.bestSubset) {
                        yield { action: 'putdown', target: cid };
                    }
                } else {
                    break; // No subset selected, stop to avoid infinite loop
                }

                // Yield a wait tick to allow the server to process the putdowns and update beliefs
                yield { action: 'wait' };
            }
        }
    }

    /**
     * Helper to discard a subset of parcels on an adjacent walkable non-delivery tile.
     * @param {Array<string>} discardSubset - Parcel IDs to discard.
     * @private
     */
    * _discardParcelsAction(discardSubset) {
        console.log(`[BDI Deliver] Discarding non-optimal subset: [${discardSubset.join(', ')}] on an adjacent tile.`);
        const neighbors = [
            { x: this.beliefs.me.x + 1, y: this.beliefs.me.y },
            { x: this.beliefs.me.x - 1, y: this.beliefs.me.y },
            { x: this.beliefs.me.x, y: this.beliefs.me.y + 1 },
            { x: this.beliefs.me.x, y: this.beliefs.me.y - 1 }
        ];
        let discardTile = null;
        for (const n of neighbors) {
            if (this.beliefs.map && this.beliefs.map.isWalkableTile(n.x, n.y) && this.beliefs.map.getTileCode(n.x, n.y) !== MapRepresentation.TILE_CODES.DELIVERY) {
                discardTile = n;
                break;
            }
        }
        if (discardTile) {
            const originalX = this.beliefs.me.x;
            const originalY = this.beliefs.me.y;
            yield* NavigateTo(this.beliefs, discardTile.x, discardTile.y);
            for (const cid of discardSubset) {
                yield { action: 'putdown', target: cid };
            }
            yield* NavigateTo(this.beliefs, originalX, originalY);
        } else {
            // If no adjacent tile is available, discard them here
            for (const cid of discardSubset) {
                yield { action: 'putdown', target: cid };
            }
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
                name: this.beliefs.me.name,
                x: this.beliefs.me.x,
                y: this.beliefs.me.y,
                score: this.beliefs.me.score,
                nextStep: this.beliefs.me.nextStep || null,
                path: this.beliefs.me.path || [],
                carried: this.beliefs.carried,
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
     * Checks if the two agents are isolated on two separate islands (spawn vs. delivery components)
     * and proposes a RELAY contract if needed.
     */
    async _checkAndProposeRelayContract() {
        if (!this.beliefs || !this.beliefs.map || !this.beliefs.me) return;

        // Check if there is already an active/accepted RELAY contract in memory
        let hasRelayContract = false;
        if (this.beliefs.activeContracts) {
            for (const contract of this.beliefs.activeContracts.values()) {
                if (contract.type === 'RELAY' && 
                    (contract.status === 'ACTIVE' || contract.status === 'ACCEPTED' || contract.status === 'READY')) {
                    hasRelayContract = true;
                    break;
                }
            }
        }
        if (hasRelayContract) return;

        // Get peer agent
        const peerId = this.getPeerAgentId();
        if (!peerId) return;
        const peer = this.beliefs.peers.get(peerId);
        if (!peer) return;

        // Find all spawn and delivery zones on the map
        const spawnTiles = [];
        const deliveryTiles = [];
        for (let x = 0; x < this.beliefs.map.width; x++) {
            for (let y = 0; y < this.beliefs.map.height; y++) {
                const code = this.beliefs.map.getTileCode(x, y);
                if (code === MapRepresentation.TILE_CODES.SPAWN) {
                    spawnTiles.push({ x, y });
                } else if (code === MapRepresentation.TILE_CODES.DELIVERY) {
                    deliveryTiles.push({ x, y });
                }
            }
        }

        if (spawnTiles.length === 0 || deliveryTiles.length === 0) return;

        // BFS Helper to find all reachable tiles, treating the other agent as an obstacle
        const getReachableTiles = (startX, startY, blockedTileKey = null) => {
            const reachable = new Set();
            const queue = [{ x: Math.round(startX), y: Math.round(startY) }];
            reachable.add(`${queue[0].x},${queue[0].y}`);

            while (queue.length > 0) {
                const curr = queue.shift();
                const neighbors = this.beliefs.map.getNeighbors(curr);
                for (const n of neighbors) {
                    const key = `${n.x},${n.y}`;
                    if (key === blockedTileKey) continue;
                    if (!reachable.has(key)) {
                        reachable.add(key);
                        queue.push(n);
                    }
                }
            }
            return reachable;
        };

        const peerKey = `${Math.round(peer.x)},${Math.round(peer.y)}`;
        const myKey = `${Math.round(this.beliefs.me.x)},${Math.round(this.beliefs.me.y)}`;

        const myReachable = getReachableTiles(this.beliefs.me.x, this.beliefs.me.y, peerKey);
        const peerReachable = getReachableTiles(peer.x, peer.y, myKey);

        const canIReachSpawn = spawnTiles.some(t => myReachable.has(`${t.x},${t.y}`));
        const canIReachDelivery = deliveryTiles.some(t => myReachable.has(`${t.x},${t.y}`));
        const canPeerReachSpawn = spawnTiles.some(t => peerReachable.has(`${t.x},${t.y}`));
        const canPeerReachDelivery = deliveryTiles.some(t => peerReachable.has(`${t.x},${t.y}`));

        const isScenarioA = canIReachSpawn && !canIReachDelivery && canPeerReachDelivery && !canPeerReachSpawn;
        const isScenarioB = canIReachDelivery && !canIReachSpawn && canPeerReachSpawn && !canPeerReachDelivery;

        if (!isScenarioA && !isScenarioB) return;

        // Check if map is physically connected (ignoring peer agent's position as an obstacle)
        const myFullReachable = getReachableTiles(this.beliefs.me.x, this.beliefs.me.y, null);
        const isPhysicallyConnected = spawnTiles.some(t => myFullReachable.has(`${t.x},${t.y}`)) && 
                                      deliveryTiles.some(t => myFullReachable.has(`${t.x},${t.y}`));
        const blockType = isPhysicallyConnected ? "peer blockage in narrow corridor" : "physical map partition";
        console.log(`[BDI Island Connection] Agent ${this.beliefs.me.id} detected connectivity block (${blockType}) separating spawn and delivery.`);

        // We also require a non-empty intersection of reachable tiles to meeting/transfer
        const sharedTiles = [];
        for (const key of myReachable) {
            if (peerReachable.has(key)) {
                const [sx, sy] = key.split(',').map(Number);
                sharedTiles.push({ x: sx, y: sy });
            }
        }

        if (sharedTiles.length === 0) return;

        // Find the best drop tile in the intersection (closest to delivery zones)
        let bestDropTile = null;
        let minDistance = Infinity;
        for (const s of sharedTiles) {
            for (const d of deliveryTiles) {
                const dist = Math.abs(s.x - d.x) + Math.abs(s.y - d.y);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestDropTile = s;
                }
            }
        }

        if (!bestDropTile) {
            bestDropTile = sharedTiles[0];
        }

        // Propose RELAY contract
        const courierId = isScenarioA ? this.beliefs.me.id : peerId;
        const coopId = `relay_island_${Date.now()}`;
        const proposal = {
            type: 'PROPOSE_CONTRACT',
            coopId: coopId,
            contractType: 'RELAY',
            x: bestDropTile.x,
            y: bestDropTile.y,
            courierId: courierId
        };

        console.log(`[BDI Island Connection] Proposing RELAY contract ${coopId} at (${bestDropTile.x}, ${bestDropTile.y}). Courier: ${courierId}`);
        
        // Add to our own contracts as ACTIVE
        if (!this.beliefs.activeContracts) {
            this.beliefs.activeContracts = new Map();
        }
        this.beliefs.activeContracts.set(coopId, {
            coopId: coopId,
            senderId: this.beliefs.me.id,
            type: 'RELAY',
            x: bestDropTile.x,
            y: bestDropTile.y,
            radius: null,
            holdDuration: null,
            courierId: courierId,
            status: 'ACTIVE'
        });

        try {
            await this.socket.emitSay(peerId, JSON.stringify(proposal));
        } catch (e) {
            // Ignore socket errors
        }
    }
}

/**
 * Helper to find the nearest parcel that is not carried by anyone else and is reachable via A*.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @returns {Object|null} The nearest available parcel, or null if none found.
 */
function findNearestAvailableParcel(beliefs) {
    if (!beliefs || !beliefs.me || !beliefs.parcels) return null;
    const carriedList = beliefs.carried || [];
    const candidates = [];
    for (const parcel of beliefs.parcels.values()) {
        if (!parcel) continue;
        if (parcel.carriedBy) continue;
        if (carriedList.includes(parcel.id)) continue;
        if (beliefs.policyRules) {
            if (parcel.reward < (beliefs.policyRules.minRewardThreshold || 0)) continue;
            
            const currentRewardVal = evaluatePolicyReward(beliefs, parcel.reward, { parcel });
            const delZone = findNearestDeliveryZone(beliefs, parcel.x, parcel.y, null);
            const dx = delZone ? delZone.x : beliefs.me.x;
            const dy = delZone ? delZone.y : beliefs.me.y;
            const canDecayToAllowed = getWaitDecayTimeForValue(beliefs, parcel.reward, carriedList.length + 1, dx, dy, parcel) > 0;
            if (currentRewardVal <= 0 && !canDecayToAllowed) continue;
        }
        const dist = Math.abs(parcel.x - beliefs.me.x) + Math.abs(parcel.y - beliefs.me.y);
        candidates.push({ parcel, dist });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    for (const c of candidates) {
        if (!c || !c.parcel) continue;
        const path = findAStarPath(
            beliefs.map,
            { x: beliefs.me.x, y: beliefs.me.y },
            { x: c.parcel.x, y: c.parcel.y },
            beliefs.policyRules,
            null
        );
        if (path && path.length >= 1) {
            return c.parcel;
        }
    }
    return null;
}
