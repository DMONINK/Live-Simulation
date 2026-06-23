// ============================================================
// renderer.js — PixiJS Rendering Engine
//
// Manages all visual output: terrain tiles, building sprites,
// NPC sprites, particle effects, and the night overlay.
//
// IMPORTANT: Uses procedurally-generated textures so the
// simulation works immediately without downloading any assets.
// Set CONFIG.rendering.useSprites = true to use PNG files.
// ============================================================

import { TILE, TILE_COLOR } from './terrain.js';
import { BUILDING_TYPES, BUILD_COLORS } from './building.js';
import { JOBS, JOB_COLORS } from './human.js';
import { ANIMAL_TYPES } from './animal.js';
import { jitterColor, lerpColor, clamp } from './utils.js';
import CONFIG from './config.js';

// ─── Texture Cache ────────────────────────────────────────────
const TEX = {};       // name → PIXI.Texture
const RENDER_CACHE = new Map(); // chunk key → PIXI.Sprite

// ─── Renderer Class ───────────────────────────────────────────
export class Renderer {
  constructor(app) {
    this._app     = app;
    this._stage   = app.stage;
    this.width    = app.screen.width;
    this.height   = app.screen.height;

    // Container layers (bottom → top)
    this.worldContainer    = new PIXI.Container();
    this.terrainLayer      = new PIXI.Container();
    this.objectLayer       = new PIXI.Container(); // trees, rocks
    this.buildingLayer     = new PIXI.Container();
    this.entityLayer       = new PIXI.Container();
    this.effectLayer       = new PIXI.Container(); // fire, smoke
    this.weatherLayer      = new PIXI.Container(); // rain, snow
    this.uiLayer           = new PIXI.Container(); // name labels, health bars
    this.overlayLayer      = new PIXI.Container(); // night, fog

    this.worldContainer.addChild(this.terrainLayer);
    this.worldContainer.addChild(this.objectLayer);
    this.worldContainer.addChild(this.buildingLayer);
    this.worldContainer.addChild(this.entityLayer);
    this.worldContainer.addChild(this.effectLayer);
    this._stage.addChild(this.worldContainer);
    this._stage.addChild(this.weatherLayer);
    this._stage.addChild(this.uiLayer);
    this._stage.addChild(this.overlayLayer);

    // Night overlay
    this._nightOverlay = new PIXI.Graphics();
    this._nightOverlay.beginFill(0x000033, 1);
    this._nightOverlay.drawRect(0, 0, app.screen.width, app.screen.height);
    this._nightOverlay.endFill();
    this._nightOverlay.alpha = 0;
    this.overlayLayer.addChild(this._nightOverlay);

    // Sprite pools
    this._humanSprites   = new Map();  // id → PIXI.Container
    this._animalSprites  = new Map();
    this._buildSprites   = new Map();
    this._chunkSprites   = new Map();  // "cx,cy" → PIXI.Sprite
    this._fireSprites    = new Map();  // building id → PIXI.Container

    this._buildTextures();
  }

  // ══════════════════════════════════════════════════════════════
  // TEXTURE GENERATION — Procedural sprites using PixiJS Graphics
  // ══════════════════════════════════════════════════════════════
  _buildTextures() {
    const r = this._app.renderer;

    // ── Terrain Tiles (32×32) ────────────────────────────────
    for (const [tileId, baseColor] of Object.entries(TILE_COLOR)) {
      const g = new PIXI.Graphics();
      const ts = CONFIG.world.tileSize;

      // Base fill with slight noise variation
      g.beginFill(baseColor);
      g.drawRect(0, 0, ts, ts);
      g.endFill();

      // Add texture detail per tile type
      const id = parseInt(tileId);
      if (id === TILE.GRASS || id === TILE.GRASSDARK) {
        g.beginFill(jitterColor(baseColor, 12), 0.5);
        g.drawCircle(8, 12, 5); g.drawCircle(22, 6, 3); g.drawCircle(14, 22, 4);
        g.endFill();
      } else if (id === TILE.WATER || id === TILE.DEEP_WATER) {
        g.lineStyle(1, 0xFFFFFF, 0.15);
        g.moveTo(4, 16); g.lineTo(28, 16);
        g.moveTo(2, 22); g.lineTo(20, 22);
      } else if (id === TILE.BEACH) {
        g.beginFill(0xE8CC7A, 0.3);
        g.drawCircle(10, 10, 4); g.drawCircle(22, 20, 3);
        g.endFill();
      } else if (id === TILE.MOUNTAIN) {
        g.lineStyle(1, 0x4E342E, 0.4);
        g.moveTo(16, 2); g.lineTo(30, 28); g.moveTo(16, 2); g.lineTo(2, 28);
      } else if (id === TILE.FOREST) {
        g.beginFill(0x1B5E20, 0.6);
        g.drawCircle(16, 14, 8); g.drawCircle(6, 20, 5); g.drawCircle(26, 20, 5);
        g.endFill();
      }

      TEX[`tile_${tileId}`] = r.generateTexture(g);
      g.destroy();
    }

    // ── Human Sprites (24×36) ────────────────────────────────
    for (const [job, color] of Object.entries(JOB_COLORS)) {
      ['male', 'female'].forEach(gender => {
        const g  = new PIXI.Graphics();
        const bw = 14, bh = 18; // body width/height
        const cx = 12;          // center x

        // Shadow
        g.beginFill(0x000000, 0.2);
        g.drawEllipse(cx, 38, 8, 3);
        g.endFill();

        // Legs
        g.beginFill(0x4E342E);
        g.drawRect(cx - 5, bh + 12, 4, 8);
        g.drawRect(cx + 1, bh + 12, 4, 8);
        g.endFill();

        // Body
        g.beginFill(color);
        g.drawRoundedRect(cx - bw/2, 14, bw, bh, 3);
        g.endFill();

        // Arms
        g.beginFill(color);
        if (gender === 'female') {
          g.drawRoundedRect(cx - bw/2 - 5, 16, 5, 12, 2);
          g.drawRoundedRect(cx + bw/2,      16, 5, 12, 2);
        } else {
          g.drawRoundedRect(cx - bw/2 - 6, 14, 6, 14, 2);
          g.drawRoundedRect(cx + bw/2,      14, 6, 14, 2);
        }
        g.endFill();

        // Skin (face/hands)
        const skinColor = 0xFFD5A8;
        g.beginFill(skinColor);
        g.drawCircle(cx, 9, 8); // head
        g.endFill();

        // Eyes
        g.beginFill(0x1A237E);
        g.drawCircle(cx - 3, 8, 1.5);
        g.drawCircle(cx + 3, 8, 1.5);
        g.endFill();

        // Job-specific hat/accessory
        if (job === JOBS.WARRIOR) {
          g.beginFill(0x546E7A);
          g.drawRect(cx - 7, 1, 14, 5); // helmet
          g.endFill();
        } else if (job === JOBS.FARMER) {
          g.beginFill(0xF9A825);
          g.drawEllipse(cx, 1, 10, 4); // straw hat
          g.endFill();
        } else if (job === JOBS.TRADER) {
          g.beginFill(0x4E342E);
          g.drawRect(cx - 5, 0, 10, 6); // top hat
          g.endFill();
        } else if (job === JOBS.HEALER) {
          g.beginFill(0xFFFFFF);
          g.drawCircle(cx, 1, 5); // white cap
          g.endFill();
          g.lineStyle(1, 0xF44336);
          g.moveTo(cx, -2); g.lineTo(cx, 4);
          g.moveTo(cx - 3, 1); g.lineTo(cx + 3, 1);
        }

        TEX[`human_${job}_${gender}`] = r.generateTexture(g);
        g.destroy();
      });
    }

    // ── Animal Sprites ────────────────────────────────────────
    const animalDefs = [
      { type: ANIMAL_TYPES.WOLF,    color: 0x607D8B, w: 22, h: 14 },
      { type: ANIMAL_TYPES.DEER,    color: 0xA1887F, w: 24, h: 16 },
      { type: ANIMAL_TYPES.COW,     color: 0xEFEBE9, w: 28, h: 18 },
      { type: ANIMAL_TYPES.CHICKEN, color: 0xFFEB3B, w: 14, h: 12 },
      { type: ANIMAL_TYPES.HORSE,   color: 0x795548, w: 28, h: 20 },
    ];
    for (const { type, color, w, h } of animalDefs) {
      const g = new PIXI.Graphics();
      // Body
      g.beginFill(color);
      g.drawEllipse(w/2, h/2 + 4, w/2, h/3);
      g.endFill();
      // Head
      g.beginFill(jitterColor(color, 15));
      g.drawCircle(w - 4, h/2, h/4 + 2);
      g.endFill();
      // Legs
      g.beginFill(jitterColor(color, -10));
      for (let i = 0; i < 4; i++) {
        g.drawRect(4 + i * (w/4 - 1), h, 3, 6);
      }
      g.endFill();
      // Eyes
      g.beginFill(0x000000);
      g.drawCircle(w - 2, h/2 - 1, 1.5);
      g.endFill();
      // Wolf gets different color nose area
      if (type === ANIMAL_TYPES.WOLF) {
        g.beginFill(0x37474F);
        g.drawCircle(w, h/2, 3);
        g.endFill();
      }

      TEX[`animal_${type}`] = r.generateTexture(g);
      g.destroy();
    }

    // ── Building Textures ─────────────────────────────────────
    for (const [btype, colors] of Object.entries(BUILD_COLORS)) {
      const g    = new PIXI.Graphics();
      const size = btype === BUILDING_TYPES.WELL ? 28 : 48;

      if (btype === BUILDING_TYPES.WELL) {
        // Circular well
        g.beginFill(0x78909C);
        g.drawCircle(14, 14, 14);
        g.endFill();
        g.beginFill(0x37474F);
        g.drawCircle(14, 14, 8);
        g.endFill();
        g.lineStyle(2, 0x5D4037);
        g.moveTo(6, 8); g.lineTo(22, 8); // cross bar
        g.moveTo(14, 4); g.lineTo(14, 12); // bucket rope
      } else if (btype === BUILDING_TYPES.FARM) {
        // Farm plot
        g.beginFill(0x8D6E63);
        g.drawRect(0, 0, 64, 48);
        g.endFill();
        g.lineStyle(1, 0xA5D6A7, 0.5);
        for (let i = 4; i < 64; i += 8) {
          g.moveTo(i, 4); g.lineTo(i, 44);
        }
        g.beginFill(0x81C784, 0.6);
        for (let row = 0; row < 5; row++) {
          for (let col = 0; col < 7; col++) {
            if ((row + col) % 2 === 0)
              g.drawCircle(5 + col * 8, 6 + row * 8, 2);
          }
        }
        g.endFill();
      } else if (btype === BUILDING_TYPES.TOWER) {
        g.beginFill(colors.wall);
        g.drawRect(8, 8, 32, 48);
        g.endFill();
        g.beginFill(jitterColor(colors.wall, -20));
        g.drawRect(0, 4, 48, 16); // top ramparts
        for (let i = 0; i < 4; i++) {
          g.drawRect(i * 12, 0, 8, 8);
        }
        g.endFill();
        g.beginFill(colors.door);
        g.drawRoundedRect(14, 36, 20, 20, 10); // arch door
        g.endFill();
      } else {
        // Standard rectangular building
        // Wall
        g.beginFill(colors.wall);
        g.drawRect(0, 16, 48, 32);
        g.endFill();
        // Roof (triangle or slanted)
        g.beginFill(colors.roof);
        g.moveTo(0, 18); g.lineTo(24, 0); g.lineTo(48, 18);
        g.closePath();
        g.endFill();
        // Door
        g.beginFill(colors.door);
        g.drawRect(18, 32, 12, 16);
        g.endFill();
        // Windows
        g.beginFill(0xFFFDE7, 0.8);
        g.drawRect(6, 22, 8, 8);
        g.drawRect(34, 22, 8, 8);
        g.endFill();
        // Window cross
        g.lineStyle(1, colors.door, 0.7);
        g.moveTo(10, 22); g.lineTo(10, 30); g.moveTo(6, 26); g.lineTo(14, 26);
        g.moveTo(38, 22); g.lineTo(38, 30); g.moveTo(34, 26); g.lineTo(42, 26);
      }

      TEX[`building_${btype}`] = r.generateTexture(g);
      g.destroy();
    }

    // ── Tree Sprite ────────────────────────────────────────────
    const tg = new PIXI.Graphics();
    tg.beginFill(0x5D4037); tg.drawRect(10, 28, 8, 16); tg.endFill(); // trunk
    tg.beginFill(0x1B5E20); tg.drawCircle(14, 20, 14); tg.endFill();   // crown
    tg.beginFill(0x2E7D32); tg.drawCircle(14, 14, 10); tg.endFill();   // top lighter
    TEX['tree'] = this._app.renderer.generateTexture(tg);
    tg.destroy();

    // ── Rock Sprite ────────────────────────────────────────────
    const rg = new PIXI.Graphics();
    rg.beginFill(0x78909C); rg.drawEllipse(12, 12, 12, 8); rg.endFill();
    rg.beginFill(0x90A4AE); rg.drawEllipse(10, 10, 8, 5);  rg.endFill();
    TEX['rock'] = this._app.renderer.generateTexture(rg);
    rg.destroy();

    // ── Bush Sprite ────────────────────────────────────────────
    const bg = new PIXI.Graphics();
    bg.beginFill(0x558B2F); bg.drawCircle(10, 10, 9); bg.endFill();
    bg.beginFill(0x689F38); bg.drawCircle(14, 8, 7); bg.endFill();
    bg.beginFill(0xF44336, 0.6); bg.drawCircle(8, 7, 2); bg.drawCircle(15, 9, 2); bg.endFill();
    TEX['bush'] = this._app.renderer.generateTexture(bg);
    bg.destroy();

    // ── Fire Sprite ────────────────────────────────────────────
    const fg = new PIXI.Graphics();
    fg.beginFill(0xFF6D00); fg.drawEllipse(8, 20, 6, 18); fg.endFill();
    fg.beginFill(0xFFD600); fg.drawEllipse(8, 18, 4, 12); fg.endFill();
    fg.beginFill(0xFFFFFF, 0.4); fg.drawEllipse(8, 16, 2, 6); fg.endFill();
    TEX['fire'] = this._app.renderer.generateTexture(fg);
    fg.destroy();

    // ── Health bar ────────────────────────────────────────────
    const hg = new PIXI.Graphics();
    hg.beginFill(0x00C853); hg.drawRect(0, 0, 24, 3); hg.endFill();
    TEX['healthbar'] = this._app.renderer.generateTexture(hg);
    hg.destroy();

    console.log(`[Renderer] Generated ${Object.keys(TEX).length} procedural textures.`);
  }

  // ══════════════════════════════════════════════════════════════
  // TERRAIN RENDERING — Chunk-based for performance
  // ══════════════════════════════════════════════════════════════
  renderTerrain(terrain, camera) {
    const vp  = camera.viewport;
    const ts  = CONFIG.world.tileSize;
    const cs  = CONFIG.world.chunkSize;

    const minCX = Math.max(0, Math.floor(vp.x / (ts * cs)));
    const minCY = Math.max(0, Math.floor(vp.y / (ts * cs)));
    const maxCX = Math.min(Math.ceil(terrain.width / cs) - 1,
                           Math.ceil(vp.x2 / (ts * cs)));
    const maxCY = Math.min(Math.ceil(terrain.height / cs) - 1,
                           Math.ceil(vp.y2 / (ts * cs)));

    // Track which chunks should be visible
    const needed = new Set();

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const key = `${cx},${cy}`;
        needed.add(key);

        if (!this._chunkSprites.has(key)) {
          const sprite = this._bakeChunk(terrain, cx, cy);
          sprite.x = cx * cs * ts;
          sprite.y = cy * cs * ts;
          this.terrainLayer.addChild(sprite);
          this._chunkSprites.set(key, sprite);
        }
      }
    }

    // Hide chunks outside viewport
    for (const [key, sprite] of this._chunkSprites) {
      sprite.visible = needed.has(key);
    }
  }

  _bakeChunk(terrain, cx, cy) {
    const cs = CONFIG.world.chunkSize;
    const ts = CONFIG.world.tileSize;
    const g  = new PIXI.Graphics();

    for (let ly = 0; ly < cs; ly++) {
      for (let lx = 0; lx < cs; lx++) {
        const tile = terrain.getTile(cx * cs + lx, cy * cs + ly);
        const tex  = TEX[`tile_${tile}`];
        if (!tex) continue;
        const s = new PIXI.Sprite(tex);
        s.x = lx * ts;
        s.y = ly * ts;
        g.addChild?.(s);
      }
    }

    // Use RenderTexture to bake the chunk into a single texture
    const rt = PIXI.RenderTexture.create({ width: cs * ts, height: cs * ts });
    const container = new PIXI.Container();

    for (let ly = 0; ly < cs; ly++) {
      for (let lx = 0; lx < cs; lx++) {
        const tile     = terrain.getTile(cx * cs + lx, cy * cs + ly);
        const texKey   = `tile_${tile}`;
        const tex      = TEX[texKey];
        if (!tex) continue;
        const s        = new PIXI.Sprite(tex);
        s.x            = lx * ts;
        s.y            = ly * ts;
        container.addChild(s);
      }
    }

    this._app.renderer.render(container, { renderTexture: rt });
    container.destroy({ children: true });

    return new PIXI.Sprite(rt);
  }

  // ══════════════════════════════════════════════════════════════
  // ENTITY RENDERING — Humans and Animals
  // ══════════════════════════════════════════════════════════════
  createHumanSprite(human) {
    const container = new PIXI.Container();
    const texKey    = `human_${human.job}_${human.gender}`;
    const tex       = TEX[texKey] || TEX[`human_${JOBS.FARMER}_male`];

    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5, 1);
    container.addChild(sprite);

    // Health bar
    if (CONFIG.rendering.showHealthBars) {
      const hbBg = new PIXI.Graphics();
      hbBg.beginFill(0x333333, 0.7); hbBg.drawRect(-12, -28, 24, 4); hbBg.endFill();
      const hbFg = new PIXI.Sprite(TEX['healthbar']);
      hbFg.anchor.set(0, 0); hbFg.x = -12; hbFg.y = -28;
      hbFg.width = 24; hbFg.height = 4;
      container.addChild(hbBg);
      container.addChild(hbFg);
      human._hpBar = hbFg;
    }

    // Name label
    if (CONFIG.rendering.showNames) {
      const label = new PIXI.Text(human.name, {
        fontSize: 9, fill: 0xFFFFFF, fontFamily: 'sans-serif',
        stroke: 0x000000, strokeThickness: 2,
      });
      label.anchor.set(0.5, 1);
      label.y = -36;
      container.addChild(label);
      human.nameLabel = label;
    }

    container.x = human.x;
    container.y = human.y;
    human.sprite = container;

    this.entityLayer.addChild(container);
    this._humanSprites.set(human.id, container);
    return container;
  }

  createAnimalSprite(animal) {
    const tex     = TEX[`animal_${animal.animalType}`] || TEX[`animal_${ANIMAL_TYPES.DEER}`];
    const sprite  = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5, 1);
    sprite.x = animal.x;
    sprite.y = animal.y;
    animal.sprite = sprite;
    this.entityLayer.addChild(sprite);
    this._animalSprites.set(animal.id, sprite);
    return sprite;
  }

  createBuildingSprite(building) {
    const tex    = TEX[`building_${building.type}`];
    if (!tex) return null;
    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5, 1);
    sprite.x = building.x;
    sprite.y = building.y;
    building.sprite = sprite;

    // Construction progress bar
    if (!building.complete) {
      const pbar = new PIXI.Graphics();
      building.progressBar = pbar;
      this.buildingLayer.addChild(pbar);
    }

    this.buildingLayer.addChild(sprite);
    this._buildSprites.set(building.id, sprite);
    return sprite;
  }

  createResourceSprite(node) {
    const texKey = node.type === 'tree' ? 'tree' : node.type === 'rock' ? 'rock' : 'bush';
    const tex    = TEX[texKey];
    if (!tex) return null;
    const sprite = new PIXI.Sprite(tex);
    const ts     = CONFIG.world.tileSize;
    sprite.anchor.set(0.5, 1);
    sprite.x = node.x * ts + ts / 2;
    sprite.y = node.y * ts + ts;
    this.objectLayer.addChild(sprite);
    node.sprite = sprite;
    return sprite;
  }

  // ── Fire effect on burning building ─────────────────────────
  addFireEffect(building) {
    if (this._fireSprites.has(building.id)) return;
    const container = new PIXI.Container();
    for (let i = 0; i < 4; i++) {
      const s = new PIXI.Sprite(TEX['fire']);
      s.anchor.set(0.5, 1);
      s.x = (Math.random() - 0.5) * 24;
      s.y = -i * 8;
      s.alpha = 0.85;
      container.addChild(s);
    }
    container.x = building.x;
    container.y = building.y;
    this.effectLayer.addChild(container);
    this._fireSprites.set(building.id, container);
  }

  removeFireEffect(buildingId) {
    const s = this._fireSprites.get(buildingId);
    if (s) { s.destroy(); this._fireSprites.delete(buildingId); }
  }

  // ══════════════════════════════════════════════════════════════
  // PER-FRAME UPDATE
  // ══════════════════════════════════════════════════════════════
  update(camera, timeSystem, humans, animals, buildings) {
    // Apply camera transform to world
    camera.apply(this.worldContainer);

    // Update human sprites
    for (const human of humans) {
      if (!human.sprite) continue;
      human.sprite.x = human.x;
      human.sprite.y = human.y;
      if (human.sprite.scale) {
        human.sprite.scale.x = human.facingLeft ? -1 : 1;
      }
      // Update health bar
      if (human._hpBar) {
        human._hpBar.width = 24 * (human.health / human.maxHealth);
        human._hpBar.tint  = human.health > 50 ? 0x00C853 : human.health > 25 ? 0xFFD600 : 0xF44336;
      }
      // Dim dead humans
      if (!human.alive && human.sprite.alpha > 0.3) human.sprite.alpha = 0.3;
    }

    // Update animal sprites
    for (const animal of animals) {
      if (!animal.sprite) continue;
      animal.sprite.x = animal.x;
      animal.sprite.y = animal.y;
      animal.sprite.scale.x = animal.facingLeft ? -1 : 1;
      if (!animal.alive) animal.sprite.alpha = 0.2;
    }

    // Update buildings
    for (const b of buildings) {
      if (!b.sprite) continue;
      // Construction alpha
      if (!b.complete) {
        b.sprite.alpha = 0.4 + b.progress * 0.6;
        if (b.progressBar) {
          b.progressBar.clear();
          b.progressBar.beginFill(0x00C853);
          b.progressBar.drawRect(b.x - 24, b.y - 60, 48 * b.progress, 4);
          b.progressBar.endFill();
        }
      }
      // Fire
      if (b.onFire) this.addFireEffect(b);
      else if (this._fireSprites.has(b.id)) this.removeFireEffect(b.id);

      // Animate fire sprites
      for (const [, fs] of this._fireSprites) {
        const t = performance.now() / 300;
        for (let i = 0; i < fs.children.length; i++) {
          const c = fs.children[i];
          c.y = -i * 8 - Math.sin(t + i) * 4;
          c.scale.y = 0.8 + Math.sin(t * 0.7 + i) * 0.2;
          c.alpha   = 0.6 + Math.sin(t + i * 1.5) * 0.3;
        }
      }
    }

    // Night overlay
    if (timeSystem) {
      this._nightOverlay.alpha = timeSystem.nightAlpha;
      this._nightOverlay.tint  = timeSystem.ambientColor;
    }
  }

  removeEntity(entity) {
    if (entity.sprite) {
      entity.sprite.destroy();
      entity.sprite = null;
    }
    this._humanSprites.delete(entity.id);
    this._animalSprites.delete(entity.id);
  }

  resize(w, h) {
    this.width  = w;
    this.height = h;
    this._nightOverlay.width  = w;
    this._nightOverlay.height = h;
  }
}
