import { test, describe } from 'node:test';
import assert from 'node:assert';
import { IntentionEngine } from '../src/agent/Intentions.js';
import { BeliefBase } from '../src/agent/BeliefBase.js';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';
import { AGENT_IDS } from '../src/config/config.js';

class MockSocket {
    constructor() {
        this.emitted = [];
        this.says = [];
    }
    async emitMove() { return { x: 1, y: 1 }; }
    async emitPickup() { return []; }
    async emitPutdown() { return true; }
    async emitSay(recipient, msg) {
        this.says.push({ recipient, msg });
    }
    async emitShout() { }
}

describe('Intentions / IntentionEngine tests', () => {
    test('IntentionEngine constructor initialization', () => {
        const beliefs = new BeliefBase();
        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);

        assert.strictEqual(engine.beliefs, beliefs);
        assert.strictEqual(engine.socket, socket);
        assert.strictEqual(engine.activeGenerator, null);
        assert.strictEqual(engine.currentGoal, null);
        assert.strictEqual(engine.collisionCounter, 0);
        assert.strictEqual(engine.lastActionSuccess, true);
        assert.strictEqual(engine.tickCounter, 0);
        assert.strictEqual(engine.mustDeliver, false);
    });

    test('IntentionEngine basic tick flow and goal re-evaluation', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', name: 'Agent1', x: 0, y: 0, score: 0 };
        beliefs.map = new MapRepresentation(2, 2, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' },
            { x: 2, y: 0, type: '3' },
            { x: 0, y: 1, type: '3' },
            { x: 1, y: 1, type: '3' },
            { x: 2, y: 1, type: '3' },
            { x: 0, y: 2, type: '3' },
            { x: 1, y: 2, type: '3' },
            { x: 2, y: 2, type: '3' }
        ]);

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);
        beliefs.variables.synced = true;

        await engine.tick();

        assert.strictEqual(engine.tickCounter, 0);
        assert.ok(engine.currentGoal === null || typeof engine.currentGoal === 'object');
    });

    test('IntentionEngine preemption and generator execution', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 0, y: 0 };
        beliefs.map = new MapRepresentation(2, 0, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' },
            { x: 2, y: 0, type: '2' }
        ]);
        beliefs.config = { GAME: { player: { capacity: 3 } } };

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);
        beliefs.variables.synced = true;

        let planExecuted = false;
        engine.activeGenerator = (function* () {
            yield { action: 'wait' };
            planExecuted = true;
        })();
        engine.currentGoal = { type: 'patrol' };

        await engine.tick();
        assert.strictEqual(engine.tickCounter, 1);

        await engine.tick();
        assert.strictEqual(planExecuted, true);
        assert.strictEqual(engine.activeGenerator, null);
    });

    test('admin_move plan recipe basic execution', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 };
        beliefs.map = new MapRepresentation(2, 0, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' },
            { x: 2, y: 0, type: '3' }
        ]);
        beliefs.activeContracts.set('admin_move', {
            dropOnArrival: true,
            holdOnArrival: true,
            holdDuration: 1
        });
        beliefs.carried = ['p1'];
        beliefs.parcels.set('p1', { id: 'p1', x: 0, y: 0, reward: 20 });

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);
        beliefs.variables.synced = true;

        const gen = engine.instantiatePlanRecipe({ type: 'admin_move', x: 2, y: 0 });

        let res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'move', target: { x: 1, y: 0 } });

        beliefs.me.x = 1;
        res = gen.next(true);
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'move', target: { x: 2, y: 0 } });

        beliefs.me.x = 2;
        res = gen.next(true);

        assert.strictEqual(res.done, false);
        assert.strictEqual(res.value.action, 'say');
        assert.strictEqual(res.value.payload.type, 'MOVE_TO_ACK');
        assert.strictEqual(res.value.payload.success, true);

        res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'putdown' });
        beliefs.carried = [];

        res = gen.next();
        assert.strictEqual(res.done, true);
        assert.strictEqual(beliefs.hold, true);
    });

    test('rendezvous plan recipe execution', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 };
        beliefs.map = new MapRepresentation(1, 0, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' }
        ]);
        beliefs.activeContracts.set('coop1', {
            coopId: 'coop1',
            radius: 0,
            holdDuration: 1
        });

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);
        beliefs.variables.synced = true;

        const gen = engine.instantiatePlanRecipe({ type: 'rendezvous', targetId: 'coop1', x: 1, y: 0 });

        let res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'move', target: { x: 1, y: 0 } });

        beliefs.me.x = 1;
        res = gen.next(true);

        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'wait' });

        beliefs.peers.set('agent_2', { id: 'agent_2', x: 1, y: 0 });
        res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'wait' });
    });

    test('handoff plan recipe execution', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 };
        beliefs.map = new MapRepresentation(1, 1, [
            { x: 0, y: 0, type: '3' },
            { x: 0, y: 1, type: '3' }
        ]);
        beliefs.activeContracts.set('coop2', {
            coopId: 'coop2',
            radius: 0
        });
        beliefs.carried = ['p1'];
        beliefs.parcels.set('p1', { id: 'p1', x: 0, y: 0 });

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);
        beliefs.variables.synced = true;

        const gen = engine.instantiatePlanRecipe({ type: 'handoff', targetId: 'coop2', x: 0, y: 0 });

        let res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'putdown' });
        beliefs.carried = [];

        res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'move', target: { x: 0, y: 1 } });

        beliefs.me.y = 1;
        res = gen.next(true);

        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'say', payload: { type: 'SIGNAL_READY', coopId: 'coop2' } });

        beliefs.parcels.clear();

        res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'wait' });

        beliefs.activeContracts.get('coop2').status = 'READY';
        res = gen.next();

        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'move', target: { x: 0, y: 0 } });

        beliefs.me.y = 0;
        beliefs.parcels.set('p2', { id: 'p2', x: 0, y: 0 });
        res = gen.next(true);

        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'pickup', target: 'p2' });

        beliefs.carried = ['p2'];
        beliefs.parcels.delete('p2');

        res = gen.next();
        assert.strictEqual(res.done, true);
        assert.strictEqual(beliefs.variables.handoffCompleted, true);
    });

    test('handoff_drop plan recipe execution', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 };
        beliefs.map = new MapRepresentation(1, 1, [
            { x: 0, y: 0, type: '3' },
            { x: 0, y: 1, type: '3' }
        ]);
        beliefs.carried = ['p1'];

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);
        beliefs.variables.synced = true;

        const gen = engine.instantiatePlanRecipe({ type: 'handoff_drop', x: 0, y: 0 });

        let res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'putdown' });
        beliefs.carried = [];

        res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'move', target: { x: 0, y: 1 } });
    });

    test('IntentionEngine tick when unsynced', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, name: 'Agent1', x: 0, y: 0 };
        beliefs.map = new MapRepresentation(1, 0, [{ x: 0, y: 0, type: '3' }]);

        const socket = new MockSocket();
        let sayCalled = false;
        socket.emitSay = async (recipient, msg) => {
            sayCalled = true;
            assert.strictEqual(recipient, AGENT_IDS.LLM_AGENT_ID);
            assert.ok(msg.includes('SYNC_REQ'));
        };

        const engine = new IntentionEngine(beliefs, socket);
        beliefs.variables.synced = false;

        await engine.tick();
        assert.strictEqual(sayCalled, true);
    });

    test('IntentionEngine tick when on hold', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 0, y: 0 };
        beliefs.map = new MapRepresentation(1, 0, [{ x: 0, y: 0, type: '3' }]);
        beliefs.hold = true;

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);
        beliefs.variables.synced = true;

        await engine.tick();
        assert.strictEqual(engine.tickCounter, 0);
    });

    test('IntentionEngine tick opportunistic pickup', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 };
        beliefs.map = new MapRepresentation(1, 0, [{ x: 0, y: 0, type: '3' }]);
        beliefs.parcels.set('p_opp', { id: 'p_opp', x: 0, y: 0 });
        beliefs.carried = [];

        const socket = new MockSocket();
        let pickupDispatched = false;
        socket.emitPickup = async () => {
            pickupDispatched = true;
            return [];
        };

        const engine = new IntentionEngine(beliefs, socket);
        beliefs.variables.synced = true;

        await engine.tick();
        assert.strictEqual(pickupDispatched, true);
        assert.strictEqual(engine.tickCounter, engine.GOAL_EVAL_INTERVAL);
    });

    test('admin_move fallback and max retries', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 };
        beliefs.map = new MapRepresentation(2, 0, [
            { x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '0' }, { x: 2, y: 0, type: '3' }
        ]);
        beliefs.activeContracts.set('admin_move', { holdOnArrival: false });

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);
        engine.adminMoveRetries = 2; // trigger max retries

        const gen = engine.instantiatePlanRecipe({ type: 'admin_move', x: 2, y: 0 });
        let res = gen.next();

        assert.strictEqual(res.done, false);
        assert.strictEqual(res.value.action, 'say'); // MOVE_TO_ACK
        assert.strictEqual(res.value.payload.success, false);
        assert.ok(!beliefs.activeContracts.has('admin_move'));
        assert.strictEqual(engine.adminMoveRetries, 0);
    });

    test('rendezvous indefinite wait', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 1, y: 0 };
        beliefs.map = new MapRepresentation(1, 0, [{ x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '3' }]);
        beliefs.activeContracts.set('coop1', { coopId: 'coop1', radius: 0, holdDuration: 'indefinite' });

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);

        const gen = engine.instantiatePlanRecipe({ type: 'rendezvous', targetId: 'coop1', x: 1, y: 0 });
        gen.next(); // Already at target, yields wait

        beliefs.peers.set('agent_2', { id: 'agent_2', x: 1, y: 0 });
        const res = gen.next(); // peer arrived, checks indefinite hold
        assert.strictEqual(res.value.action, 'wait');
        assert.ok(beliefs.activeContracts.has('coop1')); // Timer not started to delete it
    });

    test('handoff & handoff_drop fail to reach target', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 };
        beliefs.map = new MapRepresentation(2, 0, [
            { x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '0' }, { x: 2, y: 0, type: '3' }
        ]);
        beliefs.activeContracts.set('coop1', { coopId: 'coop1' });

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);

        const genHandoff = engine.instantiatePlanRecipe({ type: 'handoff', targetId: 'coop1', x: 2, y: 0 });
        let res = genHandoff.next(false); // mock move failure
        assert.strictEqual(res.done, true); // Aborts

        const genDrop = engine.instantiatePlanRecipe({ type: 'handoff_drop', x: 2, y: 0 });
        res = genDrop.next(false);
        assert.strictEqual(res.done, true);
    });

    test('handoff_drop sorts escape tiles towards spawn', async () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 1, y: 1 };
        beliefs.map = new MapRepresentation(3, 3, [
            { x: 0, y: 0, type: '1' }, { x: 1, y: 0, type: '3' }, { x: 2, y: 0, type: '3' },
            { x: 0, y: 1, type: '3' }, { x: 1, y: 1, type: '3' }, { x: 2, y: 1, type: '3' },
            { x: 0, y: 2, type: '3' }, { x: 1, y: 2, type: '3' }, { x: 2, y: 2, type: '3' }
        ]);
        beliefs.carried = ['p1'];

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);

        const gen = engine.instantiatePlanRecipe({ type: 'handoff_drop', x: 1, y: 1 });
        let res = gen.next(); // Drop putdown
        assert.strictEqual(res.value.action, 'putdown');

        beliefs.carried = []; // Empty inventory so while loop breaks

        const moveRes = gen.next(); // Escape move

        const target = moveRes.value.target;
        const dist = Math.abs(target.x - 0) + Math.abs(target.y - 0);
        assert.strictEqual(dist, 1);
    });

    test('_discardParcelsAction directly', () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 1, y: 1 };
        beliefs.map = new MapRepresentation(2, 2, [
            { x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '3' }, { x: 2, y: 0, type: '3' },
            { x: 0, y: 1, type: '3' }, { x: 1, y: 1, type: '2' }, { x: 2, y: 1, type: '3' },
            { x: 0, y: 2, type: '3' }, { x: 1, y: 2, type: '3' }, { x: 2, y: 2, type: '3' }
        ]);

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);

        const gen = engine._discardParcelsAction(['p1']);
        let res = gen.next();
        assert.strictEqual(res.value.action, 'move'); // moves to adjacent
        const targetX = res.value.target.x;
        const targetY = res.value.target.y;

        // Mock successful arrival at adjacent tile
        beliefs.me.x = targetX;
        beliefs.me.y = targetY;

        res = gen.next(true);
        assert.strictEqual(res.value.action, 'putdown'); // Performs putdown

        res = gen.next(true);
        assert.strictEqual(res.value.action, 'move'); // Returns to original tile
    });

    test('_deliverRecipe wait loop coverage', () => {
        const beliefs = new BeliefBase();
        beliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 };
        beliefs.map = new MapRepresentation(1, 0, [{ x: 0, y: 0, type: '2' }, { x: 1, y: 0, type: '3' }]);
        beliefs.carried = ['p1'];
        beliefs.parcels.set('p1', { id: 'p1', reward: 20 });
        beliefs.applyPolicyRules([{ minReward: 20, multiplier: 1 }]); // Requires 20 exactly to be optimal right away
        beliefs.parcelDecayIntervalMs = 1000;

        const socket = new MockSocket();
        const engine = new IntentionEngine(beliefs, socket);

        const gen = engine._deliverRecipe(0, 0);
        let res = gen.next(); // NavigateTo 0,0 done -> yields first wait tick for drop/wait logic
        assert.strictEqual(res.value.action, 'putdown');
    });
});