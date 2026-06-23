// ============================================================
// time.js — Day/Night Cycle & Season System
//
// Tracks in-game time: minute → hour → day → season → year.
// Emits events at dawn, dusk, midnight, season change, etc.
// Controls ambient light color and NPC schedule triggers.
// ============================================================

import { EventEmitter, lerpColor, clamp } from './utils.js';
import CONFIG from './config.js';

export const TIME_OF_DAY = {
  DAWN:      'dawn',       //  5-7
  MORNING:   'morning',    //  7-11
  NOON:      'noon',       // 11-14
  AFTERNOON: 'afternoon',  // 14-18
  EVENING:   'evening',    // 18-21
  NIGHT:     'night',      // 21-5
  MIDNIGHT:  'midnight',   // 23-1
};

// Ambient light colors for each hour (0-23)
const HOUR_COLORS = [
  0x000022, 0x000033, 0x000044, 0x000055, 0x001166, // 0-4 night
  0x112266, 0x334488, 0xFF8844, 0xFFCC88, 0xFFEEAA, // 5-9 dawn→morning
  0xFFFFCC, 0xFFFFF0, 0xFFFFFF, 0xFFFFF0, 0xFFFFCC, // 10-14 noon
  0xFFEEAA, 0xFFCC88, 0xFF9955, 0xFF7733, 0x885533, // 15-19 afternoon→evening
  0x443322, 0x221111, 0x110011, 0x000022, 0x000022, // 20-23 night
];

const HOUR_ALPHA = [   // darkness overlay alpha (0=bright, 1=pitch black)
  0.82, 0.85, 0.88, 0.90, 0.88,  // 0-4
  0.75, 0.55, 0.35, 0.15, 0.05,  // 5-9
  0.00, 0.00, 0.00, 0.00, 0.00,  // 10-14
  0.00, 0.05, 0.15, 0.30, 0.50,  // 15-19
  0.65, 0.75, 0.80, 0.82, 0.82,  // 20-23 (index 24 wraps)
];

export class TimeSystem extends EventEmitter {
  constructor() {
    super();
    this.gameMinute  = 0;            // Total elapsed game minutes
    this.hour        = CONFIG.time.startHour;
    this.minute      = 0;
    this.day         = 1;
    this.season      = 0;            // 0=Spring, 1=Summer, 2=Autumn, 3=Winter
    this.year        = 1;
    this._accumMs    = 0;            // Accumulated real milliseconds

    this._msPerMinute = CONFIG.time.secondsPerGameMinute * 1000;
    this._prevHour    = this.hour;
    this._prevDay     = this.day;
    this._prevSeason  = this.season;
  }

  /** Call with real delta time in milliseconds each frame */
  update(deltaMs) {
    const speed = CONFIG.simulation.gameSpeedMultiplier;
    this._accumMs += deltaMs * speed;

    while (this._accumMs >= this._msPerMinute) {
      this._accumMs -= this._msPerMinute;
      this._tickMinute();
    }
  }

  _tickMinute() {
    this.gameMinute++;
    this.minute++;

    if (this.minute >= 60) {
      this.minute = 0;
      this.hour   = (this.hour + 1) % 24;
      this._onHourChange();
    }
  }

  _onHourChange() {
    // Emit time-of-day events
    if (this.hour === 6)  this.emit('dawn',       { day: this.day, season: this.season });
    if (this.hour === 8)  this.emit('morning',     { day: this.day });
    if (this.hour === 12) this.emit('noon',        { day: this.day });
    if (this.hour === 18) this.emit('dusk',        { day: this.day });
    if (this.hour === 21) this.emit('evening',     { day: this.day });
    if (this.hour === 23) this.emit('midnight',    { day: this.day });

    // New day
    if (this.hour === 0) {
      this.day++;
      this._prevDay = this.day;
      this.emit('new_day', { day: this.day, season: this.seasonName });

      // New season
      if ((this.day - 1) % CONFIG.time.daysPerSeason === 0 && this.day > 1) {
        this._prevSeason = this.season;
        this.season = (this.season + 1) % 4;
        if (this.season === 0) {
          this.year++;
          this.emit('new_year', { year: this.year });
        }
        this.emit('new_season', { season: this.season, name: this.seasonName });
      }
    }
  }

  // ─── Accessors ──────────────────────────────────────────────
  get timeOfDay() {
    const h = this.hour;
    if (h >= 5  && h < 7)  return TIME_OF_DAY.DAWN;
    if (h >= 7  && h < 11) return TIME_OF_DAY.MORNING;
    if (h >= 11 && h < 14) return TIME_OF_DAY.NOON;
    if (h >= 14 && h < 18) return TIME_OF_DAY.AFTERNOON;
    if (h >= 18 && h < 21) return TIME_OF_DAY.EVENING;
    if (h >= 23 || h < 1)  return TIME_OF_DAY.MIDNIGHT;
    return TIME_OF_DAY.NIGHT;
  }

  get isDay()     { const h = this.hour; return h >= 6 && h < 20; }
  get isNight()   { return !this.isDay; }
  get isDawn()    { return this.hour === 6; }
  get isDusk()    { return this.hour >= 18 && this.hour < 21; }

  get seasonName()  { return CONFIG.time.seasons[this.season]; }
  get seasonIndex() { return this.season; }

  get isWinter()  { return this.season === 3; }
  get isSpring()  { return this.season === 0; }
  get isSummer()  { return this.season === 1; }
  get isAutumn()  { return this.season === 2; }

  /** 0–1 progress through the current hour */
  get minuteFraction() { return this.minute / 60; }

  /** Smooth 0–1 progress through the 24-hour day cycle */
  get dayFraction() { return (this.hour + this.minute / 60) / 24; }

  /**
   * Ambient light color for the current time.
   * Interpolates between hour colors for smooth transitions.
   */
  get ambientColor() {
    const h  = this.hour;
    const t  = this.minute / 60;
    const c1 = HOUR_COLORS[h];
    const c2 = HOUR_COLORS[(h + 1) % 24];
    return lerpColor(c1, c2, t);
  }

  /**
   * Night overlay alpha (0=day, 0.9=pitch black).
   */
  get nightAlpha() {
    const h  = this.hour;
    const t  = this.minute / 60;
    const a1 = HOUR_ALPHA[h];
    const a2 = HOUR_ALPHA[(h + 1) % 24];
    return clamp(a1 + (a2 - a1) * t, 0, 0.92);
  }

  /**
   * Multiplier for crop growth speed (0=winter/night, 1=summer noon)
   */
  get growthMultiplier() {
    if (this.isWinter) return 0.1;
    if (this.isNight)  return 0.2;
    const seasonBonus = [1.0, 1.3, 0.8, 0.1][this.season];
    return seasonBonus;
  }

  /**
   * Temperature factor 0-1 (affects weather, mood, etc.)
   */
  get temperature() {
    const base = [0.5, 0.9, 0.4, 0.0][this.season];
    // Warmer at midday
    const dayMod = Math.sin((this.dayFraction - 0.25) * Math.PI) * 0.2;
    return clamp(base + dayMod, 0, 1);
  }

  /** Formatted time string "Day 3, 14:30 (Summer)" */
  get displayString() {
    const hh = String(this.hour).padStart(2, '0');
    const mm = String(this.minute).padStart(2, '0');
    return `Day ${this.day}, ${hh}:${mm} — ${this.seasonName} Y${this.year}`;
  }
}
