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
import { IntentionEngine } from './src/agent/Intentions.js';

console.log('================================================================================');
console.log('🧠 ASA Autobots - LLM Cognitive Coordinator Agent (Agent 2)');
console.log(`📡 Connecting to: ${SOCKET_HOST}`);
console.log('================================================================================');

const socket = DjsConnect();
const beliefs = new BeliefBase();
const coordinator = new LLMCoordinator(beliefs, socket);
const p2pManager = new P2PManager(beliefs, socket);
const intentionEngine = new IntentionEngine(beliefs, socket);

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

// 5. Revise beliefs on every sensing update frame
socket.onSensing((sensing) => {
    if (!mapInitialized) return;
    beliefs.revise(sensing);
});

// Start LLM Coordinator physical reasoning game loop
async function runGameLoop() {
    while (true) {
        if (mapInitialized && socket.connected) {
            try {
                await intentionEngine.tick();
            } catch (e) {
                console.error('[LLM] Intention tick cycle encountered error:', e.message);
            }
        }
        await new Promise(resolve => setTimeout(resolve, 16)); // ~60 Hz
    }
}
runGameLoop();

// 6. Intercept Admin challenge instructions and run LLM Coordinator loop
const processedMessages = new Map();

// Serialize message handling so concurrent admin/P2P messages can't interleave
// reads/writes of the shared coordinator chatHistory and beliefs state.
let messageQueue = Promise.resolve();

socket.onMsg((senderId, name, msg) => {
    // Deduplicate identical Admin prompts at ARRIVAL time (e.g. from both direct
    // Admin and BDI forwarding). This must NOT happen inside the queued handler:
    // a duplicate would sit in the queue while the first copy's (potentially
    // minutes-long) reasoning cycle runs, land outside the dedup window, and
    // re-trigger the whole sequence.
    if (senderId == AGENT_IDS.ADMIN_ID) {
        const now = Date.now();
        const lastTime = processedMessages.get(msg);
        if (lastTime !== undefined && now - lastTime < 3000) {
            console.log(`[LLM] Ignored duplicate Admin prompt (arrival dedup): "${msg}"`);
            return;
        }
        processedMessages.set(msg, now);

        // Clean up map to prevent memory growth
        for (const [m, t] of processedMessages.entries()) {
            if (now - t > 10000) {
                processedMessages.delete(m);
            }
        }

        // Queue admin messages sequentially to ensure ordered reasoning cycles
        messageQueue = messageQueue
            .then(() => processIncomingMessage(senderId, name, msg))
            .catch(e => console.error('[LLM] Error processing queued message:', e.message));
    } else {
        // Process peer P2P coordination messages immediately without queuing to avoid deadlocks
        p2pManager.handleIncomingChat(senderId, msg)
            .catch(e => console.error('[LLM] Error processing peer coordination message:', e.message));
    }
});

async function processIncomingMessage(senderId, name, msg) {
    // Check if direct or forwarded admin prompt
    let actualMsg = msg;

    if (senderId == AGENT_IDS.ADMIN_ID) {
        console.log(`\n[LLM] Intercepted Admin console message (origin/forwarded) from "${name}" (Admin: ${AGENT_IDS.ADMIN_ID}): "${actualMsg}"`);

        try {
            const reply = await coordinator.handleAdminPrompt(actualMsg);
            if (reply) {
                console.log(`[LLM] Completed reasoning cycle. Output: "${reply}"`);
                await socket.emitSay(AGENT_IDS.ADMIN_ID, reply);
                await coordinator.P2P(
                    AGENT_IDS.BDI_AGENT_ID,
                    {
                        type: 'INSTRUCT_SAY',
                        message: reply,
                    });
            } else {
                console.log('[LLM] Completed reasoning cycle with empty output (no public chat reply needed).');
            }
        } catch (e) {
            console.error('[LLM] Error executing LLM reasoning loop:', e.message);
        }
    } else {
        // Delegate P2P messages to coordination manager
        await p2pManager.handleIncomingChat(senderId, msg);
    }
}

socket.onDisconnect((reason) => {
    console.warn(`[LLM] Socket connection disconnected (${reason}).`);
    // 'io server disconnect' = the server deliberately closed the session;
    // socket.io does NOT auto-reconnect in that case - retry manually.
    if (reason === 'io server disconnect') {
        console.warn('[LLM] Server-initiated disconnect. Attempting manual reconnect in 2s...');
        setTimeout(() => {
            if (!socket.connected) socket.connect();
        }, 2000);
    }
});
