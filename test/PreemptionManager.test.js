import { test, describe } from 'node:test';
import assert from 'node:assert';
import { shouldPreemptActivePlan } from '../src/agent/PreemptionManager.js';
import { BeliefBase } from '../src/agent/BeliefBase.js';

describe('PreemptionManager tests', () => {
    test('no active plan should preempt', () => {
        const beliefs = new BeliefBase();
        assert.strictEqual(shouldPreemptActivePlan(null, null, { type: 'pickup' }, beliefs), true);
        assert.strictEqual(shouldPreemptActivePlan({ type: 'pickup' }, null, { type: 'pickup' }, beliefs), true);
        assert.strictEqual(shouldPreemptActivePlan(null, {}, { type: 'pickup' }, beliefs), true);
    });

    test('admin commands preemption', () => {
        const beliefs = new BeliefBase();
        const generator = (function* () {})();
        
        // Active normal plan, best is admin_move -> should preempt
        const currentNormal = { type: 'pickup', targetId: 'p1', x: 0, y: 0 };
        const bestAdmin = { type: 'admin_move', targetId: null, x: 2, y: 2 };
        assert.strictEqual(shouldPreemptActivePlan(currentNormal, generator, bestAdmin, beliefs), true);

        // Active admin_move, best is normal -> should NOT preempt
        assert.strictEqual(shouldPreemptActivePlan(bestAdmin, generator, currentNormal, beliefs), false);

        // Active admin_move, best is same admin_move -> should NOT preempt
        assert.strictEqual(shouldPreemptActivePlan(bestAdmin, generator, bestAdmin, beliefs), false);

        // Active admin_move, best is different admin_move -> should preempt
        const diffAdmin = { type: 'admin_move', targetId: null, x: 3, y: 3 };
        assert.strictEqual(shouldPreemptActivePlan(bestAdmin, generator, diffAdmin, beliefs), true);
    });

    test('rendezvous preemption', () => {
        const beliefs = new BeliefBase();
        const generator = (function* () {})();
        
        const activeRendezvous = { type: 'rendezvous', targetId: 'c1', x: 1, y: 1 };
        
        // Goal changed type
        const newGoal = { type: 'pickup', targetId: 'p1', x: 1, y: 1 };
        assert.strictEqual(shouldPreemptActivePlan(activeRendezvous, generator, newGoal, beliefs), true);

        // Goal changed targetId
        const diffRendezvous = { type: 'rendezvous', targetId: 'c2', x: 1, y: 1 };
        assert.strictEqual(shouldPreemptActivePlan(activeRendezvous, generator, diffRendezvous, beliefs), true);

        // Goal is identical
        assert.strictEqual(shouldPreemptActivePlan(activeRendezvous, generator, activeRendezvous, beliefs), false);
    });

    test('clear_corridor preemption', () => {
        const beliefs = new BeliefBase();
        const generator = (function* () {})();
        
        const activeClear = { type: 'clear_corridor', targetId: null, x: 0, y: 0 };
        const newGoal = { type: 'pickup', targetId: 'p1', x: 1, y: 1 };
        
        // normal goal cannot preempt clear_corridor
        assert.strictEqual(shouldPreemptActivePlan(activeClear, generator, newGoal, beliefs), false);
    });

    test('cooperative contracts preemption', () => {
        const beliefs = new BeliefBase();
        const generator = (function* () {})();
        
        // mock cooperative contract that is active
        beliefs.activeContracts.set('coop123', { coopId: 'coop123', type: 'HANDOFF', status: 'ACTIVE' });
        
        const activeNormal = { type: 'pickup', targetId: 'p1', x: 1, y: 1 };
        const bestHandoff = { type: 'handoff', targetId: 'coop123', x: 1, y: 1 };

        // Should preempt when we have coop and not in rendezvous/handoff
        assert.strictEqual(shouldPreemptActivePlan(activeNormal, generator, bestHandoff, beliefs), true);

        // Should NOT preempt if already in rendezvous/handoff
        const activeHandoff = { type: 'handoff', targetId: 'coop123', x: 1, y: 1 };
        assert.strictEqual(shouldPreemptActivePlan(activeHandoff, generator, bestHandoff, beliefs), false);

        // Should NOT preempt if contract is RELAY
        beliefs.activeContracts.clear();
        beliefs.activeContracts.set('relay123', { coopId: 'relay123', type: 'RELAY', status: 'ACTIVE' });
        assert.strictEqual(shouldPreemptActivePlan(activeNormal, generator, bestHandoff, beliefs), false);
    });

    test('delivery vs normal preemption', () => {
        const beliefs = new BeliefBase();
        const generator = (function* () {})();
        
        const activePickup = { type: 'pickup', targetId: 'p1', x: 1, y: 1 };
        const bestDeliver = { type: 'deliver', targetId: null, x: 5, y: 5 };

        // deliver should preempt pickup
        assert.strictEqual(shouldPreemptActivePlan(activePickup, generator, bestDeliver, beliefs), true);

        // pickup should preempt deliver (for along-the-path detours)
        assert.strictEqual(shouldPreemptActivePlan(bestDeliver, generator, activePickup, beliefs), true);

        // deliver should not preempt deliver
        const diffDeliver = { type: 'deliver', targetId: null, x: 6, y: 6 };
        assert.strictEqual(shouldPreemptActivePlan(bestDeliver, generator, diffDeliver, beliefs), false);
    });

    test('pickups vs patrols', () => {
        const beliefs = new BeliefBase();
        const generator = (function* () {})();
        
        const activePatrol = { type: 'patrol', targetId: null, x: 1, y: 1 };
        const activePatrolSpawn = { type: 'patrol_spawn', targetId: null, x: 1, y: 1 };
        const bestPickup = { type: 'pickup', targetId: 'p1', x: 2, y: 2 };

        assert.strictEqual(shouldPreemptActivePlan(activePatrol, generator, bestPickup, beliefs), true);
        assert.strictEqual(shouldPreemptActivePlan(activePatrolSpawn, generator, bestPickup, beliefs), true);
    });

    test('pickup target changes', () => {
        const beliefs = new BeliefBase();
        const generator = (function* () {})();
        
        const activePickup = { type: 'pickup', targetId: 'p1', x: 1, y: 1 };
        const diffPickup = { type: 'pickup', targetId: 'p2', x: 2, y: 2 };

        // Different target pickup should preempt
        assert.strictEqual(shouldPreemptActivePlan(activePickup, generator, diffPickup, beliefs), true);

        // Same target pickup should NOT preempt
        assert.strictEqual(shouldPreemptActivePlan(activePickup, generator, activePickup, beliefs), false);
    });
});
