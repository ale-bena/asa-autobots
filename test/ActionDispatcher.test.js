import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getDirection, logActionFailure, dispatchAction } from '../src/agent/ActionDispatcher.js';
import { BeliefBase } from '../src/agent/BeliefBase.js';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';
import fs from 'fs';

class MockSocket {
    constructor() {
        this.moveResult = null;
        this.pickupResult = null;
        this.putdownResult = false;
        this.sayResult = true;
        this.shoutResult = true;
        
        this.emitted = [];
    }

    async emitMove(dir) {
        this.emitted.push({ type: 'move', dir });
        return this.moveResult;
    }

    async emitPickup() {
        this.emitted.push({ type: 'pickup' });
        return this.pickupResult;
    }

    async emitPutdown(targets) {
        this.emitted.push({ type: 'putdown', targets });
        return this.putdownResult;
    }

    async emitSay(recipient, msg) {
        this.emitted.push({ type: 'say', recipient, msg });
        if (this.sayResult === 'throw') throw new Error('say failed');
        return this.sayResult;
    }

    async emitShout(msg) {
        this.emitted.push({ type: 'shout', msg });
        return this.shoutResult;
    }
}

describe('ActionDispatcher tests', () => {
    test('getDirection helper', () => {
        const me = { x: 2, y: 2 };
        assert.strictEqual(getDirection(me, { x: 3, y: 2 }), 'right');
        assert.strictEqual(getDirection(me, { x: 1, y: 2 }), 'left');
        assert.strictEqual(getDirection(me, { x: 2, y: 3 }), 'up');
        assert.strictEqual(getDirection(me, { x: 2, y: 1 }), 'down');
        assert.strictEqual(getDirection(me, { x: 2, y: 2 }), null);
    });

    test('logActionFailure logs correctly to file', () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent1', name: 'Agent One', x: 2, y: 3 };
        beliefs.carried = ['p1'];
        
        if (fs.existsSync('action_errors.log')) {
            fs.unlinkSync('action_errors.log');
        }

        logActionFailure(beliefs, { action: 'move', target: { x: 3, y: 3 } }, 'Blocked by wall');
        
        assert.ok(fs.existsSync('action_errors.log'));
        const content = fs.readFileSync('action_errors.log', 'utf8');
        const parsed = JSON.parse(content.trim());
        
        assert.strictEqual(parsed.agentId, 'agent1');
        assert.strictEqual(parsed.reason, 'Blocked by wall');
        assert.deepStrictEqual(parsed.carried, ['p1']);

        // Clean up
        fs.unlinkSync('action_errors.log');
    });

    test('dispatchAction: wait', async () => {
        const beliefs = new BeliefBase();
        const socket = new MockSocket();
        const engineState = { actionStats: { wait: { count: 0, totalTime: 0, avgTime: 0 } } };

        const success = await dispatchAction({ action: 'wait' }, beliefs, socket, engineState, null, null);
        assert.strictEqual(success, true);
        assert.strictEqual(engineState.actionStats.wait.count, 1);
    });

    test('dispatchAction: move invalid/non-adjacent', async () => {
        const beliefs = new BeliefBase();
        beliefs.map = new MapRepresentation(5, 5, [{ x: 0, y: 0, type: '3' }, { x: 2, y: 2, type: '3' }]);
        beliefs.me = { x: 0, y: 0 };
        const socket = new MockSocket();
        const engineState = { actionStats: {} };

        // Attempt move to non-adjacent (2,2)
        const success = await dispatchAction({ action: 'move', target: { x: 2, y: 2 } }, beliefs, socket, engineState, null, null);
        assert.strictEqual(success, false);
    });

    test('dispatchAction: move head-on conflict yield', async () => {
        const beliefs = new BeliefBase();
        beliefs.map = new MapRepresentation(5, 5, [{ x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '3' }]);
        beliefs.me = { id: 'agent_lower_priority_bdi', x: 0, y: 0 }; // Higher alphabetical ID -> lower priority
        
        // Peer has higher priority: 'agent_higher_priority_llm'
        beliefs.peers.set('peer1', {
            id: 'agent_higher_priority_llm',
            x: 1,
            y: 0,
            nextStep: { x: 0, y: 0 } // Head-on conflict!
        });

        const socket = new MockSocket();
        const engineState = { actionStats: {} };

        const success = await dispatchAction({ action: 'move', target: { x: 1, y: 0 } }, beliefs, socket, engineState, null, null);
        assert.strictEqual(success, false);
        assert.strictEqual(socket.emitted.length, 0); // Should yield and not emit move to socket
    });

    test('dispatchAction: move target conflict yield', async () => {
        const beliefs = new BeliefBase();
        beliefs.map = new MapRepresentation(5, 5, [{ x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '3' }]);
        beliefs.me = { id: 'agent_pddl_9', x: 0, y: 0 }; // Lower priority
        
        // Peer has higher priority: 'agent_pddl_1'
        beliefs.peers.set('peer1', {
            id: 'agent_pddl_1',
            nextStep: { x: 1, y: 0 } // Race conflict for (1,0)!
        });

        const socket = new MockSocket();
        const engineState = { actionStats: {} };

        const success = await dispatchAction({ action: 'move', target: { x: 1, y: 0 } }, beliefs, socket, engineState, null, null);
        assert.strictEqual(success, false);
    });

    test('dispatchAction: move success and crate pushing', async () => {
        const beliefs = new BeliefBase();
        beliefs.map = new MapRepresentation(5, 5, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' }
        ]);
        beliefs.me = { x: 0, y: 0 };
        // There is a crate at (1,0)
        beliefs.crates.set('crate_1', { id: 'crate_1', x: 1, y: 0 });

        const socket = new MockSocket();
        socket.moveResult = { x: 1, y: 0 }; // Simulation moves us to (1,0)
        
        const engineState = {
            collisionCounter: 2,
            actionStats: { move: { count: 0, totalTime: 0, avgTime: 0 } }
        };

        const success = await dispatchAction({ action: 'move', target: { x: 1, y: 0 } }, beliefs, socket, engineState, null, null);
        assert.strictEqual(success, true);
        assert.strictEqual(beliefs.me.x, 1);
        assert.strictEqual(engineState.collisionCounter, 0); // Resets count

        // Crate should have been pushed collinear: from (1,0) to (2,0) since dx = 1, dy = 0
        const crate = beliefs.crates.get('crate_1');
        assert.strictEqual(crate.x, 2);
        assert.strictEqual(crate.y, 0);
    });

    test('dispatchAction: move fail (collision) and bypass trigger', async () => {
        const beliefs = new BeliefBase();
        beliefs.map = new MapRepresentation(5, 5, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' }
        ]);
        beliefs.me = { x: 0, y: 0 };
        
        const socket = new MockSocket();
        socket.moveResult = null; // Collision!

        const engineState = {
            collisionCounter: 1,
            actionStats: { move: { count: 0, totalTime: 0, avgTime: 0 } },
            currentGoal: { type: 'pickup' },
            activeGenerator: {}
        };

        let planInstantiated = false;
        const mockInstantiate = () => {
            planInstantiated = true;
            return 'new_generator';
        };

        // 1st dispatch -> increments collision to 2 -> logs block key -> waits 100ms
        const success1 = await dispatchAction({ action: 'move', target: { x: 1, y: 0 } }, beliefs, socket, engineState, null, mockInstantiate);
        assert.strictEqual(success1, false);
        assert.strictEqual(engineState.collisionCounter, 2);
        assert.ok(beliefs.blockedTargets.has('1,0'));

        // 2nd dispatch -> increments collision to 3 -> triggers bypass plan instantiation
        const success2 = await dispatchAction({ action: 'move', target: { x: 1, y: 0 } }, beliefs, socket, engineState, null, mockInstantiate);
        assert.strictEqual(success2, false);
        assert.strictEqual(engineState.collisionCounter, 0); // Resets on Tier 2 bypass
        assert.strictEqual(planInstantiated, true);
        assert.strictEqual(engineState.activeGenerator, 'new_generator');
    });

    test('dispatchAction: pickup success', async () => {
        const beliefs = new BeliefBase();
        beliefs.carried = [];
        beliefs.parcels.set('p1', { id: 'p1', x: 1, y: 1 });
        
        const socket = new MockSocket();
        socket.pickupResult = ['p1']; // returns picked parcel IDs

        const engineState = {
            mustDeliver: false,
            actionStats: { pickup: { count: 0, totalTime: 0, avgTime: 0 } }
        };

        const success = await dispatchAction({ action: 'pickup', target: 'p1' }, beliefs, socket, engineState, null, null);
        assert.strictEqual(success, true);
        assert.deepStrictEqual(beliefs.carried, ['p1']);
        assert.strictEqual(engineState.mustDeliver, true);
    });

    test('dispatchAction: pickup success other formats', async () => {
        const beliefs = new BeliefBase();
        beliefs.carried = [];
        beliefs.parcels.set('p1', { id: 'p1', x: 1, y: 1 });
        
        const socket = new MockSocket();
        socket.pickupResult = [{ id: 'p1', xy: { x: 1, y: 1 } }]; // returns object array

        const engineState = {
            mustDeliver: false,
            actionStats: { pickup: { count: 0, totalTime: 0, avgTime: 0 } }
        };

        const success = await dispatchAction({ action: 'pickup', target: 'p1' }, beliefs, socket, engineState, null, null);
        assert.strictEqual(success, true);
        assert.deepStrictEqual(beliefs.carried, ['p1']);
    });

    test('dispatchAction: pickup fail', async () => {
        const beliefs = new BeliefBase();
        beliefs.carried = [];
        beliefs.parcels.set('p1', { id: 'p1', x: 1, y: 1 });
        beliefs.lockedTargets.add('p1');
        
        const socket = new MockSocket();
        socket.pickupResult = null; // Fails to pick up (decayed or other agent took it)

        const engineState = {
            mustDeliver: false,
            actionStats: { pickup: { count: 0, totalTime: 0, avgTime: 0 } }
        };

        const success = await dispatchAction({ action: 'pickup', target: 'p1' }, beliefs, socket, engineState, null, null);
        assert.strictEqual(success, false);
        
        // Should delete from beliefs
        assert.ok(!beliefs.parcels.has('p1'));
        assert.ok(!beliefs.lockedTargets.has('p1'));
    });

    test('dispatchAction: putdown success', async () => {
        const beliefs = new BeliefBase();
        beliefs.carried = ['p1', 'p2'];
        
        const socket = new MockSocket();
        socket.putdownResult = true;

        const engineState = {
            mustDeliver: true,
            actionStats: { putdown: { count: 0, totalTime: 0, avgTime: 0 } }
        };

        const success = await dispatchAction({ action: 'putdown', target: 'p1' }, beliefs, socket, engineState, null, null);
        assert.strictEqual(success, true);
        assert.deepStrictEqual(beliefs.carried, ['p2']); // p1 dropped
        assert.strictEqual(engineState.mustDeliver, false); // cleared
    });

    test('dispatchAction: say and fallback shout', async () => {
        const beliefs = new BeliefBase();
        const socket = new MockSocket();
        
        const engineState = { actionStats: { say: { count: 0, totalTime: 0, avgTime: 0 } } };

        // Test direct say success
        const successDirect = await dispatchAction(
            { action: 'say', payload: { type: 'PING' } },
            beliefs, socket, engineState,
            () => 'peer_agent_1',
            null
        );
        assert.strictEqual(successDirect, true);
        assert.strictEqual(socket.emitted[0].type, 'say');
        assert.strictEqual(socket.emitted[0].recipient, 'peer_agent_1');

        // Test direct say throw -> fallbacks to shout
        socket.sayResult = 'throw';
        const successShout = await dispatchAction(
            { action: 'say', payload: { type: 'PING' } },
            beliefs, socket, engineState,
            () => 'peer_agent_1',
            null
        );
        assert.strictEqual(successShout, true);
        assert.strictEqual(socket.emitted[socket.emitted.length - 1].type, 'shout');
    });

    test('dispatchAction: efficiency and dynamic capacity limits', async () => {
        const beliefs = new BeliefBase();
        beliefs.config = { GAME: { player: { capacity: 10 } } };
        beliefs.carried = [];

        const socket = new MockSocket();
        socket.putdownResult = true;

        const engineState = {
            sequenceStartTime: Date.now() - 5000, // finished sequence in 5 seconds
            sequenceCarriedCount: 2,
            dynamicCapacityLimit: 4,
            actionStats: { putdown: { count: 0, totalTime: 0, avgTime: 0 } }
        };

        // 5s for 2 parcels = 2.5s per parcel < 10s target -> efficiency good, increments capacity limit!
        await dispatchAction({ action: 'putdown' }, beliefs, socket, engineState, null, null);
        assert.strictEqual(engineState.dynamicCapacityLimit, 5);
        assert.strictEqual(engineState.sequenceStartTime, null);

        // Slow delivery sequence
        engineState.sequenceStartTime = Date.now() - 30000; // 30s
        engineState.sequenceCarriedCount = 2; // 15s per parcel > 10s target -> efficiency poor, decrements capacity!
        await dispatchAction({ action: 'putdown' }, beliefs, socket, engineState, null, null);
        assert.strictEqual(engineState.dynamicCapacityLimit, 4);
    });
});
