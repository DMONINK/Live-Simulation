// ============================================================
// camera.js — Viewport Camera
//
// Controls what part of the 2000×2000 world is visible.
// Supports mouse drag, keyboard pan, zoom, and smooth follow.
// Culls entities outside the viewport for performance.
// ============================================================

import { clamp, lerp } from './utils.js';
import CONFIG from './config.js';

export class Camera {
  constructor(screenW, screenH, worldW, worldH) {
    this.screenW = screenW;
    this.screenH = screenH;
    this.worldW  = worldW;   // world pixel width
    this.worldH  = worldH;   // world pixel height

    // Camera position = top-left corner of visible area in world pixels
    this.x     = 0;
    this.y     = 0;
    this._targetX = 0;
    this._targetY = 0;

    this.zoom     = 1.0;
    this._targetZoom = 1.0;
    this.minZoom  = 0.4;
    this.maxZoom  = 3.0;

    this._followTarget = null;  // entity to follow (null = free camera)
    this._followLerp   = 0.08;  // smoothing factor

    // Input state
    this._dragging  = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._dragCamX  = 0;
    this._dragCamY  = 0;
    this._keys      = { up: false, down: false, left: false, right: false };
    this._panSpeed  = 400; // pixels/second at zoom=1
  }

  /** Attach event listeners to the canvas */
  attachInput(canvas) {
    // Mouse drag to pan
    canvas.addEventListener('mousedown', e => {
      if (e.button === 1 || e.button === 2) { // middle or right click
        this._dragging  = true;
        this._dragStartX = e.clientX;
        this._dragStartY = e.clientY;
        this._dragCamX  = this._targetX;
        this._dragCamY  = this._targetY;
        this._followTarget = null;
        canvas.style.cursor = 'grabbing';
      }
    });

    canvas.addEventListener('mousemove', e => {
      if (!this._dragging) return;
      const dx = (e.clientX - this._dragStartX) / this.zoom;
      const dy = (e.clientY - this._dragStartY) / this.zoom;
      this._targetX = this._dragCamX - dx;
      this._targetY = this._dragCamY - dy;
    });

    canvas.addEventListener('mouseup', () => {
      this._dragging = false;
      canvas.style.cursor = 'default';
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Scroll to zoom
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
      this._targetZoom = clamp(this._targetZoom * zoomDelta, this.minZoom, this.maxZoom);
    }, { passive: false });

    // Keyboard pan
    window.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp'    || e.key === 'w') this._keys.up    = true;
      if (e.key === 'ArrowDown'  || e.key === 's') this._keys.down  = true;
      if (e.key === 'ArrowLeft'  || e.key === 'a') this._keys.left  = true;
      if (e.key === 'ArrowRight' || e.key === 'd') this._keys.right = true;
      if (e.key === 'Escape') this._followTarget = null;

      // Number keys: zoom presets
      if (e.key === '1') this._targetZoom = 1.0;
      if (e.key === '2') this._targetZoom = 1.5;
      if (e.key === '3') this._targetZoom = 2.0;
    });

    window.addEventListener('keyup', e => {
      if (e.key === 'ArrowUp'    || e.key === 'w') this._keys.up    = false;
      if (e.key === 'ArrowDown'  || e.key === 's') this._keys.down  = false;
      if (e.key === 'ArrowLeft'  || e.key === 'a') this._keys.left  = false;
      if (e.key === 'ArrowRight' || e.key === 'd') this._keys.right = false;
    });
  }

  /** Call every frame with real deltaMs */
  update(deltaMs) {
    const dt = deltaMs / 1000;

    // Smooth zoom
    this.zoom = lerp(this.zoom, this._targetZoom, 0.1);

    // Follow target
    if (this._followTarget) {
      const tx = this._followTarget.x - this.screenW / (2 * this.zoom);
      const ty = this._followTarget.y - this.screenH / (2 * this.zoom);
      this._targetX = lerp(this._targetX, tx, this._followLerp);
      this._targetY = lerp(this._targetY, ty, this._followLerp);
    } else {
      // Keyboard pan
      const speed = this._panSpeed / this.zoom;
      if (this._keys.left)  this._targetX -= speed * dt;
      if (this._keys.right) this._targetX += speed * dt;
      if (this._keys.up)    this._targetY -= speed * dt;
      if (this._keys.down)  this._targetY += speed * dt;
    }

    // Clamp to world bounds
    const maxX = this.worldW - this.screenW / this.zoom;
    const maxY = this.worldH - this.screenH / this.zoom;
    this._targetX = clamp(this._targetX, 0, Math.max(0, maxX));
    this._targetY = clamp(this._targetY, 0, Math.max(0, maxY));

    // Smooth camera movement
    this.x = lerp(this.x, this._targetX, 0.15);
    this.y = lerp(this.y, this._targetY, 0.15);
  }

  /** Apply camera transform to a PixiJS container */
  apply(container) {
    container.scale.set(this.zoom);
    container.x = -this.x * this.zoom;
    container.y = -this.y * this.zoom;
  }

  /** Center camera on world pixel coordinates */
  centerOn(wx, wy) {
    this._targetX = wx - this.screenW / (2 * this.zoom);
    this._targetY = wy - this.screenH / (2 * this.zoom);
    this._followTarget = null;
  }

  /** Start following an entity */
  follow(entity) {
    this._followTarget = entity;
  }

  stopFollowing() {
    this._followTarget = null;
  }

  /** Convert screen pixel → world pixel coordinates */
  screenToWorld(sx, sy) {
    return {
      x: sx / this.zoom + this.x,
      y: sy / this.zoom + this.y
    };
  }

  /** Convert world pixel → screen pixel coordinates */
  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom,
      y: (wy - this.y) * this.zoom
    };
  }

  /** Viewport rectangle in world coordinates */
  get viewport() {
    const pad = CONFIG.rendering.viewportPadding * CONFIG.world.tileSize * CONFIG.world.chunkSize;
    return {
      x:  this.x - pad,
      y:  this.y - pad,
      w:  this.screenW / this.zoom + pad * 2,
      h:  this.screenH / this.zoom + pad * 2,
      x2: this.x + this.screenW / this.zoom + pad,
      y2: this.y + this.screenH / this.zoom + pad,
    };
  }

  /** True if a world-space rectangle is within the viewport */
  isVisible(wx, wy, margin = 64) {
    const vp = this.viewport;
    return wx >= vp.x - margin && wx <= vp.x2 + margin &&
           wy >= vp.y - margin && wy <= vp.y2 + margin;
  }

  /** Resize when window resizes */
  resize(w, h) {
    this.screenW = w;
    this.screenH = h;
  }

  get following() { return this._followTarget; }
}
