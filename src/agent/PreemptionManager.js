/**
 * @module agent/PreemptionManager
 * @description Preemption decision matrix for the BDI intention engine.
 * Determines whether a newly selected goal should preempt the currently active plan.
 */

/**
 * Checks if a newly selected goal should preempt the active plan.
 * @param {Object} currentGoal - The currently executing goal descriptor.
 * @param {Generator|null} activeGenerator - The currently active plan generator.
 * @param {{type: string, targetId: string|null, x: number|null, y: number|null}} bestGoal - New goal.
 * @param {import('./BeliefBase.js').BeliefBase} beliefs - Current agent beliefs.
 * @returns {boolean} True if the engine should preempt.
 */
export function shouldPreemptActivePlan(currentGoal, activeGenerator, bestGoal, beliefs) {
    if (!activeGenerator) return true;
    if (!currentGoal) return true;

    // 1. Admin commands handling (highest priority)
    const isAdminType = (type) => type === 'admin_move' || type === 'admin_pickup' || type === 'admin_deliver';

    if (isAdminType(bestGoal.type)) {
        if (currentGoal.type !== bestGoal.type || 
            bestGoal.targetId !== currentGoal.targetId ||
            bestGoal.x !== currentGoal.x || 
            bestGoal.y !== currentGoal.y) {
            return true;
        }
    }

    if (isAdminType(currentGoal.type)) {
        if (!isAdminType(bestGoal.type)) {
            return false;
        }
    }

    // If we are in rendezvous, but the contract is no longer active or the goal changed
    if (currentGoal.type === 'rendezvous') {
        if (bestGoal.type !== 'rendezvous' || bestGoal.targetId !== currentGoal.targetId) {
            return true;
        }
    }

    // clear_corridor should never be preempted except by admin commands.
    if (currentGoal.type === 'clear_corridor') {
        return false;
    }

    // Cooperative contracts (e.g. rendezvous drop) always preempt normal tasks.
    const hasCoop = Array.from(beliefs.activeContracts.values()).some(
        c => c.coopId !== 'admin_move' && c.coopId !== 'admin_pickup' && c.coopId !== 'admin_deliver'
    );
    if (hasCoop && currentGoal.type !== 'rendezvous' && currentGoal.type !== 'handoff') {
        return true;
    }

    // deliveries preempt everything except active deliveries.
    if (bestGoal.type === 'deliver' && currentGoal.type !== 'deliver') {
        return true;
    }

    // If we are currently delivering, allow pickup to preempt (e.g. for along-the-path detours).
    if (currentGoal.type === 'deliver' && bestGoal.type === 'pickup') {
        return true;
    }

    // pickups preempt patrols.
    if (bestGoal.type === 'pickup' && 
        (currentGoal.type === 'patrol' || currentGoal.type === 'patrol_spawn')) {
        return true;
    }

    // If target parcel changed (and we're not in delivery phase).
    if (bestGoal.type === 'pickup' && currentGoal.type === 'pickup' && bestGoal.targetId !== currentGoal.targetId) {
        return true;
    }

    return false;
}
