// ============================================================
// building.js — Building System
//
// Manages construction, placement, and state of all buildings.
// Buildings appear visually on the map as PixiJS sprites.
// Construction is animated (progress bar + visual stages).
// ============================================================

import { uuid, dist, randomInt, randomFloat } from './utils.js';
import CONFIG from './config.js';

// ─── Building Types ───────────────────────────────────────────
export const BUILDING_TYPES = {
  HOUSE:   'house',
  FARM:    'farm',
  MARKET:  'market',
  WELL:    'well',
  TAVERN:  'tavern',
  STORAGE: 'storage',
  TOWER:   'tower',
  RUIN:    'ruin',
};

// Construction costs (inventory items required)
export const BUILD_COSTS = {
  [BUILDING_TYPES.HOUSE]:   { wood: 10, stone: 5 },
  [BUILDING_TYPES.FARM]:    { wood: 5, stone: 0 },
  [BUILDING_TYPES.MARKET]:  { wood: 15, stone: 10 },
  [BUILDING_TYPES.WELL]:    { wood: 3, stone: 8 },
  [BUILDING_TYPES.TAVERN]:  { wood: 20, stone: 10 },
  [BUILDING_TYPES.STORAGE]: { wood: 12, stone: 6 },
  [BUILDING_TYPES.TOWER]:   { wood: 8, stone: 20 },
};

// Build time in seconds
export const BUILD_TIME = {
  [BUILDING_TYPES.HOUSE]:   30,
  [BUILDING_TYPES.FARM]:    20,
  [BUILDING_TYPES.MARKET]:  50,
  [BUILDING_TYPES.WELL]:    25,
  [BUILDING_TYPES.TAVERN]:  60,
  [BUILDING_TYPES.STORAGE]: 35,
  [BUILDING_TYPES.TOWER]:   45,
};

// Colors for procedural drawing
export const BUILD_COLORS = {
  [BUILDING_TYPES.HOUSE]:   { wall: 0xA1887F, roof: 0xB71C1C, door: 0x5D4037 },
  [BUILDING_TYPES.FARM]:    { wall: 0x8D6E63, roof: 0x388E3C, door: 0x6D4C41 },
  [BUILDING_TYPES.MARKET]:  { wall: 0xFFA726, roof: 0xE65100, door: 0x5D4037 },
  [BUILDING_TYPES.WELL]:    { wall: 0x78909C, roof: 0x37474F, door: 0x37474F },
  [BUILDING_TYPES.TAVERN]:  { wall: 0xD7CCC8, roof: 0x4E342E, door: 0x3E2723 },
  [BUILDING_TYPES.STORAGE]: { wall: 0xBDBDBD, roof: 0x546E7A, door: 0x455A64 },
  [BUILDING_TYPES.TOWER]:   { wall: 0x9E9E9E, roof: 0x212121, door: 0x1A237E },
  [BUILDING_TYPES.RUIN]:    { wall: 0x757575, roof: 0x424242, door: 0x212121 },
};

// ─── Building Class ───────────────────────────────────────────
export class Building {
  /**
   * @param {string} type    BUILDING_TYPES value
   * @param {number} x       World pixel X (center)
   * @param {number} y       World pixel Y (center)
   * @param {string} villageId
   */
  constructor(type, x, y, villageId = null) {
    this.id         = uuid();
    this.type       = type;
    this.x          = x;
    this.y          = y;
    this.villageId  = villageId;

    // Construction
    this.complete   = type === BUILDING_TYPES.RUIN; // ruins are pre-built
    this.progress   = this.complete ? 1 : 0;
    this.buildTime  = BUILD_TIME[type] || 30;
    this.damaged    = false;
    this.destroyed  = false;
    this.onFire     = false;

    // Storage / function
    this.inventory  = { food: 0, wood: 0, stone: 0, gold: 0 };
    this.capacity   = this._getCapacity();
    this.residents  = [];   // human IDs assigned to live here (for houses)
    this.workers    = [];   // human IDs working here

    // Visual
    this.sprite        = null;
    this.progressBar   = null;
    this.fireParticles = null;
    this._fireTimer    = 0;

    // Farm-specific
    this.cropProgress = 0;  // 0-1
    this.cropType     = 'wheat';
    this.lastHarvest  = 0;  // game minute
  }

  _getCapacity() {
    switch (this.type) {
      case BUILDING_TYPES.STORAGE: return 200;
      case BUILDING_TYPES.MARKET:  return 150;
      case BUILDING_TYPES.HOUSE:   return 50;
      default:                      return 30;
    }
  }

  update(dt, world) {
    if (this.destroyed) return;

    if (!this.complete) {
      // Construction handled by Builder human
    }

    if (this.onFire) {
      this._fireTick(dt, world);
    }

    if (this.type === BUILDING_TYPES.FARM && this.complete) {
      this._farmTick(dt, world);
    }
  }

  _farmTick(dt, world) {
    const growMult = world.timeSystem?.growthMultiplier ?? 1;
    this.cropProgress = Math.min(1, this.cropProgress + dt * 0.003 * growMult);
    if (this.cropProgress >= 1) {
      const yield_ = randomInt(8, 20);
      this.inventory.food = Math.min(this.capacity, (this.inventory.food || 0) + yield_);
      this.cropProgress   = 0;
      this.lastHarvest    = world.timeSystem?.gameMinute || 0;
      world.events?.emit('crop_harvested', { building: this, yield: yield_ });
    }
  }

  _fireTick(dt, world) {
    this._fireTimer += dt;
    this.damaged    = true;

    // Fire damages building over time
    if (this._fireTimer > 30) {
      this.destroyed = true;
      this.onFire    = false;
      if (this.sprite) {
        this.sprite.tint  = 0x333333;
        this.sprite.alpha = 0.5;
      }
      world.events?.emit('building_destroyed', { building: this });
    }
  }

  setOnFire() {
    if (this.type === BUILDING_TYPES.WELL) return; // wells can't burn
    this.onFire = true;
    this._fireTimer = 0;
  }

  repair() {
    this.damaged    = false;
    this.onFire     = false;
    this.destroyed  = false;
    this._fireTimer = 0;
    if (this.sprite) {
      this.sprite.tint  = 0xFFFFFF;
      this.sprite.alpha = 1.0;
    }
  }

  addResident(humanId) {
    if (!this.residents.includes(humanId)) this.residents.push(humanId);
  }

  isAvailableForWorker() {
    return this.complete && !this.destroyed &&
      this.workers.length < this._maxWorkers;
  }

  get _maxWorkers() {
    switch (this.type) {
      case BUILDING_TYPES.FARM:    return 3;
      case BUILDING_TYPES.MARKET:  return 2;
      case BUILDING_TYPES.TAVERN:  return 2;
      case BUILDING_TYPES.STORAGE: return 2;
      default:                      return 1;
    }
  }

  get colors() { return BUILD_COLORS[this.type] || BUILD_COLORS[BUILDING_TYPES.HOUSE]; }

  get displayName() {
    const names = {
      house:'House', farm:'Farm', market:'Market', well:'Well',
      tavern:'Tavern', storage:'Storage', tower:'Watch Tower', ruin:'Ruins'
    };
    return names[this.type] || this.type;
  }
}

// ─── Building Manager ─────────────────────────────────────────
export class BuildingManager {
  constructor() {
    this._buildings = new Map();       // id → Building
    this._byVillage = new Map();       // villageId → Set<id>
    this._byType    = new Map();       // type → Set<id>
    this._pending   = [];              // Projects waiting for builders
  }

  /** Add a pre-built or new building */
  add(building) {
    this._buildings.set(building.id, building);

    if (building.villageId) {
      if (!this._byVillage.has(building.villageId))
        this._byVillage.set(building.villageId, new Set());
      this._byVillage.get(building.villageId).add(building.id);
    }

    if (!this._byType.has(building.type))
      this._byType.set(building.type, new Set());
    this._byType.get(building.type).add(building.id);

    return building;
  }

  /** Create and register a new building */
  create(type, x, y, villageId) {
    const b = new Building(type, x, y, villageId);
    this.add(b);
    return b;
  }

  /** Create a construction project and queue it */
  queueProject(type, x, y, villageId) {
    const b = this.create(type, x, y, villageId);
    b.complete  = false;
    b.progress  = 0;
    this._pending.push(b);
    return b;
  }

  /** Get next pending project for a village */
  pendingProject(villageId) {
    return this._pending.find(b => !b.complete && b.villageId === villageId) || null;
  }

  /** Mark project complete */
  completeProject(buildingId) {
    const b = this._buildings.get(buildingId);
    if (b) {
      b.complete  = true;
      b.progress  = 1;
      this._pending = this._pending.filter(p => p.id !== buildingId);
    }
  }

  update(dt, world) {
    for (const b of this._buildings.values()) {
      if (!b.destroyed) b.update(dt, world);
    }
  }

  /** Find nearest building of a type, optionally filtered by village */
  nearestOf(x, y, type, maxDist = 800, villageId = null) {
    let best = null, bestD = maxDist;
    const ids = this._byType.get(type) || new Set();
    for (const id of ids) {
      const b = this._buildings.get(id);
      if (!b || b.destroyed || !b.complete) continue;
      if (villageId && b.villageId !== villageId) continue;
      const d = dist(x, y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /** All buildings for a village */
  forVillage(villageId) {
    const ids = this._byVillage.get(villageId) || new Set();
    return [...ids].map(id => this._buildings.get(id)).filter(Boolean);
  }

  /** All buildings of a type */
  ofType(type) {
    const ids = this._byType.get(type) || new Set();
    return [...ids].map(id => this._buildings.get(id)).filter(Boolean);
  }

  get all() { return [...this._buildings.values()]; }
  get count() { return this._buildings.size; }

  /** Initialize starting buildings for a village */
  initVillage(villageId, cx, cy, tileSize) {
    const T = tileSize;
    const px = cx * T, py = cy * T;

    // Central buildings
    this.create(BUILDING_TYPES.WELL,   px,       py,       villageId).complete = true;
    this.create(BUILDING_TYPES.MARKET, px + T*2, py,       villageId).complete = true;
    this.create(BUILDING_TYPES.TAVERN, px - T*2, py,       villageId).complete = true;

    // Houses in a ring
    const housePositions = [
      [T*2, T*2], [-T*2, T*2], [T*2, -T*2], [-T*2, -T*2],
      [T*4, 0],   [-T*4, 0],   [0, T*4],    [0, -T*4],
    ];
    for (const [dx, dy] of housePositions) {
      const h = this.create(BUILDING_TYPES.HOUSE, px + dx, py + dy, villageId);
      h.complete = true;
    }

    // Farms on outskirts
    const farmPositions = [
      [T*5, T*3], [-T*5, T*3], [T*5, -T*3], [-T*5, -T*3],
    ];
    for (const [dx, dy] of farmPositions) {
      const f = this.create(BUILDING_TYPES.FARM, px + dx, py + dy, villageId);
      f.complete = true;
    }

    // Watch towers
    this.create(BUILDING_TYPES.TOWER, px + T*6, py + T*6, villageId).complete = true;
    this.create(BUILDING_TYPES.TOWER, px - T*6, py - T*6, villageId).complete = true;

    // Scattered ruins for atmosphere
    for (let i = 0; i < 3; i++) {
      const rx = px + randomInt(-8, 8) * T;
      const ry = py + randomInt(-8, 8) * T;
      this.create(BUILDING_TYPES.RUIN, rx, ry, null);
    }
  }
}
