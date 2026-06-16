/**
 * @module policy/DeliveryOptimizer
 * @description Computes the optimal subset of cargo to deliver and wait time
 * at the delivery zone to maximize policy-adjusted rewards.
 */

import { evaluatePolicyReward, getWaitDecayTimeForValue } from './PolicyEngine.js';
import { logger } from '../utils/logger.js';

const KEPT_DISCOUNT_FACTOR = 0.5;
const WAITING_PENALTY_COEFFICIENT = 0.2; // penalty points per decay interval of waiting

/**
 * Helper to check if a strict cannot deliver rule applies to a projected state.
 * A rule is a strict cannot deliver constraint if its multiplier is 0,
 * or if it applies a negative bonus whose magnitude is >= capacity * 20.
 */
export function hasStrictCannotDeliverRule(beliefs, stackSize, x, y, parcel = null) {
    if (!beliefs || !beliefs.policyRules || !beliefs.policyRules.rules) {
        return false;
    }

    let maxCap = 10;
    if (beliefs.config && beliefs.config.GAME && beliefs.config.GAME.player && beliefs.config.GAME.player.capacity) {
        maxCap = beliefs.config.GAME.player.capacity;
    }
    const maxRawRewardOfStack = maxCap * 20;

    for (const rule of beliefs.policyRules.rules) {
        if (!rule) continue;

        const isStrict = (rule.multiplier === 0) || 
                         (rule.bonus !== null && rule.bonus !== undefined && rule.bonus <= -maxRawRewardOfStack);

        if (!isStrict) continue;

        let applies = true;

        // 1. Check coordinates (tiles)
        if (rule.all_tiles === false) {
            if (!rule.tiles || rule.tiles.length === 0) {
                applies = false;
            } else {
                const coordStr = `${x},${y}`;
                if (!rule.tiles.includes(coordStr)) {
                    applies = false;
                }
            }
        }

        // 2. Check stack size bounds
        if (applies && rule.stackSizeBounds && rule.stackSizeBounds.length > 0) {
            const matchesAnyBound = rule.stackSizeBounds.some(b => {
                const minOk = (b.min === null || b.min === undefined || stackSize >= b.min);
                const maxOk = (b.max === null || b.max === undefined || stackSize < b.max);
                return minOk && maxOk;
            });
            if (!matchesAnyBound) {
                applies = false;
            }
        }

        // 3. Check reward bounds (same semantics as stackSizeBounds: min inclusive, max exclusive)
        if (applies && parcel) {
            const parcelReward = (parcel.reward !== undefined) ? parcel.reward : null;

            // Check direct minReward and maxReward properties
            if (parcelReward === null) {
                if ((rule.minReward !== null && rule.minReward !== undefined) ||
                    (rule.maxReward !== null && rule.maxReward !== undefined)) {
                    applies = false;
                }
            } else {
                if (rule.minReward !== null && rule.minReward !== undefined && parcelReward < rule.minReward) {
                    applies = false;
                }
                if (rule.maxReward !== null && rule.maxReward !== undefined && parcelReward >= rule.maxReward) {
                    applies = false;
                }
            }

            // Check rewardBounds array (backward compatibility)
            if (applies && rule.rewardBounds && rule.rewardBounds.length > 0) {
                if (parcelReward === null) {
                    applies = false;
                } else {
                    const matchesAnyBound = rule.rewardBounds.some(b => {
                        const minOk = (b.min === null || b.min === undefined || parcelReward >= b.min);
                        const maxOk = (b.max === null || b.max === undefined || parcelReward < b.max);
                        return minOk && maxOk;
                    });
                    if (!matchesAnyBound) {
                        applies = false;
                    }
                }
            }
        }

        if (applies) {
            return true;
        }
    }

    return false;
}

/**
 * Helper to estimate the maximum policy-adjusted reward a parcel can yield
 * if allowed to decay further from its current reward.
 */
function getParcelPotentialValue(beliefs, currentReward, x, y, cp) {
    if (!beliefs || !beliefs.policyRules || !beliefs.policyRules.rules || beliefs.policyRules.rules.length === 0) {
        return currentReward;
    }
    
    let maxCap = 10;
    if (beliefs.config && beliefs.config.GAME && beliefs.config.GAME.player && beliefs.config.GAME.player.capacity) {
        maxCap = beliefs.config.GAME.player.capacity;
    }

    let maxVal = 0;
    for (let s = 1; s <= maxCap; s++) {
        const policyReward = evaluatePolicyReward(beliefs, currentReward, {
            carriedSize: s,
            x,
            y,
            parcel: { ...cp, reward: currentReward }
        });
        if (policyReward > maxVal) {
            maxVal = policyReward;
        }
    }
    if (maxVal > 0) {
        return maxVal;
    }

    const decayMs = beliefs.parcelDecayIntervalMs;
    if (isFinite(decayMs) && decayMs > 0) {
        for (let r = Math.floor(currentReward) - 1; r > 0; r--) {
            for (let s = 1; s <= maxCap; s++) {
                const testReward = evaluatePolicyReward(beliefs, r, {
                    carriedSize: s,
                    x,
                    y,
                    parcel: { ...cp, reward: r }
                });
                if (testReward > maxVal) {
                    maxVal = testReward;
                }
            }
            if (maxVal > 0) {
                return maxVal;
            }
        }
    }
    return 0;
}

/**
 * Optimizes the delivery of carried parcels by selecting the best subset and wait time.
 * 
 * @param {Object} beliefs - The agent's beliefs.
 * @param {Array<Object>} carriedParcels - Array of carried parcel objects (each having at least `id` and `reward`).
 * @param {number} x - Delivery tile X coordinate.
 * @param {number} y - Delivery tile Y coordinate.
 * @param {number|null} [forcedStackSize=null] - Overrides the stack size for policy reward evaluation.
 * @returns {{bestSubset: Array<string>, bestWaitMs: number, bestReward: number, discardSubset: Array<string>}} Optimal delivery plan.
 */
export function optimizeDeliveryStack(beliefs, carriedParcels, x, y, forcedStackSize = null) {
    if (!carriedParcels || carriedParcels.length === 0) {
        return { bestSubset: [], bestWaitMs: 0, bestReward: 0, discardSubset: [] };
    }

    if (!beliefs || !beliefs.policyRules || !beliefs.policyRules.rules || beliefs.policyRules.rules.length === 0) {
        // No policy rules are active. Directly deliver all carried parcels at once.
        const bestSubset = carriedParcels.map(p => p.id);
        const bestReward = carriedParcels.reduce((sum, p) => sum + (p.reward || 0), 0);
        return {
            bestSubset,
            bestWaitMs: 0,
            bestReward,
            discardSubset: []
        };
    }

    const isUseless = (p) => {
        let maxCap = 10;
        if (beliefs && beliefs.config && beliefs.config.GAME && beliefs.config.GAME.player && beliefs.config.GAME.player.capacity) {
            maxCap = beliefs.config.GAME.player.capacity;
        }
        for (let s = 1; s <= maxCap; s++) {
            const isStrictCannot = hasStrictCannotDeliverRule(beliefs, s, x, y, p);
            if (!isStrictCannot) return false;

            const canDecay = getWaitDecayTimeForValue(beliefs, p.reward, s, x, y, p) > 0;
            if (canDecay) return false;
        }
        return true;
    };

    const uselessParcels = carriedParcels.filter(isUseless);
    const usefulParcels = carriedParcels.filter(p => !uselessParcels.includes(p));

    if (usefulParcels.length === 0) {
        return {
            bestSubset: [],
            bestWaitMs: 0,
            bestReward: 0,
            discardSubset: uselessParcels.map(p => p.id)
        };
    }

    const decayMs = beliefs.parcelDecayIntervalMs;
    const decayEnabled = isFinite(decayMs) && decayMs > 0;

    // 1. Check if policy rules contain any reward-based constraints.
    let hasRewardConstraints = false;
    if (beliefs && beliefs.policyRules) {
        if (beliefs.policyRules.maxRewardLimit !== null && 
            beliefs.policyRules.maxRewardLimit !== undefined && 
            beliefs.policyRules.maxRewardLimit !== Infinity) {
            hasRewardConstraints = true;
        }
        if (beliefs.policyRules.minRewardThreshold !== null && 
            beliefs.policyRules.minRewardThreshold !== undefined && 
            beliefs.policyRules.minRewardThreshold > 0) {
            hasRewardConstraints = true;
        }
        if (beliefs.policyRules.rules) {
            for (const rule of beliefs.policyRules.rules) {
                if (rule.rewardBounds && rule.rewardBounds.length > 0) {
                    hasRewardConstraints = true;
                    break;
                }
                if ((rule.minReward !== null && rule.minReward !== undefined) || 
                    (rule.maxReward !== null && rule.maxReward !== undefined)) {
                    hasRewardConstraints = true;
                    break;
                }
            }
        }
    }

    // 2. Generate candidate wait times by extracting rule boundaries.
    const candidateWaitTimes = [0];
    const boundaries = new Set();
    
    if (decayEnabled) {
        if (beliefs && beliefs.policyRules) {
            if (beliefs.policyRules.maxRewardLimit !== null && 
                beliefs.policyRules.maxRewardLimit !== undefined && 
                beliefs.policyRules.maxRewardLimit !== Infinity) {
                boundaries.add(beliefs.policyRules.maxRewardLimit);
            }
            if (beliefs.policyRules.minRewardThreshold !== null && 
                beliefs.policyRules.minRewardThreshold !== undefined && 
                beliefs.policyRules.minRewardThreshold > 0) {
                boundaries.add(beliefs.policyRules.minRewardThreshold);
            }
            if (beliefs.policyRules.rules) {
                for (const rule of beliefs.policyRules.rules) {
                    if (rule.rewardBounds) {
                        for (const b of rule.rewardBounds) {
                            if (b.min !== null && b.min !== undefined) boundaries.add(b.min);
                            if (b.max !== null && b.max !== undefined) boundaries.add(b.max);
                        }
                    }
                    if (rule.minReward !== null && rule.minReward !== undefined) {
                        boundaries.add(rule.minReward);
                    }
                    if (rule.maxReward !== null && rule.maxReward !== undefined) {
                        boundaries.add(rule.maxReward);
                    }
                }
            }
        }

        // Target values: boundary itself, and slightly below it (to exit range checking)
        const targetValues = new Set();
        for (const b of boundaries) {
            targetValues.add(b);
            if (b > 0) {
                targetValues.add(b - 1);
                targetValues.add(b - 0.1);
            }
        }

        for (const cp of usefulParcels) {
            const currentReward = cp.reward || 0;
            for (const v of targetValues) {
                if (currentReward > v) {
                    const t = (currentReward - v) * decayMs;
                    if (t > 0) {
                        candidateWaitTimes.push(t);
                    }
                }
            }
        }
    }

    // De-duplicate and sort wait times.
    candidateWaitTimes.sort((a, b) => a - b);
    const uniqueWaitTimes = [];
    for (const t of candidateWaitTimes) {
        if (uniqueWaitTimes.length === 0 || t - uniqueWaitTimes[uniqueWaitTimes.length - 1] > 1e-3) {
            uniqueWaitTimes.push(t);
        }
    }

    logger.optimizer(`Extracted boundaries: [${Array.from(boundaries).join(', ')}]`);
    logger.optimizer(`Candidate wait times (ms): [${uniqueWaitTimes.map(t => t.toFixed(0)).join(', ')}]`);

    // Helper to generate all subsets (power set) of usefulParcels.
    const getAllSubsets = (arr) => {
        return arr.reduce((subsets, value) => subsets.concat(subsets.map(set => [value, ...set])), [[]]);
    };

    // 3. Adaptive subset generation.
    let subsets;
    if (usefulParcels.length <= 6) {
        subsets = getAllSubsets(usefulParcels);
    } else {
        // Limit subset evaluation to prevent combinatorial explosion.
        const sortedParcelsByPolicy = [...usefulParcels].sort((a, b) => {
            const rewardA = evaluatePolicyReward(beliefs, a.reward, { carriedSize: usefulParcels.length, x, y, parcel: a });
            const rewardB = evaluatePolicyReward(beliefs, b.reward, { carriedSize: usefulParcels.length, x, y, parcel: b });
            return rewardB - rewardA;
        });

        const sortedParcelsByRaw = [...usefulParcels].sort((a, b) => (b.reward || 0) - (a.reward || 0));

        subsets = [[]]; // Always include the empty set.
        
        // Add prefixes of policy-sorted list
        for (let size = 1; size <= sortedParcelsByPolicy.length; size++) {
            subsets.push(sortedParcelsByPolicy.slice(0, size));
        }
        
        // Add prefixes of raw-sorted list if they are different from policy-sorted prefixes
        for (let size = 1; size <= sortedParcelsByRaw.length; size++) {
            const subsetRaw = sortedParcelsByRaw.slice(0, size);
            const exists = subsets.some(s => {
                if (s.length !== subsetRaw.length) return false;
                const sIds = s.map(p => p.id);
                return subsetRaw.every(p => sIds.includes(p.id));
            });
            if (!exists) {
                subsets.push(subsetRaw);
            }
        }
    }

    logger.optimizer(`Adaptive subset generator selected ${subsets.length} candidate subsets out of ${Math.pow(2, usefulParcels.length)} possibilities.`);

    let bestSubset = [];
    let bestWaitMs = 0;
    let bestReward = -Infinity;
    let bestScore = -Infinity;

    let bestNonEmptySubset = null;
    let bestNonEmptyWaitMs = 0;
    let bestNonEmptyReward = -Infinity;
    let bestNonEmptyScore = -Infinity;

    // 4. Evaluate each subset at each candidate wait time.
    for (const subset of subsets) {
        const subsetIds = subset.map(p => p.id);
        const keptParcels = usefulParcels.filter(p => !subsetIds.includes(p.id));

        for (const t of uniqueWaitTimes) {
            let deliveredReward = 0;
            if (subset.length > 0) {
                for (const cp of subset) {
                    const decayedReward = decayEnabled ? Math.max(0, (cp.reward || 0) - (t / decayMs)) : (cp.reward || 0);
                    // Crucial: Pass a cloned parcel object with the decayed reward, so evaluatePolicyReward
                    // matches constraints against the decayed reward instead of the undecayed original.
                    const r = evaluatePolicyReward(beliefs, decayedReward, {
                        carriedSize: forcedStackSize !== null ? forcedStackSize : subset.length,
                        x,
                        y,
                        parcel: { ...cp, reward: decayedReward }
                    });
                    deliveredReward += r;
                }
            }

            // Calculate kept value
            let keptValue = 0;
            if (keptParcels.length > 0) {
                for (const cp of keptParcels) {
                    const decayedReward = decayEnabled ? Math.max(0, (cp.reward || 0) - (t / decayMs)) : (cp.reward || 0);
                    const potentialVal = getParcelPotentialValue(beliefs, decayedReward, x, y, cp);
                    keptValue += potentialVal;
                }
            }

            // Calculate waiting penalty
            const waitingPenalty = decayEnabled ? (t / decayMs) * WAITING_PENALTY_COEFFICIENT : 0;

            const score = deliveredReward + KEPT_DISCOUNT_FACTOR * keptValue - waitingPenalty;

            const scoreDiff = score - bestScore;
            if (scoreDiff > 1e-5 || (Math.abs(scoreDiff) <= 1e-5 && subset.length > bestSubset.length)) {
                bestScore = score;
                bestReward = deliveredReward;
                bestSubset = subset;
                bestWaitMs = t;
            }

            if (subset.length > 0) {
                const isBetterNonEmpty = (bestNonEmptySubset === null) ||
                    (deliveredReward > bestNonEmptyReward) ||
                    (deliveredReward === bestNonEmptyReward && subset.length > bestNonEmptySubset.length) ||
                    (deliveredReward === bestNonEmptyReward && subset.length === bestNonEmptySubset.length && score > bestNonEmptyScore);
                
                if (isBetterNonEmpty) {
                    bestNonEmptySubset = subset;
                    bestNonEmptyWaitMs = t;
                    bestNonEmptyReward = deliveredReward;
                    bestNonEmptyScore = score;
                }
            }
        }
    }

    logger.optimizer(`Optimization complete. Best reward: ${bestReward.toFixed(1)} (wait ${bestWaitMs.toFixed(0)}ms) for subset [${bestSubset.map(p => `${p.id}(val:${p.reward.toFixed(1)})`).join(', ')}]`);

    // If all non-empty subsets result in a penalty (deliveredReward <= 0),
    // and the empty subset was chosen, override it with the best non-empty subset
    // only if it is not a strict "cannot deliver" constraint.
    let isStrictCannotDeliver = false;
    if (bestNonEmptySubset !== null) {
        if (hasStrictCannotDeliverRule(beliefs, bestNonEmptySubset.length, x, y)) {
            isStrictCannotDeliver = true;
        } else {
            for (const p of bestNonEmptySubset) {
                if (hasStrictCannotDeliverRule(beliefs, bestNonEmptySubset.length, x, y, p)) {
                    isStrictCannotDeliver = true;
                    break;
                }
            }
        }
    }
    if (bestSubset.length === 0 && bestNonEmptySubset !== null && !isStrictCannotDeliver) {
        logger.optimizer(`No ways to deliver without a penalty. Choosing best non-empty subset to minimize penalty.`);
        bestSubset = bestNonEmptySubset;
        bestWaitMs = bestNonEmptyWaitMs;
        bestReward = bestNonEmptyReward;
    }

    // Only fall back to discard if no subset was selected at all.
    // A 0-reward subset is still worth delivering (costs nothing at the delivery zone).
    if (bestSubset.length === 0) {
        logger.optimizer(`Best reward is <= 0. Discarding ${uselessParcels.length} useless parcels.`);
        return {
            bestSubset: [],
            bestWaitMs: 0,
            bestReward: 0,
            discardSubset: uselessParcels.map(p => p.id)
        };
    }

    const bestSubsetIds = bestSubset.map(p => p.id);
    const discardSubsetIds = [
        ...uselessParcels.map(p => p.id),
        ...usefulParcels.filter(p => !bestSubsetIds.includes(p.id) && isUseless(p)).map(p => p.id)
    ];

    return {
        bestSubset: bestSubsetIds,
        bestWaitMs: bestWaitMs,
        bestReward: bestReward,
        discardSubset: discardSubsetIds
    };
}
