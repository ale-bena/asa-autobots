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
         * @type {{id: string, name: string, x: number, y: number, score: number, status: string}}
         */
        this.me = { id: '', name: '', x: 0, y: 0, score: 0, status: 'free' };

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
        }

        // 2. Revise Map Config if present
        if (sensorPayload.config) {
            this.observationDistance = sensorPayload.config.GAME.player.observation_distance || 5;
        }

        // 3. Revise Peers
        if (sensorPayload.peers) {
            this.peers.clear();
            sensorPayload.peers.forEach(p => {
                if (p.id !== this.me.id) {
                    this.peers.set(p.id, p);
                }
            });
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
        const sensedCrateMap = new Map();
        sensedCrates.forEach(c => {
            sensedCrateMap.set(c.id, c);
            this.crates.set(c.id, { id: c.id, x: c.x, y: c.y });
        });

        // Loop through existing memory and remove any that should be visible but are not sensed.
        for (const [id, crate] of this.crates.entries()) {
            if (sensedCrateMap.has(id)) continue;

            // Calculate Manhattan distance.
            const distance = Math.abs(crate.x - this.me.x) + Math.abs(crate.y - this.me.y);
            if (distance < this.observationDistance) {
                // If it should be visible in line-of-sight but isn't, it must have been moved or removed.
                this.crates.delete(id);
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
        });

        // Loop through existing memory.
        for (const [id, parcel] of this.parcels.entries()) {
            if (sensedParcelMap.has(id)) continue;

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
    }
}
