// ============================================================
// weather.js — Weather System
//
// Manages weather states and transitions.
// Creates PixiJS particle effects for rain, snow, fog.
// Weather affects NPC mood, movement speed, crop growth.
// ============================================================

import { EventEmitter, randomFloat, randomInt, chance, clamp } from './utils.js';
import CONFIG from './config.js';

export const WEATHER = {
  CLEAR:  'clear',
  CLOUDY: 'cloudy',
  RAIN:   'rain',
  STORM:  'storm',
  SNOW:   'snow',
  FOG:    'fog',
};

// Weather transition table: [WEATHER] → probability of each next state
const TRANSITIONS = {
  [WEATHER.CLEAR]:  { clear: 0.60, cloudy: 0.35, fog: 0.05 },
  [WEATHER.CLOUDY]: { clear: 0.30, cloudy: 0.25, rain: 0.35, storm: 0.05, fog: 0.05 },
  [WEATHER.RAIN]:   { clear: 0.20, cloudy: 0.40, rain: 0.25, storm: 0.15 },
  [WEATHER.STORM]:  { cloudy: 0.35, rain: 0.50, storm: 0.15 },
  [WEATHER.SNOW]:   { clear: 0.30, snow: 0.60, cloudy: 0.10 },
  [WEATHER.FOG]:    { clear: 0.40, cloudy: 0.35, fog: 0.25 },
};

// Properties for each weather type
const WEATHER_PROPS = {
  [WEATHER.CLEAR]:  { movementMult: 1.0, moodMod:  0.2, cropMult: 1.0 },
  [WEATHER.CLOUDY]: { movementMult: 0.95,moodMod:  0.0, cropMult: 0.8 },
  [WEATHER.RAIN]:   { movementMult: 0.75,moodMod: -0.1, cropMult: 1.3 },
  [WEATHER.STORM]:  { movementMult: 0.50,moodMod: -0.3, cropMult: 0.5 },
  [WEATHER.SNOW]:   { movementMult: 0.60,moodMod: -0.1, cropMult: 0.1 },
  [WEATHER.FOG]:    { movementMult: 0.80,moodMod: -0.05,cropMult: 0.9 },
};

export class WeatherSystem extends EventEmitter {
  constructor(pixiApp) {
    super();
    this._app      = pixiApp;
    this.current   = WEATHER.CLEAR;
    this.intensity = 0.5;         // 0-1
    this._duration = 0;           // minutes until weather changes
    this._elapsed  = 0;
    this._particles = [];
    this._container = null;
    this._fogOverlay = null;
    this._cloudOverlay = null;
    this._initialized = false;

    this._scheduleChange();
  }

  init(container) {
    this._container = new PIXI.Container();
    container.addChild(this._container);

    // Fog overlay (semi-transparent grey rect covering viewport)
    this._fogOverlay = new PIXI.Graphics();
    this._fogOverlay.beginFill(0xCCCCCC, 0);
    this._fogOverlay.drawRect(0, 0, 4000, 4000);
    this._fogOverlay.endFill();
    container.addChild(this._fogOverlay);

    // Cloud / storm overlay
    this._cloudOverlay = new PIXI.Graphics();
    container.addChild(this._cloudOverlay);

    this._initialized = true;
  }

  update(deltaMs, timeSystem) {
    this._elapsed += deltaMs / 1000 / 60; // convert to game minutes

    if (this._elapsed >= this._duration) {
      this._transitionWeather(timeSystem);
    }

    this._updateParticles(deltaMs);
    this._updateOverlays();
  }

  _scheduleChange() {
    // Weather lasts 30–120 in-game minutes
    this._duration = randomInt(30, 120);
    this._elapsed  = 0;
  }

  _transitionWeather(timeSystem) {
    const table = { ...TRANSITIONS[this.current] };

    // Winter forces snow
    if (timeSystem?.isWinter) {
      table[WEATHER.SNOW]  = (table[WEATHER.SNOW]  || 0) + 0.4;
      table[WEATHER.CLEAR] = Math.max(0, (table[WEATHER.CLEAR] || 0) - 0.3);
    }

    // Normalize probabilities
    let sum = Object.values(table).reduce((a, b) => a + b, 0);
    let roll = Math.random() * sum;
    let next = WEATHER.CLEAR;
    for (const [w, p] of Object.entries(table)) {
      roll -= p;
      if (roll <= 0) { next = w; break; }
    }

    const prev = this.current;
    this.current   = next;
    this.intensity = randomFloat(0.4, 1.0);
    this._scheduleChange();

    if (prev !== next) {
      this.emit('change', { from: prev, to: next, intensity: this.intensity });
      this._spawnParticles();
    }
  }

  _spawnParticles() {
    if (!this._initialized) return;

    // Destroy old particles
    this._particles.forEach(p => p.sprite?.destroy());
    this._particles = [];
    this._container.removeChildren();

    const count = Math.floor(this.intensity * 200);

    if (this.current === WEATHER.RAIN || this.current === WEATHER.STORM) {
      for (let i = 0; i < count; i++) {
        this._particles.push(this._createRainDrop());
      }
    } else if (this.current === WEATHER.SNOW) {
      for (let i = 0; i < Math.floor(count * 0.5); i++) {
        this._particles.push(this._createSnowFlake());
      }
    }
  }

  _createRainDrop() {
    const g = new PIXI.Graphics();
    g.lineStyle(1, 0x88BBFF, 0.7);
    g.moveTo(0, 0);
    g.lineTo(-2, 12);
    const sprite = new PIXI.Sprite(this._app.renderer.generateTexture(g));
    g.destroy();
    sprite.anchor.set(0.5);
    sprite.x = randomFloat(0, 4000);
    sprite.y = randomFloat(-100, 4000);
    this._container.addChild(sprite);
    const drop = {
      sprite,
      type: 'rain',
      vy: randomFloat(8, 14) * (this.current === WEATHER.STORM ? 1.8 : 1),
      vx: randomFloat(-1, -3),
      reset: () => {
        sprite.x = randomFloat(0, 4000);
        sprite.y = -20;
      }
    };
    return drop;
  }

  _createSnowFlake() {
    const g = new PIXI.Graphics();
    g.beginFill(0xFFFFFF, 0.85);
    g.drawCircle(0, 0, randomFloat(1.5, 3));
    g.endFill();
    const sprite = new PIXI.Sprite(this._app.renderer.generateTexture(g));
    g.destroy();
    sprite.anchor.set(0.5);
    sprite.x = randomFloat(0, 4000);
    sprite.y = randomFloat(-100, 4000);
    this._container.addChild(sprite);
    const flake = {
      sprite,
      type: 'snow',
      vy: randomFloat(0.5, 2),
      vx: randomFloat(-1, 1),
      wobble: randomFloat(0, Math.PI * 2),
      wobbleSpeed: randomFloat(0.02, 0.06),
      reset: () => {
        sprite.x = randomFloat(0, 4000);
        sprite.y = -10;
      }
    };
    return flake;
  }

  _updateParticles(deltaMs) {
    if (!this._initialized) return;
    const dt = deltaMs / 16.67; // normalize to 60fps

    for (const p of this._particles) {
      if (p.type === 'rain') {
        p.sprite.x += p.vx * dt;
        p.sprite.y += p.vy * dt;
        if (p.sprite.y > 4100 || p.sprite.x < -50) p.reset();
      } else if (p.type === 'snow') {
        p.wobble += p.wobbleSpeed * dt;
        p.sprite.x += Math.sin(p.wobble) * 0.5 + p.vx * 0.3 * dt;
        p.sprite.y += p.vy * dt;
        if (p.sprite.y > 4100) p.reset();
      }
    }
  }

  _updateOverlays() {
    if (!this._fogOverlay) return;

    const fogAlpha = this.current === WEATHER.FOG
      ? this.intensity * 0.55 : 0;
    this._fogOverlay.alpha = fogAlpha;

    const cloudAlpha = this.current === WEATHER.CLOUDY ? 0.12
      : this.current === WEATHER.RAIN ? 0.20
      : this.current === WEATHER.STORM ? 0.35 : 0;
    this._cloudOverlay.alpha = cloudAlpha;
  }

  // ─── Resize particle viewport ──────────────────────────────────
  resizeParticles(vpW, vpH) {
    // Move particle container to match screen position
  }

  // ─── Property Accessors ───────────────────────────────────────
  get props()            { return WEATHER_PROPS[this.current]; }
  get movementMult()     { return this.props.movementMult; }
  get moodModifier()     { return this.props.moodMod * this.intensity; }
  get cropMultiplier()   { return this.props.cropMult; }
  get isStormy()         { return this.current === WEATHER.STORM; }
  get isRaining()        { return this.current === WEATHER.RAIN || this.current === WEATHER.STORM; }
  get isSnowing()        { return this.current === WEATHER.SNOW; }
  get isFoggy()          { return this.current === WEATHER.FOG; }
  get visibility()       {
    // 0-1 how far NPCs can see (affects guard range, combat range)
    if (this.isFoggy) return 0.4;
    if (this.current === WEATHER.STORM) return 0.6;
    return 1.0;
  }
  get displayName() {
    const names = {
      clear:'Clear ☀', cloudy:'Cloudy ⛅', rain:'Rain 🌧',
      storm:'Storm ⛈', snow:'Snow ❄', fog:'Fog 🌫'
    };
    return names[this.current] || this.current;
  }
}
