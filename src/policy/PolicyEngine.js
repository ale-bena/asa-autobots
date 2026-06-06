/**
 * @module policy/PolicyEngine
 * @description Safe Abstract Syntax Tree (AST) expression parser and interpreter
 * for dynamic Level 2/3 rules and Turing-complete special mission behaviors.
 */

/**
 * Tokenizes a string expression.
 * @param {string} expr - The string expression to tokenize.
 * @returns {Array<string>} Array of tokens.
 */
function tokenize(expr) {
    const regex = /\s*(&&|\|\||==|!=|<=|>=|[+\-*/()<>!]|(?:[a-zA-Z_$][a-zA-Z0-9_$.]*)|(?:\d+(?:\.\d+)?))\s*/g;
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
            // Resolve nested properties if any (e.g. me.x)
            if (name.includes('.')) {
                const parts = name.split('.');
                let val = beliefs;
                for (const part of parts) {
                    if (val && val[part] !== undefined) {
                        val = val[part];
                    } else {
                        return 0;
                    }
                }
                return val;
            }
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
        '*': 5, '/': 5,
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

        const right = values.pop();
        const left = values.pop();

        switch (op) {
            case '+': values.push(Number(left) + Number(right)); break;
            case '-': values.push(Number(left) - Number(right)); break;
            case '*': values.push(Number(left) * Number(right)); break;
            case '/': values.push(Number(left) / Number(right)); break;
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
            while (operators.length > 0 &&
                   precedence[operators[operators.length - 1]] >= precedence[token]) {
                applyOperator();
            }
            operators.push(token);
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
    }

    while (operators.length > 0) {
        applyOperator();
    }

    return values[0];
}

/**
 * Generator-based Special Mission Interpreter.
 * Recursively runs behavioral blocks (assignments, conditionals, loops, and actions)
 * yielding control back to the runner tick between steps.
 * 
 * @param {Array<Object>} behavior - The array of AST behavior blocks.
 * @param {Object} agentState - The mutable agent state.
 * @yields {Object} Yields TICK_YIELD or ACTION tokens for step execution.
 */
export function* executeMissionBehavior(behavior, agentState) {
    if (!behavior || !Array.isArray(behavior)) return;

    for (const step of behavior) {
        switch (step.type) {
            case 'assignment':
                if (agentState.variables === undefined) {
                    agentState.variables = {};
                }
                agentState.variables[step.target] = evaluateExpression(step.expression, agentState);
                break;

            case 'conditional':
                if (evaluateExpression(step.condition, agentState)) {
                    yield* executeMissionBehavior(step.then, agentState);
                } else if (step.else) {
                    yield* executeMissionBehavior(step.else, agentState);
                }
                break;

            case 'loop':
                while (evaluateExpression(step.condition, agentState)) {
                    yield* executeMissionBehavior(step.body, agentState);
                    yield { type: 'TICK_YIELD' }; // yields control to handle sensory frame revisions
                }
                break;

            case 'action':
                yield { type: 'ACTION', name: step.name, args: step.arguments };
                break;
        }
    }
}
