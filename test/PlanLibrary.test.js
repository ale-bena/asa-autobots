import { test, describe } from 'node:test';
import assert from 'node:assert';
import { 
    pathDistance, 
    findNearestDeliveryZone, 
    findNearestSpawnZone, 
    findPatrolSpawnZone, 
    findAdjacentClearTile, 
    findAdjacentClearNonSpawnTile,
    NavigateTo,
    CollectAndDeliver,
    RendezvousDrop
} from '../src/agent/PlanLibrary.js';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';
import { AGENT_IDS } from '../src/config/config.js';

describe('PlanLibrary tests', () => {
    test('pathDistance function', () => {
        const beliefs = {
            map: null,
            policyRules: {}
        };
        // Null map should return Infinity
        assert.strictEqual(pathDistance(beliefs, 0, 0, 1, 1), Infinity);

        // Valid map setup
        const tiles = [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' },
            { x: 2, y: 0, type: '0' } // Wall
        ];
        beliefs.map = new MapRepresentation(2, 0, tiles);

        // Path between adjacent walkable tiles should be 1
        assert.strictEqual(pathDistance(beliefs, 0, 0, 1, 0), 1);
        // Path to unreachable Wall or block should be Infinity
        assert.strictEqual(pathDistance(beliefs, 0, 0, 2, 0), Infinity);
    });

    test('findNearestDeliveryZone function', () => {
        const beliefs = {
            map: null,
            carried: [],
            parcels: new Map(),
            peers: new Map()
        };
        // Null map should return null
        assert.strictEqual(findNearestDeliveryZone(beliefs, 0, 0), null);

        const tiles = [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '2' }, // Delivery
            { x: 2, y: 0, type: '2' }  // Delivery
        ];
        beliefs.map = new MapRepresentation(2, 0, tiles);

        // Case: normal, nearest is (1,0)
        let best = findNearestDeliveryZone(beliefs, 0, 0);
        assert.deepStrictEqual(best, { x: 1, y: 0 });

        // Case: (1,0) occupied by a peer
        beliefs.peers.set('peer1', { x: 1, y: 0 });
        best = findNearestDeliveryZone(beliefs, 0, 0);
        assert.deepStrictEqual(best, { x: 2, y: 0 });

        // Case: blocked zones
        const blockedZones = new Map();
        blockedZones.set('2,0', Date.now()); // Blocked (2,0)
        best = findNearestDeliveryZone(beliefs, 0, 0, blockedZones);
        // (1,0) is occupied by peer, (2,0) is blocked -> falls back to closest occupied (1,0)
        assert.deepStrictEqual(best, { x: 1, y: 0 });
    });

    test('findNearestSpawnZone function', () => {
        const beliefs = {
            map: null,
            blockedTargets: new Map()
        };
        assert.strictEqual(findNearestSpawnZone(beliefs, 0, 0), null);

        const tiles = [
            { x: 0, y: 0, type: '1' }, // Spawn
            { x: 1, y: 0, type: '1' }  // Spawn
        ];
        beliefs.map = new MapRepresentation(1, 0, tiles);

        // Nearest is (0,0)
        assert.deepStrictEqual(findNearestSpawnZone(beliefs, 0.4, 0), { x: 0, y: 0 });

        // Block (0,0)
        beliefs.blockedTargets.set('0,0', Date.now());
        assert.deepStrictEqual(findNearestSpawnZone(beliefs, 0.4, 0), { x: 1, y: 0 });
    });

    test('findPatrolSpawnZone branches and blocked targets', () => {
        const beliefs = {
            map: null,
            blockedTargets: new Map()
        };
        assert.strictEqual(findPatrolSpawnZone(beliefs, 0, 0), null);

        // 1. We are not on a spawn tile, so it goes to nearest spawn zone
        const tiles1 = [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '1' }
        ];
        beliefs.map = new MapRepresentation(1, 0, tiles1);
        assert.deepStrictEqual(findPatrolSpawnZone(beliefs, 0, 0), { x: 1, y: 0 });

        // 2. We are on a spawn tile. Test blocked target filtering.
        const tiles2 = [
            { x: 0, y: 0, type: '1' }, // Spawn (current)
            { x: 2, y: 0, type: '1' }, // Spawn (blocked)
            { x: 3, y: 0, type: '1' }  // Spawn (available)
        ];
        beliefs.map = new MapRepresentation(3, 0, tiles2);
        beliefs.blockedTargets.set('2,0', Date.now());
        
        // Mid zone path (distance >= 2 but no far zones since max x is 3)
        // Mid zones: (3,0) which is distance 3 away.
        const midZoneResult = findPatrolSpawnZone(beliefs, 0, 0);
        assert.deepStrictEqual(midZoneResult, { x: 3, y: 0 });

        // 3. Fallback when there are no mid or far zones (only spawn is current)
        const tiles3 = [
            { x: 0, y: 0, type: '1' }
        ];
        beliefs.map = new MapRepresentation(0, 0, tiles3);
        beliefs.blockedTargets.clear();
        assert.deepStrictEqual(findPatrolSpawnZone(beliefs, 0, 0), { x: 0, y: 0 });
    });

    test('findAdjacentClearTile function', () => {
        const beliefs = {
            map: null,
            crates: new Map(),
            peers: new Map()
        };
        assert.deepStrictEqual(findAdjacentClearTile(beliefs, 1, 1), { x: 1, y: 1 });

        const tiles = [
            { x: 1, y: 1, type: '3' },
            { x: 1, y: 2, type: '3' }, // Neighbor 1
            { x: 2, y: 1, type: '3' }, // Neighbor 2
            { x: 1, y: 0, type: '3' }, // Neighbor 3
            { x: 0, y: 1, type: '3' }  // Neighbor 4
        ];
        beliefs.map = new MapRepresentation(3, 3, tiles);

        // Fill neighbor 1 with crate
        beliefs.crates.set('c1', { x: 1, y: 2 });
        // Fill neighbor 2 with peer
        beliefs.peers.set('p1', { x: 2, y: 1 });

        const clear = findAdjacentClearTile(beliefs, 1, 1);
        // Should return neighbor 3 or 4
        assert.ok(clear.x === 1 && clear.y === 0 || clear.x === 0 && clear.y === 1);
    });

    test('findAdjacentClearNonSpawnTile fallback when blocked', () => {
        const beliefs = {
            map: null,
            crates: new Map(),
            peers: new Map()
        };
        assert.deepStrictEqual(findAdjacentClearNonSpawnTile(beliefs, 1, 1), { x: 1, y: 1 });

        // Neighbors are: (1,2) and (2,1)
        const tiles = [
            { x: 1, y: 1, type: '3' },
            { x: 1, y: 2, type: '1' }, // Spawn tile neighbor
            { x: 2, y: 1, type: '1' }  // Spawn tile neighbor
        ];
        beliefs.map = new MapRepresentation(3, 3, tiles);

        // All neighbors are spawn tiles. It should fall back to findAdjacentClearTile which selects one of them
        const clear = findAdjacentClearNonSpawnTile(beliefs, 1, 1);
        assert.ok(clear.x === 1 && clear.y === 2 || clear.x === 2 && clear.y === 1);
    });

    test('NavigateTo generator already at target', () => {
        const beliefs = {
            map: new MapRepresentation(1, 1, [
                { x: 0, y: 0, type: '3' }
            ]),
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0, nextStep: null, path: [] },
            crates: new Map(),
            peers: new Map()
        };

        const gen = NavigateTo(beliefs, 0, 0);
        const res = gen.next();
        assert.strictEqual(res.done, true);
        assert.strictEqual(res.value, true);
    });

    test('NavigateTo generator displacement and move failures', () => {
        const beliefs = {
            map: new MapRepresentation(3, 0, [
                { x: 0, y: 0, type: '3' },
                { x: 1, y: 0, type: '3' },
                { x: 2, y: 0, type: '3' },
                { x: 3, y: 0, type: '3' }
            ]),
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0, nextStep: null, path: [] },
            crates: new Map(),
            peers: new Map(),
            policyRules: {},
            blockedTargets: new Map()
        };

        // Navigate from (0,0) to (3,0)
        const gen = NavigateTo(beliefs, 3, 0);
        
        // Step 1: Yields move to (1,0)
        let res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'move', target: { x: 1, y: 0 } });

        // Case A: Displaced! Move beliefs.me to (0,0) instead of (1,0) and say it succeeded (or next step isn't adjacent)
        // Wait, beliefs.me is still at (0,0), next step in path is (2,0)
        beliefs.me.x = 0;
        res = gen.next(true); // pass success=true
        // Since we are at (0,0) and the next step is now (2,0) (which is NOT adjacent), displacement triggers.
        // It recalculates path from (0,0) to (3,0) and yields move to (1,0) again!
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'move', target: { x: 1, y: 0 } });

        // Case B: Move failed!
        // We pass success=false to next. It recalculates path and yields first step of recalculation.
        res = gen.next(false);
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'move', target: { x: 1, y: 0 } });

        // Case C: Move failed and path is blocked
        // Introduce a wall at (1,0) to make it unreachable
        beliefs.map.grid[beliefs.map.getFlatIndex(1,0)] = MapRepresentation.TILE_CODES.WALL;
        res = gen.next(false);
        // Path is blocked -> yields false
        assert.strictEqual(res.done, true);
        assert.strictEqual(res.value, false);
        assert.ok(beliefs.blockedTargets.has('3,0'));
    });

    test('CollectAndDeliver generator', () => {
        const beliefs = {
            map: new MapRepresentation(1, 0, [
                { x: 0, y: 0, type: '3' }
            ]),
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0, nextStep: null, path: [] },
            crates: new Map(),
            peers: new Map(),
            parcels: new Map([['p1', { id: 'p1', x: 0, y: 0 }]])
        };

        const gen = CollectAndDeliver(beliefs, 'p1');
        
        // NavigateTo is immediately done because we are at (0,0)
        // Next action should be the pickup action
        const res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'pickup', target: 'p1' });

        const end = gen.next();
        assert.strictEqual(end.done, true);
    });

    test('RendezvousDrop generator', () => {
        const beliefs = {
            map: new MapRepresentation(1, 1, [
                { x: 0, y: 0, type: '3' },
                { x: 0, y: 1, type: '3' }
            ]),
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0, nextStep: null, path: [] },
            crates: new Map(),
            peers: new Map(),
            parcels: new Map()
        };

        const gen = RendezvousDrop(beliefs, 'coop1', 0, 0);
        
        // Reached (0,0) immediately. First yielded action is putdown.
        let res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'putdown' });

        // Escape navigate to (0,1)
        res = gen.next();
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'move', target: { x: 0, y: 1 } });

        // Mock movement success
        beliefs.me.y = 1;
        res = gen.next(true);
        assert.strictEqual(res.done, false);
        assert.deepStrictEqual(res.value, { action: 'say', payload: { type: 'RELEASE_CARGO', coopId: 'coop1' } });

        res = gen.next();
        assert.strictEqual(res.done, true);
    });
});
