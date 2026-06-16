<main class="main-panel">

<header style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-color); padding-bottom: 1.5rem; margin-bottom: 3rem;">
<div>
<div class="badge-header">Specification & Architecture Spec</div>
<h1>ASA Autobots Overhaul</h1>
<div class="subtitle">Complete textual requirements and architecture model for cooperative Deliveroo agents.</div>
</div>
<div>
<button class="btn btn-secondary" onclick="clearAllComments()" style="font-size:0.75rem; border-color: rgba(239, 68, 68, 0.2); color: #ef4444; background: rgba(239, 68, 68, 0.05);">🧹 Clear Annotations</button>
</div>
</header>

<!-- 1. Overview & Goals -->
<section id="overview">
<div class="section-header">
<div class="section-num">1</div>
<h2>Project Overview & Strategic Goals</h2>
</div>
<p class="commentable" data-comment-id="overview-p1">The goal of this project is to build a highly cooperative, hybrid multi-agent delivery team operating inside the <strong>Deliveroo</strong> grid-world environment. The environment consists of a spatial grid with obstacles, spawn zones, delivery zones, moving packages, and blocking crates that can only be pushed onto specialized tiles.</p>

<p class="commentable" data-comment-id="overview-p2"><strong>Spatial Directional Constraints (One-way Tiles)</strong>: The map features directional arrows (e.g. `↓`, `→`, `←`, `↑`) painted on specific tiles. These act as one-way gates, preventing movement from the pointed-to tile back onto the directional tile (moving against the arrow's direction is strictly blocked). For example, if a tile contains `↓` (pointing down), moving from the tile below it (the pointed tile) upwards onto the `↓` tile is prohibited. Note that these directional tiles are optional map features and may not be present on every grid layout; however, when present, they enforce strict asymmetric pathing invariants. These invariants are represented as directed edges in A* routing and directed adjacency relations in PDDL.</p>

<div class="agent-deck">
<div class="agent-card pddl commentable" data-comment-id="agent-card-pddl">
<div>
<span class="agent-badge">Agent 1</span>
<div class="agent-name">PDDL Agent (Partner)</div>
<div class="agent-desc">A physical planner and executor. To mitigate online solver latency, we avoid sending a raw tile-by-tile adjacency representation to PDDL. Instead, the PDDL solver is strictly leveraged for high-level <strong>Plan Selection</strong> (e.g. selecting target clusters or corridor-clearing pushes) and local A* pathfinding is used for step-by-step navigation. <strong>Plan Selection Mechanics:</strong> The agent evaluates the preconditions of each recipe in the Plan Library on every sensory frame, calculates target utilities as a ratio of <code>points / path_distance</code> by feeding state snapshots into the <strong>Safe Shunting-Yard Rule Evaluation Engine</strong> (while respecting active policy blocks), and executes the recipe with the highest score, invoking PDDL only when local pathing is blocked by obstacle crates.</div>
</div>
<ul class="agent-features">
<li class="agent-feature-item">
<svg width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" style="width: 18px; height: 18px; color: var(--accent-green); flex-shrink: 0;"><path d="M5 13l4 4L19 7"></path></svg>
Abstracted Cluster Adjacency mapping
</li>
<li class="agent-feature-item">
<svg width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" style="width: 18px; height: 18px; color: var(--accent-green); flex-shrink: 0;"><path d="M5 13l4 4L19 7"></path></svg>
Multi-Priority Task Queue
</li>
<li class="agent-feature-item">
<svg width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" style="width: 18px; height: 18px; color: var(--accent-green); flex-shrink: 0;"><path d="M5 13l4 4L19 7"></path></svg>
Executes Plan Preemption
</li>
</ul>
</div>

<div class="agent-card llm commentable" data-comment-id="agent-card-llm">
<div>
<span class="agent-badge">Agent 2</span>
<div class="agent-name">LLM Agent (Master)</div>
<div class="agent-desc">The master reasoning brain and coordinator. It intercepts natural language challenge instructions (Special Missions) from the Admin, executes the multi-turn agentic loop, evaluates math, and instructs the partner agent's movement and chat outputs. <strong>Physical Action Capabilities:</strong> Note that the LLM agent is fully capable of navigating, picking up, and delivering parcels directly as well (acting as a physical agent if needed). <strong>Tool & Rule Handling:</strong> Intercepts tool calls and leverages the <strong>Safe Shunting-Yard Rule Evaluation Engine</strong> to dynamically compile natural language instructions into active behavioral policies, feeding outcomes back to the BDI belief base. <strong>Messaging Protocol:</strong> Communicates with the partner via game chat using a highly structured JSON messaging schema (including PING/PONG and PROPOSE/ACCEPT contracts).</div>
</div>
<ul class="agent-features">
<li class="agent-feature-item">
<svg width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" style="width: 18px; height: 18px; color: var(--accent-green); flex-shrink: 0;"><path d="M5 13l4 4L19 7"></path></svg>
System Prompt with XML Guardrails
</li>
<li class="agent-feature-item">
<svg width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" style="width: 18px; height: 18px; color: var(--accent-green); flex-shrink: 0;"><path d="M5 13l4 4L19 7"></path></svg>
Multi-turn Agentic Math loops
</li>
<li class="agent-feature-item">
<svg width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" style="width: 18px; height: 18px; color: var(--accent-green); flex-shrink: 0;"><path d="M5 13l4 4L19 7"></path></svg>
Translates natural language to rules
</li>
</ul>
</div>
</div>

<h3 class="commentable" data-comment-id="missions-header">Special Mission Handling & Rule Parsing</h3>
<p class="commentable" data-comment-id="missions-p">The system is designed to handle dynamic and complex challenge prompts ("Special Missions"). Instead of compiling these missions into a heavy JSON AST or running a custom virtual machine, the system leverages a lightweight, secure two-stage execution architecture:</p>

<div class="card commentable" data-comment-id="schema-parsing-details" style="margin-top: 1.5rem; margin-bottom: 2rem;">
<div class="card-title">LLM Multi-Turn Coordinator & Feasibility Gating</div>
<p>Admin prompts are parsed dynamically by the **LLM Coordinator (Agent 2)**. The coordinator breaks down compound commands into sequential task steps. To ensure safety and validity, the coordinator performs **feasibility gating** before executing any movement or cooperation action:
<ul>
  <li>Calculates coordinates or rewards by calling the <code>evaluate_math_expression</code> tool first.</li>
  <li>If a positive reward is confirmed, the coordinator issues movement/cooperation contracts to the physical agent.</li>
  <li>If no reward is provided, it terminates immediately with a <code>{"type": "stop"}</code> response to prevent resource wastage.</li>
</ul>
</p>

<div style="margin: 1.5rem 0; padding: 1rem; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px;">
    <h4 style="color: var(--primary); margin-bottom: 0.75rem; font-size: 1rem;">Dynamic Rule Evaluation (PolicyEngine)</h4>
    <p style="font-size: 0.9rem; line-height: 1.5; margin-bottom: 1rem;">
        Standing policies (such as coordinate avoidance zones, stack size multipliers, and custom reward boundaries) are applied via the <code>apply_agent_rules</code> tool. Rather than maintaining a complex execution tree, rules are represented as flat objects with condition strings. The <strong>Policy Engine (PolicyEngine.js)</strong> evaluates these conditions at every tick using a safe <strong>Shunting-Yard expression evaluator</strong>:
    </p>
    <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 1rem; border: 1px solid var(--border-color);">
        <thead>
            <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border-color);">
                <th style="padding: 0.5rem; text-align: left; border-right: 1px solid var(--border-color);">Supported Identifiers</th>
                <th style="padding: 0.5rem; text-align: left; border-right: 1px solid var(--border-color);">Operators</th>
                <th style="padding: 0.5rem; text-align: left;">Evaluation & JS Mapping</th>
            </tr>
        </thead>
        <tbody>
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); font-weight: 600; color: var(--accent-cyan);">x, y, score, carrying.size, stack_size</td>
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); color: var(--text-muted);">
                    <code>&&</code>, <code>||</code>, <code>==</code>, <code>!=</code>, <code>&lt;=</code>, <code>&gt;=</code>, <code>&lt;</code>, <code>&gt;</code>, <code>+</code>, <code>-</code>, <code>*</code>, <code>/</code>, <code>%</code>, <code>!</code>
                </td>
                <td style="padding: 0.5rem; color: var(--text-muted);">
                    The Shunting-Yard parser (<code>evaluateExpression</code>) tokenizes and resolves variables against the current BDI belief base (e.g. <code>me.x</code>, <code>carried.length</code>) in real-time.
                </td>
            </tr>
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); font-weight: 600; color: var(--accent-cyan);">parcel.id, parcel.reward, parcel.x, parcel.y</td>
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); color: var(--text-muted);">
                    Standard comparison/math operators
                </td>
                <td style="padding: 0.5rem; color: var(--text-muted);">
                    Allows policies to scale or offset rewards based on parcel properties (e.g. <code>parcel.reward &gt; 10</code>).
                </td>
            </tr>
            <tr>
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); font-weight: 600; color: var(--accent-cyan);">path.traverses_X_Y, parcel.previouslyCarriedByOther</td>
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); color: var(--text-muted);">
                    Boolean properties
                </td>
                <td style="padding: 0.5rem; color: var(--text-muted);">
                    Dynamically evaluates path intersections or tracks cross-agent parcel history to apply relay-related bonuses.
                </td>
            </tr>
        </tbody>
    </table>
</div>

<h4 style="margin-top: 1rem; color: var(--accent-cyan); font-size: 0.95rem;">Rule Evaluation Mechanics</h4>
<ul style="list-style-type: none; padding-left: 0; margin-top: 0.5rem;">
<li style="margin-bottom: 0.75rem;">
<strong>1. Tokenization (<code>tokenize(expr)</code>)</strong><br>
<span style="font-size: 0.9rem; color: var(--text-muted);">
Extracts variables, logical/arithmetic operators, parentheses, and literals from the expression string using a safe regular expression.
</span>
</li>
<li style="margin-bottom: 0.75rem;">
<strong>2. Variable Resolution (<code>resolveIdentifier(name)</code>)</strong><br>
<span style="font-size: 0.9rem; color: var(--text-muted);">
Maps tokens like <code>score</code> or <code>carrying.size</code> directly to properties of <code>beliefs.me</code>, <code>beliefs.carried</code>, or local variables in the current execution context.
</span>
</li>
<li style="margin-bottom: 0.75rem;">
<strong>3. Operator Stack Evaluation (Shunting-Yard)</strong><br>
<span style="font-size: 0.9rem; color: var(--text-muted);">
Uses precedence-based parsing to evaluate expressions correctly without risking <code>eval()</code> security issues or performance hits, supporting unary negation, math operations, and logical gates.
</span>
</li>
</ul>

<h4 style="margin-top: 1.2rem; color: var(--accent-cyan); font-size: 0.95rem;">JavaScript Parser Implementation</h4>
<pre style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 6px; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-main); overflow-x: auto; margin-top: 0.5rem;"><code>// JavaScript Shunting-Yard Parser in PolicyEngine.js
export function evaluateExpression(expr, state, localVars = {}) {
    if (!expr || expr.trim() === '') return true;
    const tokens = tokenize(expr);
    if (tokens.length === 0) return true;
    const values = [];
    const operators = [];
    const precedence = {
        '||': 1, '&&': 2,
        '==': 3, '!=': 3, '&lt;': 3, '&gt;': 3, '&lt;=': 3, '&gt;=': 3,
        '+': 4, '-': 4,
        '*': 5, '/': 5, '%': 5,
        'unary-': 6, '!': 6
    };
    // token parsing, operator stack pushing, and identifier resolution...
    // returns evaluated result (number, boolean, or string)
}</code></pre>
</div>

<div class="missions-grid">
<div class="mission-card lvl-1 commentable" data-comment-id="mission-card-lvl1">
<span class="mission-lvl">Level 1</span>
<div class="mission-title">Atomic Missions</div>
<div class="mission-desc">Relatively simple, short-term tasks. For example, immediate navigation instructions or commands to deliver current parcels. Solved via small additions to the LLM agent's direct tools.</div>
</div>
<div class="mission-card lvl-2 commentable" data-comment-id="mission-card-lvl2">
<span class="mission-lvl">Level 2</span>
<div class="mission-title">Intermediate Missions</div>
<div class="mission-desc">Persistent, non-atomic constraints active for the duration of the match. Constraints must be extremely flexible to adapt to temporal parcel decay rates, shifting grid zones, and sudden path closures. These rules are integrated into the evaluation engine, which recalculates cost weights and checks condition assertions at every tick of the A* routing loop.</div>
</div>
<div class="mission-card lvl-3 commentable" data-comment-id="mission-card-lvl3">
<span class="mission-lvl">Level 3</span>
<div class="mission-title">Coordination Missions</div>
<div class="mission-desc">Complex missions requiring active inter-agent communication, structural contracts, and semantic intent translation for signals (such as red-light/green-light).</div>
</div>
</div>
</section>

<!-- 2. Choices & Rationale -->
<section id="choices-rationale">
<div class="section-header">
<div class="section-num">2</div>
<h2>Architecture Rationale & Purposes for Choices</h2>
</div>
<p class="commentable" data-comment-id="rationale-intro">To design an efficient, real-time agent system, we justify our core structural choices below:</p>

<div class="card commentable" data-comment-id="rationale-card-split">
<div class="card-title">Why use a Hybrid LLM / PDDL Agent Split?</div>
<p style="margin-bottom: 0;">LLMs excel at parsing fuzzy instructions, evaluating math, and reasoning about cooperative strategies, but cannot act in real-time or navigate deterministically. PDDL is an exact, symbolic solver but cannot parse text or handle mathematical puzzles. Combining them lets the LLM act as the master coordinator (instructing the partner agent via game chat) while the PDDL solver functions as the physical macro-planner.</p>
</div>

<div class="card commentable" data-comment-id="rationale-card-policy">
<div class="card-title">Why decouple the Policy Engine from the Planner?</div>
<p style="margin-bottom: 0;">If rules like "avoid tile (3,4)" or "wait for 3 parcels" were compiled directly into PDDL state descriptions, every rule update would require a full planner call. By pulling rules into a separate Policy Engine, we can alter path costs (A*) and block delivery goals on the fly, entirely bypassing the planner for rule modifications. <strong>PDDL Plan Selection Reasoning:</strong> The PDDL solver is strictly used for high-level macro-planning (e.g., deciding which room/cluster sequence to visit or how to push obstacles), while the local Policy Engine and A* pathfinder handle the micro-navigation constraints. This allows PDDL to reason about global reachability and macro-step ordering without being bogged down by transient grid rules.</p>
</div>
</section>

<!-- 3. PDDL Slowness Mitigation -->
<section id="slowness-mitigation">
<div class="section-header">
<div class="section-num">3</div>
<h2>PDDL Slowness & Pathing Mitigation</h2>
</div>
<p class="commentable" data-comment-id="slowness-p1">The online PDDL solver is highly CPU-intensive and slow, taking <strong>1–3 seconds</strong> to return a plan. We bypass this limitation by using the PDDL solver strictly for high-level **Plan Selection** and local crate-pushing, rather than tile-by-tile pathing.</p>

<div class="card commentable" data-comment-id="slowness-card-sol">
<div class="card-title">Our Solution: Macro vs. Micro Planning (Map Clustering)</div>
<p>Instead of sending a raw tile-by-tile representation to PDDL, the map is abstracted into **macro-clusters**. PDDL is responsible for high-level plan selection and solving crate-pushing sequences inside the cluster network. We run local **A* pathfinding** (&lt; 1ms) and pre-compiled **Plan Library Recipes** for micro-execution. PDDL is ONLY called when:</p>
<ul style="padding-left: 1.25rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.95rem;">
<li>A target path is blocked by a crate, requiring a sequence of push actions.</li>
<li>An agent needs to figure out how to push a crate onto a "crate-move-capable" tile to clear a corridor.</li>
<li>High-level cluster routing or task target re-selection (Plan Selection) is triggered.</li>
</ul>
<p style="margin-top: 0.75rem; border-top: 1px solid var(--border-color); padding-top: 0.75rem; font-size: 0.95rem; color: var(--text-muted);">
<strong>Evaluation Engine Integration:</strong> The Shunting-Yard Evaluation Engine filters out unfeasible macro-goals (e.g. sectors with zero/negative reward utility or zones completely cut off by static walls) before they are sent to the PDDL compiler. This prevents wasting valuable CPU cycles solving unreachable objectives.
</p>
<p style="margin-top: 0.75rem; border-top: 1px solid var(--border-color); padding-top: 0.75rem; font-size: 0.95rem; color: var(--text-muted);">
<strong>Other PDDL Usages:</strong> Beyond corridor clearing, PDDL is utilized to resolve **narrow corridor deadlocks** (finding escape-push sequences to back away and clear paths for partner nodes) and to generate **joint cooperative plans** when multiple agents must coordinate structural movements simultaneously.
</p>
<p style="margin-top: 0.75rem; border-top: 1px solid var(--border-color); padding-top: 0.75rem; font-size: 0.9rem; color: var(--text-muted);"><strong>Alternative Map Representations:</strong> We are also evaluating a <em>Topological Navigation Mesh</em> to partition the map into convex polygonal rooms connected by gateways, and <em>Grid Downsampling</em> to gateway sectors, reducing solver complexity by over 90% and solve times below 100ms.</p>
</div>
</section>

<!-- 4. The Plan Library -->
<section id="plan-library">
<div class="section-header">
<div class="section-num">4</div>
<h2>The Plan Library & Preemption</h2>
</div>
<p class="commentable" data-comment-id="planlib-p1">To avoid PDDL solver latency, the physical BDI agent utilizes a <strong>Plan Library</strong> of pre-defined recipes. If a dynamic obstacle blocks movement during a recipe, it triggers Tier 1/2 reactive pathing. If a new task arrives during a recipe, or if the LLM agent initiates a cooperative parcel handoff contract, the agent coordinates via a prioritized queue. High-importance tasks preempt the current recipe, pushing its state onto a stack to resume once the higher-priority contract is closed.</p>

<p class="commentable" data-comment-id="planlib-preemption"><strong>Task Queue & Preemption (Cooperative Handoff Scenario & HFSM Modeling)</strong>: The agent maintains a prioritized queue (Coop Contracts > Admin Moves > Default Parcel Delivery). When the BDI agent is executing a `NavigateTo` recipe to collect a standard parcel (Priority 3) and the LLM Master proposes a cooperative handoff (Priority 1) at location `(x, y)`, the BDI agent immediately accepts the proposal, pauses the current navigation generator, pushes it to a *Suspended Plan stack*, and executes the `RendezvousDrop` plan. Once the rendezvous is completed or closed, the BDI agent pops the suspended travel recipe from the stack and resumes navigation. <strong>HFSM Modeling:</strong> This behavior is modeled as a <strong>Hierarchical Finite State Machine (HFSM)</strong> with a history stack. Each active plan generator acts as a state machine; state transitions triggered by high-priority contract signals push the current state to a history stack, transition to a nested sub-machine, and return once the sub-machine hits a final state.</p>

<div class="tabs-header">
<button class="tab-btn active" onclick="switchTab(event, 'recipe-nav')">NavigateTo Recipe</button>
<button class="tab-btn" onclick="switchTab(event, 'recipe-collect')">CollectAndDeliver Recipe</button>
<button class="tab-btn" onclick="switchTab(event, 'recipe-coop')">RendezvousDrop Recipe</button>
</div>

<div id="recipe-nav" class="tab-content active">
<div class="terminal-window commentable" data-comment-id="code-recipe-nav">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">NavigateTo.js</span>
</div>
<div class="terminal-body">
<pre><code>NavigateTo: {
    preconditions: (beliefs, targetX, targetY) => {
        // Path must exist and not be blocked by unpushable obstacles
        return beliefs.grid.hasPath(beliefs.me.x, beliefs.me.y, targetX, targetY);
    },
    body: function* (beliefs, targetX, targetY) {
        const path = beliefs.grid.findAStarPath(
            beliefs.me.x, beliefs.me.y, 
            targetX, targetY, 
            beliefs.policy // respects avoid-tiles & penalties
        );
        for (const step of path) {
            yield { action: 'move', target: step };
        }
    }
}</code></pre>
</div>
</div>
</div>

<div id="recipe-collect" class="tab-content">
<div class="terminal-window commentable" data-comment-id="code-recipe-collect">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">CollectAndDeliver.js</span>
</div>
<div class="terminal-body">
<pre><code>CollectAndDeliver: {
    preconditions: (beliefs, parcelId) => {
        return beliefs.parcels.has(parcelId) && !beliefs.isCarrying(parcelId);
    },
    body: function* (beliefs, parcelId) {
        const parcel = beliefs.parcels.get(parcelId);
        // 1. Navigate to parcel
        yield* PlanLibrary.NavigateTo.body(beliefs, parcel.x, parcel.y);
        // 2. Perform pickup
        yield { action: 'pickup', target: parcelId };
        // 3. Find nearest delivery zone
        const deliveryZone = beliefs.grid.findNearestDelivery(beliefs.me.x, beliefs.me.y, beliefs.policy);
        // 4. Navigate to delivery zone
        yield* PlanLibrary.NavigateTo.body(beliefs, deliveryZone.x, deliveryZone.y);
        // 5. Deliver cargo
        yield { action: 'deliver', target: parcelId };
    }
}</code></pre>
</div>
</div>
</div>

<div id="recipe-coop" class="tab-content">
<div class="terminal-window commentable" data-comment-id="code-recipe-coop">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">RendezvousDrop.js</span>
</div>
<div class="terminal-body">
<pre><code>RendezvousDrop: {
    preconditions: (beliefs, coopId, x, y) => {
        return beliefs.policy.activeCooperation?.coordinationId === coopId && beliefs.carrying.size > 0;
    },
    body: function* (beliefs, coopId, x, y) {
        // 1. Move to rendezvous coordinates
        yield* PlanLibrary.NavigateTo.body(beliefs, x, y);
        // 2. Drop cargo
        yield { action: 'putdown' };
        // 3. Move to adjacent tile to clear drop spot
        const escapeTile = beliefs.grid.findAdjacentClearTile(x, y);
        yield* PlanLibrary.NavigateTo.body(beliefs, escapeTile.x, escapeTile.y);
        // 4. Signal readiness to partner
        yield { action: 'say', payload: { type: 'RELEASE_CARGO', coopId } };
    }
}</code></pre>
</div>
</div>
</div>
</section>

<!-- 5. Dynamic Replanning -->
<section id="dynamic-replanning">
<div class="section-header">
<div class="section-num">5</div>
<h2>Dynamic Replanning & Obstacle Avoidance</h2>
<p class="commentable" data-comment-id="replan-p1">In a real-world match, other agents or obstacles will frequently block your path. We implement a <strong>Three-Tier Reactive Replanning Hierarchy</strong>. The executor distinguishes between the tiers sequentially: (1) Tier 1 is selected when the blocking obstacle is transient (wait <= 2 ticks); (2) Tier 2 is selected if the wait exceeds 2 ticks but alternate path coordinates exist; (3) Tier 3 is selected when pathfinding returns `unreachable` or target objectives become invalid, forcing a macro replan. <strong>Spatial Memory & Render Distance:</strong> Because the Deliveroo environment enforces a limited visibility render distance, obstacles (like crates pushed by other agents) can appear and disappear. To prevent losing track of these obstacles when moving away, the Belief Base maintains a persistent <strong>Spatial Memory Grid</strong> that retains known crate coordinates. If a path is blocked, the coordinates are stored as blocked; they are only cleared when a subsequent sensory sweep of the target area proves the tile is now clear.</p>
</div>

<div class="replanning-container">

<div class="replan-card commentable" data-comment-id="replan-card-tier1">
<div class="replan-card-header">
<div class="replan-num">1</div>
<div class="replan-title">Tier 1: Local Waiting (Collision Back-off)</div>
</div>
<p style="margin-bottom:0; font-size:0.9rem;"><strong>Trigger:</strong> Next step in the active recipe is occupied. The agent pauses (yields a wait command) for up to 2 ticks. Often, the blocking agent is just passing through and moves away, allowing the plan to resume without any recalculation lag.</p>
</div>

<div class="replan-card commentable" data-comment-id="replan-card-tier2">
<div class="replan-card-header">
<div class="replan-num">2</div>
<div class="replan-title">Tier 2: Local A* Re-routing (Bypass)</div>
</div>
<p style="margin-bottom:0; font-size:0.9rem;"><strong>Trigger:</strong> Wait time exceeds 2 ticks, but alternate paths to the sub-goal exist. The agent marks that specific tile as temporarily impassable and runs a local A* path query (< 1ms) to the current sub-goal. This dynamically routes the agent around the blocking node instantly.</p>
</div>

<div class="replan-card commentable" data-comment-id="replan-card-tier3">
<div class="replan-card-header">
<div class="replan-num">3</div>
<div class="replan-title">Tier 3: Macro PDDL Re-solving & Realignment</div>
</div>
<p style="margin-bottom:0; font-size:0.9rem;"><strong>Trigger:</strong> Pathfinder returns `unreachable` (indicating a corridor blocked by a pushable crate) or the target parcel is deleted. The current plan is aborted. The agent compiles the new state and invokes the PDDL solver to generate a fresh sequence of crate pushes or select a new target.</p>
</div>

</div>
</section>

<!-- 6. Modeling Special Missions -->
<section id="special-modeling">
<div class="section-header">
<div class="section-num">6</div>
<h2>Modeling Special Missions</h2>
</div>
<p class="commentable" data-comment-id="modeling-p1">Special Missions are modeled inside the BDI execution loop by updating the agent's Belief Set and Policy parameters:</p>

<div class="card commentable" data-comment-id="modeling-card-lvl2">
<div class="card-title">Level 2 Persistent Rules Integration (Shunting-Yard Evaluator)</div>
<p style="margin-bottom: 1rem;">To support highly generalized logic statements, the Policy Engine evaluates rules using a safe **Shunting-Yard mathematical/logical expression evaluator**. Conditional expressions evaluate live variables (e.g. <code>carrying.size</code>, <code>reward</code>, <code>steps</code>) using standard comparison and logical operators at every tick:</p>
<ul style="padding-left: 1.25rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.6rem; font-size: 0.95rem;">
<li><strong>Stack Size Constraints</strong>: If the policy defines <code>carrying.size < reward</code>, the delivery action in the plan is blocked until the condition is met.</li>
<li><strong>Avoidance Tiles</strong>: Avoid tiles are injected with cost penalties (e.g. <code>+50</code>). The A* pathfinder automatically calculates paths routing around the tile, unless no other path exists and the parcel reward justifies crossing it.</li>
<li><strong>Optimal Stack Delivery Optimizer (DeliveryOptimizer.js)</strong>: Instead of greedily evaluating parcels, the agent runs a subset-optimization algorithm (<code>optimizeDeliveryStack</code>) at arrival. This algorithm evaluates all subsets of carried cargo at candidate wait times $t$ to maximize the total policy-adjusted reward, supporting stack size bounds (e.g. exactly 3 parcels) and wait-to-decay ranges. The evaluator passes a cloned parcel object with the decayed reward property to <code>evaluatePolicyReward</code>, ensuring constraints are evaluated correctly on the projected decayed value.
  <ul>
    <li><em>Adaptive Subsetting</em>: If carrying $N \le 6$ parcels, does a full power set evaluation ($2^N \le 64$ subsets). If $N > 6$, it prunes the search to relevant stack boundaries (e.g. bounds from rules, required stack size), individually positive cargo, and the full cargo set, ensuring $O(N \log N)$ complexity.</li>
    <li><em>Conditional Decay Scanning</em>: If policy rules contain no reward-based constraints, wait time is immediately set to 0. If constraints exist, decay scanning automatically extracts boundaries $b$ (from <code>rewardBounds</code>, <code>maxRewardLimit</code>, and <code>minRewardThreshold</code>) and evaluates decay wait times $t$ that bring the parcel value to exactly $b$, $b - 1$, and $b - 0.1$, guaranteeing that decay steps are targeted and never missed.</li>
    <li><em>Togglable Logs</em>: All optimization, worthiness checking, and subset generation logging is prefix-intercepted and togglable via the <code>LOG_OPTIMIZER</code> environment variable (mapped to <code>LOGGER_CONFIG.enableOptimizer</code>), allowing fine-grained logging control.</li>
  </ul>
  If the optimal subset has a positive reward and there are discarded cargo elements (e.g., storing/discarding excess cargo to satisfy stack rules or avoiding penalties), the agent steps to an adjacent non-delivery tile to drop the discarded subset first, returns to the delivery zone, yields the optimal wait time, and drops all remaining cargo in a single action. If no subset achieves a positive reward, the agent discards all carried cargo on an adjacent tile to avoid penalties.
</li>
</ul>
<p style="margin-top: 1rem; border-top: 1px solid var(--border-color); padding-top: 1rem; font-size: 0.85rem; color: var(--text-muted);">
<strong>Policy Update Arguments Structure:</strong> The policy update payload contains an <code>agentId</code> (specifying the target executor) and a <code>rules</code> object defining the constraints. The rules schema includes <code>avoidTiles</code> (an array of coordinates, e.g. <code>["3,5", "4,5"]</code>), 
<code>maxRewardLimit</code> (a ceiling float), 
<code>minRewardThreshold</code> (a floor float), 
<code>requiredStackSize</code> (an integer stack count), 
<code>multiplierRules</code> (objects containing a mathematical/logical <code>condition</code> string and a <code>multiplier</code> factor), and 
<code>bonusRules</code> (objects containing a mathematical/logical <code>condition</code> string and a <code>bonus</code> value).
</p>
</div>

<div class="card commentable" data-comment-id="modeling-card-lvl3">
<div class="card-title">Level 3 Coordination Integration (LLM Translation)</div>
<p style="margin-bottom: 1rem;">The LLM Master acts as an **Intent & State Translator**, parsing arbitrary natural language signals. Rather than searching for exact string matches, the LLM semantically interprets statements (e.g. "You can now move" or "it is now red light") and evaluates complex riddles to toggle policy states:</p>
<ul style="padding-left: 1.25rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.6rem; font-size: 0.95rem;">
<li><strong>Rendezvous Contracts</strong>: An active contract <code>{ type: 'RENDEZVOUS', x, y }</code> is set. The BDI agent bypasses normal parcel collection, executes the <code>RendezvousDrop</code> plan, drops cargo, clears the tile, and signals completion.</li>
<li><strong>Signal & Riddle Interpretation</strong>: The LLM parses signals (e.g., "if 2+2 is 3 then it's red light" -> checks math -> determines it evaluates to false, so movement is not held; whereas "stop moving immediately" -> sets <code>hold = true</code>) causing the physical agent to wait until a resume signal is translated.</li>
</ul>
</div>
</section>

<!-- 7. LLM System Prompt Design -->
<section id="prompt-design">
<div class="section-header">
<div class="section-num">7</div>
<h2>LLM System Prompt Design</h2>
</div>
<p class="commentable" data-comment-id="prompt-p1">To guarantee robust operation and limit non-deterministic completions, the LLM agent uses a strict, instruction-driven system prompt and dynamic state updates.</p>

<p class="commentable" data-comment-id="prompt-guardrails"><strong>Prompt Engineering Guardrails</strong>: System instructions are structured using clear **XML tag boundaries** to separate rules from snapshots, mandate **Chain-of-Thought (CoT) reasoning** in a scratchpad before emitting tool calls, and include **few-shot demonstration pairs** showing how to solve coordinate math before making tool calls.</p>

<div class="tabs-header">
<button class="tab-btn active" onclick="switchTab(event, 'sys-prompt')">System Prompt (Compact CoT)</button>
<button class="tab-btn" onclick="switchTab(event, 'detailed-prompt')">Detailed Prompt (Tool-Informed)</button>
<button class="tab-btn" onclick="switchTab(event, 'state-input')">Dynamic State Input</button>
</div>

<div id="sys-prompt" class="tab-content active">
<div class="terminal-window commentable" data-comment-id="prompt-code-sys">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">system_prompt.txt</span>
<button class="copy-btn" onclick="copyPrompt('systemPromptContent')">Copy</button>
</div>
<div class="terminal-body">
<pre id="systemPromptContent"><code class="prompt-code">You are the cognitive reasoning brain of a cooperative, autonomous Deliveroo multi-agent system.
Your team consists of:
1. Yourself (the LLM Agent - Coordinator)
2. A PDDL Agent (the Planner/Partner)

While you possess the reasoning engine, your partner agent executes physical actions under your high-level guidance or cooperates with you directly through a message-based communication scheme.

────────────────────────────────────────────────────────────────────────────────
CORE OPERATIONAL PROTOCOLS & GOALS
────────────────────────────────────────────────────────────────────────────────
1. MATH EVALUATION & PREPARATION
   - Before executing any navigation or cooperative command containing arithmetic expressions (e.g. "go to cell 4+2, 10-3"), you MUST call the "evaluate_math_expression" tool.
   - Wait for the mathematical result in the next turn, and only then use the evaluated numeric coordinates for routing or coordination.
   - If a query contains multiple calculations, you MUST call the evaluation tool sequentially, one by one, across multiple turns. Do NOT invoke parallel tool calls, as the backend only supports a single tool call at once.
   
2. GOAL FILTERING & FEASIBILITY
   - If a task offers a negative or zero reward, or the path is determined to be blocked, declare the task unfeasible. Do not waste agent resources on tasks with zero/negative reward utility.

3. COOPERATIVE EXECUTION (RENDEZVOUS & TRADING)
   - When coordinating a package handoff or gate clearance, establish a coordination contract.
   - Coordinate using specific, sequential states: PROPOSE, ACCEPT, READY, DROP, PICKUP, COMPLETE.
   - If you are carrying a package to trade, drop it at the rendezvous coordinate, move away, and signal your partner to step forward and retrieve it.

────────────────────────────────────────────────────────────────────────────────
RESPONSE FORMATTING LIMITS
────────────────────────────────────────────────────────────────────────────────
- When executing tools, output ONLY the tool calls.
- Only call a single tool per turn. Parallel tool calling is strictly unsupported.
- If asked a factual question by the admin, reply directly with the raw answer text. Avoid conversational preambles (e.g. output "4" instead of "The answer is 4").
- For multi-turn workflows where you are waiting for a tool result, output a status prefix like "[WAITING]" or "[REPLAN]" followed by a brief reason.</code></pre>
</div>
</div>
</div>

<div id="detailed-prompt" class="tab-content">
<div class="terminal-window commentable" data-comment-id="prompt-code-sys-detailed">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">system_prompt_detailed.txt</span>
<button class="copy-btn" onclick="copyPrompt('systemPromptDetailedContent')">Copy Code</button>
</div>
<div class="terminal-body">
<pre id="systemPromptDetailedContent"><code class="prompt-code">&lt;system_prompt&gt;

&lt;role&gt;
You are the cognitive reasoning brain of a cooperative, autonomous Deliveroo multi-agent system.

AGENT IDS:
- BDI_AGENT_ID: autobots_pddl
- LLM_AGENT_ID: autobots_llm
&lt;/role&gt;

&lt;definitions&gt;
1- Reward: the reward is the value that you as an agent gains or loses when performing a task. It may be indicated as
"points", "reward", "pts", "score", "gain", "loss", "penalty", "bonus", etc. It may also be represented as an expression
like "20 * 3 + 10".

2- Task: a task is a single unit of work that the agent needs to do. A prompt may be comprised of multiple tasks. For example
&lt;prompt&gt;what is the capital of sweden and 5*7*9 for 40 points&lt;/prompt&gt; contains two tasks: "what is the capital of sweden" and 
"5*7*9", both for 40 points.

Another example could be &lt;prompt&gt;what is 2 + 2 for -100 points and what is 2 * 3 for 100 points&lt;/prompt&gt; contains two tasks:
"what is 2 + 2 for -100 points" and "what is 2 * 3 for 100 points". Each task has its own reward which needs to be considered.

Also consider that prompts may be comprised of more then 1 or 2 tasks, meaning that if one or more are not feasible then we still
need to check if we need to perform the others.

3- Rule: a rule is a standing instruction that changes the way that you perform tasks. It may be indicated as "every time...",
"if you deliver...", "from now on...", "do not go through X or you lose Y", etc. It may also be represented as an expression
like "if 20 * 3 + 10 &gt; 0, then ...".
&lt;/definitions&gt;

&lt;rules&gt;

1- EXPRESSIONS
Whenever you see an expression you MUST not evaluate it directly, but instead use the appropriate tool to solve the problem

2- FEASIBILITY (REWARD-GATED ACTIONS)
One-shot task commands - move_agent_to_coordinate, set_agent_variable, and cooperate_with_agent (types RENDEZVOUS/CLEARING/HANDOFF) - require a
confirmed positive reward before they will be executed (Note: pickup_parcel_by_id and deliver_parcel_by_id are temporarily disabled and must NOT be used):
- If the message specifies a reward/points value (a number or expression), evaluate it with
  evaluate_math_expression and check if it's &gt; 0 BEFORE calling any task action. Only call the
  task action if the result is true.
- If the message specifies NO reward, do NOT call any task action and do NOT produce an answer -
  respond immediately with {"type": "stop"} (no chat output for the Admin). The same applies to
  questions with no reward and purely conversational messages: stop, no answer, no tool calls.

- STANDING RULES ARE NOT REWARDED TASKS. Messages that change future scoring ("every time...",
"if you deliver...", "from now on...", "do not go through X or you lose Y"), the points, multipliers, 
or penalties mentioned are the effect, not a reward to check. Always apply them with apply_agent_rules /
cooperate_with_agent, with no feasibility check, regardless of whether the effect is positive, zero, or negative.

- Control/utility actions are NOT reward-gated and can always be used regardless of reward:
  resume_agent, hold_agent, cooperate_with_agent (type "CLOSE"), get_local_context.

- Note that some cooperation tasks may seem to be declared as policy rules, however since they involve multiple agents, they are cooperation tasks. Specifically, any rule/announcement that rewards, penalizes, or mentions picking up, delivering, or transferring parcels previously handled, picked up, or collected by another agent is a cooperative RELAY task (not a simple policy rule).
- When a RELAY rule/bonus is announced, the Coordinator MUST propose a RELAY contract using "cooperate_with_agent" with contract type "RELAY", using the peer agent BDI_AGENT_ID (autobots_pddl) as the "id" and "courierId", and x/y set to null so the drop tile is auto-picked next to the best delivery zone.

3- STRUCTURE
Always follow the tool structure for calling it and the arguments schema to provide the arguments.
Also for other task which require a standard response you MUST reply with JUST the answer and not divulge with other
information.

4- MULTIPLE INSTRUCTIONS
If you recognize that a prompt is comprised of:
- more than 1 task
- more then one tool call
- just an answer 
then you MUST perform the actions in sequence giving the answers in the same order that the tasks are presented.

&lt;important_ordering&gt;
- Note that a task may contain a computation in which case you MUST use the tool and then immediately after in the next turn
  give the answer for the computation task. ONLY after you give the answer for the computation task you can move to the next task.
- Previus tasks still take precedence over the current (even if computational), making it sequential. So if the computation appears as 
  the 2nd task, you MUST give the answer for it after the 1st task, before moving to the 3rd task.
  For example
  &lt;prompt&gt;what is the capital of X, what is 2 * 2, and what is the capital of Y, all for 100 points&lt;/prompt&gt;
  YOUR RESPONSE SHOULD BE: 
  - The answer to "what is the capital of X"
  - The answer to "what is 2 * 2" (immediately after calling the tool)
  - The answer to "what is the capital of Y"
&lt;/important_ordering>

5- CONTEXT
For questions related to some information you may not know like the agent position, map size and so on you can get that info
by using the get context tool. The same applies if the question is about the previous conversations via the "get_history" tool.

6- STATE
You can query, save variables, by using the get variables and set variable tools.

7- ODD AND EVEN ROWS/COLUMNS
When you need to handle odd or even rows/columns (for example, checking if the agent is at an odd/even row/column, or applying rules/penalties to specific odd/even rows/columns):
- Row corresponds to the 'y' coordinate, and Column corresponds to the 'x' coordinate.
- You do NOT need to use a math tool to verify odd/even numbers. Use your internal reasoning to select valid coordinates that fit the criteria (e.g., if asked for an odd row, directly pick y=3, y=5, etc., after checking the map context).

8- COORDINATE GENERATION &amp; AGENT COORDINATION
When directing agents to navigate to coordinates or tiles (e.g. using "move_agent_to_coordinate"):
- If a movement task or constraint applies (e.g. "move to an odd column" or "go to an even row"), BOTH agents (BDI and LLM) MUST perform the movement. Call "move_agent_to_coordinate" for EACH agent.
- NEVER send both agents to the exact same coordinate/tile, as they will occupy the same physical spot and collide or block each other. Always direct them to different, distinct coordinates (e.g. two different odd columns).
- Ensure that the target coordinates chosen for each agent satisfy the criteria of the request (for example, staying within a specified radius, or landing on a specific row/column like odd/even).
- Before directing an agent, check that the destination tile is a valid, walkable tile (not a wall or an empty/void tile), and that it is reachable. You can get map details and walkable tiles using the "get_local_context" tool.
- If the request is to "drop", "place", or "put down" a parcel or package at a specific coordinate or tile, you MUST call "move_agent_to_coordinate" with "dropOnArrival" set to true. The agent will automatically search for and pick up a parcel first if it doesn't carry one and then drop it on arrival.
- NEVER direct an agent to wait, hold, or patrol directly ON a parcel spawn tile. Standing on a spawn tile prevents new parcels from appearing there. Instead, direct agents to an adjacent walkable non-spawn tile next to the spawn zone, or keep them moving between spawn zones.

9- ATTENTION
All answers which don't follow the following JSON format will be rejected and you will be prompted for another response.

10- STRICT TURN-TAKING (ANTI-HALLUCINATION)
You must NEVER generate the Admin's response or simulate a "[Next Turn]" block yourself. After you output an [ANSWER] block containing a tool call or a stop command, you must immediately STOP generating and wait for the real Admin to provide the [TOOL_RESULT].
&lt;/rules&gt;

&lt;response_format&gt;
[REASONING]
&lt;reasoning_body&gt;
&lt;reasoning here&gt;
&lt;/reasoning_body&gt;
[/REASONING]
[ANSWER]
&lt;answer_format&gt;
{
  "type": "answer",
  "body": "Raw answer here"
}
&lt;/answer_format&gt;
&lt;tool_format&gt;
{
  "type": "tool",
  "name": "tool_name_here",
  "args": {
    "arg1": "value1",
    "arg2": "value2"
  }
}
&lt;/tool_format&gt;
&lt;stop_format&gt;
{
  "type": "stop"
}
&lt;/stop_format&gt;
[/ANSWER]
&lt;/response_format&gt;

&lt;available_tools&gt;
[Dynamically generated from the toolsRegistry.js mapping]
&lt;/available_tools&gt;
&lt;/system_prompt&gt;</code></pre>
</div>
</div>
</div>

<div id="state-input" class="tab-content">
<div class="terminal-window commentable" data-comment-id="prompt-code-state">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">state_snapshot.json</span>
<button class="copy-btn" onclick="copyPrompt('stateSnapshotContent')">Copy</button>
</div>
<div class="terminal-body">
<pre id="stateSnapshotContent"><code>{
  "self": {
    "id": "agent_llm_1",
    "x": 3,
    "y": 5,
    "score": 420,
    "carrying": ["parcel_id_9"]
  },
  "partner": {
    "id": "agent_pddl_1",
    "x": 5,
    "y": 6,
    "score": 380,
    "carrying": []
  },
  "visible_crates": [
    {"id": "crate_0", "x": 4, "y": 6}
  ],
  "visible_parcels": [
    {"id": "parcel_id_10", "x": 1, "y": 2, "reward": 15}
  ],
  "map_rules": {
    "avoid_tiles": ["4,5"],
    "crate_capable_tiles": ["1,1", "1,2", "4,6", "4,7", "5,6"]
  }
}</code></pre>
</div>
</div>
</div>
</section>

<!-- 8. Tool Design -->
<section id="tool-design">
<div class="section-header">
<div class="section-num">8</div>
<h2>Tool Design & API Requirements</h2>
</div>
<p class="commentable" data-comment-id="tool-p1">The LLM agent translates cognitive commands into structural actions by invoking specialized function declarations. To ensure the LLM understands when to execute coordination versus execution, the JSON schemas include explicit multiagentic descriptions detailing their purposes (e.g. proposing contracts versus speaking messages). The parameters are defined in standard OpenAI-compatible tool schema format.</p>
<p class="commentable" data-comment-id="tool-p2" style="margin-top: 0.5rem; font-size: 0.95rem; color: var(--text-muted);">
The LLM Coordinator uses a modular registry of 9 tools to retrieve spatial context, evaluate constraints, and direct agent tasks. All action tools that manipulate BDI agent intentions require a confirmed positive reward before execution.
</p>

<div class="tools-grid">

<!-- Tool 1 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-get-history" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">H</div>
<div>
<div class="tool-name">get_history()</div>
<div class="tool-desc">Retrieves the history of past conversations in the active session.</div>
</div>
</div>
<div class="tool-chevron">▼</div>
</div>
<div class="tool-details">
<div class="tool-details-content">
<div class="schema-header">Parameters JSON Schema</div>
<pre><code>{}</code></pre>
</div>
</div>
</div>

<!-- Tool 2 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-math" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">M</div>
<div>
<div class="tool-name">evaluate_math_expression(expression)</div>
<div class="tool-desc">Evaluates raw string math formulas into numbers before running navigation commands.</div>
</div>
</div>
<div class="tool-chevron">▼</div>
</div>
<div class="tool-details">
<div class="tool-details-content">
<div class="schema-header">Parameters JSON Schema</div>
<pre><code>{
  "type": "object",
  "properties": {
    "expression": {
      "type": "string",
      "description": "The math expression string to evaluate."
    }
  },
  "required": ["expression"]
}</code></pre>
</div>
</div>
</div>

<!-- Tool 3 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-move" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">N</div>
<div>
<div class="tool-name">move_agent_to_coordinate(id, x, y, holdOnArrival, holdDuration, dropOnArrival)</div>
<div class="tool-desc">Immediately route a specific physical agent to a target coordinate.</div>
</div>
</div>
<div class="tool-chevron">▼</div>
</div>
<div class="tool-details">
<div class="tool-details-content">
<div class="schema-header">Parameters JSON Schema</div>
<pre><code>{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "The unique ID of the agent to move (autobots_llm or autobots_pddl)."
    },
    "x": { "type": "number" },
    "y": { "type": "number" },
    "holdOnArrival": { "type": "boolean" },
    "holdDuration": { "type": ["number", "null"] },
    "dropOnArrival": { "type": ["boolean", "null"] }
  },
  "required": ["id", "x", "y"]
}</code></pre>
</div>
</div>
</div>

<!-- Tool 4 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-rules" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">P</div>
<div>
<div class="tool-name">apply_agent_rules(id, rules)</div>
<div class="tool-desc">Updates environmental rules inside BDI belief.</div>
</div>
</div>
<div class="tool-chevron">▼</div>
</div>
<div class="tool-details">
<div class="tool-details-content">
<div class="schema-header">Parameters JSON Schema</div>
<pre><code>{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Target agent ID (autobots_pddl, autobots_llm, or 'all')."
    },
    "rules": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "all_tiles": { "type": "boolean" },
          "tiles": {
            "type": "array",
            "items": { "type": "string", "description": "Coordinates as 'x,y'" }
          },
          "stackSizeBounds": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "min": { "type": ["number", "null"] },
                "max": { "type": ["number", "null"] }
              }
            }
          },
          "rewardBounds": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "min": { "type": ["number", "null"] },
                "max": { "type": ["number", "null"] }
              }
            }
          },
          "multiplier": { "type": ["number", "null"] },
          "bonus": { "type": ["number", "null"] }
        }
      }
    }
  },
  "required": ["id", "rules"]
}</code></pre>
</div>
</div>
</div>

<!-- Tool 5 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-coop" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">C</div>
<div>
<div class="tool-name">cooperate_with_agent(id, contract)</div>
<div class="tool-desc">Initiates a multi-agent coordination contract (rendezvous, relay, clearing, etc.) or closes active cooperation.</div>
</div>
</div>
<div class="tool-chevron">▼</div>
</div>
<div class="tool-details">
<div class="tool-details-content">
<div class="schema-header">Parameters JSON Schema</div>
<pre><code>{
  "type": "object",
  "properties": {
    "id": { "type": "string", "description": "Target peer agent ID." },
    "contract": {
      "type": "object",
      "properties": {
        "type": { "type": "string", "enum": ["RENDEZVOUS", "CLEARING", "HANDOFF", "RELAY", "CLOSE"] },
        "x": { "type": ["number", "null"] },
        "y": { "type": ["number", "null"] },
        "radius": { "type": ["number", "null"] },
        "holdDuration": { "type": ["number", "string", "null"], "description": "Seconds or 'indefinite'" },
        "courierId": { "type": ["string", "null"] }
      },
      "required": ["type"]
    }
  },
  "required": ["id", "contract"]
}</code></pre>
</div>
</div>
</div>

<!-- Tool 6 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-context" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">G</div>
<div>
<div class="tool-name">get_local_context()</div>
<div class="tool-desc">Fetches the current spatial, parcel, peer, and map state context.</div>
</div>
</div>
<div class="tool-chevron">▼</div>
</div>
<div class="tool-details">
<div class="tool-details-content">
<div class="schema-header">Parameters JSON Schema</div>
<pre><code>{}</code></pre>
</div>
</div>
</div>

<!-- Tool 7 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-variable" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">V</div>
<div>
<div class="tool-name">set_agent_variable(id, name, value)</div>
<div class="tool-desc">Saves a variable into the local and peer agent memory.</div>
</div>
</div>
<div class="tool-chevron">▼</div>
</div>
<div class="tool-details">
<div class="tool-details-content">
<div class="schema-header">Parameters JSON Schema</div>
<pre><code>{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string" },
    "value": { "type": "any" }
  },
  "required": ["id", "name", "value"]
}</code></pre>
</div>
</div>
</div>

<!-- Tool 8 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-hold" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">S</div>
<div>
<div class="tool-name">hold_agent(id, duration)</div>
<div class="tool-desc">Stops/pauses movement and actions of the targeted agent.</div>
</div>
</div>
<div class="tool-chevron">▼</div>
</div>
<div class="tool-details">
<div class="tool-details-content">
<div class="schema-header">Parameters JSON Schema</div>
<pre><code>{
  "type": "object",
  "properties": {
    "id": { "type": "string", "description": "autobots_pddl, autobots_llm, or 'all'" },
    "duration": { "type": ["number", "null"], "description": "Automatic resume timeout in seconds" }
  },
  "required": ["id"]
}</code></pre>
</div>
</div>
</div>

<!-- Tool 9 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-resume" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">R</div>
<div>
<div class="tool-name">resume_agent(id)</div>
<div class="tool-desc">Resumes the targeted agent, clearing previous hold state and active coordination contracts.</div>
</div>
</div>
<div class="tool-chevron">▼</div>
</div>
<div class="tool-details">
<div class="tool-details-content">
<div class="schema-header">Parameters JSON Schema</div>
<pre><code>{
  "type": "object",
  "properties": {
    "id": { "type": "string", "description": "autobots_pddl, autobots_llm, or 'all'" }
  },
  "required": ["id"]
}</code></pre>
</div>
</div>
</div>

</div>
</section>

<!-- 9. State Representation & Comms -->
<section id="state-comms">
<div class="section-header">
<div class="section-num">9</div>
<h2>State Representation & Communication Architecture</h2>
</div>
<p class="commentable" data-comment-id="comms-p1">We evaluate two topological layouts for managing world state and execution flows between the agents:</p>

<div class="arch-section">

<!-- Option A -->
<div class="card arch-card commentable" data-comment-id="arch-card-a">
<div class="card-title">Option A: Central Server</div>
<p>An external broker connects to the Deliveroo server, processes map and sensing updates for both nodes, and sends actions downwards.</p>

<!-- Simple visual node layout -->
<div class="diagram-container">
<div class="node node-dark" style="position: absolute; top: 15px;">Deliveroo Server</div>
<div class="node node-primary" style="position: absolute; top: 85px; width: 140px; box-shadow: 0 0 10px rgba(99, 102, 241, 0.4)">Central Coordinator</div>
<div class="node node-dark" style="position: absolute; bottom: 15px; left: 25px;">PDDL Agent</div>
<div class="node node-dark" style="position: absolute; bottom: 15px; right: 25px;">LLM Agent</div>

<!-- Connective SVG lines -->
<svg width="100%" height="100%" style="position: absolute; top:0; left:0; pointer-events:none;">
<line x1="50%" y1="35" x2="50%" y2="85" stroke="#4b5563" stroke-width="1.5" stroke-dasharray="3,3" />
<line x1="50%" y1="125" x2="25%" y2="165" stroke="#4b5563" stroke-width="1.5" />
<line x1="50%" y1="125" x2="75%" y2="165" stroke="#6366f1" stroke-width="1.5" />
</svg>
</div>

<ul style="padding-left: 1.25rem; font-size: 0.85rem; color: var(--text-muted);">
<li><strong>Pros</strong>: Unified spatial view, no communication lag.</li>
<li><strong>Cons</strong>: Single point of failure, restricts agent autonomy.</li>
<li><strong>Design Details</strong>: Heavy memory/state footprint on central broker node. Mutexes lock grid cells directly. Extremely simple implementation but fragile.</li>
</ul>
</div>

<!-- Option B -->
<div class="card arch-card recommended commentable" data-comment-id="arch-card-b">
<div class="recommend-badge">Recommended</div>
<div class="card-title">Option B: Peer-to-Peer (P2P)</div>
<p>Agents connect separately to Deliveroo, maintaining localized belief sets and cooperating using message payloads in game-chat.</p>

<div class="diagram-container">
<div class="node node-primary" style="position: absolute; left: 20px; width: 100px;">PDDL Agent</div>
<div class="node node-secondary" style="position: absolute; right: 20px; width: 100px;">LLM Agent</div>
<div class="node node-dark" style="position: absolute; bottom: 15px; left: 50%; transform: translateX(-50%);">Deliveroo Server</div>

<svg width="100%" height="100%" style="position: absolute; top:0; left:0; pointer-events:none;">
<path d="M 120 100 L 220 100" stroke="#a855f7" stroke-width="2" stroke-dasharray="4,2" />
<line x1="70" y1="120" x2="120" y2="160" stroke="#4b5563" stroke-width="1.5" />
<line x1="270" y1="120" x2="220" y2="160" stroke="#4b5563" stroke-width="1.5" />
</svg>
<div style="position: absolute; top: 75px; font-size: 0.65rem; color: var(--secondary); font-weight: bold; font-family: var(--font-mono)">Chat Msg API</div>
</div>

<ul style="padding-left: 1.25rem; font-size: 0.85rem; color: var(--text-muted);">
<li><strong>Pros</strong>: True agent autonomy, robust, represents a strict MAS.</li>
<li><strong>Cons</strong>: Bandwidth limits, requires handshake state machines.</li>
<li><strong>Design Details</strong>: Minimal network footprint. Resource locking handled via asynchronous P2P chat messages. Requires robust schema parser/validator.</li>
</ul>
</div>

</div>

<h3 class="commentable" data-comment-id="schema-header">P2P Collaboration Message Schema</h3>
<p class="commentable" data-comment-id="schema-p">To synchronize actions via chat and avoid deadlocks, the following JSON messaging protocol is defined. Contracts transition through explicit, sequential lifecycle states (Proposed, Committed/Accepted, Arrived/Ready, Released, Closed). In addition to coordinates, they assign explicit roles (Dropper vs Picker) to prevent agents from blocking each other. 
<br><br>
<strong>System Footprint & Locking design:</strong> Payload structures use short fields (like <code>coopId</code>, <code>x</code>, <code>y</code>) to minimize bandwidth and stay within chat length limits. When a contract is established, target parcel IDs are "locked" in the shared belief base so the partner doesn't redundantly target them. Messages are pre-validated with light regex parsing before JSON loading, ensuring corrupt or extraneous chat text is safely ignored.
<br><br>
<strong>Walkthrough:</strong> 1) Master sends <code>PING</code>. 2) Executor replies <code>PONG</code>. 3) Master proposes a rendezvous handoff: <code>PROPOSE_CONTRACT</code>. 4) Partner replies <code>ACCEPT_CONTRACT</code>. 5) Partner navigates to coordinate, drops parcel, backs away to escape tile, and speaks <code>RELEASE_CARGO</code>. 6) Master retrieves parcel and sends <code>CLOSE_CONTRACT</code>.
</p>

<table>
<thead>
<tr>
<th>Message Type</th>
<th>Payload Structure</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr class="commentable" data-comment-id="row-msg-ping">
<td class="msg-type">PING</td>
<td><code>{ "type": "PING" }</code></td>
<td>Heartbeat verification of peer presence. Peer responds with PONG.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-pong">
<td class="msg-type">PONG</td>
<td><code>{ "type": "PONG", "payload": { "name", "x", "y", "score" } }</code></td>
<td>Response containing coordinates, name, and score.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-peer-status">
<td class="msg-type">PEER_STATUS</td>
<td><code>{ "type": "PEER_STATUS", "payload": { "name", "x", "y", "score", "nextStep", "path", "carried", "currentGoal", "crates" } }</code></td>
<td>Sends full spatial position, intent, path, carried inventory, and visible crate list.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-sync-req">
<td class="msg-type">SYNC_REQ</td>
<td><code>{ "type": "SYNC_REQ" }</code></td>
<td>Request to synchronize initial state between agents.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-sync-ack">
<td class="msg-type">SYNC_ACK</td>
<td><code>{ "type": "SYNC_ACK" }</code></td>
<td>Acknowledge synchronization request, transitioning BDI agent to synchronized state.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-lock">
<td class="msg-type">LOCK_TARGET</td>
<td><code>{ "type": "LOCK_TARGET", "targetId" }</code></td>
<td>Distributed locking mechanism to prevent both agents from pathing towards the same parcel.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-unlock">
<td class="msg-type">RELEASE_TARGET</td>
<td><code>{ "type": "RELEASE_TARGET", "targetId" }</code></td>
<td>Unlocks a parcel target (e.g., if it decayed or was preempted).</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-propose">
<td class="msg-type">PROPOSE_CONTRACT</td>
<td><code>{ "type": "PROPOSE_CONTRACT", "coopId", "contractType", "x", "y", "radius", "holdDuration", "courierId" }</code></td>
<td>LLM Coordinator proposes a joint task contract (RENDEZVOUS, HANDOFF, RELAY, CLEARING).</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-accept">
<td class="msg-type">ACCEPT_CONTRACT</td>
<td><code>{ "type": "ACCEPT_CONTRACT", "coopId" }</code></td>
<td>Confirms acceptance of the proposed contract.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-ready">
<td class="msg-type">SIGNAL_READY</td>
<td><code>{ "type": "SIGNAL_READY", "coopId" }</code></td>
<td>Signals that the agent has arrived at the target coordinate.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-release">
<td class="msg-type">RELEASE_CARGO</td>
<td><code>{ "type": "RELEASE_CARGO", "coopId" }</code></td>
<td>Dropper signals that they dropped the parcel and the peer can step forward to pick it up.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-close">
<td class="msg-type">CLOSE_CONTRACT</td>
<td><code>{ "type": "CLOSE_CONTRACT", "coopId" }</code></td>
<td>Handoff/cooperation is complete, closing the contract and returning both to normal loops.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-apply-rules">
<td class="msg-type">APPLY_RULES</td>
<td><code>{ "type": "APPLY_RULES", "rules" }</code></td>
<td>Updates the partner agent's belief base with new policy rules.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-move-to">
<td class="msg-type">MOVE_TO</td>
<td><code>{ "type": "MOVE_TO", "x", "y", "holdOnArrival", "holdDuration", "dropOnArrival" }</code></td>
<td>Directs partner movement to coordinates.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-move-to-ack">
<td class="msg-type">MOVE_TO_ACK</td>
<td><code>{ "type": "MOVE_TO_ACK", "success", "x", "y" }</code></td>
<td>Acknowledge movement completion status.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-hold">
<td class="msg-type">HOLD</td>
<td><code>{ "type": "HOLD" }</code></td>
<td>Pauses the physical agent.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-resume">
<td class="msg-type">RESUME</td>
<td><code>{ "type": "RESUME" }</code></td>
<td>Resumes the physical agent and clears active coordination contracts.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-instruct-say">
<td class="msg-type">INSTRUCT_SAY</td>
<td><code>{ "type": "INSTRUCT_SAY", "message" }</code></td>
<td>Instructs the agent to say a public chat message.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-set-variable">
<td class="msg-type">SET_VARIABLE</td>
<td><code>{ "type": "SET_VARIABLE", "name", "value" }</code></td>
<td>Sets a variable inside the partner agent memory.</td>
</tr>
</tbody>
</table>
</section>

<!-- 10. PDDL Modeling -->
<section id="pddl-model">
<div class="section-header">
<div class="section-num">10</div>
<h2>PDDL Modeling & Deadlock Avoidance</h2>
</div>
<p class="commentable" data-comment-id="pddl-p1">Obstacle crates block travel paths but can be pushed. Pushing must respect a core restriction: <strong>crates can only be moved onto "crate move capable" tiles</strong>.</p>

<p class="commentable" data-comment-id="deadlock-avoidance"><strong>Deadlock Avoidance Strategies</strong>: To prevent grid collisions, BDI agents execute a P2P path reservation protocol, broadcasting their intended path sequence on each step. If a path overlap is detected, the agent with lower priority yields (moves to a neighbor tile or waits). In rendezvous contracts, clear Role Assignments (Dropper drops cargo and steps back; Picker waits outside and steps in) and Escape Path invariants prevent deadlocking in narrow corridors. If no escape path exists, the contract is aborted, and agents resolve the deadlock reactively.</p>

<div class="terminal-window commentable" data-comment-id="code-pddl-domain">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">domain.pddl</span>
<button class="copy-btn" onclick="copyPrompt('pddlDomainContent')">Copy Code</button>
</div>
<div class="terminal-body">
<pre id="pddlDomainContent"><code class="prompt-code">(define (domain deliveroo)
  (:requirements :strips :typing)

  (:types
    tile agent parcel crate - object
  )

  (:predicates
    (at ?a - agent ?t - tile)
    (crate-at ?c - crate ?t - tile)
    (adjacent ?t1 - tile ?t2 - tile)
    (push-dir ?t1 - tile ?t2 - tile ?t3 - tile) ;; collinear: ?t1 -> ?t2 -> ?t3
    (clear ?t - tile)                           ;; tile has no agent and no crate
    (can-hold-crate ?t - tile)                  ;; true for CRATE_MOVE and CRATE_SPAWN tiles
    
    (delivery-zone ?t - tile)
    (parcel-at ?p - parcel ?t - tile)
    (carrying ?a - agent ?p - parcel)
    (delivered ?p - parcel)
  )

  ;; Agent steps into an adjacent, clear tile
  (:action move
    :parameters (?a - agent ?from - tile ?to - tile)
    :precondition (and 
      (at ?a ?from) 
      (adjacent ?from ?to) 
      (clear ?to)
    )
    :effect (and 
      (at ?a ?to) 
      (not (at ?a ?from)) 
      (clear ?from) 
      (not (clear ?to))
    )
  )

  ;; Agent pushes crate from ?to to ?next, stepping into ?to
  (:action push-crate
    :parameters (?a - agent ?c - crate ?from - tile ?to - tile ?next - tile)
    :precondition (and
      (at ?a ?from)
      (crate-at ?c ?to)
      (adjacent ?from ?to)
      (push-dir ?from ?to ?next)
      (can-hold-crate ?next)  ;; ENFORCED PATH CAPABILITY
      (clear ?next)
    )
    :effect (and
      (at ?a ?to)
      (not (at ?a ?from))
      
      (crate-at ?c ?next)
      (not (crate-at ?c ?to))
      
      (clear ?from)
      (not (clear ?next))
    )
  )
)</code></pre>
</div>
</div>

<div class="card commentable" data-comment-id="pddl-card-instance">
<div class="card-title">Problem Compiler Generation Rules</div>
<p style="margin-bottom: 0;">During every sensory planning frame, the physical BDI agent compiles the local map features. If a tile is flagged by the server map as a crate-capable movement tile (e.g. <code>CRATE_MOVE</code>), a corresponding <code>(can-hold-crate tile)</code> fact is injected into the initial state. The solver can then evaluate pushing strategies safely.</p>
</div>

<div class="card commentable" data-comment-id="pddl-gaps-analysis" style="margin-top: 1rem;">
<div class="card-title">Analysis of Domain Gaps, Fallacies & Invariants</div>
<p style="font-size: 0.9rem; margin-bottom: 0.75rem; color: var(--text-muted);">We identify critical gaps and reasoning fallacies in default PDDL assumptions:</p>
<ul style="padding-left: 1.25rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.6rem; font-size: 0.95rem;">
<li><strong>Directional Adjacency Assumption</strong>: Modeling standard adjacency <code>(adjacent t1 t2)</code> as symmetric/undirected fails when one-way tiles exist. We treat adjacencies as directed graphs so <code>(adjacent t1 t2)</code> does not imply reverse pathing.</li>
<li><strong>Crate-Movement Invariants</strong>: Enforcing <code>(can-hold-crate next)</code> assumes this property is static. If crates can be temporarily pushed onto any corridor tile to clear a blockage, modeling this statically causes solver failures.</li>
<li><strong>Collinear Direction Mapping</strong>: The <code>(push-dir t1 t2 t3)</code> predicate assumes pushes occur along collinear lines. Diagonal or irregular grid movements violate this assumption.</li>
</ul>
</div>
</section>

<!-- 11. LLM Sandbox Playground -->
<section id="llm-playground">
<div class="section-header">
<div class="section-num">11</div>
<h2>⚡ LLM Coordinator Sandbox & Prompt Playground</h2>
</div>
<p class="commentable" data-comment-id="sandbox-p1">Simulate and test multi-turn agent loops. Check how different LLM models interpret system prompts, make reasoning decisions, evaluate coordinates, and utilize tools before deploying files.</p>

<div class="sandbox-grid">

<!-- Sandbox Controls Panel -->
<div class="sandbox-panel commentable" data-comment-id="sandbox-ctrls">
<div class="card-title">⚙️ Sandbox Configurations</div>

<div class="tabs-header" style="margin-top: 1rem; margin-bottom: 1rem;">
<button type="button" class="tab-btn active" id="tabModeAgent" onclick="setSandboxMode('agent')">🕵️ Agentic Loop</button>
<button type="button" class="tab-btn" id="tabModeDirect" onclick="setSandboxMode('direct')">💬 Direct Response</button>
</div>

<div class="form-group">
<label class="form-label">LLM Provider Host URL</label>
<input type="text" id="llmHost" class="form-input" value="https://llm.bears.disi.unitn.it/v1">
</div>

<div class="form-group">
<label class="form-label">API Authorization Key (Loaded from .env)</label>
<div style="display: flex; gap: 0.5rem; width: 100%;">
<input type="password" id="llmKey" class="form-input" placeholder="Loading key..." style="flex-grow: 1;">
<button type="button" class="btn btn-secondary" id="toggleKeyVisibilityBtn" onclick="toggleKeyVisibility()" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; width: auto; flex-shrink: 0; white-space: nowrap;">👁️ Show</button>
<button type="button" class="btn btn-secondary" onclick="fetchServerConfig()" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; width: auto; flex-shrink: 0; white-space: nowrap;">🔄 Load Env</button>
</div>
</div>

<div class="form-group">
<label class="form-label">Model Selection</label>
<select id="llmModelSelect" class="form-input form-select" onchange="handleModelDropdownChange()">
<option value="llama-3.3-70b-lmstudio" selected>llama-3.3-70b-lmstudio (LM Studio)</option>
<option value="gemma-3-27b-lmstudio">gemma-3-27b-lmstudio (Gemma 3)</option>
<option value="qwen/qwen3.6-35b-a3b">qwen/qwen3.6-35b-a3b (Qwen)</option>
<option value="gpt-4o">gpt-4o (OpenAI)</option>
<option value="custom">Custom Model...</option>
</select>
<input type="text" id="llmModelCustom" class="form-input" style="display:none; margin-top: 0.5rem;" placeholder="Enter custom model ID...">
</div>

<div class="form-group">
<div style="display:flex; justify-content:space-between; align-items:center;">
<label class="form-label">System Instructions Prompt</label>
<div style="display:flex; gap: 0.5rem;">
<button class="copy-btn" onclick="openSystemPromptModal()" style="font-size:0.7rem;">📝 Expand Editor</button>
<button class="copy-btn" onclick="restoreDefaultSystemPrompt()" style="font-size:0.7rem;">Restore Default</button>
</div>
</div>
<textarea id="sandboxSystemPrompt" class="form-input form-textarea" placeholder="Enter system instructions..."></textarea>
</div>

<div class="form-group">
<label class="form-label">Quick Challenge Templates</label>
<div class="test-cases-row">
<button class="test-case-chip" onclick="loadTestCase(1)">📐 Coordinate Math</button>
<button class="test-case-chip" onclick="loadTestCase(2)">🛡️ Apply Policy Rules</button>
<button class="test-case-chip" onclick="loadTestCase(3)">🤝 Rendezvous Contract</button>
</div>
</div>

<div class="form-group">
<label class="form-label">User Target Task (Instruction)</label>
<textarea id="sandboxUserTask" class="form-input" style="min-height:80px; font-family:var(--font-body);" placeholder="Type a task command..."></textarea>
</div>

<div class="sandbox-buttons" style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
<button id="btnStartSandbox" class="btn btn-primary" onclick="runAgentSandbox()">Execute Sandbox Loop</button>
<button id="btnStopSandbox" class="btn btn-secondary" style="display:none;" onclick="stopAgentSandbox()">Stop Agent</button>
<button id="btnResetSandbox" class="btn btn-secondary" onclick="resetSandboxSession()">🧹 Reset Session</button>
<label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; cursor: pointer; user-select: none; margin-left: auto; color: var(--text-main);">
<input type="checkbox" id="chkChatMode" checked onchange="updateButtons()" style="cursor: pointer;">
💬 Keep Chat History
</label>
</div>
</div>

<!-- Live Log Terminal Panel -->
<div style="display: flex; flex-direction: column; gap: 1rem;">
<div class="card-title">🖥️ Live Agent Reasoning Console</div>
<div id="sandboxConsole" class="terminal-log commentable" data-comment-id="sandbox-logs">
<div class="log-line log-system">System ready. Click "Execute Sandbox Loop" to begin simulation.</div>
</div>
</div>

</div>

<!-- Saved Runs & Output Annotations -->
<div class="card" style="margin-top: 1.5rem;">
<div class="card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
<span>📁 Saved LLM Runs & Output History</span>
<button class="btn btn-secondary" onclick="saveCurrentRun()" style="font-size:0.75rem; padding: 0.4rem 0.8rem; width: auto; font-family: var(--font-heading);">💾 Save Current Run</button>
</div>
<p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">Archive specific execution runs, prompt versions, and tool outputs here to add design notes, critiques, and run annotations.</p>
<div id="savedRunsList" style="display: flex; flex-direction: column; gap: 1rem;">
<!-- Saved runs will be loaded here dynamically -->
<div style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1rem; border: 1px dashed var(--border-color); border-radius: 8px;">No saved runs yet. Click "Save Current Run" above to archive an execution.</div>
</div>
</div>
</section>

</main>