import { test, describe } from 'node:test';
import assert from 'node:assert';
import { P2PManager } from '../src/communication/P2PCollaboration.js';
import { BeliefBase } from '../src/agent/BeliefBase.js';
import { AGENT_IDS } from '../src/config/config.js';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';

class MockSocket {
    constructor() {
        this.emitted = [];
    }
    async emitSay(recipient, message) {
        this.emitted.push({ type: 'say', recipient, message });
    }
    async emitShout(message) {
        this.emitted.push({ type: 'shout', message });
    }
}

describe('P2PCollaboration tests', () => {
    test('initialization and helper getPeerAgentId', () => {
        const beliefs = new BeliefBase();
        beliefs.me.id = AGENT_IDS.BDI_AGENT_ID;
        const socket = new MockSocket();
        const p2p = new P2PManager(beliefs, socket);
        assert.strictEqual(p2p.getPeerAgentId(), AGENT_IDS.LLM_AGENT_ID);
        
        beliefs.me.id = AGENT_IDS.LLM_AGENT_ID;
        assert.strictEqual(p2p.getPeerAgentId(), AGENT_IDS.BDI_AGENT_ID);
    });

    test('handleIncomingChat message schema filters invalid strings', async () => {
        const beliefs = new BeliefBase();
        const socket = new MockSocket();
        const p2p = new P2PManager(beliefs, socket);

        // Msg should contain valid JSON structure matching msgRegex: /^\s*\{.*\}\s*$/
        await p2p.handleIncomingChat('sender_1', 'not-a-json');
        assert.strictEqual(beliefs.peers.size, 0);
    });

    test('handleIncomingChat messages: PING, PONG, SYNC_REQ, SYNC_ACK', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, name: 'BDI_Me', x: 1, y: 1, score: 0 };
        const socket = new MockSocket();
        const p2p = new P2PManager(beliefs, socket);

        // 1. PING -> should send PONG with our coords
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({ type: 'PING' }));
        assert.strictEqual(socket.emitted.length, 1);
        assert.strictEqual(socket.emitted[0].recipient, AGENT_IDS.LLM_AGENT_ID);
        const reply = JSON.parse(socket.emitted[0].message);
        assert.strictEqual(reply.type, 'PONG');
        assert.strictEqual(reply.payload.x, 1);

        // 2. PONG -> should update peer info in beliefs
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'PONG',
            payload: { name: 'LLM_Peer', x: 2, y: 2, score: 20 }
        }));
        assert.ok(beliefs.peers.has(AGENT_IDS.LLM_AGENT_ID));
        const peer = beliefs.peers.get(AGENT_IDS.LLM_AGENT_ID);
        assert.strictEqual(peer.name, 'LLM_Peer');
        assert.strictEqual(peer.x, 2);

        // 3. SYNC_REQ -> should reply with SYNC_ACK
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({ type: 'SYNC_REQ' }));
        const syncAck = JSON.parse(socket.emitted[1].message);
        assert.strictEqual(syncAck.type, 'SYNC_ACK');

        // 4. SYNC_ACK -> should set synced = true in variables
        assert.ok(!beliefs.variables.synced);
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({ type: 'SYNC_ACK' }));
        assert.strictEqual(beliefs.variables.synced, true);
    });

    test('handleIncomingChat messages: PEER_STATUS and crate memory merging', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 };
        beliefs.observationDistance = 5;
        beliefs.crates.set('local_crate', { id: 'local_crate', x: 1, y: 1 });

        const socket = new MockSocket();
        const p2p = new P2PManager(beliefs, socket);

        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'PEER_STATUS',
            payload: {
                name: 'LLM_Peer',
                x: 3,
                y: 3,
                score: 50,
                nextStep: { x: 3, y: 4 },
                path: [{ x: 3, y: 4 }],
                carried: ['p1'],
                currentGoal: { type: 'pickup', targetId: 'p1' },
                crates: [
                    { id: 'peer_crate_far', x: 7, y: 7 }, // Far crate (should be added)
                    { id: 'peer_crate_near_missing', x: 2, y: 2 }, // Near but not locally observed (should be skipped because within observation range but we didn't sense it)
                    { id: 'local_crate', x: 1, y: 1 } // Already exists (should update/keep)
                ]
            }
        }));

        const peer = beliefs.peers.get(AGENT_IDS.LLM_AGENT_ID);
        assert.strictEqual(peer.name, 'LLM_Peer');
        assert.strictEqual(peer.currentGoal.type, 'pickup');
        
        assert.ok(beliefs.crates.has('peer_crate_far'));
        assert.ok(!beliefs.crates.has('peer_crate_near_missing'));
        assert.ok(beliefs.crates.has('local_crate'));
    });

    test('handleIncomingChat messages: LOCK_TARGET and RELEASE_TARGET', async () => {
        // Tie-breaker check: lower alphabetical Agent ID wins
        // We are BDI_AGENT_ID (agent_pddl_1). LLM_AGENT_ID is (agent_llm_1).
        // Since BDI_AGENT_ID < LLM_AGENT_ID alphabetically, BDI_AGENT_ID wins lock conflicts.
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_pddl_2', status: 'picking' };
        beliefs.lockedTargets.add('parcel_1');

        const socket = new MockSocket();
        const p2p = new P2PManager(beliefs, socket);

        // Case 1: Peer tries to claim lock. Peer is 'agent_pddl_3' (alphabetically higher, i.e. lower priority).
        // We win, so lock remains ours and is NOT released.
        await p2p.handleIncomingChat('agent_pddl_3', JSON.stringify({
            type: 'LOCK_TARGET',
            targetId: 'parcel_1'
        }));
        assert.ok(beliefs.lockedTargets.has('parcel_1'));
        assert.strictEqual(beliefs.me.status, 'picking');

        // Case 2: Peer is 'agent_pddl_1' (alphabetically lower, i.e. higher priority).
        // Peer wins, lock is released.
        await p2p.handleIncomingChat('agent_pddl_1', JSON.stringify({
            type: 'LOCK_TARGET',
            targetId: 'parcel_1'
        }));
        assert.ok(!beliefs.lockedTargets.has('parcel_1'));
        assert.strictEqual(beliefs.me.status, 'free');

        // Case 3: RELEASE_TARGET
        beliefs.lockedTargets.add('parcel_2');
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'RELEASE_TARGET',
            targetId: 'parcel_2'
        }));
        assert.ok(!beliefs.lockedTargets.has('parcel_2'));
    });

    test('handleIncomingChat messages: PROPOSE_CONTRACT, ACCEPT_CONTRACT, SIGNAL_READY, RELEASE_CARGO, CLOSE_CONTRACT', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID };
        beliefs.map = new MapRepresentation(5, 5, [
            { x: 2, y: 2, type: '3' },
            { x: 3, y: 3, type: '0' } // Wall
        ]);

        const socket = new MockSocket();
        const p2p = new P2PManager(beliefs, socket);

        // 1. Propose contract to unreachable coordinate -> should reject
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'PROPOSE_CONTRACT',
            coopId: 'coop_1',
            x: 3, y: 3,
            contractType: 'RELAY'
        }));
        assert.ok(!beliefs.activeContracts.has('coop_1'));

        // 2. Propose contract to walkable coordinate -> should accept
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'PROPOSE_CONTRACT',
            coopId: 'coop_2',
            x: 2, y: 2,
            contractType: 'RELAY'
        }));
        assert.ok(beliefs.activeContracts.has('coop_2'));
        const contract = beliefs.activeContracts.get('coop_2');
        assert.strictEqual(contract.status, 'ACCEPTED');
        assert.strictEqual(socket.emitted[socket.emitted.length - 1].recipient, AGENT_IDS.LLM_AGENT_ID);
        assert.strictEqual(JSON.parse(socket.emitted[socket.emitted.length - 1].message).type, 'ACCEPT_CONTRACT');

        // 3. ACCEPT_CONTRACT -> set status to ACTIVE
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'ACCEPT_CONTRACT',
            coopId: 'coop_2'
        }));
        assert.strictEqual(beliefs.activeContracts.get('coop_2').status, 'ACTIVE');

        // 4. SIGNAL_READY -> status updated to READY
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'SIGNAL_READY',
            coopId: 'coop_2'
        }));
        assert.strictEqual(beliefs.activeContracts.get('coop_2').status, 'READY');

        // 5. RELEASE_CARGO -> status updated to RELEASED
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'RELEASE_CARGO',
            coopId: 'coop_2'
        }));
        assert.strictEqual(beliefs.activeContracts.get('coop_2').status, 'RELEASED');

        // 6. CLOSE_CONTRACT -> contract removed
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'CLOSE_CONTRACT',
            coopId: 'coop_2'
        }));
        assert.ok(!beliefs.activeContracts.has('coop_2'));
    });

    test('handleIncomingChat messages: MOVE_TO, HOLD, RESUME, SET_VARIABLE', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID };
        const socket = new MockSocket();
        const p2p = new P2PManager(beliefs, socket);

        // 1. MOVE_TO -> registers admin_move contract
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'MOVE_TO',
            x: 4,
            y: 4,
            holdOnArrival: true,
            dropOnArrival: false
        }));
        assert.ok(beliefs.activeContracts.has('admin_move'));
        const mv = beliefs.activeContracts.get('admin_move');
        assert.strictEqual(mv.x, 4);
        assert.strictEqual(mv.holdOnArrival, true);

        // 2. MOVE_TO_ACK -> updates variables
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'MOVE_TO_ACK',
            x: 4,
            y: 4,
            success: true
        }));
        assert.ok(beliefs.variables.moveToAck);
        assert.strictEqual(beliefs.variables.moveToAck.success, true);

        // 3. HOLD -> sets hold = true
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({ type: 'HOLD' }));
        assert.strictEqual(beliefs.hold, true);

        // 4. RESUME -> sets hold = false
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({ type: 'RESUME' }));
        assert.strictEqual(beliefs.hold, false);

        // 5. SET_VARIABLE -> sets custom variable
        await p2p.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, JSON.stringify({
            type: 'SET_VARIABLE',
            name: 'test_var',
            value: 'my_val'
        }));
        assert.strictEqual(beliefs.variables.test_var, 'my_val');
    });
});
