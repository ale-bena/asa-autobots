import { test, describe } from 'node:test';
import assert from 'node:assert';
import { BeliefBase } from '../src/agent/BeliefBase.js';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';

describe('BeliefBase tests', () => {
    test('initial state constructor', () => {
        const bb = new BeliefBase();
        assert.ok(bb.me);
        assert.strictEqual(bb.carried.length, 0);
        assert.ok(bb.parcels instanceof Map);
        assert.ok(bb.peers instanceof Map);
        assert.ok(bb.crates instanceof Map);
        assert.ok(bb.activeContracts instanceof Map);
        assert.ok(bb.lockedTargets instanceof Set);
        assert.ok(bb.policyRules);
        assert.strictEqual(bb.map, null);
    });

    test('revise self info', () => {
        const bb = new BeliefBase();
        bb.revise({
            me: { id: 'agent_1', name: 'Agent1', x: 2.3, y: 4.8, score: 50 }
        });
        assert.strictEqual(bb.me.id, 'agent_1');
        assert.strictEqual(bb.me.name, 'Agent1');
        assert.strictEqual(bb.me.x, 2); // rounded
        assert.strictEqual(bb.me.y, 5); // rounded
        assert.strictEqual(bb.me.score, 50);
    });

    test('revise config with different decay formats', () => {
        const bb = new BeliefBase();
        
        // case A: infinite decaying event
        bb.revise({
            config: {
                GAME: {
                    player: { capacity: 5, observation_distance: 7, movement_duration: 350 },
                    parcels: { decaying_event: 'infinite' }
                }
            }
        });
        assert.strictEqual(bb.parcelDecayIntervalMs, Infinity);
        assert.strictEqual(bb.movementDurationMs, 350);
        assert.strictEqual(bb.observationDistance, 7);

        // case B: string format ending with 's' or number
        bb.revise({
            config: {
                GAME: {
                    parcels: { decaying_event: '5s' },
                    player: { movement_duration: '400ms' }
                }
            }
        });
        assert.strictEqual(bb.parcelDecayIntervalMs, 5000);
        assert.strictEqual(bb.movementDurationMs, 400);

        // case C: numeric format
        bb.revise({
            config: {
                GAME: {
                    parcels: { decaying_event: 3000 }
                }
            }
        });
        assert.strictEqual(bb.parcelDecayIntervalMs, 3000);
    });

    test('revise peers (visible vs sensor vs p2p)', () => {
        const bb = new BeliefBase();
        bb.me = { id: 'agent_me', x: 0, y: 0 };
        bb.observationDistance = 5;

        // Peer 1 is visible via sensor
        // Peer 2 was recorded via p2p communication
        bb.peers.set('peer_p2p', { id: 'peer_p2p', source: 'p2p', x: 1, y: 1 });
        bb.peers.set('peer_sensor_stale', { id: 'peer_sensor_stale', source: 'sensor', x: 2, y: 2 });

        bb.revise({
            agents: [
                { id: 'peer_sensor_active', name: 'ActiveSensor', x: 3, y: 3, score: 10 }
            ]
        });

        // 'peer_sensor_active' must be registered
        assert.ok(bb.peers.has('peer_sensor_active'));
        
        // 'peer_p2p' must NOT be cleared even if not in sensor list (it came from p2p)
        assert.ok(bb.peers.has('peer_p2p'));

        // 'peer_sensor_stale' is within observation distance (2,2 relative to me 0,0 is distance 4 < 5)
        // and was NOT in the sensor payload agents list, so it must be cleaned up!
        assert.ok(!bb.peers.has('peer_sensor_stale'));
    });

    test('revise crates spatial memory', () => {
        const bb = new BeliefBase();
        bb.me = { id: 'agent_me', x: 0, y: 0 };
        bb.observationDistance = 5;
        bb.map = new MapRepresentation(10, 10, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 1, type: '5' }, // CRATE
            { x: 2, y: 2, type: '5' }, // CRATE
            { x: 8, y: 8, type: '5' }  // CRATE
        ]);

        // Crate 1 is inside observation range
        // Crate 2 is outside observation range
        bb.crates.set('crate_new', { id: 'crate_new', x: 1, y: 1 });
        bb.crates.set('crate_visible_stale', { id: 'crate_visible_stale', x: 2, y: 2 });
        bb.crates.set('crate_far', { id: 'crate_far', x: 8, y: 8 });

        bb.revise({
            crates: [
                { id: 'crate_new', x: 1, y: 1 }
            ]
        });

        // 'crate_new' is added
        assert.ok(bb.crates.has('crate_new'));
        
        // 'crate_far' is outside range (dist 16 > 5), so it should persist in memory
        assert.ok(bb.crates.has('crate_far'));

        // 'crate_visible_stale' is inside range (dist 4 < 5) but wasn't in sensed list, so it must be cleared
        assert.ok(!bb.crates.has('crate_visible_stale'));
    });

    test('revise parcels spatial memory and decay', () => {
        const bb = new BeliefBase();
        bb.me = { id: 'agent_me', x: 0, y: 0 };
        bb.observationDistance = 5;
        bb.parcelDecayIntervalMs = 1000;
        bb.map = new MapRepresentation(10, 10, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 1, type: '3' },
            { x: 8, y: 8, type: '3' }
        ]);

        // Parcel 1 inside observation range
        // Parcel 2 outside observation range
        bb.parcels.set('p_visible_stale', { id: 'p_visible_stale', x: 1, y: 1, reward: 10, decay: 0 });
        bb.parcels.set('p_far', { id: 'p_far', x: 8, y: 8, reward: 20, decay: 0, lastSeen: Date.now() });

        bb.revise({
            parcels: [
                { id: 'p_new', x: 0, y: 1, reward: 15, decay: 1 }
            ]
        });

        assert.ok(bb.parcels.has('p_new'));
        assert.ok(bb.parcels.has('p_far'));
        assert.ok(!bb.parcels.has('p_visible_stale')); // cleared as it is within range

        // Test decay updates: p_far has decay rate 0. After revise with empty parcels it should be simulated
        bb.revise({ parcels: [] });
        assert.ok(bb.parcels.has('p_far'));
    });

    test('clean stale blocked targets and decayed parcels', () => {
        const bb = new BeliefBase();
        bb.me = { id: 'agent_me', x: 0, y: 0 };
        bb.observationDistance = 5;
        
        // Stale blocked target (older than 3s cooldown in _cleanStaleBeliefs)
        bb.blockedTargets.set('stale_target', Date.now() - 5000);
        bb.blockedTargets.set('fresh_target', Date.now() - 500);

        bb._cleanStaleBeliefs();
        assert.ok(!bb.blockedTargets.has('stale_target'));
        assert.ok(bb.blockedTargets.has('fresh_target'));

        // Decayed parcel inside observation range should be removed when empty sensor update is received
        bb.parcels.set('p_dead', { id: 'p_dead', x: 1, y: 1, reward: 10 });
        bb.revise({ parcels: [] });
        assert.ok(!bb.parcels.has('p_dead'));
    });

    test('apply policy rules parsing', () => {
        const bb = new BeliefBase();
        const rules = [
            {
                all_tiles: true,
                avoidTiles: ['1,1', '2,2'],
                minReward: 10,
                maxReward: 100,
                stackSizeBounds: [{ min: 3, max: 6 }]
            }
        ];
        bb.applyPolicyRules(rules);
        assert.deepStrictEqual(bb.policyRules.avoidTiles, ['1,1', '2,2']);
        assert.strictEqual(bb.policyRules.minRewardThreshold, 10);
        assert.strictEqual(bb.policyRules.maxRewardLimit, 100);
        assert.strictEqual(bb.policyRules.requiredStackSize, 3);
        assert.strictEqual(bb.policyRules.maxStackSize, 5);
        assert.deepStrictEqual(bb.policyRules.rules, rules);
    });
});
