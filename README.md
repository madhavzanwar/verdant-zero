# VERDANT ZERO // 2150 METACITY

> A visually stunning 3D cyberpunk browser game made with **Three.js** and **Vite**, calibrated for a rock-solid **60 FPS** on standard laptops. Pure client-side — zero backend, zero paid APIs.

---

## 🌿 Narrative Lore

> *The year is 2150. A dead neon cyberpunk metacity has lost all its green under suffocating layers of carbon and neon darkness. You play as **UNIT-7**, a small maintenance robot possessing the ecosystem's very last living seed. Your mission is to plant seeds and guide glowing bioluminescent vines skyward, turning cold obsidian skyscrapers into a thriving green canopy.*

---

## 🏗️ Architecture & Code Organization

```text
verdant-zero/
├── index.html              # Main HTML entry with semantic HUD & glassmorphism
├── package.json            # Scripts & dependencies (Three.js + Vite)
├── vite.config.js          # Vite dev server & production bundling setup
├── .gitignore              # Git ignore rules
├── public/                 # Static assets directory
└── src/
    ├── main.js             # Application bootstrap & lifecycle orchestrator
    ├── core/
    │   ├── Engine.js       # Three.js renderer (ACES Filmic tone mapping, 60fps loop, clamped DPR)
    │   ├── AudioManager.js # Procedural Web Audio API synthesizer (ambient drone & cyber UI SFX)
    │   ├── GameState.js    # State machine (TITLE, PLAYING), high-score & combo management
    │   └── InputManager.js # Keyboard, pointer & touch event normalization
    ├── scenes/
    │   └── TitleScene.js   # 3D Cyberpunk scene: volumetric fog, skyscrapers, glowing seed pod
    ├── ui/
    │   └── TitleScreen.js  # Glassmorphism title overlay, telemetry HUD, modal interactions
    └── styles/
        └── main.css        # Design tokens, CRT scanlines, glassmorphism, responsive styles
```

---

## 🚀 Running the Project

### Option 1: Standard Vite Development Server (Recommended)
```bash
# 1. Install dependencies
npm install

# 2. Launch Vite development server (hot module reloading)
npm run dev
```

### Option 2: Production Build & Preview
```bash
npm run build
npm run preview
```

---

## 🎨 Visual Design & Performance Features

- **60 FPS Laptop Optimization**: WebGL DPR clamped to `1.5` prevents thermal throttling on Retina/4K screens while preserving razor-sharp visuals. Instanced skyscraper rendering ensures single-digit draw calls.
- **Volumetric Cyberpunk Fog**: `THREE.FogExp2` creates deep atmospheric depth across the metacity canyon.
- **The Genesis Seed Pod**: Glowing emerald bioluminescent centerpiece hovering in front of the camera with rotating cybernetic holographic rings.
- **Glassmorphism HUD**: High-tech translucent UI panels with `backdrop-filter: blur(16px)` and neon accents.
- **Synthesized Audio Engine**: Zero external MP3/WAV files! Procedural Web Audio API generates dark cyberpunk ambient drones, filter-sweep whooshes, and resonant UI chimes.
- **Replayability Architecture**: `GameState` tracks high scores, max combos, and session scores persisted via `localStorage`.
