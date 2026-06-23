// ============================================================
// terrain.js — Procedural World Generation
//
// Generates a 2D tile grid using layered Perlin noise.
// Biomes: deep_water, water, beach, grass, forest, highland, mountain, snow
// Adds rivers, roads, and marks spawn zones.
// ============================================================

import { PerlinNoise, randomInt, randomFloat, chance } from './utils.js';
import CONFIG from './config.js';

// ─── Tile Type Definitions ────────────────────────────────────
export const TILE = {
  DEEP_WATER: 0,
  WATER:      1,
  BEACH:      2,
  GRASS:      3,
  GRASSDARK:  4,
  DIRT:       5,
  FOREST:     6,
  HIGHLAND:   7,
  MOUNTAIN:   8,
  SNOW:       9,
  ROAD:       10,
  FARMLAND:   11,
  RUINS:      12,
};

export const TILE_COLOR = {
  [TILE.DEEP_WATER]: 0x1565C0,
  [TILE.WATER]:      0x1976D2,
  [TILE.BEACH]:      0xF4D03F,
  [TILE.GRASS]:      0x4CAF50,
  [TILE.GRASSDARK]:  0x388E3C,
  [TILE.DIRT]:       0x8D6E63,
  [TILE.FOREST]:     0x1B5E20,
  [TILE.HIGHLAND]:   0x8D6E63,
  [TILE.MOUNTAIN]:   0x6D4C41,
  [TILE.SNOW]:       0xEEEEEE,
  [TILE.ROAD]:       0xA1887F,
  [TILE.FARMLAND]:   0xFFF9C4,
  [TILE.RUINS]:      0x757575,
};

export const TILE_NAME = {
  [TILE.DEEP_WATER]: 'deep water',
  [TILE.WATER]:      'water',
  [TILE.BEACH]:      'beach',
  [TILE.GRASS]:      'grassland',
  [TILE.GRASSDARK]:  'lush grass',
  [TILE.DIRT]:       'dirt',
  [TILE.FOREST]:     'forest',
  [TILE.HIGHLAND]:   'highland',
  [TILE.MOUNTAIN]:   'mountain',
  [TILE.SNOW]:       'snowcap',
  [TILE.ROAD]:       'road',
  [TILE.FARMLAND]:   'farmland',
  [TILE.RUINS]:      'ruins',
};

// Passability: can humans walk on this tile?
export const TILE_PASSABLE = {
  [TILE.DEEP_WATER]: false,
  [TILE.WATER]:      false,
  [TILE.BEACH]:      true,
  [TILE.GRASS]:      true,
  [TILE.GRASSDARK]:  true,
  [TILE.DIRT]:       true,
  [TILE.FOREST]:     true,    // slower
  [TILE.HIGHLAND]:   true,
  [TILE.MOUNTAIN]:   false,
  [TILE.SNOW]:       false,
  [TILE.ROAD]:       true,    // faster
  [TILE.FARMLAND]:   true,
  [TILE.RUINS]:      true,
};

// Movement cost multiplier (1.0 = normal speed)
export const TILE_COST = {
  [TILE.DEEP_WATER]: 999,
  [TILE.WATER]:      999,
  [TILE.BEACH]:      1.5,
  [TILE.GRASS]:      1.0,
  [TILE.GRASSDARK]:  1.0,
  [TILE.DIRT]:       1.2,
  [TILE.FOREST]:     1.8,
  [TILE.HIGHLAND]:   1.4,
  [TILE.MOUNTAIN]:   999,
  [TILE.SNOW]:       999,
  [TILE.ROAD]:       0.6,
  [TILE.FARMLAND]:   1.0,
  [TILE.RUINS]:      1.1,
};

// ─── Terrain Generator ────────────────────────────────────────
export class TerrainGenerator {
  constructor(seed = CONFIG.world.seed) {
    this.seed       = seed;
    this.width      = CONFIG.world.tilesWide;
    this.height     = CONFIG.world.tilesHigh;
    this.tileSize   = CONFIG.world.tileSize;
    this.chunkSize  = CONFIG.world.chunkSize;

    // Multiple noise layers for rich terrain
    this._heightNoise    = new PerlinNoise(seed);
    this._moistureNoise  = new PerlinNoise(seed + 1000);
    this._temperNoise    = new PerlinNoise(seed + 2000);
    this._detailNoise    = new PerlinNoise(seed + 3000);

    // Tile data: typed arrays for performance
    this.tiles      = new Uint8Array(this.width * this.height);
    this.heightMap  = new Float32Array(this.width * this.height);
    this.moistureMap = new Float32Array(this.width * this.height);

    // Lookup caches
    this._chunkCache = new Map();
    this._villageZones = [];   // { cx, cy, name, villageName } tile coords of village centers
    this._resourceNodes = [];  // { x, y, type: 'tree'|'rock'|'bush' }
  }

  /** Run full world generation. Call once at startup. */
  generate() {
    console.log('[Terrain] Generating world...');
    this._generateHeightMap();
    this._applyBiomes();
    this._carveRivers(CONFIG.world.riverCount);
    this._placeForests();
    this._findVillageZones();
    this._placeRoads();
    this._placeResourceNodes();
    console.log(`[Terrain] Done. ${this._villageZones.length} village zones, ${this._resourceNodes.length} resource nodes.`);
    return this;
  }

  // ─── Height Map ─────────────────────────────────────────────
  _generateHeightMap() {
    const scale = 0.012;   // Controls how "zoomed in" the terrain is
    const W = this.width, H = this.height;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;

        // FBM height with several octaves
        let h = this._heightNoise.fbm(x * scale, y * scale, 7, 0.5, 2.1);

        // Edge fade to create ocean borders (island-like world)
        const edgeX = Math.min(x, W-1-x) / (W * 0.15);
        const edgeY = Math.min(y, H-1-y) / (H * 0.15);
        const edgeFade = Math.min(edgeX, edgeY, 1.0);
        h *= edgeFade;

        this.heightMap[i] = h;
        this.moistureMap[i] = this._moistureNoise.fbm(x * scale * 1.3, y * scale * 1.3, 4, 0.6, 2);
      }
    }
  }

  // ─── Biome Assignment ─────────────────────────────────────────
  _applyBiomes() {
    for (let i = 0; i < this.tiles.length; i++) {
      const h = this.heightMap[i];
      const m = this.moistureMap[i];
      this.tiles[i] = this._heightToTile(h, m);
    }
  }

  _heightToTile(h, m) {
    if (h < 0.15) return TILE.DEEP_WATER;
    if (h < 0.28) return TILE.WATER;
    if (h < 0.34) return TILE.BEACH;
    if (h < 0.65) {
      if (m > 0.6) return TILE.GRASSDARK;
      return TILE.GRASS;
    }
    if (h < 0.75) {
      if (m > 0.5) return TILE.FOREST;
      return TILE.HIGHLAND;
    }
    if (h < 0.88) return TILE.MOUNTAIN;
    return TILE.SNOW;
  }

  // ─── River Carving ─────────────────────────────────────────────
  _carveRivers(count) {
    for (let r = 0; r < count; r++) {
      // Find a mountain tile to start from
      let sx = -1, sy = -1;
      for (let attempt = 0; attempt < 500; attempt++) {
        const tx = randomInt(20, this.width - 20);
        const ty = randomInt(20, this.height - 20);
        if (this.tiles[ty * this.width + tx] === TILE.MOUNTAIN ||
            this.tiles[ty * this.width + tx] === TILE.HIGHLAND) {
          sx = tx; sy = ty; break;
        }
      }
      if (sx < 0) continue;

      // Flow downhill until water is reached
      let x = sx, y = sy;
      let maxSteps = 2000;
      const visited = new Set();

      while (maxSteps-- > 0) {
        const key = `${x},${y}`;
        if (visited.has(key)) break;
        visited.add(key);

        const tile = this.getTile(x, y);
        if (tile === TILE.WATER || tile === TILE.DEEP_WATER) break;

        // Carve river
        if (tile !== TILE.MOUNTAIN && tile !== TILE.SNOW) {
          this.setTile(x, y, TILE.WATER);
          // Slightly widen
          if (chance(0.4) && this.inBounds(x+1, y)) this.setTile(x+1, y, TILE.WATER);
          if (chance(0.4) && this.inBounds(x-1, y)) this.setTile(x-1, y, TILE.WATER);
        }

        // Step toward lowest neighbor
        const h = this.heightMap[y * this.width + x];
        let bestDH = 999, bdx = 0, bdy = 1;
        const offsets = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[-1,1],[1,-1],[-1,-1]];
        for (const [dx, dy] of offsets) {
          const nx = x + dx, ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const nh = this.heightMap[ny * this.width + nx];
          const dh = nh - h;
          if (dh < bestDH) { bestDH = dh; bdx = dx; bdy = dy; }
        }
        // Add some randomness to prevent too-straight rivers
        if (chance(0.25)) {
          const side = offsets[randomInt(0, 7)];
          bdx = side[0]; bdy = side[1];
        }
        x += bdx; y += bdy;
        if (!this.inBounds(x, y)) break;
      }
    }
  }

  // ─── Forest Placement ──────────────────────────────────────────
  _placeForests() {
    const density = CONFIG.world.forestDensity;
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        const i = y * this.width + x;
        const tile = this.tiles[i];
        if (tile === TILE.GRASS || tile === TILE.GRASSDARK || tile === TILE.HIGHLAND) {
          const detail = this._detailNoise.fbm(x * 0.05, y * 0.05, 3, 0.6, 2);
          if (detail > (1 - density)) {
            this.tiles[i] = TILE.FOREST;
          }
        }
      }
    }
  }

  // ─── Village Zone Detection ────────────────────────────────────
  _findVillageZones() {
    const needed = CONFIG.simulation.initialVillages;
    const villageNames = [...CONFIG.names.villages];
    const minDist = 40; // Minimum tiles between villages
    const zones = [];

    for (let attempt = 0; attempt < 5000 && zones.length < needed; attempt++) {
      const x = randomInt(15, this.width - 15);
      const y = randomInt(15, this.height - 15);
      const tile = this.getTile(x, y);

      if (tile !== TILE.GRASS && tile !== TILE.GRASSDARK && tile !== TILE.DIRT) continue;

      // Check distance from existing zones
      const farEnough = zones.every(z =>
        Math.hypot(z.cx - x, z.cy - y) >= minDist
      );
      if (!farEnough) continue;

      // Check the area is mostly passable (at least 70% of 5x5)
      let passable = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        if (TILE_PASSABLE[this.getTile(x+dx, y+dy) ?? TILE.MOUNTAIN]) passable++;
      }
      if (passable < 30) continue;

      const name = villageNames.shift() || `Village${zones.length + 1}`;
      zones.push({ cx: x, cy: y, name, id: `village_${zones.length}` });
    }
    this._villageZones = zones;
  }

  // ─── Road Generation ──────────────────────────────────────────
  _placeRoads() {
    // Connect villages with rough roads
    const zones = this._villageZones;
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        this._drawRoad(zones[i].cx, zones[i].cy, zones[j].cx, zones[j].cy);
      }
    }
  }

  _drawRoad(x1, y1, x2, y2) {
    // Bresenham's line with some wandering
    let x = x1, y = y1;
    const dx = Math.sign(x2 - x), dy = Math.sign(y2 - y);
    let steps = Math.max(Math.abs(x2-x1), Math.abs(y2-y1));

    while (steps-- > 0) {
      if (this.inBounds(x, y)) {
        const tile = this.getTile(x, y);
        if (TILE_PASSABLE[tile]) this.setTile(x, y, TILE.ROAD);
      }
      // Move toward target, randomly choosing axis
      if (Math.abs(x - x2) > Math.abs(y - y2)) {
        x += dx;
        if (chance(0.3)) y += (y < y2 ? 1 : y > y2 ? -1 : 0);
      } else {
        y += dy;
        if (chance(0.3)) x += (x < x2 ? 1 : x > x2 ? -1 : 0);
      }
    }
  }

  // ─── Resource Nodes ────────────────────────────────────────────
  _placeResourceNodes() {
    const nodes = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.getTile(x, y);
        if (tile === TILE.FOREST) {
          if (chance(0.15)) nodes.push({ x, y, type: 'tree', amount: randomInt(5, 15) });
        } else if (tile === TILE.MOUNTAIN || tile === TILE.HIGHLAND) {
          if (chance(0.08)) nodes.push({ x, y, type: 'rock', amount: randomInt(3, 10) });
        } else if (tile === TILE.GRASS || tile === TILE.GRASSDARK) {
          if (chance(0.04)) nodes.push({ x, y, type: 'bush', amount: randomInt(2, 6) });
        }
      }
    }
    this._resourceNodes = nodes;
  }

  // ─── Tile Access API ─────────────────────────────────────────
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getTile(x, y) {
    if (!this.inBounds(x, y)) return TILE.MOUNTAIN;
    return this.tiles[y * this.width + x];
  }

  setTile(x, y, type) {
    if (this.inBounds(x, y)) this.tiles[y * this.width + x] = type;
  }

  getHeight(x, y) {
    if (!this.inBounds(x, y)) return 0;
    return this.heightMap[y * this.width + x];
  }

  isPassable(x, y) {
    return TILE_PASSABLE[this.getTile(x, y)] ?? false;
  }

  /** World pixel coords → tile coords */
  pixelToTile(px, py) {
    return {
      tx: Math.floor(px / this.tileSize),
      ty: Math.floor(py / this.tileSize)
    };
  }

  /** Tile coords → center pixel coords */
  tileToPixel(tx, ty) {
    return {
      px: tx * this.tileSize + this.tileSize / 2,
      py: ty * this.tileSize + this.tileSize / 2
    };
  }

  /** Find a random passable tile near (tx, ty) within radius tiles */
  randomPassableNear(tx, ty, radius = 10) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = tx + randomInt(-radius, radius);
      const y = ty + randomInt(-radius, radius);
      if (this.isPassable(x, y)) return { x, y };
    }
    return { x: tx, y: ty };
  }

  // ─── Chunk System ─────────────────────────────────────────────
  getChunkAt(tileX, tileY) {
    return {
      cx: Math.floor(tileX / this.chunkSize),
      cy: Math.floor(tileY / this.chunkSize)
    };
  }

  getChunkTiles(cx, cy) {
    const key = `${cx},${cy}`;
    if (this._chunkCache.has(key)) return this._chunkCache.get(key);

    const size = this.chunkSize;
    const tiles = [];
    for (let ly = 0; ly < size; ly++) {
      for (let lx = 0; lx < size; lx++) {
        const worldX = cx * size + lx;
        const worldY = cy * size + ly;
        tiles.push(this.getTile(worldX, worldY));
      }
    }
    this._chunkCache.set(key, tiles);
    return tiles;
  }

  // ─── Public Getters ───────────────────────────────────────────
  get villageZones()    { return this._villageZones; }
  get resourceNodes()   { return this._resourceNodes; }

  get pixelWidth()  { return this.width  * this.tileSize; }
  get pixelHeight() { return this.height * this.tileSize; }
}
