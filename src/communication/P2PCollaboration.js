/**
 * @module communication/P2PCollaboration
 * @description Coordinates P2P chat sync protocols, target locking conflict-resolution,
 * and multi-agent rendezvous contract handshakes over the game chat logs.
 */

import { AGENT_IDS } from '../config/config.js';
import { logger } from '../utils/logger.js';

/**
 * P2PManager to handle chat-based real-time coordination.
 */
export class P2PManager {
    /**
     * Creates a P2PManager instance.
     * @param {import('../agent/BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
     * @param {Object} socket - Deliveroo socket client.
     */
    constructor(beliefs, socket) {
        /** @type {import('../agent/BeliefBase.js').BeliefBase} */
        this.beliefs = beliefs;
        /** @type {Object} */
        this.socket = socket;

        /**
         * Regex filter to identify cooperative P2P JSON structures.
         * @type {RegExp}
         */
        this.msgRegex = /^\{"type":"[A-Z_]+".*\}$/;
    }

    /**
     * Pre-validates and parses incoming chat messages from peers.
     * @param {string} senderId - Identifier of the sender.
     * @param {string} rawMessage - Raw message text.
     */
    async handleIncomingChat(senderId, rawMessage) {
        // Skip messages sent by ourselves.
        if (senderId === this.beliefs.me.id) return;

        // Skip messages that do not match the P2P JSON schema structure.
        if (!this.msgRegex.test(rawMessage)) return;

        try {
            const message = JSON.parse(rawMessage);
            logger.p2p(message.type, message, senderId, true);

            switch (message.type) {
                case 'PING':
                    this.sendPong(senderId);
                    break;

                case 'PONG':
                    if (message.payload) {
                        this.beliefs.peers.set(senderId, {
                            id: senderId,
                            x: message.payload.x,
                            y: message.payload.y,
                            score: message.payload.score
                        });
                    }
                    break;

                case 'PEER_STATUS':
                    if (message.payload) {
                        this.beliefs.peers.set(senderId, {
                            id: senderId,
                            x: message.payload.x,
                            y: message.payload.y,
                            score: message.payload.score || 0,
                            nextStep: message.payload.nextStep || null,
                            path: message.payload.path || [],
                            source: 'p2p',
                            lastSeen: Date.now()
                        });

                        // Merge peer's known crates into our beliefs
                        if (Array.isArray(message.payload.crates)) {
                            const visibilityDist = this.beliefs.observationDistance;
                            for (const pc of message.payload.crates) {
                                // Skip if the peer's coordinate is inside our own observation distance,
                                // but we don't sense a crate there (meaning we can see that it's empty).
                                const distToMe = Math.abs(pc.x - this.beliefs.me.x) + Math.abs(pc.y - this.beliefs.me.y);
                                if (distToMe < visibilityDist) {
                                    const hasLocalCrateAtCoord = Array.from(this.beliefs.crates.values()).some(
                                        c => c.x === pc.x && c.y === pc.y
                                    );
                                    if (!hasLocalCrateAtCoord) {
                                        continue;
                                    }
                                }

                                // Delete any existing crate in memory at the same coordinate to prevent duplicates
                                for (const [id, crate] of this.beliefs.crates.entries()) {
                                    if (id !== pc.id && crate.x === pc.x && crate.y === pc.y) {
                                        this.beliefs.crates.delete(id);
                                    }
                                }

                                // If the crate ID already exists, this will update its position.
                                // Otherwise, it registers the new crate.
                                this.beliefs.crates.set(pc.id, { id: pc.id, x: pc.x, y: pc.y });
                            }
                        }
                    }
                    break;

                case 'LOCK_TARGET':
                    this._handleLockConflict(senderId, message.targetId);
                    break;

                case 'RELEASE_TARGET':
                    this.beliefs.lockedTargets.delete(message.targetId);
                    break;

                case 'PROPOSE_CONTRACT':
                    this._evaluateProposedContract(senderId, message);
                    break;

                case 'ACCEPT_CONTRACT':
                    this._confirmActiveContract(message.coopId);
                    break;

                case 'SIGNAL_READY':
                    this._updateContractStatus(message.coopId, 'READY');
                    break;

                case 'RELEASE_CARGO':
                    this._updateContractStatus(message.coopId, 'RELEASED');
                    break;

                case 'CLOSE_CONTRACT':
                    this.beliefs.activeContracts.delete(message.coopId);
                    break;

                case 'APPLY_RULES':
                    Object.assign(this.beliefs.policyRules, message.rules);
                    logger.policyUpdate(this.beliefs.me.id || 'me', message.rules);
                    break;

                case 'MOVE_TO':
                    logger.movement(this.beliefs.me.id || 'me', message.x, message.y);
                    this.beliefs.activeContracts.set('admin_move', {
                        coopId: 'admin_move',
                        type: 'MOVE_TO',
                        x: message.x,
                        y: message.y,
                        status: 'ACTIVE'
                    });
                    break;

                case 'INSTRUCT_SAY':
                    logger.toolCall('instruct_agent_to_say', { message: message.message });
                    await this.socket.emitShout(message.message);
                    break;
            }
        } catch (e) {
            logger.error('P2PParse', e);
        }
    }

    /**
     * Resolves the peer agent ID.
     * @returns {string|null} Peer ID.
     */
    getPeerAgentId() {
        const isBdiMe = this.beliefs.me.id === AGENT_IDS.BDI_AGENT_ID || (this.beliefs.me.name && (this.beliefs.me.name.includes('pddl') || this.beliefs.me.name.includes('executor') || this.beliefs.me.name.startsWith('autobots_pddl')));
        
        if (isBdiMe) {
            // We are BDI executor. Try to find LLM coordinator.
            for (const [peerId, peer] of this.beliefs.peers.entries()) {
                if (peerId !== this.beliefs.me.id && peer.name && (peer.name.includes('llm') || peer.name.includes('coordinator') || peer.name.startsWith('autobots_llm'))) {
                    return peerId;
                }
            }
            // Fallback to the first peer that is not ourselves
            for (const peerId of this.beliefs.peers.keys()) {
                if (peerId !== this.beliefs.me.id) return peerId;
            }
            return AGENT_IDS.LLM_AGENT_ID;
        } else {
            // We are LLM coordinator. Try to find BDI executor.
            for (const [peerId, peer] of this.beliefs.peers.entries()) {
                if (peerId !== this.beliefs.me.id && peer.name && (peer.name.includes('pddl') || peer.name.includes('executor') || peer.name.startsWith('autobots_pddl'))) {
                    return peerId;
                }
            }
            // Fallback to the first peer that is not ourselves
            for (const peerId of this.beliefs.peers.keys()) {
                if (peerId !== this.beliefs.me.id) return peerId;
            }
            return AGENT_IDS.BDI_AGENT_ID;
        }
    }

    /**
     * Broadcasts a P2P message or sends directly to peer if known.
     * @param {Object} message - Message payload object.
     * @param {string} [targetId] - Specific target agent ID to send to.
     */
    async broadcast(message, targetId) {
        const rawString = JSON.stringify(message);
        const recipient = targetId || this.getPeerAgentId();
        if (recipient) {
            try {
                await this.socket.emitSay(recipient, rawString);
                return;
            } catch (e) {
                // Fallback to shout on failure
            }
        }
        await this.socket.emitShout(rawString);
    }

    /**
     * Sends a pong heartbeat back containing our agent's coordinates.
     * @param {string} [targetId] - Recipient agent ID.
     */
    sendPong(targetId) {
        this.broadcast({
            type: 'PONG',
            payload: {
                x: this.beliefs.me.x,
                y: this.beliefs.me.y,
                score: this.beliefs.me.score
            }
        }, targetId);
    }

    /**
     * Handles target lock collisions, breaking ties using Agent IDs.
     * @param {string} peerId - Peer ID claiming the lock.
     * @param {string} targetId - Target parcel ID.
     * @private
     */
    _handleLockConflict(peerId, targetId) {
        // If we also targeted the same parcel, resolve conflict:
        // Lower alphabetical Agent ID wins.
        const myId = this.beliefs.me.id;
        const peerIntention = this.beliefs.lockedTargets.has(targetId);

        if (peerIntention && peerId < myId) {
            console.log(`[P2P] Lock conflict for ${targetId}: peer ${peerId} wins over ${myId}. Releasing lock.`);
            this.beliefs.lockedTargets.delete(targetId);
            // Trigger replanning by clearing target
            if (this.beliefs.me.status === 'picking') {
                this.beliefs.me.status = 'free';
            }
        } else {
            this.beliefs.lockedTargets.add(targetId);
        }
    }

    /**
     * Evaluates a cooperative contract proposal.
     * @param {string} senderId - Proposer.
     * @param {Object} message - Proposal message payload.
     * @private
     */
    _evaluateProposedContract(senderId, message) {
        // Pre-validate that coordinate is reachable.
        if (this.beliefs.map && this.beliefs.map.isWalkableTile(message.x, message.y)) {
            console.log(`[P2P] Accepting contract proposal ${message.coopId} at (${message.x}, ${message.y})`);
            this.beliefs.activeContracts.set(message.coopId, {
                coopId: message.coopId,
                senderId: senderId,
                type: message.type,
                x: message.x,
                y: message.y,
                status: 'ACCEPTED'
            });
            this.broadcast({ type: 'ACCEPT_CONTRACT', coopId: message.coopId }, senderId);
        } else {
            console.warn(`[P2P] Rejecting contract proposal ${message.coopId} - Coordinates unreachable.`);
        }
    }

    /**
     * Confirms contract activation upon receiving acceptance.
     * @param {string} coopId - Contract ID.
     * @private
     */
    _confirmActiveContract(coopId) {
        const contract = this.beliefs.activeContracts.get(coopId);
        if (contract) {
            contract.status = 'ACTIVE';
            console.log(`[P2P] Contract ${coopId} is now active.`);
        }
    }

    /**
     * Updates local status for cooperative contracts.
     * @param {string} coopId - Contract ID.
     * @param {string} status - New status code.
     * @private
     */
    _updateContractStatus(coopId, status) {
        const contract = this.beliefs.activeContracts.get(coopId);
        if (contract) {
            contract.status = status;
            console.log(`[P2P] Contract ${coopId} status updated to: ${status}`);
        }
    }
}
