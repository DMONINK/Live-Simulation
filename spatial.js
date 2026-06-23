// ============================================================
// spatial.js — Spatial Hash Grid for fast proximity queries
//
// Instead of O(n²) brute-force distance checks between every
// pair of entities, we divide the world into cells. Each entity
// registers in its cell. To find neighbors, we only check the
// 9 cells around the queried cell → O(1) for typical queries.
// ============================================================

export class SpatialHash {
  /**
   * @param {number} cellSize  Pixels per cell. Should be >= max query radius.
   */
  constructor(cellSize = 96) {
    this.cellSize = cellSize;
    this._cells   = new Map(); // key → Set of entities
    this._entityCell = new Map(); // entity id → cell key
  }

  _key(cx, cy) { return `${cx},${cy}`; }

  _cellOf(x, y) {
    return {
      cx: Math.floor(x / this.cellSize),
      cy: Math.floor(y / this.cellSize)
    };
  }

  /** Register or update an entity's position. Call every frame. */
  update(entity) {
    const { cx, cy } = this._cellOf(entity.x, entity.y);
    const newKey = this._key(cx, cy);
    const oldKey = this._entityCell.get(entity.id);

    if (oldKey === newKey) return; // hasn't changed cell

    // Remove from old cell
    if (oldKey !== undefined) {
      const cell = this._cells.get(oldKey);
      if (cell) cell.delete(entity);
    }

    // Add to new cell
    if (!this._cells.has(newKey)) this._cells.set(newKey, new Set());
    this._cells.get(newKey).add(entity);
    this._entityCell.set(entity.id, newKey);
  }

  /** Remove an entity entirely (on death/despawn). */
  remove(entity) {
    const key = this._entityCell.get(entity.id);
    if (key !== undefined) {
      const cell = this._cells.get(key);
      if (cell) {
        cell.delete(entity);
        if (cell.size === 0) this._cells.delete(key);
      }
      this._entityCell.delete(entity.id);
    }
  }

  /**
   * Find all entities within `radius` pixels of (x, y).
   * Optionally filter by a custom predicate.
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {Function} [filter]  Optional predicate (entity) => boolean
   * @returns {Array} entities within radius
   */
  query(x, y, radius, filter = null) {
    const r2     = radius * radius;
    const minCX  = Math.floor((x - radius) / this.cellSize);
    const maxCX  = Math.floor((x + radius) / this.cellSize);
    const minCY  = Math.floor((y - radius) / this.cellSize);
    const maxCY  = Math.floor((y + radius) / this.cellSize);

    const results = [];
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const cell = this._cells.get(this._key(cx, cy));
        if (!cell) continue;
        for (const entity of cell) {
          const dx = entity.x - x, dy = entity.y - y;
          if (dx*dx + dy*dy <= r2) {
            if (!filter || filter(entity)) results.push(entity);
          }
        }
      }
    }
    return results;
  }

  /**
   * Find the nearest single entity to (x, y) within radius.
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {Function} [filter]
   * @returns {Object|null}
   */
  nearest(x, y, radius, filter = null) {
    const candidates = this.query(x, y, radius, filter);
    if (candidates.length === 0) return null;
    let best = null, bestD2 = Infinity;
    for (const e of candidates) {
      const d2 = (e.x-x)**2 + (e.y-y)**2;
      if (d2 < bestD2) { bestD2 = d2; best = e; }
    }
    return best;
  }

  /**
   * Find up to `n` nearest entities within radius, sorted by distance.
   */
  nearestN(x, y, radius, n, filter = null) {
    const candidates = this.query(x, y, radius, filter);
    candidates.sort((a, b) =>
      ((a.x-x)**2 + (a.y-y)**2) - ((b.x-x)**2 + (b.y-y)**2)
    );
    return candidates.slice(0, n);
  }

  /** How many entities are currently registered */
  get count() { return this._entityCell.size; }

  /** Debug: return number of populated cells */
  get cellCount() { return this._cells.size; }

  clear() {
    this._cells.clear();
    this._entityCell.clear();
  }
}
