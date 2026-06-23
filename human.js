// ============================================================
// human.js — Human NPC with Complete Behavior System
//
// Extends Agent with: personality, jobs, memory, relationships,
// family, economy participation, building, farming, combat.
// Uses a priority-based state machine — needs drive behavior.
// AI API called only for dramatic/life-changing decisions.
// ============================================================

import { Agent, AGENT_STATE } from './agent.js';
import { MemorySystem, EMOTIONS } from './memory.js';
import { REL_EVENTS } from './relationship.js';
import { AIManager } from './ai.js';
import { uuid, clamp, dist, randomInt, randomFloat, chance, randomElement } from './utils.js';
import CONFIG from './config.js';

// ─── Jobs ────────────────────────────────────────────────────
export const JOBS = {
  FARMER:   'farmer',
  HUNTER:   'hunter',
  TRADER:   'trader',
  BUILDER:  'builder',
  WARRIOR:  'warrior',
  ELDER:    'elder',
  CHILD:    'child',
  HEALER:   'healer',
};

// ─── Extended States ──────────────────────────────────────────
export const HUMAN_STATE = {
  ...AGENT_STATE,
  WORK:       'work',
  FARM:       'farm',
  HUNT:       'hunt',
  BUILD:      'build',
  TRADE:      'trade',
  SOCIALIZE:  'socialize',
  FLEE:       'flee',
  FIGHT:      'fight',
  MOURN:      'mourn',
  CELEBRATE:  'celebrate',
  PATROL:     'patrol',
  HEAL:       'heal',
  GATHER:     'gather',
  ROMANCE:    'romance',
};

// Sprite tint color per job for visual distinction
export const JOB_COLORS = {
  [JOBS.FARMER]:  0x7CB342,
  [JOBS.HUNTER]:  0x6D4C41,
  [JOBS.TRADER]:  0xFFA000,
  [JOBS.BUILDER]: 0x5C6BC0,
  [JOBS.WARRIOR]: 0xE53935,
  [JOBS.ELDER]:   0x8E24AA,
  [JOBS.CHILD]:   0x00ACC1,
  [JOBS.HEALER]:  0x43A047,
};

export class Human extends Agent {
  /**
   * @param {number}  x
   * @param {number}  y
   * @param {Object}  opts  - name, age, gender, job, villageId, personality
   * @param {Object}  world - reference to World instance
   */
  constructor(x, y, opts = {}, world) {
    super(x, y, 'human');
    this._world = world;

    // ── Identity ─────────────────────────────────────────────
    this.name      = opts.name   || 'Unknown';
    this.age       = opts.age    || randomInt(16, 60);
    this.gender    = opts.gender || (chance(0.5) ? 'male' : 'female');
    this.job       = opts.job    || JOBS.FARMER;
    this.villageId = opts.villageId || null;
    this.villageName = opts.villageName || '';

    // ── Personality (0–100 each) ──────────────────────────────
    this.personality = {
      kindness:     opts.personality?.kindness     ?? randomInt(20, 90),
      bravery:      opts.personality?.bravery      ?? randomInt(20, 90),
      greed:        opts.personality?.greed        ?? randomInt(10, 80),
      morality:     opts.personality?.morality     ?? randomInt(20, 90),
      intelligence: opts.personality?.intelligence ?? randomInt(30, 95),
      strength:     opts.personality?.strength     ?? randomInt(20, 90),
    };

    // ── Economy ───────────────────────────────────────────────
    this.gold      = opts.gold ?? CONFIG.economy.startingGold;
    this.inventory = { food: randomInt(5,20), wood: 0, stone: 0, cloth: 0, weapon: 0 };

    // ── Social ────────────────────────────────────────────────
    this.spouseId      = null;
    this.familyIds     = [];   // children and siblings IDs
    this.homeBuilding  = null; // reference to Building

    // ── Memory & Emotion ──────────────────────────────────────
    this.memory        = new MemorySystem(CONFIG.simulation.maxMemoriesPerHuman);
    this.currentEmotion = EMOTIONS.JOY;
    this._mood         = 50;  // 0-100 (affects behavior decisions)

    // ── Combat ────────────────────────────────────────────────
    this.speed         = 55 + this.personality.strength * 0.3;
    this.attackDamage  = 8 + this.personality.strength * 0.15;
    this.attackRange   = CONFIG.combat.attackRange;
    this._attackTimer  = 0;
    this._fightTarget  = null;
    this._fleeTarget   = null;

    // ── Work tracking ─────────────────────────────────────────
    this._workTarget       = null;  // resource node / building / animal
    this._workTimer        = 0;
    this._workDuration     = 5;     // seconds to complete work task
    this._currentTask      = null;  // string description
    this._buildingProject  = null;

    // ── Social timer ──────────────────────────────────────────
    this._socialTimer      = randomFloat(30, 120); // seconds until next social attempt
    this._socialTarget     = null;
    this._socialCooldown   = 0;

    // ── Schedule ──────────────────────────────────────────────
    this._homeX        = x;
    this._homeY        = y;
    this._sleepHour    = randomInt(21, 23);
    this._wakeHour     = randomInt(5, 7);
    this._lastSleepDay = 0;

    // ── AI flag ───────────────────────────────────────────────
    this._aiDecisionPending  = false;
    this._aiResult           = null;
    this._pendingAIAction    = null;
    this._lastAICallGameTime = -999;

    // ── Death cause ───────────────────────────────────────────
    this.deathCause = null;

    // ── Apply job defaults ────────────────────────────────────
    this._applyJobStats();
  }

  _applyJobStats() {
    switch (this.job) {
      case JOBS.WARRIOR:
        this.attackDamage *= 1.8;
        this.speed        *= 1.1;
        this.maxHealth    = 130;
        this.health       = 130;
        break;
      case JOBS.HUNTER:
        this.speed *= 1.15;
        break;
      case JOBS.FARMER:
        this.inventory.food += 10;
        break;
      case JOBS.TRADER:
        this.gold *= 1.5;
        break;
      case JOBS.HEALER:
        this.inventory.food += 5;
        break;
      case JOBS.CHILD:
        this.speed *= 1.2;
        this.attackDamage *= 0.3;
        this.maxHealth = 60;
        this.health    = 60;
        break;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // MAIN UPDATE LOOP
  // ══════════════════════════════════════════════════════════════
  update(deltaMs, world) {
    if (!this.alive) return;
    const dt = deltaMs / 1000;

    this._attackTimer   = Math.max(0, this._attackTimer - dt);
    this._socialTimer   = Math.max(0, this._socialTimer - dt);
    this._socialCooldown = Math.max(0, this._socialCooldown - dt);

    // Process AI result if one arrived
    if (this._aiResult) {
      this._applyAIResult(this._aiResult);
      this._aiResult = null;
    }

    this._tickNeeds(dt, world);
    this._decideState(dt, world);
    this._runStateMachine(dt, world);
    this._applyMovement(dt, world);
    this._updateSprite();
    this._ageAndGrow(dt);
  }

  // ══════════════════════════════════════════════════════════════
  // DECISION ENGINE (Priority-based — no AI API needed)
  // ══════════════════════════════════════════════════════════════
  _decideState(dt, world) {
    // Dead states are terminal
    if (this.state === HUMAN_STATE.DEAD) return;

    // Don't interrupt fight, flee, or mourn states early
    if (this.state === HUMAN_STATE.FIGHT && this._fightTarget?.alive) return;
    if (this.state === HUMAN_STATE.FLEE  && this._stateTime < 5) return;
    if (this.state === HUMAN_STATE.MOURN && this._stateTime < 8) return;

    const time = world.timeSystem;
    const hour = time?.hour ?? 10;

    // ── Priority 1: Critical survival ─────────────────────────
    if (this.isStarving) {
      if (this.inventory.food > 0) { this.setState(HUMAN_STATE.EAT); return; }
      const foodSrc = this._findFood(world);
      if (foodSrc) { this._goGetFood(foodSrc, world); return; }
    }

    // ── Priority 2: Sleep schedule ─────────────────────────────
    if (hour >= this._sleepHour || hour < this._wakeHour) {
      if (this.state !== HUMAN_STATE.SLEEP) {
        this._goSleep(world);
      }
      return;
    }

    // Don't change state if already in it and working
    if (this.state === HUMAN_STATE.SLEEP) {
      if (hour >= this._wakeHour && hour < this._sleepHour) {
        this.setState(HUMAN_STATE.IDLE);
      }
      return;
    }

    // ── Priority 3: Hunger ────────────────────────────────────
    if (this.isHungry) {
      if (this.inventory.food > 0) { this.setState(HUMAN_STATE.EAT); return; }
    }

    // ── Priority 4: Job work ──────────────────────────────────
    if (this.state === HUMAN_STATE.IDLE || this.state === HUMAN_STATE.WANDER) {
      if (chance(0.4)) {
        this._assignJobTask(world);
      }
    }

    // ── Priority 5: Social ────────────────────────────────────
    if (this._socialTimer <= 0 && this._socialCooldown <= 0) {
      const socialTarget = this._findSocialTarget(world);
      if (socialTarget) {
        this._socialTarget = socialTarget;
        this._socialTimer  = randomFloat(60, 180);
        this.setState(HUMAN_STATE.SOCIALIZE);
        return;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // EXTENDED STATE HANDLERS
  // ══════════════════════════════════════════════════════════════
  _runStateMachine(dt, world) {
    switch (this.state) {
      case HUMAN_STATE.IDLE:       super._stateIdle(dt, world);    break;
      case HUMAN_STATE.WANDER:     this._stateWander(dt, world);   break;
      case HUMAN_STATE.MOVE_TO:    super._stateMoveTo(dt, world);  break;
      case HUMAN_STATE.EAT:        this._stateEat(dt, world);      break;
      case HUMAN_STATE.SLEEP:      this._stateSleep(dt, world);    break;
      case HUMAN_STATE.WORK:       this._stateWork(dt, world);     break;
      case HUMAN_STATE.FARM:       this._stateFarm(dt, world);     break;
      case HUMAN_STATE.HUNT:       this._stateHunt(dt, world);     break;
      case HUMAN_STATE.BUILD:      this._stateBuild(dt, world);    break;
      case HUMAN_STATE.TRADE:      this._stateTrade(dt, world);    break;
      case HUMAN_STATE.SOCIALIZE:  this._stateSocialize(dt, world);break;
      case HUMAN_STATE.FLEE:       this._stateFlee(dt, world);     break;
      case HUMAN_STATE.FIGHT:      this._stateFight(dt, world);    break;
      case HUMAN_STATE.GATHER:     this._stateGather(dt, world);   break;
      case HUMAN_STATE.MOURN:      this._stateMourn(dt, world);    break;
      case HUMAN_STATE.HEAL:       this._stateHeal(dt, world);     break;
      case HUMAN_STATE.PATROL:     this._statePatrol(dt, world);   break;
      case HUMAN_STATE.ROMANCE:    this._stateRomance(dt, world);  break;
    }
  }

  _stateWork(dt, world) {
    this._workTimer += dt;
    if (this._workTarget && dist(this.x, this.y, this._workTarget.x, this._workTarget.y) > 48) {
      this._moveTo(this._workTarget.x, this._workTarget.y, world);
    } else if (this._workTimer >= this._workDuration) {
      this._completeWork(world);
      this._workTimer = 0;
      this.setState(HUMAN_STATE.IDLE);
    }
  }

  _stateGather(dt, world) {
    this._workTimer += dt;
    if (!this._workTarget) { this.setState(HUMAN_STATE.IDLE); return; }
    this._moveTo(this._workTarget.x, this._workTarget.y, world);
    if (dist(this.x, this.y, this._workTarget.x, this._workTarget.y) < 48) {
      if (this._workTimer >= 4) {
        const node = this._workTarget;
        if (node.type === 'tree' && node.amount > 0) {
          const harvested = Math.min(2, node.amount);
          node.amount -= harvested;
          this.inventory.wood = (this.inventory.wood || 0) + harvested;
          world.events?.emit('resource_gathered', { human: this, type: 'wood', amount: harvested });
        } else if (node.type === 'rock' && node.amount > 0) {
          const harvested = Math.min(1, node.amount);
          node.amount -= harvested;
          this.inventory.stone = (this.inventory.stone || 0) + harvested;
          world.events?.emit('resource_gathered', { human: this, type: 'stone', amount: harvested });
        }
        this._workTimer = 0;
        if (!node.amount || node.amount <= 0) {
          this._workTarget = null;
          this.setState(HUMAN_STATE.IDLE);
        }
      }
    }
  }

  _stateFarm(dt, world) {
    this._workTimer += dt;
    if (this._workTimer >= 8) {
      const yield_ = Math.floor(randomFloat(3, 8) * world.timeSystem.growthMultiplier);
      this.inventory.food = (this.inventory.food || 0) + yield_;
      this._workTimer = 0;
      world.events?.emit('food_grown', { human: this, amount: yield_ });
      this.setState(HUMAN_STATE.IDLE);
    }
  }

  _stateHunt(dt, world) {
    if (!this._workTarget || !this._workTarget.alive) {
      const prey = world.spatialHash?.nearest(this.x, this.y, 400,
        e => e.type === 'animal' && e.alive && e.animalType !== 'wolf');
      if (!prey) { this.setState(HUMAN_STATE.IDLE); return; }
      this._workTarget = prey;
    }
    const prey = this._workTarget;
    const d = dist(this.x, this.y, prey.x, prey.y);
    if (d > this.attackRange) {
      this._moveTo(prey.x, prey.y, world);
    } else if (this._attackTimer <= 0) {
      const killed = prey.takeDamage(this.attackDamage);
      this._attackTimer = CONFIG.combat.attackCooldown / 1000;
      if (killed) {
        this.inventory.food = (this.inventory.food || 0) + randomInt(6, 15);
        world.events?.emit('animal_hunted', { hunter: this, animal: prey });
        this._workTarget = null;
        this.setState(HUMAN_STATE.IDLE);
      }
    }
  }

  _stateBuild(dt, world) {
    if (!this._buildingProject) { this.setState(HUMAN_STATE.IDLE); return; }
    const bp = this._buildingProject;
    this._moveTo(bp.x, bp.y, world);
    if (dist(this.x, this.y, bp.x, bp.y) < 64) {
      this._workTimer += dt;
      bp.progress = Math.min(1, (bp.progress || 0) + dt / bp.buildTime);
      if (bp.progress >= 1) {
        bp.complete = true;
        world.events?.emit('building_complete', { builder: this, building: bp });
        this._buildingProject = null;
        this.setState(HUMAN_STATE.IDLE);
      }
    }
  }

  _stateTrade(dt, world) {
    this._workTimer += dt;
    if (!this._workTarget) { this.setState(HUMAN_STATE.IDLE); return; }
    this._moveTo(this._workTarget.x, this._workTarget.y, world);
    if (dist(this.x, this.y, this._workTarget.x, this._workTarget.y) < 64) {
      if (this._workTimer >= 3) {
        this._executeTrade(this._workTarget, world);
        this.setState(HUMAN_STATE.IDLE);
      }
    }
  }

  _stateSocialize(dt, world) {
    if (!this._socialTarget || !this._socialTarget.alive) {
      this.setState(HUMAN_STATE.IDLE); return;
    }
    const target = this._socialTarget;
    this._moveTo(target.x, target.y, world);

    if (dist(this.x, this.y, target.x, target.y) < 48) {
      this._workTimer += dt;
      if (this._workTimer >= 3) {
        this._conductSocialInteraction(target, world);
        this._workTimer    = 0;
        this._socialTarget = null;
        this._socialCooldown = randomFloat(20, 60);
        this.setState(HUMAN_STATE.IDLE);
      }
    }
  }

  _stateFlee(dt, world) {
    if (!this._fleeTarget) { this.setState(HUMAN_STATE.IDLE); return; }
    // Move away from threat
    const dx = this.x - this._fleeTarget.x;
    const dy = this.y - this._fleeTarget.y;
    const d  = Math.hypot(dx, dy) || 1;
    const fleeX = this.x + (dx / d) * 200;
    const fleeY = this.y + (dy / d) * 200;
    this._moveTo(fleeX, fleeY, world);

    const dist_ = dist(this.x, this.y, this._fleeTarget.x, this._fleeTarget.y);
    if (dist_ > 350 || this._stateTime > 10) {
      this._fleeTarget = null;
      this.setState(HUMAN_STATE.IDLE);
    }
  }

  _stateFight(dt, world) {
    if (!this._fightTarget || !this._fightTarget.alive) {
      this._fightTarget = null;
      this.setState(HUMAN_STATE.IDLE);
      return;
    }

    // Flee if health critical
    if (this.isCritical && this.personality.bravery < 60) {
      this._fleeTarget = this._fightTarget;
      this._fightTarget = null;
      this.setState(HUMAN_STATE.FLEE);
      return;
    }

    const target = this._fightTarget;
    const d = dist(this.x, this.y, target.x, target.y);

    if (d > this.attackRange) {
      this._moveTo(target.x, target.y, world);
    } else if (this._attackTimer <= 0) {
      const dmg = this.attackDamage * randomFloat(0.8, 1.3);
      const killed = target.takeDamage(dmg, this);
      this._attackTimer = CONFIG.combat.attackCooldown / 1000;

      world.events?.emit('combat_hit', { attacker: this, defender: target, damage: dmg });

      if (killed) {
        this._onKilled(target, world);
      }
    }
  }

  _stateMourn(dt, world) {
    if (this._stateTime > 12) {
      this.setState(HUMAN_STATE.IDLE);
    }
  }

  _stateHeal(dt, world) {
    if (!this._workTarget || !this._workTarget.alive) {
      this.setState(HUMAN_STATE.IDLE); return;
    }
    this._moveTo(this._workTarget.x, this._workTarget.y, world);
    if (dist(this.x, this.y, this._workTarget.x, this._workTarget.y) < 48) {
      this._workTimer += dt;
      if (this._workTimer >= 3) {
        const healAmt = randomInt(15, 35);
        this._workTarget.heal(healAmt);
        world.events?.emit('healed', { healer: this, target: this._workTarget, amount: healAmt });
        this._workTarget = null;
        this.setState(HUMAN_STATE.IDLE);
      }
    }
  }

  _statePatrol(dt, world) {
    if (!this._wanderTarget || this._arrived) {
      const range = 120;
      this._wanderTarget = {
        x: this._homeX + randomFloat(-range, range),
        y: this._homeY + randomFloat(-range, range)
      };
      this._arrived = false;
    }
    this._moveTo(this._wanderTarget.x, this._wanderTarget.y, world);
    if (this._arrived) this._wanderTarget = null;

    // Check for enemies while patrolling
    const enemy = world.spatialHash?.nearest(this.x, this.y, 200,
      e => e.type === 'human' && e.alive && e.villageId &&
           e.villageId !== this.villageId &&
           world.warSystem?.atWar(this.villageId, e.villageId));
    if (enemy) {
      this._startFight(enemy, world);
    }
  }

  _stateRomance(dt, world) {
    if (!this._socialTarget || !this._socialTarget.alive) {
      this.setState(HUMAN_STATE.IDLE); return;
    }
    this._moveTo(this._socialTarget.x, this._socialTarget.y, world);
    if (dist(this.x, this.y, this._socialTarget.x, this._socialTarget.y) < 48) {
      this._workTimer += dt;
      if (this._workTimer >= 5) {
        this._proposeMarriage(this._socialTarget, world);
        this._socialTarget = null;
        this.setState(HUMAN_STATE.IDLE);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // JOB ASSIGNMENT
  // ══════════════════════════════════════════════════════════════
  _assignJobTask(world) {
    switch (this.job) {
      case JOBS.FARMER:    this._taskFarm(world);    break;
      case JOBS.HUNTER:    this._taskHunt(world);    break;
      case JOBS.BUILDER:   this._taskBuild(world);   break;
      case JOBS.TRADER:    this._taskTrade(world);   break;
      case JOBS.WARRIOR:   this._taskPatrol(world);  break;
      case JOBS.HEALER:    this._taskHeal(world);    break;
      case JOBS.CHILD:     this.setState(HUMAN_STATE.WANDER); break;
      default:             this._taskGather(world);  break;
    }
  }

  _taskFarm(world) {
    // Find a farm building or farmland tile nearby
    const farm = world.buildingManager?.nearestOf(this.x, this.y, 'farm', 400, this.villageId);
    if (farm) {
      this._moveTo(farm.x, farm.y, world);
      this.setState(HUMAN_STATE.FARM);
    } else {
      this._taskGather(world);
    }
  }

  _taskHunt(world) {
    const prey = world.spatialHash?.nearest(this.x, this.y, 500,
      e => e.type === 'animal' && e.alive && ['deer','cow','chicken'].includes(e.animalType));
    if (prey) {
      this._workTarget = prey;
      this.setState(HUMAN_STATE.HUNT);
    } else {
      this._taskGather(world);
    }
  }

  _taskBuild(world) {
    const project = world.buildingManager?.pendingProject(this.villageId);
    if (project) {
      this._buildingProject = project;
      this.setState(HUMAN_STATE.BUILD);
    } else if (this.inventory.wood < 5) {
      this._taskGather(world);
    } else {
      this.setState(HUMAN_STATE.WANDER);
    }
  }

  _taskTrade(world) {
    if (this.inventory.food > 15 || this.inventory.wood > 8) {
      const buyer = world.spatialHash?.nearest(this.x, this.y, 250,
        e => e.type === 'human' && e.alive && e.id !== this.id &&
             (e.isHungry || e.inventory.food < 5));
      if (buyer) {
        this._workTarget = buyer;
        this.setState(HUMAN_STATE.TRADE);
        return;
      }
    }
    this.setState(HUMAN_STATE.WANDER);
  }

  _taskPatrol(world) {
    this.setState(HUMAN_STATE.PATROL);
  }

  _taskHeal(world) {
    const injured = world.spatialHash?.nearest(this.x, this.y, 300,
      e => e.type === 'human' && e.alive && e.isInjured && e.id !== this.id &&
           e.villageId === this.villageId);
    if (injured) {
      this._workTarget = injured;
      this.setState(HUMAN_STATE.HEAL);
    } else {
      this.setState(HUMAN_STATE.WANDER);
    }
  }

  _taskGather(world) {
    const node = world.terrain?.resourceNodes?.find(n =>
      n.amount > 0 && dist(this.x, this.y, n.x * CONFIG.world.tileSize, n.y * CONFIG.world.tileSize) < 600
    );
    if (node) {
      this._workTarget = { x: node.x * CONFIG.world.tileSize, y: node.y * CONFIG.world.tileSize, ...node };
      this.setState(HUMAN_STATE.GATHER);
    } else {
      this.setState(HUMAN_STATE.WANDER);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SOCIAL INTERACTIONS
  // ══════════════════════════════════════════════════════════════
  _findSocialTarget(world) {
    return world.spatialHash?.nearest(this.x, this.y, 200,
      e => e.type === 'human' && e.alive && e.id !== this.id &&
           e.state !== HUMAN_STATE.SLEEP && e.state !== HUMAN_STATE.FIGHT);
  }

  _conductSocialInteraction(target, world) {
    const relMgr = world.relationshipManager;
    if (!relMgr) return;

    const myScore    = relMgr.getScore(this.id, target.id);
    const gameTime   = world.timeSystem?.gameMinute || 0;

    // Determine interaction quality based on personalities
    const compatibility = (this.personality.kindness + target.personality.kindness) / 200;
    const random        = Math.random();
    const outcome       = random < compatibility * 0.7 + 0.1 ? 'positive' : 'neutral';

    if (outcome === 'positive') {
      relMgr.applyEvent(this.id, target.id, 'CHATTED', gameTime);
      this.memory.remember({
        event: `Had a pleasant chat with ${target.name}`,
        importance: 2, emotion: EMOTIONS.JOY,
        gameTime, people: [target.id], tag: 'social'
      });

      // Chance to share food → deeper friendship
      if (this.inventory.food > 10 && chance(0.2)) {
        const shared = Math.min(3, this.inventory.food);
        this.inventory.food  -= shared;
        target.inventory.food = (target.inventory.food || 0) + shared;
        relMgr.applyEvent(this.id, target.id, 'GAVE_FOOD', gameTime);
        this.memory.remember({
          event: `Shared food with ${target.name}`,
          importance: 4, emotion: EMOTIONS.GRATITUDE,
          gameTime, people: [target.id], tag: 'trade'
        });
        world.events?.emit('social_event', {
          message: `${this.name} shared food with ${target.name}`,
          x: this.x, y: this.y
        });
      }
    }

    // Romance check
    if (myScore > 50 && !this.spouseId && !target.spouseId &&
        Math.abs(this.age - target.age) < 25 && chance(0.05)) {
      this._socialTarget = target;
      this.setState(HUMAN_STATE.ROMANCE);
    }

    // Check if target is enemy → trigger AI decision
    if (myScore < -60 && this.memory.hasStrongMemoryOf(target.id, 7)) {
      this._triggerAIDecision('betrayal', target, world);
    }
  }

  _proposeMarriage(target, world) {
    if (this.spouseId || target.spouseId) return;

    const relMgr   = world.relationshipManager;
    const gameTime = world.timeSystem?.gameMinute || 0;
    const myScore  = relMgr?.getScore(this.id, target.id) || 0;

    if (myScore > 65) {
      // Marriage!
      this.spouseId  = target.id;
      target.spouseId = this.id;
      this.familyIds.push(target.id);
      target.familyIds.push(this.id);

      relMgr?.applyEvent(this.id, target.id, 'MARRIED', gameTime);
      this.memory.remember({
        event: `Married ${target.name} — the happiest day of my life`,
        importance: 10, emotion: EMOTIONS.LOVE,
        gameTime, people: [target.id], tag: 'love'
      });
      target.memory.remember({
        event: `Married ${this.name}`,
        importance: 10, emotion: EMOTIONS.LOVE,
        gameTime, people: [this.id], tag: 'love'
      });

      world.events?.emit('marriage', { human1: this, human2: target });
      this._triggerAIDecision('marriage', target, world);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // COMBAT
  // ══════════════════════════════════════════════════════════════
  _startFight(target, world) {
    const relMgr = world.relationshipManager;
    const score  = relMgr?.getScore(this.id, target.id) ?? 0;

    // Only fight if hostile OR at war
    const atWar  = world.warSystem?.atWar(this.villageId, target.villageId);
    if (score < -30 || atWar) {
      this._fightTarget = target;
      this.setState(HUMAN_STATE.FIGHT);
    }
  }

  startAttack(target, world) {
    this._fightTarget = target;
    this.setState(HUMAN_STATE.FIGHT);
  }

  _onKilled(target, world) {
    const gameTime = world.timeSystem?.gameMinute || 0;
    const relMgr   = world.relationshipManager;

    this.memory.remember({
      event: `I killed ${target.name} in battle`,
      importance: 7,
      emotion: this.personality.morality > 60 ? EMOTIONS.SHAME : EMOTIONS.PRIDE,
      gameTime, people: [target.id], tag: 'combat'
    });

    relMgr?.applyEvent(this.id, target.id, 'MURDERED', gameTime);

    // Notify target's family and friends
    world.events?.emit('human_died', { victim: target, killer: this });

    this._fightTarget = null;
    this.setState(HUMAN_STATE.IDLE);
  }

  // ══════════════════════════════════════════════════════════════
  // AI DECISIONS (called for dramatic events only)
  // ══════════════════════════════════════════════════════════════
  _triggerAIDecision(triggerType, targetHuman, world) {
    if (this._aiDecisionPending) return;

    const gameTime   = world.timeSystem?.gameMinute || 0;
    const timeSince  = gameTime - this._lastAICallGameTime;
    if (timeSince < 120) return; // Don't call again too soon (2 in-game hours)

    this._aiDecisionPending     = true;
    this._lastAICallGameTime    = gameTime;

    const relMgr    = world.relationshipManager;
    const memBlock  = this.memory.toPromptBlock(gameTime);
    const relText   = targetHuman
      ? relMgr?.toPromptBlock(this.id, targetHuman.id) || ''
      : '';

    const extras = this._buildTriggerDescription(triggerType, targetHuman);
    const prompt = AIManager.buildPrompt(this, triggerType, targetHuman,
      memBlock, relText, extras);

    world.aiManager?.queue(
      `${this.id}:${triggerType}:${gameTime}`,
      prompt,
      { personality: this.personality, triggerType, humanId: this.id, targetId: targetHuman?.id },
      triggerType === 'war_declaration' ? 1 : 5  // war = high priority
    );
  }

  _buildTriggerDescription(type, target) {
    switch (type) {
      case 'betrayal':
        return `${target?.name} has wronged you deeply. They stand before you now. The memories of their betrayal burn in your mind. What do you do?`;
      case 'murder_of_loved_one':
        return `Someone you cared for has been murdered. The killer may be nearby. Justice or mercy?`;
      case 'war_declaration':
        return `Your village is about to be attacked. Do you fight, seek peace, or prepare defenses?`;
      case 'marriage':
        return `You have just married ${target?.name}. How do you feel about your future together?`;
      case 'revenge':
        return `You have the chance for revenge against ${target?.name}. Do you take it?`;
      default:
        return `A significant moment has arrived. How do you respond?`;
    }
  }

  /** Called by World when AI responds to this human's request */
  receiveAIDecision(result) {
    this._aiDecisionPending = false;
    this._aiResult = result;
  }

  _applyAIResult(result) {
    const action = result.next_action;
    this.currentEmotion = result.emotion || this.currentEmotion;

    switch (action) {
      case 'confront_enemy':   this.setState(HUMAN_STATE.FIGHT);    break;
      case 'flee':             this.setState(HUMAN_STATE.FLEE);     break;
      case 'seek_revenge':
        this._currentTask = 'revenge';
        this.setState(HUMAN_STATE.PATROL);
        break;
      case 'forgive':
        this.setState(HUMAN_STATE.IDLE);
        break;
      case 'rally_warriors':
        this._world?.warSystem?.rallyWarriors(this.villageId);
        break;
      case 'fortify':
        this._world?.warSystem?.fortifyVillage(this.villageId);
        break;
      case 'accept_proposal':
        this.setState(HUMAN_STATE.CELEBRATE);
        break;
      case 'mourn':
        this.setState(HUMAN_STATE.MOURN);
        break;
      case 'wander':
      default:
        this.setState(HUMAN_STATE.WANDER);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════
  _findFood(world) {
    // Check nearby markets, storage buildings, or humans with food
    const store = world.buildingManager?.nearestOf(this.x, this.y, 'market', 600, this.villageId);
    return store || null;
  }

  _goGetFood(source, world) {
    this.navigateTo(source.x, source.y, () => {
      this.inventory.food = (this.inventory.food || 0) + randomInt(5, 12);
      this.setState(HUMAN_STATE.EAT);
    });
  }

  _goSleep(world) {
    if (this.homeBuilding) {
      this.navigateTo(this.homeBuilding.x, this.homeBuilding.y, () => {
        this.setState(HUMAN_STATE.SLEEP);
      });
    } else {
      this.setState(HUMAN_STATE.SLEEP);
    }
  }

  _executeTrade(buyer, world) {
    const price = world.economy?.getPrice('food') || 5;
    const amount = Math.min(5, this.inventory.food);
    if (amount > 0 && buyer.gold >= price) {
      this.inventory.food -= amount;
      buyer.inventory.food = (buyer.inventory.food || 0) + amount;
      this.gold  += price;
      buyer.gold -= price;

      const relMgr   = world.relationshipManager;
      const gameTime = world.timeSystem?.gameMinute || 0;
      relMgr?.applyEvent(this.id, buyer.id, 'TRADED_FAIRLY', gameTime);
      world.economy?.recordTrade({ seller: this, buyer, amount, price });
    }
  }

  _stateEat(dt, world) {
    if (this.inventory.food > 0) {
      this._workTimer += dt;
      if (this._workTimer >= 2) {
        this.inventory.food = Math.max(0, this.inventory.food - 1);
        this.hunger = clamp(this.hunger + 35, 0, 100);
        this.thirst = clamp(this.thirst + 15, 0, 100);
        this._workTimer = 0;
        if (this.hunger >= 90) this.setState(HUMAN_STATE.IDLE);
      }
    } else {
      this.setState(HUMAN_STATE.IDLE);
    }
  }

  _ageAndGrow(dt) {
    // Age by 1 year every ~365 in-game days (very slow)
    // gameMinute += ... handled in TimeSystem. Here we just track mood.
    this._mood = clamp(
      this._mood + (this.hunger > 50 ? 0.01 : -0.03) * dt * 60,
      0, 100
    );
  }

  // ── Helpers for world/village to call ─────────────────────────
  onFamilyMemberDied(deceased, killer, world) {
    const gameTime = world.timeSystem?.gameMinute || 0;
    this.memory.remember({
      event: `${deceased.name} was killed${killer ? ' by ' + killer.name : ''}`,
      importance: 9, emotion: EMOTIONS.GRIEF,
      gameTime, people: [deceased.id, killer?.id].filter(Boolean), tag: 'death'
    });

    if (killer) {
      world.relationshipManager?.applyEvent(this.id, killer.id, 'KILLED_FAMILY', gameTime);
      if (this.personality.bravery > 50) {
        this._triggerAIDecision('murder_of_loved_one', killer, world);
      }
    }
    this.setState(HUMAN_STATE.MOURN);
  }

  onVillageAttacked(world) {
    this._triggerAIDecision('war_declaration', null, world);
    if (this.job === JOBS.WARRIOR) {
      this.setState(HUMAN_STATE.PATROL);
    } else if (this.personality.bravery < 50) {
      this.setState(HUMAN_STATE.FLEE);
    }
  }

  // ─── Death override ───────────────────────────────────────────
  die(cause = 'unknown') {
    super.die(cause);
    this.deathCause = cause;
    this._world?.events?.emit('human_died', { victim: this, cause });
  }

  // ─── Getters ──────────────────────────────────────────────────
  get isWarrior()  { return this.job === JOBS.WARRIOR; }
  get isChild()    { return this.job === JOBS.CHILD || this.age < 16; }
  get description() {
    return `${this.name}, ${this.age}y ${this.gender} ${this.job} of ${this.villageName}`;
  }
}
