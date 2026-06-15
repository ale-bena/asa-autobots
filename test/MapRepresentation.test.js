import { test, describe } from 'node:test';
import assert from 'node:assert';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';

describe('MapRepresentation tests', () => {
    test('MapRepresentation constructor and parsing', () => {
        // Create a 3x3 grid (width=2, height=2 index bounds)
        const tiles = [
            { x: 0, y: 0, type: '0' }, // Wall
            { x: 1, y: 0, type: '1' }, // Spawn
            { x: 2, y: 0, type: '2' }, // Delivery
            { x: 0, y: 1, type: '3' }, // Pavement
            { x: 1, y: 1, type: '5!' }, // Crate Spawn
            { x: 2, y: 1, type: '5' }, // Crate
            { x: 0, y: 2, type: '↑' }, // Arrow up
            { x: 1, y: 2, type: '→' }, // Arrow right
            { x: 2, y: 2, type: '↓' }  // Arrow down
        ];

        const map = new MapRepresentation(2, 2, tiles);
        
        assert.strictEqual(map.width, 3);
        assert.strictEqual(map.height, 3);

        assert.strictEqual(map.getTileCode(0, 0), MapRepresentation.TILE_CODES.WALL);
        assert.strictEqual(map.getTileCode(1, 0), MapRepresentation.TILE_CODES.SPAWN);
        assert.strictEqual(map.getTileCode(2, 0), MapRepresentation.TILE_CODES.DELIVERY);
        assert.strictEqual(map.getTileCode(0, 1), MapRepresentation.TILE_CODES.PAVEMENT);
        assert.strictEqual(map.getTileCode(1, 1), MapRepresentation.TILE_CODES.CRATE_SPAWN);
        assert.strictEqual(map.getTileCode(2, 1), MapRepresentation.TILE_CODES.CRATE);
        assert.strictEqual(map.getTileCode(0, 2), MapRepresentation.TILE_CODES.ARROW_UP);
        assert.strictEqual(map.getTileCode(1, 2), MapRepresentation.TILE_CODES.ARROW_RIGHT);
        assert.strictEqual(map.getTileCode(2, 2), MapRepresentation.TILE_CODES.ARROW_DOWN);

        // Test out of bounds code
        assert.strictEqual(map.getTileCode(-1, 0), MapRepresentation.TILE_CODES.WALL);
        assert.strictEqual(map.getTileCode(3, 0), MapRepresentation.TILE_CODES.WALL);
    });

    test('isValidCoord and isWalkableTile checks', () => {
        const tiles = [
            { x: 0, y: 0, type: '0' },
            { x: 1, y: 0, type: '3' }
        ];
        const map = new MapRepresentation(1, 0, tiles);

        assert.strictEqual(map.isValidCoord(0, 0), true);
        assert.strictEqual(map.isValidCoord(1, 0), true);
        assert.strictEqual(map.isValidCoord(2, 0), false);
        assert.strictEqual(map.isValidCoord(0, 1), false);

        assert.strictEqual(map.isWalkableTile(0, 0), false); // Wall
        assert.strictEqual(map.isWalkableTile(1, 0), true);  // Pavement
        assert.strictEqual(map.isWalkableTile(2, 0), false); // Out of bounds
    });

    test('isAdjacent and directional Arrow gate rules', () => {
        const tiles = [
            { x: 0, y: 0, type: '3' }, // from cell
            { x: 1, y: 0, type: '←' }, // Arrow Left (pointing left)
            { x: 0, y: 1, type: '↑' }, // Arrow Up (pointing up)
            { x: 1, y: 1, type: '0' }, // Wall
            { x: 0, y: 2, type: '↓' }, // Arrow Down (pointing down)
            { x: 2, y: 0, type: '→' }  // Arrow Right (pointing right)
        ];
        const map = new MapRepresentation(2, 2, tiles);

        // Distance check (not adjacent)
        assert.strictEqual(map.isAdjacent({ x: 0, y: 0 }, { x: 2, y: 2 }), false);

        // Destination is wall
        assert.strictEqual(map.isAdjacent({ x: 0, y: 0 }, { x: 1, y: 1 }), false);

        // Arrow Left (pointing left, at 1,0):
        // Cannot move right onto it (dx = 1, i.e., from x=0 to x=1)
        assert.strictEqual(map.isAdjacent({ x: 0, y: 0 }, { x: 1, y: 0 }), false);
        // But can move from x=2 to x=1? Wait, 2,0 is Arrow Right. Let's just check the rule directly:
        // Arrow Left: if (toCode === ARROW_LEFT && dx === 1) return false; (Moving right onto it)

        // Arrow Right (pointing right, at 2,0):
        // Cannot move left onto it (dx = -1, i.e., from x=3 to x=2)
        // Wait, from x=1 to x=2: dx = 1, which is allowed. Let's check:
        assert.strictEqual(map.isAdjacent({ x: 1, y: 0 }, { x: 2, y: 0 }), true);

        // Arrow Up (pointing up, at 0,1):
        // Cannot move down onto it (dy = -1, i.e., from y=2 to y=1)
        assert.strictEqual(map.isAdjacent({ x: 0, y: 2 }, { x: 0, y: 1 }), false);
        // Can move up onto it (dy = 1, from y=0 to y=1)
        assert.strictEqual(map.isAdjacent({ x: 0, y: 0 }, { x: 0, y: 1 }), true);

        // Arrow Down (pointing down, at 0,2):
        // Cannot move up onto it (dy = 1, from y=1 to y=2)
        assert.strictEqual(map.isAdjacent({ x: 0, y: 1 }, { x: 0, y: 2 }), false);
    });

    test('getNeighbors returns walkable adjacent coordinates', () => {
        const tiles = [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' },
            { x: 0, y: 1, type: '0' },
            { x: 1, y: 1, type: '3' }
        ];
        const map = new MapRepresentation(1, 1, tiles);

        const neighbors = map.getNeighbors({ x: 0, y: 0 });
        assert.strictEqual(neighbors.length, 1);
        assert.strictEqual(neighbors[0].x, 1);
        assert.strictEqual(neighbors[0].y, 0);
    });

    test('findExtremeWalkableTiles logic', () => {
        const tiles = [
            { x: 0, y: 0, type: '0' },
            { x: 1, y: 0, type: '3' },
            { x: 2, y: 0, type: '3' },
            { x: 0, y: 1, type: '3' },
            { x: 1, y: 1, type: '0' },
            { x: 2, y: 1, type: '3' },
            { x: 0, y: 2, type: '3' },
            { x: 1, y: 2, type: '3' },
            { x: 2, y: 2, type: '0' }
        ];
        const map = new MapRepresentation(2, 2, tiles);

        const extremes = map.findExtremeWalkableTiles(0, 0);
        
        assert.ok(extremes.leftmost);
        assert.ok(extremes.rightmost);
        assert.ok(extremes.topmost);
        assert.ok(extremes.bottommost);

        // leftmost should be x=0, either (0,1) or (0,2). With ref (0,0), distance to (0,1) is 1, to (0,2) is 2. So (0,1) is closer.
        assert.strictEqual(extremes.leftmost.x, 0);
        assert.strictEqual(extremes.leftmost.y, 1);

        // rightmost should be x=2, either (2,0) or (2,1). Distance to (2,0) is 2, to (2,1) is 3. So (2,0) is closer.
        assert.strictEqual(extremes.rightmost.x, 2);
        assert.strictEqual(extremes.rightmost.y, 0);
    });

    test('printMap calls without errors', () => {
        const tiles = [
            { x: 0, y: 0, type: '0' },
            { x: 1, y: 0, type: '1' },
            { x: 2, y: 0, type: '2' },
            { x: 0, y: 1, type: '3' },
            { x: 1, y: 1, type: '5!' },
            { x: 2, y: 1, type: '5' },
            { x: 0, y: 2, type: '↑' },
            { x: 1, y: 2, type: '→' },
            { x: 2, y: 2, type: '↓' },
            { x: 3, y: 2, type: '←' }
        ];
        const map = new MapRepresentation(3, 2, tiles);
        
        // Ensure printMap runs without throwing
        assert.doesNotThrow(() => {
            map.printMap();
        });
    });
});
