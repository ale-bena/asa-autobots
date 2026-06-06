/**
 * @file run_llm.js
 * @description Bootstrap runner for the cognitive LLM Coordinator Agent (Agent 2).
 * Connects to the server, listens for Admin challenge messages, and runs LLM reasoning cycles.
 */

import { SOCKET_HOST, AGENT_TOKENS, AGENT_IDS } from './src/config/config.js';

// Inject LLM agent token into process.env before importing client SDK
process.env.HOST = SOCKET_HOST;
process.env.TOKEN = AGENT_TOKENS.LLM_TOKEN;

import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk/client';
import { BeliefBase } from './src/agent/BeliefBase.js';
import { LLMCoordinator } from './src/llm/LLMCoordinator.js';
import { MapRepresentation } from './src/mapping/MapRepresentation.js';
import { P2PManager } from './src/communication/P2PCollaboration.js';

console.log('================================================================================');
console.log('🧠 ASA Autobots - LLM Cognitive Coordinator Agent (Agent 2)');
console.log(`📡 Connecting to: ${SOCKET_HOST}`);
console.log('================================================================================');

const socket = DjsConnect();
const beliefs = new BeliefBase();
const coordinator = new LLMCoordinator(beliefs, socket);
const p2pManager = new P2PManager(beliefs, socket);

let mapInitialized = false;

// 1. Listen for connection success
socket.onConnect(() => {
    console.log(`[LLM] Successfully connected to simulator. Socket ID: ${socket.id}`);
});

// 2. Load static map configuration on connection
socket.onMap((width, height, tiles) => {
    beliefs.map = new MapRepresentation(width, height, tiles);
    mapInitialized = true;
    console.log(`[LLM] Grid Map initialized successfully: ${width}x${height}`);
});

// 3. Keep me credentials updated
socket.onYou((you) => {
    beliefs.revise({ me: you });
});

// 4. Update configuration settings (observation distance, etc.)
socket.onConfig((config) => {
    beliefs.revise({ config });
});

// 5. Revise beliefs on every sensing update frame
socket.onSensing((sensing) => {
    if (!mapInitialized) return;
    beliefs.revise(sensing);
});

// 6. Intercept Admin challenge instructions and run LLM Coordinator loop
socket.onMsg(async (senderId, name, msg) => {
    // Intercept instructions from the Admin ID
    if (senderId === AGENT_IDS.ADMIN_ID) {
        console.log(`\n[LLM] Intercepted Admin console message from "${name}" (${senderId}): "${msg}"`);

        // Run cognitive reasoning loop
        try {
            const reply = await coordinator.handleAdminPrompt(msg);
            console.log(`[LLM] Completed reasoning cycle. Output: "${reply}"`);

            // Speak response back to Admin console
            socket.emit('say', reply);
        } catch (e) {
            console.error('[LLM] Error executing LLM reasoning loop:', e.message);
            socket.emit('say', 'An error occurred during LLM reasoning execution.');
        }
    } else {
        // Delegate P2P messages to coordination manager
        p2pManager.handleIncomingChat(senderId, msg);
    }
});

socket.onDisconnect(() => {
    console.warn('[LLM] Socket connection disconnected.');
});
