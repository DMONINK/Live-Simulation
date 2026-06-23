// ============================================================
// economy.js — Economy System
//
// Tracks supply and demand for resources across all villages.
// Prices fluctuate: scarce items cost more, surpluses are cheap.
// Records trade history and emits economic events.
// ============================================================

import { clamp, randomFloat, EventEmitter } from './utils.js';
import CONFIG from './config.js';

const RESOURCES = ['food', 'wood', 'stone', 'cloth', 'weapon', 'water'];

export class Economy {
  constructor(villages = []) {
    this._basePrices     = { ...CONFIG.economy.basePrices };
    this._currentPrices  = { ...CONFIG.economy.basePrices };
    this._supply         = {};   // resource → total units in world
    this._demand         = {};   // resource → estimated demand
    this._tradeHistory   = [];   // last N trades
    this._maxHistory     = 200;
    this._villageStats   = new Map(); // villageId → { gold, food, wood, stone }
    this._updateTimer    = 0;    // seconds since last price update
    this._UPDATE_EVERY   = 30;   // update prices every 30 seconds

    for (const r of RESOURCES) {
      this._supply[r]  = 100;
      this._demand[r]  = 80;
    }

    for (const v of villages) {
      this._villageStats.set(v.id, { gold: 500, food: 100, wood: 80, stone: 60 });
    }
  }

  // ─── Update ───────────────────────────────────────────────────
  update(dt, world) {
    this._updateTimer += dt;
    if (this._updateTimer >= this._UPDATE_EVERY) {
      this._updateTimer = 0;
      this._recalcSupply(world);
      this._adjustPrices();
    }
  }

  // ─── Supply Calculation ───────────────────────────────────────
  _recalcSupply(world) {
    const totals = {};
    for (const r of RESOURCES) totals[r] = 0;

    // Sum from all humans
    if (world.humans) {
      for (const h of world.humans) {
        if (!h.alive) continue;
        for (const r of RESOURCES) {
          totals[r] += h.inventory?.[r] || 0;
        }
      }
    }

    // Sum from buildings
    if (world.buildingManager) {
      for (const b of world.buildingManager.all) {
        for (const r of RESOURCES) {
          totals[r] += b.inventory?.[r] || 0;
        }
      }
    }

    this._supply = totals;
  }

  // ─── Price Adjustment ─────────────────────────────────────────
  _adjustPrices() {
    const fluc = CONFIG.economy.priceFluctuation;

    for (const r of RESOURCES) {
      const base     = this._basePrices[r] || 5;
      const supply   = this._supply[r]  || 1;
      const demand   = this._demand[r]  || 50;
      const ratio    = demand / supply;    // >1 = scarce, <1 = surplus

      // Price formula: base × supply/demand ratio, clamped to ±fluctuation
      const targetPrice = base * clamp(ratio, 1 - fluc, 1 + fluc * 3);
      const prev        = this._currentPrices[r] || base;

      // Smooth price movement (avoid huge swings)
      this._currentPrices[r] = Math.max(1, prev + (targetPrice - prev) * 0.3);
    }
  }

  // ─── Trade Recording ──────────────────────────────────────────
  recordTrade({ seller, buyer, amount, price, resource = 'food' }) {
    this._tradeHistory.push({
      sellerId:  seller?.id,
      sellerName: seller?.name,
      buyerId:   buyer?.id,
      buyerName: buyer?.name,
      resource, amount, price,
      total:     amount * price,
      time:      Date.now()
    });

    // Update demand — traded items have active demand
    this._demand[resource] = Math.min(200, (this._demand[resource] || 50) + amount * 0.5);

    if (this._tradeHistory.length > this._maxHistory) {
      this._tradeHistory.shift();
    }
  }

  // ─── Price Queries ────────────────────────────────────────────
  getPrice(resource) {
    return this._currentPrices[resource] || this._basePrices[resource] || 5;
  }

  getPriceFormatted(resource) {
    return Math.round(this.getPrice(resource));
  }

  /** Get percentage change from base price */
  getPriceChange(resource) {
    const base    = this._basePrices[resource] || 5;
    const current = this._currentPrices[resource] || base;
    return ((current - base) / base * 100).toFixed(0) + '%';
  }

  isScarce(resource) {
    return this.getPrice(resource) > this._basePrices[resource] * 1.5;
  }

  isSurplus(resource) {
    return this.getPrice(resource) < this._basePrices[resource] * 0.7;
  }

  // ─── Tax / Village Income ─────────────────────────────────────
  collectTax(villageId, humans) {
    let total = 0;
    for (const h of humans) {
      if (h.villageId !== villageId || !h.alive) continue;
      const tax = Math.floor(h.gold * 0.05); // 5% tax
      if (tax > 0) {
        h.gold -= tax;
        total  += tax;
      }
    }
    const vs = this._villageStats.get(villageId);
    if (vs) vs.gold += total;
    return total;
  }

  /** Village-wide resource check */
  getVillageResources(villageId, humans, buildings) {
    const totals = { food: 0, wood: 0, stone: 0, gold: 0, population: 0 };
    for (const h of humans) {
      if (h.villageId !== villageId || !h.alive) continue;
      totals.food  += h.inventory?.food || 0;
      totals.wood  += h.inventory?.wood || 0;
      totals.stone += h.inventory?.stone || 0;
      totals.gold  += h.gold || 0;
      totals.population++;
    }
    return totals;
  }

  // ─── Market Display ───────────────────────────────────────────
  getPriceTable() {
    return RESOURCES.map(r => ({
      resource: r,
      price:    this.getPriceFormatted(r),
      supply:   Math.round(this._supply[r] || 0),
      demand:   Math.round(this._demand[r] || 0),
      trend:    this.isScarce(r) ? '↑' : this.isSurplus(r) ? '↓' : '→'
    }));
  }

  get recentTrades() {
    return this._tradeHistory.slice(-10).reverse();
  }

  get totalTradeVolume() {
    return this._tradeHistory.reduce((sum, t) => sum + t.total, 0);
  }
}
