/**
 * @module config/config
 * @description Centralized configuration module for both the BDI Executor and LLM Coordinator agents.
 */

import 'dotenv/config';

// 1. Define internal mutable variables

// /**
//  * Socket.io server connection host.
//  * @type {string}
//  */
let _SOCKET_HOST = process.env.HOST || 'http://localhost:8080';

// /**
//  * Unique identifiers for the agents and admin.
//  * @type {{BDI_AGENT_ID: string, LLM_AGENT_ID: string, ADMIN_ID: string}}
//  */
let _AGENT_IDS = {
    BDI_AGENT_ID: process.env.BDI_AGENT_ID || 'd60fa3',
    LLM_AGENT_ID: process.env.LLM_AGENT_ID || 'a0ce34',
    ADMIN_ID: process.env.ADMIN_ID || '39d92a'
};

// /**
//  * Connection JWT tokens.
//  * @type {{BDI_TOKEN: string, LLM_TOKEN: string}}
//  */
let _AGENT_TOKENS = {
    BDI_TOKEN: (process.env.TOKEN || '').trim(),
    LLM_TOKEN: (process.env.LLM_TOKEN || '').trim()
};

// /**
//  * OpenAI / LiteLLM server configurations.
//  * @type {{baseURL: string, apiKey: string, model: string}}
//  */
let _OPENAI_CONFIG = {
    baseURL: process.env.LITELLM_BASE_URL || 'https://llm.bears.disi.unitn.it/v1',
    apiKey: process.env.LITELLM_API_KEY || 'sk-5SezoNnWTgMf-3KuMRJYQw',
    model: process.env.LLM_MODEL || 'llama-3.3-70b-lmstudio'
};

// /**
//  * Cost penalty values used during pathfinding.
//  * @type {{AVOID_TILE_PENALTY: number, CRATE_TILE_PENALTY: number}}
//  */
let _PATHFINDING_CONFIG = {
    AVOID_TILE_PENALTY: 1000,
    CRATE_TILE_PENALTY: 50
};

// /**
//  * Configurable logger settings.
//  */
let _LOGGER_CONFIG = {
    enableToolCalls: process.env.LOG_TOOL_CALLS !== 'false',
    enableMovement: process.env.LOG_MOVEMENT !== 'false',
    enablePolicyUpdates: process.env.LOG_POLICY_UPDATES !== 'false',
    enableMath: process.env.LOG_MATH !== 'false',
    enableP2P: process.env.LOG_P2P !== 'false',
    enablePeerStatus: process.env.LOG_PEER_STATUS === 'true',
    enableBdi: process.env.LOG_BDI !== 'false',
    enablePddl: process.env.LOG_PDDL !== 'false',
    enableOptimizer: process.env.LOG_OPTIMIZER !== 'false',
    useColors: process.env.LOG_COLORS !== 'false'
};

// 2. Export standard immutable bindings for application safety
export const SOCKET_HOST = _SOCKET_HOST;
export const AGENT_IDS = _AGENT_IDS;
export const AGENT_TOKENS = _AGENT_TOKENS;
export const OPENAI_CONFIG = _OPENAI_CONFIG;
export const PATHFINDING_CONFIG = _PATHFINDING_CONFIG;
export const LOGGER_CONFIG = _LOGGER_CONFIG;

// 3. EXPOSE MUTATION HOOK EXCLUSIVELY FOR TEST COVERAGE RUNS
export function __updateTestEnvironment(env = {}) {
    if (env.HOST !== undefined) _SOCKET_HOST = env.HOST || 'http://localhost:8080';
    if (env.BDI_AGENT_ID !== undefined) _AGENT_IDS.BDI_AGENT_ID = env.BDI_AGENT_ID || 'd60fa3';
    if (env.LLM_AGENT_ID !== undefined) _AGENT_IDS.LLM_AGENT_ID = env.LLM_AGENT_ID || 'a0ce34';
    if (env.ADMIN_ID !== undefined) _AGENT_IDS.ADMIN_ID = env.ADMIN_ID || '39d92a';
    if (env.TOKEN !== undefined) _AGENT_TOKENS.BDI_TOKEN = (env.TOKEN || '').trim();
    if (env.LLM_TOKEN !== undefined) _AGENT_TOKENS.LLM_TOKEN = (env.LLM_TOKEN || '').trim();
    if (env.LITELLM_BASE_URL !== undefined) _OPENAI_CONFIG.baseURL = env.LITELLM_BASE_URL || 'https://llm.bears.disi.unitn.it/v1';
    if (env.LITELLM_API_KEY !== undefined) _OPENAI_CONFIG.apiKey = env.LITELLM_API_KEY || 'sk-5SezoNnWTgMf-3KuMRJYQw';
    if (env.LLM_MODEL !== undefined) _OPENAI_CONFIG.model = env.LLM_MODEL || 'llama-3.3-70b-lmstudio';

    if (env.LOG_TOOL_CALLS !== undefined) _LOGGER_CONFIG.enableToolCalls = env.LOG_TOOL_CALLS !== 'false';
    if (env.LOG_MOVEMENT !== undefined) _LOGGER_CONFIG.enableMovement = env.LOG_MOVEMENT !== 'false';
    if (env.LOG_POLICY_UPDATES !== undefined) _LOGGER_CONFIG.enablePolicyUpdates = env.LOG_POLICY_UPDATES !== 'false';
    if (env.LOG_MATH !== undefined) _LOGGER_CONFIG.enableMath = env.LOG_MATH !== 'false';
    if (env.LOG_P2P !== undefined) _LOGGER_CONFIG.enableP2P = env.LOG_P2P !== 'false';
    if (env.LOG_PEER_STATUS !== undefined) _LOGGER_CONFIG.enablePeerStatus = env.LOG_PEER_STATUS === 'true';
    if (env.LOG_BDI !== undefined) _LOGGER_CONFIG.enableBdi = env.LOG_BDI !== 'false';
    if (env.LOG_PDDL !== undefined) _LOGGER_CONFIG.enablePddl = env.LOG_PDDL !== 'false';
    if (env.LOG_OPTIMIZER !== undefined) _LOGGER_CONFIG.enableOptimizer = env.LOG_OPTIMIZER !== 'false';
    if (env.LOG_COLORS !== undefined) _LOGGER_CONFIG.useColors = env.LOG_COLORS !== 'false';
}