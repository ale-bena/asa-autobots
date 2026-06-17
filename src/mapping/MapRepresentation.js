/**
 * @module mapping/MapRepresentation
 * @description Manages the grid environment representation, coordinate transposition,
 * wall walkability, dynamic crate tracking, and directed one-way gate adjacency rules.
 */

/**
 * Class representing the static and dynamic state of the simulation map.
 */
export class MapRepresentation {
    /**
     * Map configuration tile codes.
     * @readonly
     * @enum {number}
     */
    static TILE_CODES = {
        WALL: 0,
        SPAWN: 1,
        DELIVERY: 2,
        PAVEMENT: 3,
        CRATE_SPAWN: 4,
        CRATE: 5,
        ARROW_UP: 10,
        ARROW_RIGHT: 11,
        ARROW_DOWN: 12,
        ARROW_LEFT: 13
    };

    /**
     * Creates a MapRepresentation.
     * @param {number} width - The width of the grid.
     * @param {number} height - The height of the grid.
     * @param {Array<Array<string>>} tiles - Grid column matrix from Socket.io map event.
     */
    constructor(width, height, tiles) {
        // The simulator emits the maximum coordinate index (maxX, maxY) as the width and height.
        // Therefore, we must add 1 to obtain the actual dimensions of the grid.
        /** @type {number} */
        this.width = width + 1;
        /** @type {number} */
        this.height = height + 1;

        // Flatten tiles into a 1D Uint8Array for optimized performance.
        /** @type {Uint8Array} */
        this.grid = new Uint8Array(this.width * this.height);

        this._initializeGrid(tiles);
    }

    /**
     * Populates the grid layout from a flat tile array.
     * @param {Array<Object>} tiles - Flat tile array from Socket.io map event.
     * @private
     */
    _initializeGrid(tiles) {
        for (const tile of tiles) {
            const index = this.getFlatIndex(tile.x, tile.y);
            this.grid[index] = this._parseTileType(tile.type);
        }
    }

    /**
     * Converts 2D Cartesian coordinates to a flat 1D index.
     * @param {number} x - Cartesian X coordinate.
     * @param {number} y - Cartesian Y coordinate.
     * @returns {number} The flat array index.
     */
    getFlatIndex(x, y) {
        return x + this.width * y;
    }

    /**
     * Parses the raw string tile descriptor from the server into an internal code.
     * @param {string} raw - Raw tile value (e.g. "0", "3", "↑").
     * @returns {number} The corresponding integer code.
     * @private
     */
    _parseTileType(raw) {
        switch (raw) {
            case '0': return MapRepresentation.TILE_CODES.WALL;
            case '1': return MapRepresentation.TILE_CODES.SPAWN;
            case '2': return MapRepresentation.TILE_CODES.DELIVERY;
            case '3': return MapRepresentation.TILE_CODES.PAVEMENT;
            case '5!': return MapRepresentation.TILE_CODES.CRATE_SPAWN;
            case '5': return MapRepresentation.TILE_CODES.CRATE;
            case '↑': return MapRepresentation.TILE_CODES.ARROW_UP;
            case '→': return MapRepresentation.TILE_CODES.ARROW_RIGHT;
            case '↓': return MapRepresentation.TILE_CODES.ARROW_DOWN;
            case '←': return MapRepresentation.TILE_CODES.ARROW_LEFT;
            default: return MapRepresentation.TILE_CODES.PAVEMENT;
        }
    }

    /**
     * Checks if coordinates are within the grid boundaries.
     * @param {number} x - Cartesian X coordinate.
     * @param {number} y - Cartesian Y coordinate.
     * @returns {boolean} True if inside the grid boundaries.
     */
    isValidCoord(x, y) {
        return x >= 0 && x < this.width && y >= 0 && y < this.height;
    }

    /**
     * Checks whether the tile is walkable, meaning it is not a wall.
     * @param {number} x - Cartesian X coordinate.
     * @param {number} y - Cartesian Y coordinate.
     * @returns {boolean} True if walkable (not wall/void).
     */
    isWalkableTile(x, y) {
        if (!this.isValidCoord(x, y)) return false;
        const code = this.grid[this.getFlatIndex(x, y)];
        return code !== MapRepresentation.TILE_CODES.WALL;
    }

    /**
     * Gets the tile type code at the given coordinate.
     * @param {number} x - Cartesian X coordinate.
     * @param {number} y - Cartesian Y coordinate.
     * @returns {number} The tile code.
     */
    getTileCode(x, y) {
        if (!this.isValidCoord(x, y)) return MapRepresentation.TILE_CODES.WALL;
        return this.grid[this.getFlatIndex(x, y)];
    }

    /**
     * Locates the extreme walkable tiles of the map.
     * @param {number} [refX=0] - Reference X for tie-breaking.
     * @param {number} [refY=0] - Reference Y for tie-breaking.
     * @returns {{leftmost: {x: number, y: number}|null, rightmost: {x: number, y: number}|null, topmost: {x: number, y: number}|null, bottommost: {x: number, y: number}|null}}
     */
    findExtremeWalkableTiles(refX = 0, refY = 0) {
        const refDist = (t) => Math.abs(t.x - refX) + Math.abs(t.y - refY);
        const better = (cand, best, key, dir) => {
            if (!best) return true;
            if (cand[key] !== best[key]) {
                return dir > 0 ? cand[key] > best[key] : cand[key] < best[key];
            }
            return refDist(cand) < refDist(best);
        };

        let leftmost = null, rightmost = null, topmost = null, bottommost = null;
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                if (!this.isWalkableTile(x, y)) continue;
                const t = { x, y };
                if (better(t, leftmost, 'x', -1)) leftmost = t;
                if (better(t, rightmost, 'x', +1)) rightmost = t;
                if (better(t, bottommost, 'y', -1)) bottommost = t;
                if (better(t, topmost, 'y', +1)) topmost = t;
            }
        }
        return { leftmost, rightmost, topmost, bottommost };
    }

    /**
     * Validates directed adjacency and checks against one-way gate rules.
     * @param {{x: number, y: number}} from - Origin cell.
     * @param {{x: number, y: number}} to - Destination cell.
     * @returns {boolean} True if transition is valid.
     */
    isAdjacent(from, to) {
        const fromX = Math.round(from.x);
        const fromY = Math.round(from.y);
        const toX = Math.round(to.x);
        const toY = Math.round(to.y);
        
        // Must be exactly 1 cell away in Manhattan distance.
        const dx = toX - fromX;
        const dy = toY - fromY;
        if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
        
        // Destination must be a valid walkable tile.
        if (!this.isWalkableTile(toX, toY)) return false;
        
        const toCode = this.getTileCode(toX, toY);
        
        // Directional tiles (arrows) restrict entry *into* the arrow tile.
        // Cannot enter a tile if moving opposite to its direction.
        // Arrow Up (pointing up): cannot move down onto it (dy = -1, i.e., from.y = to.y + 1)
        if (toCode === MapRepresentation.TILE_CODES.ARROW_UP && dy === -1) return false;
        // Arrow Down (pointing down): cannot move up onto it (dy = 1, i.e., from.y = to.y - 1)
        if (toCode === MapRepresentation.TILE_CODES.ARROW_DOWN && dy === 1) return false;
        // Arrow Right (pointing right): cannot move left onto it (dx = -1, i.e., from.x = to.x + 1)
        if (toCode === MapRepresentation.TILE_CODES.ARROW_RIGHT && dx === -1) return false;
        // Arrow Left (pointing left): cannot move right onto it (dx = 1, i.e., from.x = to.x - 1)
        if (toCode === MapRepresentation.TILE_CODES.ARROW_LEFT && dx === 1) return false;
        
        return true;
    }

    /**
     * Finds all valid adjacent tiles from a given position.
     * @param {{x: number, y: number}} pos - Target coordinate.
     * @returns {Array<{x: number, y: number}>} Array of valid adjacent coordinates.
     */
    getNeighbors(pos) {
        const directions = [
            { x: pos.x, y: pos.y + 1 }, // up
            { x: pos.x + 1, y: pos.y }, // right
            { x: pos.x, y: pos.y - 1 }, // down
            { x: pos.x - 1, y: pos.y }  // left
        ];
        return directions.filter(dest => this.isAdjacent(pos, dest));
    }

    /**
     * Prints a colored ANSI representation of the grid map to the console.
     */
    printMap() {
        console.log('\n🗺️  ASA Grid Map Representation:');
        for (let y = this.height - 1; y >= 0; y--) {
            let rowStr = '';
            for (let x = 0; x < this.width; x++) {
                const code = this.getTileCode(x, y);
                switch (code) {
                    case MapRepresentation.TILE_CODES.WALL:
                        rowStr += '\x1b[48;5;232m  \x1b[0m'; // Dark grey/black block for walls (#080a14)
                        break;
                    case MapRepresentation.TILE_CODES.SPAWN:
                        rowStr += '\x1b[48;5;29m\x1b[38;5;15mSP\x1b[0m'; // Green block for Spawn (#059669)
                        break;
                    case MapRepresentation.TILE_CODES.DELIVERY:
                        rowStr += '\x1b[48;5;160m\x1b[38;5;15mDL\x1b[0m'; // Red block for Delivery (#dc2626)
                        break;
                    case MapRepresentation.TILE_CODES.PAVEMENT:
                        rowStr += '\x1b[48;5;237m  \x1b[0m'; // Slate grey for pavement (#1e293b)
                        break;
                    case MapRepresentation.TILE_CODES.CRATE_SPAWN:
                        rowStr += '\x1b[48;5;202m\x1b[38;5;15mCS\x1b[0m'; // Orange for Crate Spawn (#ea580c)
                        break;
                    case MapRepresentation.TILE_CODES.CRATE:
                        rowStr += '\x1b[48;5;178m\x1b[38;5;16mCR\x1b[0m'; // Yellow background with dark text for Crate (#ca8a04)
                        break;
                    case MapRepresentation.TILE_CODES.ARROW_UP:
                        rowStr += '\x1b[48;5;19m\x1b[38;5;15m ↑\x1b[0m'; // Blue background with white arrow (#1e40af)
                        break;
                    case MapRepresentation.TILE_CODES.ARROW_RIGHT:
                        rowStr += '\x1b[48;5;19m\x1b[38;5;15m →\x1b[0m';
                        break;
                    case MapRepresentation.TILE_CODES.ARROW_DOWN:
                        rowStr += '\x1b[48;5;19m\x1b[38;5;15m ↓\x1b[0m';
                        break;
                    case MapRepresentation.TILE_CODES.ARROW_LEFT:
                        rowStr += '\x1b[48;5;19m\x1b[38;5;15m ←\x1b[0m';
                        break;
                    default:
                        rowStr += '  ';
                }
            }
            console.log(rowStr);
        }
        console.log('');
    }
}
