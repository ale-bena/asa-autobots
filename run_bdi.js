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
    beliefs.map.printMap();
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
// 5. Revise beliefs on every sensing update frame
socket.onSensing((sensing) => {
    if (!mapInitialized) return;
    beliefs.revise(sensing);
});

// Start BDI physical reasoning game loop
async function runGameLoop() {
    while (true) {
        if (mapInitialized && socket.connected) {
            try {
                await intentionEngine.tick();
            } catch (e) {
                console.error('[BDI] Intention tick cycle encountered error:', e.message);
            }
        }
        await new Promise(resolve => setTimeout(resolve, 16));
    }
}
runGameLoop();

// 6. Handle P2P chat messages for contract negotiation and target locking
socket.onMsg(async (senderId, _, msg) => {
    if (senderId == AGENT_IDS.LLM_AGENT_ID) {
        await p2pManager.handleIncomingChat(senderId, msg);
    }
});

socket.onDisconnect((reason) => {
    console.error(`[BDI] Socket connection disconnected (${reason}).`);
    process.exit(1);
});
