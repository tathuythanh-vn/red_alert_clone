# Command & Conquer: Red Alert — Web Tactical Command (`red_alert_clone`)

A zero-dependency, browser-based **Command & Conquer: Red Alert** real-time strategy (RTS) game built with vanilla HTML5 Canvas and a procedural Web Audio API synthesizer + Web Speech API EVA announcer.

---

## Overview & Key Features

- **Allied Forces vs. Soviet Union Factions**:
  - **Allied Forces** (`🦅`): `+15% Unit Speed & Chrono Tech` — Longbow Apaches, Gunboats, Destroyers, Cruisers, Spies, Thieves, Chrono Tanks, Tanya, and the Chronosphere.
  - **Soviet Union** (`☭`): `+15% Armor & Tesla/Heavy Tech` — Heavy & Mammoth Tanks, V2 Rocket Launchers, Tesla Coils, Shock Troopers, Attack Dogs, M.A.D. Tanks, Hind Gunships, Yak & MiG-29 Aircraft, Torpedo Submarines, and the Iron Curtain.
- **3-Mission Story Campaign & Progression**:
  - **Mission 1 (Allied — European Temperate)**: *Operation: Iron Dawn* — Establish a base, harvest ore, and destroy the Soviet outpost.
  - **Mission 2 (Soviet — Siberian Winter)**: *Operation: Red Storm* — Crush the entrenched Allied river defense using Heavy Tanks and Tesla Coils.
  - **Mission 3 (Final — North African Arid)**: *Operation: Apocalypse* — High-tech total war with Superweapons and Mammoth Tanks.
  - Automatic campaign unlock progression and evaluation rank badges (`S` / `A` / `B` / `C`) persisted in `localStorage`.
- **Multi-AI Custom Skirmish**:
  - Battle against **1 to 3 autonomous AI commanders** (`Duel`, `3-Way`, or `4-Corner`) across **3 Environmental Theaters** (`Temperate`, `Snow`, `Desert`).
  - Selectable AI Doctrines (`Balanced`, `Rush`, `Turtle`, `Air & Naval`), starting credits, and AI difficulty (`Easy`, `Medium`, `Hard`).
- **Three-Domain Combined Arms (Land, Air & Naval)**:
  - **Land**: Infantry, Battle Tanks, Artillery, V2 Rockets, Engineers, Specialists, and Ore Harvesters.
  - **Air**: Helipads & Airfields launching VTOL gunships (`Longbow Apache`, `Hind`) and fixed-wing strike aircraft (`Yak`, `MiG-29`) with finite ammo payloads and automatic sortie return/reload.
  - **Naval**: Coastal Naval Yards & Sub Pens constructing `Gunboats`, `Destroyers`, 8-inch `Cruisers`, and stealth `Torpedo Submarines` with sonar detection and depth-charge counterplay.
- **Superweapons**:
  - **Chronosphere** (instant squad teleportation), **Iron Curtain** (temporary invulnerability shield), and **Nuclear Missile Silo** (devastating tactical warhead with fallout crater).
- **Fortifications, Supply Crates & Environmental Destruction**:
  - Auto-tiling **Sandbag**, **Wire Fence**, and **Concrete Walls** (`4-bit` neighbor bitmask connections).
  - Random and fixed **Bonus Supply Crates** (`Credits`, `Group Heal`, `Veterancy Promotion`, `Satellite Map Reveal`, `Free Tank`, and `Nuke Trap`).
  - **Destructible & Repairable Bridges**: Demolish river spans (`Ctrl + Right-Click` force-fire or heavy explosives) to sever enemy routes or sink crossing armor; send an **Engineer** into a **Bridge Repair Hut** to rebuild the span.
- **Tactical Command & Economy Scaling**:
  - **Unit Stances** (`Aggressive`, `Guard`, `Hold Ground`, `Hold Fire`), **Queued Waypoints** (`Shift + Right-Click`), and **Patrol Routes** (`P`).
  - **Primary Building (`[PRI]`)** designation and **Multiple-Factory Speed Multiplier** (up to `2.0x` production speed with multiple Construction Yards, Barracks, War Factories, Airfields, or Naval Yards).
- **Save / Load Persistence & Battlefield Polish**:
  - Instant `localStorage` **Quicksave (`F5`)** and **Quickload (`F9`)**, plus portable **JSON Save Export / Import** from the Pause Menu.
  - Smooth cursor-centered **Mouse-Wheel Camera Zoom** (`0.6x` – `1.5x`), persistent **Battlefield Decals** (scorch craters, structural rubble, tank track marks), and **Radar Event Pings** with `Spacebar` alert jumping.
- **Procedural Audio & EVA Telemetry**:
  - Built-in 111 BPM industrial military synth march ("Hell March" homage), 30+ synthesized combat sound effects, and voice announcements.

---

## Controls & Hotkeys

| Input / Hotkey | Action |
| :--- | :--- |
| **Left-Click / Drag** | Select unit/building or drag marquee selection box |
| **Double Left-Click** | Select all visible units of the same type on screen (or set Primary Building) |
| **Right-Click** | Contextual order: Move, Attack enemy, Harvest ore, Capture/Infiltrate (`Engineer`/`Spy`/`Thief`), Repair at Service Depot |
| **`Shift` + Right-Click** | Queue sequential movement/combat waypoints (`1`, `2`, `3`...) |
| **`Ctrl` + Right-Click** | Force-fire on ground or demolish bridges |
| **Mouse Wheel** | Smooth camera zoom in/out (`0.6x` to `1.5x`) centered on cursor |
| **Middle-Drag / Edge Pan** | Pan tactical camera across the battlefield |
| **`W` / `A` / `S` / `D` or Arrows** | Pan tactical camera (when not using command hotkeys) |
| **`1` – `9`** | Recall control group (`Ctrl + 1..9` to assign selected units) |
| **`A`** | Attack-Move mode (units move to target and engage enemies along the route) |
| **`S`** | Stop current orders and hold position |
| **`D`** | Deploy selected unit (`MCV` → Construction Yard, `Chrono Tank` → Chrono Blink, `M.A.D. Tank` → Seismic Shockwave) |
| **`P`** | Patrol mode (oscillate and engage enemies between current position and clicked point) |
| **`G`** | Guard mode / cycle unit stance (`Aggressive` / `Guard` / `Hold Ground` / `Hold Fire`) |
| **`X`** | Scatter selected units to evade splash damage or tank crushing |
| **`R`** | Toggle building repair mode (`wrench` cursor) |
| **`F`** | Toggle building sell mode (`$` cursor — refunds 50% cost) |
| **`H`** | Center camera on friendly Construction Yard / Primary Base |
| **`Spacebar`** | Jump camera to the latest Radar Alert event (press again to return to base) |
| **`F5`** | Quicksave current battle state to `localStorage` |
| **`F9`** | Quickload saved battle state from `localStorage` |
| **`M`** | Toggle procedural soundtrack & audio mute |
| **`ESC`** | Cancel active placement/targeting mode or open Pause & Save/Load Modal |

---

## Project Structure

```text
red_alert/
├── index.html                  # Main application shell, HUD layout, and modal screens
├── plan.md                     # Architectural specification and Phase 1-5 engineering roadmap
├── README.md                   # Documentation, controls, and deployment guide
├── .nojekyll                   # Bypasses Jekyll processing on GitHub Pages
├── .gitignore                  # Standard ignore rules for temporary/OS files
├── .github/
│   └── workflows/
│       └── pages.yml           # Automated GitHub Actions deployment to GitHub Pages
└── src/
    ├── styles.css              # Retro-industrial military command UI & CRT styling
    ├── data.js                 # Factions, Buildings, Units, Superweapons, Theaters & Missions
    ├── audio.js                # Procedural Web Audio API synthesizer & EVA announcer
    ├── map.js                  # Mulberry32 terrain generator, A* pathfinder, Fog of War & Bridges
    ├── entities.js             # Entity, Building, Unit, Projectile, Particle & FloatingText classes
    ├── engine.js               # Core RTS simulation loop, AI commander, Crates & Save/Load serializer
    ├── renderer.js             # 2D Canvas terrain/sprite renderer, decals, zoom & radar minimap
    └── main.js                 # DOM HUD controller, input bindings, Skirmish & Campaign manager
```

---

## Local Quickstart

Because the game uses zero external dependencies or bundlers, you can launch it directly with any static HTTP server:

```bash
# Option 1: Using Node.js (npx)
npx serve .

# Option 2: Using Python 3
python -m http.server 8080
```

Then open `http://localhost:8080` (or the port printed in your terminal) in any modern browser (Chrome, Edge, Firefox, or Safari).

---

## GitHub Pages Deployment

This repository includes a pre-configured GitHub Actions workflow (`.github/workflows/pages.yml`) and `.nojekyll` marker for zero-build static deployment:

1. Push the repository to GitHub on the `main` branch.
2. In your GitHub repository, navigate to **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Note: If the repository is **Private**, GitHub Pages requires a GitHub Pro, Team, or Enterprise plan (or changing repository visibility to **Public** on GitHub Free).
5. Every push to `main` (or manual trigger from the **Actions** tab) automatically publishes the root static site to your GitHub Pages URL.
