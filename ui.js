// ============================================================
// ui.js — User Interface
//
// HTML-based HUD overlaid on the PixiJS canvas.
// Panels: top stats bar, event log, entity inspector,
// time/weather display, mini-controls, speed controls.
// ============================================================

import CONFIG from './config.js';
import { JOBS } from './human.js';
import { ANIMAL_TYPES } from './animal.js';

export class UI {
  constructor(world, camera) {
    this._world   = world;
    this._camera  = camera;
    this._selected = null;  // currently inspected entity
    this._updateTimer = 0;
    this._UPDATE_INTERVAL = 0.25; // seconds between UI refreshes

    this._buildDOM();
    this._attachCanvasEvents();
  }

  // ── DOM Construction ─────────────────────────────────────────
  _buildDOM() {
    // Remove any existing UI
    document.getElementById('civ-ui')?.remove();

    const ui = document.createElement('div');
    ui.id = 'civ-ui';
    ui.innerHTML = `
      <!-- TOP BAR -->
      <div id="ui-topbar">
        <div id="ui-time" class="ui-panel">🕐 Loading...</div>
        <div id="ui-weather" class="ui-panel">⛅ ...</div>
        <div id="ui-stats" class="ui-panel">👥 ...</div>
        <div id="ui-wars" class="ui-panel">⚔️ Peace</div>
        <div id="ui-ai" class="ui-panel">🤖 AI: —</div>
        <div id="ui-fps" class="ui-panel">FPS: —</div>
      </div>

      <!-- EVENT LOG -->
      <div id="ui-log-panel" class="ui-panel">
        <div id="ui-log-title">📜 Event Log</div>
        <div id="ui-log-entries"></div>
      </div>

      <!-- INSPECTOR (hidden until entity clicked) -->
      <div id="ui-inspector" class="ui-panel hidden">
        <div id="ui-inspector-close" onclick="document.getElementById('ui-inspector').classList.add('hidden')">✕</div>
        <div id="ui-inspector-content"></div>
      </div>

      <!-- VILLAGE PANEL -->
      <div id="ui-villages" class="ui-panel">
        <div id="ui-villages-title">🏘️ Villages</div>
        <div id="ui-villages-list"></div>
      </div>

      <!-- CONTROLS -->
      <div id="ui-controls" class="ui-panel">
        <div style="font-size:10px;margin-bottom:4px;opacity:0.7">CONTROLS</div>
        <div style="font-size:10px;line-height:1.6">
          🖱️ Right-drag: Pan<br>
          🖱️ Scroll: Zoom<br>
          ⌨️ WASD/Arrows: Pan<br>
          🖱️ Click: Inspect<br>
          1/2/3: Zoom preset<br>
          ESC: Unfollow
        </div>
        <div id="ui-speed-ctrl" style="margin-top:8px">
          <div style="font-size:10px;margin-bottom:4px;opacity:0.7">SPEED</div>
          <button onclick="window.__civSetSpeed(0.5)">½×</button>
          <button onclick="window.__civSetSpeed(1)">1×</button>
          <button onclick="window.__civSetSpeed(2)">2×</button>
          <button onclick="window.__civSetSpeed(4)">4×</button>
          <button onclick="window.__civTogglePause()">⏸</button>
        </div>
      </div>

      <!-- ECONOMY TICKER (bottom) -->
      <div id="ui-economy" class="ui-panel">
        <span id="ui-economy-ticker">📦 Market loading...</span>
      </div>
    `;
    document.body.appendChild(ui);
  }

  _attachCanvasEvents() {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    canvas.addEventListener('click', (e) => {
      const rect   = canvas.getBoundingClientRect();
      const sx     = e.clientX - rect.left;
      const sy     = e.clientY - rect.top;
      const world_ = this._camera.screenToWorld(sx, sy);
      const hit    = this._world.getEntityAt(world_.x, world_.y, 32);

      if (hit) {
        this._selected = hit.entity;
        this._showInspector(hit);
        if (e.shiftKey) this._camera.follow(hit.entity);
      } else {
        this._selected = null;
        document.getElementById('ui-inspector')?.classList.add('hidden');
      }
    });
  }

  // ── Per-frame update ─────────────────────────────────────────
  update(dt, fps) {
    this._updateTimer += dt;
    if (this._updateTimer < this._UPDATE_INTERVAL) return;
    this._updateTimer = 0;

    const w = this._world;
    const t = w.timeSystem;

    // Time
    this._setText('ui-time', `🕐 ${t.displayString}`);

    // Weather
    this._setText('ui-weather', w.weatherSystem.displayName);

    // Population stats
    const alive   = w.livingHumans.length;
    const animals = w.livingAnimals.length;
    this._setText('ui-stats', `👥 ${alive} humans · 🐾 ${animals} animals`);

    // Wars
    const wars = w.warSystem.activeWars;
    const warEl = document.getElementById('ui-wars');
    if (warEl) {
      warEl.textContent = wars.length > 0
        ? `⚔️ ${wars.length} WAR${wars.length > 1 ? 'S' : ''}`
        : '🕊️ Peace';
      warEl.style.color = wars.length > 0 ? '#ff6b6b' : '#a8ff78';
    }

    // AI stats
    const ai = w.aiManager;
    this._setText('ui-ai', `🤖 AI: ${ai.stats.successes}/${ai.stats.calls} (q:${ai.queueSize})`);

    // FPS
    this._setText('ui-fps', `FPS: ${Math.round(fps)}`);

    // Event log
    this._updateLog();

    // Villages
    this._updateVillages();

    // Economy ticker
    this._updateEconomy();

    // Inspector (if entity selected)
    if (this._selected) {
      this._refreshInspector();
    }
  }

  _updateLog() {
    const container = document.getElementById('ui-log-entries');
    if (!container) return;

    const entries = this._world.eventLog.slice(0, 15);
    container.innerHTML = entries.map(e => {
      const colorMap = {
        war:      '#ff6b6b',
        death:    '#ff9ff3',
        ai:       '#54a0ff',
        social:   '#feca57',
        build:    '#1dd1a1',
        info:     '#c8d6e5',
        warning:  '#ff9f43',
        time:     '#a29bfe',
      };
      const color = colorMap[e.importance] || '#c8d6e5';
      return `<div class="log-entry" style="color:${color}">${e.message}</div>`;
    }).join('');
  }

  _updateVillages() {
    const container = document.getElementById('ui-villages-list');
    if (!container) return;

    container.innerHTML = this._world.villages.map(v => {
      const pop      = v.population;
      const atWar    = this._world.warSystem.atWar(v.id, '*');
      const relations = this._world.villages
        .filter(other => other.id !== v.id)
        .map(other => {
          const score = this._world.warSystem.getRelation(v.id, other.id);
          return `${other.name}: ${score > 20 ? '🤝' : score < -30 ? '😤' : '😐'} (${score})`;
        }).join(' | ');

      return `
        <div class="village-entry" onclick="window.__civFocusVillage('${v.id}')">
          <strong>${v.name}</strong>
          <span class="vstat">👥 ${pop}</span>
          <div class="vrel">${relations}</div>
        </div>`;
    }).join('');
  }

  _updateEconomy() {
    const ticker = document.getElementById('ui-economy-ticker');
    if (!ticker) return;
    const table = this._world.economy.getPriceTable();
    ticker.textContent = table.map(r =>
      `${r.resource[0].toUpperCase()}${r.resource.slice(1)}: ${r.price}g ${r.trend}`
    ).join('  •  ');
  }

  // ── Inspector Panel ──────────────────────────────────────────
  _showInspector(hit) {
    const panel = document.getElementById('ui-inspector');
    if (!panel) return;
    panel.classList.remove('hidden');
    this._refreshInspector();
  }

  _refreshInspector() {
    if (!this._selected) return;
    const el  = document.getElementById('ui-inspector-content');
    if (!el)  return;

    const e = this._selected;

    if (e.type === 'human') {
      const relMgr = this._world.relationshipManager;
      const friends = relMgr.friends(e.id, 30);
      const enemies = relMgr.enemies(e.id, -30);
      const mems    = e.memory?.recent(5) || [];

      el.innerHTML = `
        <div class="insp-name">${e.name}</div>
        <div class="insp-sub">${e.age}y ${e.gender} · ${e.job} · ${e.villageName}</div>
        <div class="insp-row">❤️ ${Math.round(e.health)}/${e.maxHealth} · 🍞 ${Math.round(e.hunger)} · ⚡ ${Math.round(e.energy)}</div>
        <div class="insp-row">💰 ${Math.round(e.gold)}g · 🌾 ${e.inventory.food||0} food · 🪵 ${e.inventory.wood||0} wood</div>
        <div class="insp-row">📍 State: <b>${e.state}</b> · 😌 ${e.currentEmotion}</div>
        <div class="insp-section">Personality</div>
        ${this._personalityBar('Kindness',   e.personality.kindness)}
        ${this._personalityBar('Bravery',    e.personality.bravery)}
        ${this._personalityBar('Greed',      e.personality.greed)}
        ${this._personalityBar('Morality',   e.personality.morality)}
        ${this._personalityBar('Strength',   e.personality.strength)}
        <div class="insp-section">Relationships</div>
        <div class="insp-small">
          ${friends.slice(0,3).map(r => `🤝 ID:${r.otherId.slice(-4)} (${r.score})`).join('<br>')}
          ${enemies.slice(0,2).map(r => `😤 ID:${r.otherId.slice(-4)} (${r.score})`).join('<br>')}
          ${friends.length + enemies.length === 0 ? 'No strong bonds yet.' : ''}
        </div>
        <div class="insp-section">Memories</div>
        <div class="insp-small">
          ${mems.map(m => `• ${m.event} (imp:${m.importance.toFixed(1)})`).join('<br>')}
          ${mems.length === 0 ? 'No memories yet.' : ''}
        </div>
        <div class="insp-section">Actions</div>
        <button onclick="window.__civFollow('${e.id}')">📷 Follow</button>
        <button onclick="window.__civGiveFood('${e.id}')">🍞 Give Food</button>
      `;
    } else if (e.type === 'animal') {
      el.innerHTML = `
        <div class="insp-name">${e.animalType.toUpperCase()}</div>
        <div class="insp-row">❤️ ${Math.round(e.health)}/${e.maxHealth} · 🍞 ${Math.round(e.hunger)}</div>
        <div class="insp-row">State: <b>${e.state}</b> · Predator: ${e.isPredator ? 'Yes' : 'No'}</div>
        <button onclick="window.__civFollow('${e.id}')">📷 Follow</button>
      `;
    }
  }

  _personalityBar(name, value) {
    const pct = Math.round(value);
    const color = pct > 70 ? '#2ecc71' : pct > 40 ? '#f39c12' : '#e74c3c';
    return `
      <div class="pbar-row">
        <span class="pbar-label">${name}</span>
        <div class="pbar-bg">
          <div class="pbar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="pbar-val">${pct}</span>
      </div>`;
  }

  // ── Helpers ──────────────────────────────────────────────────
  _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // Register global callbacks for button clicks
  registerGlobals() {
    const w = this._world;
    const c = this._camera;

    window.__civSetSpeed = (s) => {
      CONFIG.simulation.gameSpeedMultiplier = s;
    };

    window.__civTogglePause = () => {
      const isPaused = CONFIG.simulation.gameSpeedMultiplier === 0;
      CONFIG.simulation.gameSpeedMultiplier = isPaused ? 1 : 0;
      document.querySelector('#ui-speed-ctrl button:last-child').textContent = isPaused ? '⏸' : '▶';
    };

    window.__civFollow = (id) => {
      const entity = w.humans.find(h => h.id === id) || w.animals.find(a => a.id === id);
      if (entity) c.follow(entity);
    };

    window.__civGiveFood = (id) => {
      const human = w.humans.find(h => h.id === id);
      if (human) {
        human.inventory.food = (human.inventory.food || 0) + 20;
        human.hunger = Math.min(100, human.hunger + 30);
      }
    };

    window.__civFocusVillage = (id) => {
      const v = w.villages.find(v => v.id === id);
      if (v) c.centerOn(v.x, v.y);
    };
  }
}
