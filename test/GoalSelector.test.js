import { test, describe } from 'node:test';
import assert from 'node:assert';
import { selectBestGoal, evaluatePolicyReward } from '../src/agent/GoalSelector.js';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';
import { AGENT_IDS } from '../src/config/config.js';

describe('GoalSelector tests', () => {
    test('selectBestGoal returns default patrol when beliefs or me is null', () => {
        const res1 = selectBestGoal(null, {});
        assert.strictEqual(res1.type, 'patrol');

        const res2 = selectBestGoal({ me: null }, {});
        assert.strictEqual(res2.type, 'patrol');
    });

    test('selectBestGoal prioritizes admin contracts (move, pickup, deliver)', () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, name: 'Agent1', x: 0, y: 0 },
            carried: [],
            variables: {},
            activeContracts: new Map(),
            parcels: new Map(),
            peers: new Map(),
            policyRules: {},
            map: new MapRepresentation(2, 0, [
                { x: 0, y: 0, type: '3' },
                { x: 1, y: 0, type: '3' },
                { x: 2, y: 0, type: '2' } // Delivery
            ])
        };

        const engineState = {
            blockedDeliveryZones: new Map(),
            lastRequiredStackSize: null,
            lastMaxStackSize: null,
            dynamicCapacityLimit: 3
        };

        // 1. admin_move
        beliefs.activeContracts.set('admin_move', { status: 'ACTIVE', x: 1, y: 0 });
        let goal = selectBestGoal(beliefs, engineState);
        assert.strictEqual(goal.type, 'admin_move');
        assert.strictEqual(goal.x, 1);
        assert.strictEqual(goal.y, 0);

        beliefs.activeContracts.delete('admin_move');

        // 2. admin_pickup (parcel exists)
        beliefs.activeContracts.set('admin_pickup', { status: 'ACTIVE', parcelId: 'p1' });
        beliefs.parcels.set('p1', { id: 'p1', x: 1, y: 0 });
        goal = selectBestGoal(beliefs, engineState);
        assert.strictEqual(goal.type, 'admin_pickup');
        assert.strictEqual(goal.targetId, 'p1');

        // admin_pickup (parcel does not exist -> deletes contract)
        beliefs.parcels.clear();
        goal = selectBestGoal(beliefs, engineState);
        assert.ok(!beliefs.activeContracts.has('admin_pickup'));

        // 3. admin_deliver (with fallback nearest delivery zone)
        beliefs.activeContracts.set('admin_deliver', { status: 'ACTIVE', parcelId: 'p1', x: null, y: null });
        goal = selectBestGoal(beliefs, engineState);
        assert.strictEqual(goal.type, 'admin_deliver');
        // nearest delivery zone is at (2,0)
        assert.strictEqual(goal.x, 2);
        assert.strictEqual(goal.y, 0);
    });

    test('selectBestGoal handles rendezvous and handoff active contracts', () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, name: 'Agent1', x: 0, y: 0 },
            carried: [],
            variables: {},
            activeContracts: new Map(),
            parcels: new Map(),
            peers: new Map(),
            policyRules: {},
            map: new MapRepresentation(1, 0, [
                { x: 0, y: 0, type: '3' },
                { x: 1, y: 0, type: '3' }
            ])
        };

        const engineState = {
            blockedDeliveryZones: new Map()
        };

        // Rendezvous contract
        beliefs.activeContracts.set('coop1', {
            type: 'RENDEZVOUS',
            status: 'ACTIVE',
            x: 1,
            y: 0
        });
        let goal = selectBestGoal(beliefs, engineState);
        assert.strictEqual(goal.type, 'rendezvous');
        assert.strictEqual(goal.targetId, 'coop1');
        assert.strictEqual(goal.x, 1);

        // Handoff contract (carrying cargo)
        beliefs.activeContracts.delete('coop1');
        beliefs.activeContracts.set('coop2', {
            type: 'HANDOFF',
            status: 'ACTIVE',
            x: 1,
            y: 0
        });
        beliefs.carried = ['p_cargo'];
        goal = selectBestGoal(beliefs, engineState);
        assert.strictEqual(goal.type, 'handoff');
        assert.strictEqual(goal.targetId, 'coop2');
    });

    test('selectBestGoal dodge tile detection', () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 },
            carried: [],
            variables: { currentGoalType: 'patrol' },
            activeContracts: new Map(),
            parcels: new Map(),
            peers: new Map(),
            policyRules: {},
            crates: new Map(),
            lockedTargets: new Set(),
            map: new MapRepresentation(2, 2, [
                { x: 0, y: 0, type: '3' },
                { x: 1, y: 0, type: '3' },
                { x: 2, y: 0, type: '3' },
                { x: 0, y: 1, type: '3' }, // clear neighbor to step onto
                { x: 1, y: 1, type: '3' },
                { x: 2, y: 1, type: '3' },
                { x: 0, y: 2, type: '3' },
                { x: 1, y: 2, type: '3' },
                { x: 2, y: 2, type: '3' }
            ])
        };

        // Peer is active and has a path going through our cell (0,0)
        beliefs.peers.set(AGENT_IDS.LLM_AGENT_ID, {
            id: AGENT_IDS.LLM_AGENT_ID,
            x: 1,
            y: 0,
            currentGoal: { type: 'patrol', x: 0, y: 0 },
            path: [{ x: 0, y: 0 }]
        });

        // We are on (0,0) and have lower priority (e.g. peer has more carried or alphabetically peer BDI < LLM, wait, BDI_AGENT_ID is lower than LLM_AGENT_ID, so hasHigherPriority returns true)
        // Wait, let's make peer have higher priority by carrying more parcels!
        beliefs.peers.get(AGENT_IDS.LLM_AGENT_ID).carried = ['p1', 'p2'];
        beliefs.carried = [];

        const engineState = {
            blockedDeliveryZones: new Map()
        };

        const goal = selectBestGoal(beliefs, engineState);
        // We should select dodge goal step aside to (0,1)
        assert.strictEqual(goal.type, 'dodge');
        assert.strictEqual(goal.x, 0);
        assert.strictEqual(goal.y, 1);
    });

    test('selectBestGoal adjusts dynamicCapacityLimit on policy change', () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, name: 'Agent1', x: 0, y: 0 },
            carried: [],
            variables: {},
            activeContracts: new Map(),
            parcels: new Map(),
            peers: new Map(),
            policyRules: {
                requiredStackSize: 4,
                maxStackSize: 6
            },
            map: new MapRepresentation(1, 0, [
                { x: 0, y: 0, type: '3' }
            ])
        };

        const engineState = {
            blockedDeliveryZones: new Map(),
            lastRequiredStackSize: null,
            lastMaxStackSize: null,
            dynamicCapacityLimit: 3
        };

        const goal = selectBestGoal(beliefs, engineState);
        assert.ok(goal.engineUpdates);
        assert.strictEqual(goal.engineUpdates.lastRequiredStackSize, 4);
        assert.strictEqual(goal.engineUpdates.lastMaxStackSize, 6);
        assert.strictEqual(goal.engineUpdates.dynamicCapacityLimit, 6); // sets to maxStackSize if available
    });
});
