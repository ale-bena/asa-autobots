<main class="main-panel">
    <header style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-color); padding-bottom: 1.5rem; margin-bottom: 3rem;">
        <div>
            <div class="badge-header">Project Overview</div>
            <h1>Collab Agent Team Hub</h1>
            <div class="subtitle">Centralized documentation, design patterns, and recent features for the hybrid Deliveroo multi-agent system.</div>
        </div>
    </header>

    <section id="architecture">
        <div class="section-header">
            <div class="section-num">1</div>
            <h2>Hybrid Architecture Split</h2>
        </div>
        <p class="commentable" data-comment-id="arch-p1">
            The system employs a dual-agent cooperative strategy combining the strengths of symbolic planning and LLM cognitive reasoning:
        </p>
        <ul style="padding-left: 1.5rem; line-height: 1.6; color: var(--text-muted);">
            <li><strong>LLM Coordinator Agent (Master Brain)</strong>: Intercepts user/admin requests, runs an agentic loop, evaluates complex math, stores variables in memory, and translates constraints into structured policy rules.</li>
            <li><strong>BDI Executor Agent (Physical Partner)</strong>: Performs grid navigation, parcel collection, and delivery using a pre-compiled Plan Library (HFSM-modeled) and local A* pathfinding.</li>
        </ul>
    </section>

    <section id="features" style="margin-top: 3rem;">
        <div class="section-header">
            <div class="section-num">2</div>
            <h2>Core Features & Logic Overhaul</h2>
        </div>
        
        <div class="card commentable" data-comment-id="feat-policy" style="margin-bottom: 1.5rem;">
            <div class="card-title">Dynamic Policy & Traversal Engine</div>
            <p style="margin-bottom: 0.5rem;">The Policy Engine (<code>PolicyEngine.js</code>) dynamically evaluates Abstract Syntax Tree (AST) expressions. We have added support for the <code>path.traverses_X_Y</code> condition:</p>
            <ul style="padding-left: 1.25rem; font-size: 0.9rem; color: var(--text-muted);">
                <li>Allows the system to dynamically check if the projected A* path of the agent crosses a specific tile (e.g. <code>(15,15)</code>).</li>
                <li>Leveraged by the BDI agent to adjust utility values by applying traversal penalties (negative bonuses) to candidate paths before starting movement.</li>
            </ul>
        </div>

        <div class="card commentable" data-comment-id="feat-p2p" style="margin-bottom: 1.5rem;">
            <div class="card-title">P2P Cooperation Contracts (Rendezvous & Wait Command)</div>
            <p style="margin-bottom: 0.5rem;">Agents coordinate via Peer-to-Peer messaging (<code>P2PCollaboration.js</code>) using contract schemas (<code>PROPOSE</code>, <code>ACCEPT</code>, <code>READY</code>, <code>DROP</code>, <code>COMPLETE</code>, etc.):</p>
            <ul style="padding-left: 1.25rem; font-size: 0.9rem; color: var(--text-muted);">
                <li><strong>Rendezvous Protocol</strong>: Supports high-priority coordination contracts where the executor navigates to a coordinate and executes a <code>wait</code> command, standing still until explicitly released.</li>
                <li><strong>Close Support</strong>: Permits the coordinator to issue a <code>CLOSE</code> contract type to release the agent and resume normal execution.</li>
            </ul>
        </div>

        <div class="card commentable" data-comment-id="feat-robustness" style="margin-bottom: 1.5rem;">
            <div class="card-title">Movement & Coordination Robustness</div>
            <p style="margin-bottom: 0.5rem;">Key stability guardrails have been added to prevent deadlocks and stuck states:</p>
            <ul style="padding-left: 1.25rem; font-size: 0.9rem; color: var(--text-muted);">
                <li><strong>Math Parsing & Negative Rewards</strong>: Fixed the Shunting-Yard parser to support unary negative numbers (e.g., <code>20 * -2</code> evaluates to <code>-40</code>). Task reward parameters are inspected; zero or negative reward tasks are automatically suppressed.</li>
                <li><strong>Float Clamping & Rounding</strong>: Added coordinate rounding and map boundary clamping inside <code>toolsRegistry.js</code> and <code>PlanLibrary.js</code> to ensure target coordinates align 1-to-1 with the simulator grid.</li>
                <li><strong>Reply-to-Admin Delegation</strong>: Forwarded admin prompts are intercepted, and BDI agents delegate replies privately using <code>emitSay(adminId, message)</code> instead of shouting publicly.</li>
            </ul>
        </div>

        <div class="card commentable" data-comment-id="feat-modular" style="margin-bottom: 1.5rem;">
            <div class="card-title">Dynamic Modular Prompt Generation</div>
            <p style="margin-bottom: 0;">We refactored the tool architecture to package declarations, descriptions, argument schemas, action flags, and implementations into single objects inside <code>toolsRegistry.js</code>. The system prompt in <code>prompts.js</code> dynamically queries this registry at load time to generate the XML <code>&lt;available_tools&gt;</code> manifest, guaranteeing that documentation is always in sync with implementation.</p>
        </div>
    </section>
</main>
