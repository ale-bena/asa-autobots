/**
 * @file LLMRegistry.test.js
 * @description Dedicated test suite for src/llm/prompts.js and src/llm/toolsRegistry.js.
 * Tests the tool handlers, prompt generation, and system prompt exports.
 *
 * Uses Node.js native test runner (node:test) — the industry-standard, zero-dependency
 * testing framework shipped with Node ≥ 18.
 *
 * Why node:test?  It is maintained by the Node.js core team, requires no third-party
 * devDependencies, and produces TAP/spec output compatible with CI pipelines.
 *
 * NOTE on async polling helpers (waitUntilReached, waitUntilPickedUp, waitUntilDelivered):
 * These internal helpers use real setTimeout-based polling loops. To avoid flaky timing
 * issues in tests, we use an auto-incrementing Date.now mock that advances time by a
 * large step on every call, causing the timeout condition to trigger deterministically
 * without real wall-clock delays.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { SYSTEM_PROMPT } from '../src/llm/system_prompt.js';
import { TOOLS_REGISTRY, generateToolsPrompt } from '../src/llm/toolsRegistry.js';
import { AGENT_IDS } from '../src/config/config.js';
import { MapRepresentation } from '../src/mapping/MapRepresentation.js';

const originalDateNow = Date.now;

describe('LLM prompts and toolsRegistry tests', () => {

    afterEach(() => {
        // Always restore Date.now after each test to prevent leaks
        Date.now = originalDateNow;
    });

    // ── prompts.js ──────────────────────────────────────────────────

    test('prompts exports system prompt', () => {
        assert.ok(SYSTEM_PROMPT);
        assert.strictEqual(typeof SYSTEM_PROMPT, 'string');
        assert.ok(SYSTEM_PROMPT.includes(AGENT_IDS.BDI_AGENT_ID));
        assert.ok(SYSTEM_PROMPT.includes(AGENT_IDS.LLM_AGENT_ID));
    });

    test('system prompt contains XML structure tags', () => {
        assert.ok(SYSTEM_PROMPT.includes('<system_prompt>'));
        assert.ok(SYSTEM_PROMPT.includes('<role>'));
        assert.ok(SYSTEM_PROMPT.includes('<rules>'));
        assert.ok(SYSTEM_PROMPT.includes('<response_format>'));
        assert.ok(SYSTEM_PROMPT.includes('<available_tools>'));
    });

    // ── generateToolsPrompt ─────────────────────────────────────────

    test('generateToolsPrompt output format', () => {
        const text = generateToolsPrompt();
        assert.ok(text);
        assert.strictEqual(typeof text, 'string');
        assert.ok(text.includes('get_history'));
        assert.ok(text.includes('evaluate_math_expression'));
        assert.ok(text.includes('move_agent_to_coordinate'));
        assert.ok(text.includes('apply_agent_rules'));
        assert.ok(text.includes('cooperate_with_agent'));
        assert.ok(text.includes('get_local_context'));
        assert.ok(text.includes('set_agent_variable'));
        assert.ok(text.includes('hold_agent'));
        assert.ok(text.includes('resume_agent'));
    });

    test('generateToolsPrompt includes tool descriptions and schemas', () => {
        const text = generateToolsPrompt();
        assert.ok(text.includes('Description:'));
        assert.ok(text.includes('Args:'));
        assert.ok(text.includes('<tool0>'));
    });

    // ── TOOLS_REGISTRY structure ────────────────────────────────────

    test('all tools have description, getArgsSchema, isAction, handler', () => {
        for (const [name, tool] of Object.entries(TOOLS_REGISTRY)) {
            assert.strictEqual(typeof tool.description, 'string', `${name}: description`);
            assert.strictEqual(typeof tool.getArgsSchema, 'function', `${name}: getArgsSchema`);
            assert.strictEqual(typeof tool.isAction, 'boolean', `${name}: isAction`);
            assert.strictEqual(typeof tool.handler, 'function', `${name}: handler`);
        }
    });

    test('getArgsSchema returns a string for each tool', () => {
        for (const [name, tool] of Object.entries(TOOLS_REGISTRY)) {
            const schema = tool.getArgsSchema();
            assert.strictEqual(typeof schema, 'string', `${name}: schema should be string`);
        }
    });

    // ── get_history ─────────────────────────────────────────────────

    test('get_history tool handler', async () => {
        const coordinator = {
            history: [{ prompt: 'hi', answer: 'hello' }]
        };
        const res = await TOOLS_REGISTRY.get_history.handler({}, coordinator);
        assert.strictEqual(res.success, true);
        assert.deepStrictEqual(res.history, coordinator.history);
    });

    test('get_history returns empty array when no history', async () => {
        const coordinator = {};
        const res = await TOOLS_REGISTRY.get_history.handler({}, coordinator);
        assert.strictEqual(res.success, true);
        assert.deepStrictEqual(res.history, []);
    });

    // ── evaluate_math_expression ────────────────────────────────────

    test('evaluate_math_expression tool handler', async () => {
        const coordinator = { beliefs: {} };
        const res = await TOOLS_REGISTRY.evaluate_math_expression.handler({ expression: '3 * 5' }, coordinator);
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.result, '15');
    });

    test('evaluate_math_expression with comparison', async () => {
        const coordinator = { beliefs: {} };
        const res = await TOOLS_REGISTRY.evaluate_math_expression.handler({ expression: '10 > 0' }, coordinator);
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.result, 'true');
    });

    // ── move_agent_to_coordinate ────────────────────────────────────

    test('move_agent_to_coordinate success when already at target', async () => {
        // When the agent is already at the target coordinates, waitUntilReached
        // detects the match on the very first iteration and returns immediately.
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 2, y: 2 },
            peers: new Map(),
            variables: {},
            activeContracts: new Map()
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const res = await TOOLS_REGISTRY.move_agent_to_coordinate.handler(
            { id: AGENT_IDS.BDI_AGENT_ID, x: 2, y: 2, holdOnArrival: true },
            coordinator
        );

        assert.strictEqual(res.success, true);
        assert.strictEqual(beliefs.activeContracts.has('admin_move'), true);
        assert.strictEqual(p2pCalls.length, 1);
    });

    test('move_agent_to_coordinate guardrail rejects negative reward variable', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 },
            peers: new Map(),
            variables: { 'bad_reward': -5 },
            activeContracts: new Map()
        };
        const coordinator = { beliefs };

        const res = await TOOLS_REGISTRY.move_agent_to_coordinate.handler(
            { id: AGENT_IDS.BDI_AGENT_ID, x: 2, y: 2 },
            coordinator
        );
        assert.strictEqual(res.success, false);
        assert.ok(res.error.includes("variable 'bad_reward' has non-positive value"));
    });

    test('move_agent_to_coordinate timeout when agent never reaches target', async () => {
        // Use an auto-incrementing Date.now mock: each call advances time by 2000ms.
        // This makes the timeout condition trigger deterministically after a few
        // iterations, without relying on real wall-clock alignment.
        let mockTime = 0;
        Date.now = () => { mockTime += 2000; return mockTime; };

        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 },
            peers: new Map(),
            variables: {},
            activeContracts: new Map()
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const res = await TOOLS_REGISTRY.move_agent_to_coordinate.handler(
            { id: AGENT_IDS.BDI_AGENT_ID, x: 5, y: 5 },
            coordinator
        );

        assert.strictEqual(res.success, false);
        assert.ok(res.error.includes('Agent failed to reach'));
    });

    test('move_agent_to_coordinate clamps to map bounds', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 },
            peers: new Map(),
            variables: {},
            activeContracts: new Map(),
            map: { width: 5, height: 5 }
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        // Request coordinates outside map bounds — should clamp
        // Use auto-incrementing Date.now to force fast timeout
        let mockTime = 0;
        Date.now = () => { mockTime += 2000; return mockTime; };

        await TOOLS_REGISTRY.move_agent_to_coordinate.handler(
            { id: AGENT_IDS.BDI_AGENT_ID, x: 99, y: -5 },
            coordinator
        );

        // Verify P2P was called with clamped coordinates
        assert.strictEqual(p2pCalls.length, 1);
        assert.strictEqual(p2pCalls[0].payload.x, 4); // clamped to width-1
        assert.strictEqual(p2pCalls[0].payload.y, 0); // clamped to 0
    });

    test('move_agent_to_coordinate sets dropOnArrival in contract', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 3, y: 3 },
            peers: new Map(),
            variables: {},
            activeContracts: new Map()
        };
        const coordinator = {
            beliefs,
            P2P: async () => { },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const res = await TOOLS_REGISTRY.move_agent_to_coordinate.handler(
            { id: AGENT_IDS.BDI_AGENT_ID, x: 3, y: 3, dropOnArrival: true },
            coordinator
        );

        assert.strictEqual(res.success, true);
        const contract = beliefs.activeContracts.get('admin_move');
        assert.ok(contract);
        assert.strictEqual(contract.dropOnArrival, true);
    });

    test('move_agent_to_coordinate peer agent with moveToAck', async () => {
        // When moving a peer agent, the handler sends P2P and waits for ACK.
        // Simulate a successful ACK arriving immediately.
        const beliefs = {
            me: { id: AGENT_IDS.LLM_AGENT_ID, x: 0, y: 0 },
            peers: new Map([[AGENT_IDS.BDI_AGENT_ID, { x: 3, y: 3 }]]),
            variables: {},
            activeContracts: new Map()
        };
        const coordinator = {
            beliefs,
            P2P: async () => {
                // Simulate the peer acknowledging immediately
                beliefs.variables.moveToAck = {
                    x: 3, y: 3,
                    timestamp: Date.now() - 1, // Set before sendTime
                    success: true
                };
            },
            getPeerAgentId: () => AGENT_IDS.BDI_AGENT_ID
        };

        // When peer is already at target and ACK arrives, should succeed fast
        // But we need the ACK timestamp to be >= sendTime.
        // Override P2P to set ACK with proper timestamp
        let sendTimeCaptured = null;
        coordinator.P2P = async () => {
            // P2P is called, after which waitUntilReached checks for ACK
            // Set the ACK with a timestamp >= the send time
            sendTimeCaptured = Date.now();
            beliefs.variables.moveToAck = {
                x: 3, y: 3,
                timestamp: sendTimeCaptured + 1,
                success: true
            };
        };

        const res = await TOOLS_REGISTRY.move_agent_to_coordinate.handler(
            { id: AGENT_IDS.BDI_AGENT_ID, x: 3, y: 3 },
            coordinator
        );

        assert.strictEqual(res.success, true);
        assert.ok(res.message.includes('reached'));
    });

    // ── apply_agent_rules ───────────────────────────────────────────

    test('apply_agent_rules tool handler for all agents', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID },
            applyPolicyRules: (rules) => { beliefs.rules = rules; }
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const rules = [{ all_tiles: true, multiplier: 2 }];
        const res = await TOOLS_REGISTRY.apply_agent_rules.handler(
            { id: 'all', rules },
            coordinator
        );

        assert.strictEqual(res.success, true);
        assert.deepStrictEqual(beliefs.rules, rules);
        assert.strictEqual(p2pCalls.length, 1);
        assert.strictEqual(p2pCalls[0].payload.type, 'APPLY_RULES');
    });

    test('apply_agent_rules only to self', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID },
            applyPolicyRules: (rules) => { beliefs.rules = rules; }
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const rules = [{ all_tiles: false, tiles: ['2,2'], bonus: -100 }];
        const res = await TOOLS_REGISTRY.apply_agent_rules.handler(
            { id: AGENT_IDS.BDI_AGENT_ID, rules },
            coordinator
        );

        assert.strictEqual(res.success, true);
        assert.deepStrictEqual(beliefs.rules, rules);
        // Should NOT send to peer when targeting only self
        assert.strictEqual(p2pCalls.length, 0);
    });

    // ── cooperate_with_agent ────────────────────────────────────────

    test('cooperate_with_agent CLOSE contract', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 },
            activeContracts: new Map([
                ['admin_move', {}],
                ['coop_existing', {}]
            ]),
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const res = await TOOLS_REGISTRY.cooperate_with_agent.handler(
            { id: AGENT_IDS.LLM_AGENT_ID, contract: { type: 'CLOSE' } },
            coordinator
        );
        assert.strictEqual(res.success, true);
        assert.strictEqual(beliefs.activeContracts.has('coop_existing'), false);
        assert.strictEqual(beliefs.activeContracts.has('admin_move'), true); // preserved
        assert.strictEqual(p2pCalls.length, 1);
        assert.strictEqual(p2pCalls[0].payload.type, 'CLOSE_CONTRACT');
    });

    test('cooperate_with_agent RELAY contract with auto-pick drop tile', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 },
            activeContracts: new Map(),
            hold: true,
            carried: [],
            parcels: new Map(),
            map: new MapRepresentation(3, 2, [
                { x: 0, y: 0, type: '3' },
                { x: 1, y: 0, type: '3' },
                { x: 2, y: 0, type: '2' } // Delivery zone
            ])
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const res = await TOOLS_REGISTRY.cooperate_with_agent.handler(
            {
                id: AGENT_IDS.LLM_AGENT_ID,
                contract: {
                    type: 'RELAY',
                    x: null,
                    y: null,
                    radius: 0,
                    holdDuration: 'indefinite'
                }
            },
            coordinator
        );

        assert.strictEqual(res.success, true);
        assert.strictEqual(beliefs.hold, false); // hold released
        assert.strictEqual(p2pCalls.length, 1);
        assert.strictEqual(p2pCalls[0].payload.type, 'PROPOSE_CONTRACT');

        const relayContract = Array.from(beliefs.activeContracts.values()).find(c => c.type === 'RELAY');
        assert.ok(relayContract);
        assert.strictEqual(relayContract.holdDuration, -1);
        assert.ok(relayContract.x !== null, 'Drop tile x should be auto-picked');
    });

    test('cooperate_with_agent RENDEZVOUS contract', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 },
            activeContracts: new Map(),
            hold: false
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const res = await TOOLS_REGISTRY.cooperate_with_agent.handler(
            {
                id: AGENT_IDS.LLM_AGENT_ID,
                contract: { type: 'RENDEZVOUS', x: 5, y: 5, radius: 2, holdDuration: 10 }
            },
            coordinator
        );

        assert.strictEqual(res.success, true);
        const contract = Array.from(beliefs.activeContracts.values()).find(c => c.type === 'RENDEZVOUS');
        assert.ok(contract);
        assert.strictEqual(contract.x, 5);
        assert.strictEqual(contract.y, 5);
        assert.strictEqual(contract.radius, 2);
        assert.strictEqual(contract.holdDuration, 10);
    });

    test('cooperate_with_agent RELAY fails without map', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 },
            activeContracts: new Map(),
            hold: false,
            map: null // no map
        };
        const coordinator = {
            beliefs,
            P2P: async () => { },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const res = await TOOLS_REGISTRY.cooperate_with_agent.handler(
            {
                id: AGENT_IDS.LLM_AGENT_ID,
                contract: { type: 'RELAY', x: null, y: null }
            },
            coordinator
        );

        assert.strictEqual(res.success, false);
        assert.ok(res.error.includes('Could not determine'));
    });

    // ── get_local_context ───────────────────────────────────────────

    test('get_local_context tool handler', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 },
            carried: ['p1'],
            variables: {},
            policyRules: {},
            map: null,
            parcels: new Map([['p1', { id: 'p1', x: 0, y: 0 }]]),
            peers: new Map([['p2', { id: 'p2', name: 'Agent2', x: 1, y: 1 }]]),
            crates: new Map()
        };
        const coordinator = { beliefs };

        const res = await TOOLS_REGISTRY.get_local_context.handler({}, coordinator);
        assert.strictEqual(res.success, true);
        assert.deepStrictEqual(res.context.me, beliefs.me);
        assert.strictEqual(res.context.parcels.length, 1);
        assert.strictEqual(res.context.peers.length, 1);
        assert.strictEqual(res.context.crates.length, 0);
        assert.strictEqual(res.context.map, null);
    });

    test('get_local_context includes map info when available', async () => {
        const tiles = [];
        for (let x = 0; x < 5; x++) {
            for (let y = 0; y < 5; y++) {
                tiles.push({ x, y, type: '3' });
            }
        }
        const map = new MapRepresentation(5, 5, tiles);
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID, x: 0, y: 0 },
            carried: [],
            variables: {},
            policyRules: {},
            map,
            parcels: new Map(),
            peers: new Map(),
            crates: new Map()
        };
        const coordinator = { beliefs };

        const res = await TOOLS_REGISTRY.get_local_context.handler({}, coordinator);
        assert.strictEqual(res.success, true);
        assert.ok(res.context.map);
        assert.strictEqual(res.context.map.width, 6);
        assert.strictEqual(res.context.map.height, 6);
    });

    // ── set_agent_variable ──────────────────────────────────────────

    test('set_agent_variable tool handler', async () => {
        const beliefs = {
            variables: {}
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); }
        };

        const res = await TOOLS_REGISTRY.set_agent_variable.handler(
            { id: 'peer_id', name: 'score', value: 10 },
            coordinator
        );

        assert.strictEqual(res.success, true);
        assert.strictEqual(beliefs.variables.score, 10);
        assert.strictEqual(p2pCalls.length, 1);
        assert.strictEqual(p2pCalls[0].payload.type, 'SET_VARIABLE');
    });

    // ── hold_agent and resume_agent ─────────────────────────────────

    test('hold_agent handler sets hold state', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID },
            hold: false,
            activeContracts: new Map()
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const res = await TOOLS_REGISTRY.hold_agent.handler(
            { id: 'all', duration: null },
            coordinator
        );
        assert.strictEqual(res.success, true);
        assert.strictEqual(beliefs.hold, true);
        assert.strictEqual(p2pCalls.length, 1);
        assert.strictEqual(p2pCalls[0].payload.type, 'HOLD');
    });

    test('resume_agent handler clears hold and contracts', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID },
            hold: true,
            activeContracts: new Map([['coop1', {}]])
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const res = await TOOLS_REGISTRY.resume_agent.handler(
            { id: 'all' },
            coordinator
        );
        assert.strictEqual(res.success, true);
        assert.strictEqual(beliefs.hold, false);
        assert.strictEqual(beliefs.activeContracts.has('coop1'), false);
        assert.strictEqual(p2pCalls.length, 2); // 1 RESUME + 1 CLOSE_CONTRACT
    });

    test('hold_agent with duration schedules auto-resume', async () => {
        const beliefs = {
            me: { id: AGENT_IDS.BDI_AGENT_ID },
            hold: false,
            activeContracts: new Map()
        };
        const p2pCalls = [];
        const coordinator = {
            beliefs,
            P2P: async (id, payload) => { p2pCalls.push({ id, payload }); },
            getPeerAgentId: () => AGENT_IDS.LLM_AGENT_ID
        };

        const res = await TOOLS_REGISTRY.hold_agent.handler(
            { id: 'all', duration: 5 },
            coordinator
        );
        assert.strictEqual(res.success, true);
        assert.strictEqual(beliefs.hold, true);
        assert.ok(res.message.includes('5s'));
    });
});
