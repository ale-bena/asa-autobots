/**
 * @file PddlServiceBridge.test.js
 * @description Dedicated test suite for the PddlServiceBridge class in src/planning/PddlServiceBridge.js.
 * Tests the pure-logic methods (compileProblemPddl, parsePddlPlan) and validates
 * PDDL domain structure without calling the remote solver.
 *
 * Uses Node.js native test runner (node:test) — the industry-standard, zero-dependency
 * testing framework shipped with Node ≥ 18.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PddlServiceBridge } from '../src/planning/PddlServiceBridge.js';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';

/**
 * Helper: builds a small 3×3 map with all pavements and one delivery tile.
 */
function makeSmallMap() {
    return new MapRepresentation(3, 3, [
        { x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '3' }, { x: 2, y: 0, type: '3' },
        { x: 0, y: 1, type: '3' }, { x: 1, y: 1, type: '3' }, { x: 2, y: 1, type: '2' }, // (2,1) delivery
        { x: 0, y: 2, type: '3' }, { x: 1, y: 2, type: '3' }, { x: 2, y: 2, type: '3' },
    ]);
}

/**
 * Helper: creates minimal beliefs object.
 */
function makeBeliefs(overrides = {}) {
    return {
        me: { id: 'agent1', x: 0, y: 0 },
        crates: new Map(),
        peers: new Map(),
        ...overrides
    };
}

describe('PddlServiceBridge — constructor', () => {

    test('initializes with a valid PDDL domain string', () => {
        const bridge = new PddlServiceBridge();
        assert.ok(bridge.domainPddl);
        assert.ok(bridge.domainPddl.includes('deliveroo-crates'));
        assert.ok(bridge.domainPddl.includes(':requirements'));
        assert.ok(bridge.domainPddl.includes('move-right'));
        assert.ok(bridge.domainPddl.includes('push-right'));
    });

    test('domain includes all 4 movement actions', () => {
        const bridge = new PddlServiceBridge();
        assert.ok(bridge.domainPddl.includes('move-right'));
        assert.ok(bridge.domainPddl.includes('move-left'));
        assert.ok(bridge.domainPddl.includes('move-up'));
        assert.ok(bridge.domainPddl.includes('move-down'));
    });

    test('domain includes all 4 push actions', () => {
        const bridge = new PddlServiceBridge();
        assert.ok(bridge.domainPddl.includes('push-right'));
        assert.ok(bridge.domainPddl.includes('push-left'));
        assert.ok(bridge.domainPddl.includes('push-up'));
        assert.ok(bridge.domainPddl.includes('push-down'));
    });
});

describe('PddlServiceBridge — compileProblemPddl', () => {

    test('generates valid PDDL problem string', () => {
        const bridge = new PddlServiceBridge();
        const map = makeSmallMap();
        const beliefs = makeBeliefs();
        const problem = bridge.compileProblemPddl(map, beliefs, { x: 1, y: 1 }, { x: 2, y: 2 });

        assert.ok(problem.includes('crate-push-problem'));
        assert.ok(problem.includes('deliveroo-crates'));
        assert.ok(problem.includes('ag'));
        assert.ok(problem.includes('crate_1_1'));
        assert.ok(problem.includes('(at ag t_0_0)'));
        assert.ok(problem.includes('(at crate_1_1 t_1_1)'));
        assert.ok(problem.includes('(:goal (at crate_1_1 t_2_2))'));
    });

    test('uses provided crate ID when available', () => {
        const bridge = new PddlServiceBridge();
        const map = makeSmallMap();
        const beliefs = makeBeliefs();
        const problem = bridge.compileProblemPddl(map, beliefs, { id: 'c_actual', x: 1, y: 1 }, { x: 2, y: 2 });

        assert.ok(problem.includes('c_actual'));
        assert.ok(problem.includes('(at c_actual t_1_1)'));
        assert.ok(problem.includes('(:goal (at c_actual t_2_2))'));
    });

    test('marks agent and target crate positions as occupied (not clear)', () => {
        const bridge = new PddlServiceBridge();
        const map = makeSmallMap();
        const beliefs = makeBeliefs();
        const problem = bridge.compileProblemPddl(map, beliefs, { x: 1, y: 1 }, { x: 2, y: 2 });

        // The target crate tile should NOT be clear
        assert.ok(!problem.includes('(clear t_1_1)'), 'Target crate tile should not be clear');
    });

    test('includes adjacency relationships', () => {
        const bridge = new PddlServiceBridge();
        const map = makeSmallMap();
        const beliefs = makeBeliefs();
        const problem = bridge.compileProblemPddl(map, beliefs, { x: 1, y: 1 }, { x: 2, y: 2 });

        // Should have right/left/up/down relationships
        assert.ok(problem.includes('(right'), 'Should have right adjacency');
        assert.ok(problem.includes('(left'), 'Should have left adjacency');
        assert.ok(problem.includes('(up'), 'Should have up adjacency');
        assert.ok(problem.includes('(down'), 'Should have down adjacency');
    });

    test('includes additional crate positions', () => {
        const bridge = new PddlServiceBridge();
        const map = makeSmallMap();
        const beliefs = makeBeliefs({
            crates: new Map([
                ['c1', { id: 'c1', x: 0, y: 1 }],
                ['c2', { id: 'c2', x: 2, y: 0 }],
            ]),
        });
        const problem = bridge.compileProblemPddl(map, beliefs, { x: 1, y: 1 }, { x: 2, y: 2 });

        assert.ok(problem.includes('c1'));
        assert.ok(problem.includes('c2'));
        assert.ok(problem.includes('(at c1 t_0_1)'));
        assert.ok(problem.includes('(at c2 t_2_0)'));
    });

    test('includes peer positions as occupied when ignorePeers is false', () => {
        const bridge = new PddlServiceBridge();
        const map = makeSmallMap();
        const beliefs = makeBeliefs({
            peers: new Map([
                ['peer1', { x: 2, y: 0, id: 'peer1' }],
            ]),
        });
        const problem = bridge.compileProblemPddl(map, beliefs, { x: 1, y: 1 }, { x: 2, y: 2 }, false);

        // Peer at (2,0) should not be clear
        assert.ok(!problem.includes('(clear t_2_0)'), 'Peer tile should not be clear');
    });

    test('ignores peer positions when ignorePeers is true', () => {
        const bridge = new PddlServiceBridge();
        const map = makeSmallMap();
        const beliefs = makeBeliefs({
            peers: new Map([
                ['peer1', { x: 2, y: 0, id: 'peer1' }],
            ]),
        });
        const problem = bridge.compileProblemPddl(map, beliefs, { x: 1, y: 1 }, { x: 2, y: 2 }, true);

        // Peer at (2,0) should be clear when peers are ignored
        assert.ok(problem.includes('(clear t_2_0)'), 'Peer tile should be clear when ignored');
    });

    test('does not mark agent tile as peer-occupied', () => {
        const bridge = new PddlServiceBridge();
        const map = makeSmallMap();
        const beliefs = makeBeliefs({
            me: { id: 'agent1', x: 0, y: 0 },
            peers: new Map([
                ['peer1', { x: 0, y: 0, id: 'peer1' }], // peer at same tile as agent
            ]),
        });
        const problem = bridge.compileProblemPddl(map, beliefs, { x: 1, y: 1 }, { x: 2, y: 2 }, false);

        // Agent tile is at (0,0) - shouldn't be double-occupied
        assert.ok(problem.includes('(at ag t_0_0)'));
    });

    test('skips wall tiles in compilation', () => {
        const bridge = new PddlServiceBridge();
        const map = new MapRepresentation(3, 3, [
            { x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '0' }, { x: 2, y: 0, type: '3' }, // wall at (1,0)
            { x: 0, y: 1, type: '3' }, { x: 1, y: 1, type: '3' }, { x: 2, y: 1, type: '3' },
            { x: 0, y: 2, type: '3' }, { x: 1, y: 2, type: '3' }, { x: 2, y: 2, type: '3' },
        ]);
        const beliefs = makeBeliefs();
        const problem = bridge.compileProblemPddl(map, beliefs, { x: 1, y: 1 }, { x: 2, y: 2 });

        // Wall tile should not appear as an object
        assert.ok(!problem.includes('t_1_0'), 'Wall tile should be excluded');
    });
});

describe('PddlServiceBridge — parsePddlPlan', () => {

    test('parses raw plan into structured actions', () => {
        const bridge = new PddlServiceBridge();
        const rawPlan = [
            { action: 'move-right', args: ['ag', 't_0_0', 't_1_0'] },
            { action: 'push-right', args: ['ag', 'crate_target', 't_1_0', 't_2_0', 't_3_0'] },
        ];
        const result = bridge.parsePddlPlan(rawPlan);
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].action, 'move-right');
        assert.deepStrictEqual(result[0].args, ['ag', 't_0_0', 't_1_0']);
        assert.strictEqual(result[1].action, 'push-right');
    });

    test('handles steps without args array', () => {
        const bridge = new PddlServiceBridge();
        const rawPlan = [
            { action: 'move-up' }, // missing args
        ];
        const result = bridge.parsePddlPlan(rawPlan);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].action, 'move-up');
        assert.deepStrictEqual(result[0].args, []);
    });

    test('returns empty array for empty plan', () => {
        const bridge = new PddlServiceBridge();
        const result = bridge.parsePddlPlan([]);
        assert.strictEqual(result.length, 0);
    });
});
