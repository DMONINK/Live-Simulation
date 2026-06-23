# ⚔️ AI Civilization Simulation

A living medieval world simulation running in your browser. Watch hundreds of NPCs live, love, fight, build, trade, and die — with AI APIs (Gemini / Groq / OpenRouter) called only for dramatic, life-changing moments.

![Simulation](https://img.shields.io/badge/Status-Playable-green) ![PixiJS](https://img.shields.io/badge/PixiJS-7.3-blue) ![License](https://img.shields.io/badge/License-MIT-yellow)

---

## ✨ Features

- **Procedural World** — 200×200 tile world with grasslands, rivers, forests, mountains, beaches generated from layered Perlin noise
- **Living NPCs** — 40+ humans with distinct personalities, memories, jobs, families, and relationships
- **AI Decision Engine** — Gemini / Groq / OpenRouter called for betrayal, war, marriage, revenge, and other dramatic moments
- **Memory System** — NPCs remember events; memories decay over time; high-importance memories drive decisions
- **Relationship Web** — Scores from -100 (nemesis) to +100 (spouse) between all pairs of NPCs
- **Village System** — Multiple villages with political relationships that can decay into war
- **War System** — Villages declare war, send raiding parties, burn buildings, and negotiate peace
- **Economy** — Supply/demand pricing, trade between NPCs, resource gathering, market fluctuation
- **Day/Night Cycle** — 24-hour cycle with ambient lighting; NPCs follow schedules
- **Weather System** — Rain, snow, storms, fog with PixiJS particle effects
- **Seasons** — Spring/Summer/Autumn/Winter affect crops, movement, and behavior
- **Building System** — Houses, farms, markets, wells, taverns built by NPC builders
- **No Assets Required** — Works immediately with procedurally-drawn sprites

---

## 🚀 Quick Start

### Option A — Python (simplest, built-in)
```bash
cd AI-Civilization
python3 -m http.server 8080
# Open: http://localhost:8080
```

### Option B — Node.js
```bash
npx serve AI-Civilization
# Open the URL it shows you
```

### Option C — VS Code
Install the **Live Server** extension, right-click `index.html` → "Open with Live Server"

> ⚠️ **Why do I need a server?** ES6 modules (`import/export`) require HTTP — browsers block them on `file://` for security. Any simple HTTP server works.

---

## 🤖 AI API Setup (Optional)

The simulation runs fully **without an API key** using built-in local fallback decisions based on personality traits. To enable real AI decisions for dramatic moments:

### Gemini (Google) — Recommended, generous free tier
1. Go to https://aistudio.google.com/apikey
2. Click "Create API Key"
3. Open `config.js` → paste your key into `gemini.apiKey`
4. Set `provider: "gemini"`

### Groq — Very fast, free tier
1. Go to https://console.groq.com
2. Sign up → API Keys → Create Key
3. Paste into `groq.apiKey` in `config.js`
4. Set `provider: "groq"`

### OpenRouter — Access to 100+ models
1. Go to https://openrouter.ai/keys
2. Create an account → Generate Key
3. Paste into `openrouter.apiKey` in `config.js`
4. Set `provider: "openrouter"`

### Switching Provider
Open `config.js` and change **one line**:
```js
provider: "groq",  // ← change to "gemini" or "openrouter"
```

---

## 📁 Folder Structure

```
AI-Civilization/
│
├── index.html          Entry point — loads PixiJS CDN + starts main.js
├── style.css           UI styles (loading screen, HUD, inspector)
├── config.js           All settings (AI provider, world size, simulation params)
│
├── main.js             Game loop, PixiJS app, initialization
├── world.js            Central orchestrator — owns all entities and systems
├── renderer.js         PixiJS rendering — textures, sprites, chunk baking
│
├── terrain.js          Procedural terrain generation (Perlin noise, biomes, rivers)
├── time.js             Day/night cycle, seasons, ambient lighting
├── weather.js          Weather states, particle effects (rain/snow/fog)
├── camera.js           Viewport camera (pan, zoom, follow, cull)
│
├── agent.js            Base entity class (movement, needs, state machine core)
├── human.js            NPC with full AI: jobs, personality, family, memory, AI calls
├── animal.js           Animal AI: predator/prey, herding, reproduction
│
├── memory.js           NPC episodic memory system with decay
├── relationship.js     Relationship scores (-100 to +100) between all pairs
├── ai.js               AI API integration (Gemini/Groq/OpenRouter) with queuing
│
├── building.js         Building types, construction, fire damage
├── economy.js          Supply/demand pricing, trade recording, tax collection
├── war.js              War declarations, raids, peace negotiations
│
├── spatial.js          Spatial hash grid for O(1) proximity queries
├── utils.js            Perlin noise, EventEmitter, ObjectPool, math helpers
├── ui.js               HTML HUD, event log, inspector, village panel
│
└── assets/
    └── ASSETS.md       Where to download free sprite assets
```

---

## 🧠 How Humans Think

Each human has a **priority-based state machine**. At every decision point, it checks:

```
Priority 1: Am I starving? → eat or find food
Priority 2: Is it bedtime? → go home and sleep
Priority 3: Am I hungry?  → eat if food available
Priority 4: Job task      → farm / hunt / build / trade / patrol
Priority 5: Social        → find someone nearby to talk to
(default)   Wander        → explore the area
```

States NPCs can be in:
`idle | wander | eat | sleep | work | farm | hunt | build | trade | socialize | flee | fight | mourn | celebrate | patrol | heal | gather | romance`

### The AI Decision Trigger
The AI API is called **only** for these high-impact moments:
- Witnessing betrayal by a friend
- Family member murdered
- Village attacked / war declared
- Revenge opportunity
- Marriage proposal
- Strategic military choices

**Example prompt sent to the AI:**
```
You are Emma. Age 24. Personality: Kindness:90, Bravery:70, Greed:20, Morality:85

Significant Memories:
• "Jack stole my food" (2 hours ago, feeling anger, importance 6/10)
• "Jack lied to me about the raid" (1 day ago, feeling betrayal, importance 8/10)
• "Jack killed my father" (3 days ago, feeling grief, importance 10/10)

Relationship with Jack: genuine enemy — you despise them (score -95/100)

CRITICAL DECISION — BETRAYAL:
Jack stands before you. What would Emma realistically do?

Respond ONLY with JSON:
{"goal":"...","emotion":"...","reason":"...","next_action":"..."}
```

---

## 🌍 How World Generation Works

1. **Height map** — 7-octave Perlin noise creates elevation. Island-style edge fade creates ocean borders.
2. **Moisture map** — Second noise layer determines wet/dry areas.
3. **Biome assignment** — Height + moisture → tile type (water/beach/grass/forest/highland/mountain/snow)
4. **Rivers** — Traced from highland tiles flowing downhill to water using greedy descent.
5. **Forests** — High-detail noise creates organic forest patches.
6. **Village zones** — Flat, passable areas far from each other become village sites.
7. **Roads** — Bresenham's line algorithm connects villages with wandering roads.
8. **Resource nodes** — Trees, rocks, bushes seeded across appropriate biomes.

---

## 🏘️ Village Dynamics

Each village starts with:
- 1 well, 1 market, 1 tavern
- 8 houses, 4 farms, 2 watch towers
- ~13 NPCs with varied jobs (farmers, warriors, hunters, builders, traders, healers, elders, children)

Villages have **relations scores** (-100 to +100). Relations degrade when:
- One village's warrior kills another's civilian
- Resources become scarce (food shortage)
- Raiders attack the other village

When relations drop below -75, war can be declared.

---

## ⚡ Performance Optimizations

| Technique | Benefit | Where |
|-----------|---------|-------|
| Chunk baking | Each 16×16 terrain chunk rendered once to RenderTexture | renderer.js |
| Spatial hashing | O(1) entity proximity queries instead of O(n²) | spatial.js |
| Entity update throttling | Animals updated every 2 frames | world.js |
| Visibility culling | Only visible chunks rendered | renderer.js |
| AI rate limiting | Max 1 API call per 6 seconds globally | ai.js |
| Memory decay | Old, trivial NPC memories removed automatically | memory.js |
| Dead entity cleanup | Corpses removed from spatial hash immediately | world.js |

---

## 🔧 How to Add New Characters

1. Add a new job to `JOBS` in `human.js`:
```js
export const JOBS = {
  ...
  BLACKSMITH: 'blacksmith',  // ← new
};
```

2. Add a color in `JOB_COLORS`:
```js
[JOBS.BLACKSMITH]: 0x546E7A,  // steel blue
```

3. Handle the job in `_assignJobTask()` in `human.js`:
```js
case JOBS.BLACKSMITH: this._taskSmith(world); break;
```

4. Implement the task method:
```js
_taskSmith(world) {
  // Create weapons from wood + stone
  if (this.inventory.wood >= 3 && this.inventory.stone >= 2) {
    this.inventory.wood  -= 3;
    this.inventory.stone -= 2;
    this.inventory.weapon = (this.inventory.weapon || 0) + 1;
    world.events?.emit('log_event', { message: `${this.name} forged a weapon!` });
  }
  this.setState(HUMAN_STATE.IDLE);
}
```

5. Add it to the spawn distribution in `world.js → _spawnHumans()`.

---

## 🏗️ How to Add New Buildings

1. Add to `BUILDING_TYPES` in `building.js`:
```js
export const BUILDING_TYPES = {
  ...
  FORGE: 'forge',
};
```

2. Add costs and build time:
```js
export const BUILD_COSTS = { ..., [BUILDING_TYPES.FORGE]: { wood: 8, stone: 12 } };
export const BUILD_TIME  = { ..., [BUILDING_TYPES.FORGE]: 40 };
```

3. Add colors for procedural rendering:
```js
export const BUILD_COLORS = {
  ...,
  [BUILDING_TYPES.FORGE]: { wall: 0x546E7A, roof: 0x37474F, door: 0x263238 }
};
```

4. The renderer automatically generates a sprite for it using the colors.

---

## 🌦️ How to Add New Weather

1. Add to `WEATHER` in `weather.js`:
```js
export const WEATHER = { ..., BLIZZARD: 'blizzard' };
```

2. Add transition probability, properties, and particle spawn logic following the existing patterns.

---

## 📈 Scaling to 1000 NPCs

The current default is 40 humans for readability. To scale up:

1. In `config.js`, change:
```js
simulation: {
  initialHumans: 500,
  initialAnimals: 200,
}
```

2. Increase world size:
```js
world: {
  tilesWide: 400,
  tilesHigh: 400,
}
```

3. Performance tips for large populations:
   - Increase spatial hash cell size in `spatial.js` (try `cellSize: 192`)
   - In `world.js`, update animals every 3 frames instead of 2
   - Disable name labels: `CONFIG.rendering.showNames = false`
   - Reduce `maxMemoriesPerHuman` to `10`

4. Consider Web Workers for NPC update logic (advanced)

---

## 🗺️ Future Roadmap

- [ ] **Multiplayer** — Multiple browser tabs sharing a world via WebSockets
- [ ] **Religion system** — Temples, rituals, holy wars, prophets
- [ ] **Crafting chains** — Iron → weapons, wool → cloth → trade goods
- [ ] **Genetic inheritance** — Children inherit blended personality traits
- [ ] **Diplomacy** — Treaties, alliances, trade agreements between villages
- [ ] **Natural disasters** — Floods, plagues, wildfires
- [ ] **Music system** — Adaptive ambience using Web Audio API
- [ ] **Save/Load** — localStorage or IndexedDB persistence
- [ ] **Zoom-to-detail** — Different visual detail levels at different zoom levels
- [ ] **NPC dialogue** — Speech bubbles showing what NPCs are thinking/saying
- [ ] **Mini-map** — Canvas-based overview of entire world
- [ ] **Historical record** — Scrollable chronicle of major events

---

## 🐛 Common Issues

**"Cannot use import statement outside a module"**
→ You're opening the HTML file directly (`file://`). Use a local server instead.

**Black screen / PixiJS not loading**
→ Check internet connection (PixiJS loads from CDN). Try refreshing.

**Very slow FPS**
→ Reduce `initialHumans` in `config.js`. Enable `showNames: false`.

**AI calls failing**
→ Check your API key in `config.js`. Verify you have free credits remaining.

**Trees/buildings not appearing**
→ Wait a moment — resources are only rendered for the first 800 nodes.

---

## 📄 License

MIT — free for personal and commercial use.

Built with [PixiJS](https://pixijs.com) · AI via [Gemini](https://aistudio.google.com) / [Groq](https://groq.com) / [OpenRouter](https://openrouter.ai)
