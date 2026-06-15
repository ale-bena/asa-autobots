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
<div class="agent-desc">A physical planner and executor. To mitigate online solver latency, we avoid sending a raw tile-by-tile adjacency representation to PDDL. Instead, the PDDL solver is strictly leveraged for high-level <strong>Plan Selection</strong> (e.g. selecting target clusters or corridor-clearing pushes) and local A* pathfinding is used for step-by-step navigation. <strong>Plan Selection Mechanics:</strong> The agent evaluates the preconditions of each recipe in the Plan Library on every sensory frame, calculates target utilities as a ratio of <code>points / path_distance</code> by feeding state snapshots into the <strong>AST Rule Evaluation Engine</strong> (while respecting active policy blocks), and executes the recipe with the highest score, invoking PDDL only when local pathing is blocked by obstacle crates.</div>
</div>
<ul class="agent-features">
<li class="agent-feature-item">
<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
Abstracted Cluster Adjacency mapping
</li>
<li class="agent-feature-item">
<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
Multi-Priority Task Queue
</li>
<li class="agent-feature-item">
<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
Executes Plan Preemption
</li>
</ul>
</div>

<div class="agent-card llm commentable" data-comment-id="agent-card-llm">
<div>
<span class="agent-badge">Agent 2</span>
<div class="agent-name">LLM Agent (Master)</div>
<div class="agent-desc">The master reasoning brain and coordinator. It intercepts natural language challenge instructions (Special Missions) from the Admin, executes the multi-turn agentic loop, evaluates math, and instructs the partner agent's movement and chat outputs. <strong>Physical Action Capabilities:</strong> Note that the LLM agent is fully capable of navigating, picking up, and delivering parcels directly as well (acting as a physical agent if needed). <strong>Tool & Rule Handling:</strong> Intercepts tool calls and leverages the <strong>AST Rule Evaluation Engine</strong> to dynamically compile natural language instructions into active behavioral policies, feeding outcomes back to the BDI belief base. <strong>Messaging Protocol:</strong> Communicates with the partner via game chat using a highly structured JSON messaging schema (including PING/PONG and PROPOSE/ACCEPT contracts).</div>
</div>
<ul class="agent-features">
<li class="agent-feature-item">
<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
System Prompt with XML Guardrails
</li>
<li class="agent-feature-item">
<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
Multi-turn Agentic Math loops
</li>
<li class="agent-feature-item">
<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
Translates natural language to rules
</li>
</ul>
</div>
</div>

<h3 class="commentable" data-comment-id="missions-header">Special Mission Challenge Tiers & Schema</h3>
<p class="commentable" data-comment-id="missions-p">The system is built to intercept and handle highly generalized, dynamic challenge prompts ("Special Missions"). Since these challenges can contain highly arbitrary conditionals, loops, and math puzzles, we use a flexible rule evaluation engine that parses natural language specifications into dynamic executable structures (like JSON ASTs) capable of evaluating boolean expressions (e.g., `stack_size < reward`) at every tick. To support a <strong>Turing-complete level of actions</strong>, the coordinator translates missions into a structured JSON execution tree containing conditionals, loops, assignments, and API actions. A similar AST approach is leveraged for plan preconditions and policy evaluation:</p>

<div class="terminal-window">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">turing_complete_mission_schema.json</span>
</div>
<div class="terminal-body">
<pre><code>{
  "type": "object",
  "properties": {
    "missionId": { "type": "string" },
    "variables": { "type": "object", "additionalProperties": { "type": "string" } },
    "behavior": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "properties": {
              "type": { "type": "string", "enum": ["assignment"] },
              "target": { "type": "string" },
              "expression": { "type": "string" }
            },
            "required": ["type", "target", "expression"]
          },
          {
            "properties": {
              "type": { "type": "string", "enum": ["conditional"] },
              "condition": { "type": "string" },
              "then": { "type": "array" },
              "else": { "type": "array" }
            },
            "required": ["type", "condition", "then"]
          },
          {
            "properties": {
              "type": { "type": "string", "enum": ["loop"] },
              "condition": { "type": "string" },
              "body": { "type": "array" }
            },
            "required": ["type", "condition", "body"]
          },
          {
            "properties": {
              "type": { "type": "string", "enum": ["action"] },
              "name": { "type": "string" },
              "arguments": { "type": "object" }
            },
            "required": ["type", "name"]
          }
        ]
      }
    }
  },
  "required": ["missionId", "behavior"]
}</code></pre>
</div>
</div>

<div class="card commentable" data-comment-id="schema-parsing-details" style="margin-top: 1.5rem; margin-bottom: 2rem;">
<div class="card-title">Mission Parser & AST Execution Flow</div>
<p>To execute the mission behavior tree, the agent compiles natural language specifications into the JSON AST schema defined above. The local execution engine then recursively processes this AST structure, mapping each block type to a JavaScript **async generator** (<code>function*</code>). By utilizing generators, the agent can yield control back to the main coordination loop after each operation, ensuring real-time responsiveness and allowing sensory updates or peer-to-peer messages to interrupt execution if necessary.</p>

<div style="margin: 1.5rem 0; padding: 1rem; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px;">
    <h4 style="color: var(--primary); margin-bottom: 0.75rem; font-size: 1rem;">JSON AST Node Specifications & JS Project Representation</h4>
    <p style="font-size: 0.9rem; line-height: 1.5; margin-bottom: 1rem;">
        The special mission parser translates the incoming behavioral rules into a flat or nested execution graph composed of the following structural node specifications. Each node has a well-defined validation schema and maps directly to concrete classes within the agent's JavaScript codebase:
    </p>
    <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 1rem; border: 1px solid var(--border-color);">
        <thead>
            <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border-color);">
                <th style="padding: 0.5rem; text-align: left; border-right: 1px solid var(--border-color);">AST Node Type</th>
                <th style="padding: 0.5rem; text-align: left; border-right: 1px solid var(--border-color);">JSON Fields & Schema Constraints</th>
                <th style="padding: 0.5rem; text-align: left;">JavaScript Class & Execution Mapping</th>
            </tr>
        </thead>
        <tbody>
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); font-weight: 600; color: var(--accent-cyan);">Assignment</td>
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); color: var(--text-muted);">
                    <code>target</code>: string (valid identifier)<br>
                    <code>expression</code>: string (math formula)<br>
                    <em>Constraint:</em> Variables are stored in local agent scope.
                </td>
                <td style="padding: 0.5rem; color: var(--text-muted);">
                    Class <code>AssignmentStep</code> parses the expression string via a safe math resolver and binds the result to the <code>agentState.variables</code> map.
                </td>
            </tr>
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); font-weight: 600; color: var(--accent-cyan);">Conditional</td>
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); color: var(--text-muted);">
                    <code>condition</code>: string (evaluates to boolean)<br>
                    <code>then</code>: AST Node Array (required)<br>
                    <code>else</code>: AST Node Array (optional)
                </td>
                <td style="padding: 0.5rem; color: var(--text-muted);">
                    Class <code>ConditionalStep</code> evaluates the condition string, delegating execution to the child steps using generator delegation (<code>yield*</code>).
                </td>
            </tr>
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); font-weight: 600; color: var(--accent-cyan);">Loop</td>
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); color: var(--text-muted);">
                    <code>condition</code>: string (evaluated per iteration)<br>
                    <code>body</code>: AST Node Array (required)
                </td>
                <td style="padding: 0.5rem; color: var(--text-muted);">
                    Class <code>LoopStep</code> runs a <code>while</code> loop. It yields a <code>TICK_YIELD</code> token after each body iteration to keep the agent responsive to external sensory updates.
                </td>
            </tr>
            <tr>
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); font-weight: 600; color: var(--accent-cyan);">Action</td>
                <td style="padding: 0.5rem; border-right: 1px solid var(--border-color); color: var(--text-muted);">
                    <code>name</code>: string (valid API function)<br>
                    <code>arguments</code>: object (arguments map)<br>
                    <em>Constraint:</em> Name must match physical agent capabilities.
                </td>
                <td style="padding: 0.5rem; color: var(--text-muted);">
                    Class <code>ActionStep</code> maps execution directly to physical async procedures (<code>move</code>, <code>pickup</code>, <code>deliver</code>) and awaits server tick verification.
                </td>
            </tr>
        </tbody>
    </table>
</div>

<h4 style="margin-top: 1rem; color: var(--accent-cyan); font-size: 0.95rem;">Step Type Execution Mechanics</h4>
<ul style="list-style-type: none; padding-left: 0; margin-top: 0.5rem;">
<li style="margin-bottom: 0.75rem;">
<strong>1. Assignment (<code>type: "assignment"</code>)</strong><br>
<span style="font-size: 0.9rem; color: var(--text-muted);">
Evaluates the <code>expression</code> string against the current local state using a safe sandbox environment or simplified math evaluator, binding the resolved result to the local memory under the variable name specified in <code>target</code>.
</span>
</li>
<li style="margin-bottom: 0.75rem;">
<strong>2. Conditional (<code>type: "conditional"</code>)</strong><br>
<span style="font-size: 0.9rem; color: var(--text-muted);">
Parses the <code>condition</code> expression. If it evaluates to truthy, the execution delegates to the <code>then</code> array of AST nodes using generator delegation (<code>yield*</code>); otherwise, it delegates to the <code>else</code> array (if defined).
</span>
</li>
<li style="margin-bottom: 0.75rem;">
<strong>3. Loop (<code>type: "loop"</code>)</strong><br>
<span style="font-size: 0.9rem; color: var(--text-muted);">
Repeatedly checks the <code>condition</code> expression. As long as it remains true, it yields execution control at each body step iteration. This prevents CPU-blocking infinite loops, allowing sensor inputs (like parcel pickups or layout changes) to be handled.
</span>
</li>
<li style="margin-bottom: 0.75rem;">
<strong>4. Action (<code>type: "action"</code>)</strong><br>
<span style="font-size: 0.9rem; color: var(--text-muted);">
Maps the action <code>name</code> and <code>arguments</code> directly to physical asynchronous agent functions (e.g. <code>move</code>, <code>pickup</code>, <code>deliver</code>). Yields a structural promise or action object that waits for server tick verification before completing.
</span>
</li>
</ul>

<h4 style="margin-top: 1.2rem; color: var(--accent-cyan); font-size: 0.95rem;">JavaScript Representation Example</h4>
<pre style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 6px; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-main); overflow-x: auto; margin-top: 0.5rem;"><code>// JavaScript AST Engine Interpreter implementation
export function* executeMissionBehavior(behavior, agentState) {
    for (const step of behavior) {
        switch (step.type) {
            case 'assignment':
                agentState.variables[step.target] = evaluateExpression(step.expression, agentState);
                break;
            case 'conditional':
                if (evaluateExpression(step.condition, agentState)) {
                    yield* executeMissionBehavior(step.then, agentState);
                } else if (step.else) {
                    yield* executeMissionBehavior(step.else, agentState);
                }
                break;
            case 'loop':
                while (evaluateExpression(step.condition, agentState)) {
                    yield* executeMissionBehavior(step.body, agentState);
                    yield { type: 'TICK_YIELD' }; // yield control to sensor update loop
                }
                break;
            case 'action':
                yield { type: 'ACTION', name: step.name, args: step.arguments };
                break;
        }
    }
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
<div class="mission-desc">Persistent, non-atomic constraints active for the duration of the match. Constraints must be extremely flexible to adapt to temporal parcel decay rates, shifting grid zones, and sudden path closures. These rules are integrated into the evaluation engine, which recalculates cost weights and checks AST condition assertions at every tick of the A* routing loop.</div>
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
<strong>Evaluation Engine Integration:</strong> The AST Evaluation Engine filters out unfeasible macro-goals (e.g. sectors with zero/negative reward utility or zones completely cut off by static walls) before they are sent to the PDDL compiler. This prevents wasting valuable CPU cycles solving unreachable objectives.
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
<div class="card-title">Level 2 Persistent Rules Integration (AST Engine)</div>
<p style="margin-bottom: 1rem;">To support highly generalized logic statements, the Policy Engine parses rules into **Abstract Syntax Trees (ASTs)**. Conditional expressions evaluate live variables (e.g. <code>carrying.size</code>, <code>reward</code>, <code>steps</code>) using standard comparison and logical operators at every tick:</p>
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
<strong>Policy Update Arguments Structure:</strong> The policy update payload contains an <code>agentId</code> (specifying the target executor) and a <code>rules</code> object defining the constraints. The rules schema supports: 
<code>avoidTiles</code> (an array of coordinates, e.g. <code>["3,5", "4,5"]</code>), 
<code>maxRewardLimit</code> (a ceiling float), 
<code>minRewardThreshold</code> (a floor float), 
<code>requiredStackSize</code> (an integer stack count), 
<code>multiplierRules</code> (objects containing an AST <code>condition</code> string and a <code>multiplier</code> factor), and 
<code>bonusRules</code> (objects containing an AST <code>condition</code> string and a <code>bonus</code> value).
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
You are the coordinator of a hybrid multi-agent team.
&lt;message_handling_protocol&gt;
================================================================================
MESSAGE HANDLING PROTOCOLS
================================================================================
1. SYSTEM STATE MESSAGES:
   - System state is provided at each turn under the user role or as system messages. Process these updates as read-only spatial inputs. Do not modify or hallucinate coordinates.
2. TURN SEQUENCE:
   - Read the user command, examine visible parcels/crates, and evaluate math expressions first before choosing a plan.
   - If tools are called, wait for the tool output before replying to the user.
3. MULTI-TURN CONTEXT MANAGEMENT:
   - Maintain historical state using the system chat history. Do not repeat completed tool calls.
================================================================================
MODEL REASONING GUIDELINES
================================================================================
- LLAMA-3.3 (LM Studio): Strict single tool-calling limit. If you need to make multiple calls, execute them sequentially across separate chat turns. Do not call multiple tools in a single JSON payload.
- GEMMA / QWEN: Highly strict on JSON schema matching. Ensure arguments match parameters exactly. Do not output markdown preambles when executing tools.
- GPT-4O: Capable of parallel tool-calling. Use parallel calls for multiple evaluations.
&lt;/message_handling_protocol&gt;

&lt;detailed_tool_manifest&gt;
Note: The system prompt's available tools are dynamically compiled from the modular registry in toolsRegistry.js.
Below are the registered tools:

1. evaluate_math_expression:
   - Description: Resolves arithmetic formulas into numeric values.
   - Args: { "expression": "expression_string" }
   - Action Tool: No

2. move_agent_to_coordinate:
   - Description: Directs the BDI partner agent to navigate to a specific grid coordinate (rounded and clamped).
   - Args: { "agentId": "BDI_AGENT_ID", "x": number, "y": number }
   - Action Tool: Yes

3. apply_agent_rules:
   - Description: Modifies behavioral policies/rules in the partner agent. Supports avoidTiles, minRewardThreshold, maxRewardLimit, requiredStackSize, multiplierRules (condition and multiplier), and bonusRules (condition and bonus).
   - Args: { "agentId": "BDI_AGENT_ID", "rules": { ... } }
   - Action Tool: Yes

4. cooperate_with_agent:
   - Description: Proposes a Peer-to-Peer rendezvous or gate clearing contract, or cancels/closes active cooperation.
   - Args: { "agentId": "BDI_AGENT_ID", "contract": { "type": "RENDEZVOUS" | "CLEARING" | "CLOSE", "x": number, "y": number } }
   - Action Tool: Yes

5. instruct_agent_to_say:
   - Description: Instructs the partner agent to speak a message publicly.
   - Args: { "agentId": "BDI_AGENT_ID", "message": "text" }
   - Action Tool: Yes

6. get_local_context:
   - Description: Fetches the agent's current state (me position/score/status, variables, carried items, rules, parcels, and peers).
   - Args: {}
   - Action Tool: No

7. set_agent_variable:
   - Description: Saves a variable to agent memory.
   - Args: { "name": "var_name", "value": any }
   - Action Tool: Yes
&lt;/detailed_tool_manifest&gt;
&lt;bdi_lifecycle_state&gt;
Current state contains positions, parcel scores, rules, and active contract transitions (PROPOSE, ACCEPT, READY, DROP, PICKUP, COMPLETE).
&lt;/bdi_lifecycle_state&gt;
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
<strong>Turing-Capable Logical Toolset under design:</strong> To enable the LLM to resolve arbitrary logical constraints programmatically, we are designing a primitive set of logical tools. This includes a <em>Comparison Tool</em> (<code>compare_values(a, b, op)</code> supporting <code>lt</code>, <code>gt</code>, <code>eq</code>, etc.), a <em>Logical Connective Tool</em> (<code>evaluate_logic(b1, b2, gate)</code> supporting <code>AND</code>, <code>OR</code>, <code>NOT</code>), a <em>Variable Register Tool</em> (<code>declare_variable(name, value)</code> / <code>get_variable(name)</code>), and an explicit execution branching tool (<code>branch_execution(condition, true_branch, false_branch)</code>). By leveraging this state-maintenance capability across turns, the LLM can store intermediate steps, execute loops programmatically by recursively calling itself, and construct complex decision structures to solve any generalized challenge.
</p>

<div class="tools-grid">

<!-- Tool 1 -->
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

<!-- Tool 2 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-move" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">N</div>
<div>
<div class="tool-name">move_agent_to_coordinate(agentId, x, y)</div>
<div class="tool-desc">Immediately route a specific physical agent to a target cell coordinate.</div>
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
    "agentId": {
      "type": "string",
      "description": "The unique ID of the agent to move (self or partner)."
    },
    "x": { "type": "number" },
    "y": { "type": "number" }
  },
  "required": ["agentId", "x", "y"]
}</code></pre>
</div>
</div>
</div>

<!-- Tool 3 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-rules" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">P</div>
<div>
<div class="tool-name">apply_agent_rules(agentId, rules)</div>
<div class="tool-desc">Updates environmental rules (avoid tiles, reward ceilings) inside BDI belief.</div>
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
    "agentId": {
      "type": "string",
      "description": "Target agent ID."
    },
    "rules": {
      "type": "object",
      "properties": {
        "avoidTiles": {
          "type": "array",
          "items": { "type": "string", "description": "Coordinates as 'x,y'" }
        },
        "maxRewardLimit": { "type": "number" },
        "minRewardThreshold": { "type": "number" },
        "requiredStackSize": { "type": "integer" },
        "multiplierRules": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "condition": { "type": "string", "description": "AST condition string (e.g. 'carrying.size == 3')" },
              "multiplier": { "type": "number" }
            },
            "required": ["condition", "multiplier"]
          }
        },
        "bonusRules": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "condition": { "type": "string", "description": "AST condition string (e.g. 'x == 2 && y == 3')" },
              "bonus": { "type": "number" }
            },
            "required": ["condition", "bonus"]
          }
        }
      }
    }
  },
  "required": ["agentId", "rules"]
}</code></pre>
</div>
</div>
</div>

<!-- Tool 4 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-coop" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">C</div>
<div>
<div class="tool-name">cooperate_with_agent(agentId, contract)</div>
<div class="tool-desc">Initiates a multi-agent coordination rendezvous or clearance.</div>
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
    "agentId": { "type": "string" },
    "contract": {
      "type": "object",
      "properties": {
        "coordinationId": { "type": "string" },
        "type": { "type": "string", "enum": ["RENDEZVOUS", "CLEAR_PATH"] },
        "x": { "type": "number" },
        "y": { "type": "number" }
      },
      "required": ["coordinationId", "type"]
    }
  },
  "required": ["agentId", "contract"]
}</code></pre>
</div>
</div>
</div>

<!-- Tool 5 -->
<div class="tool-expand-card commentable" data-comment-id="tool-card-say" onclick="toggleTool(this)">
<div class="tool-summary">
<div class="tool-name-container">
<div class="tool-icon-box">S</div>
<div>
<div class="tool-name">instruct_agent_to_say(agentId, message)</div>
<div class="tool-desc">Causes the chosen agent to speak a message publicly.</div>
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
    "agentId": { "type": "string" },
    "message": { "type": "string" }
  },
  "required": ["agentId", "message"]
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
<td>Verification of peer presence. Peer responds with positional & score stats.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-pong">
<td class="msg-type">PONG</td>
<td><code>{ "type": "PONG", "payload": { "x", "y", "score" } }</code></td>
<td>Response package to a PING.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-propose">
<td class="msg-type">PROPOSE_CONTRACT</td>
<td><code>{ "type": "PROPOSE_CONTRACT", "coopId", "type", "x", "y" }</code></td>
<td>LLM Coordinator proposes a joint task (e.g. rendezvous at x,y). Sets state to **Proposed**.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-accept">
<td class="msg-type">ACCEPT_CONTRACT</td>
<td><code>{ "type": "ACCEPT_CONTRACT", "coopId" }</code></td>
<td>PDDL agent accepts the proposal and switches its planning state to **Committed**.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-ready">
<td class="msg-type">SIGNAL_READY</td>
<td><code>{ "type": "SIGNAL_READY", "coopId", "role" }</code></td>
<td>Sent when an agent arrives at the target coordinate. Transition to **Arrived**. Dropper exits tile, Picker waits.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-release">
<td class="msg-type">RELEASE_CARGO</td>
<td><code>{ "type": "RELEASE_CARGO", "coopId" }</code></td>
<td>Dropper signals that they dropped the parcel and cleared the escape path. State transitions to **Released**.</td>
</tr>
<tr class="commentable" data-comment-id="row-msg-close">
<td class="msg-type">CLOSE_CONTRACT</td>
<td><code>{ "type": "CLOSE_CONTRACT", "coopId" }</code></td>
<td>Handoff is complete, state is **Closed**. Both return to standard operations.</td>
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