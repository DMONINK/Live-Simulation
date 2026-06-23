// ============================================================
// world.js — World Manager
//
// The central orchestrator. Owns all entities and systems.
// Initializes villages, spawns humans/animals, routes AI
// decisions back to the correct NPC, and runs the update loop.
// ============================================================

import { TerrainGenerator } from './terrain.js';
import { TimeSystem }        from './time.js';
import { WeatherSystem }     from './weather.js';
import { SpatialHash }       from './spatial.js';
import { RelationshipManager } from './relationship.js';
import { BuildingManager }   from './building.js';
import { Economy }           from './economy.js';
import { WarSystem }         from './war.js';
import { AIManager }         from './ai.js';
import { Human, JOBS }       from './human.js';
import { Animal, ANIMAL_TYPES } from './animal.js';
import { EventEmitter, randomInt, randomFloat, chance, randomElement } from './utils.js';
import CONFIG from './config.js';

export class World {
  constructor() {
    // ── Core Systems ──────────────────────────────────────────
    this.events              = new EventEmitter();
    this.terrain             = new TerrainGenerator();
    this.timeSystem          = new TimeSystem();
    this.weatherSystem       = new WeatherSystem(null); // app injected later
    this.spatialHash         = new SpatialHash(128);
    this.relationshipManager = new RelationshipManager();
    this.buildingManager     = new BuildingManager();
    this.economy             = new Economy([]);
    this.warSystem           = new WarSystem();

    // ── Entity Arrays ─────────────────────────────────────────
    this.humans   = [];
    this.animals  = [];
    this.villages = [];

    // ── AI Manager ────────────────────────────────────────────
    this.aiManager = new AIManager(
      (taskId, result, context) => this._onAIDecision(taskId, result, context),
      (err, context) => console.warn('[World] AI error:', err.message)
    );

    // ── Event Log (for UI) ────────────────────────────────────
    this.eventLog = [];
    this._maxLog  = 80;
    this.events.on('log_event', e => this._addLog(e));

    // ── Renderer reference (injected after init) ───────────────
    this.renderer = null;

    // ── Tick counters ─────────────────────────────────────────
    this._frameCount  = 0;
    this._cleanupTimer = 0;
    this._economyTimer = 0;
    this._reproTimer   = 0;
  }

  // ══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ══════════════════════════════════════════════════════════════
  async init(pixiApp, renderer) {
    this.renderer = renderer;
    this.weatherSystem = new WeatherSystem(pixiApp);

    console.log('[World] Generating terrain...');
    this.terrain.generate();

    console.log('[World] Building villages...');
    this._initVillages();

    console.log('[World] Spawning humans...');
    this._spawnHumans();

    console.log('[World] Spawning animals...');
    this._spawnAnimals();

    console.log('[World] Placing resources...');
    this._placeResourceSprites();

    console.log('[World] Wiring events...');
    this._wireEvents();

    console.log('[World] ✓ World ready!');
    this._addLog({ message: '🌍 World initialized. Civilization begins.', importance: 'info' });
  }

  // ─── Village Setup ────────────────────────────────────────────
  _initVillages() {
    const zones = this.terrain.villageZones;
    const ts    = CONFIG.world.tileSize;

    for (const zone of zones) {
      const village = {
        id:    zone.id,
        name:  zone.name,
        cx:    zone.cx,
        cy:    zone.cy,
        x:     zone.cx * ts,
        y:     zone.cy * ts,
        color: [0xE53935, 0x1E88E5, 0x43A047, 0xFB8C00][this.villages.length % 4],
        population: 0,
      };
      this.villages.push(village);
      this.buildingManager.initVillage(zone.id, zone.cx, zone.cy, ts);
      this.warSystem.adjustRelation(zone.id, zone.id, 0); // self = neutral

      // Create building sprites
      for (const b of this.buildingManager.forVillage(zone.id)) {
        this.renderer?.createBuildingSprite(b);
      }

      this._addLog({ message: `🏘️ Village "${zone.name}" founded at tile (${zone.cx}, ${zone.cy})`, importance: 'info' });
    }

    // Set inter-village starting relations
    for (let i = 0; i < this.villages.length; i++) {
      for (let j = i + 1; j < this.villages.length; j++) {
        const rel = randomInt(-20, 30);
        this.warSystem.adjustRelation(this.villages[i].id, this.villages[j].id, rel);
      }
    }

    this.economy = new Economy(this.villages);
  }

  // ─── Human Spawning ───────────────────────────────────────────
  _spawnHumans() {
    const total   = CONFIG.simulation.initialHumans;
    const ts      = CONFIG.world.tileSize;
    const jobDist = [
      { job: JOBS.FARMER,  weight: 35 },
      { job: JOBS.HUNTER,  weight: 15 },
      { job: JOBS.BUILDER, weight: 15 },
      { job: JOBS.WARRIOR, weight: 15 },
      { job: JOBS.TRADER,  weight: 10 },
      { job: JOBS.HEALER,  weight: 5  },
      { job: JOBS.ELDER,   weight: 3  },
      { job: JOBS.CHILD,   weight: 2  },
    ];

    const pickJob = () => {
      const roll = Math.random() * 100;
      let acc = 0;
      for (const { job, weight } of jobDist) {
        acc += weight;
        if (roll < acc) return job;
      }
      return JOBS.FARMER;
    };

    const perVillage = Math.ceil(total / Math.max(1, this.villages.length));

    for (const village of this.villages) {
      const names = { male: [...CONFIG.names.male], female: [...CONFIG.names.female] };

      for (let i = 0; i < perVillage; i++) {
        const gender  = chance(0.5) ? 'male' : 'female';
        const namePool = names[gender];
        const name    = namePool.length > 0
          ? namePool.splice(randomInt(0, namePool.length - 1), 1)[0]
          : `${gender === 'male' ? 'Man' : 'Woman'}${i}`;

        const job     = pickJob();
        const age     = job === JOBS.CHILD ? randomInt(6, 15) :
                        job === JOBS.ELDER ? randomInt(55, 75) :
                        randomInt(18, 55);

        // Spawn within the village radius
        const radius  = randomFloat(30, 90) * ts / 32;
        const angle   = randomFloat(0, Math.PI * 2);
        const x       = village.x + Math.cos(angle) * radius;
        const y       = village.y + Math.sin(angle) * radius;

        const human   = new Human(x, y, {
          name, age, gender, job,
          villageId:   village.id,
          villageName: village.name,
          personality: {
            kindness:     randomInt(20, 90),
            bravery:      randomInt(20, 90),
            greed:        randomInt(10, 80),
            morality:     randomInt(20, 90),
            intelligence: randomInt(30, 95),
            strength:     randomInt(20, 90),
          }
        }, this);

        // Assign home building
        const houses = this.buildingManager.ofType('house')
          .filter(b => b.villageId === village.id && b.residents.length < 3);
        if (houses.length > 0) {
          const house = houses[randomInt(0, houses.length - 1)];
          house.addResident(human.id);
          human.homeBuilding = house;
          human._homeX = house.x;
          human._homeY = house.y;
        }

        this.humans.push(human);
        village.population++;
        this.renderer?.createHumanSprite(human);
        this.spatialHash.update(human);
      }
    }

    this._addLog({ message: `👥 ${this.humans.length} humans spawned across ${this.villages.length} villages.`, importance: 'info' });
  }

  // ─── Animal Spawning ──────────────────────────────────────────
  _spawnAnimals() {
    const total  = CONFIG.simulation.initialAnimals;
    const ts     = CONFIG.world.tileSize;
    const W      = this.terrain.width;
    const H      = this.terrain.height;
    const types  = [
      { type: ANIMAL_TYPES.DEER,    count: Math.floor(total * 0.35) },
      { type: ANIMAL_TYPES.COW,     count: Math.floor(total * 0.20) },
      { type: ANIMAL_TYPES.WOLF,    count: Math.floor(total * 0.15) },
      { type: ANIMAL_TYPES.CHICKEN, count: Math.floor(total * 0.20) },
      { type: ANIMAL_TYPES.HORSE,   count: Math.floor(total * 0.10) },
    ];

    for (const { type, count } of types) {
      for (let i = 0; i < count; i++) {
        let x, y, attempts = 0;
        do {
          x = randomFloat(50, (W - 50) * ts);
          y = randomFloat(50, (H - 50) * ts);
          attempts++;
        } while (!this.terrain.isPassable(Math.floor(x / ts), Math.floor(y / ts)) && attempts < 50);

        if (attempts >= 50) continue;

        const animal = new Animal(x, y, type);
        this.animals.push(animal);
        this.renderer?.createAnimalSprite(animal);
        this.spatialHash.update(animal);
      }
    }

    this._addLog({ message: `🐾 ${this.animals.length} animals spawned.`, importance: 'info' });
  }

  // ─── Resource sprites ─────────────────────────────────────────
  _placeResourceSprites() {
    const ts    = CONFIG.world.tileSize;
    const nodes = this.terrain.resourceNodes;

    // Only render a subset for performance (max 800)
    const visible = nodes.slice(0, 800);
    for (const node of visible) {
      this.renderer?.createResourceSprite(node);
    }
  }

  // ─── Event Wiring ─────────────────────────────────────────────
  _wireEvents() {
    // Human death → notify family
    this.events.on('human_died', ({ victim, killer }) => {
      for (const h of this.humans) {
        if (!h.alive) continue;
        if (h.familyIds.includes(victim.id) || h.spouseId === victim.id) {
          h.onFamilyMemberDied?.(victim, killer, this);
        }
      }
      this._updateVillagePopulation(victim.villageId);
      if (killer) {
        this.warSystem.adjustRelation(victim.villageId, killer.villageId, -10);
      }
      this._addLog({
        message: `💀 ${victim.name} died (${victim.deathCause || 'unknown'})${killer ? ' — killed by ' + killer.name : ''}`,
        importance: 'death'
      });
    });

    // Marriage
    this.events.on('marriage', ({ human1, human2 }) => {
      this._addLog({
        message: `💍 ${human1.name} and ${human2.name} married in ${human1.villageName}!`,
        importance: 'social'
      });
    });

    // War
    this.events.on('war_declared', ({ attacker, defender }) => {
      this._addLog({
        message: `⚔️ WAR: ${attacker.name} vs ${defender.name}`,
        importance: 'war'
      });
    });

    // Animal reproduction
    this.events.on('animal_reproduce', ({ parent, type }) => {
      if (this.animals.filter(a => a.alive).length > 150) return; // cap population
      const child = new Animal(
        parent.x + randomFloat(-40, 40),
        parent.y + randomFloat(-40, 40),
        type
      );
      this.animals.push(child);
      this.renderer?.createAnimalSprite(child);
    });

    // Building complete
    this.events.on('building_complete', ({ builder, building }) => {
      this._addLog({
        message: `🏗️ ${builder.name} completed a ${building.displayName} in ${builder.villageName}`,
        importance: 'build'
      });
    });

    // Season change
    this.timeSystem.on('new_season', ({ name }) => {
      this._addLog({ message: `🍂 A new season: ${name}`, importance: 'info' });
      if (name === 'Winter') {
        this._addLog({ message: '❄️ Winter is here. Food will become scarce.', importance: 'warning' });
      }
    });

    // Dawn/dusk events
    this.timeSystem.on('dawn',  () => this._onDawn());
    this.timeSystem.on('dusk',  () => this._onDusk());
    this.timeSystem.on('new_day', ({ day }) => this._onNewDay(day));

    // Weather change
    this.weatherSystem.on('change', ({ from, to }) => {
      this._addLog({ message: `🌦️ Weather changed: ${from} → ${to}`, importance: 'info' });
    });
  }

  _onDawn() {
    // Warriors patrol at dawn
    for (const h of this.humans) {
      if (h.alive && h.job === JOBS.WARRIOR && h.state === 'sleep') {
        h.setState('idle');
      }
    }
  }

  _onDusk() {
    // Children go home at dusk
    for (const h of this.humans) {
      if (h.alive && h.job === JOBS.CHILD && h.homeBuilding) {
        h.navigateTo(h.homeBuilding.x, h.homeBuilding.y);
      }
    }
  }

  _onNewDay(day) {
    this._addLog({ message: `☀️ Day ${day} begins — ${this.timeSystem.seasonName}`, importance: 'time' });

    // War system checks
    this.warSystem.update(0, this);

    // Economy tax collection
    for (const village of this.villages) {
      const tax = this.economy.collectTax(village.id, this.humans);
    }

    // Check for new war triggers
    for (let i = 0; i < this.villages.length; i++) {
      for (let j = i + 1; j < this.villages.length; j++) {
        const v1 = this.villages[i], v2 = this.villages[j];
        const rel = this.warSystem.getRelation(v1.id, v2.id);
        if (rel < -60 && !this.warSystem.atWar(v1.id, v2.id) && chance(0.1)) {
          this.warSystem.declareWar(v1, v2, this, 'long-standing hostility');
        }
      }
    }
  }

  _updateVillagePopulation(villageId) {
    const v = this.villages.find(v => v.id === villageId);
    if (v) v.population = this.humans.filter(h => h.alive && h.villageId === villageId).length;
  }

  // ══════════════════════════════════════════════════════════════
  // MAIN UPDATE
  // ══════════════════════════════════════════════════════════════
  update(deltaMs) {
    this._frameCount++;

    // ── Core systems ──────────────────────────────────────────
    this.timeSystem.update(deltaMs);
    this.weatherSystem.update(deltaMs, this.timeSystem);
    this.warSystem.update(deltaMs / 1000, this);

    // ── Entity updates (batched) ───────────────────────────────
    // Update all humans
    for (const h of this.humans) {
      if (h.alive) {
        h.update(deltaMs, this);
        this.spatialHash.update(h);
      }
    }

    // Update all animals (less frequently for performance)
    if (this._frameCount % 2 === 0) {
      for (const a of this.animals) {
        if (a.alive) {
          a.update(deltaMs * 2, this); // double delta since running at half rate
          this.spatialHash.update(a);
        }
      }
    }

    // ── Buildings update (even less frequently) ────────────────
    if (this._frameCount % 4 === 0) {
      this.buildingManager.update((deltaMs * 4) / 1000, this);
    }

    // ── Economy update ────────────────────────────────────────
    this._economyTimer += deltaMs / 1000;
    if (this._economyTimer > 10) {
      this.economy.update(this._economyTimer, this);
      this._economyTimer = 0;
    }

    // ── Periodic cleanup ──────────────────────────────────────
    this._cleanupTimer += deltaMs / 1000;
    if (this._cleanupTimer > 30) {
      this._cleanup();
      this._cleanupTimer = 0;
    }

    // ── Memory decay (very infrequent) ────────────────────────
    if (this._frameCount % 600 === 0) {
      const gt = this.timeSystem.gameMinute;
      for (const h of this.humans) {
        h.memory?.decay(gt);
      }
    }
  }

  // ─── Cleanup dead entities ────────────────────────────────────
  _cleanup() {
    // Remove dead humans from spatial hash (keep in array for 60s then remove)
    for (const h of this.humans) {
      if (!h.alive && h._deathCleanupTimer === undefined) {
        h._deathCleanupTimer = 60;
        this.spatialHash.remove(h);
      }
      if (h._deathCleanupTimer !== undefined) {
        h._deathCleanupTimer -= 30;
        if (h._deathCleanupTimer <= 0) {
          this.renderer?.removeEntity(h);
        }
      }
    }

    // Cull very old dead entities from array
    this.humans = this.humans.filter(h => h.alive || (h._deathCleanupTimer ?? 1) > 0);

    // Remove dead animals
    for (const a of this.animals) {
      if (!a.alive) {
        this.spatialHash.remove(a);
        this.renderer?.removeEntity(a);
      }
    }
    this.animals = this.animals.filter(a => a.alive);

    // Update populations
    for (const v of this.villages) {
      v.population = this.humans.filter(h => h.alive && h.villageId === v.id).length;
    }
  }

  // ─── AI Decision Handler ──────────────────────────────────────
  _onAIDecision(taskId, result, context) {
    // taskId format: "humanId:triggerType:gameTime"
    const humanId = context?.humanId;
    if (!humanId) return;

    const human = this.humans.find(h => h.id === humanId);
    if (human && human.alive) {
      human.receiveAIDecision(result);
      this._addLog({
        message: `🤖 ${human.name} decided: ${result.goal} (${result.emotion}) — ${result.reason?.slice(0,60)}...`,
        importance: 'ai'
      });
    }
  }

  // ─── Event Log ────────────────────────────────────────────────
  _addLog(entry) {
    this.eventLog.unshift({
      message:    entry.message,
      importance: entry.importance || 'info',
      time:       this.timeSystem.displayString,
      timestamp:  Date.now()
    });
    if (this.eventLog.length > this._maxLog) this.eventLog.pop();
  }

  // ─── Getters ──────────────────────────────────────────────────
  get livingHumans()  { return this.humans.filter(h => h.alive); }
  get livingAnimals() { return this.animals.filter(a => a.alive); }
  get totalPopulation() { return this.livingHumans.length; }

  getVillage(id)      { return this.villages.find(v => v.id === id); }

  getHumansInVillage(villageId) {
    return this.humans.filter(h => h.alive && h.villageId === villageId);
  }

  // Click-to-inspect: find entity nearest to world coordinates
  getEntityAt(wx, wy, radius = 24) {
    const human = this.spatialHash.nearest(wx, wy, radius,
      e => e.type === 'human' && e.alive);
    if (human) return { type: 'human', entity: human };

    const animal = this.spatialHash.nearest(wx, wy, radius,
      e => e.type === 'animal' && e.alive);
    if (animal) return { type: 'animal', entity: animal };

    return null;
  }
}
