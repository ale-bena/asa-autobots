import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    findClearCrateCapableTile,
    solveObstaclePushLocally,
    translatePddlPlanToMoves,
    resolveCrateBlockedPath,
    executePddlPlanRecipe
} from '../src/agent/PddlIntegration.js';
import { BeliefBase } from '../src/agent/BeliefBase.js';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';
import { PddlServiceBridge } from '../src/planning/PddlServiceBridge.js';

describe('PddlIntegration tests', () => {
    test('findClearCrateCapableTile when no map exists', () => {
        const beliefs = new BeliefBase();
        assert.strictEqual(findClearCrateCapableTile(beliefs, { x: 0, y: 0 }), null);
    });

    test('findClearCrateCapableTile finds clear capable tile and checks push-from', () => {
        const beliefs = new BeliefBase();
        beliefs.map = new MapRepresentation(3, 3, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '5' },
            { x: 2, y: 0, type: '3' },
            { x: 0, y: 1, type: '3' },
            { x: 1, y: 1, type: '3' },
            { x: 2, y: 1, type: '3' },
            { x: 0, y: 2, type: '3' },
            { x: 1, y: 2, type: '3' },
            { x: 2, y: 2, type: '3' }
        ]);

        beliefs.me = { x: 0, y: 0 };
        const tile = findClearCrateCapableTile(beliefs, { x: 1, y: 1 });
        assert.ok(tile);
        assert.strictEqual(tile.x, 1);
        assert.strictEqual(tile.y, 0);
    });

    test('solveObstaclePushLocally checks pushFrom walkability', () => {
        const beliefs = new BeliefBase();
        beliefs.map = new MapRepresentation(3, 3, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' },
            { x: 2, y: 0, type: '0' }
        ]);
        beliefs.me = { x: 0, y: 0 };

        const plan = solveObstaclePushLocally(beliefs, { x: 1, y: 0 }, { x: 0, y: 0 });
        assert.strictEqual(plan, null);
    });

    test('solveObstaclePushLocally success', () => {
        const beliefs = new BeliefBase();
        beliefs.map = new MapRepresentation(3, 3, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' },
            { x: 2, y: 0, type: '3' }
        ]);
        beliefs.me = { x: 0, y: 0 };
        beliefs.crates.set('c1', { id: 'c1', x: 1, y: 0 });

        const planFail = solveObstaclePushLocally(beliefs, { x: 1, y: 0 }, { x: 0, y: 0 });
        assert.strictEqual(planFail, null);

        const beliefs2 = new BeliefBase();
        beliefs2.map = new MapRepresentation(3, 2, [
            { x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '3' }, { x: 2, y: 0, type: '3' },
            { x: 0, y: 1, type: '3' }, { x: 1, y: 1, type: '3' }, { x: 2, y: 1, type: '3' }
        ]);
        beliefs2.me = { x: 0, y: 0 };
        beliefs2.crates.set('c1', { id: 'c1', x: 1, y: 0 });

        const planSuccess = solveObstaclePushLocally(beliefs2, { x: 1, y: 0 }, { x: 0, y: 0 });
        assert.ok(planSuccess);
        assert.strictEqual(planSuccess.length, 5);
        assert.deepStrictEqual(planSuccess[planSuccess.length - 1], { x: 1, y: 0 });
    });

    test('translatePddlPlanToMoves coordinates parser', () => {
        const plan = [
            { action: 'move-left', args: ['ag', 't_1_2', 't_0_2'] },
            { action: 'push-left', args: ['ag', 'cr', 't_0_2', 't_0_1', 't_0_0'] }
        ];
        const moves = translatePddlPlanToMoves(plan);
        assert.strictEqual(moves.length, 2);
        assert.strictEqual(moves[0].x, 0);
        assert.strictEqual(moves[0].y, 2);
        assert.strictEqual(moves[1].x, 0);
        assert.strictEqual(moves[1].y, 1);
    });

    test('resolveCrateBlockedPath cooldown throttle and blockGoal', async () => {
        const beliefs = new BeliefBase();
        beliefs.map = new MapRepresentation(3, 1, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' },
            { x: 2, y: 0, type: '3' }
        ]);
        beliefs.me = { x: 0, y: 0 };
        beliefs.crates.set('c1', { id: 'c1', x: 1, y: 0 });

        const engineState = {
            failedPddlSolves: new Map(),
            blockedDeliveryZones: new Map()
        };

        const crateKey = '1,0';
        engineState.failedPddlSolves.set(crateKey, Date.now() - 5000);

        const bestGoal = { type: 'deliver', targetId: null, x: 2, y: 0 };
        const result = await resolveCrateBlockedPath(beliefs, bestGoal, engineState);
        assert.strictEqual(result, null);

        assert.ok(beliefs.blockedTargets.has('2,0'));
        assert.ok(engineState.blockedDeliveryZones.has('2,0'));
    });

    test('executePddlPlanRecipe generator', () => {
        const beliefs = new BeliefBase();
        beliefs.me = { x: 0, y: 0 };
        beliefs.map = new MapRepresentation(5, 5, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' },
            { x: 2, y: 0, type: '3' }
        ]);

        const moves = [{ x: 1, y: 0 }, { x: 2, y: 0 }];
        const gen = executePddlPlanRecipe(beliefs, moves);

        const step1 = gen.next();
        assert.strictEqual(step1.done, false);
        assert.strictEqual(step1.value.action, 'move');
        assert.strictEqual(step1.value.target.x, 1);

        beliefs.me.x = 1;
        const step2 = gen.next(true);
        assert.strictEqual(step2.done, false);
        assert.strictEqual(step2.value.action, 'move');
        assert.strictEqual(step2.value.target.x, 2);

        beliefs.me.x = 2;
        const step3 = gen.next(true);
        assert.strictEqual(step3.done, true);
    });

    test('executePddlPlanRecipe out of sync A* navigation fallback', () => {
        const beliefs = new BeliefBase();
        beliefs.me = { x: 5, y: 5 };
        beliefs.map = new MapRepresentation(10, 10, [
            { x: 5, y: 5, type: '3' }, { x: 4, y: 5, type: '3' }, { x: 3, y: 5, type: '3' },
            { x: 2, y: 5, type: '3' }, { x: 1, y: 5, type: '3' }, { x: 1, y: 4, type: '3' },
            { x: 1, y: 3, type: '3' }, { x: 1, y: 2, type: '3' }, { x: 1, y: 1, type: '3' },
            { x: 1, y: 0, type: '3' }
        ]);

        const moves = [{ x: 1, y: 0 }, { x: 2, y: 0 }];
        const gen = executePddlPlanRecipe(beliefs, moves);

        const step = gen.next();
        assert.strictEqual(step.done, false);
        assert.strictEqual(step.value.action, 'move');
    });

    test('resolveCrateBlockedPath falls back to PddlServiceBridge', async () => {
        const beliefs = new BeliefBase();
        beliefs.map = new MapRepresentation(4, 0, [
            { x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '3' }, { x: 2, y: 0, type: '3' },
            { x: 3, y: 0, type: '3' }, { x: 4, y: 0, type: '5' }
        ]);
        beliefs.me = { x: 0, y: 0 };
        beliefs.crates.set('c1', { id: 'c1', x: 3, y: 0 });

        beliefs.blockedTargets.set('1,0', Date.now());

        const engineState = {
            failedPddlSolves: new Map(),
            blockedDeliveryZones: new Map()
        };

        const originalSolve = PddlServiceBridge.prototype.solveObstaclePush;
        PddlServiceBridge.prototype.solveObstaclePush = async function () {
            return [
                { action: 'move-right', args: ['ag', 't_0_0', 't_1_0'] },
                { action: 'push-right', args: ['ag', 'cr', 't_1_0', 't_2_0'] }
            ];
        };

        const bestGoal = { type: 'deliver', targetId: null, x: 4, y: 0 };
        const result = await resolveCrateBlockedPath(beliefs, bestGoal, engineState);

        PddlServiceBridge.prototype.solveObstaclePush = originalSolve;

        assert.ok(result, "Result should not be null");
        assert.strictEqual(result.moves.length, 2);
        assert.strictEqual(result.crate.id, 'c1');
    });

    test('solveObstaclePushLocally already at pushFrom', () => {
        const beliefs = new BeliefBase();
        beliefs.map = new MapRepresentation(3, 1, [{ x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '3' }, { x: 2, y: 0, type: '3' }]);
        beliefs.me = { x: 2, y: 0 }; // Already at pushFrom
        const moves = solveObstaclePushLocally(beliefs, { x: 1, y: 0 }, { x: 0, y: 0 });
        assert.ok(moves);
        assert.strictEqual(moves.length, 1);
        assert.deepStrictEqual(moves[0], { x: 1, y: 0 }); // executes push directly
    });

    test('executePddlPlanRecipe empty moves', () => {
        const gen = executePddlPlanRecipe(new BeliefBase(), []);
        assert.strictEqual(gen.next().done, true);
    });

    test('executePddlPlanRecipe non adjacent step aborts', () => {
        const beliefs = new BeliefBase();
        beliefs.me = { x: 0, y: 0 };
        beliefs.map = new MapRepresentation(3, 3, [{ x: 0, y: 0, type: '3' }, { x: 2, y: 2, type: '3' }]);
        // Simulate already being at the first step so we skip the A* catch-up block
        const moves = [{ x: 0, y: 0 }, { x: 2, y: 2 }];
        const gen = executePddlPlanRecipe(beliefs, moves);

        // Next step is 2,2 which is NOT adjacent to 0,0, should hit the break
        assert.strictEqual(gen.next().done, true);
    });

    test('executePddlPlanRecipe out of sync A* fallback failure to reach', () => {
         const beliefs = new BeliefBase();
         beliefs.me = { x: 5, y: 5, path: [], nextStep: null }; 
         beliefs.policyRules = {};
         beliefs.blockedTargets = new Map();
         
         // Create a full 6x6 grid filled with type '3' (walkable)
         const fullGrid = Array(36).fill(null).map((_, i) => ({
             x: i % 6,
             y: Math.floor(i / 6),
             type: '3'
         }));
         beliefs.map = new MapRepresentation(6, 6, fullGrid);

         const moves = [{ x: 1, y: 0 }];
         const gen = executePddlPlanRecipe(beliefs, moves);

         // 1. Starts navigating. NavigateTo will yield the first step towards (1,0)
         let step = gen.next(); 
         assert.strictEqual(step.done, false);
         
         // 2. Mock a displacement and a blocked path. 
         // Move agent to (2,5) and set target (1,0) to WALL ('0')
         beliefs.me.x = 2;
         beliefs.me.y = 5;
         beliefs.map.grid[beliefs.map.getFlatIndex(1, 0)] = 0; 

         // 3. Passing 'false' triggers NavigateTo recalculation. 
         // Since (1,0) is now a wall, A* returns null, NavigateTo returns false.
         step = gen.next(false); 
         
         assert.strictEqual(step.done, true); 
         assert.strictEqual(beliefs.me.nextStep, null);
    });

    test('executePddlPlanRecipe aborts on move failure', () => {
        const beliefs = new BeliefBase();
        beliefs.me = { x: 0, y: 0 };
        beliefs.map = new MapRepresentation(5, 0, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' },
            { x: 2, y: 0, type: '3' }
        ]);

        const moves = [{ x: 1, y: 0 }, { x: 2, y: 0 }];
        const gen = executePddlPlanRecipe(beliefs, moves);

        let step = gen.next();
        assert.strictEqual(step.done, false);
        assert.strictEqual(step.value.action, 'move');

        // Feed false to simulate movement failure
        step = gen.next(false);

        assert.strictEqual(step.done, true);
        assert.strictEqual(beliefs.me.nextStep, null);
    });
});