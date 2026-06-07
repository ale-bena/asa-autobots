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
        if (mapInitialized) {
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

socket.onMsg(async (senderId, name, msg) => {
    // Check if direct or forwarded admin prompt
    let isAdminPrompt = false;
    let actualMsg = msg;
    let adminId = AGENT_IDS.ADMIN_ID;

    const isDirectAdmin = name === 'admin' || senderId === AGENT_IDS.ADMIN_ID;
    const isBdiAgent = senderId === AGENT_IDS.BDI_AGENT_ID || (name && (name.includes('pddl') || name.includes('executor') || name.startsWith('autobots_pddl')));

    if (isDirectAdmin) {
        isAdminPrompt = true;
        adminId = senderId;
    } else if (isBdiAgent && msg.startsWith('FORWARDED_FROM_ADMIN:')) {
        isAdminPrompt = true;
        const parts = msg.split(':');
        adminId = parts[1];
        actualMsg = parts.slice(2).join(':');
    }

    if (isAdminPrompt) {
        // Deduplicate recent identical messages (e.g. from both direct Admin and BDI forwarding)
        const now = Date.now();
        if (processedMessages.has(actualMsg)) {
            const lastTime = processedMessages.get(actualMsg);
            if (now - lastTime < 3000) {
                console.log(`[LLM] Ignored duplicate Admin prompt: "${actualMsg}"`);
                return;
            }
        }
        processedMessages.set(actualMsg, now);

        // Clean up map to prevent memory growth
        for (const [m, t] of processedMessages.entries()) {
            if (now - t > 10000) {
                processedMessages.delete(m);
            }
        }

        console.log(`\n[LLM] Intercepted Admin console message (origin/forwarded) from "${name}" (Admin: ${adminId}): "${actualMsg}"`);

        try {
            const reply = await coordinator.handleAdminPrompt(actualMsg);
            if (reply && reply.trim() !== '') {
                console.log(`[LLM] Completed reasoning cycle. Output: "${reply}"`);
                if (isDirectAdmin) {
                    // Speak response back to Admin console using dynamic adminId
                    await socket.emitSay(adminId, reply);
                } else {
                    // Send P2P command to BDI agent to reply to Admin console
                    console.log(`[LLM] Forwarded prompt detected. Instructing BDI agent to reply to Admin (${adminId}).`);
                    await coordinator.broadcastP2P({
                        type: 'INSTRUCT_SAY',
                        message: reply,
                        adminId: adminId
                    });
                }
            } else {
                console.log('[LLM] Completed reasoning cycle with empty output (no public chat reply needed).');
            }
        } catch (e) {
            console.error('[LLM] Error executing LLM reasoning loop:', e.message);
            const errorMsg = 'An error occurred during LLM reasoning execution.';
            if (isDirectAdmin) {
                await socket.emitSay(adminId, errorMsg);
            } else {
                await coordinator.broadcastP2P({
                    type: 'INSTRUCT_SAY',
                    message: errorMsg,
                    adminId: adminId
                });
            }
        }
    } else {
        // Delegate P2P messages to coordination manager
        await p2pManager.handleIncomingChat(senderId, msg);
    }
});

socket.onDisconnect(() => {
    console.warn('[LLM] Socket connection disconnected.');
});
