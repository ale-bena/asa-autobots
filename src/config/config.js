/**
 * @module config/config
 * @description Centralized configuration module for both the BDI Executor and LLM Coordinator agents.
 * Loads environment variables and exports game parameters, connection settings, and LLM configs.
 */

import 'dotenv/config';

/**
 * Socket.io server connection host.
 * @type {string}
 */
export const SOCKET_HOST = process.env.HOST || 'http://localhost:8080';

/**
 * Unique identifiers for the agents and admin.
 * @type {{BDI_AGENT_ID: string, LLM_AGENT_ID: string, ADMIN_ID: string}}
 */
export const AGENT_IDS = {
    BDI_AGENT_ID: process.env.BDI_AGENT_ID || 'd60fa3',
    LLM_AGENT_ID: process.env.LLM_AGENT_ID || 'a0ce34',
    ADMIN_ID: process.env.ADMIN_ID || '39d92a'
};

/**
 * Connection JWT tokens.
 * @type {{BDI_TOKEN: string, LLM_TOKEN: string}}
 */
export const AGENT_TOKENS = {
    BDI_TOKEN: (process.env.TOKEN || '').trim(),
    LLM_TOKEN: (process.env.LLM_TOKEN || '').trim()
};

/**
 * OpenAI / LiteLLM server configurations.
 * @type {{baseURL: string, apiKey: string, model: string}}
 */
export const OPENAI_CONFIG = {
    baseURL: process.env.LITELLM_BASE_URL || 'https://llm.bears.disi.unitn.it/v1',
    apiKey: process.env.LITELLM_API_KEY || 'sk-5SezoNnWTgMf-3KuMRJYQw',
    model: process.env.LLM_MODEL || 'llama-3.3-70b-lmstudio'
};

/**
 * External PDDL solver API configuration.
 * Supports local and remote PAAS solver instances.
 * @type {{solverUrl: string}}
 */
export const SOLVER_CONFIG = {
    solverUrl: process.env.PAAS_HOST || 'http://localhost:5001'
};

/**
 * Cost penalty values used during pathfinding.
 * @type {{AVOID_TILE_PENALTY: number, CRATE_TILE_PENALTY: number}}
 */
export const PATHFINDING_CONFIG = {
    AVOID_TILE_PENALTY: 1000,
    CRATE_TILE_PENALTY: 50
};

/**
 * Configurable logger settings.
 */
export const LOGGER_CONFIG = {
    enableToolCalls: process.env.LOG_TOOL_CALLS !== 'false',
    enableMovement: process.env.LOG_MOVEMENT !== 'false',
    enablePolicyUpdates: process.env.LOG_POLICY_UPDATES !== 'false',
    enableMath: process.env.LOG_MATH !== 'false',
    enableP2P: process.env.LOG_P2P !== 'false',
    enablePeerStatus: process.env.LOG_PEER_STATUS === 'true',
    useColors: process.env.LOG_COLORS !== 'false'
};
