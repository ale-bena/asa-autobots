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
        /** @type {number} */
        this.width = width;
        /** @type {number} */
        this.height = height;

        // Flatten tiles into a 1D Uint8Array for optimized performance.
        /** @type {Uint8Array} */
        this.grid = new Uint8Array(width * height);

        this._initializeGrid(tiles);
    }

    /**
     * Populates the grid layout from a 2D tile array.
     * @param {Array<Array<string>>} tiles - The 2D array of tile descriptions.
     * @private
     */
    _initializeGrid(tiles) {
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const rawTile = tiles[x][y];
                const index = this.getFlatIndex(x, y);
                this.grid[index] = this._parseTileType(rawTile);
            }
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
     * Validates directed adjacency and checks against one-way gate rules.
     * @param {{x: number, y: number}} from - Origin cell.
     * @param {{x: number, y: number}} to - Destination cell.
     * @returns {boolean} True if transition is valid.
     */
    isAdjacent(from, to) {
        // Must be exactly 1 cell away in Manhattan distance.
        const dx = Math.abs(from.x - to.x);
        const dy = Math.abs(from.y - to.y);
        if (dx + dy !== 1) return false;

        // Destination must be a valid walkable tile.
        if (!this.isWalkableTile(to.x, to.y)) return false;

        const toCode = this.getTileCode(to.x, to.y);

        // Enforce directed one-way gates: we cannot enter B from the pointed-to direction.
        if (toCode === MapRepresentation.TILE_CODES.ARROW_UP && from.y === to.y + 1) return false;
        if (toCode === MapRepresentation.TILE_CODES.ARROW_DOWN && from.y === to.y - 1) return false;
        if (toCode === MapRepresentation.TILE_CODES.ARROW_RIGHT && from.x === to.x + 1) return false;
        if (toCode === MapRepresentation.TILE_CODES.ARROW_LEFT && from.x === to.x - 1) return false;

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
}
