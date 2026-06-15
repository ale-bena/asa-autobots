import { test, describe } from 'node:test';
import assert from 'node:assert';
import { evaluateExpression, evaluatePolicyReward } from '../src/policy/PolicyEngine.js';
import { BeliefBase } from '../src/agent/BeliefBase.js';

describe('PolicyEngine tests', () => {
    describe('evaluateExpression tests', () => {
        test('empty or whitespace expression', () => {
            assert.strictEqual(evaluateExpression(''), true);
            assert.strictEqual(evaluateExpression('   '), true);
            assert.strictEqual(evaluateExpression(null), true);
        });

        test('literal values', () => {
            const state = { variables: {}, beliefs: {} };
            assert.strictEqual(evaluateExpression('true', state), true);
            assert.strictEqual(evaluateExpression('false', state), false);
            assert.strictEqual(evaluateExpression('123', state), 123);
        });

        test('basic math operators', () => {
            const state = { variables: {}, beliefs: {} };
            assert.strictEqual(evaluateExpression('2 + 3 * 4', state), 14);
            assert.strictEqual(evaluateExpression('(2 + 3) * 4', state), 20);
            assert.strictEqual(evaluateExpression('10 - 4 - 2', state), 4);
            assert.strictEqual(evaluateExpression('10 / 2', state), 5);
            assert.strictEqual(evaluateExpression('10 % 3', state), 1);
        });

        test('unary operators', () => {
            const state = { variables: {}, beliefs: {} };
            assert.strictEqual(evaluateExpression('-5', state), -5);
            assert.strictEqual(evaluateExpression('- (2 + 3)', state), -5);
            assert.strictEqual(evaluateExpression('!true', state), false);
            assert.strictEqual(evaluateExpression('!false', state), true);
        });

        test('comparisons and logic', () => {
            const state = { variables: {}, beliefs: {} };
            assert.strictEqual(evaluateExpression('5 > 3', state), true);
            assert.strictEqual(evaluateExpression('5 >= 5', state), true);
            assert.strictEqual(evaluateExpression('5 < 3', state), false);
            assert.strictEqual(evaluateExpression('5 <= 4', state), false);
            assert.strictEqual(evaluateExpression('5 == 5', state), true);
            assert.strictEqual(evaluateExpression('5 != 6', state), true);
            assert.strictEqual(evaluateExpression('true && false', state), false);
            assert.strictEqual(evaluateExpression('true || false', state), true);
            assert.strictEqual(evaluateExpression('true && 5 > 2', state), true);
        });

        test('state variable resolution', () => {
            const state = {
                variables: {
                    myVar: 42,
                    another: 10
                },
                beliefs: {
                    me: { x: 5, y: 10, score: 500 },
                    carried: ['p1', 'p2']
                }
            };

            assert.strictEqual(evaluateExpression('myVar == 42', state), true);
            assert.strictEqual(evaluateExpression('another == 10', state), true);
            assert.strictEqual(evaluateExpression('x == 5', state), true);
            assert.strictEqual(evaluateExpression('y == 10', state), true);
            assert.strictEqual(evaluateExpression('score > 400', state), true);
            assert.strictEqual(evaluateExpression('carrying.size == 2', state), true);
            assert.strictEqual(evaluateExpression('carrying.length == 2', state), true);
            assert.strictEqual(evaluateExpression('stack_size == 2', state), true);
            
            // Nested resolution check
            assert.strictEqual(evaluateExpression('me.score == 500', state), true);
            assert.strictEqual(evaluateExpression('nonexistent.val == 0', state), true); // returns 0
        });

        test('parcel variables resolution', () => {
            const state = {
                beliefs: {
                    me: { id: 'me_agent' },
                    parcelHistory: new Map([
                        ['parcel_1', new Set(['other_agent', 'me_agent'])]
                    ])
                }
            };
            const localVars = {
                parcel: { id: 'parcel_1', reward: 100 }
            };

            assert.strictEqual(evaluateExpression('parcel.reward == 100', state, localVars), true);
            assert.strictEqual(evaluateExpression('parcel.previouslyCarriedByOther', state, localVars), true);

            // Parcel not previously carried by other
            const stateNoOther = {
                beliefs: {
                    me: { id: 'me_agent' },
                    parcelHistory: new Map([
                        ['parcel_2', new Set(['me_agent'])]
                    ])
                }
            };
            const localNoOther = { parcel: { id: 'parcel_2', reward: 50 } };
            assert.strictEqual(evaluateExpression('parcel.previouslyCarriedByOther', stateNoOther, localNoOther), false);
        });

        test('path traverses identifier', () => {
            const state = {
                path: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }]
            };
            assert.strictEqual(evaluateExpression('path.traverses_1_2', state), true);
            assert.strictEqual(evaluateExpression('path.traverses_1_3', state), false);
            assert.strictEqual(evaluateExpression('path.traverses_invalid_format', state), false);
        });
    });

    describe('evaluatePolicyReward tests', () => {
        test('evaluatePolicyReward with empty policies', () => {
            const beliefs = new BeliefBase();
            assert.strictEqual(evaluatePolicyReward(beliefs, 10, {}), 10);
        });

        test('evaluatePolicyReward with active policy rules', () => {
            const beliefs = new BeliefBase();
            beliefs.policyRules = {
                rules: [
                    // Rule 1: tile matching multiplier
                    {
                        all_tiles: false,
                        tiles: ['1,1', '1,2'],
                        multiplier: 2.0,
                        bonus: 10
                    },
                    // Rule 2: stack size bounds
                    {
                        all_tiles: true,
                        stackSizeBounds: [{ min: 3, max: 6 }],
                        multiplier: 1.5
                    },
                    // Rule 3: reward bounds
                    {
                        all_tiles: true,
                        minReward: 50,
                        maxReward: 150,
                        bonus: 5
                    }
                ]
            };

            // Meets Rule 1 (tile matches 1,1) -> 10 * 2.0 + 10 = 30
            // Does not meet Rule 2 (stack size is 2)
            // Meets Rule 3 (parcel reward is 100) -> 30 + 5 = 35
            const stateMatch = {
                x: 1, y: 1,
                carriedSize: 2,
                parcel: { reward: 100 }
            };
            assert.strictEqual(evaluatePolicyReward(beliefs, 10, stateMatch), 35);

            // Outside Rule 1 tile list
            // Meets Rule 2 (stack size is 3) -> 10 * 1.5 = 15
            // Outside Rule 3 reward bound (parcel reward 200 >= 150) -> remains 15
            const stateOutside = {
                x: 2, y: 2,
                carriedSize: 3,
                parcel: { reward: 200 }
            };
            assert.strictEqual(evaluatePolicyReward(beliefs, 10, stateOutside), 15);
        });
    });
});
