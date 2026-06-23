// ============================================================
// memory.js — NPC Memory System
//
// Every human stores episodic memories of significant events.
// Memories influence decisions, AI prompts, and emotions.
// High-importance memories persist; trivial ones fade over time.
// ============================================================

import { uuid, clamp } from './utils.js';
import CONFIG from './config.js';

// ─── Memory Emotions ──────────────────────────────────────────
export const EMOTIONS = {
  JOY: 'joy',
  SADNESS: 'sadness',
  ANGER: 'anger',
  FEAR: 'fear',
  DISGUST: 'disgust',
  SURPRISE: 'surprise',
  LOVE: 'love',
  GRIEF: 'grief',
  GRATITUDE: 'gratitude',
  BETRAYAL: 'betrayal',
  PRIDE: 'pride',
  SHAME: 'shame',
  CONTEMPT: 'contempt',
};

// ─── Memory Class ─────────────────────────────────────────────
export class Memory {
  /**
   * @param {Object} opts
   * @param {string}   opts.event       - Short description of what happened
   * @param {number}   opts.importance  - 1 (trivial) to 10 (life-changing)
   * @param {string}   opts.emotion     - EMOTIONS value
   * @param {number}   opts.gameTime    - In-game time (minutes since start)
   * @param {string[]} opts.people      - IDs of people involved
   * @param {Object}   opts.location    - { x, y } tile coords of event
   * @param {string}   [opts.tag]       - Category: 'combat','love','trade','death'...
   */
  constructor({ event, importance, emotion, gameTime, people = [], location = null, tag = 'general' }) {
    this.id         = uuid();
    this.event      = event;
    this.importance = clamp(importance, 1, 10);
    this.emotion    = emotion;
    this.gameTime   = gameTime;
    this.people     = people;
    this.location   = location;
    this.tag        = tag;
    this.recalled   = 0;     // How many times this memory has been accessed
  }

  /** Human-readable timestamp */
  timeStr(currentGameTime) {
    const diff = currentGameTime - this.gameTime;
    if (diff < 60)   return 'just now';
    if (diff < 1440) return `${Math.floor(diff / 60)} hours ago`;
    return `${Math.floor(diff / 1440)} days ago`;
  }

  /** Format for AI prompt inclusion */
  toPromptString(currentGameTime) {
    return `"${this.event}" (${this.timeStr(currentGameTime)}, feeling ${this.emotion}, importance ${this.importance}/10)`;
  }

  /** Decay importance over time — important memories last longer */
  decay(rate) {
    // High-importance memories decay slower
    const factor = 1 - (this.importance / 10) * 0.8;
    this.importance -= rate * factor;
  }
}

// ─── Memory System ────────────────────────────────────────────
export class MemorySystem {
  constructor(maxMemories = CONFIG.simulation.maxMemoriesPerHuman) {
    this._memories  = [];
    this._maxSize   = maxMemories;
  }

  /** Add a new memory. Automatically prunes least important if over limit. */
  remember(opts) {
    const mem = new Memory(opts);
    this._memories.push(mem);

    // Trim if over capacity — remove lowest-importance memories
    if (this._memories.length > this._maxSize) {
      this._memories.sort((a, b) => b.importance - a.importance);
      this._memories.length = this._maxSize;
    }
    return mem;
  }

  /** Age all memories — low-importance ones eventually fade away */
  decay(currentGameTime) {
    const rate = CONFIG.simulation.memoryDecayRate;
    this._memories.forEach(m => m.decay(rate));
    this._memories = this._memories.filter(m => m.importance > 0.5);
  }

  /** Retrieve memories involving a specific person */
  aboutPerson(personId) {
    return this._memories
      .filter(m => m.people.includes(personId))
      .sort((a, b) => b.importance - a.importance);
  }

  /** Retrieve memories with a specific tag */
  byTag(tag) {
    return this._memories.filter(m => m.tag === tag)
      .sort((a, b) => b.importance - a.importance);
  }

  /** Get memories with importance above threshold */
  important(threshold = 6) {
    return this._memories
      .filter(m => m.importance >= threshold)
      .sort((a, b) => b.importance - a.importance);
  }

  /** Get most recent N memories */
  recent(n = 5) {
    return [...this._memories]
      .sort((a, b) => b.gameTime - a.gameTime)
      .slice(0, n);
  }

  /** Get ALL memories sorted by importance then time */
  all() {
    return [...this._memories].sort((a, b) =>
      b.importance - a.importance || b.gameTime - a.gameTime
    );
  }

  /**
   * Build a narrative summary for the AI prompt.
   * Returns the top N most important/recent memories as text.
   */
  toPromptBlock(currentGameTime, maxCount = 8) {
    const top = this.all().slice(0, maxCount);
    if (top.length === 0) return 'No significant memories.';
    return top.map(m => `• ${m.toPromptString(currentGameTime)}`).join('\n');
  }

  /**
   * Check if any memory of high importance (≥ threshold) involves a given person.
   * Used to decide whether an AI call is warranted when meeting someone.
   */
  hasStrongMemoryOf(personId, threshold = 7) {
    return this._memories.some(m =>
      m.people.includes(personId) && m.importance >= threshold
    );
  }

  /**
   * Net emotional balance toward a person from memories.
   * Negative = mostly bad memories, Positive = mostly good.
   */
  emotionalBalance(personId) {
    const positive = new Set([EMOTIONS.JOY, EMOTIONS.LOVE, EMOTIONS.GRATITUDE, EMOTIONS.PRIDE]);
    const negative = new Set([EMOTIONS.ANGER, EMOTIONS.FEAR, EMOTIONS.GRIEF,
                               EMOTIONS.BETRAYAL, EMOTIONS.DISGUST, EMOTIONS.CONTEMPT]);
    let score = 0;
    this._memories.filter(m => m.people.includes(personId)).forEach(m => {
      if (positive.has(m.emotion))  score += m.importance;
      if (negative.has(m.emotion))  score -= m.importance;
    });
    return score;
  }

  get count() { return this._memories.length; }
}
