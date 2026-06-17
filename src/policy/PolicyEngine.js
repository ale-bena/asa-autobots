/**
 * @module policy/PolicyEngine
 * @description Safe Abstract Syntax Tree (AST) expression parser and interpreter
 * for dynamic Level 2/3 rules and special mission behaviors.
 */

/**
 * Tokenizes a string expression.
 * @param {string} expr - The string expression to tokenize.
 * @returns {Array<string>} Array of tokens.
 */
function tokenize(expr) {
    const regex = /\s*(&&|\|\||==|!=|<=|>=|[+\-*/%()<>!]|(?:[a-zA-Z_$][a-zA-Z0-9_$.]*)|(?:\d+(?:\.\d+)?))\s*/g;
    const tokens = [];
    let match;
    while ((match = regex.exec(expr)) !== null) {
        if (match[1]) tokens.push(match[1]);
    }
    return tokens;
}

/**
 * Safely resolves an identifier value within the agent state scope.
 * @param {string} name - Identifier name (e.g. "x", "carrying.size").
 * @param {Object} state - The agent state object.
 * @param {Object} [localVars={}] - Contextual overrides (e.g. { reward: 10 }).
 * @returns {any} Resolved value or 0 if undefined.
 */
function resolveIdentifier(name, state, localVars = {}) {
    if (localVars[name] !== undefined) {
        return localVars[name];
    }
    if (state.variables && state.variables[name] !== undefined) {
        return state.variables[name];
    }

    const beliefs = state.beliefs || state;

    switch (name) {
        case 'x':
            return beliefs.me ? beliefs.me.x : 0;
        case 'y':
            return beliefs.me ? beliefs.me.y : 0;
        case 'score':
            return beliefs.me ? beliefs.me.score : 0;
        case 'carrying.size':
        case 'carrying.length':
        case 'stack_size':
            return beliefs.carried ? beliefs.carried.length : 0;
        default:
            return 0;
    }
}

/**
 * Safe math and logical expression parser using the Shunting-Yard algorithm.
 * @param {string} expr - String expression (e.g., "carrying.size == 3 && score < 200").
 * @param {Object} state - Agent state context.
 * @param {Object} [localVars={}] - Local variables override.
 * @returns {any} Evaluated result (number, boolean, or string).
 */
export function evaluateExpression(expr, state, localVars = {}) {
    if (!expr || expr.trim() === '') return true;

    const tokens = tokenize(expr);
    if (tokens.length === 0) return true;

    const values = [];
    const operators = [];

    const precedence = {
        '||': 1,
        '&&': 2,
        '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
        '+': 4, '-': 4,
        '*': 5, '/': 5, '%': 5,
        'unary-': 6,
        '!': 6
    };

    /**
     * Applies the operator at the top of the stack to the value stack.
     */
    function applyOperator() {
        const op = operators.pop();
        if (op === '!') {
            const val = values.pop();
            values.push(!val);
            return;
        }
        if (op === 'unary-') {
            const val = values.pop();
            values.push(-Number(val));
            return;
        }

        const right = values.pop();
        const left = values.pop();

        switch (op) {
            case '+': values.push(Number(left) + Number(right)); break;
            case '-': values.push(Number(left) - Number(right)); break;
            case '*': values.push(Number(left) * Number(right)); break;
            case '/': values.push(Number(left) / Number(right)); break;
            case '%': values.push(Number(left) % Number(right)); break;
            case '==': values.push(left == right); break;
            case '!=': values.push(left != right); break;
            case '<': values.push(left < right); break;
            case '>': values.push(left > right); break;
            case '<=': values.push(left <= right); break;
            case '>=': values.push(left >= right); break;
            case '&&': values.push(left && right); break;
            case '||': values.push(left || right); break;
        }
    }

    let prevToken = null;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token === '(') {
            operators.push(token);
        } else if (token === ')') {
            while (operators.length > 0 && operators[operators.length - 1] !== '(') {
                applyOperator();
            }
            operators.pop(); // remove '('
        } else if (precedence[token] !== undefined) {
            let actualOp = token;
            if (token === '-') {
                const isUnary = (prevToken === null || prevToken === '(' || precedence[prevToken] !== undefined);
                if (isUnary) {
                    actualOp = 'unary-';
                }
            }
            while (operators.length > 0 &&
                precedence[operators[operators.length - 1]] >= precedence[actualOp]) {
                applyOperator();
            }
            operators.push(actualOp);
        } else {
            // Number literal, String literal, or Identifier
            if (!isNaN(token)) {
                values.push(Number(token));
            } else if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
                values.push(token.substring(1, token.length - 1));
            } else if (token === 'true') {
                values.push(true);
            } else if (token === 'false') {
                values.push(false);
            } else {
                values.push(resolveIdentifier(token, state, localVars));
            }
        }
        prevToken = token;
    }

    while (operators.length > 0) {
        applyOperator();
    }

    return values[0];
}

/**
 * Evaluates policy rules (multipliers, bonuses) for a projected delivery.
 * @param {Object} beliefs - Current agent beliefs.
 * @param {number} baseReward - The base reward before modifications.
 * @param {Object} projectedState - Mock state representing delivery conditions.
 * @returns {number} The policy-adjusted reward.
 */
export function evaluatePolicyReward(beliefs, baseReward, projectedState) {
    let reward = baseReward;

    const state = projectedState || {};
    const x = state.x !== undefined ? state.x : (beliefs && beliefs.me ? beliefs.me.x : 0);
    const y = state.y !== undefined ? state.y : (beliefs && beliefs.me ? beliefs.me.y : 0);
    const stackSize = state.carriedSize !== undefined ? state.carriedSize : (beliefs && beliefs.carried ? beliefs.carried.length : 0);
    const parcel = state.parcel || null;

    if (beliefs && beliefs.policyRules && beliefs.policyRules.rules) {
        for (const rule of beliefs.policyRules.rules) {
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
            if (applies) {
                const parcelReward = (parcel && parcel.reward !== undefined) ? parcel.reward : null;

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
                if (rule.multiplier !== null && rule.multiplier !== undefined) {
                    reward *= rule.multiplier;
                }
                if (rule.bonus !== null && rule.bonus !== undefined) {
                    reward += rule.bonus;
                }
            }
        }
    }

    return reward;
}

/**
 * Calculates the wait time (in milliseconds) needed for a parcel's reward to decay
 * to a value that yields a positive policy reward.
 * @param {Object} beliefs - Current agent beliefs.
 * @param {number} currentReward - Current raw reward of the parcel.
 * @param {number} carriedSize - Projected stack size at delivery.
 * @param {number} x - Target delivery X coordinate.
 * @param {number} y - Target delivery Y coordinate.
 * @param {Object} parcel - The parcel object.
 * @returns {number} The wait time in milliseconds, or 0 if no wait is needed or waiting doesn't help.
 */
export function getWaitDecayTimeForValue(beliefs, currentReward, carriedSize, x, y, parcel) {
    if (!beliefs) return 0;
    const decayMs = beliefs.parcelDecayIntervalMs;
    if (!isFinite(decayMs) || decayMs <= 0) return 0;

    const currentPolicyReward = evaluatePolicyReward(beliefs, currentReward, {
        carriedSize,
        x,
        y,
        parcel: { ...parcel, reward: currentReward }
    });

    if (currentPolicyReward > 0) {
        return 0; // Already positive, no wait needed
    }

    // Scan downwards to find if any decayed reward is allowed
    for (let r = Math.floor(currentReward) - 1; r > 0; r--) {
        const testPolicyReward = evaluatePolicyReward(beliefs, r, {
            carriedSize,
            x,
            y,
            parcel: { ...parcel, reward: r }
        });
        if (testPolicyReward > 0) {
            const pointsToDecay = currentReward - r;
            return pointsToDecay * decayMs;
        }
    }

    return 0;
}

