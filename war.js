// ============================================================
// war.js — War System
//
// Manages inter-village conflicts: declarations, battles, raids,
// sieges, peace negotiations. AI decides strategy.
// War causes fire, death, refugees, and economy damage.
// ============================================================

import { randomInt, randomFloat, chance, dist } from './utils.js';
import { EventEmitter } from './utils.js';
import { JOBS } from './human.js';

// ─── War State ────────────────────────────────────────────────
export const WAR_STATE = {
  PEACE:         'peace',
  TENSION:       'tension',       // hostile but not fighting
  DECLARED:      'declared',      // war officially declared
  ACTIVE:        'active',        // ongoing battles
  CEASEFIRE:     'ceasefire',     // temporary halt
  NEGOTIATING:   'negotiating',   // peace talks
  ENDED:         'ended',
};

// ─── War Record ───────────────────────────────────────────────
class War {
  constructor(attackerId, defenderId) {
    this.id          = `war_${Date.now()}`;
    this.attackerId  = attackerId;
    this.defenderId  = defenderId;
    this.state       = WAR_STATE.DECLARED;
    this.startDay    = 0;
    this.endDay      = null;
    this.attackerLosses = 0;
    this.defenderLosses = 0;
    this.cause       = '';
    this.raidCount   = 0;
    this.winner      = null;
  }
}

// ─── War System ───────────────────────────────────────────────
export class WarSystem extends EventEmitter {
  constructor() {
    super();
    this._wars       = new Map();  // warId → War
    this._activeWars = new Set();  // set of warIds currently active
    this._relations  = new Map();  // "v1:v2" → score (-100 to +100)
    this._truce      = new Map();  // "v1:v2" → time truce expires
    this._rallyTimer = new Map();  // villageId → timer
    this._raidTimer  = 0;
  }

  // ─── Village Relations ────────────────────────────────────────
  getRelation(v1, v2) {
    const key = [v1, v2].sort().join(':');
    return this._relations.get(key) ?? 0;
  }

  adjustRelation(v1, v2, delta) {
    const key   = [v1, v2].sort().join(':');
    const prev  = this._relations.get(key) ?? 0;
    const next  = Math.max(-100, Math.min(100, prev + delta));
    this._relations.set(key, next);
    return next;
  }

  atWar(v1, v2) {
    if (!v1 || !v2 || v1 === v2) return false;
    for (const war of this._wars.values()) {
      if (war.state === WAR_STATE.ACTIVE || war.state === WAR_STATE.DECLARED) {
        if ((war.attackerId === v1 && war.defenderId === v2) ||
            (war.attackerId === v2 && war.defenderId === v1)) {
          return true;
        }
      }
    }
    return false;
  }

  inTruce(v1, v2) {
    const key = [v1, v2].sort().join(':');
    const t   = this._truce.get(key);
    return t !== undefined && Date.now() < t;
  }

  // ─── War Declaration ──────────────────────────────────────────
  declareWar(attackerVillage, defenderVillage, world, cause = 'resource dispute') {
    if (this.atWar(attackerVillage.id, defenderVillage.id)) return null;
    if (this.inTruce(attackerVillage.id, defenderVillage.id)) return null;

    const war       = new War(attackerVillage.id, defenderVillage.id);
    war.state       = WAR_STATE.DECLARED;
    war.cause       = cause;
    war.startDay    = world.timeSystem?.day || 0;

    this._wars.set(war.id, war);
    this._activeWars.add(war.id);
    this.adjustRelation(attackerVillage.id, defenderVillage.id, -50);

    // Notify all humans in both villages
    this._notifyVillageOfWar(attackerVillage, world);
    this._notifyVillageOfWar(defenderVillage, world);

    this.emit('war_declared', { war, attacker: attackerVillage, defender: defenderVillage, cause });
    world.events?.emit('war_declared', { war, attacker: attackerVillage, defender: defenderVillage });
    world.events?.emit('log_event', {
      message: `⚔️ ${attackerVillage.name} declared war on ${defenderVillage.name}! (${cause})`,
      importance: 'war', x: attackerVillage.x, y: attackerVillage.y
    });

    console.log(`[War] ${attackerVillage.name} → ${defenderVillage.name}: ${cause}`);
    return war;
  }

  _notifyVillageOfWar(village, world) {
    const humans = world.humans?.filter(h =>
      h.alive && h.villageId === village.id
    ) || [];
    for (const h of humans) {
      h.onVillageAttacked?.(world);
    }
  }

  // ─── Main Update ──────────────────────────────────────────────
  update(dt, world) {
    this._raidTimer -= dt;

    for (const warId of this._activeWars) {
      const war = this._wars.get(warId);
      if (!war) { this._activeWars.delete(warId); continue; }

      if (war.state === WAR_STATE.DECLARED) {
        war.state = WAR_STATE.ACTIVE;
      }

      if (war.state === WAR_STATE.ACTIVE) {
        this._updateActiveWar(war, world, dt);
      }
    }

    // Tension check — villages may declare war naturally
    if (this._raidTimer <= 0) {
      this._raidTimer = randomFloat(60, 180);
      this._checkForNewConflicts(world);
    }

    // Peace negotiations
    for (const war of this._wars.values()) {
      if (war.state === WAR_STATE.ACTIVE) {
        this._checkForPeace(war, world);
      }
    }
  }

  _updateActiveWar(war, world, dt) {
    const attVillage = world.villages?.find(v => v.id === war.attackerId);
    const defVillage = world.villages?.find(v => v.id === war.defenderId);
    if (!attVillage || !defVillage) return;

    war.raidCount++;

    // Every N seconds, send raiding party
    if (war.raidCount % 20 === 0) {
      this._sendRaid(war, attVillage, defVillage, world);
    }
  }

  _sendRaid(war, attacker, defender, world) {
    const warriors = world.humans?.filter(h =>
      h.alive && h.villageId === attacker.id &&
      (h.job === JOBS.WARRIOR || h.job === JOBS.HUNTER)
    ) || [];

    if (warriors.length === 0) {
      this._checkForPeace(war, world); // no warriors → seek peace
      return;
    }

    const raiding = warriors.slice(0, Math.min(5, warriors.length));

    // Target a random house in the defender village
    const targetBuilding = world.buildingManager?.forVillage(defender.id)
      .find(b => b.complete && !b.destroyed);

    for (const warrior of raiding) {
      if (!targetBuilding) break;
      warrior.navigateTo(targetBuilding.x + randomFloat(-48, 48),
                         targetBuilding.y + randomFloat(-48, 48), () => {
        // Burn the building
        if (chance(0.4)) {
          targetBuilding.setOnFire();
          world.events?.emit('building_burning', { building: targetBuilding, attacker: warrior });
          world.events?.emit('log_event', {
            message: `🔥 ${warrior.name} set ${targetBuilding.displayName} on fire in ${defender.name}!`,
            importance: 'war', x: targetBuilding.x, y: targetBuilding.y
          });
        }

        // Fight defenders nearby
        const defender_ = world.spatialHash?.nearest(warrior.x, warrior.y, 200,
          e => e.type === 'human' && e.alive && e.villageId === defender.id);
        if (defender_) {
          warrior.startAttack?.(defender_, world);
          war.attackerLosses = war.attackerLosses || 0;
        }
      });
    }

    this.emit('raid', { war, attacker, defender, raiders: raiding });
  }

  _checkForNewConflicts(world) {
    if (!world.villages || world.villages.length < 2) return;

    for (let i = 0; i < world.villages.length; i++) {
      for (let j = i + 1; j < world.villages.length; j++) {
        const v1 = world.villages[i];
        const v2 = world.villages[j];

        if (this.atWar(v1.id, v2.id) || this.inTruce(v1.id, v2.id)) continue;

        const rel = this.getRelation(v1.id, v2.id);

        // Poor relations → possible war
        if (rel < CONFIG.combat.warDeclarationThreshold && chance(0.03)) {
          const resources = world.economy?.getVillageResources(v1.id, world.humans, world.buildingManager) || {};
          const hungry    = (resources.food || 0) < 20;
          const cause     = hungry ? 'food scarcity' : 'territorial dispute';
          this.declareWar(v1, v2, world, cause);
        }
      }
    }
  }

  _checkForPeace(war, world) {
    const attVillage = world.villages?.find(v => v.id === war.attackerId);
    const defVillage = world.villages?.find(v => v.id === war.defenderId);
    if (!attVillage || !defVillage) return;

    const attWarriors = world.humans?.filter(h =>
      h.alive && h.villageId === war.attackerId && h.job === JOBS.WARRIOR).length || 0;
    const defWarriors = world.humans?.filter(h =>
      h.alive && h.villageId === war.defenderId && h.job === JOBS.WARRIOR).length || 0;

    // War ends if one side has no warriors or after long conflict
    const daysSince = (world.timeSystem?.day || 0) - war.startDay;

    if (attWarriors === 0 || defWarriors === 0 || daysSince > 30 && chance(0.02)) {
      this._endWar(war, world, attWarriors === 0 ? war.defenderId : war.attackerId);
    }

    // Peace negotiations possible if both sides are weakened
    if (attWarriors < 3 && defWarriors < 3 && daysSince > 5 && chance(0.01)) {
      this._negotiatePeace(war, world);
    }
  }

  _negotiatePeace(war, world) {
    war.state = WAR_STATE.NEGOTIATING;

    world.events?.emit('log_event', {
      message: `🕊️ ${world.villages?.find(v=>v.id===war.attackerId)?.name} and ${world.villages?.find(v=>v.id===war.defenderId)?.name} are negotiating peace...`,
      importance: 'war'
    });

    // 60% chance peace is reached after negotiation
    setTimeout(() => {
      if (chance(0.6)) {
        this._endWar(war, world, null); // draw / peace treaty
      } else {
        war.state = WAR_STATE.ACTIVE;
        world.events?.emit('log_event', { message: '⚔️ Peace talks failed! War continues.', importance: 'war' });
      }
    }, 5000);
  }

  _endWar(war, world, winnerId) {
    war.state   = WAR_STATE.ENDED;
    war.winner  = winnerId;
    war.endDay  = world.timeSystem?.day || 0;
    this._activeWars.delete(war.id);

    // Establish truce
    const key = [war.attackerId, war.defenderId].sort().join(':');
    this._truce.set(key, Date.now() + 120_000); // 2 min real truce

    this.adjustRelation(war.attackerId, war.defenderId, +30);

    const attName = world.villages?.find(v => v.id === war.attackerId)?.name || 'Village';
    const defName = world.villages?.find(v => v.id === war.defenderId)?.name || 'Village';
    const msg = winnerId
      ? `🏳️ War ended! ${world.villages?.find(v=>v.id===winnerId)?.name} is victorious.`
      : `🤝 Peace treaty signed between ${attName} and ${defName}.`;

    world.events?.emit('war_ended', { war, winner: winnerId });
    world.events?.emit('log_event', { message: msg, importance: 'war' });
    this.emit('war_ended', { war });
  }

  // ─── External Commands ────────────────────────────────────────
  rallyWarriors(villageId, world) {
    const warriors = world.humans?.filter(h =>
      h.alive && h.villageId === villageId && h.job === JOBS.WARRIOR) || [];
    for (const w of warriors) {
      w.setState('patrol');
    }
  }

  fortifyVillage(villageId, world) {
    const builders = world.humans?.filter(h =>
      h.alive && h.villageId === villageId && h.job === JOBS.BUILDER) || [];
    // Queue a tower if not already pending
    const hasTower = world.buildingManager?.pendingProject(villageId);
    if (!hasTower && builders.length > 0) {
      const village = world.villages?.find(v => v.id === villageId);
      if (village) {
        world.buildingManager?.queueProject('tower',
          village.x + randomInt(-5,5) * 32,
          village.y + randomInt(-5,5) * 32,
          villageId);
      }
    }
  }

  // ─── Getters ─────────────────────────────────────────────────
  get activeWars() {
    return [...this._activeWars].map(id => this._wars.get(id)).filter(Boolean);
  }

  get warCount()  { return this._activeWars.size; }
  get isAtWar()   { return this._activeWars.size > 0; }

  warSummary() {
    return this.activeWars.map(w =>
      `${w.attackerId} vs ${w.defenderId} [day ${w.startDay}]: ${w.raidCount} raids`
    ).join('\n');
  }
}
