// ============================================================
// main.js — Entry Point & Game Loop
//
// 1. Creates the PixiJS application
// 2. Initializes all systems through World
// 3. Runs the 60fps update/render loop
// 4. Handles window resize
// ============================================================

import { World }    from './world.js';
import { Renderer } from './renderer.js';
import { Camera }   from './camera.js';
import { UI }       from './ui.js';
import CONFIG       from './config.js';

// ── PixiJS Application Setup ─────────────────────────────────
const app = new PIXI.Application({
  width:            window.innerWidth,
  height:           window.innerHeight,
  backgroundColor:  0x1a6ea3,    // Default ocean blue (world edges)
  antialias:        false,        // Off for crisp pixel art look
  resolution:       window.devicePixelRatio || 1,
  autoDensity:      true,
  powerPreference:  'high-performance',
});

document.getElementById('canvas-container').appendChild(app.view);
app.view.id = 'game-canvas';

// ── Loading Screen ────────────────────────────────────────────
const loadScreen = document.getElementById('loading-screen');

// ── Core Objects ──────────────────────────────────────────────
let world, renderer, camera, ui;
let lastTime   = 0;
let fpsFilter  = 60;

// ── Main Init ────────────────────────────────────────────────
async function init() {
  // 1. Create renderer (generates all textures)
  renderer = new Renderer(app);

  // 2. Create world (generates terrain, spawns entities)
  world = new World();

  // 3. Create camera
  const worldPixelW = CONFIG.world.tilesWide  * CONFIG.world.tileSize;
  const worldPixelH = CONFIG.world.tilesHigh  * CONFIG.world.tileSize;
  camera = new Camera(app.screen.width, app.screen.height, worldPixelW, worldPixelH);
  camera.attachInput(app.view);

  // 4. Initialize world (heavy work — terrain gen, spawning)
  await world.init(app, renderer);

  // 5. Initialize weather visuals
  world.weatherSystem.init(renderer.weatherLayer);

  // 6. Center camera on first village
  if (world.villages.length > 0) {
    const v = world.villages[0];
    camera.centerOn(v.x, v.y);
    camera._targetZoom = 1.5;
    camera.zoom = 1.5;
  }

  // 7. Create UI
  ui = new UI(world, camera);
  ui.registerGlobals();

  // 8. Hide loading screen
  if (loadScreen) {
    loadScreen.style.transition = 'opacity 0.8s ease';
    loadScreen.style.opacity = '0';
    setTimeout(() => loadScreen.remove(), 900);
  }

  // 9. Start game loop
  app.ticker.add(gameLoop);

  console.log('[Main] 🎮 Simulation running!');
}

// ── Game Loop ─────────────────────────────────────────────────
function gameLoop(pixiDelta) {
  // PixiJS ticker gives delta in frames (1.0 = 1/60s at 60fps)
  const now      = performance.now();
  const deltaMs  = Math.min(now - lastTime, 100); // cap at 100ms (10fps min)
  lastTime       = now;

  // FPS measurement (exponential moving average)
  const rawFps = 1000 / Math.max(deltaMs, 1);
  fpsFilter    = fpsFilter * 0.9 + rawFps * 0.1;

  // Skip if paused
  if (CONFIG.simulation.gameSpeedMultiplier === 0) {
    ui?.update(deltaMs / 1000, fpsFilter);
    return;
  }

  // ── Update world ──────────────────────────────────────────
  world.update(deltaMs);

  // ── Update camera ─────────────────────────────────────────
  camera.update(deltaMs);

  // ── Render terrain (chunk-based) ─────────────────────────
  renderer.renderTerrain(world.terrain, camera);

  // ── Update all sprites from entity state ─────────────────
  renderer.update(
    camera,
    world.timeSystem,
    world.humans,
    world.animals,
    world.buildingManager.all
  );

  // ── Depth-sort entity layer for visual correctness ───────
  // Sort entities by Y so those further down appear in front
  if (app.ticker.count % 4 === 0) {  // Every 4 frames
    renderer.entityLayer.children.sort((a, b) => a.y - b.y);
  }

  // ── Update UI ────────────────────────────────────────────
  ui.update(deltaMs / 1000, fpsFilter);
}

// ── Window Resize ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  app.renderer.resize(w, h);
  camera.resize(w, h);
  renderer.resize(w, h);
});

// ── Error Handling ────────────────────────────────────────────
window.addEventListener('unhandledrejection', e => {
  console.error('[Main] Unhandled error:', e.reason);
});

// ── Start ─────────────────────────────────────────────────────
init().catch(err => {
  console.error('[Main] Fatal init error:', err);
  if (loadScreen) {
    loadScreen.innerHTML = `
      <div style="color:#ff6b6b;text-align:center;padding:40px">
        <h2>⚠️ Initialization Error</h2>
        <p>${err.message}</p>
        <p style="font-size:12px;opacity:0.6">Check browser console for details.</p>
      </div>`;
  }
});
