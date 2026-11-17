(function () {
  'use strict';

  window.RA = window.RA || {};

  const TILE_TYPES = {
    GRASS: 0,
    DIRT: 1,
    WATER: 2,
    BRIDGE: 3,
    ROCK: 4,
    ORE: 5,
    GEMS: 6,
    ROAD: 7
  };

  const FOG = {
    UNEXPLORED: 0,
    EXPLORED: 1,
    VISIBLE: 2
  };

  window.RA.TILE_TYPES = TILE_TYPES;
  window.RA.FOG = FOG;
  window.RA.TILE_SIZE = window.RA.TILE_SIZE || 40;

  // Deterministic PRNG (Mulberry32)
  function createRng(seed) {
    let s = (Number(seed) || 1996) >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Deterministic 2D hash for tile variants and noise
  function hash2D(x, y, seed) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed || 1996, 1442695041);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Binary Min-Heap for fast A* open set
  class MinHeap {
    constructor() {
      this.nodes = [];
      this.priorities = [];
    }

    get size() {
      return this.nodes.length;
    }

    push(node, priority) {
      const idx = this.nodes.length;
      this.nodes.push(node);
      this.priorities.push(priority);
      this._bubbleUp(idx);
    }

    pop() {
      const top = this.nodes[0];
      const lastNode = this.nodes.pop();
      const lastPrio = this.priorities.pop();
      if (this.nodes.length > 0) {
        this.nodes[0] = lastNode;
        this.priorities[0] = lastPrio;
        this._sinkDown(0);
      }
      return top;
    }

    _bubbleUp(idx) {
      const nodes = this.nodes;
      const prios = this.priorities;
      const node = nodes[idx];
      const prio = prios[idx];
      while (idx > 0) {
        const parentIdx = (idx - 1) >> 1;
        if (prios[parentIdx] <= prio) break;
        nodes[idx] = nodes[parentIdx];
        prios[idx] = prios[parentIdx];
        idx = parentIdx;
      }
      nodes[idx] = node;
      prios[idx] = prio;
    }

    _sinkDown(idx) {
      const nodes = this.nodes;
      const prios = this.priorities;
      const len = nodes.length;
      const node = nodes[idx];
      const prio = prios[idx];
      const half = len >> 1;
      while (idx < half) {
        let left = (idx << 1) + 1;
        const right = left + 1;
        let bestChild = left;
        if (right < len && prios[right] < prios[left]) {
          bestChild = right;
        }
        if (prio <= prios[bestChild]) break;
        nodes[idx] = nodes[bestChild];
        prios[idx] = prios[bestChild];
        idx = bestChild;
      }
      nodes[idx] = node;
      prios[idx] = prio;
    }
  }

  class GameMap {
    constructor(width = 64, height = 64, config = {}) {
      if (typeof width === 'object' && width !== null) {
        config = width;
        width = config.width || window.RA.MAP_WIDTH || 64;
        height = config.height || window.RA.MAP_HEIGHT || 64;
      }
      config = config || {};

      this.width = Number(width) || config.width || window.RA.MAP_WIDTH || 64;
      this.height = Number(height) || config.height || window.RA.MAP_HEIGHT || 64;
      this.tileSize = window.RA.TILE_SIZE || 40;
      this.pixelWidth = this.width * this.tileSize;
      this.pixelHeight = this.height * this.tileSize;

      this.tiles = [];
      this.fog = [];
      this.fogEnabled = typeof config.fogOfWar === 'boolean'
        ? config.fogOfWar
        : (typeof config.fogEnabled === 'boolean' ? config.fogEnabled : true);
      this.theater = config.theater || 'temperate';
      this.regrowTimer = 0;

      // Pre-allocate A* buffers for zero-GC pathfinding
      const totalTiles = this.width * this.height;
      this._gScore = new Float32Array(totalTiles);
      this._cameFrom = new Int32Array(totalTiles);
      this._visitState = new Uint8Array(totalTiles);

      this.generate(config);
    }

    generate(config = {}) {
      this.config = config || {};
      this.theater = this.config.theater || this.theater || 'temperate';
      const seed = Number(config.seed) || 1996;
      const rng = createRng(seed);

      const playerStart = config.playerStart || { tx: 8, ty: this.height - 12 };
      const enemyStart = config.enemyStart || { tx: this.width - 12, ty: 8 };
      this.playerStart = { tx: playerStart.tx, ty: playerStart.ty };
      this.enemyStart = { tx: enemyStart.tx, ty: enemyStart.ty };

      // 1. Initialize tiles and fog arrays
      this.tiles = new Array(this.height);
      this.fog = new Array(this.height);

      for (let ty = 0; ty < this.height; ty++) {
        const row = new Array(this.width);
        const fogRow = new Array(this.width);
        for (let tx = 0; tx < this.width; tx++) {
          // Smooth noise for natural dirt patches on grass
          const n1 = hash2D(Math.floor(tx / 4), Math.floor(ty / 4), seed);
          const n2 = hash2D(Math.floor(tx / 2), Math.floor(ty / 2), seed + 7);
          const blend = n1 * 0.7 + n2 * 0.3;
          const type = blend > 0.72 ? TILE_TYPES.DIRT : TILE_TYPES.GRASS;
          const variant = Math.floor(hash2D(tx, ty, seed + 13) * 4) & 3;

          row[tx] = {
            tx,
            ty,
            type,
            oreAmount: 0,
            maxOre: 0,
            variant,
            buildingId: null,
            wallDefId: null,
            isWall: false,
            bridgeHp: 0,
            maxBridgeHp: 0,
            isBridgeSpan: false,
            demolishedBridge: false,
            bridgeId: null,
            hasBridgeHut: false,
            bridgeHutId: null
          };
          fogRow[tx] = this.fogEnabled ? FOG.UNEXPLORED : FOG.VISIBLE;
        }
        this.tiles[ty] = row;
        this.fog[ty] = fogRow;
      }

      // 2. River & Bridges
      const hasRiver = config.riverY !== null && config.riverY !== false;
      const riverY = typeof config.riverY === 'number'
        ? config.riverY
        : Math.floor(this.height / 2);

      // Normalize bridge specifications
      let bridgeSpecs = [];
      if (Array.isArray(config.bridges) && config.bridges.length > 0) {
        bridgeSpecs = config.bridges.map((b) => {
          if (typeof b === 'number') {
            return { tx: b, width: 4 };
          }
          const btx = b.tx !== undefined ? b.tx : (b.x !== undefined ? b.x : 32);
          const bw = Math.max(4, b.width || b.w || 4);
          return { tx: btx, width: bw };
        });
      } else {
        // Default 3 wide strategic bridges (left, center, right)
        bridgeSpecs = [
          { tx: Math.floor(this.width * 0.23), width: 4 },
          { tx: Math.floor(this.width * 0.50), width: 4 },
          { tx: Math.floor(this.width * 0.77), width: 4 }
        ];
      }

      if (hasRiver) {
        const phase = (seed % 17) * 0.37;
        for (let tx = 0; tx < this.width; tx++) {
          // Check if near a bridge so the river straightens cleanly under bridges
          let nearBridge = false;
          let onBridge = false;
          let bridgeIdx = -1;
          for (let i = 0; i < bridgeSpecs.length; i++) {
            const b = bridgeSpecs[i];
            const halfW = Math.floor(b.width / 2);
            if (tx >= b.tx - halfW && tx < b.tx - halfW + b.width) {
              onBridge = true;
              nearBridge = true;
              bridgeIdx = i;
              break;
            } else if (tx >= b.tx - halfW - 2 && tx < b.tx - halfW + b.width + 2) {
              nearBridge = true;
            }
          }

          const wave = nearBridge ? 0 : Math.round(Math.sin(tx * 0.14 + phase) * 1.5);
          const cy = Math.max(4, Math.min(this.height - 5, riverY + wave));
          const rTop = cy - 1;
          const rBot = cy + 2;

          // Dirt banks along the river
          for (let ty = rTop - 1; ty <= rBot + 1; ty++) {
            if (this.inBounds(tx, ty)) {
              this.tiles[ty][tx].type = TILE_TYPES.DIRT;
            }
          }

          // Water or Bridge channel
          for (let ty = rTop; ty <= rBot; ty++) {
            if (this.inBounds(tx, ty)) {
              const t = this.tiles[ty][tx];
              if (onBridge) {
                t.type = TILE_TYPES.BRIDGE;
                t.bridgeHp = 600;
                t.maxBridgeHp = 600;
                t.isBridgeSpan = true;
                t.demolishedBridge = false;
                t.bridgeId = bridgeIdx;
              } else {
                t.type = TILE_TYPES.WATER;
              }
            }
          }

          // Road approaches & Bridge Repair Huts on both ends of every bridge
          if (onBridge) {
            for (let ty = rTop - 3; ty < rTop; ty++) {
              if (this.inBounds(tx, ty)) this.tiles[ty][tx].type = TILE_TYPES.ROAD;
            }
            for (let ty = rBot + 1; ty <= rBot + 3; ty++) {
              if (this.inBounds(tx, ty)) this.tiles[ty][tx].type = TILE_TYPES.ROAD;
            }
            if (this.inBounds(tx, rTop - 1)) {
              this.tiles[rTop - 1][tx].hasBridgeHut = true;
              this.tiles[rTop - 1][tx].bridgeHutId = bridgeIdx;
            }
            if (this.inBounds(tx, rBot + 1)) {
              this.tiles[rBot + 1][tx].hasBridgeHut = true;
              this.tiles[rBot + 1][tx].bridgeHutId = bridgeIdx;
            }
          }
        }
      } else {
        // When riverY is null, place two small scenic lakes away from all 4 corner bases
        this._paintCircle(24, 12, 3.2, TILE_TYPES.WATER);
        this._paintCircle(this.width - 25, this.height - 13, 3.2, TILE_TYPES.WATER);
      }

      // 3. Dirt Roads connecting bases toward bridges / map center
      const mainBridge = bridgeSpecs[Math.floor(bridgeSpecs.length / 2)] || { tx: Math.floor(this.width / 2), width: 4 };
      this._carveRoad(playerStart.tx + 2, playerStart.ty - 2, mainBridge.tx, hasRiver ? riverY + 4 : Math.floor(this.height / 2));
      this._carveRoad(enemyStart.tx - 2, enemyStart.ty + 2, mainBridge.tx, hasRiver ? riverY - 3 : Math.floor(this.height / 2));

      if (bridgeSpecs.length > 1) {
        const leftBridge = bridgeSpecs[0];
        const rightBridge = bridgeSpecs[bridgeSpecs.length - 1];
        this._carveRoad(playerStart.tx, playerStart.ty - 4, leftBridge.tx, hasRiver ? riverY + 4 : Math.floor(this.height / 2));
        this._carveRoad(enemyStart.tx, enemyStart.ty + 4, rightBridge.tx, hasRiver ? riverY - 3 : Math.floor(this.height / 2));
      }

      // 4. Rock Ridges & Cliffs
      if (Array.isArray(config.rocks) && config.rocks.length > 0) {
        for (let i = 0; i < config.rocks.length; i++) {
          const r = config.rocks[i];
          if (!r) continue;
          const rtx = r.tx !== undefined ? r.tx : (r.x !== undefined ? r.x : 32);
          const rty = r.ty !== undefined ? r.ty : (r.y !== undefined ? r.y : 32);
          if (r.w && r.h) {
            for (let dy = 0; dy < r.h; dy++) {
              for (let dx = 0; dx < r.w; dx++) {
                this._setRockSafe(rtx + dx, rty + dy, bridgeSpecs, riverY);
              }
            }
          } else {
            const rad = r.radius || r.r || 2;
            for (let dy = -rad; dy <= rad; dy++) {
              for (let dx = -rad; dx <= rad; dx++) {
                if (dx * dx + dy * dy <= rad * rad + 0.5) {
                  this._setRockSafe(rtx + dx, rty + dy, bridgeSpecs, riverY);
                }
              }
            }
          }
        }
      } else {
        // Default tactical rock ridges creating choke points without blocking bridges
        const defaultRocks = [
          { tx: 22, ty: 44, r: 2 },
          { tx: 42, ty: 20, r: 2 },
          { tx: 18, ty: 20, r: 2 },
          { tx: 46, ty: 44, r: 2 },
          { tx: 6, ty: 28, r: 2 },
          { tx: 57, ty: 36, r: 2 }
        ];
        for (let i = 0; i < defaultRocks.length; i++) {
          const rk = defaultRocks[i];
          for (let dy = -rk.r; dy <= rk.r; dy++) {
            for (let dx = -rk.r; dx <= rk.r; dx++) {
              if (dx * dx + dy * dy <= rk.r * rk.r && rng() > 0.2) {
                this._setRockSafe(rk.tx + dx, rk.ty + dy, bridgeSpecs, riverY);
              }
            }
          }
        }
      }

      // 5. Ore & Gems Fields
      if (Array.isArray(config.oreFields) && config.oreFields.length > 0) {
        for (let i = 0; i < config.oreFields.length; i++) {
          const f = config.oreFields[i];
          if (!f) continue;
          const ftx = f.tx !== undefined ? f.tx : (f.x !== undefined ? f.x : 20);
          const fty = f.ty !== undefined ? f.ty : (f.y !== undefined ? f.y : 45);
          const rad = f.radius || f.r || 4;
          const hasGems = Boolean(f.gems || f.hasGems || f.type === 'gems');
          this._placeOrePatch(ftx, fty, rad, hasGems, rng);
        }
      } else {
        // Default rich ore and gem fields near both bases and in contested expansion zones
        this._placeOrePatch(playerStart.tx + 10, playerStart.ty - 1, 4.5, false, rng);
        this._placeOrePatch(playerStart.tx + 2, playerStart.ty - 10, 3.8, true, rng);

        this._placeOrePatch(enemyStart.tx - 10, enemyStart.ty + 1, 4.5, false, rng);
        this._placeOrePatch(enemyStart.tx - 2, enemyStart.ty + 10, 3.8, true, rng);

        // Contested expansion fields with high-value Gems
        this._placeOrePatch(12, 16, 4.5, true, rng);
        this._placeOrePatch(this.width - 13, this.height - 17, 4.5, true, rng);
        this._placeOrePatch(Math.floor(this.width / 2), Math.max(8, riverY - 8), 3.5, true, rng);
        this._placeOrePatch(Math.floor(this.width / 2), Math.min(this.height - 9, riverY + 8), 3.5, true, rng);
      }

      // 6. Enforce flat, buildable plateaus (at least 16x16 clear of water/rocks/bridges) around playerStart, enemyStart & 4-corner extra AI bases
      this._ensureBasePlateau(playerStart.tx, playerStart.ty, 8, rng);
      this._ensureBasePlateau(enemyStart.tx, enemyStart.ty, 8, rng);

      const defaultExtraStarts = [
        { tx: 10, ty: 10 },
        { tx: Math.max(10, this.width - 12), ty: Math.max(10, this.height - 12) }
      ];
      const extraStarts = Array.isArray(config.extraBases) && config.extraBases.length > 0
        ? config.extraBases
        : defaultExtraStarts;

      this.extraStarts = extraStarts;
      this.spawnPoints = [this.playerStart, this.enemyStart, ...extraStarts];

      for (let i = 0; i < extraStarts.length; i++) {
        const st = extraStarts[i];
        if (!st) continue;
        const stx = st.tx !== undefined ? st.tx : (st.x !== undefined ? st.x : 10);
        const sty = st.ty !== undefined ? st.ty : (st.y !== undefined ? st.y : 10);
        this._ensureBasePlateau(stx, sty, 7, rng);
        if (config.extraBases || (config.aiCount && Number(config.aiCount) > 1)) {
          const targetBridge = stx < this.width / 2 ? bridgeSpecs[0] : bridgeSpecs[bridgeSpecs.length - 1];
          const btx = targetBridge ? targetBridge.tx : Math.floor(this.width / 2);
          const bty = sty < riverY ? (hasRiver ? riverY - 3 : Math.floor(this.height / 2)) : (hasRiver ? riverY + 4 : Math.floor(this.height / 2));
          this._carveRoad(stx, sty, btx, bty);
          // Re-ensure inner base plateau doesn't have rocks/water
          this._ensureBasePlateau(stx, sty, 7, rng);
        }
      }
    }

    _paintCircle(cx, cy, radius, tileType) {
      const r2 = radius * radius;
      const minX = Math.max(0, Math.floor(cx - radius));
      const maxX = Math.min(this.width - 1, Math.ceil(cx + radius));
      const minY = Math.max(0, Math.floor(cy - radius));
      const maxY = Math.min(this.height - 1, Math.ceil(cy + radius));
      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          const dx = tx - cx;
          const dy = ty - cy;
          if (dx * dx + dy * dy <= r2) {
            this.tiles[ty][tx].type = tileType;
            this.tiles[ty][tx].oreAmount = 0;
            this.tiles[ty][tx].maxOre = 0;
          }
        }
      }
    }

    _carveRoad(x1, y1, x2, y2) {
      let cx = Math.max(1, Math.min(this.width - 2, Math.round(x1)));
      let cy = Math.max(1, Math.min(this.height - 2, Math.round(y1)));
      const tx = Math.max(1, Math.min(this.width - 2, Math.round(x2)));
      const ty = Math.max(1, Math.min(this.height - 2, Math.round(y2)));

      let steps = 0;
      const maxSteps = this.width + this.height + 20;
      while ((cx !== tx || cy !== ty) && steps < maxSteps) {
        steps++;
        for (let oy = 0; oy <= 1; oy++) {
          for (let ox = 0; ox <= 1; ox++) {
            const rx = cx + ox;
            const ry = cy + oy;
            if (this.inBounds(rx, ry)) {
              const t = this.tiles[ry][rx];
              if (t.type === TILE_TYPES.GRASS || t.type === TILE_TYPES.DIRT) {
                t.type = TILE_TYPES.ROAD;
              }
            }
          }
        }
        if (Math.abs(tx - cx) > Math.abs(ty - cy)) {
          cx += tx > cx ? 1 : -1;
        } else {
          cy += ty > cy ? 1 : -1;
        }
      }
    }

    _setRockSafe(tx, ty, bridgeSpecs, riverY) {
      if (!this.inBounds(tx, ty)) return;
      const tile = this.tiles[ty][tx];
      if (tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.BRIDGE || tile.type === TILE_TYPES.ROAD) {
        return;
      }
      // Keep clear of bridge approaches
      for (let i = 0; i < bridgeSpecs.length; i++) {
        const b = bridgeSpecs[i];
        if (Math.abs(tx - b.tx) <= b.width + 2 && Math.abs(ty - riverY) <= 6) {
          return;
        }
      }
      tile.type = TILE_TYPES.ROCK;
      tile.oreAmount = 0;
      tile.maxOre = 0;
    }

    _placeOrePatch(cx, cy, radius, includeGems, rng) {
      const r2 = radius * radius;
      const minX = Math.max(1, Math.floor(cx - radius));
      const maxX = Math.min(this.width - 2, Math.ceil(cx + radius));
      const minY = Math.max(1, Math.floor(cy - radius));
      const maxY = Math.min(this.height - 2, Math.ceil(cy + radius));

      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          const dx = tx - cx;
          const dy = ty - cy;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > r2) continue;

          const tile = this.tiles[ty][tx];
          if (
            tile.type === TILE_TYPES.WATER ||
            tile.type === TILE_TYPES.BRIDGE ||
            tile.type === TILE_TYPES.ROCK
          ) {
            continue;
          }

          const normDist = Math.sqrt(dist2) / Math.max(1, radius);
          if (normDist > 0.85 && rng() < 0.3) continue;

          const isGemTile = includeGems && normDist < 0.42;
          tile.type = isGemTile ? TILE_TYPES.GEMS : TILE_TYPES.ORE;
          const richness = Math.round(100 - normDist * 35);
          tile.oreAmount = Math.max(50, Math.min(100, richness));
          tile.maxOre = 100;
        }
      }
    }

    _ensureBasePlateau(startTx, startTy, radius, rng) {
      // Clear a (2*radius+1) x (2*radius+1) area (17x17 for radius=8, well above 12x12)
      for (let ty = startTy - radius; ty <= startTy + radius; ty++) {
        for (let tx = startTx - radius; tx <= startTx + radius; tx++) {
          if (!this.inBounds(tx, ty)) continue;
          const tile = this.tiles[ty][tx];
          if (
            tile.type === TILE_TYPES.WATER ||
            tile.type === TILE_TYPES.ROCK ||
            tile.type === TILE_TYPES.BRIDGE
          ) {
            tile.type = TILE_TYPES.GRASS;
            tile.oreAmount = 0;
            tile.maxOre = 0;
          }
          // Keep the inner 5x5 core free of ore so initial base buildings don't cover ore
          if (Math.abs(tx - startTx) <= 4 && Math.abs(ty - startTy) <= 4) {
            if (tile.type === TILE_TYPES.ORE || tile.type === TILE_TYPES.GEMS) {
              tile.type = TILE_TYPES.GRASS;
              tile.oreAmount = 0;
              tile.maxOre = 0;
            }
          }
        }
      }

      // Ensure there is always a rich ore field within easy harvesting distance of this base
      let nearbyOreCount = 0;
      for (let ty = startTy - 13; ty <= startTy + 13; ty++) {
        for (let tx = startTx - 13; tx <= startTx + 13; tx++) {
          if (!this.inBounds(tx, ty)) continue;
          if (this.tiles[ty][tx].oreAmount > 0) nearbyOreCount++;
        }
      }
      if (nearbyOreCount < 16) {
        const dirX = startTx < this.width / 2 ? 1 : -1;
        const dirY = startTy < this.height / 2 ? 1 : -1;
        const oreTx = Math.max(4, Math.min(this.width - 5, startTx + dirX * 9));
        const oreTy = Math.max(4, Math.min(this.height - 5, startTy + dirY * 2));
        this._placeOrePatch(oreTx, oreTy, 4, false, rng);
      }
    }

    // --- Coordinate Helpers ---

    worldToTile(wx, wy) {
      const tx = Math.max(0, Math.min(this.width - 1, Math.floor((Number(wx) || 0) / this.tileSize)));
      const ty = Math.max(0, Math.min(this.height - 1, Math.floor((Number(wy) || 0) / this.tileSize)));
      return { tx, ty };
    }

    tileToWorld(tx, ty) {
      return {
        x: (tx + 0.5) * this.tileSize,
        y: (ty + 0.5) * this.tileSize
      };
    }

    inBounds(tx, ty) {
      return (
        typeof tx === 'number' &&
        typeof ty === 'number' &&
        tx >= 0 &&
        ty >= 0 &&
        tx < this.width &&
        ty < this.height
      );
    }

    getTile(tx, ty) {
      const ix = Math.floor(tx);
      const iy = Math.floor(ty);
      if (!this.inBounds(ix, iy)) return null;
      return this.tiles[iy][ix];
    }

    // --- Passability & Building Placement ---

    isPassable(tx, ty, locomotionOrIsInfantry = 'land', ignoreBuildingId = null) {
      const ix = Math.floor(tx);
      const iy = Math.floor(ty);
      if (!this.inBounds(ix, iy)) return false;

      const locomotion =
        locomotionOrIsInfantry === 'air'
          ? 'air'
          : locomotionOrIsInfantry === 'naval'
          ? 'naval'
          : 'land';

      if (locomotion === 'air') {
        return true;
      }

      const tile = this.tiles[iy][ix];
      if (locomotion === 'naval') {
        if (tile.type !== TILE_TYPES.WATER && tile.type !== TILE_TYPES.BRIDGE) {
          return false;
        }
        if (tile.buildingId !== null && tile.buildingId !== undefined && tile.buildingId !== ignoreBuildingId) {
          return false;
        }
        return true;
      }

      if (tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.ROCK) {
        return false;
      }
      if (tile.buildingId !== null && tile.buildingId !== undefined && tile.buildingId !== ignoreBuildingId) {
        return false;
      }
      return true;
    }

    getTilePlacementStatus(tx, ty, w, h, team, entities = [], ignoreEntity = null, def = null) {
      const ix = Math.floor(tx);
      const iy = Math.floor(ty);
      const bw = Math.max(1, Math.floor(w || 1));
      const bh = Math.max(1, Math.floor(h || 1));
      const entityList = Array.isArray(entities)
        ? entities
        : (entities && Array.isArray(entities.entities) ? entities.entities : []);

      // Allow def to be passed via ignoreEntity if caller passed 7 arguments
      if (!def && ignoreEntity) {
        if (typeof ignoreEntity === 'string' && window.RA && window.RA.DATA && window.RA.DATA.BUILDINGS && window.RA.DATA.BUILDINGS[ignoreEntity]) {
          def = window.RA.DATA.BUILDINGS[ignoreEntity];
          ignoreEntity = null;
        } else if (
          typeof ignoreEntity === 'object' &&
          !ignoreEntity.isBuilding &&
          !ignoreEntity.isUnit &&
          (ignoreEntity.waterOnly !== undefined || ignoreEntity.footprint !== undefined)
        ) {
          def = ignoreEntity;
          ignoreEntity = null;
        }
      }

      if (typeof def === 'string') {
        def =
          (window.RA && window.RA.DATA && window.RA.DATA.BUILDINGS && window.RA.DATA.BUILDINGS[def]) || {
            id: def,
            waterOnly: def === 'syrd' || def === 'spen'
          };
      }

      if (!def && window.RA && window.RA.app && window.RA.app.renderer && window.RA.app.renderer.placementPreview) {
        const pp = window.RA.app.renderer.placementPreview;
        if (pp.tx === ix && pp.ty === iy) {
          def = pp.def || (pp.defId && window.RA.DATA && window.RA.DATA.BUILDINGS && window.RA.DATA.BUILDINGS[pp.defId]) || null;
        }
      }

      const isWaterOnly = Boolean(def && (def.waterOnly === true || def.id === 'syrd' || def.id === 'spen'));
      const ignoreId = ignoreEntity && typeof ignoreEntity === 'object' ? ignoreEntity.id : ignoreEntity;

      // 1. Check base adjacency rule (relaxed for coastal/river shipyards)
      let friendlyBuildings = 0;
      let adjacentOk = false;
      const maxGap = isWaterOnly ? 45 : 5;

      if (!team || entityList.length === 0) {
        adjacentOk = true;
      } else {
        for (let i = 0; i < entityList.length; i++) {
          const e = entityList[i];
          if (!e || e.dead || !e.isBuilding || e.team !== team) continue;
          if (ignoreId !== null && ignoreId !== undefined && e.id === ignoreId) continue;
          friendlyBuildings++;

          const etx = e.tx !== undefined ? e.tx : Math.floor(e.x / this.tileSize);
          const ety = e.ty !== undefined ? e.ty : Math.floor(e.y / this.tileSize);
          const ew = e.w || (e.def && e.def.footprint ? e.def.footprint[0] : 2);
          const eh = e.h || (e.def && e.def.footprint ? e.def.footprint[1] : 2);

          // Gap in tiles between the two building footprints
          const gapX = Math.max(0, ix - (etx + ew), etx - (ix + bw));
          const gapY = Math.max(0, iy - (ety + eh), ety - (iy + bh));
          if (gapX <= maxGap && gapY <= maxGap) {
            adjacentOk = true;
            break;
          }
        }
        if (friendlyBuildings === 0) {
          adjacentOk = true;
        }
      }

      // 2. Check each footprint tile
      const tiles = [];
      let allTilesBuildable = true;

      for (let cy = iy; cy < iy + bh; cy++) {
        for (let cx = ix; cx < ix + bw; cx++) {
          let tileOk = false;
          if (this.inBounds(cx, cy)) {
            const tile = this.tiles[cy][cx];
            const terrainBuildable = isWaterOnly
              ? tile.type === TILE_TYPES.WATER &&
                (tile.buildingId === null || tile.buildingId === undefined || (ignoreId !== null && tile.buildingId === ignoreId))
              : tile.type !== TILE_TYPES.WATER &&
                tile.type !== TILE_TYPES.ROCK &&
                tile.type !== TILE_TYPES.BRIDGE &&
                (tile.buildingId === null || tile.buildingId === undefined || (ignoreId !== null && tile.buildingId === ignoreId));

            if (terrainBuildable) {
              tileOk = true;
              // Check if any unit or building in entities is occupying this tile
              for (let i = 0; i < entityList.length; i++) {
                const e = entityList[i];
                if (!e || e.dead) continue;
                if (ignoreId !== null && ignoreId !== undefined && (e === ignoreEntity || e.id === ignoreId)) {
                  continue;
                }
                if (e.isBuilding) {
                  const etx = e.tx !== undefined ? e.tx : Math.floor(e.x / this.tileSize);
                  const ety = e.ty !== undefined ? e.ty : Math.floor(e.y / this.tileSize);
                  const ew = e.w || (e.def && e.def.footprint ? e.def.footprint[0] : 2);
                  const eh = e.h || (e.def && e.def.footprint ? e.def.footprint[1] : 2);
                  if (cx >= etx && cx < etx + ew && cy >= ety && cy < ety + eh) {
                    tileOk = false;
                    break;
                  }
                } else {
                  // Allow an MCV of the same team to deploy into a 3x3 conyard at its own position
                  if (!isWaterOnly && e.defId === 'mcv' && (!team || e.team === team) && bw === 3 && bh === 3) {
                    continue;
                  }
                  const utx = Math.floor(e.x / this.tileSize);
                  const uty = Math.floor(e.y / this.tileSize);
                  if (utx === cx && uty === cy) {
                    tileOk = false;
                    break;
                  }
                }
              }
            }
          }

          if (!tileOk) {
            allTilesBuildable = false;
          }
          tiles.push({
            tx: cx,
            ty: cy,
            ok: tileOk && adjacentOk,
            terrainOk: tileOk
          });
        }
      }

      return {
        valid: allTilesBuildable && adjacentOk,
        adjacentOk,
        tiles
      };
    }

    canPlaceBuilding(tx, ty, w, h, team, entities = [], ignoreEntity = null, def = null) {
      return this.getTilePlacementStatus(tx, ty, w, h, team, entities, ignoreEntity, def).valid;
    }

    setBuildingFootprint(tx, ty, w, h, buildingId, defId = null) {
      const ix = Math.floor(tx);
      const iy = Math.floor(ty);
      const bw = Math.max(1, Math.floor(w || 1));
      const bh = Math.max(1, Math.floor(h || 1));

      let resolvedDefId = defId;
      if (!resolvedDefId && typeof buildingId === 'string') {
        if (buildingId === 'sbag' || buildingId === 'fenc' || buildingId === 'brik' || buildingId.startsWith('sbag') || buildingId.startsWith('fenc') || buildingId.startsWith('brik')) {
          resolvedDefId = buildingId.split('_')[0];
        }
      } else if (!resolvedDefId && buildingId && typeof buildingId === 'object') {
        resolvedDefId = buildingId.defId || (buildingId.def && buildingId.def.id) || null;
        buildingId = buildingId.id !== undefined ? buildingId.id : buildingId;
      }

      const bDef = resolvedDefId && window.RA && window.RA.DATA && window.RA.DATA.BUILDINGS && window.RA.DATA.BUILDINGS[resolvedDefId];
      const isWall = Boolean(
        (bDef && bDef.isWall) ||
        resolvedDefId === 'sbag' ||
        resolvedDefId === 'fenc' ||
        resolvedDefId === 'brik'
      );

      for (let cy = iy; cy < iy + bh; cy++) {
        for (let cx = ix; cx < ix + bw; cx++) {
          if (this.inBounds(cx, cy)) {
            const tile = this.tiles[cy][cx];
            tile.buildingId = buildingId;
            tile._footprintW = bw;
            tile._footprintH = bh;
            if (isWall) {
              tile.wallDefId = resolvedDefId || 'brik';
              tile.isWall = true;
            }
          }
        }
      }
    }

    clearBuildingFootprint(tx, ty, w, h, buildingId) {
      const ix = Math.floor(tx);
      const iy = Math.floor(ty);
      const bw = Math.max(1, Math.floor(w || 1));
      const bh = Math.max(1, Math.floor(h || 1));
      for (let cy = iy; cy < iy + bh; cy++) {
        for (let cx = ix; cx < ix + bw; cx++) {
          if (this.inBounds(cx, cy)) {
            const tile = this.tiles[cy][cx];
            if (buildingId === undefined || buildingId === null || tile.buildingId === buildingId) {
              tile.buildingId = null;
              tile.wallDefId = null;
              tile.isWall = false;
              tile._footprintW = 0;
              tile._footprintH = 0;
            }
          }
        }
      }
    }

    // --- 4-Bit Wall Auto-Tiling & Destructible/Repairable Bridges ---

    _tileHasWall(tx, ty, defId = null) {
      if (!this.inBounds(tx, ty)) return false;
      const tile = this.tiles[ty][tx];
      if (!tile) return false;

      if (tile.isWall || tile.wallDefId) {
        if (!defId || !tile.wallDefId || tile.wallDefId === defId || tile.isWall) {
          return true;
        }
      }

      const engineEntities =
        (window.RA && window.RA.app && window.RA.app.engine && window.RA.app.engine.entities) || null;

      if (Array.isArray(engineEntities)) {
        for (let i = 0; i < engineEntities.length; i++) {
          const e = engineEntities[i];
          if (!e || e.dead || !e.isBuilding) continue;
          const etx = e.tx !== undefined ? e.tx : Math.floor(e.x / this.tileSize);
          const ety = e.ty !== undefined ? e.ty : Math.floor(e.y / this.tileSize);
          if (etx === tx && ety === ty) {
            const eIsWall = Boolean(
              (e.def && e.def.isWall) ||
              e.defId === 'sbag' ||
              e.defId === 'fenc' ||
              e.defId === 'brik'
            );
            if (eIsWall) return true;
            return false;
          }
        }
      }

      if (tile.buildingId !== null && tile.buildingId !== undefined) {
        if (tile._footprintW === 1 && tile._footprintH === 1) {
          return true;
        }
      }

      return false;
    }

    getWallBitmask(tx, ty, defId = null) {
      const ix = Math.floor(tx);
      const iy = Math.floor(ty);
      if (!this.inBounds(ix, iy)) return 0;

      let mask = 0;
      // North (bit 1)
      if (this._tileHasWall(ix, iy - 1, defId)) mask |= 1;
      // East (bit 2)
      if (this._tileHasWall(ix + 1, iy, defId)) mask |= 2;
      // South (bit 4)
      if (this._tileHasWall(ix, iy + 1, defId)) mask |= 4;
      // West (bit 8)
      if (this._tileHasWall(ix - 1, iy, defId)) mask |= 8;

      return mask;
    }

    damageBridgeTile(tx, ty, damage = 100) {
      let ix = Math.floor(Number(tx) || 0);
      let iy = Math.floor(Number(ty) || 0);
      if (ix >= this.width || iy >= this.height) {
        const converted = this.worldToTile(ix, iy);
        ix = converted.tx;
        iy = converted.ty;
      }
      if (!this.inBounds(ix, iy)) return [];

      const tile = this.tiles[iy][ix];
      if (!tile || (tile.type !== TILE_TYPES.BRIDGE && !tile.isBridgeSpan) || tile.demolishedBridge) {
        return [];
      }

      const dmg = Math.max(0, Number(damage) || 0);
      const currentHp = typeof tile.bridgeHp === 'number' && tile.bridgeHp > 0 ? tile.bridgeHp : 600;
      const newHp = Math.max(0, currentHp - dmg);
      tile.bridgeHp = newHp;

      // Sync structural integrity across contiguous tiles of the same bridge span
      const bId = tile.bridgeId;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = ix + dx;
          const ny = iy + dy;
          if (!this.inBounds(nx, ny)) continue;
          const nt = this.tiles[ny][nx];
          if (nt && (nt.type === TILE_TYPES.BRIDGE || nt.isBridgeSpan) && !nt.demolishedBridge) {
            if (bId === null || bId === undefined || nt.bridgeId === bId) {
              nt.bridgeHp = newHp;
            }
          }
        }
      }

      if (newHp <= 0) {
        return this.destroyBridgeSpan(ix, iy);
      }
      return [];
    }

    destroyBridgeSpan(tx, ty) {
      let ix = Math.floor(Number(tx) || 0);
      let iy = Math.floor(Number(ty) || 0);
      if (ix >= this.width || iy >= this.height) {
        const converted = this.worldToTile(ix, iy);
        ix = converted.tx;
        iy = converted.ty;
      }
      if (!this.inBounds(ix, iy)) return [];

      let seedTile = this.tiles[iy][ix];
      if (!seedTile || (!seedTile.isBridgeSpan && seedTile.type !== TILE_TYPES.BRIDGE)) {
        // Search within radius 3 for a bridge span tile
        let found = null;
        let bestD2 = Infinity;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const nx = ix + dx;
            const ny = iy + dy;
            if (!this.inBounds(nx, ny)) continue;
            const nt = this.tiles[ny][nx];
            if (nt && (nt.isBridgeSpan || nt.type === TILE_TYPES.BRIDGE)) {
              const d2 = dx * dx + dy * dy;
              if (d2 < bestD2) {
                bestD2 = d2;
                found = nt;
              }
            }
          }
        }
        if (!found) return [];
        seedTile = found;
        ix = seedTile.tx;
        iy = seedTile.ty;
      }

      const targetBridgeId = seedTile.bridgeId;
      const destroyed = [];

      for (let cy = Math.max(0, iy - 4); cy <= Math.min(this.height - 1, iy + 4); cy++) {
        for (let cx = Math.max(0, ix - 4); cx <= Math.min(this.width - 1, ix + 4); cx++) {
          const t = this.tiles[cy][cx];
          if (!t) continue;
          const matchesBridge =
            targetBridgeId !== null && targetBridgeId !== undefined
              ? t.bridgeId === targetBridgeId && (t.isBridgeSpan || t.type === TILE_TYPES.BRIDGE)
              : (t.isBridgeSpan || t.type === TILE_TYPES.BRIDGE) && Math.abs(cx - ix) <= 3 && Math.abs(cy - iy) <= 3;

          if (matchesBridge) {
            t.type = TILE_TYPES.WATER;
            t.isBridgeSpan = true;
            t.demolishedBridge = true;
            t.bridgeHp = 0;
            const world = this.tileToWorld(t.tx, t.ty);
            destroyed.push({ tx: t.tx, ty: t.ty, x: world.x, y: world.y });
          }
        }
      }

      return destroyed;
    }

    repairBridgeSpan(tx, ty) {
      let ix = Math.floor(Number(tx) || 0);
      let iy = Math.floor(Number(ty) || 0);
      if (ix >= this.width || iy >= this.height) {
        const converted = this.worldToTile(ix, iy);
        ix = converted.tx;
        iy = converted.ty;
      }
      ix = Math.max(0, Math.min(this.width - 1, ix));
      iy = Math.max(0, Math.min(this.height - 1, iy));

      const originTile = this.tiles[iy][ix];
      let targetBridgeId =
        originTile && originTile.bridgeHutId !== null && originTile.bridgeHutId !== undefined
          ? originTile.bridgeHutId
          : originTile && originTile.bridgeId !== null && originTile.bridgeId !== undefined
          ? originTile.bridgeId
          : null;

      if (targetBridgeId === null) {
        let bestDist2 = Infinity;
        for (let cy = Math.max(0, iy - 10); cy <= Math.min(this.height - 1, iy + 10); cy++) {
          for (let cx = Math.max(0, ix - 10); cx <= Math.min(this.width - 1, ix + 10); cx++) {
            const t = this.tiles[cy][cx];
            if (t && (t.demolishedBridge || (t.isBridgeSpan && t.bridgeHp < (t.maxBridgeHp || 600)))) {
              const d2 = (cx - ix) * (cx - ix) + (cy - iy) * (cy - iy);
              if (d2 < bestDist2) {
                bestDist2 = d2;
                if (t.bridgeId !== null && t.bridgeId !== undefined) {
                  targetBridgeId = t.bridgeId;
                }
              }
            }
          }
        }
      }

      let restoredCount = 0;
      for (let cy = Math.max(0, iy - 10); cy <= Math.min(this.height - 1, iy + 10); cy++) {
        for (let cx = Math.max(0, ix - 10); cx <= Math.min(this.width - 1, ix + 10); cx++) {
          const t = this.tiles[cy][cx];
          if (!t) continue;
          const matchesSpan =
            targetBridgeId !== null && targetBridgeId !== undefined
              ? t.bridgeId === targetBridgeId && (t.demolishedBridge || t.isBridgeSpan)
              : t.demolishedBridge || (t.isBridgeSpan && t.type === TILE_TYPES.BRIDGE);

          if (matchesSpan && (t.demolishedBridge || t.type !== TILE_TYPES.BRIDGE || t.bridgeHp < (t.maxBridgeHp || 600))) {
            t.type = TILE_TYPES.BRIDGE;
            t.maxBridgeHp = t.maxBridgeHp || 600;
            t.bridgeHp = t.maxBridgeHp;
            t.demolishedBridge = false;
            t.isBridgeSpan = true;
            restoredCount++;
          }
        }
      }

      return restoredCount;
    }

    // --- Ore Harvesting & Regrowth ---

    harvestTile(tx, ty, amount = 25) {
      const tile = this.getTile(tx, ty);
      if (!tile || tile.oreAmount <= 0 || (tile.type !== TILE_TYPES.ORE && tile.type !== TILE_TYPES.GEMS)) {
        return 0;
      }
      const isGems = tile.type === TILE_TYPES.GEMS;
      const harvested = Math.min(tile.oreAmount, amount);
      tile.oreAmount -= harvested;

      if (tile.oreAmount <= 0) {
        tile.oreAmount = 0;
        tile.maxOre = 0;
        tile.type = TILE_TYPES.DIRT;
      }

      // 7 credits per ORE unit (100 -> 700), 14 credits per GEMS unit (100 -> 1400)
      return Math.round(harvested * (isGems ? 14 : 7));
    }

    findNearestOre(startTx, startTy, maxRadius = 40) {
      let sx = Math.floor(Number(startTx) || 0);
      let sy = Math.floor(Number(startTy) || 0);
      // Handle accidental world-coordinate call gracefully
      if (sx >= this.width || sy >= this.height) {
        const converted = this.worldToTile(sx, sy);
        sx = converted.tx;
        sy = converted.ty;
      }
      sx = Math.max(0, Math.min(this.width - 1, sx));
      sy = Math.max(0, Math.min(this.height - 1, sy));

      let bestTile = null;
      let bestDist2 = Infinity;
      const limit = Math.max(1, maxRadius);

      const minX = Math.max(0, sx - limit);
      const maxX = Math.min(this.width - 1, sx + limit);
      const minY = Math.max(0, sy - limit);
      const maxY = Math.min(this.height - 1, sy + limit);

      for (let ty = minY; ty <= maxY; ty++) {
        const row = this.tiles[ty];
        for (let tx = minX; tx <= maxX; tx++) {
          const tile = row[tx];
          if (tile.oreAmount > 0 && (tile.type === TILE_TYPES.ORE || tile.type === TILE_TYPES.GEMS) && tile.buildingId === null) {
            const dx = tx - sx;
            const dy = ty - sy;
            const d2 = dx * dx + dy * dy;
            if (d2 <= limit * limit && d2 < bestDist2) {
              bestDist2 = d2;
              bestTile = tile;
            }
          }
        }
      }

      if (!bestTile) return null;
      const world = this.tileToWorld(bestTile.tx, bestTile.ty);
      return {
        tx: bestTile.tx,
        ty: bestTile.ty,
        x: world.x,
        y: world.y,
        type: bestTile.type,
        oreAmount: bestTile.oreAmount
      };
    }

    regrowOre(dt) {
      this.regrowTimer += Number(dt) || 0;
      if (this.regrowTimer < 15) return;
      this.regrowTimer -= 15;

      const spreads = [];
      for (let ty = 1; ty < this.height - 1; ty++) {
        const row = this.tiles[ty];
        for (let tx = 1; tx < this.width - 1; tx++) {
          const tile = row[tx];
          if ((tile.type === TILE_TYPES.ORE || tile.type === TILE_TYPES.GEMS) && tile.oreAmount > 0) {
            const cap = tile.maxOre || 100;
            if (tile.oreAmount < cap) {
              tile.oreAmount = Math.min(cap, tile.oreAmount + 12);
            }
            if (tile.oreAmount >= 75 && ((tx * 31 + ty * 17) % 5 === 0)) {
              const dirs = [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1]
              ];
              const d = dirs[(tx + ty) & 3];
              const ntx = tx + d[0];
              const nty = ty + d[1];
              if (this.inBounds(ntx, nty)) {
                const neighbor = this.tiles[nty][ntx];
                if (
                  (neighbor.type === TILE_TYPES.DIRT || neighbor.type === TILE_TYPES.GRASS) &&
                  neighbor.buildingId === null &&
                  neighbor.oreAmount === 0
                ) {
                  spreads.push(neighbor);
                }
              }
            }
          }
        }
      }

      for (let i = 0; i < spreads.length; i++) {
        const t = spreads[i];
        t.type = TILE_TYPES.ORE;
        t.oreAmount = 25;
        t.maxOre = 100;
      }
    }

    // --- A* Pathfinding ---

    findPath(startWx, startWy, goalWx, goalWy, locomotionOrIsInfantry = 'land', ignoreBuildingId = null) {
      const locomotion =
        locomotionOrIsInfantry === 'air'
          ? 'air'
          : locomotionOrIsInfantry === 'naval'
          ? 'naval'
          : 'land';

      if (locomotion === 'air') {
        return [
          {
            x: Math.max(8, Math.min(this.pixelWidth - 8, Number(goalWx) || 0)),
            y: Math.max(8, Math.min(this.pixelHeight - 8, Number(goalWy) || 0))
          }
        ];
      }

      const start = this.worldToTile(startWx, startWy);
      const rawGoal = this.worldToTile(goalWx, goalWy);
      let goalTx = rawGoal.tx;
      let goalTy = rawGoal.ty;
      let goalAdjusted = false;

      // If goal tile is impassable, find nearest passable tile within radius (up to 8 for naval, 6 for land)
      const searchMaxR = locomotion === 'naval' ? 8 : 6;
      const searchMaxDist = locomotion === 'naval' ? 8.2 : 5.8;

      if (!this.isPassable(goalTx, goalTy, locomotion, ignoreBuildingId)) {
        goalAdjusted = true;
        let bestTx = -1;
        let bestTy = -1;
        let bestScore = Infinity;

        for (let r = 1; r <= searchMaxR; r++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = goalTx + dx;
              const ny = goalTy + dy;
              if (!this.isPassable(nx, ny, locomotion, ignoreBuildingId)) continue;
              const distToGoal = Math.hypot(dx, dy);
              if (distToGoal > searchMaxDist) continue;
              const distToStart = Math.hypot(nx - start.tx, ny - start.ty);
              const score = distToGoal + distToStart * 0.04;
              if (score < bestScore) {
                bestScore = score;
                bestTx = nx;
                bestTy = ny;
              }
            }
          }
          if (bestTx !== -1 && r >= 2) break;
        }

        if (bestTx !== -1) {
          goalTx = bestTx;
          goalTy = bestTy;
        } else {
          return [];
        }
      }

      if (start.tx === goalTx && start.ty === goalTy) {
        if (goalAdjusted) {
          return [this.tileToWorld(goalTx, goalTy)];
        }
        return [
          {
            x: Math.max(8, Math.min(this.pixelWidth - 8, goalWx)),
            y: Math.max(8, Math.min(this.pixelHeight - 8, goalWy))
          }
        ];
      }

      const w = this.width;
      const gScore = this._gScore;
      const cameFrom = this._cameFrom;
      const visitState = this._visitState;

      gScore.fill(Infinity);
      cameFrom.fill(-1);
      visitState.fill(0);

      const startIdx = start.ty * w + start.tx;
      const goalIdx = goalTy * w + goalTx;

      const heuristic = (tx, ty) => {
        const dx = Math.abs(tx - goalTx);
        const dy = Math.abs(ty - goalTy);
        return (dx + dy + (1.41421356 - 2) * Math.min(dx, dy)) * 0.92;
      };

      const openSet = new MinHeap();
      gScore[startIdx] = 0;
      openSet.push(startIdx, heuristic(start.tx, start.ty));
      visitState[startIdx] = 1;

      let bestNodeIdx = startIdx;
      let bestNodeH = heuristic(start.tx, start.ty);

      const maxIterations = this.width * this.height;
      let iterations = 0;

      // 8-directional neighbor offsets: [dx, dy, baseCost]
      const dirs = [
        [0, -1, 1.0],
        [1, 0, 1.0],
        [0, 1, 1.0],
        [-1, 0, 1.0],
        [1, -1, 1.41421356],
        [1, 1, 1.41421356],
        [-1, 1, 1.41421356],
        [-1, -1, 1.41421356]
      ];

      while (openSet.size > 0 && iterations < maxIterations) {
        iterations++;
        const currentIdx = openSet.pop();
        if (currentIdx === goalIdx) {
          bestNodeIdx = goalIdx;
          break;
        }
        if (visitState[currentIdx] === 2) continue;
        visitState[currentIdx] = 2;

        const cx = currentIdx % w;
        const cy = (currentIdx - cx) / w;
        const currentG = gScore[currentIdx];

        for (let i = 0; i < 8; i++) {
          const d = dirs[i];
          const nx = cx + d[0];
          const ny = cy + d[1];

          if (!this.isPassable(nx, ny, locomotion, ignoreBuildingId)) continue;

          // Prevent diagonal corner-cutting across orthogonal blockers
          if (d[0] !== 0 && d[1] !== 0) {
            if (
              !this.isPassable(cx + d[0], cy, locomotion, ignoreBuildingId) ||
              !this.isPassable(cx, cy + d[1], locomotion, ignoreBuildingId)
            ) {
              continue;
            }
          }

          const nIdx = ny * w + nx;
          if (visitState[nIdx] === 2) continue;

          const tileType = this.tiles[ny][nx].type;
          const terrainMult = (tileType === TILE_TYPES.ROAD || tileType === TILE_TYPES.BRIDGE) ? 0.9 : 1.0;
          const tentativeG = currentG + d[2] * terrainMult;

          if (tentativeG < gScore[nIdx]) {
            cameFrom[nIdx] = currentIdx;
            gScore[nIdx] = tentativeG;
            const h = heuristic(nx, ny);
            if (h < bestNodeH) {
              bestNodeH = h;
              bestNodeIdx = nIdx;
            }
            openSet.push(nIdx, tentativeG + h);
            visitState[nIdx] = 1;
          }
        }
      }

      if (bestNodeIdx === startIdx || bestNodeIdx !== goalIdx) {
        return [];
      }

      // Reconstruct path from bestNodeIdx back to startIdx
      const tilePath = [];
      let curr = bestNodeIdx;
      let safety = this.width * this.height;
      while (curr !== -1 && curr !== startIdx && safety-- > 0) {
        const px = curr % w;
        const py = (curr - px) / w;
        tilePath.push({ tx: px, ty: py });
        curr = cameFrom[curr];
      }
      tilePath.reverse();

      const waypoints = new Array(tilePath.length);
      for (let i = 0; i < tilePath.length; i++) {
        const pt = tilePath[i];
        if (i === tilePath.length - 1 && !goalAdjusted && bestNodeIdx === goalIdx) {
          waypoints[i] = {
            x: Math.max(8, Math.min(this.pixelWidth - 8, goalWx)),
            y: Math.max(8, Math.min(this.pixelHeight - 8, goalWy))
          };
        } else {
          waypoints[i] = this.tileToWorld(pt.tx, pt.ty);
        }
      }

      return waypoints;
    }

    // --- Fog of War ---

    updateFog(entities, playerTeam = 'player', revealAll = false) {
      if (revealAll || !this.fogEnabled) {
        for (let ty = 0; ty < this.height; ty++) {
          const fogRow = this.fog[ty];
          for (let tx = 0; tx < this.width; tx++) {
            fogRow[tx] = FOG.VISIBLE;
          }
        }
        return;
      }

      // Transition VISIBLE -> EXPLORED
      for (let ty = 0; ty < this.height; ty++) {
        const fogRow = this.fog[ty];
        for (let tx = 0; tx < this.width; tx++) {
          if (fogRow[tx] === FOG.VISIBLE) {
            fogRow[tx] = FOG.EXPLORED;
          }
        }
      }

      const entityList = Array.isArray(entities)
        ? entities
        : (entities && Array.isArray(entities.entities) ? entities.entities : []);

      for (let i = 0; i < entityList.length; i++) {
        const e = entityList[i];
        if (!e || e.dead || e.team !== playerTeam) continue;
        const sight = Number(e.sight) || (e.def && Number(e.def.sight)) || 6;
        const extraRadius = e.isBuilding ? Math.max(e.w || 1, e.h || 1) * 0.4 : 0;
        this.revealCircle(e.x, e.y, sight + extraRadius);
      }
    }

    revealCircle(wx, wy, radiusTiles = 6) {
      const centerTx = (Number(wx) || 0) / this.tileSize;
      const centerTy = (Number(wy) || 0) / this.tileSize;
      const r = Math.max(1, Number(radiusTiles) || 6) + 0.35;
      const r2 = r * r;

      const minTx = Math.max(0, Math.floor(centerTx - r));
      const maxTx = Math.min(this.width - 1, Math.ceil(centerTx + r));
      const minTy = Math.max(0, Math.floor(centerTy - r));
      const maxTy = Math.min(this.height - 1, Math.ceil(centerTy + r));

      for (let ty = minTy; ty <= maxTy; ty++) {
        const fogRow = this.fog[ty];
        const dy = ty + 0.5 - centerTy;
        const dy2 = dy * dy;
        for (let tx = minTx; tx <= maxTx; tx++) {
          const dx = tx + 0.5 - centerTx;
          if (dx * dx + dy2 <= r2) {
            fogRow[tx] = FOG.VISIBLE;
          }
        }
      }
    }

    isWorldPosVisible(wx, wy) {
      if (!this.fogEnabled) return true;
      const { tx, ty } = this.worldToTile(wx, wy);
      return this.fog[ty][tx] === FOG.VISIBLE;
    }

    isTileVisible(tx, ty) {
      if (!this.fogEnabled) return true;
      const ix = Math.floor(tx);
      const iy = Math.floor(ty);
      if (!this.inBounds(ix, iy)) return false;
      return this.fog[iy][ix] === FOG.VISIBLE;
    }

    getFog(tx, ty) {
      if (!this.fogEnabled) return FOG.VISIBLE;
      const ix = Math.floor(tx);
      const iy = Math.floor(ty);
      if (!this.inBounds(ix, iy)) return FOG.UNEXPLORED;
      return this.fog[iy][ix];
    }
  }

  window.RA.GameMap = GameMap;
})();
