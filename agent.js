// ============================================================
// agent.js — Base Agent Class
//
// Foundation for all moving entities (humans and animals).
// Handles: position, velocity, movement, basic needs (hunger/energy),
// sprite rendering, collision, and the state machine core.
// ============================================================

import { uuid, clamp, dist, moveToward, randomFloat, randomInt, angleTo } from './utils.js';
import CONFIG from './config.js';

export const AGENT_STATE = {
  IDLE:       'idle',
  WANDER:     'wander',
  MOVE_TO:    'move_to',
  EAT:        'eat',
  SLEEP:      'sleep',
  DEAD:       'dead',
};

export class Agent {
  /**
   * @param {number} x World pixel X
   * @param {number} y World pixel Y
   * @param {string} type 'human'|'animal'
   */
  constructor(x, y, type = 'entity') {
    this.id      = uuid();
    this.type    = type;
    this.x       = x;
    this.y       = y;
    this.vx      = 0;
    this.vy      = 0;

    // Core needs (0=empty, 100=full)
    this.health  = 100;
    this.hunger  = 100;   // 0=starving, 100=full
    this.energy  = 100;   // 0=exhausted, 100=rested
    this.thirst  = 100;

    // Personality-like stats (set by subclasses)
    this.speed      = 60;   // pixels/second
    this.maxHealth  = 100;

    // State machine
    this.state      = AGENT_STATE.IDLE;
    this._stateTime = 0;    // seconds spent in current state
    this._moveTarget = null; // { x, y } or null
    this._moveQueue  = [];   // array of { x, y } waypoints
    this._arrived    = false;

    // Wander behavior
    this._wanderTimer   = 0;
    this._wanderTarget  = null;
    this._wanderPause   = 0;

    // Sprite reference (set by Renderer)
    this.sprite     = null;
    this.nameLabel  = null;
    this.healthBar  = null;

    // Alive flag
    this.alive      = true;

    // Direction facing (for sprite flipping)
    this.facingLeft = false;

    // Cache last tile type for terrain cost
    this._terrainCostCache = 1.0;
  }

  // ─── Update cycle ────────────────────────────────────────────
  update(deltaMs, world) {
    if (!this.alive || this.state === AGENT_STATE.DEAD) return;

    const dt = deltaMs / 1000;  // seconds
    this._stateTime += dt;

    this._tickNeeds(dt, world);
    this._runStateMachine(dt, world);
    this._applyMovement(dt, world);
    this._updateSprite();
  }

  // ─── Needs decay ─────────────────────────────────────────────
  _tickNeeds(dt, world) {
    // Hunger decreases over time (slower when sleeping)
    const hungerRate = this.state === AGENT_STATE.SLEEP ? 0.3 : 1.0;
    this.hunger  = clamp(this.hunger - dt * 0.8 * hungerRate, 0, 100);
    this.thirst  = clamp(this.thirst - dt * 1.2 * hungerRate, 0, 100);

    // Energy: drain while active, restore while sleeping
    if (this.state === AGENT_STATE.SLEEP) {
      this.energy = clamp(this.energy + dt * 15, 0, 100);
    } else {
      this.energy = clamp(this.energy - dt * 0.5, 0, 100);
    }

    // Take damage if starving
    if (this.hunger <= 0)  this.health = clamp(this.health - dt * 2, 0, this.maxHealth);
    if (this.thirst <= 0)  this.health = clamp(this.health - dt * 3, 0, this.maxHealth);

    // Natural healing when healthy
    if (this.hunger > 50 && this.thirst > 40) {
      this.health = clamp(this.health + dt * 0.5, 0, this.maxHealth);
    }

    if (this.health <= 0) this.die('starvation');
  }

  // ─── State machine (overridden by subclasses) ─────────────────
  _runStateMachine(dt, world) {
    switch (this.state) {
      case AGENT_STATE.IDLE:    this._stateIdle(dt, world);   break;
      case AGENT_STATE.WANDER:  this._stateWander(dt, world); break;
      case AGENT_STATE.MOVE_TO: this._stateMoveTo(dt, world); break;
      case AGENT_STATE.EAT:     this._stateEat(dt, world);    break;
      case AGENT_STATE.SLEEP:   this._stateSleep(dt, world);  break;
    }
  }

  _stateIdle(dt, world) {
    this._wanderPause -= dt;
    if (this._wanderPause <= 0) {
      this.setState(AGENT_STATE.WANDER);
    }
  }

  _stateWander(dt, world) {
    if (!this._wanderTarget || this._arrived) {
      // Pick a new random nearby target
      const range = 80 + randomFloat(0, 120);
      const angle = randomFloat(0, Math.PI * 2);
      this._wanderTarget = {
        x: this.x + Math.cos(angle) * range,
        y: this.y + Math.sin(angle) * range
      };
      this._arrived = false;
    }
    this._moveTo(this._wanderTarget.x, this._wanderTarget.y, world);

    if (this._arrived) {
      this._wanderTarget = null;
      this._wanderPause = randomFloat(1, 4);
      this.setState(AGENT_STATE.IDLE);
    }
  }

  _stateMoveTo(dt, world) {
    if (!this._moveTarget) { this.setState(AGENT_STATE.IDLE); return; }
    this._moveTo(this._moveTarget.x, this._moveTarget.y, world);
    if (this._arrived) {
      const next = this._moveQueue.shift();
      if (next) {
        this._moveTarget = next;
        this._arrived = false;
      } else {
        this._moveTarget = null;
        this._onArrived();
      }
    }
  }

  _stateEat(dt, world) {
    this.hunger  = clamp(this.hunger + dt * 30, 0, 100);
    this.thirst  = clamp(this.thirst + dt * 20, 0, 100);
    if (this._stateTime > 3 || this.hunger >= 95) {
      this.setState(AGENT_STATE.IDLE);
    }
  }

  _stateSleep(dt, world) {
    if (this._stateTime > 8 || this.energy >= 95) {
      this.setState(AGENT_STATE.IDLE);
    }
  }

  // ─── Movement ────────────────────────────────────────────────
  _moveTo(tx, ty, world) {
    const terrainMult = world?.weather?.movementMult ?? 1.0;
    const effectiveSpeed = this.speed * terrainMult * this._terrainCostCache;
    const result = moveToward(this.x, this.y, tx, ty, effectiveSpeed / 60);
    if (result.arrived) {
      this._arrived = true;
    } else {
      this.facingLeft = result.x < this.x;
      this.x = result.x;
      this.y = result.y;
    }
  }

  _applyMovement(dt, world) {
    // Apply any leftover velocity (knockback, etc.)
    if (Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1) {
      this.x  += this.vx * dt;
      this.y  += this.vy * dt;
      this.vx *= 0.85; // friction
      this.vy *= 0.85;
    }
  }

  // ─── Sprite sync ─────────────────────────────────────────────
  _updateSprite() {
    if (!this.sprite) return;
    this.sprite.x = this.x;
    this.sprite.y = this.y;
    if (this.sprite.scale) {
      this.sprite.scale.x = this.facingLeft ? -Math.abs(this.sprite.scale.x) : Math.abs(this.sprite.scale.x);
    }

    if (this.healthBar) {
      const pct = this.health / this.maxHealth;
      this.healthBar.x = this.x - 12;
      this.healthBar.y = this.y - 26;
      this.healthBar.scale.x = pct;
    }

    if (this.nameLabel) {
      this.nameLabel.x = this.x;
      this.nameLabel.y = this.y - 34;
    }
  }

  // ─── State transition ────────────────────────────────────────
  setState(newState) {
    if (this.state === newState) return;
    this.state      = newState;
    this._stateTime = 0;
    this._arrived   = false;
  }

  /** Navigate to a world-pixel destination */
  navigateTo(x, y, onArrival = null) {
    this._moveTarget = { x, y };
    this._moveQueue  = [];
    this._arrived    = false;
    this._onArrivalCallback = onArrival;
    this.setState(AGENT_STATE.MOVE_TO);
  }

  _onArrived() {
    if (this._onArrivalCallback) {
      this._onArrivalCallback(this);
      this._onArrivalCallback = null;
    }
    this.setState(AGENT_STATE.IDLE);
  }

  // ─── Combat ──────────────────────────────────────────────────
  takeDamage(amount, attacker = null) {
    this.health = clamp(this.health - amount, 0, this.maxHealth);
    // Knockback
    if (attacker) {
      const angle = angleTo(attacker.x, attacker.y, this.x, this.y);
      this.vx += Math.cos(angle) * 80;
      this.vy += Math.sin(angle) * 80;
    }
    if (this.health <= 0) this.die('combat');
    return this.health <= 0;
  }

  heal(amount) {
    this.health = clamp(this.health + amount, 0, this.maxHealth);
  }

  /** Called when health hits 0 */
  die(cause = 'unknown') {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.setState(AGENT_STATE.DEAD);
    if (this.sprite) {
      this.sprite.alpha = 0.3;
      this.sprite.tint  = 0x555555;
    }
  }

  // ─── Getters ─────────────────────────────────────────────────
  get isHungry()    { return this.hunger < 30; }
  get isStarving()  { return this.hunger < 10; }
  get isTired()     { return this.energy < 25; }
  get isExhausted() { return this.energy < 10; }
  get isThirsty()   { return this.thirst < 25; }
  get isHealthy()   { return this.health > 70; }
  get isInjured()   { return this.health < 50; }
  get isCritical()  { return this.health < 20; }
  get isDead()      { return !this.alive; }

  get position()    { return { x: this.x, y: this.y }; }
  get tileX()       { return Math.floor(this.x / CONFIG.world.tileSize); }
  get tileY()       { return Math.floor(this.y / CONFIG.world.tileSize); }

  distTo(other)     { return dist(this.x, this.y, other.x, other.y); }
}
