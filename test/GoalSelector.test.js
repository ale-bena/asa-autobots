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

    test('isTeammateTarget teammate target locked and peer path destination target', () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, name: 'Agent1', x: 0, y: 0 },
            carried: [],
            variables: {},
            activeContracts: new Map(),
            parcels: new Map(),
            peers: new Map(),
            crates: new Map(),
            lockedTargets: new Set(['locked_parcel']),
            policyRules: {},
            map: new MapRepresentation(3, 3, [
                { x: 0, y: 0, type: '3' },
                { x: 1, y: 0, type: '3' },
                { x: 2, y: 0, type: '1' } // Spawn
            ])
        };

        const engineState = { blockedDeliveryZones: new Map() };

        // Test 1: parcel locked in beliefs.lockedTargets
        beliefs.parcels.set('locked_parcel', { id: 'locked_parcel', x: 1, y: 0, reward: 20 });
        // It should be skipped for pickup, so no goal targets it
        let goal = selectBestGoal(beliefs, engineState);
        assert.notStrictEqual(goal.targetId, 'locked_parcel');

        // Test 2: parcel targeted by teammate path destination
        beliefs.lockedTargets.clear();
        beliefs.peers.set(AGENT_IDS.LLM_AGENT_ID, {
            id: AGENT_IDS.LLM_AGENT_ID,
            path: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
        });
        goal = selectBestGoal(beliefs, engineState);
        assert.notStrictEqual(goal.targetId, 'locked_parcel');
    });

    test('selectBestGoal hunts instead of delivers when target stack S has higher value', () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, name: 'Agent1', x: 0, y: 0 },
            carried: ['p1', 'p2'],
            variables: {},
            activeContracts: new Map(),
            parcels: new Map(),
            peers: new Map(),
            crates: new Map(),
            policyRules: {
                rules: [
                    {
                        all_tiles: true,
                        stackSizeBounds: [{ min: 0, max: 3 }],
                        multiplier: 0.5
                    },
                    {
                        all_tiles: true,
                        stackSizeBounds: [{ min: 3, max: 10 }],
                        multiplier: 2.0
                    }
                ]
            },
            map: new MapRepresentation(3, 3, [
                { x: 0, y: 0, type: '3' },
                { x: 1, y: 0, type: '2' }, // Delivery Zone
                { x: 2, y: 0, type: '1' }  // Spawn Zone
            ])
        };
        beliefs.parcels.set('p1', { id: 'p1', x: 0, y: 0, reward: 20 });
        beliefs.parcels.set('p2', { id: 'p2', x: 0, y: 0, reward: 20 });

        const engineState = {
            blockedDeliveryZones: new Map(),
            dynamicCapacityLimit: 5,
            actionStats: {
                move: { count: 1, avgTime: 100 },
                pickup: { count: 1, avgTime: 20 },
                putdown: { count: 1, avgTime: 20 }
            }
        };

        const goal = selectBestGoal(beliefs, engineState);
        // S_value at S=3 is (2.0 * 20 + 2.0 * 20) = 80, which is higher than deliveredValueAtDelivery (0.5 * 20 + 0.5 * 20 = 20).
        // Therefore, it should hunt near the spawn zone (patrol_spawn) instead of early delivery.
        assert.strictEqual(goal.type, 'patrol_spawn');
    });

    test('selectBestGoal absolute fallback to random patrol', () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, name: 'Agent1', x: 0, y: 0 },
            carried: [],
            variables: {},
            activeContracts: new Map(),
            parcels: new Map(),
            peers: new Map(),
            crates: new Map(),
            policyRules: {},
            map: new MapRepresentation(3, 3, [
                { x: 0, y: 0, type: '3' },
                { x: 1, y: 0, type: '3' }
            ])
        };

        const engineState = { blockedDeliveryZones: new Map() };
        const goal = selectBestGoal(beliefs, engineState);
        assert.strictEqual(goal.type, 'patrol');
    });

    test('selectBestGoal skips targeting parcels on delivery zone tiles', () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, name: 'Agent1', x: 0, y: 0 },
            carried: [],
            variables: {},
            activeContracts: new Map(),
            parcels: new Map(),
            peers: new Map(),
            crates: new Map(),
            lockedTargets: new Set(),
            blockedTargets: new Map(),
            policyRules: {},
            map: new MapRepresentation(3, 3, [
                { x: 0, y: 0, type: '3' },
                { x: 1, y: 0, type: '2' } // Delivery zone
            ])
        };
        // A parcel sits on the delivery zone tile (1,0)
        beliefs.parcels.set('p_del', { id: 'p_del', x: 1, y: 0, reward: 20 });

        const engineState = { blockedDeliveryZones: new Map() };
        const goal = selectBestGoal(beliefs, engineState);
        // It should NOT target 'p_del' for pickup
        assert.notStrictEqual(goal.targetId, 'p_del');
    });

    test('selectBestGoal fallback delivery when carrying but no other goals', () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, name: 'Agent1', x: 0, y: 0 },
            carried: ['p1'],
            variables: {},
            activeContracts: new Map(),
            parcels: new Map(),
            peers: new Map(),
            crates: new Map(),
            lockedTargets: new Set(),
            blockedTargets: new Map(),
            policyRules: {},
            map: new MapRepresentation(3, 3, [
                { x: 0, y: 0, type: '3' },
                { x: 1, y: 0, type: '3' },
                { x: 2, y: 0, type: '2' }  // Delivery Zone
            ])
        };
        const engineState = { blockedDeliveryZones: new Map() };
        const goal = selectBestGoal(beliefs, engineState);
        assert.strictEqual(goal.type, 'deliver');
        assert.strictEqual(goal.x, 2);
    });
});
