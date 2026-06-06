/**
 * @module benchmark/depth_search
 * @description Local depth search utility providing heuristic-sorted pathfinding search
 * for benchmarking and offline simulation trials. Supports directed gate adjacencies.
 */

/**
 * Calculates Manhattan distance between two cells.
 * @param {{x: number, y: number}} a - Origin node.
 * @param {{x: number, y: number}} b - Target node.
 * @returns {number} Manhattan distance.
 */
function distance(a, b) {
    return Math.abs(Math.round(a.x) - Math.round(b.x)) + Math.abs(Math.round(a.y) - Math.round(b.y));
}

/**
 * Initializes the depth search daemon.
 * @param {Object} socket - Deliveroo SDK socket client.
 * @returns {Function} Inner search function that resolves paths.
 */
export default function initDepthSearch(socket) {
    let observationDistance = 5;
    let map = new Map();
    let me = { x: -1, y: -1 };
    const peers = new Map();

    socket.onConfig((config) => {
        observationDistance = config.GAME?.player?.observation_distance || 5;
    });

    socket.onTile((x, y, delivery) => {
        // TILE_CODES.WALL=0, TILE_CODES.DELIVERY=2, TILE_CODES.PAVEMENT=3
        const type = delivery ? '2' : '3';
        map.set(`${x}_${y}`, { x, y, type });
    });

    socket.onMap((width, height, tiles) => {
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const raw = tiles[x][y];
                map.set(`${x}_${y}`, { x, y, type: raw });
            }
        }
    });

    socket.onYou((you) => {
        me.x = you.x ?? me.x;
        me.y = you.y ?? me.y;
    });

    socket.onSensing((sensing) => {
        if (sensing.agents) {
            sensing.agents.forEach(a => {
                peers.set(a.id, { id: a.id, x: a.x, y: a.y });
            });
            for (const [id, p] of peers.entries()) {
                const dist = Math.abs(me.x - p.x) + Math.abs(me.y - p.y);
                if (dist < observationDistance && !sensing.agents.find(a => a.id === id)) {
                    peers.delete(id);
                }
            }
        }
    });

    /**
     * Resolves path between start and goal coordinates using depth-first search.
     * @param {{x: number, y: number}} from - Start.
     * @param {{x: number, y: number}} to - Destination.
     * @returns {Promise<Array<{step: number, action: string, current: {x: number, y: number}}>>} Plan steps.
     */
    return async function (from, to) {
        const initX = Math.round(from.x);
        const initY = Math.round(from.y);
        const targetX = Math.round(to.x);
        const targetY = Math.round(to.y);

        // Temporarily lock neighbor peer cells
        for (const p of peers.values()) {
            const floorX = Math.floor(p.x);
            const ceilX = Math.ceil(p.x);
            const floorY = Math.floor(p.y);
            const ceilY = Math.ceil(p.y);

            const t1 = map.get(`${floorX}_${floorY}`);
            if (t1) t1.locked = true;
            const t2 = map.get(`${ceilX}_${ceilY}`);
            if (t2) t2.locked = true;
        }

        /**
         * Recursive DFS search function.
         * @param {number} cost - Cost accumulated to this node.
         * @param {number} cx - Current X.
         * @param {number} cy - Current Y.
         * @param {Object} prevTile - Previous step.
         * @param {string} action - Action taken.
         * @returns {boolean} True if goal reached.
         */
        async function search(cost, cx, cy, prevTile, action) {
            const currentTile = map.get(`${cx}_${cy}`);
            if (!currentTile || currentTile.type === '0' || currentTile.locked) {
                return false;
            }

            // Enforce asymmetric gate arrows
            if (prevTile && ['←', '↑', '→', '↓'].includes(currentTile.type)) {
                if (cx === prevTile.x + 1 && currentTile.type === '←') return false;
                if (cx === prevTile.x - 1 && currentTile.type === '→') return false;
                if (cy === prevTile.y + 1 && currentTile.type === '↓') return false;
                if (cy === prevTile.y - 1 && currentTile.type === '↑') return false;
            }

            if (currentTile.cost_to_here !== undefined && currentTile.cost_to_here <= cost) {
                return false;
            }

            currentTile.cost_to_here = cost;
            currentTile.previous_tile = prevTile;
            if (action) {
                currentTile.action_from_previous = action;
            }

            if (targetX === cx && targetY === cy) {
                return true;
            }

            let options = [
                [cost + 1, cx + 1, cy, currentTile, 'right'],
                [cost + 1, cx - 1, cy, currentTile, 'left'],
                [cost + 1, cx, cy + 1, currentTile, 'up'],
                [cost + 1, cx, cy - 1, currentTile, 'down']
            ];

            options.sort((a, b) => {
                const distA = distance({ x: targetX, y: targetY }, { x: a[1], y: a[2] });
                const distB = distance({ x: targetX, y: targetY }, { x: b[1], y: b[2] });
                return distA - distB;
            });

            await search(...options[0]);
            await search(...options[1]);
            await search(...options[2]);
            await search(...options[3]);
        }

        await search(0, initX, initY);

        let dest = map.get(`${targetX}_${targetY}`);
        const plan = [];

        if (dest && dest.previous_tile) {
            while (dest.previous_tile) {
                plan.unshift({
                    step: dest.cost_to_here,
                    action: dest.action_from_previous,
                    current: { x: dest.x, y: dest.y }
                });
                dest = dest.previous_tile;
            }
        }

        // Cleanup search fields in map
        map.forEach((tile) => {
            delete tile.cost_to_here;
            delete tile.previous_tile;
            delete tile.action_from_previous;
            delete tile.locked;
        });

        return plan;
    };
}
