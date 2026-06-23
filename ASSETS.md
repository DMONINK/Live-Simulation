# 🎨 Assets Guide — AI Civilization Simulation

The simulation works immediately using **procedural graphics** (no downloads needed).
When you're ready for polished sprites, download from these free sources:

---

## 📦 Kenney Assets (CC0 — free for any use)

### Tiny Town Pack (Houses, Roads, Trees, Buildings)
🔗 https://kenney.nl/assets/tiny-town
- Download: `kenney_tiny-town.zip`
- Use: `tilemap_packed.png` for buildings and tiles
- License: CC0 (no attribution required)

### Tiny Dungeon Pack (Characters, Items)
🔗 https://kenney.nl/assets/tiny-dungeon  
- Files: `tilemap.png`
- Use: Characters and interior scenes

### Tiny Swords Pack (Warriors, weapons)
🔗 https://kenney.nl/assets/tiny-swords

### Animal Crossing Sprites
🔗 https://kenney.nl/assets/animal-pack-redux

### Particle Pack (Fire, Smoke, Rain effects)
🔗 https://kenney.nl/assets/particle-pack

---

## 🎨 OpenGameArt (Various licenses — check each)

### LPC Sprite Base (Full human characters with animation)
🔗 https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles
- License: CC-BY-SA + GPL  
- Full walk cycles: north/south/east/west
- Multiple character types included

### Top-Down Tiles
🔗 https://opengameart.org/content/top-down-tile-set-for-rpg
- Grass, water, sand, stone tiles

### Free RPG Weather Effects
🔗 https://opengameart.org/content/weather-effects
- Rain, snow, fog sprites

### Fire Animation
🔗 https://opengameart.org/content/fire-animation-2  
- 8-frame fire sprite sheet

---

## 📁 Expected Asset Folder Structure

After downloading, organize like this:

```
assets/
├── terrain/
│   ├── grass.png
│   ├── grass_dark.png
│   ├── water.png
│   ├── deep_water.png
│   ├── beach.png
│   ├── forest.png
│   ├── mountain.png
│   ├── snow.png
│   └── road.png
│
├── buildings/
│   ├── house.png
│   ├── farm.png
│   ├── market.png
│   ├── well.png
│   ├── tavern.png
│   ├── storage.png
│   ├── tower.png
│   └── ruin.png
│
├── characters/
│   ├── farmer_male.png
│   ├── farmer_female.png
│   ├── warrior_male.png
│   ├── warrior_female.png
│   ├── hunter_male.png
│   ├── trader_male.png
│   ├── healer_female.png
│   ├── elder_male.png
│   └── child.png
│
├── animals/
│   ├── wolf.png
│   ├── deer.png
│   ├── cow.png
│   ├── chicken.png
│   └── horse.png
│
├── particles/
│   ├── fire.png
│   ├── smoke.png
│   ├── rain.png
│   ├── snow.png
│   └── dust.png
│
├── objects/
│   ├── tree.png
│   ├── rock.png
│   └── bush.png
│
└── ASSETS.md   ← you are here
```

---

## ⚙️ Enabling Sprite Loading

Once you have PNG files in the correct folders, open `config.js` and change:

```js
rendering: {
  useSprites: false,   // ← Change this to: true
  spritesPath: './assets/',
  ...
}
```

Then update `renderer.js` → `_buildTextures()` to load from files:

```js
// Instead of procedural Graphics:
TEX['tile_3'] = PIXI.Texture.from('./assets/terrain/grass.png');
TEX['building_house'] = PIXI.Texture.from('./assets/buildings/house.png');
// etc.
```

---

## 🆓 License Summary

| Source | License | Commercial Use |
|--------|---------|----------------|
| Kenney.nl | CC0 | ✅ Yes |
| OpenGameArt (LPC) | CC-BY-SA / GPL | ⚠️ Check each |
| OpenGameArt (public domain) | CC0 | ✅ Yes |
