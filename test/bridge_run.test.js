import { PddlServiceBridge } from '../src/planning/PddlServiceBridge.js';

class MockMap {
    constructor() {
        this.width = 2;
        this.height = 3;
    }
    isWalkableTile(x, y) {
        return x >= 0 && x < this.width && y >= 0 && y < this.height;
    }
    getTileCode(x, y) {
        return 5; // CRATE_MOVE
    }
    isAdjacent(from, to) {
        return Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1;
    }
}

const map = new MockMap();
const beliefs = {
    me: { x: 0, y: 0 },
    crates: new Map([
        ['crate_target', { x: 0, y: 1 }]
    ]),
    peers: new Map()
};

const bridge = new PddlServiceBridge();
console.log('Compiling problem...');
const problem = bridge.compileProblemPddl(map, beliefs, { x: 0, y: 1 }, { x: 0, y: 2 });
console.log('Problem:', problem);

console.log('Submitting to solver...');
try {
    const rawPlan = await bridge.solveObstaclePush(map, beliefs, { x: 0, y: 1 }, { x: 0, y: 2 });
    console.log('Plan result:', rawPlan);
} catch (e) {
    console.error('Solver error:', e);
}
