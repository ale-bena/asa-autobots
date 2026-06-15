
const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

function format(color, prefix, text) {
    if (process.env.LOG_COLORS !== 'false') {
        return `${COLORS.bright}${color}${prefix}${COLORS.reset} ${text}`;
    }
    return `${prefix} ${text}`;
}

export const logger = {
    toolCall(name, args) {
        if (process.env.LOG_TOOL_CALLS === 'false') return;
        console.log(format(COLORS.blue, '[TOOL CALL]', `Executing tool '${name}' with args: ${JSON.stringify(args)}`));
    },

    movement(agentId, x, y) {
        if (process.env.LOG_MOVEMENT === 'false') return;
        console.log(format(COLORS.green, '[MOVEMENT]', `Agent ${agentId} directed to coordinate (${x}, ${y})`));
    },

    policyUpdate(agentId, rules) {
        if (process.env.LOG_POLICY_UPDATES === 'false') return;
        console.log(format(COLORS.magenta, '[POLICY UPDATE]', `Policy rules updated for agent ${agentId}: ${JSON.stringify(rules)}`));
    },

    math(expression, result) {
        if (process.env.LOG_MATH === 'false') return;
        console.log(format(COLORS.cyan, '[MATH]', `Expression '${expression}' evaluated to: ${result}`));
    },

    p2p(type, payload, recipient, isPrivate = true) {
        if (process.env.LOG_P2P === 'false') return;
        const isHeartbeat = ['PEER_STATUS', 'PING', 'PONG'].includes(type);
        if (isHeartbeat && process.env.LOG_PEER_STATUS !== 'true') return;

        const privacy = isPrivate ? 'privately' : 'publicly (shout)';
        console.log(format(COLORS.yellow, '[P2P]', `Sent ${type} ${privacy} to ${recipient}: ${JSON.stringify(payload)}`));
    },

    p2pReceived(type, payload, senderId) {
        if (process.env.LOG_P2P === 'false') return;
        const isHeartbeat = ['PEER_STATUS', 'PING', 'PONG'].includes(type);
        if (isHeartbeat && process.env.LOG_PEER_STATUS !== 'true') return;

        console.log(format(COLORS.yellow, '[P2P]', `Received ${type} from ${senderId}: ${JSON.stringify(payload)}`));
    },

    actionConfirmation(msg) {
        console.log(format(COLORS.green, '[ACTION SUCCESS]', msg));
    },

    bdi(text) {
        if (process.env.LOG_BDI === 'false') return;
        originalLog(format(COLORS.bright, '[BDI]', text));
    },

    optimizer(text) {
        if (process.env.LOG_OPTIMIZER === 'false') return;
        originalLog(format(COLORS.cyan, '[Optimizer]', text));
    },

    error(prefix, err) {
        console.error(format(COLORS.red, `[ERROR - ${prefix}]`, err.message || String(err)));
    }
};

// Global Console Override to intercept and toggle third-party/internal log prefixes
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function shouldSuppress(message) {
    if (typeof message !== 'string') return false;
    
    // Check BDI internal logs (catches all [BDI ...] variants)
    if (message.startsWith('[BDI') && process.env.LOG_BDI === 'false') return true;
    
    // Check PDDL internal logs
    if (message.startsWith('[PDDL') && process.env.LOG_PDDL === 'false') return true;
    
    // Check P2P internal logs (not sent via logger.p2p)
    if (message.startsWith('[P2P]') && process.env.LOG_P2P === 'false') return true;

    // Check Optimizer internal logs
    if (message.startsWith('[Optimizer]') && process.env.LOG_OPTIMIZER === 'false') return true;

    return false;
}

console.log = function (firstArg, ...args) {
    if (shouldSuppress(firstArg)) return;
    originalLog.apply(console, [firstArg, ...args]);
};

console.warn = function (firstArg, ...args) {
    if (shouldSuppress(firstArg)) return;
    originalWarn.apply(console, [firstArg, ...args]);
};

console.error = function (firstArg, ...args) {
    if (shouldSuppress(firstArg)) return;
    originalError.apply(console, [firstArg, ...args]);
};
