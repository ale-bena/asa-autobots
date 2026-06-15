/**
 * @file LLMCoordinator.test.js
 * @description Dedicated test suite for the LLMCoordinator class in src/llm/LLMCoordinator.js.
 * Tests the pure-logic methods (_cleanJsonResponse, _validateJsonStructure, executeTool,
 * getPeerAgentId) without requiring a live OpenAI connection.
 *
 * Uses Node.js native test runner (node:test) — the industry-standard, zero-dependency
 * testing framework shipped with Node ≥ 18.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { LLMCoordinator } from '../src/llm/LLMCoordinator.js';
import { AGENT_IDS } from '../src/config/config.js';

/**
 * Helper: create a minimal LLMCoordinator instance with stubbed beliefs/socket.
 */
function makeCoordinator(overrides = {}) {
    const beliefs = {
        me: { id: AGENT_IDS.LLM_AGENT_ID, x: 0, y: 0 },
        peers: new Map(),
        variables: {},
        carried: [],
        parcels: new Map(),
        crates: new Map(),
        policyRules: {},
        map: null,
        hold: false,
        activeContracts: new Map(),
        applyPolicyRules: (rules) => { beliefs.policyRules = rules; },
        ...overrides
    };

    const socket = {
        emitSay: async () => 'successful',
        emitShout: async () => {},
    };

    return new LLMCoordinator(beliefs, socket);
}

describe('LLMCoordinator — _cleanJsonResponse', () => {

    test('extracts JSON from [ANSWER] tags', () => {
        const coord = makeCoordinator();
        const raw = `[REASONING]
Some reasoning here
[/REASONING]
[ANSWER]
{"type": "stop"}
[/ANSWER]`;
        const result = coord._cleanJsonResponse(raw);
        assert.strictEqual(result, '{"type": "stop"}');
    });

    test('strips reasoning tags when no answer tags', () => {
        const coord = makeCoordinator();
        const raw = `[REASONING]
thinking...
[/REASONING]
{"type": "answer", "body": "Rome"}`;
        const result = coord._cleanJsonResponse(raw);
        const parsed = JSON.parse(result);
        assert.strictEqual(parsed.type, 'answer');
        assert.strictEqual(parsed.body, 'Rome');
    });

    test('strips markdown code fences', () => {
        const coord = makeCoordinator();
        const raw = '```json\n{"type": "stop"}\n```';
        const result = coord._cleanJsonResponse(raw);
        assert.strictEqual(result, '{"type": "stop"}');
    });

    test('extracts first balanced JSON object from noisy text', () => {
        const coord = makeCoordinator();
        const raw = 'Here is my answer: {"type": "tool", "name": "get_history", "args": {}} and more text';
        const result = coord._cleanJsonResponse(raw);
        const parsed = JSON.parse(result);
        assert.strictEqual(parsed.type, 'tool');
        assert.strictEqual(parsed.name, 'get_history');
    });

    test('handles escaped characters in strings', () => {
        const coord = makeCoordinator();
        const raw = '{"type": "answer", "body": "He said \\"hello\\""}';
        const result = coord._cleanJsonResponse(raw);
        const parsed = JSON.parse(result);
        assert.strictEqual(parsed.type, 'answer');
    });

    test('handles empty input gracefully', () => {
        const coord = makeCoordinator();
        const result = coord._cleanJsonResponse('');
        assert.strictEqual(result, '');
    });

    test('handles input with no JSON', () => {
        const coord = makeCoordinator();
        const result = coord._cleanJsonResponse('no json here');
        assert.strictEqual(result, 'no json here');
    });
});

describe('LLMCoordinator — _validateJsonStructure', () => {

    test('returns null for valid stop response', () => {
        const coord = makeCoordinator();
        const err = coord._validateJsonStructure({ type: 'stop' });
        assert.strictEqual(err, null);
    });

    test('returns null for valid answer response', () => {
        const coord = makeCoordinator();
        const err = coord._validateJsonStructure({ type: 'answer', body: 'Rome' });
        assert.strictEqual(err, null);
    });

    test('returns null for valid tool response', () => {
        const coord = makeCoordinator();
        const err = coord._validateJsonStructure({ type: 'tool', name: 'get_history', args: {} });
        assert.strictEqual(err, null);
    });

    test('rejects non-object', () => {
        const coord = makeCoordinator();
        assert.ok(coord._validateJsonStructure(null));
        assert.ok(coord._validateJsonStructure('string'));
        assert.ok(coord._validateJsonStructure(42));
    });

    test('rejects missing type', () => {
        const coord = makeCoordinator();
        const err = coord._validateJsonStructure({ name: 'something' });
        assert.ok(err);
        assert.ok(err.includes('type'));
    });

    test('rejects unknown type', () => {
        const coord = makeCoordinator();
        const err = coord._validateJsonStructure({ type: 'unknown' });
        assert.ok(err);
        assert.ok(err.includes('Invalid'));
    });

    test('rejects tool with missing name', () => {
        const coord = makeCoordinator();
        const err = coord._validateJsonStructure({ type: 'tool', args: {} });
        assert.ok(err);
        assert.ok(err.includes('name'));
    });

    test('rejects tool with missing args', () => {
        const coord = makeCoordinator();
        const err = coord._validateJsonStructure({ type: 'tool', name: 'foo' });
        assert.ok(err);
        assert.ok(err.includes('args'));
    });

    test('rejects tool with array args', () => {
        const coord = makeCoordinator();
        const err = coord._validateJsonStructure({ type: 'tool', name: 'foo', args: [1, 2] });
        assert.ok(err);
    });

    test('rejects answer with missing body', () => {
        const coord = makeCoordinator();
        const err = coord._validateJsonStructure({ type: 'answer' });
        assert.ok(err);
        assert.ok(err.includes('body'));
    });
});

describe('LLMCoordinator — executeTool', () => {

    test('returns error for unknown tool', async () => {
        const coord = makeCoordinator();
        const result = await coord.executeTool('nonexistent_tool', {});
        assert.ok(result.error);
        assert.ok(result.error.includes('Unknown tool'));
    });

    test('gates reward-required tools when rewardConfirmed is false', async () => {
        const coord = makeCoordinator();
        coord.rewardConfirmed = false;
        const result = await coord.executeTool('move_agent_to_coordinate', { id: AGENT_IDS.BDI_AGENT_ID, x: 2, y: 2 });
        assert.strictEqual(result.success, false);
        assert.ok(result.error.includes('No positive reward'));
    });

    test('allows non-gated tools without reward confirmation', async () => {
        const coord = makeCoordinator();
        coord.rewardConfirmed = false;
        const result = await coord.executeTool('get_history', {});
        assert.strictEqual(result.success, true);
        assert.ok(Array.isArray(result.history));
    });

    test('allows evaluate_math_expression and sets rewardConfirmed on true result', async () => {
        const coord = makeCoordinator();
        coord.rewardConfirmed = false;
        const result = await coord.executeTool('evaluate_math_expression', { expression: '10 > 0' });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.result, 'true');
        assert.strictEqual(coord.rewardConfirmed, true);
    });

    test('evaluate_math_expression does not set rewardConfirmed for false result', async () => {
        const coord = makeCoordinator();
        coord.rewardConfirmed = false;
        const result = await coord.executeTool('evaluate_math_expression', { expression: '-10 > 0' });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.result, 'false');
        assert.strictEqual(coord.rewardConfirmed, false);
    });

    test('exempts cooperate CLOSE from reward gate', async () => {
        const coord = makeCoordinator();
        coord.rewardConfirmed = false;
        const result = await coord.executeTool('cooperate_with_agent', {
            id: AGENT_IDS.BDI_AGENT_ID,
            contract: { type: 'CLOSE' }
        });
        assert.strictEqual(result.success, true);
    });

    test('exempts cooperate RELAY from reward gate', async () => {
        const coord = makeCoordinator();
        coord.rewardConfirmed = false;
        // Provide map so pickRelayDropTile can work
        const map = new (await import('../src/mapping/MapRepresentation.js')).MapRepresentation(3, 3, [
            { x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '3' }, { x: 2, y: 0, type: '2' },
            { x: 0, y: 1, type: '3' }, { x: 1, y: 1, type: '3' }, { x: 2, y: 1, type: '3' },
            { x: 0, y: 2, type: '3' }, { x: 1, y: 2, type: '3' }, { x: 2, y: 2, type: '3' },
        ]);
        coord.beliefs.map = map;
        const result = await coord.executeTool('cooperate_with_agent', {
            id: AGENT_IDS.BDI_AGENT_ID,
            contract: { type: 'RELAY', x: null, y: null, courierId: AGENT_IDS.BDI_AGENT_ID }
        });
        assert.strictEqual(result.success, true);
    });

    test('handles tool execution errors gracefully', async () => {
        const coord = makeCoordinator();
        coord.rewardConfirmed = true;
        // apply_agent_rules requires coordinator.beliefs.applyPolicyRules and getPeerAgentId
        // Pass bad data that will cause getPeerAgentId to fail
        const result = await coord.executeTool('apply_agent_rules', {
            id: AGENT_IDS.LLM_AGENT_ID,
            rules: [{ all_tiles: true, multiplier: 2 }]
        });
        // Should succeed since LLM_AGENT_ID matches me.id
        assert.strictEqual(result.success, true);
    });
});

describe('LLMCoordinator — getPeerAgentId', () => {

    test('returns LLM agent when me is BDI', () => {
        const coord = makeCoordinator();
        coord.beliefs.me.id = AGENT_IDS.BDI_AGENT_ID;
        assert.strictEqual(coord.getPeerAgentId(), AGENT_IDS.LLM_AGENT_ID);
    });

    test('returns BDI agent when me is LLM', () => {
        const coord = makeCoordinator();
        coord.beliefs.me.id = AGENT_IDS.LLM_AGENT_ID;
        assert.strictEqual(coord.getPeerAgentId(), AGENT_IDS.BDI_AGENT_ID);
    });
});

describe('LLMCoordinator — P2P', () => {

    test('sends private message via emitSay', async () => {
        const calls = [];
        const coord = makeCoordinator();
        coord.socket.emitSay = async (id, msg) => { calls.push({ id, msg }); return 'successful'; };

        await coord.P2P(AGENT_IDS.BDI_AGENT_ID, { type: 'HOLD' });
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].id, AGENT_IDS.BDI_AGENT_ID);
        const payload = JSON.parse(calls[0].msg);
        assert.strictEqual(payload.type, 'HOLD');
    });

    test('falls back to emitShout on emitSay failure', async () => {
        const shoutCalls = [];
        const coord = makeCoordinator();
        coord.socket.emitSay = async () => { throw new Error('timeout'); };
        coord.socket.emitShout = async (msg) => { shoutCalls.push(msg); };

        await coord.P2P(AGENT_IDS.BDI_AGENT_ID, { type: 'RESUME' });
        assert.strictEqual(shoutCalls.length, 1);
        const payload = JSON.parse(shoutCalls[0]);
        assert.strictEqual(payload.type, 'RESUME');
    });

    test('falls back to emitShout on non-successful status', async () => {
        const shoutCalls = [];
        const coord = makeCoordinator();
        coord.socket.emitSay = async () => 'failed';
        coord.socket.emitShout = async (msg) => { shoutCalls.push(msg); };

        await coord.P2P(AGENT_IDS.BDI_AGENT_ID, { type: 'HOLD' });
        assert.strictEqual(shoutCalls.length, 1);
    });
});
