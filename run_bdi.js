/**
 * @file run_bdi.js
 * @description Bootstrap runner for the physical BDI Executor Partner Agent (Agent 1).
 * Establishes socket connection, revisions mental beliefs, and executes the intention loop.
 */

import { SOCKET_HOST, AGENT_TOKENS, AGENT_IDS } from './src/config/config.js';

// Inject variables into process.env before importing SDK client
process.env.HOST = SOCKET_HOST;
process.env.TOKEN = AGENT_TOKENS.BDI_TOKEN;

import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk/client';
import { BeliefBase } from './src/agent/BeliefBase.js';
import { IntentionEngine } from './src/agent/Intentions.js';
import { MapRepresentation } from './src/mapping/MapRepresentation.js';
import { P2PManager } from './src/communication/P2PCollaboration.js';

console.log('================================================================================');
console.log('🤖 ASA Autobots - BDI/PDDL Physical Executor Agent (Agent 1)');
console.log(`📡 Connecting to: ${SOCKET_HOST}`);
console.log('================================================================================');

const socket = DjsConnect();
const beliefs = new BeliefBase();
const intentionEngine = new IntentionEngine(beliefs, socket);
const p2pManager = new P2PManager(beliefs, socket);

// Flag to ensure intention engine starts only after map is initialized
let mapInitialized = false;

// 1. Listen for connection success
socket.onConnect(() => {
    console.log(`[BDI] Successfully connected to simulator. Socket ID: ${socket.id}`);
});

// 2. Load static map configuration on connection
socket.onMap((width, height, tiles) => {
    beliefs.map = new MapRepresentation(width, height, tiles);
    mapInitialized = true;
    console.log(`[BDI] Grid Map initialized successfully: ${width}x${height}`);
});

// 3. Keep me credentials updated
socket.onYou((you) => {
    beliefs.revise({ me: you });
});

// 4. Update configuration settings (observation distance, etc.)
socket.onConfig((config) => {
    beliefs.revise({ config });
});

// 5. Revise beliefs and run intention tick on every sensing update frame
socket.onSensing(async (sensing) => {
    if (!mapInitialized) return;

    // Revision step
    beliefs.revise(sensing);

    // Intention execution step
    try {
        await intentionEngine.tick();
    } catch (e) {
        console.error('[BDI] Intention tick cycle encountered error:', e.message);
    }
});

// 6. Handle P2P chat messages for contract negotiation and target locking
socket.onMsg((senderId, name, msg) => {
    p2pManager.handleIncomingChat(senderId, msg);
});

socket.onDisconnect(() => {
    console.warn('[BDI] Socket connection disconnected.');
});
