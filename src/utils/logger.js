import { LOGGER_CONFIG } from '../config/config.js';

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
    if (LOGGER_CONFIG.useColors) {
        return `${COLORS.bright}${color}${prefix}${COLORS.reset} ${text}`;
    }
    return `${prefix} ${text}`;
}

export const logger = {
    toolCall(name, args) {
        if (!LOGGER_CONFIG.enableToolCalls) return;
        console.log(format(COLORS.blue, '[TOOL CALL]', `Executing tool '${name}' with args: ${JSON.stringify(args)}`));
    },

    movement(agentId, x, y) {
        if (!LOGGER_CONFIG.enableMovement) return;
        console.log(format(COLORS.green, '[MOVEMENT]', `Agent ${agentId} directed to coordinate (${x}, ${y})`));
    },

    policyUpdate(agentId, rules) {
        if (!LOGGER_CONFIG.enablePolicyUpdates) return;
        console.log(format(COLORS.magenta, '[POLICY UPDATE]', `Policy rules updated for agent ${agentId}: ${JSON.stringify(rules)}`));
    },

    math(expression, result) {
        if (!LOGGER_CONFIG.enableMath) return;
        console.log(format(COLORS.cyan, '[MATH]', `Expression '${expression}' evaluated to: ${result}`));
    },

    p2p(type, payload, recipient, isPrivate = true) {
        if (!LOGGER_CONFIG.enableP2P) return;
        const isHeartbeat = ['PEER_STATUS', 'PING', 'PONG'].includes(type);
        if (isHeartbeat && !LOGGER_CONFIG.enablePeerStatus) return;

        const privacy = isPrivate ? 'privately' : 'publicly (shout)';
        console.log(format(COLORS.yellow, '[P2P]', `Sent ${type} ${privacy} to ${recipient}: ${JSON.stringify(payload)}`));
    },

    actionConfirmation(msg) {
        console.log(format(COLORS.green, '[ACTION SUCCESS]', msg));
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
    
    // Check BDI internal logs
    const isBdiLog = message.startsWith('[BDI]') || 
                     message.startsWith('[BDI Debug]') || 
                     message.startsWith('[BDI Stats]') || 
                     message.startsWith('[BDI Beliefs]') || 
                     message.startsWith('[BDI Adapt]') || 
                     message.startsWith('[BDI Opportunistic]');
    if (isBdiLog && !LOGGER_CONFIG.enableBDI) return true;
    
    // Check PDDL internal logs
    const isPddlLog = message.startsWith('[PDDL]') || 
                      message.startsWith('[PDDL Solver]') || 
                      message.startsWith('[PDDL Trigger]') || 
                      message.startsWith('[PDDL Throttle]');
    if (isPddlLog && !LOGGER_CONFIG.enablePDDL) return true;
    
    // Check P2P internal logs (not sent via logger.p2p)
    if (message.startsWith('[P2P]') && !LOGGER_CONFIG.enableP2P) return true;

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
