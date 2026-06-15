/**
 * @file Pathfinding.test.js
 * @description Dedicated test suite for the A* pathfinding algorithm in src/mapping/Pathfinding.js.
 * Uses Node.js native test runner (node:test) — the industry-standard, zero-dependency
 * testing framework shipped with Node ≥ 18.
 *
 * Why node:test?  It is maintained by the Node.js core team, requires no third-party
 * devDependencies, and produces TAP/spec output compatible with CI pipelines.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { findAStarPath } from '../src/mapping/Pathfinding.js';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';

/**
 * Helper: build a simple 5×5 grid map from tile data.
 * All tiles are pavements unless overridden.
 */
function makeMap(width, height, overrides = []) {
    const tiles = [];
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            tiles.push({ x, y, type: '3' }); // pavement
        }
    }
    for (const o of overrides) {
        const existing = tiles.find(t => t.x === o.x && t.y === o.y);
        if (existing) existing.type = o.type;
    }
    return new MapRepresentation(width, height, tiles);
}

describe('Pathfinding — findAStarPath', () => {

    // ── Trivial cases ───────────────────────────────────────────────

    test('returns single-node path when start equals goal', () => {
        const map = makeMap(3, 3);
        const path = findAStarPath(map, { x: 1, y: 1 }, { x: 1, y: 1 });
        assert.ok(path);
        assert.strictEqual(path.length, 1);
        assert.deepStrictEqual(path[0], { x: 1, y: 1 });
    });

    test('finds straight-line path on open grid', () => {
        const map = makeMap(5, 5);
        const path = findAStarPath(map, { x: 0, y: 0 }, { x: 4, y: 0 });
        assert.ok(path);
        assert.strictEqual(path[0].x, 0);
        assert.strictEqual(path[0].y, 0);
        assert.strictEqual(path[path.length - 1].x, 4);
        assert.strictEqual(path[path.length - 1].y, 0);
        // Manhattan distance is 4, so path length should be 5 (inclusive of start)
        assert.strictEqual(path.length, 5);
    });

    // ── Wall obstacles ──────────────────────────────────────────────

    test('navigates around wall tiles', () => {
        // Create a wall across y=1 from x=0..3, leaving x=4 open
        const walls = [
            { x: 0, y: 1, type: '0' },
            { x: 1, y: 1, type: '0' },
            { x: 2, y: 1, type: '0' },
            { x: 3, y: 1, type: '0' },
        ];
        const map = makeMap(5, 3, walls);
        const path = findAStarPath(map, { x: 0, y: 0 }, { x: 0, y: 2 });
        assert.ok(path, 'Should find a path around the wall');
        assert.strictEqual(path[0].x, 0);
        assert.strictEqual(path[0].y, 0);
        assert.strictEqual(path[path.length - 1].x, 0);
        assert.strictEqual(path[path.length - 1].y, 2);
    });

    test('returns null when no path exists (fully walled off)', () => {
        // Wall off the goal entirely
        const walls = [
            { x: 1, y: 0, type: '0' },
            { x: 0, y: 1, type: '0' },
        ];
        const map = makeMap(2, 2, walls);
        const path = findAStarPath(map, { x: 0, y: 0 }, { x: 1, y: 1 });
        assert.strictEqual(path, null);
    });

    // ── Policy avoidance tiles ──────────────────────────────────────

    test('penalizes avoid tiles via policy', () => {
        const map = makeMap(5, 3);
        const policy = { avoidTiles: ['2,0'] };

        // Without policy, the straight path goes through (2,0)
        const directPath = findAStarPath(map, { x: 0, y: 0 }, { x: 4, y: 0 });
        assert.ok(directPath);
        assert.ok(directPath.some(p => p.x === 2 && p.y === 0), 'Direct path should go through (2,0)');

        // With policy, A* should route around the penalized tile
        const avoidPath = findAStarPath(map, { x: 0, y: 0 }, { x: 4, y: 0 }, policy);
        assert.ok(avoidPath);
        // The avoid path should still reach the goal
        assert.strictEqual(avoidPath[avoidPath.length - 1].x, 4);
        assert.strictEqual(avoidPath[avoidPath.length - 1].y, 0);
    });

    // ── Crate blocking ──────────────────────────────────────────────

    test('treats crate tiles as hard obstacles', () => {
        const map = makeMap(3, 3);
        const beliefs = {
            crates: new Map([
                ['c1', { x: 1, y: 0 }],
                ['c2', { x: 1, y: 1 }],
                ['c3', { x: 1, y: 2 }],
            ]),
            peers: new Map(),
        };
        // All of column x=1 is blocked by crates — no path exists
        const path = findAStarPath(map, { x: 0, y: 0 }, { x: 2, y: 0 }, null, beliefs);
        assert.strictEqual(path, null);
    });

    // ── Peer avoidance (soft penalty vs hard block) ─────────────────

    test('applies soft penalty to peer tiles (non-blocking)', () => {
        const map = makeMap(5, 3);
        const beliefs = {
            crates: new Map(),
            peers: new Map([
                ['peer1', { x: 2, y: 0 }],
            ]),
        };
        // Without blockPeers, peers are a soft cost penalty — path still exists
        const path = findAStarPath(map, { x: 0, y: 0 }, { x: 4, y: 0 }, null, beliefs, false);
        assert.ok(path, 'Path should exist with soft peer penalty');
    });

    test('blocks peer tiles when blockPeers is true', () => {
        const map = makeMap(3, 1); // single row
        const beliefs = {
            crates: new Map(),
            peers: new Map([
                ['peer1', { x: 1, y: 0 }],
            ]),
        };
        // blockPeers = true, and the only path through (1,0) is blocked
        const path = findAStarPath(map, { x: 0, y: 0 }, { x: 2, y: 0 }, null, beliefs, true);
        assert.strictEqual(path, null, 'Path should be blocked by peer');
    });

    // ── Peer next-step and path soft penalties ──────────────────────

    test('applies penalties to peer nextStep and path tiles', () => {
        const map = makeMap(5, 3);
        const beliefs = {
            crates: new Map(),
            peers: new Map([
                ['peer1', {
                    x: 2, y: 0,
                    nextStep: { x: 3, y: 0 },
                    path: [{ x: 3, y: 0 }, { x: 4, y: 0 }],
                }],
            ]),
        };
        // Path still reaches goal despite penalties
        const path = findAStarPath(map, { x: 0, y: 0 }, { x: 4, y: 0 }, null, beliefs, false);
        assert.ok(path);
        assert.strictEqual(path[path.length - 1].x, 4);
    });

    // ── Blocked targets ─────────────────────────────────────────────

    test('blocks intermediate tiles in blockedTargets but allows goal', () => {
        const map = makeMap(5, 3);
        const beliefs = {
            crates: new Map(),
            peers: new Map(),
            blockedTargets: new Set(['2,0']),
        };
        // (2,0) is a blocked target. If it's intermediate, it's blocked.
        // But if (2,0) IS the goal, it should be reachable.
        const pathBlocked = findAStarPath(map, { x: 0, y: 0 }, { x: 4, y: 0 }, null, beliefs);
        assert.ok(pathBlocked, 'Path should route around blocked intermediate tile');
        // Should avoid (2,0) as intermediate
        const intermediates = pathBlocked.slice(1, -1);
        const passesThrough = intermediates.some(p => p.x === 2 && p.y === 0);
        assert.strictEqual(passesThrough, false, 'Should not pass through blocked intermediate (2,0)');

        // If (2,0) is the goal itself, it should be reachable
        const pathToGoal = findAStarPath(map, { x: 0, y: 0 }, { x: 2, y: 0 }, null, beliefs);
        assert.ok(pathToGoal, 'Should reach blocked tile when it is the goal');
        assert.strictEqual(pathToGoal[pathToGoal.length - 1].x, 2);
    });

    // ── Diagonal / L-shaped path ────────────────────────────────────

    test('finds L-shaped path (no diagonal movement)', () => {
        const map = makeMap(3, 3);
        const path = findAStarPath(map, { x: 0, y: 0 }, { x: 2, y: 2 });
        assert.ok(path);
        // Manhattan distance is 4, so path length should be 5
        assert.strictEqual(path.length, 5);
        // Verify all steps are orthogonal (no diagonal jumps)
        for (let i = 1; i < path.length; i++) {
            const dx = Math.abs(path[i].x - path[i - 1].x);
            const dy = Math.abs(path[i].y - path[i - 1].y);
            assert.strictEqual(dx + dy, 1, 'Each step must be exactly 1 tile orthogonally');
        }
    });
});
