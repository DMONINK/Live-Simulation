// ============================================================
// utils.js — Shared utility classes and math helpers
// ============================================================

// ─── UUID Generator ───────────────────────────────────────────
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Math Helpers ─────────────────────────────────────────────
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const lerp  = (a, b, t)    => a + (b - a) * t;
export const dist  = (x1,y1,x2,y2) => Math.hypot(x2-x1, y2-y1);
export const dist2 = (x1,y1,x2,y2) => (x2-x1)**2 + (y2-y1)**2;
export const randomInt   = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const randomFloat = (min, max) => Math.random() * (max - min) + min;
export const randomSign  = ()         => Math.random() < 0.5 ? -1 : 1;
export const randomElement = arr      => arr[Math.floor(Math.random() * arr.length)];
export const chance = (pct)           => Math.random() < pct;     // chance(0.3) = 30% true

/** Normalize angle to 0-2π */
export const normalizeAngle = a => ((a % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);

/** Angle from point A to point B */
export const angleTo = (x1,y1,x2,y2) => Math.atan2(y2-y1, x2-x1);

/** Move toward target, return new position */
export function moveToward(x, y, tx, ty, speed) {
  const d = dist(x, y, tx, ty);
  if (d < speed) return { x: tx, y: ty, arrived: true };
  const ratio = speed / d;
  return { x: x + (tx - x) * ratio, y: y + (ty - y) * ratio, arrived: false };
}

/** Blend two hex colors by factor t (0=a, 1=b) */
export function lerpColor(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return ((lerp(ar,br,t)|0) << 16) | ((lerp(ag,bg,t)|0) << 8) | (lerp(ab,bb,t)|0);
}

// ─── Perlin Noise ─────────────────────────────────────────────
/**
 * Classic Perlin Noise 2D — no external library needed.
 * Used for terrain generation, weather, and organic movement.
 */
export class PerlinNoise {
  constructor(seed = 0) {
    this.perm = new Uint8Array(512);
    this._buildPermutation(seed);
  }

  _buildPermutation(seed) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    // Seeded shuffle (LCG)
    let s = (seed * 1664525 + 1013904223) >>> 0;
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  _fade(t)      { return t * t * t * (t * (t * 6 - 15) + 10); }
  _lerp(a,b,t)  { return a + t * (b - a); }
  _grad(h,x,y)  {
    switch (h & 3) {
      case 0: return  x + y;
      case 1: return -x + y;
      case 2: return  x - y;
      case 3: return -x - y;
    }
  }

  /** Returns noise value in [-1, 1] */
  noise2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this._fade(x), v = this._fade(y);
    const a  = this.perm[X]   + Y, b  = this.perm[X+1] + Y;
    return this._lerp(
      this._lerp(this._grad(this.perm[a],   x,   y),
                 this._grad(this.perm[b],   x-1, y),   u),
      this._lerp(this._grad(this.perm[a+1], x,   y-1),
                 this._grad(this.perm[b+1], x-1, y-1), u),
      v
    );
  }

  /**
   * Fractional Brownian Motion — layered noise for terrain.
   * @param {number} x
   * @param {number} y
   * @param {number} octaves   Number of layers
   * @param {number} persistence Amplitude falloff per octave (0–1)
   * @param {number} lacunarity  Frequency growth per octave (>1)
   * @returns {number} value roughly in [0, 1]
   */
  fbm(x, y, octaves = 6, persistence = 0.5, lacunarity = 2.0) {
    let value = 0, amplitude = 1, frequency = 1, maxVal = 0;
    for (let i = 0; i < octaves; i++) {
      value    += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxVal   += amplitude;
      amplitude  *= persistence;
      frequency  *= lacunarity;
    }
    return (value / maxVal + 1) * 0.5; // normalize to [0,1]
  }
}

// ─── Event Emitter ────────────────────────────────────────────
/**
 * Lightweight pub/sub for cross-system communication.
 * Usage: emitter.on('war_declared', handler)
 *        emitter.emit('war_declared', { attacker, defender })
 */
export class EventEmitter {
  constructor() { this._listeners = new Map(); }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return () => this.off(event, fn); // returns unsubscribe fn
  }

  off(event, fn) {
    const arr = this._listeners.get(event);
    if (arr) this._listeners.set(event, arr.filter(f => f !== fn));
  }

  emit(event, data) {
    const arr = this._listeners.get(event);
    if (arr) arr.forEach(fn => fn(data));
  }

  once(event, fn) {
    const wrapper = data => { fn(data); this.off(event, wrapper); };
    this.on(event, wrapper);
  }
}

// ─── Object Pool ──────────────────────────────────────────────
/**
 * Recycles objects to avoid garbage collection spikes.
 * Critical for particles and tile sprites.
 */
export class ObjectPool {
  constructor(factory, reset, initialSize = 50) {
    this._factory = factory;
    this._reset = reset;
    this._pool = [];
    for (let i = 0; i < initialSize; i++) this._pool.push(factory());
  }

  acquire(...args) {
    const obj = this._pool.length > 0 ? this._pool.pop() : this._factory();
    if (this._reset) this._reset(obj, ...args);
    return obj;
  }

  release(obj) {
    this._pool.push(obj);
  }
}

// ─── Priority Queue ───────────────────────────────────────────
/** Min-heap used for AI task scheduling */
export class PriorityQueue {
  constructor() { this._heap = []; }

  push(priority, value) {
    this._heap.push({ priority, value });
    this._bubbleUp(this._heap.length - 1);
  }

  pop() {
    if (this._heap.length === 0) return null;
    const top = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._sinkDown(0);
    }
    return top.value;
  }

  get size() { return this._heap.length; }

  _bubbleUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._heap[p].priority <= this._heap[i].priority) break;
      [this._heap[p], this._heap[i]] = [this._heap[i], this._heap[p]];
      i = p;
    }
  }

  _sinkDown(i) {
    const n = this._heap.length;
    while (true) {
      let min = i, l = 2*i+1, r = 2*i+2;
      if (l < n && this._heap[l].priority < this._heap[min].priority) min = l;
      if (r < n && this._heap[r].priority < this._heap[min].priority) min = r;
      if (min === i) break;
      [this._heap[i], this._heap[min]] = [this._heap[min], this._heap[i]];
      i = min;
    }
  }
}

// ─── Direction helpers ────────────────────────────────────────
export const DIRS = {
  N:  { dx: 0, dy: -1 },
  NE: { dx: 1, dy: -1 },
  E:  { dx: 1, dy:  0 },
  SE: { dx: 1, dy:  1 },
  S:  { dx: 0, dy:  1 },
  SW: { dx:-1, dy:  1 },
  W:  { dx:-1, dy:  0 },
  NW: { dx:-1, dy: -1 },
};
export const ALL_DIRS = Object.values(DIRS);

/** Simple path toward target avoiding direct obstacles */
export function stepToward(x, y, tx, ty) {
  const dx = Math.sign(tx - x);
  const dy = Math.sign(ty - y);
  return { dx, dy };
}

// ─── Color helpers ────────────────────────────────────────────
export function hexToRgb(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

export function rgbToHex(r, g, b) {
  return ((r << 16) | (g << 8) | b);
}

/** Create a slightly randomized version of a color for terrain variety */
export function jitterColor(hex, amount = 15) {
  const { r, g, b } = hexToRgb(hex);
  const jr = clamp(r + randomInt(-amount, amount), 0, 255);
  const jg = clamp(g + randomInt(-amount, amount), 0, 255);
  const jb = clamp(b + randomInt(-amount, amount), 0, 255);
  return rgbToHex(jr, jg, jb);
}
