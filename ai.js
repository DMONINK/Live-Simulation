// ============================================================
// ai.js — AI Decision Engine
//
// Calls Gemini / Groq / OpenRouter for IMPORTANT NPC decisions.
// Never called every frame — only for dramatic, life-changing moments.
//
// Events that trigger AI:
//   - betrayal, murder of loved one, war declaration
//   - marriage proposal, revenge opportunity
//   - major resource loss, village crisis
//   - strategic choices (attack / flee / negotiate)
// ============================================================

import CONFIG from './config.js';
import { PriorityQueue } from './utils.js';

// ─── Response Parser ──────────────────────────────────────────
function parseAIResponse(text) {
  // AI responses are expected in this JSON format:
  // { "goal": "...", "emotion": "...", "reason": "...", "next_action": "..." }
  // Try JSON parse first, then fall back to regex extraction
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (_) {}

  // Fallback: extract fields with regex
  const extract = (key) => {
    const m = text.match(new RegExp(`"?${key}"?\\s*:\\s*"([^"]+)"`));
    return m ? m[1] : null;
  };
  return {
    goal:        extract('goal')        || 'survive',
    emotion:     extract('emotion')     || 'neutral',
    reason:      extract('reason')      || text.slice(0, 120),
    next_action: extract('next_action') || 'wander',
  };
}

// ─── Provider Adapters ────────────────────────────────────────
const providers = {

  gemini: async (prompt) => {
    const { apiKey, model, endpoint } = CONFIG.gemini;
    if (!apiKey) throw new Error('Gemini API key missing');
    const url = `${endpoint}/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 512 }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Gemini error');
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  },

  groq: async (prompt) => {
    const { apiKey, model, endpoint } = CONFIG.groq;
    if (!apiKey) throw new Error('Groq API key missing');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.85,
        max_tokens: 512
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Groq error');
    return data.choices?.[0]?.message?.content ?? '';
  },

  openrouter: async (prompt) => {
    const { apiKey, model, endpoint } = CONFIG.openrouter;
    if (!apiKey) throw new Error('OpenRouter API key missing');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://ai-civilization-sim.local',
        'X-Title': 'AI Civilization Simulation'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.85,
        max_tokens: 512
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'OpenRouter error');
    return data.choices?.[0]?.message?.content ?? '';
  },
};

// ─── AI Manager ───────────────────────────────────────────────
export class AIManager {
  constructor(onDecision, onError) {
    this._queue       = new PriorityQueue();
    this._lastCallTime = 0;
    this._isProcessing = false;
    this._cooldown     = CONFIG.simulation.aiCallCooldownMs;
    this._onDecision   = onDecision; // callback(taskId, result, context)
    this._onError      = onError;    // callback(error, context)
    this._stats        = { calls: 0, successes: 0, failures: 0, fallbacks: 0 };
    this._useAI        = true; // Disable if no API keys configured
    this._checkKeys();
  }

  _checkKeys() {
    const p = CONFIG.provider;
    if (!CONFIG[p]?.apiKey) {
      console.warn(`[AI] No API key for provider "${p}". Will use local fallback decisions.`);
      this._useAI = false;
    }
  }

  /**
   * Queue an AI decision request.
   * @param {string}   taskId    - Unique ID (e.g., human.id + ':betrayal')
   * @param {string}   prompt    - Full narrative prompt to send
   * @param {Object}   context   - Additional data passed to callback
   * @param {number}   priority  - Lower = higher priority (0=urgent, 10=low)
   */
  queue(taskId, prompt, context, priority = 5) {
    if (!this._useAI) {
      // Use local fallback immediately
      const result = this._localFallback(context);
      this._onDecision(taskId, result, context);
      this._stats.fallbacks++;
      return;
    }
    this._queue.push(priority, { taskId, prompt, context });
    if (!this._isProcessing) this._processNext();
  }

  async _processNext() {
    if (this._isProcessing || this._queue.size === 0) return;

    const now = performance.now();
    const sinceLastCall = now - this._lastCallTime;
    if (sinceLastCall < this._cooldown) {
      setTimeout(() => this._processNext(), this._cooldown - sinceLastCall);
      return;
    }

    this._isProcessing = true;
    const task = this._queue.pop();

    try {
      const callFn = providers[CONFIG.provider];
      if (!callFn) throw new Error(`Unknown provider: ${CONFIG.provider}`);

      const rawText = await callFn(task.prompt);
      const result  = parseAIResponse(rawText);
      this._lastCallTime = performance.now();
      this._stats.calls++;
      this._stats.successes++;

      console.log(`[AI] Decision for "${task.taskId}":`, result);
      this._onDecision(task.taskId, result, task.context);

    } catch (err) {
      this._stats.failures++;
      console.warn(`[AI] Error (${err.message}). Using local fallback.`);
      const result = this._localFallback(task.context);
      this._onDecision(task.taskId, result, task.context);
      if (this._onError) this._onError(err, task.context);

    } finally {
      this._isProcessing = false;
      if (this._queue.size > 0) {
        setTimeout(() => this._processNext(), 200);
      }
    }
  }

  /**
   * Local decision fallback — uses personality traits to simulate
   * a decision without hitting the AI API.
   */
  _localFallback(context) {
    const p = context?.personality || {};
    const bravery    = p.bravery   ?? 50;
    const kindness   = p.kindness  ?? 50;
    const greed      = p.greed     ?? 50;
    const morality   = p.morality  ?? 50;
    const triggerType = context?.triggerType || 'unknown';

    // Decision logic based on personality traits
    if (triggerType === 'betrayal') {
      if (bravery > 70 && morality < 50) {
        return { goal: 'revenge', emotion: 'anger',
          reason: 'High bravery and low morality drive a desire for retaliation.',
          next_action: 'confront_enemy' };
      }
      if (kindness > 70) {
        return { goal: 'forgive', emotion: 'sadness',
          reason: 'High kindness makes forgiveness feel right, though painful.',
          next_action: 'seek_distance' };
      }
      return { goal: 'avoid', emotion: 'fear',
        reason: 'Self-preservation takes priority.',
        next_action: 'flee' };
    }

    if (triggerType === 'war_declaration') {
      if (bravery > 60 && greed > 50) {
        return { goal: 'attack', emotion: 'anger',
          reason: 'Aggression and desire for resources fuel the attack.',
          next_action: 'rally_warriors' };
      }
      return { goal: 'defend', emotion: 'fear',
        reason: 'Defensive posture to protect the village.',
        next_action: 'fortify' };
    }

    if (triggerType === 'marriage_proposal') {
      if (kindness > 60) {
        return { goal: 'accept', emotion: 'love',
          reason: 'Love and kindness make this feel right.',
          next_action: 'accept_proposal' };
      }
      if (greed > 70) {
        return { goal: 'negotiate', emotion: 'surprise',
          reason: 'Greed suggests asking for more resources first.',
          next_action: 'negotiate_terms' };
      }
      return { goal: 'decline', emotion: 'fear',
        reason: 'Not ready for commitment.',
        next_action: 'decline_gently' };
    }

    // Generic fallback
    return { goal: 'survive', emotion: 'neutral',
      reason: 'Cautious decision to ensure survival.',
      next_action: 'wander' };
  }

  /** Build a complete narrative prompt for an NPC decision */
  static buildPrompt(human, triggerType, targetHuman, memories, relationshipText, extras = '') {
    const p = human.personality;
    return `You are roleplaying as ${human.name}, a ${human.age}-year-old ${human.gender} in a medieval civilization simulation.

PERSONALITY TRAITS (each out of 100):
  Kindness: ${p.kindness}  Bravery: ${p.bravery}  Greed: ${p.greed}
  Morality: ${p.morality}  Intelligence: ${p.intelligence}  Strength: ${p.strength}

CURRENT STATE:
  Health: ${human.health}/100  Hunger: ${human.hunger}/100  Gold: ${human.gold}
  Job: ${human.job}  Village: ${human.villageName || 'none'}
  Current emotion: ${human.currentEmotion || 'neutral'}

SIGNIFICANT MEMORIES:
${memories}

${relationshipText ? 'RELATIONSHIP:\n' + relationshipText + '\n' : ''}
SITUATION:
${extras}

CRITICAL DECISION — ${triggerType.replace(/_/g,' ').toUpperCase()}:
What would ${human.name} realistically choose to do given their personality and past experiences?

Respond ONLY with a single JSON object on one line:
{"goal":"...","emotion":"...","reason":"...","next_action":"..."}

The "next_action" must be one of: confront_enemy, flee, forgive, seek_revenge, trade, rally_warriors, fortify, accept_proposal, decline_gently, negotiate_terms, wander, seek_help, mourn, celebrate.`;
  }

  get stats() { return { ...this._stats }; }
  get queueSize() { return this._queue.size; }
  get isActive() { return this._useAI; }
}
