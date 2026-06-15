/**
 * @file config.test.js
 * @description Dedicated test suite for verifying config parameter mutations and branch evaluations.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    SOCKET_HOST, AGENT_IDS, LOGGER_CONFIG, __updateTestEnvironment
} from '../src/config/config.js';

describe('Centralized Configuration Branch Validation', () => {

    test('Verifies fallback structural bindings are active', () => {
        // Trigger default branch conditions safely
        __updateTestEnvironment({
            HOST: '',
            BDI_AGENT_ID: '',
            LOG_TOOL_CALLS: 'false',
            LOG_PEER_STATUS: 'false'
        });

        assert.ok(SOCKET_HOST);
        assert.ok(AGENT_IDS.BDI_AGENT_ID);
        assert.strictEqual(LOGGER_CONFIG.enableToolCalls, false);
        assert.strictEqual(LOGGER_CONFIG.enablePeerStatus, false);
    });

    test('Verifies custom environment parameter hydration strings', () => {
        // Force evaluation down the custom process assignment branches
        __updateTestEnvironment({
            HOST: 'http://production-matrix:5000',
            BDI_AGENT_ID: 'worker_bdi_node',
            LLM_AGENT_ID: 'core_llm_node',
            ADMIN_ID: 'super_user',
            TOKEN: '  bdi_jwt_token_auth  ',
            LLM_TOKEN: ' llm_jwt_token_auth ',
            LITELLM_BASE_URL: 'https://gateway.bears.it',
            LITELLM_API_KEY: 'sk-production-secure-key',
            LLM_MODEL: 'gpt-4o-mini',
            PAAS_HOST: 'http://solver-microservice:8000',
            LOG_TOOL_CALLS: 'true',
            LOG_MOVEMENT: 'true',
            LOG_POLICY_UPDATES: 'true',
            LOG_MATH: 'true',
            LOG_P2P: 'true',
            LOG_PEER_STATUS: 'true',
            LOG_BDI: 'true',
            LOG_PDDL: 'true',
            LOG_OPTIMIZER: 'true',
            LOG_COLORS: 'true'
        });

        // Run matching assertions to verify your parsing logic runs cleanly
        assert.strictEqual(LOGGER_CONFIG.enableToolCalls, true);
        assert.strictEqual(LOGGER_CONFIG.enablePeerStatus, true);
    });
});