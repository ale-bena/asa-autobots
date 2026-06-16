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
 * Helper to estimate the maximum policy-adjusted reward a parcel can yield
 * if allowed to decay further from its current reward.
 */
function getParcelPotentialValue(beliefs, currentReward, x, y, cp) {
    if (!beliefs || !beliefs.policyRules) {
        return currentReward;
    }
    const policyReward = evaluatePolicyReward(beliefs, currentReward, {
        carriedSize: 1,
        x,
        y,
        parcel: { ...cp, reward: currentReward }
    });
    if (policyReward > 0) {
        return policyReward;
    }
    const decayMs = beliefs.parcelDecayIntervalMs;
    if (isFinite(decayMs) && decayMs > 0) {
        for (let r = Math.floor(currentReward) - 1; r > 0; r--) {
            const testReward = evaluatePolicyReward(beliefs, r, {
                carriedSize: 1,
                x,
                y,
                parcel: { ...cp, reward: r }
            });
            if (testReward > 0) {
                return testReward;
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

        for (const cp of carriedParcels) {
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

    // Helper to generate all subsets (power set) of carriedParcels.
    const getAllSubsets = (arr) => {
        return arr.reduce((subsets, value) => subsets.concat(subsets.map(set => [value, ...set])), [[]]);
    };

    // 3. Adaptive subset generation.
    let subsets;
    if (carriedParcels.length <= 6) {
        subsets = getAllSubsets(carriedParcels);
    } else {
        // Limit subset evaluation to prevent combinatorial explosion.
        const relevantSizes = new Set([carriedParcels.length]);
        if (beliefs.policyRules) {
            if (beliefs.policyRules.requiredStackSize) {
                relevantSizes.add(beliefs.policyRules.requiredStackSize);
            }
            if (beliefs.policyRules.rules) {
                for (const rule of beliefs.policyRules.rules) {
                    if (rule.stackSizeBounds) {
                        for (const b of rule.stackSizeBounds) {
                            if (b.min !== null && b.min !== undefined && b.min <= carriedParcels.length) {
                                relevantSizes.add(b.min);
                            }
                            if (b.max !== null && b.max !== undefined && b.max - 1 <= carriedParcels.length) {
                                relevantSizes.add(b.max - 1);
                            }
                        }
                    }
                }
            }
        }

        const sortedParcels = [...carriedParcels].sort((a, b) => (b.reward || 0) - (a.reward || 0));
        subsets = [[]]; // Always include the empty set.
        for (const size of relevantSizes) {
            if (size > 0 && size <= sortedParcels.length) {
                subsets.push(sortedParcels.slice(0, size));
            }
        }
        const positiveParcels = sortedParcels.filter(p => (p.reward || 0) > 0);
        if (positiveParcels.length > 0 && positiveParcels.length !== sortedParcels.length) {
            subsets.push(positiveParcels);
        }
    }

    logger.optimizer(`Adaptive subset generator selected ${subsets.length} candidate subsets out of ${Math.pow(2, carriedParcels.length)} possibilities.`);

    let bestSubset = [];
    let bestWaitMs = 0;
    let bestReward = -Infinity;
    let bestScore = -Infinity;

    // 4. Evaluate each subset at each candidate wait time.
    for (const subset of subsets) {
        const subsetIds = subset.map(p => p.id);
        const keptParcels = carriedParcels.filter(p => !subsetIds.includes(p.id));

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

            if (score > bestScore || (score === bestScore && subset.length > bestSubset.length)) {
                bestScore = score;
                bestReward = deliveredReward;
                bestSubset = subset;
                bestWaitMs = t;
            }
        }
    }

    logger.optimizer(`Optimization complete. Best reward: ${bestReward.toFixed(1)} (wait ${bestWaitMs.toFixed(0)}ms) for subset [${bestSubset.map(p => `${p.id}(val:${p.reward.toFixed(1)})`).join(', ')}]`);

    const isUseless = (p) => {
        let maxCap = 10;
        if (beliefs && beliefs.config && beliefs.config.GAME && beliefs.config.GAME.player && beliefs.config.GAME.player.capacity) {
            maxCap = beliefs.config.GAME.player.capacity;
        }
        for (let s = 1; s <= maxCap; s++) {
            const currentPolicyReward = evaluatePolicyReward(beliefs, p.reward, {
                carriedSize: s,
                x,
                y,
                parcel: p
            });
            if (currentPolicyReward > 0) return false;
            const canDecay = getWaitDecayTimeForValue(beliefs, p.reward, s, x, y, p) > 0;
            if (canDecay) return false;
        }
        return true;
    };

    // Only fall back to discard if no subset was selected at all.
    // A 0-reward subset is still worth delivering (costs nothing at the delivery zone).
    if (bestSubset.length === 0) {
        const uselessParcels = carriedParcels.filter(isUseless);
        logger.optimizer(`Best reward is <= 0. Discarding ${uselessParcels.length} useless parcels.`);
        return {
            bestSubset: [],
            bestWaitMs: 0,
            bestReward: 0,
            discardSubset: uselessParcels.map(p => p.id)
        };
    }

    const bestSubsetIds = bestSubset.map(p => p.id);
    const discardSubsetIds = carriedParcels
        .filter(p => !bestSubsetIds.includes(p.id) && isUseless(p))
        .map(p => p.id);

    return {
        bestSubset: bestSubsetIds,
        bestWaitMs: bestWaitMs,
        bestReward: bestReward,
        discardSubset: discardSubsetIds
    };
}
