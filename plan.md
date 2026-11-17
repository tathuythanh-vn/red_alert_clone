# Command & Conquer: Red Alert — Web Tactical Command
## Phase 2 Engineering Roadmap & Architectural Specification (`plan.md`)

---

## 1. Current Architecture & Baseline Summary

**Command & Conquer: Red Alert — Web Tactical Command** is a zero-dependency, vanilla HTML5 Canvas + Web Audio API real-time strategy game. All modules attach exports to the global `window.RA` namespace and load synchronously via `<script>` tags in `index.html`.

### 1.1 Module Inventory & Namespace Contracts

| File | Lines | `window.RA` Exports | Core Responsibilities & Baseline Capabilities |
| :--- | :---: | :--- | :--- |
| `index.html` | 562 | DOM Shell | 4 screens (`#menu-screen`, `#briefing-screen`, `#game-screen`, `#gameover-screen`), 2 modals (`#pause-modal`, `#controls-modal`), `#battlefield-canvas`, `#minimap-canvas`, 4-tab sidebar (`building`, `defense`, `infantry`, `vehicle`), `#superweapons-panel`, `#selection-inspector`, `#bottom-command-bar`. |
| `src/styles.css` | 1,770 | CSS Tokens & Layout | Retro-industrial military command UI, Allied (`#3b82f6`) & Soviet (`#ef4444`) CSS themes, CRT scanlines, phosphor green/amber/red meters, production grid cards, and responsive viewport lock (`100vw x 100vh`). |
| `src/data.js` | 877 | `TILE_SIZE` (`40`), `MAP_WIDTH` (`64`), `MAP_HEIGHT` (`64`), `DATA`, `createSkirmishMission` | Static definitions for `FACTIONS` (`allied`, `soviet`), 12 `BUILDINGS` (`conyard`, `power`, `advpower`, `refinery`, `barracks`, `weap`, `radar`, `fix`, `pillbox`, `turret`, `tesla`, `silo`), 13 `UNITS` (`rifle`, `rocket`, `engineer`, `tanya`, `harvester`, `ranger`, `ltnk`, `mtnk`, `htnk`, `mammoth`, `v2rl`, `arty`, `mcv`), 3 `SUPERWEAPONS` (`chronosphere`, `ironcurtain`, `nuke`), and 3 campaign `MISSIONS`. |
| `src/audio.js` | 499 | `audio` | Procedural Web Audio API synthesizer (`_triggerTone`, `_triggerNoise`), 111 BPM industrial "Hell March" bass/snare/synth step sequencer (`startMusic`, `stopMusic`), 21 combat/UI SFX (`playSfx`), and Web Speech API EVA announcer (`speak`) synced to `#eva-message`. |
| `src/map.js` | 1,076 | `TILE_TYPES`, `FOG`, `GameMap` | Deterministic Mulberry32 PRNG terrain generator (64×64 tiles, sinusoidal river, bridges, dirt roads, rock ridges, ore/gem fields, 17×17 base plateaus), zero-GC binary `MinHeap` A* pathfinder (`findPath`), building footprint & 5-tile base adjacency validator (`getTilePlacementStatus`), ore harvesting/regrowth (`harvestTile`, `regrowOre`), and 3-state Fog of War (`UNEXPLORED`, `EXPLORED`, `VISIBLE`). |
| `src/entities.js` | 1,305 | `Entity`, `Building`, `Unit`, `Projectile`, `Particle`, `FloatingText` | Base `Entity` damage/veterancy/retaliation (`takeDamage`, `onDeath`), `Building` repair/service-depot heal/turret auto-fire (`update`, `fireAt`), `Unit` state machine (`idle`, `move`, `attackMove`, `attack`, `harvest`, `returnOre`, `capture`, `repair`, `deploy`), tank infantry crushing (`checkCrush`), unit separation (`applySeparation`), and projectile ballistics/splash (`Projectile.update`, `explode`). |
| `src/engine.js` | 1,987 | `GameEngine` | Master simulation loop (`update`), mission & base spawner (`startMission`, `_spawnPlayerBase`, `_spawnEnemyBase`), power & radar grid (`recalculatePower`), tech tree resolver (`getAvailableTech`), incremental pay-as-you-build production queues (`startProduction`, `cancelProduction`, `placeBuilding`, `_updateTeamProduction`), superweapon recharge & detonation (`activateSuperweapon`, `detonateNukeAt`), tactical orders (`issueOrder`, `toggleRepair`, `sellBuilding`), and autonomous AI commander (`updateAI`). |
| `src/renderer.js` | 1,727 | `Renderer` | Frustum-culled 2D Canvas renderer (`render`), procedural terrain & animated water/ore shaders (`_renderTerrain`), bespoke vector sprites for all 12 buildings (`_drawBuildingSprite`) and 13 units (`_drawInfantrySprite`, `_drawVehicleSprite`), Tesla lightning arcs (`_drawTeslaArc`), Fog of War pass (`_renderFogOfWar`), placement footprint & superweapon reticles (`_renderWorldOverlays`), and 256×256 radar minimap (`renderMinimap`). |
| `src/main.js` | 2,124 | `app` (`TacticalCommandApp`) | Screen state machine (`showScreen`), briefing teletype, 15Hz DOM HUD synchronizer (`syncHUD`, `syncProductionGrid`, `syncSuperweaponsPanel`, `syncSelectionInspector`), mouse drag-box & double-click type selection, contextual right-click orders (`handleRightClick`), control groups `1..9`, and hotkeys (`W/A/S/D`, `Space`, `D`, `A`, `S`, `G`, `R`, `X`, `F`, `M`, `ESC`). |

---

## 2. Phase 1: Air & Naval Warfare Expansion

Expands combat from single-layer ground engagements into full three-domain warfare (`land`, `air`, `naval`), utilizing the existing river/lake water tiles and adding aerial strike & gunship capabilities plus anti-air/anti-submarine counterplay.

### 2.1 New Buildings (`src/data.js` → `window.RA.DATA.BUILDINGS`)

| ID | Name | Category | Faction | Cost / Time | HP / Power | Footprint | Prereqs | Combat / Special Properties |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| `helipad` | Helipad | `building` | `both` | `$1500` / `12s` | `800` / `-30` | `[2, 2]` | `['conyard', 'radar']` | Produces `heli` (Allied) & `hind` (Soviet). Reloads/repairs landed VTOL aircraft (`maxAmmo` restore at 1 ammo/2s). |
| `afld` | Airfield | `building` | `soviet` | `$1200` / `11s` | `900` / `-40` | `[3, 2]` | `['conyard', 'radar']` | Produces fixed-wing `yak` and `mig` strike aircraft. Houses home-pad coordinate for sortie return. |
| `syrd` | Allied Naval Yard | `building` | `allied` | `$1000` / `10s` | `1000` / `-30` | `[3, 3]` | `['conyard', 'power']` | `waterOnly: true`. Produces `gnbt`, `dd`, `ca`. Passively repairs friendly naval vessels within `2.8` tiles. |
| `spen` | Soviet Sub Pen | `building` | `soviet` | `$1000` / `10s` | `1000` / `-30` | `[3, 3]` | `['conyard', 'power']` | `waterOnly: true`. Produces `ss` (Submarine). Passively repairs friendly Soviet naval units within `2.8` tiles. |
| `sam` | SAM Site | `defense` | `soviet` | `$750` / `8s` | `650` / `-40` | `[2, 1]` | `['conyard', 'radar']` | `antiAirOnly: true`, `range: 380`, `damage: 85`, `fireRate: 1.1`, `splash: 20`, `projectileType: 'sam_missile'`. |
| `agun` | AA Flak Gun | `defense` | `allied` | `$600` / `7s` | `600` / `-35` | `[1, 1]` | `['conyard', 'radar']` | `antiAirOnly: true`, `range: 360`, `damage: 55`, `fireRate: 0.65`, `splash: 28`, `projectileType: 'flak'`. |

### 2.2 New Units (`src/data.js` → `window.RA.DATA.UNITS`)

| ID | Name | Category | Locomotion | Faction | Producer / Prereq | Cost / Time | HP / Speed | Combat Profile (`range`, `damage`, `fireRate`, `projectileType`, targeting flags) |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `heli` | Longbow Apache | `aircraft` | `'air'` | `allied` | `helipad` / `['helipad']` | `$1200` / `12s` | `280` / `175` | `range: 250`, `damage: 65`, `fireRate: 0.9`, `splash: 20`, `projectileType: 'rocket'`, `canTargetAir: true`, `maxAmmo: 6`. |
| `hind` | Hind Gunship | `aircraft` | `'air'` | `soviet` | `helipad` / `['helipad']` | `$1200` / `12s` | `360` / `155` | `range: 220`, `damage: 42`, `fireRate: 0.5`, `splash: 12`, `projectileType: 'bullet'`, `canTargetAir: false`, `maxAmmo: 8`. |
| `yak` | Yak Attack Plane | `aircraft` | `'air'` | `soviet` | `afld` / `['afld']` | `$800` / `9s` | `220` / `230` | `range: 240`, `damage: 38`, `fireRate: 0.35`, `splash: 15`, `projectileType: 'bullet'`, `strafeRun: true`, `maxAmmo: 5`. |
| `mig` | MiG-29 Strike Jet | `aircraft` | `'air'` | `soviet` | `afld` / `['afld', 'radar']` | `$1400` / `13s` | `250` / `270` | `range: 280`, `damage: 110`, `fireRate: 1.4`, `splash: 36`, `projectileType: 'rocket'`, `canTargetAir: true`, `maxAmmo: 4`. |
| `gnbt` | Gunboat | `naval` | `'naval'` | `allied` | `syrd` / `['syrd']` | `$500` / `6s` | `420` / `115` | `range: 220`, `damage: 40`, `fireRate: 0.9`, `splash: 15`, `projectileType: 'shell'`, `antiSub: true` (depth charges). |
| `dd` | Destroyer | `naval` | `'naval'` | `allied` | `syrd` / `['syrd', 'radar']` | `$1000` / `10s` | `780` / `95` | `range: 280`, `damage: 70`, `fireRate: 1.2`, `splash: 24`, `projectileType: 'rocket'`, `canTargetAir: true`, `antiSub: true`, `sonarRange: 260`. |
| `ca` | Allied Cruiser | `naval` | `'naval'` | `allied` | `syrd` / `['syrd', 'radar']` | `$2000` / `16s` | `1300` / `70` | `range: 480`, `damage: 180`, `fireRate: 3.4`, `splash: 65`, `projectileType: 'shell'` (8-inch naval bombardment). |
| `ss` | Torpedo Submarine | `naval` | `'naval'` | `soviet` | `spen` / `['spen']` | `$950` / `10s` | `520` / `85` | `range: 270`, `damage: 115`, `fireRate: 2.0`, `splash: 20`, `projectileType: 'torpedo'`, `navalOnlyTarget: true`, `cloaked: true` (submerged until firing or detected within `sonarRange`). |

### 2.3 Engine, Map & Renderer Changes

1. **Multi-Domain Passability & Pathfinding (`src/map.js`)**:
   - Update `isPassable(tx, ty, locomotionOrIsInfantry = 'land', ignoreBuildingId = null)`:
     - Backwards-compatible: if boolean `true`/`false` is passed, treat as `'land'`.
     - `locomotion === 'air'`: returns `this.inBounds(tx, ty)` (ignores water, rocks, bridges, and buildings).
     - `locomotion === 'naval'`: returns `tile.type === TILE_TYPES.WATER` (or `TILE_TYPES.BRIDGE` under-span passability when no land unit occupies it) and `tile.buildingId === null`.
   - Update `findPath(startWx, startWy, goalWx, goalWy, locomotion = 'land', ignoreBuildingId = null)`:
     - When `locomotion === 'air'`, bypass A* grid search and return a direct 1-element waypoint `[{ x: goalWx, y: goalWy }]` clamped to map bounds.
     - When `locomotion === 'naval'`, run A* restricted to `WATER` tiles.
   - Update `getTilePlacementStatus(tx, ty, w, h, team, entities, ignoreEntity, def = null)`:
     - When `def && def.waterOnly === true` (`syrd`, `spen`), require all footprint tiles to be `TILE_TYPES.WATER` and allow up to `8`-tile adjacency from the nearest friendly structure so coastal rivers/lakes are reachable from land bases.

2. **Air/Sub Targeting Rules & Altitude Physics (`src/entities.js`)**:
   - In `Unit` constructor:
     - `this.locomotion = this.def.locomotion || (this.category === 'aircraft' ? 'air' : this.category === 'naval' ? 'naval' : 'land')`.
     - `this.altitude = this.locomotion === 'air' ? 28 : 0` (interpolates to `0` when landed on `helipad`/`afld`, and `28` when airborne).
     - `this.ammo = this.def.maxAmmo !== undefined ? this.def.maxAmmo : -1; this.maxAmmo = this.ammo`.
     - `this.submerged = this.defId === 'ss'` (uncloaks for `3.0s` upon firing or when within an enemy `dd`/`gnbt` `sonarRange`).
   - Add `Entity.prototype.canTarget(target)`:
     - If `target.locomotion === 'air'` and `target.altitude > 4`: attacker must have `this.def.canTargetAir || this.def.antiAirOnly || this.defId === 'rocket' || this.defId === 'mammoth' || this.defId === 'sam' || this.defId === 'agun' || this.defId === 'dd' || this.defId === 'heli' || this.defId === 'mig'`.
     - If `this.def.antiAirOnly`: can *only* target `target.locomotion === 'air'`.
     - If `this.def.navalOnlyTarget` (`ss` Submarine): can *only* target `target.locomotion === 'naval'` or `target.def.waterOnly`.
     - If `target.submerged` (`ss` Submarine): attacker must have `this.def.antiSub` (`gnbt`, `dd`, `heli`).
   - Update `engine.findNearestEnemy(x, y, team, maxRange, attacker = null)` in `src/engine.js` to filter candidates via `!attacker || attacker.canTarget(e)`.

3. **Altitude Shadow Pass & Naval Wakes (`src/renderer.js`)**:
   - In `_renderUnits`:
     - For `u.locomotion === 'air'`, draw ground shadow at `(u.x + 10, u.y + 12)` with `rgba(0,0,0,0.32)`, then translate sprite drawing to `(u.x, u.y - u.altitude)`. Draw spinning rotor blades for `heli`/`hind` (`this.animTime * 28`) and swept delta wings + afterburner glow for `yak`/`mig`.
     - For `u.locomotion === 'naval'`, draw V-shaped white foam wake behind hull (`u.x - Math.cos(u.angle)*16`) and periscope/bubble ring for submerged `ss`.

---

## 3. Phase 2: Walls, Supply Crates & Environmental Destruction

Adds fortification auto-tiling, battlefield exploration rewards, and destructible/repairable river crossings.

### 3.1 Buildable Walls with 4-Bit Neighbor Bitmask Auto-Tiling

1. **Wall Definitions (`src/data.js` → `BUILDINGS`)**:
   - `sbag` (**Sandbag Wall**): `category: 'defense'`, `isWall: true`, `cost: 50`, `buildTime: 1.5`, `hp: 180`, `power: 0`, `footprint: [1, 1]`, `prereq: ['conyard', 'barracks']`, `faction: 'both'`.
   - `fenc` (**Wire Fence**): `category: 'defense'`, `isWall: true`, `cost: 75`, `buildTime: 2.0`, `hp: 240`, `power: 0`, `footprint: [1, 1]`, `prereq: ['conyard', 'barracks']`, `faction: 'both'`.
   - `brik` (**Concrete Wall**): `category: 'defense'`, `isWall: true`, `cost: 125`, `buildTime: 3.0`, `hp: 550`, `power: 0`, `footprint: [1, 1]`, `prereq: ['conyard', 'weap']`, `faction: 'both'`, `blocksShells: false`, `unCrushable: true` (Sandbags/Fences can be crushed by `crusher: true` heavy tanks; Concrete Walls cannot).

2. **4-Bit Neighbor Bitmask Calculation (`src/map.js` & `src/renderer.js`)**:
   - Add `map.getWallBitmask(tx, ty, defId)`:
     - Checks orthogonal neighbors: North (`ty - 1`, bit `1`), East (`tx + 1`, bit `2`), South (`ty + 1`, bit `4`), West (`tx - 1`, bit `8`).
     - A bit is set (`1..15`) if the neighbor tile contains a wall building of the same `defId` (or any `isWall` building).
   - In `Renderer._drawBuildingSprite`, render connected wall segments from center `(cx, cy)` to each active cardinal edge (`N`, `E`, `S`, `W`) based on the 4-bit mask (`0..15`), with damage cracks at `<50%` HP.

### 3.2 Random & Fixed Bonus Supply Crates

1. **Crate State & Spawning (`src/engine.js`)**:
   - Add `this.crates = []` to `GameEngine`, initialized with 4–6 fixed tactical crates on map generation plus a periodic random crate spawner every `75s` (max `8` active crates on passable land/water tiles).
   - Crate object schema: `{ id, tx, ty, x, y, type: 'credits' | 'heal' | 'veterancy' | 'reveal' | 'freeUnit' | 'nukeTrap', amount, spawnTime, pulseAnim }`.
2. **Pickup Resolution (`src/engine.js` → `_updateCrates(dt)`)**:
   - Triggered when any non-air unit (`u.locomotion !== 'air'`) enters within `24px` of a crate:
     - `credits` (35% weight): Grants `+$1,000` or `+$2,000` (`engine.addCredits(u.team, amount)`), plays `'cash'` SFX, floats `+$2000 CRATE!`.
     - `heal` (20% weight): Restores `100%` HP to all friendly units within `120px` radius.
     - `veterancy` (15% weight): Promotes collector unit + nearby squad by `+1` rank (`veterancy = Math.min(3, veterancy + 1)`).
     - `reveal` (10% weight): Reveals entire map (`map.updateFog(entities, 'player', true)`) or a `20`-tile satellite scan for `30s`.
     - `freeUnit` (12% weight): Spawns a free faction tank (`mtnk` / `htnk` / `ctnk`) at the crate tile.
     - `nukeTrap` (8% weight): Arms a `3.0s` warning beep followed by a mini-tactical blast (`140px` radius, `220` damage).

### 3.3 Destructible & Repairable Bridges

1. **Bridge Structural Integrity (`src/map.js`)**:
   - Extend bridge tiles (`tile.type === TILE_TYPES.BRIDGE`) with `tile.bridgeHp = 600; tile.maxBridgeHp = 600; tile.isBridgeSpan = true`.
   - Place a pair of indestructible **Bridge Repair Huts** (`tile.hasBridgeHut = true`) on the road approach tiles (`rTop - 1` and `rBot + 1`) at each bridge's north and south banks.
2. **Demolition & Repair Mechanics (`src/map.js` & `src/entities.js`)**:
   - Force-firing (`Ctrl + Right-Click` or splash damage from `nuke`/`v2rl`/`arty`/`tanya`) on a `BRIDGE` tile damages `tile.bridgeHp`.
   - When `tile.bridgeHp <= 0`:
     - `map.destroyBridgeSpan(tx, ty)` converts the contiguous `2x2` or `4x1` span of `BRIDGE` tiles into `TILE_TYPES.WATER` with `tile.demolishedBridge = true`.
     - Any ground unit standing on those tiles is killed (`CRUSHED / DROWNED!`) with water splash particles.
   - Sending an `engineer` (`state = 'repairBridge'`) to a Bridge Repair Hut restores all `demolishedBridge` tiles of that bridge back to `TILE_TYPES.BRIDGE` with `bridgeHp = 600`, consuming the Engineer and announcing `"Bridge repaired"`.

---

## 4. Phase 3: Advanced Tactical Controls & Faction Specials

Brings classic C&C micro-management, unit stances, queued waypoint paths, specialist units, and multi-factory economy scaling.

### 4.1 Unit Stances (`src/entities.js`, `src/engine.js`, `src/main.js`, `index.html`)

Add `this.stance = opts.stance || 'guard'` to `Unit` with 4 tactical behaviors selectable via `#bottom-command-bar` buttons or cycling hotkey:
- `aggressive`: Scans up to `1.5x` sight range (`acquireRange = sight * tileSize * 1.35`), pursues enemies indefinitely across the map until target dies.
- `guard` (Default): Scans within `sight * tileSize * 0.9`, engages and chases up to `4` tiles from `this.guardOrigin = { x, y }`, then returns to `guardOrigin`.
- `holdGround`: Never moves from current position while auto-acquiring; rotates turret and fires only at enemies entering `this.def.range`.
- `holdFire`: Never auto-acquires targets or retaliates; only fires when given an explicit `attack` order by the player.

### 4.2 Queued Waypoints (`Shift + Right-Click`) & Patrol Orders (`P`)

1. **Waypoint Queue (`src/entities.js` & `src/engine.js`)**:
   - Add `this.commandQueue = []` (`Array<{ orderType, worldX, worldY, targetEntity }>`) to `Unit`.
   - Update `engine.issueOrder(selectedUnits, orderType, worldX, worldY, targetEntity, queueOrder = false)`:
     - When `queueOrder === true` (`e.shiftKey` held during right-click or command click), push the order onto `u.commandQueue` instead of overwriting `u.state` and `u.path`.
     - When `u.path.length === 0` and current order finishes in `Unit.update`, dequeue `u.commandQueue.shift()` and execute it automatically.
   - Render connected cyan dashed lines and numbered waypoint nodes (`1`, `2`, `3`...) in `Renderer._renderWorldOverlays` for all selected units with non-empty `commandQueue`.
2. **Patrol State (`P` Hotkey)**:
   - Pressing `P` (or clicking `#cmd-patrol`) enters `'patrol'` cursor mode.
   - Left-clicking sets `u.state = 'patrol'`, `u.patrolA = { x: u.x, y: u.y }`, `u.patrolB = { x: world.x, y: world.y }`, `u.patrolForward = true`.
   - Unit attack-moves back and forth between `patrolA` and `patrolB` indefinitely while scanning for enemies along the route.

### 4.3 Faction Specialist Units (`src/data.js` & `src/entities.js`)

| ID | Name | Category | Faction | Producer / Prereq | Cost / Time | HP / Speed | Specialist Ability & Implementation Contract |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `dog` | Attack Dog | `infantry` | `soviet` | `barracks` / `['barracks']` | `$200` / `3s` | `75` / `118` | `range: 28` (melee leap), `damage: 999` vs `infantry` only (`canTarget` restricts to `target.isInfantry`). Automatically detects enemy `spy` within `7` tiles. |
| `spy` | Allied Spy | `infantry` | `allied` | `barracks` / `['barracks', 'radar']` | `$500` / `7s` | `90` / `82` | Disguised to enemy AI/turrets except `dog`. Infiltrating enemy `refinery` steals `25%` of enemy credits; `power`/`advpower` causes `30s` enemy blackout; `radar` reveals enemy fog for `60s`; `weap`/`barracks` resets enemy production progress. |
| `thf` | Allied Thief | `infantry` | `allied` | `barracks` / `['barracks', 'radar']` | `$500` / `7s` | `85` / `85` | Infiltrates enemy `refinery` or `silo` (`state = 'infiltrate'`) to siphon up to `50%` of enemy credits directly into player's treasury (`+$` floating text). |
| `ctnk` | Chrono Tank | `vehicle` | `allied` | `weap` / `['weap', 'radar']` | `$1650` / `14s` | `680` / `92` | Dual high-output missile pods (`range: 250`, `damage: 110`, `splash: 24`). Special ability (`deploy` / `D` key): personal Chrono Blink teleport to cursor within `14` tiles (`chronoCooldown: 35s`). |
| `qtnk` | M.A.D. Tank | `vehicle` | `soviet` | `weap` / `['weap', 'radar']` | `$1800` / `15s` | `950` / `58` | Seismic shockwave weapon (`deploy` / `D` key): ejects driver, charges for `3.0s` with expanding ground tremor rings, then deals `450` structural/vehicle damage in a `320px` radius (`madChargeTimer`). |
| `shok` | Shock Trooper | `infantry` | `soviet` | `barracks` / `['barracks', 'tesla']` | `$380` / `6s` | `155` / `68` | Portable Tesla pack (`range: 185`, `damage: 62`, `fireRate: 1.3`, `projectileType: 'tesla'`, `unCrushable: true` — cannot be crushed by enemy tanks). |

### 4.4 Primary Building (`PRIMARY`) & Multiple-Factory Build Speed Multiplier

1. **Primary Building Designation (`src/entities.js`, `src/engine.js`, `src/renderer.js`)**:
   - Add `building.isPrimary = false` to `Building`. When the first producer of a type (`barracks`, `weap`, `helipad`, `afld`, `syrd`, `spen`) is constructed, set `building.isPrimary = true`.
   - Selecting a friendly producer building and clicking `SET PRIMARY` in `#selection-inspector` (or double-clicking the building) calls `engine.setPrimaryBuilding(building)`, clearing `isPrimary` on sibling producers of the same `producerType` and setting `building.isPrimary = true`.
   - `_completeUnitTraining` spawns units from the team's `isPrimary` producer of `producerType` (falling back to `findNearestBuilding` if none is marked).
   - `Renderer._renderBuildings` draws a crisp gold `[PRI]` badge at the top-right corner of primary buildings.
2. **Multiple-Factory Build Speed Multiplier (`src/engine.js`)**:
   - Add `engine.getFactoryMultiplier(team, category)`:
     - Counts alive friendly producer buildings for `category`:
       - `building` / `defense` → `conyard` count
       - `infantry` → `barracks` count
       - `vehicle` → `weap` count
       - `aircraft` → `helipad` + `afld` count
       - `naval` → `syrd` + `spen` count
     - Formula: `const mult = 1 + 0.25 * Math.max(0, count - 1)` (capped at `2.0x` for 5 factories).
   - Multiply `desiredProgressDelta` in `_updateTeamProduction` by `mult`.

---

## 5. Phase 4: Save/Load Persistence, Map Theaters & Multi-AI Skirmish

Delivers full session serialization, campaign progression unlocks, 3 distinct environmental color theaters, and multi-commander skirmish battles.

### 5.1 `localStorage` Quicksave (`F5`), Quickload (`F9`), JSON Export/Import & Campaign Progression

1. **Deterministic State Serializer (`src/engine.js`)**:
   - `engine.serializeState()`:
     - Returns a clean, circular-reference-free JSON snapshot:
       - `version: 2`, `timestamp: Date.now()`, `elapsedTime`, `gameSpeed`, `aiDifficulty`, `currentMissionId`, `customOptions`, `stats`.
       - `map`: `{ width, height, seed, theater, fogEnabled, tiles (compact RLE or array of { type, oreAmount, maxOre, buildingId, bridgeHp, demolishedBridge }), fog }`.
       - `teams`: Deep clone of `teams` (`player`, `enemy`, `enemy2`, `enemy3`) with plain `queues` and `superweapons`.
       - `entities`: Array of serialized `Building` and `Unit` POJOs (replacing object references like `targetEntity` and `attacker` with `targetEntityId` / `attackerId`).
       - `crates`, `decals`.
   - `engine.deserializeState(snapshot)`:
     - Reconstructs `GameMap`, `teams`, `Building`/`Unit` instances, re-links `targetEntityId` references, recalculates power, updates fog, and centers camera.
2. **Storage & File I/O (`src/main.js`)**:
   - Hotkey `F5`: Saves `JSON.stringify(engine.serializeState())` to `localStorage.getItem('ra_quicksave_v2')`, plays telemetry chime, and notifies `"QUICKSAVE COMPLETE [F5]"`.
   - Hotkey `F9`: Loads from `localStorage.getItem('ra_quicksave_v2')`, calls `engine.deserializeState(data)`, and notifies `"QUICKLOAD RESTORED [F9]"`.
   - Pause Modal buttons `#btn-export-save` (downloads `red-alert-save-<timestamp>.json`) and `#btn-import-save` (file picker reading JSON into `deserializeState`).
3. **Campaign Progression Tracking (`src/main.js`)**:
   - Persist `localStorage.getItem('ra_campaign_progress_v2')` (`{ unlockedMission: 1..3, completedRanks: { mission_1: 'S', ... } }`).
   - On Victory in Campaign mode, unlock the next mission and store best evaluation rank badge (`S/A/B/C`) on the `#mission-list` cards.

### 5.2 Map Theater Palettes (`temperate`, `snow`, `desert`)

1. **Theater Palette Definitions (`src/data.js` → `window.RA.DATA.THEATERS` & `src/renderer.js`)**:

| Theater ID | Name | Grass / Ground Shades | Dirt / Bank Shades | Road Shades | Water / Ice Shades | Rock / Cliff Facets |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `temperate` | European Temperate | `#2b4728`, `#274224`, `#2f4d2c`, `#294526` | `#594635`, `#534131` | `#484037`, `#3d362e` | `#0d2b45`, `#0b253c`, `#153e61` | `#374151`, `#64748b`, `#1e293b` |
| `snow` | Siberian Winter | `#e2e8f0`, `#cbd5e1`, `#f1f5f9`, `#dbeafe` | `#64748b`, `#475569` | `#334155`, `#1e293b` | `#0c4a6e`, `#075985` (white ice floe edges) | `#475569`, `#94a3b8`, `#1e293b` |
| `desert` | North African Arid | `#d97706`, `#b45309`, `#f59e0b`, `#c2410c` | `#92400e`, `#78350f` | `#57534e`, `#44403c` | `#0369a1`, `#0284c7`, `#38bdf8` | `#78350f`, `#a16207`, `#451a03` |

2. **Renderer Integration (`src/renderer.js`)**:
   - `_renderTerrain` and `renderMinimap` read `const palette = this._getTheaterPalette(map.theater || 'temperate')` instead of hardcoded hex strings.
   - Mission 1 uses `temperate`, Mission 2 uses `snow`, Mission 3 uses `desert` (configurable in Skirmish UI via `#skirmish-theater`).

### 5.3 Multi-AI Skirmish (`1..3` AI Opponents & AI Doctrines)

- Expand `#skirmish-panel` with:
  - **Map Theater**: `TEMPERATE` | `SNOW` | `DESERT`
  - **AI Opponents**: `1 AI (DUEL)` | `2 AI (3-WAY)` | `3 AI (4-CORNER)`
  - **AI Doctrine**: `BALANCED` | `RUSH (INFANTRY/LIGHT)` | `TURTLE (TESLA/SUPERWEAPON)` | `AIR & NAVAL`
- In `GameMap.generate(config)`: support up to 4 corner base plateaus (`top-left`, `top-right`, `bottom-left`, `bottom-right`).
- In `GameEngine`: iterate over all active AI teams (`enemy`, `enemy2`, `enemy3`) in `update`, `_updateTeamProduction`, `_updateSuperweapons`, and `updateAI`, assigning distinct team colors (Crimson `#ef4444`, Gold `#eab308`, Purple `#a855f7`).

---

## 6. Phase 5: Visual & Audio Polish

Elevates battlefield feel with smooth camera zoom, persistent combat scars, and instant radar alert jumping.

### 6.1 Smooth Mouse-Wheel Camera Zoom (`0.6x` to `1.5x`)

1. **Camera State & Coordinate Transforms (`src/renderer.js`)**:
   - Add `zoom: 1.0`, `targetZoom: 1.0`, `minZoom: 0.6`, `maxZoom: 1.5` to `this.camera`.
   - Update coordinate conversion contracts:
     ```js
     screenToWorld(sx, sy) {
       const z = this.camera.zoom || 1.0;
       return {
         x: sx / z + this.camera.x,
         y: sy / z + this.camera.y
       };
     }
     worldToScreen(wx, wy) {
       const z = this.camera.zoom || 1.0;
       return {
         x: (wx - this.camera.x) * z,
         y: (wy - this.camera.y) * z
       };
     }
     ```
   - Add `setZoom(newZoom, pivotScreenX, pivotScreenY, map)`:
     - Clamps `newZoom` to `[0.6, 1.5]`.
     - Keeps the world coordinate under `(pivotScreenX, pivotScreenY)` fixed so zooming centers naturally on the cursor.
   - In `Renderer.render(engine, dt)`:
     - Apply `ctx.scale(z, z)` before `ctx.translate(-this.camera.x, -this.camera.y)` and compute visible tile bounds using `this.camera.width / z` and `this.camera.height / z`.
   - In `Renderer.renderMinimap`: scale viewport rectangle width/height by `1 / z`.

### 6.2 Persistent Battlefield Decals (Scorch Craters, Building Rubble, Tank Track Marks)

1. **Decal Buffer (`src/engine.js` & `src/renderer.js`)**:
   - Add `this.decals = []` (ring-buffered at max `250` decals for zero frame-rate degradation) with schema:
     `{ id, x, y, type: 'crater' | 'nuke_crater' | 'rubble' | 'tracks', radius, angle, alpha, createdAt, maxAge: 180 }`.
   - Spawn `'crater'` decals in `Projectile.explode` when `splash >= 22`, `'nuke_crater'` in `detonateNukeAt`, `'rubble'` in `onEntityKilled` when `entity.isBuilding` dies, and `'tracks'` every `28px` of movement for heavy vehicles (`htnk`, `mammoth`, `harvester`, `mcv`, `qtnk`).
   - Render decals in `Renderer.render` immediately after `_renderTerrain` and before `_renderBuildings` so units and structures pass cleanly over craters and rubble.

### 6.3 Radar Minimap Event Pings & `Spacebar` Alert Jump

1. **Radar Ping System (`src/engine.js`, `src/renderer.js`, `src/main.js`)**:
   - Add `this.radarPings = []` and `this.lastAlertPos = null` to `GameEngine`.
   - Add `engine.addRadarPing(wx, wy, color = '#ef4444', label = 'ALERT')`:
     - Called when: base under attack, harvester under attack, superweapon launched, crate spawned, or unit/structure completed.
     - Updates `this.lastAlertPos = { x: wx, y: wy, time: this.elapsedTime }`.
   - In `Renderer.renderMinimap(engine)`:
     - Draw expanding, pulsing radar rings (`r = 3..18px`) with crosshairs on `#minimap-canvas` for each active ping (`life: 4.0s`).
   - In `src/main.js`:
     - Pressing `Spacebar` jumps the camera to `engine.lastAlertPos` if an alert occurred within the last `12s` (and toggles back to the player's Construction Yard on a second press or when no recent alert exists); `H` always centers directly on the player's Construction Yard.

---

## 7. Swarm Execution Breakdown & Verification Plan

To execute Phases 1–5 in parallel without merge conflicts or file collisions, work is partitioned strictly by file ownership across 6 swarm workers.

### 7.1 Per-File Worker Assignment Table

| Worker | Owned File(s) | Forbidden Files | Assigned Deliverables across Phases 1–5 |
| :--- | :--- | :--- | :--- |
| **`@data`** | `src/data.js`<br>`src/audio.js` | `index.html`, `src/styles.css`, `src/map.js`, `src/entities.js`, `src/engine.js`, `src/renderer.js`, `src/main.js` | • Add Phase 1 buildings (`helipad`, `afld`, `syrd`, `spen`, `sam`, `agun`) & units (`heli`, `hind`, `yak`, `mig`, `gnbt`, `dd`, `ca`, `ss`).<br>• Add Phase 2 walls (`sbag`, `fenc`, `brik`) & crate metadata.<br>• Add Phase 3 specialists (`dog`, `spy`, `thf`, `ctnk`, `qtnk`, `shok`).<br>• Add Phase 4 `THEATERS` (`temperate`, `snow`, `desert`) and multi-AI skirmish mission generator options.<br>• Add new procedural SFX in `src/audio.js` (`flak`, `torpedo`, `sonar`, `dog_bark`, `spy_infiltrate`, `seismic_charge`, `crate_pickup`, `radar_ping`, `quicksave`). |
| **`@map`** | `src/map.js` | All other files | • Update `isPassable` & `findPath` for `locomotion: 'land' \| 'air' \| 'naval'`.<br>• Update `getTilePlacementStatus` & `canPlaceBuilding` for `waterOnly: true` naval yards (`syrd`, `spen`).<br>• Add `getWallBitmask(tx, ty, defId)` 4-bit neighbor auto-tiling helper.<br>• Add destructible/repairable bridge state (`bridgeHp`, `destroyBridgeSpan`, `repairBridgeSpan`, Bridge Repair Huts).<br>• Add 4-corner multi-AI spawn plateau generation in `generate()`. |
| **`@engine`** | `src/entities.js`<br>`src/engine.js` | All other files | • Implement `locomotion`, `altitude`, `ammo` reload, `submerged` stealth, and `canTarget` air/sub rules in `src/entities.js`.<br>• Implement unit `stance` (`aggressive`, `guard`, `holdGround`, `holdFire`), `commandQueue` (`Shift` waypoints), and `patrol` state.<br>• Implement specialist behaviors (`dog`, `spy`, `thf`, `ctnk`, `qtnk`, `shok`).<br>• Implement Supply Crates (`crates`), Primary Building (`setPrimaryBuilding`), and Multi-Factory speed multiplier (`getFactoryMultiplier`).<br>• Implement `serializeState()` / `deserializeState()` save/load, multi-AI teams (`enemy`, `enemy2`, `enemy3`), persistent `decals`, and `radarPings` / `lastAlertPos`. |
| **`@renderer`** | `src/renderer.js` | All other files | • Implement camera `zoom` (`0.6x..1.5x`), `setZoom`, and zoom-aware `screenToWorld` / `worldToScreen`.<br>• Implement Theater palette lookup (`temperate`, `snow`, `desert`) in `_renderTerrain` and `renderMinimap`.<br>• Implement persistent `_renderDecals` (scorch craters, rubble, tank tracks) and `_renderCrates`.<br>• Implement 4-bit wall auto-tiling sprites, bridge damage/huts, `[PRI]` badge, and new building/unit vector sprites (`helipad`, `afld`, `syrd`, `spen`, `sam`, `agun`, `heli`, `hind`, `yak`, `mig`, `gnbt`, `dd`, `ca`, `ss`, `dog`, `spy`, `thf`, `ctnk`, `qtnk`, `shok`).<br>• Implement altitude shadow pass, naval wakes, queued waypoint lines, and minimap `radarPings`. |
| **`@ui`** | `index.html`<br>`src/styles.css`<br>`src/main.js` | `src/data.js`, `src/audio.js`, `src/map.js`, `src/entities.js`, `src/engine.js`, `src/renderer.js` | • Add Air/Naval production support, Stance selector pills, Patrol (`P`) button, and Primary Building button in `#selection-inspector` / `#bottom-command-bar`.<br>• Bind `Shift + Right-Click` waypoint queueing, mouse-wheel zoom on `#battlefield-canvas`, `Spacebar` alert jump + `H` base home, and `F5`/`F9` Quicksave/Quickload + JSON Export/Import.<br>• Add Skirmish Theater (`temperate`/`snow`/`desert`), AI Count (`1..3`), and AI Doctrine selectors in `#skirmish-panel`, plus Campaign unlock persistence in `localStorage`. |
| **`@verifier`** | None (Read-only + Headless Browser Verification) | All source files (reports defects to owners) | • Run automated end-to-end headless browser verification suite across all 5 phases, verifying zero console/page errors and 100% contract compliance. |

### 7.2 Automated Headless Browser Verification Matrix

`@verifier` will execute the following deterministic test suite against the live browser runtime (`window.RA`):

1. **Test 1 — Air & Naval Domain Suite**:
   - Spawn `syrd` and `spen` on `WATER` tiles (assert `map.canPlaceBuilding` rejects land tiles and accepts water tiles).
   - Spawn `heli`, `mig`, `dd`, `ca`, and `ss`; assert `heli.locomotion === 'air'` paths directly over water/rocks (`altitude > 0`), `ss.submerged === true` is untargetable by `mtnk` (`mtnk.canTarget(ss) === false`) and targetable by `dd` (`dd.canTarget(ss) === true`), and `sam`/`agun` engage airborne `heli`/`mig`.
2. **Test 2 — Walls, Supply Crates & Bridge Destruction Suite**:
   - Place a 3-tile L-shaped `brik` wall and assert `map.getWallBitmask` returns expected 4-bit masks (`1..15`).
   - Spawn each crate type (`credits`, `heal`, `veterancy`, `reveal`, `freeUnit`, `nukeTrap`), move a friendly `ltnk` over each, and assert credit increment, HP restore, veterancy promotion, fog reveal, and unit spawn.
   - Demolish a bridge span (`map.destroyBridgeSpan`), verify ground units cannot path across the water gap, then send an `engineer` to the Bridge Repair Hut and verify `TILE_TYPES.BRIDGE` restoration.
3. **Test 3 — Stances, Waypoints, Patrol, Specialists & Multi-Factory Suite**:
   - Issue 3 `Shift` queued move waypoints (`queueOrder = true`) and assert `u.commandQueue.length === 2` and sequential traversal; issue `patrol` order and assert oscillation between `patrolA` and `patrolB`.
   - Verify `holdFire` prevents auto-acquisition, `holdGround` prevents chasing, `dog` eliminates `spy`, `thf` siphons enemy credits, `ctnk` Chrono Blinks, and `qtnk` detonates its seismic wave.
   - Construct 2 `weap` buildings, designate the second as `PRIMARY` (`engine.setPrimaryBuilding`), and assert `engine.getFactoryMultiplier('player', 'vehicle') === 1.25` and new tanks exit from the primary `weap`.
4. **Test 4 — Save/Load Round-Trip, Theaters & Multi-AI Skirmish Suite**:
   - Trigger `engine.serializeState()`, mutate battlefield state, restore via `engine.deserializeState()`, and assert exact match on `credits`, `entities.length`, unit HP/positions, and fog state.
   - Launch Skirmish with `theater: 'snow'` and `aiCount: 3`; assert 4 bases spawn and terrain renders with the snow palette.
5. **Test 5 — Camera Zoom, Decals & Radar Ping Suite**:
   - Set camera zoom to `0.6x` and `1.5x` via `renderer.setZoom`, verifying `worldToScreen(screenToWorld(sx, sy))` round-trip accuracy within `< 0.01px`.
   - Detonate artillery/nuke, assert `engine.decals.length > 0`, trigger `engine.addRadarPing(1200, 1200)`, and verify `Spacebar` centers camera on `(1200, 1200)`.
   - Assert zero `console.error` or uncaught `pageerror` events across the entire test run.
