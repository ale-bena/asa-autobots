<main class="main-content">
<header>
<div>
<h1>💻 Possible JavaScript Design of the Project</h1>
<div class="subtitle">Complete implementation design for the multi-agent cooperative loop in Node.js (ES Modules)</div>
</div>
<div>
<button class="btn btn-secondary" onclick="clearAllComments()" style="font-size:0.75rem; border-color: rgba(239, 68, 68, 0.2); color: #ef4444; background: rgba(239, 68, 68, 0.05);">🧹 Clear Annotations</button>
</div>
</header>

<!-- 1. JS Design Overview -->
<section id="js-overview">
<div class="section-header">
<div class="section-num">1</div>
<h2>JavaScript Design Overview</h2>
</div>
<p class="commentable" data-comment-id="overview-p1">
The `asa-autobots` multi-agent execution framework is designed using **ES Modules (ESM)** in Node.js. 
It separates the cognitive coordinating layer (handled by an LLM-informed coordinator module) from the physical execution layer (modeled as a belief-desire-intention control loop in the BDI Agent).
</p>

<div class="alert alert-info">
<strong>Design Principle:</strong> We model physical plans as asynchronous JavaScript generator objects (`function*`). This allows intention cycles to step through long-running path steps sequentially, yielding control back to sensory revision filters between individual grid cell transitions.
</div>

<div class="card commentable" data-comment-id="arch-card">
<div class="card-title">System Architecture Block Layout</div>
<p>Below is the modular flow of information between Socket.io sensing, Belief Base revision, and the Planning generator loops.</p>
<p style="font-size:0.9rem; margin-top:0.5rem; color:var(--text-muted);">
<strong>Generator Functions Utility:</strong> JavaScript Generator functions (`function*`) are highly beneficial for BDI planning. They allow complex, long-running recipes (like traversing a path of 15 tiles) to hold their execution state (such as the current path index) across separate asynchronous ticks. By yielding on every step, the loop can perform sensory belief revisions and check preemptive conditions between tiles, avoiding un-interruptible promise chains.
</p>

<div class="diagram-container">
<!-- Node Positions -->
<div class="node node-dark" style="position: absolute; left: 4%; top: 160px; width: 24%; height: 40px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">Socket.io Sensing / Actions</div>
<div class="node node-primary" style="position: absolute; left: 4%; top: 30px; width: 24%; height: 40px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">P2PManager.js (Chat Sync)</div>
<div class="node node-primary" style="position: absolute; left: 38%; top: 30px; width: 26%; height: 40px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">BeliefBase.js (Mental State)</div>
<div class="node node-primary" style="position: absolute; left: 38%; top: 160px; width: 26%; height: 40px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">Intentions.js (BDI Loop)</div>
<div class="node node-secondary" style="position: absolute; left: 38%; top: 290px; width: 26%; height: 40px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">LLMCoordinator.js (Cognitive)</div>
<div class="node node-secondary" style="position: absolute; left: 74%; top: 160px; width: 22%; height: 40px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">PlanLibrary.js (Generators)</div>

<svg width="100%" height="100%" style="position: absolute; top:0; left:0; pointer-events:none;">
<defs>
<marker id="arrow-gray" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
<path d="M 0 1.5 L 7 5 L 0 8.5 z" fill="#4b5563" />
</marker>
<marker id="arrow-primary" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
<path d="M 0 1.5 L 7 5 L 0 8.5 z" fill="#6366f1" />
</marker>
<marker id="marker-arrow-primary-end" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
<path d="M 0 1.5 L 7 5 L 0 8.5 z" fill="#6366f1" />
</marker>
<marker id="arrow-secondary" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
<path d="M 0 1.5 L 7 5 L 0 8.5 z" fill="#a855f7" />
</marker>
</defs>

<!-- 1. SocketManager -> BeliefBase (Sensing events) -->
<path d="M 16% 160 L 16% 110 L 51% 110 L 51% 72" stroke="#4b5563" stroke-width="1.5" stroke-dasharray="none" marker-end="url(#arrow-gray)" fill="none" />

<!-- 2. BeliefBase -> Intentions (Mental state feeds execution) -->
<path d="M 51% 70 L 51% 158" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="3,3" marker-end="url(#arrow-primary)" fill="none" />

<!-- 3. Intentions -> PlanLibrary (Invocation of generators) -->
<path d="M 64% 180 L 73% 180" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-secondary)" fill="none" />

<!-- 4. PlanLibrary -> SocketManager (Physical actions execution dispatch) -->
<path d="M 85% 200 L 85% 250 L 16% 250 L 16% 202" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-secondary)" fill="none" />

<!-- 5. P2P Chat Transport (Bidirectional) -->
<!-- SocketManager -> P2PManager (Incoming Chat) -->
<path d="M 20% 160 L 20% 72" stroke="#6366f1" stroke-width="1.5" marker-end="url(#arrow-primary)" fill="none" />
<!-- P2PManager -> SocketManager (Outgoing Chat Broadcast) -->
<path d="M 12% 70 L 12% 158" stroke="#6366f1" stroke-width="1.5" marker-end="url(#arrow-primary)" fill="none" />

<!-- 6. P2PManager -> BeliefBase (Registers Lock/Contract states) -->
<path d="M 28% 50 L 37% 50" stroke="#6366f1" stroke-width="1.5" marker-end="url(#arrow-primary)" fill="none" />

<!-- 7. LLMCoordinator -> BeliefBase (Cognitive Policy Rules Injection) -->
<path d="M 38% 310 L 32% 310 L 32% 60 L 37% 60" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-secondary)" fill="none" />

<!-- 8. LLMCoordinator -> Intentions (Direct Directive overrides) -->
<path d="M 51% 290 L 51% 202" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-secondary)" fill="none" />

<!-- 9. SocketManager -> LLMCoordinator (Admin prompt interception) -->
<path d="M 16% 200 L 16% 270 L 38% 270" stroke="#4b5563" stroke-width="1.5" marker-end="url(#arrow-gray)" fill="none" />

<!-- 10. BeliefBase -> LLMCoordinator (Cognitive State Queries) -->
<path d="M 64% 50 L 70% 50 L 70% 310 L 64% 310" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-secondary)" fill="none" />

<!-- 11. LLMCoordinator -> P2PManager (Outgoing Handoff/Contract proposals) -->
<path d="M 38% 310 L 2% 310 L 2% 50 L 4% 50" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-secondary)" fill="none" />
</svg>
</div>

<div style="margin-top: 1.5rem; border-top: 1px solid var(--border-color); padding-top: 1.25rem;">
    <h4 style="color: var(--primary); font-size: 0.95rem; margin-bottom: 0.5rem;">Detailed Connection Interactions</h4>
    <ul style="list-style-type: none; padding-left: 0; font-size: 0.85rem; color: var(--text-muted); display: grid; grid-template-columns: 1fr; gap: 0.5rem;">
        <li><strong>Sensing and Updates (1):</strong> The <code>SocketManager</code> captures raw socket feeds (positions, rewards, crates) and pushes them to the <code>BeliefBase</code> to revise the agent's mental state.</li>
        <li><strong>Mental State Feed (2):</strong> The <code>IntentionEngine</code> queries local beliefs on every tick to verify plan preconditions and calculate parcel utilities.</li>
        <li><strong>Generator Step Routing (3 & 4):</strong> Intentions loops step through active generators in <code>PlanLibrary</code> (3) and yield physical steps (move, pickup, putdown) dispatched to the socket handler (4).</li>
        <li><strong>P2P Sync Loops (5 & 6):</strong> Incoming chat messages are intercepted, validated, and parsed by the <code>P2PManager</code> (5) to inject contract states and locks into the <code>BeliefBase</code> (6) to coordinate and avoid racing.</li>
        <li><strong>LLM Directives and Policies (7 & 8):</strong> The cognitive <code>LLMCoordinator</code> translates mission constraints into active rules injected into the <code>BeliefBase</code> (7) or overrides the active BDI loop (8) with high-priority directives.</li>
        <li><strong>LLM Input Sensing (9):</strong> The <code>SocketManager</code> forwards administrative text instructions and mission challenge prompts to the <code>LLMCoordinator</code>.</li>
        <li><strong>LLM Mental Queries (10):</strong> The <code>LLMCoordinator</code> pulls current beliefs (such as carrying statistics or parcel positions) from the <code>BeliefBase</code> to run reasoning checks and resolve mathematical formulas.</li>
        <li><strong>LLM Outgoing Contracts (11):</strong> The <code>LLMCoordinator</code> dispatches contract proposals (like P2P Rendezvous) through the <code>P2PManager</code>, which broadcasts them into the game chat.</li>
    </ul>
</div>
</div>
</div>
</section>

<!-- 2. Core Modules & Classes -->
<section id="js-modules">
<div class="section-header">
<div class="section-num">2</div>
<h2>Core Modules & Classes</h2>
</div>
<p class="commentable" data-comment-id="modules-p1">
The codebase is structured into cohesive modules with distinct responsibilities to ensure separation of concerns:
</p>

<!-- MapRepresentation class -->
<div class="card commentable" data-comment-id="map-spec">
<div class="card-title">MapRepresentation.js</div>
<p>Stores grid coordinates, static corridor widths, one-way tiles, and dynamic obstacle crate layout mapping. Provides local A* pathfinding and adjacency check predicates.</p>
<p style="font-size:0.9rem; margin-bottom:1rem; color:var(--text-muted);">
<strong>Representation & Optimizations:</strong> To ensure A* execution finishes in &lt; 1ms, map layouts are represented in flat one-dimensional TypedArrays (like `Uint8Array`) or queried using spatial-indexed libraries (like quadtrees) rather than nested JavaScript objects.
<br><br>
<strong>Macro-Clustering:</strong> Segmenting the map into regional sectors or clusters allows the high-level PDDL planner to compute coarse route priorities across regions (reducing state-space complexity), while local A* navigates micro-cells inside the current region.
</p>

<div class="terminal-window">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">MapRepresentation.js</span>
</div>
<div class="terminal-body">
<pre><code>export class MapRepresentation {
    constructor(width, height, tiles) {
        this.width = width;
        this.height = height;
        this.tiles = tiles; // Grid of tile type definitions
        this.crates = new Map(); // Dynamic mapping of crateId -> {x, y}
    }

    isAdjacent(t1, t2) {
        // Directed adjacency query (supports one-way tunnels)
        return this.tiles[t1.x][t1.y].adjacencies.some(t => t.x === t2.x && t.y === t2.y);
    }

    findShortestPath(from, to, avoidCoords = []) {
        // Standard A* search algorithm returning array of coordinates [{x, y}]
        return aStarPathfinder(this, from, to, avoidCoords);
    }
}</code></pre>
</div>
</div>
</div>

<!-- BeliefBase class -->
<div class="card commentable" data-comment-id="beliefs-spec">
<div class="card-title">BeliefBase.js</div>
<p>Maintains local mental states of the agent, including parcel layouts, coordinate estimates, other agent stats, and established coordination contracts.</p>
<p style="font-size:0.9rem; margin-bottom:1rem; color:var(--text-muted);">
<strong>Flexible Policy Rules:</strong> To avoid static rules breaking when matches drift, policy rules (avoidance zones, thresholds) are represented as AST-based string conditions (e.g. <code>"carrying.size >= 3 && score < 200"</code>) compiled dynamically at runtime, allowing the evaluation engine to compute active blocks on the fly.
</p>

<div class="terminal-window">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">BeliefBase.js</span>
</div>
<div class="terminal-body">
<pre><code>export class BeliefBase {
    constructor() {
        this.me = { id: '', x: 0, y: 0, score: 0, carrying: [] };
        this.parcels = new Map(); // parcelId -> {x, y, reward, decay}
        this.peers = new Map(); // agentId -> {x, y, score}
        this.activeContracts = new Map(); // coopId -> contract details
        this.lockedTargets = new Set(); // Parcel IDs targeted by self or peer
        this.policyRules = {
            avoidTiles: [],
            minRewardThreshold: 0,
            maxRewardLimit: Infinity
        };
    }

    revise(sensorPayload) {
        // Belief Revision: Merge sensory changes into local state
        if (sensorPayload.me) Object.assign(this.me, sensorPayload.me);
        if (sensorPayload.parcels) {
            this.parcels.clear();
            sensorPayload.parcels.forEach(p => this.parcels.set(p.id, p));
        }
        // Purge expired rendezvous contracts or decayed parcels
        this.cleanStaleBeliefs();
    }
}</code></pre>
</div>
</div>
</div>
</section>

<!-- 3. BDI Generator Loop -->
<section id="bdi-loop">
<div class="section-header">
<div class="section-num">3</div>
<h2>The Generator-Based Intentions Loop</h2>
</div>
<p class="commentable" data-comment-id="loop-p1">
Traditional async/await loops in JavaScript are difficult to interrupt. By using **JavaScript Generators (`function*`)**, our BDI execution engine can run planning recipes step-by-step. 
If a high-priority cooperative contract arrives during step 3 of a 10-step travel recipe, the intention loop can immediately yield, push the current generator to a *Suspended Stack*, and swap execution contexts.
</p>

<div class="card commentable" data-comment-id="intention-loop-code">
<div class="card-title">Intentions.js Execution Engine</div>
<p>The main loop ticking on every sensory frame updates local intentions and steps through active generators:</p>

<div class="terminal-window">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">Intentions.js</span>
</div>
<div class="terminal-body">
<pre><code>export class IntentionEngine {
    constructor(beliefs, socket) {
        this.beliefs = beliefs;
        this.socket = socket;
        this.activeGenerator = null;
        this.suspendedStack = [];
    }

    async tick() {
        // 1. Evaluate BDI rules to see if we should preempt the active plan
        const bestGoal = this.selectBestGoal();
        
        if (this.shouldPreemptActivePlan(bestGoal)) {
            if (this.activeGenerator) {
                console.log("[BDI] Preempting active plan. Suspending context...");
                this.suspendedStack.push(this.activeGenerator);
            }
            this.activeGenerator = this.instantiatePlanRecipe(bestGoal);
        }

        // 2. Step the active plan generator by one step
        if (this.activeGenerator) {
            const stepResult = this.activeGenerator.next();
            
            if (stepResult.done) {
                console.log("[BDI] Active plan completed.");
                // Resume previous plan if stack is not empty
                this.activeGenerator = this.suspendedStack.pop() || null;
            } else {
                // Execute physical action yielded by the generator
                const action = stepResult.value;
                await this.dispatchAction(action);
            }
        }
    }
}</code></pre>
</div>
</div>
</div>

<div class="alert alert-tip">
<strong>Tip:</strong> Plan recipes yield objects like `{ type: 'MOVE', x: 2, y: 3 }` or `{ type: 'PICKUP' }`. This structure makes debugging planning decisions extremely simple as plan outputs are plain JSON structures.
<br><br>
<strong>Nesting Recipes:</strong> Plan recipes can contain highly complex and nested sequences. By using the JavaScript delegation operator <code>yield*</code>, a macro-recipe can delegate execution to micro-recipes. For example:
<pre style="margin-top: 0.5rem; font-family: var(--font-mono); font-size: 0.8rem; background: rgba(0,0,0,0.3); padding: 0.5rem; border-radius: 4px; color: var(--accent-cyan);"><code>function* CollectAndDeliverRecipe(parcel, zone) {
    yield* this.NavigateTo(parcel.x, parcel.y);
    yield { type: 'PICKUP' };
    yield* this.NavigateTo(zone.x, zone.y);
    yield { type: 'DROP' };
}</code></pre>

<div style="margin-top: 1.5rem; padding: 1rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px;">
    <h4 style="color: var(--primary); font-size: 0.95rem; margin-bottom: 0.75rem;">Plan Library Design Rules & Nested Delegation</h4>
    <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.5;">
        To maintain clean code and separation of concerns, the BDI agent designs recipes using ES6 Generators (<code>function*</code>). By yielding atomic commands, the execution loop is kept non-blocking, and mental states can be revised between movements. Nested plans delegate execution to child plans using generator delegation (<code>yield*</code>).
    </p>
    
    <h5 style="color: var(--accent-cyan); font-size: 0.85rem; margin-bottom: 0.5rem;">Core BDI Recipe Classifications</h5>
    <ul style="list-style-type: none; padding-left: 0; font-size: 0.85rem; color: var(--text-muted); display: grid; grid-template-columns: 1fr; gap: 0.75rem;">
        <li style="background: rgba(255,255,255,0.02); padding: 0.75rem; border-radius: 6px; border-left: 3px solid var(--accent-cyan);">
            <strong>1. Atomic Actions (Basic Operators)</strong><br>
            The primitive execution steps dispatched directly to the game server. These yield a simple structural token specifying the action type and target coordinates (e.g. <code>yield { type: 'MOVE', x, y }</code>, <code>yield { type: 'PICKUP' }</code>).
        </li>
        <li style="background: rgba(255,255,255,0.02); padding: 0.75rem; border-radius: 6px; border-left: 3px solid var(--primary);">
            <strong>2. Composite Procedures (Hierarchical Tasks)</strong><br>
            Recipes that delegate execution to sub-recipes or algorithms using generator delegation (<code>yield*</code>). For instance, A* path navigation is a Composite Procedure that takes destination coordinates, computes a cell list, and delegates to a sequence of Atomic MOVE actions:
            <pre style="margin-top: 0.5rem; background: rgba(0,0,0,0.2); padding: 0.5rem; border-radius: 4px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-main);"><code>function* NavigateTo(tx, ty) {
    const path = this.map.findShortestPath(this.beliefs.me, {x: tx, y: ty});
    for (const step of path) {
        yield { type: 'MOVE', x: step.x, y: step.y };
    }
}</code></pre>
        </li>
        <li style="background: rgba(255,255,255,0.02); padding: 0.75rem; border-radius: 6px; border-left: 3px solid var(--secondary);">
            <strong>3. Cooperative Strategies (Negotiated Agreements)</strong><br>
            Plans containing interactive coordination checkpoints that synchronize behavior with other agents. They yield structural lock claims, verify active peer contracts before proceeding, or wait at rendezvous cells until handoff handshakes are verified:
            <pre style="margin-top: 0.5rem; background: rgba(0,0,0,0.2); padding: 0.5rem; border-radius: 4px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-main);"><code>function* CooperativeDeliver(parcel, peerId, meetingPoint) {
    yield { type: 'LOCK_TARGET', targetId: parcel.id };
    yield* this.NavigateTo(parcel.x, parcel.y);
    yield { type: 'PICKUP' };
    yield* this.NavigateTo(meetingPoint.x, meetingPoint.y);
    yield { type: 'WAIT_FOR_PEER', peerId: peerId }; // Wait until P2P contract is active
    yield { type: 'DROP' };
}</code></pre>
        </li>
        <li style="background: rgba(255,255,255,0.02); padding: 0.75rem; border-radius: 6px; border-left: 3px solid var(--accent-orange);">
            <strong>4. Obstacle / Corridor Clearing (PDDL Solver Invocation)</strong><br>
            Triggered when pathfinding encounters a blocking crate crate. Pauses standard recipes, invokes the PDDL client to resolve the pushing sequence, executes the step-by-step pushes, and resumes the previous plan.
        </li>
    </ul>
</div>
</div>
</section>

<!-- 4. P2P Chat Sync Flow -->
<section id="p2p-chat">
<div class="section-header">
<div class="section-num">4</div>
<h2>Peer-to-Peer Chat Synchronization Flow</h2>
</div>
<p class="commentable" data-comment-id="p2p-p1">
Because agents communicate using game chat, the collaboration wrapper validates message schema formats using regex checks before parsing payloads. 
Below is the sequential message parsing design:
</p>

<div class="card commentable" data-comment-id="p2p-manager-code">
<div class="card-title">P2PCollaboration.js Implementation</div>

<div class="terminal-window">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">P2PCollaboration.js</span>
</div>
<div class="terminal-body">
<pre><code>export class P2PManager {
    constructor(beliefs, socket) {
        this.beliefs = beliefs;
        this.socket = socket;
        this.msgRegex = /^\{"type":"[A-Z_]+".*\}$/; // Chat schema filter
    }

    handleIncomingChat(senderId, rawMessage) {
        // 1. Pre-validate text structure
        if (!this.msgRegex.test(rawMessage)) return;

        try {
            const message = JSON.parse(rawMessage);
            console.log(`[P2P] Parsed message from ${senderId}:`, message.type);

            switch (message.type) {
                case 'PROPOSE_CONTRACT':
                    this.evaluateProposedContract(senderId, message);
                    break;
                case 'ACCEPT_CONTRACT':
                    this.confirmActiveContract(message.coopId);
                    break;
                case 'LOCK_TARGET':
                    this.beliefs.lockedTargets.add(message.targetId);
                    break;
                case 'RELEASE_TARGET':
                    this.beliefs.lockedTargets.delete(message.targetId);
                    break;
            }
        } catch (e) {
            console.error("[P2P] Corrupted chat JSON payload skipped", e);
        }
    }

    broadcast(message) {
        const rawString = JSON.stringify(message);
        this.socket.emit('say', rawString);
    }
}</code></pre>
</div>
</div>
</div>

<div class="card commentable" data-comment-id="p2p-manager-code">
<div class="card-title">P2P Collaboration Context & Usage Examples</div>
<p><strong>Purpose in context:</strong> The P2PManager coordinates multi-agent target locking and contract transitions. It ensures that if Agent A targets parcel 5, Agent B receives a <code>LOCK_TARGET</code> signal and avoids routing towards the same package, resolving resource contention in real-time.</p>
<p><strong>Example 1: Target locking</strong></p>
<pre style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 6px; font-family: var(--font-mono); font-size: 0.8rem; color: var(--accent-cyan); margin-bottom: 1rem;"><code>// When Agent A targets parcel_99:
p2p.broadcast({ type: 'LOCK_TARGET', targetId: 'parcel_99' });

// Agent B receives this, handleIncomingChat executes:
beliefs.lockedTargets.add('parcel_99'); 
// Agent B's plan selector now skips parcel_99 when evaluating rewards.</code></pre>
<p><strong>Example 2: Proposing a Handoff Contract</strong></p>
<pre style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 6px; font-family: var(--font-mono); font-size: 0.8rem; color: var(--accent-cyan);"><code>// LLM Coordinator proposes exchange:
p2p.broadcast({ 
    type: 'PROPOSE_CONTRACT', 
    coopId: 'coop_88', 
    x: 10, 
    y: 12 
});

// Partner receives proposal:
// 1. Checks if rendezvous coordinate (10,12) is reachable.
// 2. Broadcasts accept message:
p2p.broadcast({ type: 'ACCEPT_CONTRACT', coopId: 'coop_88' });</code></pre>
</div>

<div class="card commentable" data-comment-id="p2p-state-analysis" style="margin-top: 1.5rem;">
<div class="card-title">Architectural Trade-Offs: Decoupled Replicated State vs. Centralized State Handler</div>
<p>To coordinate targets and prevent agents from racing to achieve the same objectives (e.g., both pathing to pick up the exact same parcel), we evaluate two primary coordination architectures:</p>

<table style="width: 100%; border-collapse: collapse; margin-top: 1rem; margin-bottom: 1rem; font-size: 0.85rem; border: 1px solid var(--border-color);">
<thead>
<tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border-color);">
<th style="padding: 0.6rem; text-align: left; border-right: 1px solid var(--border-color);">Architecture</th>
<th style="padding: 0.6rem; text-align: left; border-right: 1px solid var(--border-color);">Pros</th>
<th style="padding: 0.6rem; text-align: left;">Cons & Failure Modes</th>
</tr>
</thead>
<tbody>
<tr style="border-bottom: 1px solid var(--border-color);">
<td style="padding: 0.6rem; border-right: 1px solid var(--border-color); font-weight: bold; color: var(--accent-cyan);">Decoupled Replicated State (Our Choice)</td>
<td style="padding: 0.6rem; border-right: 1px solid var(--border-color); color: var(--text-main);">
- **No Single Point of Failure:** Agents remain fully autonomous and can proceed even if a connection drops.<br>
- **Zero Query Latency:** Checks are run locally on the agent's memory base in &lt; 1ms.<br>
- **Real-Time Responsiveness:** Decision loops run locally.
</td>
<td style="padding: 0.6rem; color: var(--text-muted);">
- **Eventual Consistency:** State updates must sync via chat, meaning momentary race conditions can occur before locks propagate.<br>
- **Requires Conflict Resolution:** Needs rules to break simultaneous lock claims (e.g. comparing hash or agent ID).
</td>
</tr>
<tr>
<td style="padding: 0.6rem; border-right: 1px solid var(--border-color); font-weight: bold; color: var(--secondary);">Centralized State Handler</td>
<td style="padding: 0.6rem; border-right: 1px solid var(--border-color); color: var(--text-main);">
- **Guaranteed Consistency:** Atomic lock operations on a single server prevent any double-allocations or racing.<br>
- **Simpler Logic:** Eliminates peer-to-peer sync message code and state merging.
</td>
<td style="padding: 0.6rem; color: var(--text-muted);">
- **System Bottleneck:** Network overhead and request latency on every intention cycle tick.<br>
- **Single Point of Failure:** If the centralized coordinator drops or lags, the entire multi-agent system stalls.
</td>
</tr>
</tbody>
</table>

<h4 style="margin-top: 1rem; color: var(--accent-cyan); font-size: 0.95rem;">Preventing Racing with Optimistic Lock Claims</h4>
<p style="font-size: 0.9rem; margin-top: 0.25rem;">
To solve the eventual consistency problem of decoupled replicated state, agents use **Optimistic Lock Claims**. 
When evaluating paths, the planner filters out any parcels listed in <code>beliefs.lockedTargets</code>. 
To secure a parcel:
</p>
<ol style="margin-left: 1.5rem; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-muted);">
<li style="margin-bottom: 0.4rem;">The agent broadcasts <code>{"type":"LOCK_TARGET","targetId":"parcel_99"}</code> immediately upon planning selection.</li>
<li style="margin-bottom: 0.4rem;">It waits 1 tick. If no conflict message with a higher priority (e.g., lower agent ID claiming the same target) is received, the lock is considered secured.</li>
<li style="margin-bottom: 0.4rem;">If a conflict occurs, the losing agent releases the lock, revises its beliefs, and selects an alternative target.</li>
</ol>

<div style="margin-top: 1.5rem; padding: 1rem; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px;">
    <h4 style="color: var(--primary); font-size: 0.95rem; margin-bottom: 0.5rem;">Recommended Script Architecture & Sync Recommendation</h4>
    <p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1rem;">
        Addressing the design choice of running a centralized coordinator versus duplicating state across independent agent scripts:
    </p>
    <p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1rem;">
        <strong>Our Recommendation: Separate Scripts with Message-Synchronized Replicated States.</strong><br>
        We strongly recommend running each agent in its own separate node script process (e.g., <code>run_bdi.js</code> and <code>run_llm.js</code>). Each agent maintains its own local copy of the <code>BeliefBase</code>, and they synchronize knowledge in real-time over the game chat channel using <code>P2PCollaboration.js</code>.
    </p>
    <p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.5;">
        This decoupled design guarantees that the physical executor (BDI Loop) can execute path moves and make A* decisions instantly (&lt; 1ms) in local memory without blocking on network requests to a centralized state engine. By utilizing **Optimistic Lock Claims** with simple tie-breaking priority rules (e.g., lower agent ID wins in a concurrent lock request), we completely eliminate target racing and coordinate safely without introducing a single point of failure or high query latency.
    </p>
</div>
</div>
</section>

<!-- 5. PDDL-JS Solver Bridge -->
<section id="pddl-js">
<div class="section-header">
<div class="section-num">5</div>
<h2>The PDDL-JS Solver Bridge</h2>
</div>
<p class="commentable" data-comment-id="pddl-p1">
When the agent detects corridor blockages (crates), it leverages the external PDDL planning service. The bridge compiles the map state to standard PDDL facts, submits the query to the remote solver, and parses the output plan array back into generator actions.
</p>

<div class="card commentable" data-comment-id="pddl-bridge-spec">
<div class="card-title">PddlServiceBridge.js Design</div>

<div class="terminal-window">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">PddlServiceBridge.js</span>
</div>
<div class="terminal-body">
<pre><code>import fetch from 'node-fetch';

export class PddlServiceBridge {
    constructor(solverUrl = 'http://localhost:8080/solve') {
        this.solverUrl = solverUrl;
    }

    async solveObstaclePush(mapRep, agentPos, cratePos, targetPos) {
        // 1. Generate PDDL initial state facts
        const domain = await this.loadDomainPddl();
        const problem = this.compileProblemPddl(mapRep, agentPos, cratePos, targetPos);

        // 2. Submit payload to remote PDDL-as-a-service
        const response = await fetch(this.solverUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, problem })
        });

        if (!response.ok) throw new Error("PDDL solver failed");
        
        const result = await response.json();
        return this.parsePddlPlan(result.plan); // Returns [{action: 'move', from, to}, ...]
    }

    compileProblemPddl(map, agent, crate, target) {
        // Generates problem string matching the PDDL syntax
        return `(define (problem crate-push)
            (:domain deliveroo)
            (:objects 
                ${map.tiles.flatMap(t => `tile_${t.x}_${t.y}`).join(' ')} - tile
                agent_autobot - agent
                obstacle_crate - crate
            )
            (:init 
                (at agent_autobot tile_${agent.x}_${agent.y})
                (crate-at obstacle_crate tile_${crate.x}_${crate.y})
                ;; Add collinear directions and adjacency predicates
            )
            (:goal (crate-at obstacle_crate tile_${target.x}_${target.y}))
        )`;
    }
}</code></pre>
</div>
</div>
</div>

<div class="alert alert-info">
<strong>PDDL Client Library Integration:</strong> Rather than writing raw regex text parsers, our implementation leverages the parsing utilities provided in the <code>@unitn-asa/pddl-client</code> library. This package exports structured parser functions that parse PDDL action structures (e.g. `(push-crate agent_autobot obstacle_crate tile_4_5 tile_4_6 tile_4_7)`) into normalized JavaScript objects, containing details like `action`, `parameters`, and `collinear_path`.
</div>
</section>

</main>