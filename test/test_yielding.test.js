import { BeliefBase } from '../src/agent/BeliefBase.js';
import { selectBestGoal } from '../src/agent/GoalSelector.js';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';
import { AGENT_IDS } from '../src/config/config.js';

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ Assertion failed: ${message}`);
        process.exit(1);
    }
    console.log(`✅ Passed: ${message}`);
}

async function runYieldingTests() {
    console.log('=== Running Case 19: Peer Yielding & Dodge Behavior ===');

    // Create a 5x1 corridor map
    // (0,0) (1,0) (2,0) (3,0) (4,0)
    const tiles = [
        { x: 0, y: 0, type: '3' }, // pavement
        { x: 1, y: 0, type: '3' },
        { x: 2, y: 0, type: '3' },
        { x: 3, y: 0, type: '3' },
        { x: 4, y: 0, type: '3' }
    ];
    const map = new MapRepresentation(4, 0, tiles);

    const beliefs = new BeliefBase();
    beliefs.map = map;
    
    // We are LLM_AGENT_ID, standing at (2,0)
    beliefs.me = { id: AGENT_IDS.LLM_AGENT_ID, x: 2, y: 0 };
    beliefs.carried = [];

    // Peer is BDI_AGENT_ID, standing at (0,0)
    const peer = {
        id: AGENT_IDS.BDI_AGENT_ID,
        x: 0,
        y: 0,
        currentGoal: { type: 'clear_corridor', targetId: null, x: 3, y: 0 },
        nextStep: { x: 1, y: 0 },
        path: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
        carried: []
    };
    beliefs.peers.set(AGENT_IDS.BDI_AGENT_ID, peer);

    // Let's check: BDI is executing 'clear_corridor' and wants to step through (2,0) which is our tile.
    // Since BDI has higher priority (clear_corridor), we should dodge.
    const engineState = {
        dynamicCapacityLimit: 20,
        actionStats: {},
        blockedDeliveryZones: new Map(),
        lastRequiredStackSize: null,
        lastMaxStackSize: null
    };

    const goal = selectBestGoal(beliefs, engineState);
    console.log(`LLM Agent selected goal: type=${goal.type}, x=${goal.x}, y=${goal.y}`);

    assert(goal.type === 'dodge', 'LLM Agent should select a dodge goal');
    // Since we are at (2,0) and the BDI path is (1,0) -> (2,0) -> (3,0),
    // wait! The neighbors of (2,0) are (1,0) and (3,0).
    // Both neighbors are in the peer's path. So we must back up!
    // Since peer is at (0,0), the neighbor that increases distance from peer (0,0) is (3,0).
    // Thus we should back up to (3,0).
    assert(goal.x === 3 && goal.y === 0, `LLM Agent should back up to (3,0) to increase distance (got ${goal.x},${goal.y})`);

    console.log('=== Case 19 Unit Test Passed Successfully ===');
}

runYieldingTests().catch(err => {
    console.error('Test run failed:', err);
    process.exit(1);
});
