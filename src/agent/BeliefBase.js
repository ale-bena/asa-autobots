/**
 * @module agent/BeliefBase
 * @description Stores and updates the mental state of the agent, including coordinate estimates,
 * parcel lists, peer statuses, cooperative contracts, and dynamic policy rules.
 * Implements a spatial memory grid with line-of-sight clearing for dynamic obstacles.
 */

/**
 * BeliefBase maintaining the mental state of a Deliveroo agent.
 */
export class BeliefBase {
    /**
     * Creates a BeliefBase instance.
     */
    constructor() {
        /**
         * Information about the agent itself.
         * @type {{id: string, name: string, x: number, y: number, score: number, status: string, nextStep: Object|null, path: Array<Object>}}
         */
        this.me = { id: '', name: '', x: 0, y: 0, score: 0, status: 'free', nextStep: null, path: [] };

        /**
         * List of parcel IDs currently carried by the agent.
         * @type {Array<string>}
         */
        this.carried = [];

        /**
         * Map of parcelId -> parcel details.
         * @type {Map<string, {id: string, x: number, y: number, reward: number, carriedBy: string|null, decay: number}>}
         */
        this.parcels = new Map();

        /**
         * Map of parcelId -> Set of agentIds who carried it.
         * @type {Map<string, Set<string>>}
         */
        this.parcelHistory = new Map();

        /**
         * Map of agentId -> peer details.
         * @type {Map<string, {id: string, name: string, x: number, y: number, score: number}>}
         */
        this.peers = new Map();

        /**
         * Map of crateId -> crate coordinates.
         * @type {Map<string, {id: string, x: number, y: number}>}
         */
        this.crates = new Map();

        /**
         * Map of coopId -> contract details.
         * @type {Map<string, Object>}
         */
        this.activeContracts = new Map();

        /**
         * Set of locked parcel IDs targeted by self or peer.
         * @type {Set<string>}
         */
        this.lockedTargets = new Set();

        /**
         * Active policy guidelines parsed from coordinator agent.
         * @type {{avoidTiles: Array<string>, minRewardThreshold: number, maxRewardLimit: number, requiredStackSize: number|null, multiplierRules: Array<Object>, bonusRules: Array<Object>}}
         */
        this.policyRules = {
            avoidTiles: [],
            minRewardThreshold: 0,
            maxRewardLimit: Infinity,
            requiredStackSize: null,
            multiplierRules: [],
            bonusRules: []
        };

        /**
         * Map representation.
         * @type {import('../mapping/MapRepresentation.js').MapRepresentation|null}
         */
        this.map = null;

        /**
         * Turing-complete mission variables.
         * @type {Object<string, any>}
         */
        this.variables = {};

        /**
         * Flag indicating if movement is currently held (paused).
         * @type {boolean}
         */
        this.hold = false;

        /**
         * Observation render distance of the player.
         * @type {number}
         */
        this.observationDistance = 5;

        /**
         * Full game configuration object from the server.
         * @type {Object|null}
         */
        this.config = null;

        /**
         * How often parcel rewards decay by 1 point (in milliseconds).
         * Read from config PARCELS_DECADING_INTERVAL; defaults to 1000ms.
         * A value of Infinity means parcels never decay.
         * @type {number}
         */
        this.parcelDecayIntervalMs = 1000;

        /**
         * Server-side movement duration in milliseconds.
         * This is how long one move action takes on the server.
         * @type {number}
         */
        this.movementDurationMs = 500;

        /**
         * Map of target key (coords or ID) -> block timestamp.
         * @type {Map<string, number>}
         */
        this.blockedTargets = new Map();
    }

    /**
     * Merges new sensory updates into the agent's belief base.
     * @param {Object} sensorPayload - Raw sensory frame data from socket.
     */
    revise(sensorPayload) {
        if (!sensorPayload) return;

        // 1. Revise Self info
        if (sensorPayload.me) {
            Object.assign(this.me, sensorPayload.me);
            this.me.x = Math.round(this.me.x);
            this.me.y = Math.round(this.me.y);
        }

        // 2. Revise Map Config if present
        if (sensorPayload.config) {
            this.config = sensorPayload.config;
            this.observationDistance = sensorPayload.config.GAME?.player?.observation_distance || 5;

            console.log(`[BDI Config] Player Capacity: ${this.config.GAME?.player?.capacity}, Decaying Event: ${this.config.GAME?.parcels?.decaying_event}, Movement Duration: ${this.config.GAME?.player?.movement_duration}`);

            // Extract parcel decay interval (checks both standard decaying_event and fallback decading_interval)
            const decayRaw = sensorPayload.config.GAME?.parcels?.decaying_event || sensorPayload.config.GAME?.parcel?.decading_interval;
            if (decayRaw === 'infinite' || decayRaw === Infinity) {
                this.parcelDecayIntervalMs = Infinity;
            } else if (typeof decayRaw === 'number' && decayRaw > 0) {
                this.parcelDecayIntervalMs = decayRaw;
            } else if (typeof decayRaw === 'string') {
                const parsed = parseInt(decayRaw, 10);
                if (!isNaN(parsed) && parsed > 0) {
                    this.parcelDecayIntervalMs = decayRaw.endsWith('s') ? parsed * 1000 : parsed;
                }
            }

            // Extract movement duration
            const moveDur = sensorPayload.config.GAME?.player?.movement_duration;
            if (typeof moveDur === 'number' && moveDur > 0) {
                this.movementDurationMs = moveDur;
            } else if (typeof moveDur === 'string') {
                const parsed = parseInt(moveDur, 10);
                if (!isNaN(parsed) && parsed > 0) this.movementDurationMs = parsed;
            }
        }

        // 3. Revise Peers
        if (sensorPayload.agents) {
            const visibleIds = new Set();
            sensorPayload.agents.forEach(p => {
                if (p.id !== this.me.id) {
                    visibleIds.add(p.id);
                    const existing = this.peers.get(p.id);
                    this.peers.set(p.id, {
                        ...existing,
                        id: p.id,
                        name: p.name || p.id,
                        x: Math.round(p.x),
                        y: Math.round(p.y),
                        score: p.score || 0,
                        source: 'sensor',
                        lastSeen: Date.now()
                    });
                }
            });

            // Clean up sensor-sighted peers that are no longer visible but should be
            for (const [id, peer] of this.peers.entries()) {
                if (!visibleIds.has(id) && peer.source === 'sensor') {
                    const dist = Math.abs(peer.x - this.me.x) + Math.abs(peer.y - this.me.y);
                    if (dist < this.observationDistance) {
                        this.peers.delete(id);
                    }
                }
            }
        }

        // 4. Revise Crates (Spatial Memory Grid)
        if (sensorPayload.crates) {
            this._reviseCratesSpatialMemory(sensorPayload.crates);
        }

        // 5. Revise Parcels (Decay & Line of Sight Removal)
        if (sensorPayload.parcels) {
            this._reviseParcelsSpatialMemory(sensorPayload.parcels);
        }

        // Clean stale contracts/states
        this._cleanStaleBeliefs();
    }

    /**
     * Updates crates memory, keeping track of crates outside observation distance
     * and removing crates inside observation distance that are no longer present.
     * @param {Array<{id: string, x: number, y: number}>} sensedCrates - Currently sensed crates.
     * @private
     */
    _reviseCratesSpatialMemory(sensedCrates) {
        if (!this.map) return;

        // 0. Lazy initialize crates on all CRATE_SPAWN (4) tiles if memory is empty
        if (this.crates.size === 0) {
            for (let x = 0; x < this.map.width; x++) {
                for (let y = 0; y < this.map.height; y++) {
                    if (this.map.getTileCode(x, y) === 4) { // CRATE_SPAWN
                        const cid = `crate_init_${x}_${y}`;
                        this.crates.set(cid, { id: cid, x, y });
                    }
                }
            }
            console.log(`[BDI Beliefs] Lazy-initialized ${this.crates.size} crates on CRATE_SPAWN tiles.`);
        }

        // Count spawn tiles to calculate capacity cap
        let spawnCount = 0;
        for (let x = 0; x < this.map.width; x++) {
            for (let y = 0; y < this.map.height; y++) {
                if (this.map.getTileCode(x, y) === 4) {
                    spawnCount++;
                }
            }
        }

        const me = this.me;
        const visibilityDist = this.observationDistance;

        // 1. Map sensed crates by coordinate for quick lookups
        const sensedByCoord = new Map();
        for (const c of sensedCrates) {
            const roundedX = Math.round(c.x);
            const roundedY = Math.round(c.y);
            sensedByCoord.set(`${roundedX},${roundedY}`, c);
        }

        // 2. Purge memory of crates only if their last known tile is visible but empty
        const matchedCrateIds = new Set();
        for (const [id, c] of this.crates.entries()) {
            const dist = Math.abs(c.x - me.x) + Math.abs(c.y - me.y);
            if (dist < visibilityDist) {
                const key = `${c.x},${c.y}`;
                if (!sensedByCoord.has(key)) {
                    this.crates.delete(id);
                } else {
                    matchedCrateIds.add(id);
                }
            }
        }

        // 3. Process newly sensed crates: Match to existing out-of-view crates if possible
        for (const c of sensedCrates) {
            const roundedX = Math.round(c.x);
            const roundedY = Math.round(c.y);

            // Check if there is already a crate at this coordinate in our beliefs
            let existingCrate = null;
            for (const ec of this.crates.values()) {
                if (Math.round(ec.x) === roundedX && Math.round(ec.y) === roundedY) {
                    existingCrate = ec;
                    break;
                }
            }

            if (existingCrate) {
                matchedCrateIds.add(existingCrate.id);
                existingCrate.x = roundedX;
                existingCrate.y = roundedY;
                if (c.id && c.id !== existingCrate.id) {
                    this.crates.delete(existingCrate.id);
                    matchedCrateIds.delete(existingCrate.id);
                    existingCrate.id = c.id;
                    this.crates.set(c.id, existingCrate);
                    matchedCrateIds.add(c.id);
                }
                continue;
            }

            // No crate at this coordinate in our beliefs. Try to associate with closest unmatched out-of-view crate
            let closestCrate = null;
            let minDistance = Infinity;

            for (const ec of this.crates.values()) {
                if (matchedCrateIds.has(ec.id)) continue;

                const distToMe = Math.abs(ec.x - me.x) + Math.abs(ec.y - me.y);
                if (distToMe >= visibilityDist) {
                    const distToSensed = Math.abs(ec.x - roundedX) + Math.abs(ec.y - roundedY);
                    if (distToSensed < minDistance) {
                        minDistance = distToSensed;
                        closestCrate = ec;
                    }
                }
            }

            if (closestCrate) {
                this.crates.delete(closestCrate.id);
                closestCrate.x = roundedX;
                closestCrate.y = roundedY;
                const cid = c.id || closestCrate.id;
                closestCrate.id = cid;
                this.crates.set(cid, closestCrate);
                matchedCrateIds.add(cid);
            } else {
                const cid = c.id || `crate_${roundedX}_${roundedY}`;
                this.crates.set(cid, { id: cid, x: roundedX, y: roundedY });
                matchedCrateIds.add(cid);
            }
        }

        // 4. Enforce that crates can only sit on crate-capable tiles (codes 4 or 5)
        // (Disabled: crates can sit on pavement (code 3) and block corridors,
        // purging them causes the agent to forget the obstacle and collide.)
        /*
        for (const [id, crate] of this.crates.entries()) {
            const code = this.map.getTileCode(crate.x, crate.y);
            if (code !== 4 && code !== 5) {
                console.log(`[BDI Crate Clean] Removing crate ${id} at (${crate.x}, ${crate.y}) since tile code ${code} is not crate-capable.`);
                this.crates.delete(id);
            }
        }
        */

        // 5. Enforce maximum crate limit based on spawnCount
        if (spawnCount > 0 && this.crates.size > spawnCount) {
            console.log(`[BDI Crate Clean] Crates memory size (${this.crates.size}) exceeds spawn tiles count (${spawnCount}). Pruning furthest crates.`);
            const outOfViewCrates = [];
            for (const [id, c] of this.crates.entries()) {
                const distToMe = Math.abs(c.x - me.x) + Math.abs(c.y - me.y);
                if (distToMe >= visibilityDist) {
                    outOfViewCrates.push({ id, distToMe });
                }
            }

            outOfViewCrates.sort((a, b) => b.distToMe - a.distToMe);

            while (this.crates.size > spawnCount && outOfViewCrates.length > 0) {
                const toRemove = outOfViewCrates.shift();
                console.log(`[BDI Crate Clean] Pruning furthest crate ${toRemove.id} from memory.`);
                this.crates.delete(toRemove.id);
            }
        }
    }

    /**
     * Updates parcels memory, handling line-of-sight pickups/decays.
     * @param {Array<{id: string, x: number, y: number, reward: number, carriedBy: string|null}>} sensedParcels - Currently sensed parcels.
     * @private
     */
    _reviseParcelsSpatialMemory(sensedParcels) {
        const sensedParcelMap = new Map();
        sensedParcels.forEach(p => {
            sensedParcelMap.set(p.id, p);
            this.parcels.set(p.id, p);

            // Track carriage history
            if (p.carriedBy) {
                if (!this.parcelHistory.has(p.id)) {
                    this.parcelHistory.set(p.id, new Set());
                }
                this.parcelHistory.get(p.id).add(p.carriedBy);
            }
        });

        // Ensure all carried parcels exist in this.parcels
        for (const cid of this.carried) {
            if (!this.parcelHistory.has(cid)) {
                this.parcelHistory.set(cid, new Set());
            }
            if (this.me.id) {
                this.parcelHistory.get(cid).add(this.me.id);
            }

            if (!this.parcels.has(cid)) {
                this.parcels.set(cid, {
                    id: cid,
                    x: this.me.x,
                    y: this.me.y,
                    reward: 20, // fallback reward
                    carriedBy: this.me.id,
                    lastDecayed: Date.now()
                });
            }
        }

        // Loop through existing memory.
        for (const [id, parcel] of this.parcels.entries()) {
            if (sensedParcelMap.has(id)) continue;

            // If we are carrying this parcel, do not delete it!
            // Instead, update its position to our current position,
            // and decay its reward based on elapsed time.
            if (this.carried.includes(id)) {
                parcel.x = this.me.x;
                parcel.y = this.me.y;
                parcel.carriedBy = this.me.id;

                const now = Date.now();
                if (!parcel.lastDecayed) {
                    parcel.lastDecayed = now;
                }
                const decayMs = this.parcelDecayIntervalMs;
                if (isFinite(decayMs) && decayMs > 0) {
                    const elapsed = now - parcel.lastDecayed;
                    if (elapsed >= decayMs) {
                        const decayAmount = Math.floor(elapsed / decayMs);
                        parcel.reward = Math.max(0, parcel.reward - decayAmount);
                        parcel.lastDecayed = now - (elapsed % decayMs);
                    }
                } else {
                    parcel.lastDecayed = now;
                }
                continue;
            }

            const distance = Math.abs(parcel.x - this.me.x) + Math.abs(parcel.y - this.me.y);
            if (distance < this.observationDistance) {
                // Sensed area doesn't contain this parcel anymore. It decayed or was collected.
                this.parcels.delete(id);
                this.lockedTargets.delete(id);
            }
        }
    }

    /**
     * Cleans up stale variables, expired contracts, and target locks.
     * @private
     */
    _cleanStaleBeliefs() {
        // Clear targets that no longer exist in the parcels map.
        for (const targetId of this.lockedTargets) {
            if (!this.parcels.has(targetId)) {
                this.lockedTargets.delete(targetId);
            }
        }
        // Clean blocked targets older than 3000ms
        const now = Date.now();
        for (const [key, ts] of this.blockedTargets.entries()) {
            if (now - ts > 3000) {
                this.blockedTargets.delete(key);
            }
        }
        // Clean stale P2P peer status info (older than 5000ms)
        for (const [id, peer] of this.peers.entries()) {
            if (peer.source === 'p2p' && now - peer.lastSeen > 5000) {
                this.peers.delete(id);
            }
        }
    }

    /**
     * Translates LLM coordinator-structured rules into the internal BDI policy representation.
     * @param {Array<Object>|Object} rulesInput - Rules from coordinator.
     */
    applyPolicyRules(rulesInput) {
        if (!rulesInput) return;
        
        if (Array.isArray(rulesInput)) {
            // Overwrite/apply properties from each rule object in the array
            for (const r of rulesInput) {
                if (r.tiles && Array.isArray(r.tiles)) {
                    // If rule has negative bonus/penalty, these tiles should be avoided
                    if (r.bonus !== null && r.bonus < -500) {
                        for (const t of r.tiles) {
                            if (!this.policyRules.avoidTiles.includes(t)) {
                                this.policyRules.avoidTiles.push(t);
                            }
                        }
                    }
                }
                
                if (r.minReward !== null && r.minReward !== undefined) {
                    this.policyRules.minRewardThreshold = Number(r.minReward);
                }
                
                if (r.maxReward !== null && r.maxReward !== undefined) {
                    this.policyRules.maxRewardLimit = Number(r.maxReward);
                }
                
                if (r.stackSizeBounds && Array.isArray(r.stackSizeBounds) && r.stackSizeBounds.length > 0) {
                    const firstBound = r.stackSizeBounds[0];
                    if (firstBound && firstBound.min !== null && firstBound.min !== undefined) {
                        this.policyRules.requiredStackSize = Number(firstBound.min);
                    }
                }
                
                // Build and add multiplier/bonus rules if present
                if (r.multiplier !== null || r.bonus !== null) {
                    let conds = [];
                    if (r.tiles && r.tiles.length > 0 && !r.all_tiles) {
                        const tileCond = r.tiles.map(t => {
                            const [tx, ty] = t.split(',');
                            return `(x == ${tx} && y == ${ty})`;
                        }).join(' || ');
                        conds.push(`(${tileCond})`);
                    }
                    
                    if (r.stackSizeBounds && r.stackSizeBounds.length > 0) {
                        const sizeCond = r.stackSizeBounds.map(b => {
                            if (b.min !== null && b.max !== null) return `(carrying.size >= ${b.min} && carrying.size < ${b.max})`;
                            if (b.min !== null) return `(carrying.size >= ${b.min})`;
                            if (b.max !== null) return `(carrying.size < ${b.max})`;
                            return 'true';
                        }).join(' || ');
                        conds.push(`(${sizeCond})`);
                    }
                    
                    const condition = conds.length > 0 ? conds.join(' && ') : 'true';
                    
                    if (r.multiplier !== null && r.multiplier !== undefined) {
                        this.policyRules.multiplierRules.push({ condition, multiplier: Number(r.multiplier) });
                    }
                    if (r.bonus !== null && r.bonus !== undefined) {
                        this.policyRules.bonusRules.push({ condition, bonus: Number(r.bonus) });
                    }
                }
            }
        } else if (typeof rulesInput === 'object') {
            Object.assign(this.policyRules, rulesInput);
        }
    }
}
