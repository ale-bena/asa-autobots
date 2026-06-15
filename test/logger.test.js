import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { logger } from '../src/utils/logger.js';

describe('Logger utility tests', () => {
    const originalEnv = { ...process.env };
    let stdoutLogs = [];
    let stderrLogs = [];

    const originalWrite = process.stdout.write;
    const originalErrorWrite = process.stderr.write;

    before(() => {
        process.stdout.write = (chunk, encoding, callback) => {
            stdoutLogs.push(chunk.toString());
            return true;
        };
        process.stderr.write = (chunk, encoding, callback) => {
            stderrLogs.push(chunk.toString());
            return true;
        };
    });

    after(() => {
        process.stdout.write = originalWrite;
        process.stderr.write = originalErrorWrite;
        process.env = originalEnv;
    });

    const resetLogs = () => {
        stdoutLogs = [];
        stderrLogs = [];
    };

    test('Logger format colors and plain text', () => {
        process.env.LOG_COLORS = 'true';
        resetLogs();
        logger.actionConfirmation('done');
        assert.ok(stdoutLogs.length > 0);
        assert.ok(stdoutLogs[0].includes('\x1b[1m'));

        process.env.LOG_COLORS = 'false';
        resetLogs();
        logger.actionConfirmation('plain');
        assert.ok(stdoutLogs.length > 0);
        assert.ok(!stdoutLogs[0].includes('\x1b[1m'));
    });

    test('Logger toggles based on environment variables', () => {
        // 1. Tool calls
        process.env.LOG_TOOL_CALLS = 'false';
        resetLogs();
        logger.toolCall('toolName', {});
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_TOOL_CALLS = 'true';
        logger.toolCall('toolName', {});
        assert.strictEqual(stdoutLogs.length, 1);

        // 2. Movement
        process.env.LOG_MOVEMENT = 'false';
        resetLogs();
        logger.movement('agent_1', 1, 2);
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_MOVEMENT = 'true';
        logger.movement('agent_1', 1, 2);
        assert.strictEqual(stdoutLogs.length, 1);

        // 3. Policy update
        process.env.LOG_POLICY_UPDATES = 'false';
        resetLogs();
        logger.policyUpdate('agent_1', {});
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_POLICY_UPDATES = 'true';
        logger.policyUpdate('agent_1', {});
        assert.strictEqual(stdoutLogs.length, 1);

        // 4. Math
        process.env.LOG_MATH = 'false';
        resetLogs();
        logger.math('1+1', 2);
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_MATH = 'true';
        logger.math('1+1', 2);
        assert.strictEqual(stdoutLogs.length, 1);
    });

    test('Logger P2P and Heartbeat toggling', () => {
        process.env.LOG_P2P = 'false';
        resetLogs();
        logger.p2p('TEST', {}, 'recipient');
        logger.p2pReceived('TEST', {}, 'sender');
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_P2P = 'true';
        process.env.LOG_PEER_STATUS = 'false';
        logger.p2p('PEER_STATUS', {}, 'recipient');
        logger.p2pReceived('PEER_STATUS', {}, 'sender');
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_PEER_STATUS = 'true';
        logger.p2p('PEER_STATUS', {}, 'recipient', false);
        logger.p2pReceived('PEER_STATUS', {}, 'sender');
        assert.strictEqual(stdoutLogs.length, 2);
    });

    test('Logger BDI and Optimizer originalLog check', () => {
        process.env.LOG_BDI = 'false';
        resetLogs();
        logger.bdi('bdi log');
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_BDI = 'true';
        logger.bdi('bdi log');
        assert.ok(stdoutLogs.length > 0);

        process.env.LOG_OPTIMIZER = 'false';
        resetLogs();
        logger.optimizer('opt log');
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_OPTIMIZER = 'true';
        logger.optimizer('opt log');
        assert.ok(stdoutLogs.length > 0);
    });

    test('Global console suppression checks', () => {
        // BDI suppression
        process.env.LOG_BDI = 'false';
        resetLogs();
        console.log('[BDI] test log');
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_BDI = 'true';
        console.log('[BDI] test log');
        assert.strictEqual(stdoutLogs.length, 1);

        // PDDL suppression
        process.env.LOG_PDDL = 'false';
        resetLogs();
        console.log('[PDDL] test log');
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_PDDL = 'true';
        console.log('[PDDL] test log');
        assert.strictEqual(stdoutLogs.length, 1);

        // P2P suppression
        process.env.LOG_P2P = 'false';
        resetLogs();
        console.log('[P2P] test log');
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_P2P = 'true';
        console.log('[P2P] test log');
        assert.strictEqual(stdoutLogs.length, 1);

        // Optimizer suppression
        process.env.LOG_OPTIMIZER = 'false';
        resetLogs();
        console.log('[Optimizer] test log');
        assert.strictEqual(stdoutLogs.length, 0);

        process.env.LOG_OPTIMIZER = 'true';
        console.log('[Optimizer] test log');
        assert.strictEqual(stdoutLogs.length, 1);

        // Warnings and errors suppression
        process.env.LOG_BDI = 'false';
        resetLogs();
        console.warn('[BDI] test warning');
        assert.strictEqual(stdoutLogs.length, 0); // wait, console.warn also writes to stdout or stderr? In Node.js console.warn writes to stderr
        assert.strictEqual(stderrLogs.length, 0);

        resetLogs();
        console.error('[BDI] test error');
        assert.strictEqual(stderrLogs.length, 0);

        // Non-suppressed warn/error
        resetLogs();
        console.warn('Regular warning');
        assert.strictEqual(stderrLogs.length, 1);

        resetLogs();
        console.error('Regular error');
        assert.strictEqual(stderrLogs.length, 1);
    });

    test('Logger error wrapper', () => {
        resetLogs();
        logger.error('PREFIX', new Error('Fail'));
        assert.strictEqual(stderrLogs.length, 1);
        assert.ok(stderrLogs[0].includes('Fail'));

        resetLogs();
        logger.error('PREFIX2', 'string error');
        assert.strictEqual(stderrLogs.length, 1);
        assert.ok(stderrLogs[0].includes('string error'));
    });
});
