<main class="main-content">
<header>
<div>
<h1>🗺️ Map Creation & Loading Specification</h1>
<div class="subtitle">Complete guide to visual grid designing, coordinate transposition, and simulator map loading.</div>
</div>
</header>

<!-- 1. The Visual Map Creator -->
<section id="map-creator-tool">
<div class="section-header">
<div class="section-num">1</div>
<h2>Visual Map Creator Utility</h2>
</div>
<p>
The project includes an interactive <strong>Map Creator</strong> tool served at the <code>/map-creator</code> endpoint of the documentation server. This tool allows developers to visually design simulation arenas instead of manually writing coordinate matrices.
</p>

<div class="alert alert-info">
<strong>Using the Map Creator:</strong> Set the grid width and height, select a brush from the painter palette, and paint tiles on the canvas (using click or click-and-drag). The corresponding simulator JSON configuration is compiled dynamically in real-time.
</div>

<h3>Supported Tile Types & Visual Meanings</h3>
<table>
<thead>
<tr>
<th>Tile Value</th>
<th>Visual Name</th>
<th>Color in Editor</th>
<th>Simulation Invariant / Purpose</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>"0"</code></td>
<td>Walkable</td>
<td>Deep Blue / Black</td>
<td>Standard walkable cell. Agents, crates, and parcels can occupy it.</td>
</tr>
<tr>
<td><code>"3"</code></td>
<td>Wall</td>
<td>Grey</td>
<td>Impassable static obstacle. Cannot be occupied or pushed through.</td>
</tr>
<tr>
<td><code>"1"</code></td>
<td>Spawn Zone</td>
<td>Green Glow</td>
<td>Designated starting grid cell for Deliveroo agents.</td>
</tr>
<tr>
<td><code>"2"</code></td>
<td>Delivery Zone</td>
<td>Purple Glow</td>
<td>Designated drop-off point where cargo parcels must be delivered for points.</td>
</tr>
<tr>
<td><code>"5"</code></td>
<td>Crate Spawn</td>
<td>Orange Glow</td>
<td>Tile initially populated with a movable obstacle crate.</td>
</tr>
<tr>
<td><code>"5!"</code></td>
<td>Target Zone</td>
<td>Red Glow</td>
<td>Specialized tile. Movable obstacle crates can only be pushed onto target cells.</td>
</tr>
<tr>
<td><code>"↑", "→", "↓", "←"</code></td>
<td>One-Way Gates</td>
<td>Light Cyan Arrow</td>
<td>Spatial directional arrows painted on tiles. Impose asymmetric routing blockages.</td>
</tr>
</tbody>
</table>
</section>

<!-- 2. Coordinate Transposition -->
<section id="coordinate-transposition">
<div class="section-header">
<div class="section-num">2</div>
<h2>Coordinate Transposition & Cartesian Mapping</h2>
</div>
<p>
Standard HTML pages and multidimensional arrays in programming list grids using top-down indices: <code>grid[row][col]</code>. In this layout, <code>row 0</code> is the visual top, and increasing rows move downwards.
</p>
<p>
However, the <strong>Deliveroo Simulator</strong> uses a Cartesian coordinate grid where <code>(0,0)</code> is the <strong>bottom-left</strong> corner. X increases going right, and Y increases going up.
</p>

<div class="card">
<div class="card-title">Transposition Formula (Flipping)</div>
<p style="margin-bottom: 1rem;">
To align the HTML editor layout with the simulator's JSON schema, the Map Creator transposes visual cell coordinates <code>(row, col)</code> into schema coordinates <code>(x, y)</code>:
</p>
<pre style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 6px; font-family: var(--font-mono); font-size: 0.85rem; color: var(--accent-cyan);"><code>// Translating from Visual Row/Col (Top-Down) to Cartesian X/Y (Bottom-Up)
const x = col;
const y = (gridHeight - 1) - row;

// Translating back from Cartesian X/Y to Visual Row/Col
const row = (gridHeight - 1) - y;
const col = x;</code></pre>
</div>
</section>

<!-- 3. Generated JSON Schema -->
<section id="json-schema">
<div class="section-header">
<div class="section-num">3</div>
<h2>Map Configuration JSON Schema</h2>
</div>
<p>
Once designed, the Map Creator compiles the layout into the simulator's required JSON configuration. The JSON structure represents the map grid as a column-oriented array of tile rows: <code>tiles[x][y]</code>.
</p>

<div class="terminal-window">
<div class="terminal-header">
<div class="terminal-dots">
<div class="dot dot-red"></div>
<div class="dot dot-yellow"></div>
<div class="dot dot-green"></div>
</div>
<span class="terminal-title">map_config_schema.json</span>
</div>
<div class="terminal-body">
<pre><code>{
  "title": "custom_arena",
  "description": "JSON map configuration.",
  "maxPlayers": 4,
  "map": {
    "width": 10,
    "height": 10,
    "tiles": [
      ["3", "3", "3", "3", "3", "3", "3", "3", "3", "3"], // column x=0 (y=0 to y=9)
      ["3", "1", "0", "0", "0", "0", "0", "0", "0", "3"], // column x=1 (y=0 to y=9)
      // ...
    ]
  },
  "npcs": [],
  "parcels": {
    "generation_event": "2s",
    "decaying_event": "1s",
    "max": 5,
    "reward_avg": 30,
    "reward_variance": 10
  },
  "player": {
    "movement_duration": 50,
    "observation_distance": 5,
    "capacity": 5
  }
}</code></pre>
</div>
</div>
</section>

<!-- 4. JS Agent Map Loading -->
<section id="map-loading">
<div class="section-header">
<div class="section-num">4</div>
<h2>JavaScript Agent Loading & Belief Initialization</h2>
</div>
<p>
When launching the JS scripts (e.g. <code>run_bdi.js</code>), the agent connects to the Deliveroo Socket.io server and receives the static map configuration.
</p>

<div class="card">
<div class="card-title">Instantiating MapRepresentation in Code</div>
<p style="margin-bottom: 1rem;">
During initialization, the agent captures the <code>map</code> configuration and creates a local instance of the <code>MapRepresentation</code> class:
</p>
<pre style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 6px; font-family: var(--font-mono); font-size: 0.85rem; color: var(--accent-cyan);"><code>// Inside the socket event listener for 'map' initialization
socket.on('map', (mapData) => {
    const { width, height, tiles } = mapData;
    
    // Instantiate local belief representation
    beliefs.map = new MapRepresentation(width, height, tiles);
    
    console.log(`[BeliefBase] Map loaded successfully: ${width}x${height}`);
});</code></pre>
</div>
</section>
</main>
