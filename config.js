// ============================================================
// config.js — Central configuration for AI Civilization Sim
// Change `provider` to switch AI backend. Add your API key.
// ============================================================

const CONFIG = {

  // ─── AI Provider ──────────────────────────────────────────
  // Options: "gemini" | "groq" | "openrouter"
  provider: "gemini",

  gemini: {
    apiKey: "",   // Get free at: https://aistudio.google.com/apikey
    model: "gemini-2.5-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models"
  },

  groq: {
    apiKey: "",   // Get free at: https://console.groq.com
    model: "llama-4-scout-17b-16e-instruct",
    endpoint: "https://api.groq.com/openai/v1/chat/completions"
  },

  openrouter: {
    apiKey: "",   // Get free at: https://openrouter.ai/keys
    model: "deepseek/deepseek-r1-0528",
    endpoint: "https://openrouter.ai/api/v1/chat/completions"
  },

  // ─── World Settings ───────────────────────────────────────
  world: {
    tilesWide: 200,          // World width in tiles
    tilesHigh: 200,          // World height in tiles
    tileSize: 32,            // Pixels per tile
    chunkSize: 16,           // Tiles per chunk side (16×16 = 256 tiles)
    seed: Math.random() * 99999 | 0,
    riverCount: 4,
    mountainClusters: 6,
    forestDensity: 0.18,
  },

  // ─── Simulation Settings ──────────────────────────────────
  simulation: {
    initialHumans: 40,
    initialAnimals: 60,
    initialVillages: 3,
    targetFPS: 60,
    aiCallCooldownMs: 6000,  // Minimum ms between AI API calls globally
    maxMemoriesPerHuman: 25,
    memoryDecayRate: 0.02,   // Per game-day importance loss
    maxRelationships: 50,
    gameSpeedMultiplier: 1,  // 1 = normal, 2 = double, etc.
    pauseOnAICall: false,
  },

  // ─── Time Settings ────────────────────────────────────────
  time: {
    secondsPerGameMinute: 0.5,  // Real seconds = 1 in-game minute
    minutesPerHour: 60,
    hoursPerDay: 24,
    daysPerSeason: 30,
    seasons: ["Spring", "Summer", "Autumn", "Winter"],
    startHour: 6,            // Simulation starts at 6am
  },

  // ─── Rendering Settings ───────────────────────────────────
  rendering: {
    useSprites: false,       // Set true when sprite PNGs are in ./assets/
    spritesPath: "./assets/",
    showDebug: false,
    showNames: true,
    showHealthBars: true,
    ambientLight: { day: 0xFFFFCC, night: 0x001133 },
    viewportPadding: 2,      // Extra chunks to preload around viewport
  },

  // ─── Economy Settings ─────────────────────────────────────
  economy: {
    startingGold: 50,
    basePrices: {
      food: 5, wood: 8, stone: 10, water: 3, cloth: 12, weapon: 25
    },
    priceFluctuation: 0.3,   // ±30% from base
  },

  // ─── Combat Settings ──────────────────────────────────────
  combat: {
    attackRange: 48,
    attackCooldown: 1500,    // ms between attacks
    fleeHealthThreshold: 0.25,
    warDeclarationThreshold: -75, // Village relation below this → war possible
  },

  // ─── Names Database ───────────────────────────────────────
  names: {
    male: [
      "Aldric","Bjorn","Caius","Doran","Edric","Fenwick","Garrett","Harald",
      "Ivan","Jasper","Kael","Leif","Magnus","Nikos","Oswald","Percival",
      "Quinn","Roland","Soren","Taric","Ulric","Vance","Willem","Xander","Yorick","Zane"
    ],
    female: [
      "Aelith","Brenna","Cora","Dagna","Elara","Freya","Gwen","Hilde",
      "Isla","Jora","Kira","Lyra","Mira","Nessa","Oria","Petra",
      "Quinn","Rhea","Sable","Tara","Una","Vera","Wren","Xena","Yvaine","Zara"
    ],
    villages: [
      "Ashford","Brimstone","Clearwater","Dunwall","Eldergrove",
      "Frostholm","Grimhaven","Highvale","Irondale","Jademill"
    ]
  }
};

export default CONFIG;
