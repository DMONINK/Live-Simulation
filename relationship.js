// ============================================================
// relationship.js — Relationship Manager
//
// Tracks the relationship score between two NPCs (-100 to +100).
// Positive = allies/friends/lovers. Negative = enemies.
// Relationships evolve through interactions.
// ============================================================

import { clamp, uuid } from './utils.js';

// ─── Relationship Types ───────────────────────────────────────
export const REL_TYPES = {
  STRANGER:  'stranger',   //  0: no relationship
  ACQUAINT:  'acquaintance',
  FRIEND:    'friend',
  CLOSE:     'close_friend',
  LOVER:     'lover',
  SPOUSE:    'spouse',
  FAMILY:    'family',
  ALLY:      'ally',
  RIVAL:     'rival',
  ENEMY:     'enemy',
  NEMESIS:   'nemesis',
};

// ─── Relationship Events (score deltas) ───────────────────────
export const REL_EVENTS = {
  GAVE_FOOD:        +8,
  TRADED_FAIRLY:    +5,
  HELPED_IN_FIGHT:  +15,
  HEALED:           +12,
  GAVE_GIFT:        +7,
  COMPLIMENTED:     +3,
  CHATTED:          +1,
  JOINT_BUILD:      +6,
  SAVED_LIFE:       +30,
  MARRIED:          +50,
  HAD_CHILD:        +20,
  STOLE_FROM:       -20,
  ATTACKED:         -30,
  KILLED_FAMILY:    -60,
  BETRAYED:         -40,
  INSULTED:         -5,
  CHEATED_TRADE:    -15,
  REFUSED_HELP:     -8,
  MURDERED:         -80,
  DECLARED_WAR:     -50,
};

// ─── Individual Relationship ───────────────────────────────────
class Relationship {
  constructor(idA, idB) {
    this.idA     = idA;
    this.idB     = idB;
    this._score  = 0;    // Start as strangers
    this.history = [];   // Array of { event, delta, gameTime }
    this.type    = REL_TYPES.STRANGER;
    this.isMutual = true; // Set false for one-sided (e.g. secret crush)
  }

  get score() { return this._score; }

  set score(v) {
    this._score = clamp(v, -100, 100);
    this._updateType();
  }

  apply(event, delta, gameTime) {
    this._score = clamp(this._score + delta, -100, 100);
    this.history.push({ event, delta, gameTime });
    if (this.history.length > 30) this.history.shift(); // keep last 30
    this._updateType();
    return this._score;
  }

  _updateType() {
    const s = this._score;
    if (s >= 90)       this.type = REL_TYPES.NEMESIS; // actually enemy cap
    if (s >= 75)       this.type = REL_TYPES.SPOUSE;
    else if (s >= 55)  this.type = REL_TYPES.CLOSE;
    else if (s >= 30)  this.type = REL_TYPES.FRIEND;
    else if (s >= 10)  this.type = REL_TYPES.ACQUAINT;
    else if (s >= -20) this.type = REL_TYPES.STRANGER;
    else if (s >= -50) this.type = REL_TYPES.RIVAL;
    else if (s >= -75) this.type = REL_TYPES.ENEMY;
    else               this.type = REL_TYPES.NEMESIS;
  }

  isPositive()   { return this._score > 10; }
  isFriendly()   { return this._score > 30; }
  isLoverly()    { return this._score > 55; }
  isHostile()    { return this._score < -20; }
  isDangerous()  { return this._score < -50; }
  isNemesis()    { return this._score < -75; }
}

// ─── Relationship Manager ─────────────────────────────────────
export class RelationshipManager {
  constructor() {
    this._rels = new Map(); // "idA:idB" (sorted) → Relationship
  }

  _key(idA, idB) {
    // Sort IDs so A:B and B:A use the same key
    return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
  }

  _get(idA, idB) {
    const key = this._key(idA, idB);
    if (!this._rels.has(key)) this._rels.set(key, new Relationship(idA, idB));
    return this._rels.get(key);
  }

  /** Apply a relationship event between two entities */
  applyEvent(idA, idB, eventName, gameTime) {
    const delta = REL_EVENTS[eventName] ?? 0;
    const rel = this._get(idA, idB);
    rel.apply(eventName, delta, gameTime);
    return rel;
  }

  /** Manually set score (for initialization) */
  setScore(idA, idB, score) {
    this._get(idA, idB).score = score;
  }

  /** Get relationship score from A's perspective toward B */
  getScore(idA, idB) {
    return this._get(idA, idB).score;
  }

  /** Get the full relationship object */
  getRelationship(idA, idB) {
    return this._get(idA, idB);
  }

  /** Get type label string */
  getType(idA, idB) {
    return this._get(idA, idB).type;
  }

  /** Get all relationships for a given entity */
  allFor(id) {
    const result = [];
    for (const [, rel] of this._rels) {
      if (rel.idA === id || rel.idB === id) {
        const otherId = rel.idA === id ? rel.idB : rel.idA;
        result.push({ otherId, score: rel.score, type: rel.type });
      }
    }
    return result.sort((a, b) => b.score - a.score);
  }

  /** Get list of enemies (score < threshold) */
  enemies(id, threshold = -50) {
    return this.allFor(id).filter(r => r.score < threshold);
  }

  /** Get list of friends (score > threshold) */
  friends(id, threshold = 30) {
    return this.allFor(id).filter(r => r.score > threshold);
  }

  /** Get list of love interests (score > 55) */
  loveInterests(id) {
    return this.allFor(id).filter(r => r.score > 55);
  }

  /**
   * Build relationship summary for an AI prompt.
   * Returns text describing current relationship toward specific person.
   */
  toPromptBlock(selfId, otherId) {
    const rel = this._get(selfId, otherId);
    const s = rel.score;
    let desc;
    if (s >= 75)       desc = 'deeply bonded — this is your spouse/closest ally';
    else if (s >= 55)  desc = 'strong friendship — you trust and care for them';
    else if (s >= 30)  desc = 'friendly acquaintance';
    else if (s >= 10)  desc = 'neutral acquaintance';
    else if (s >= -20) desc = 'indifferent — barely know each other';
    else if (s >= -50) desc = 'uneasy tension — you dislike them';
    else if (s >= -75) desc = 'genuine enemy — you despise them';
    else               desc = 'nemesis — you hate them deeply';
    return `Relationship with them: ${desc} (score ${s}/100)`;
  }

  /** Village-level relationship: average score between two groups */
  groupScore(groupAIds, groupBIds) {
    if (!groupAIds.length || !groupBIds.length) return 0;
    let total = 0, count = 0;
    for (const a of groupAIds) {
      for (const b of groupBIds) {
        total += this.getScore(a, b);
        count++;
      }
    }
    return count > 0 ? total / count : 0;
  }

  get size() { return this._rels.size; }
}
