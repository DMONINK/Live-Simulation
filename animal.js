// ============================================================
// animal.js — Animal AI
//
// Animals use simpler state machines than humans.
// Predators (wolves) hunt prey. Prey flee from predators.
// Cows/chickens are passive and form herds.
// Animals can be hunted by humans.
// ============================================================

import { Agent, AGENT_STATE } from './agent.js';
import { randomFloat, randomInt, chance, dist } from './utils.js';
import CONFIG from './config.js';

export const ANIMAL_TYPES = {
  WOLF:    'wolf',
  DEER:    'deer',
  COW:     'cow',
  CHICKEN: 'chicken',
  HORSE:   'horse',
};

const ANIMAL_STATE = {
  ...AGENT_STATE,
  GRAZE:   'graze',
  FLEE:    'flee',
  HUNT:    'hunt',
  REST:    'rest',
  HERD:    'herd',
};

const ANIMAL_PROPS = {
  [ANIMAL_TYPES.WOLF]: {
    speed: 85, health: 60, damage: 18, isPredator: true,
    color: 0x607D8B, eatsMeat: true, fearRadius: 200
  },
  [ANIMAL_TYPES.DEER]: {
    speed: 90, health: 40, damage: 3, isPredator: false,
    color: 0xA1887F, fearRadius: 250
  },
  [ANIMAL_TYPES.COW]: {
    speed: 35, health: 80, damage: 5, isPredator: false,
    color: 0xEFEBE9, fearRadius: 150
  },
  [ANIMAL_TYPES.CHICKEN]: {
    speed: 45, health: 15, damage: 1, isPredator: false,
    color: 0xFFEB3B, fearRadius: 100
  },
  [ANIMAL_TYPES.HORSE]: {
    speed: 110, health: 90, damage: 10, isPredator: false,
    color: 0x795548, fearRadius: 180
  },
};

export class Animal extends Agent {
  constructor(x, y, animalType = ANIMAL_TYPES.DEER) {
    super(x, y, 'animal');

    this.animalType = animalType;
    const props = ANIMAL_PROPS[animalType] || ANIMAL_PROPS[ANIMAL_TYPES.DEER];

    this.speed        = props.speed;
    this.maxHealth    = props.health;
    this.health       = props.health;
    this.attackDamage = props.damage;
    this.isPredator   = props.isPredator || false;
    this.color        = props.color;
    this.fearRadius   = props.fearRadius;
    this.attackRange  = 40;
    this._attackTimer = 0;
    this._huntTarget  = null;
    this._fleeTarget  = null;
    this._herdCenter  = { x, y };
    this._reproTimer  = randomFloat(120, 300); // seconds until reproduction check
    this.herdId       = null;

    // Start grazing
    this.setState(ANIMAL_STATE.GRAZE);
    this._wanderTimer = randomFloat(3, 10);
  }

  update(deltaMs, world) {
    if (!this.alive) return;
    const dt = deltaMs / 1000;

    this._attackTimer  = Math.max(0, this._attackTimer - dt);
    this._wanderTimer  = Math.max(0, this._wanderTimer - dt);
    this._reproTimer  -= dt;

    this._tickNeeds(dt, world);
    this._perceiveEnvironment(world);
    this._runAnimalState(dt, world);
    this._applyMovement(dt, world);
    this._updateSprite();

    if (this._reproTimer <= 0) this._tryReproduce(world);
  }

  // ─── Perception ───────────────────────────────────────────────
  _perceiveEnvironment(world) {
    if (!world.spatialHash) return;

    if (this.isPredator) {
      // Wolves hunt deer/cows/chickens
      if (!this._huntTarget || !this._huntTarget.alive) {
        const prey = world.spatialHash.nearest(this.x, this.y, 300,
          e => e.type === 'animal' && e.alive &&
               e.animalType !== ANIMAL_TYPES.WOLF &&
               !e.isPredator && this.hunger < 60);
        this._huntTarget = prey;
        if (prey) this.setState(ANIMAL_STATE.HUNT);
      }

      // Wolves also attack humans sometimes (low health, hungry)
      if (!this._huntTarget && this.hunger < 30) {
        const human = world.spatialHash.nearest(this.x, this.y, 200,
          e => e.type === 'human' && e.alive);
        if (human) { this._huntTarget = human; this.setState(ANIMAL_STATE.HUNT); }
      }
    } else {
      // Prey flee from wolves and hunters
      const threat = world.spatialHash.nearest(this.x, this.y, this.fearRadius,
        e => (e.animalType === ANIMAL_TYPES.WOLF) ||
             (e.type === 'human' && e.job === 'hunter'));
      if (threat && this.state !== ANIMAL_STATE.FLEE) {
        this._fleeTarget = threat;
        this.setState(ANIMAL_STATE.FLEE);
      }
    }
  }

  // ─── Animal State Machine ─────────────────────────────────────
  _runAnimalState(dt, world) {
    switch (this.state) {
      case ANIMAL_STATE.GRAZE:   this._stateGraze(dt, world);  break;
      case ANIMAL_STATE.FLEE:    this._stateFlee(dt, world);   break;
      case ANIMAL_STATE.HUNT:    this._stateHunt(dt, world);   break;
      case ANIMAL_STATE.REST:    this._stateRest(dt, world);   break;
      case ANIMAL_STATE.HERD:    this._stateHerd(dt, world);   break;
      case ANIMAL_STATE.WANDER:  this._stateWander(dt, world); break;
      case ANIMAL_STATE.IDLE:
        if (this._wanderTimer <= 0) {
          this.setState(ANIMAL_STATE.GRAZE);
          this._wanderTimer = randomFloat(5, 15);
        }
        break;
    }
  }

  _stateGraze(dt, world) {
    // Slow wander, hunger recovers
    if (this._wanderTimer <= 0) {
      const range = 60 + randomFloat(0, 80);
      const angle = randomFloat(0, Math.PI * 2);
      this._wanderTarget = {
        x: this.x + Math.cos(angle) * range,
        y: this.y + Math.sin(angle) * range
      };
      this._wanderTimer = randomFloat(4, 12);
    }
    if (this._wanderTarget) {
      const arrived = this._moveTo(this._wanderTarget.x, this._wanderTarget.y, world);
    }
    this.hunger = Math.min(100, this.hunger + dt * 2);

    // Night → rest
    const hour = world.timeSystem?.hour ?? 10;
    if (!this.isPredator && (hour < 5 || hour > 21)) {
      this.setState(ANIMAL_STATE.REST);
    }
    // Predators more active at night
    if (this.isPredator && hour >= 6 && hour <= 18 && chance(0.001)) {
      this.setState(ANIMAL_STATE.REST);
    }
  }

  _stateFlee(dt, world) {
    if (!this._fleeTarget || !this._fleeTarget.alive) {
      this._fleeTarget = null;
      this.setState(ANIMAL_STATE.GRAZE);
      return;
    }
    const dx = this.x - this._fleeTarget.x;
    const dy = this.y - this._fleeTarget.y;
    const d  = Math.hypot(dx, dy) || 1;
    const fleeX = this.x + (dx / d) * 180;
    const fleeY = this.y + (dy / d) * 180;
    this._moveTo(fleeX, fleeY, world);

    if (dist(this.x, this.y, this._fleeTarget.x, this._fleeTarget.y) > this.fearRadius * 1.5
        || this._stateTime > 8) {
      this._fleeTarget = null;
      this.setState(ANIMAL_STATE.GRAZE);
    }
  }

  _stateHunt(dt, world) {
    if (!this._huntTarget || !this._huntTarget.alive) {
      this._huntTarget = null;
      this.setState(ANIMAL_STATE.GRAZE);
      return;
    }
    const target = this._huntTarget;
    const d = dist(this.x, this.y, target.x, target.y);

    if (d > this.attackRange) {
      this._moveTo(target.x, target.y, world);
    } else if (this._attackTimer <= 0) {
      const killed = target.takeDamage(this.attackDamage, this);
      this._attackTimer = 1.5;
      if (killed) {
        this.hunger = Math.min(100, this.hunger + 50);
        world.events?.emit('animal_killed', { killer: this, victim: target });
        this._huntTarget = null;
        this.setState(ANIMAL_STATE.GRAZE);
      }
    }
  }

  _stateRest(dt, world) {
    this.energy = Math.min(100, this.energy + dt * 8);
    if (this._stateTime > randomFloat(5, 15)) {
      this.setState(ANIMAL_STATE.GRAZE);
    }
  }

  _stateHerd(dt, world) {
    // Move toward herd center
    this._moveTo(this._herdCenter.x, this._herdCenter.y, world);
    if (dist(this.x, this.y, this._herdCenter.x, this._herdCenter.y) < 40) {
      this.setState(ANIMAL_STATE.GRAZE);
    }
  }

  // ─── Reproduction ─────────────────────────────────────────────
  _tryReproduce(world) {
    this._reproTimer = randomFloat(180, 600);
    if (!this.alive || this.health < 70 || this.hunger < 50) return;
    if (this.isPredator && chance(0.05)) {
      world.events?.emit('animal_reproduce', { parent: this, type: this.animalType });
    } else if (!this.isPredator && chance(0.08)) {
      world.events?.emit('animal_reproduce', { parent: this, type: this.animalType });
    }
  }

  // Override move to return arrived
  _moveTo(tx, ty, world) {
    const { moveToward } = { moveToward: (x,y,tx,ty,s) => {
      const d = Math.hypot(tx-x, ty-y);
      if (d < s) return { x: tx, y: ty, arrived: true };
      return { x: x+(tx-x)/d*s, y: y+(ty-y)/d*s, arrived: false };
    }};
    const terrainMult = world?.weather?.movementMult ?? 1.0;
    const spd = this.speed * terrainMult / 60;
    const res = moveToward(this.x, this.y, tx, ty, spd);
    this.facingLeft = res.x < this.x;
    this.x = res.x;
    this.y = res.y;
    return res.arrived;
  }

  get color_() { return ANIMAL_PROPS[this.animalType]?.color || 0xFFFFFF; }
}
