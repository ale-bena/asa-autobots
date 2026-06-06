/**
 * @module communication/P2PCollaboration
 * @description Coordinates P2P chat sync protocols, target locking conflict-resolution,
 * and multi-agent rendezvous contract handshakes over the game chat logs.
 */

import { AGENT_IDS } from '../config/config.js';

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
    handleIncomingChat(senderId, rawMessage) {
        // Skip messages sent by ourselves.
        if (senderId === this.beliefs.me.id) return;

        // Skip messages that do not match the P2P JSON schema structure.
        if (!this.msgRegex.test(rawMessage)) return;

        try {
            const message = JSON.parse(rawMessage);
            console.log(`[P2P] Parsed message from ${senderId}:`, message.type);

            switch (message.type) {
                case 'PING':
                    this.sendPong();
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
                    console.log('[P2P] Policy rules updated:', message.rules);
                    break;

                case 'MOVE_TO':
                    console.log(`[P2P] Received direct MOVE_TO command: (${message.x}, ${message.y})`);
                    this.beliefs.activeContracts.set('admin_move', {
                        coopId: 'admin_move',
                        type: 'MOVE_TO',
                        x: message.x,
                        y: message.y,
                        status: 'ACTIVE'
                    });
                    break;

                case 'INSTRUCT_SAY':
                    console.log('[P2P] Direct say command executed:', message.message);
                    this.socket.emit('say', message.message);
                    break;
            }
        } catch (e) {
            console.error('[P2P] Failed to parse valid P2P chat message:', e.message);
        }
    }

    /**
     * Broadcasts a P2P message to all clients in the game room.
     * @param {Object} message - Message payload object.
     */
    broadcast(message) {
        const rawString = JSON.stringify(message);
        this.socket.emit('say', rawString);
    }

    /**
     * Sends a pong heartbeat back containing our agent's coordinates.
     */
    sendPong() {
        this.broadcast({
            type: 'PONG',
            payload: {
                x: this.beliefs.me.x,
                y: this.beliefs.me.y,
                score: this.beliefs.me.score
            }
        });
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
            this.broadcast({ type: 'ACCEPT_CONTRACT', coopId: message.coopId });
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
