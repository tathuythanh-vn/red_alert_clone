/**
 * Command & Conquer: Red Alert — HTML5 Canvas 2D Battlefield & Minimap Renderer
 * Exposes window.RA.Renderer
 */
(function () {
  'use strict';

  window.RA = window.RA || {};

  // Deterministic pseudo-random helper for tile & procedural details
  function tileHash(tx, ty, salt) {
    let n = (tx * 374761393 + ty * 668265263 + (salt || 0) * 1442695041) | 0;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  }

  // Built-in fallback theater palettes per Phase 4.2 specification
  const DEFAULT_THEATERS = {
    temperate: {
      id: 'temperate',
      name: 'European Temperate',
      grass: ['#2b4728', '#274224', '#2f4d2c', '#294526'],
      grassDetailDark: '#21381e',
      grassDetailLight: '#385c34',
      grassBlade: '#426b3d',
      dirt: ['#594635', '#534131'],
      dirtDetailDark: '#473628',
      dirtDetailLight: '#6b5542',
      road: ['#484037', '#3d362e'],
      roadTrack: '#574d42',
      water: ['#0d2b45', '#0b253c', '#153e61'],
      waterFoam: 'rgba(186, 230, 253, 0.38)',
      waterShimmer: 'rgba(125, 211, 252, 0.32)',
      rock: ['#374151', '#64748b', '#1e293b'],
      rockBase: '#232924',
      minimap: {
        grass: '#2d4c2b',
        dirt: '#5c4938',
        road: '#5c4938',
        water: '#143d66',
        rock: '#475569',
        bridge: '#94a3b8'
      }
    },
    snow: {
      id: 'snow',
      name: 'Siberian Winter',
      grass: ['#e2e8f0', '#cbd5e1', '#f1f5f9', '#dbeafe'],
      grassDetailDark: '#94a3b8',
      grassDetailLight: '#f8fafc',
      grassBlade: '#ffffff',
      dirt: ['#64748b', '#475569'],
      dirtDetailDark: '#334155',
      dirtDetailLight: '#94a3b8',
      road: ['#334155', '#1e293b'],
      roadTrack: '#475569',
      water: ['#0c4a6e', '#075985', '#0369a1'],
      waterFoam: 'rgba(241, 245, 249, 0.82)',
      waterShimmer: 'rgba(224, 242, 254, 0.48)',
      rock: ['#475569', '#94a3b8', '#1e293b'],
      rockBase: '#334155',
      minimap: {
        grass: '#cbd5e1',
        dirt: '#64748b',
        road: '#334155',
        water: '#0c4a6e',
        rock: '#475569',
        bridge: '#94a3b8'
      }
    },
    desert: {
      id: 'desert',
      name: 'North African Arid',
      grass: ['#d97706', '#b45309', '#f59e0b', '#c2410c'],
      grassDetailDark: '#92400e',
      grassDetailLight: '#fbbf24',
      grassBlade: '#fde68a',
      dirt: ['#92400e', '#78350f'],
      dirtDetailDark: '#451a03',
      dirtDetailLight: '#b45309',
      road: ['#57534e', '#44403c'],
      roadTrack: '#78716c',
      water: ['#0369a1', '#0284c7', '#38bdf8'],
      waterFoam: 'rgba(254, 243, 199, 0.48)',
      waterShimmer: 'rgba(186, 230, 253, 0.42)',
      rock: ['#78350f', '#a16207', '#451a03'],
      rockBase: '#451a03',
      minimap: {
        grass: '#d97706',
        dirt: '#92400e',
        road: '#57534e',
        water: '#0284c7',
        rock: '#78350f',
        bridge: '#a8a29e'
      }
    }
  };

  class Renderer {
    constructor(mainCanvas, minimapCanvas) {
      this.canvas = mainCanvas || null;
      this.ctx = mainCanvas ? mainCanvas.getContext('2d') : null;
      this.minimapCanvas = minimapCanvas || null;
      this.minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

      this.camera = {
        x: 0,
        y: 0,
        width: mainCanvas ? mainCanvas.width : 800,
        height: mainCanvas ? mainCanvas.height : 600,
        speed: 600,
        zoom: 1.0,
        targetZoom: 1.0,
        minZoom: 0.6,
        maxZoom: 1.5
      };

      this.placementPreview = null; // { category, defId, def, tx, ty }
      this.superweaponTargeting = null; // { swId, worldX, worldY }
      this.selectionBox = null; // { x1, y1, x2, y2 }
      this.cursorMode = 'normal'; // 'normal' | 'place' | 'repair' | 'sell' | 'attackMove' | 'patrol' | 'superweapon'
      this.animTime = 0;

      // Visual feedback pulses (e.g., move / attack-move order rings)
      this.movePulses = [];
      this.lastMap = null;
      this.lastEngine = null;
      this.mouseScreen = { x: 0, y: 0 };
      this.mouseWorld = { x: 0, y: 0 };
    }

    // =========================================================================
    // CAMERA & ZOOM METHODS
    // =========================================================================

    resize(width, height) {
      const w = Math.max(1, Math.floor(width || 800));
      const h = Math.max(1, Math.floor(height || 600));
      if (this.canvas) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.camera.width = w;
      this.camera.height = h;
      if (this.lastMap) {
        this._clampCamera(this.lastMap);
      }
    }

    _clampCamera(map) {
      const m = map || this.lastMap;
      if (!m) return;
      const tileSize = m.tileSize || window.RA.TILE_SIZE || 40;
      const pixelWidth = m.pixelWidth || m.width * tileSize;
      const pixelHeight = m.pixelHeight || m.height * tileSize;
      const z = this.camera.zoom || 1.0;
      const viewW = this.camera.width / z;
      const viewH = this.camera.height / z;
      const maxX = Math.max(0, pixelWidth - viewW);
      const maxY = Math.max(0, pixelHeight - viewH);
      this.camera.x = Math.max(0, Math.min(maxX, this.camera.x));
      this.camera.y = Math.max(0, Math.min(maxY, this.camera.y));
    }

    centerOn(wx, wy, map) {
      const m = map || this.lastMap;
      const z = this.camera.zoom || 1.0;
      this.camera.x = wx - this.camera.width / z / 2;
      this.camera.y = wy - this.camera.height / z / 2;
      if (m) {
        this._clampCamera(m);
      } else {
        this.camera.x = Math.max(0, this.camera.x);
        this.camera.y = Math.max(0, this.camera.y);
      }
    }

    pan(dx, dy, map) {
      const m = map || this.lastMap;
      this.camera.x += dx;
      this.camera.y += dy;
      if (m) {
        this._clampCamera(m);
      } else {
        this.camera.x = Math.max(0, this.camera.x);
        this.camera.y = Math.max(0, this.camera.y);
      }
    }

    setZoom(newZoom, pivotScreenX, pivotScreenY, map) {
      const minZ = this.camera.minZoom || 0.6;
      const maxZ = this.camera.maxZoom || 1.5;
      const clamped = Math.max(minZ, Math.min(maxZ, Number(newZoom) || 1.0));
      const sx = typeof pivotScreenX === 'number' ? pivotScreenX : this.camera.width / 2;
      const sy = typeof pivotScreenY === 'number' ? pivotScreenY : this.camera.height / 2;

      // Anchor the world point currently under (sx, sy)
      const worldBefore = this.screenToWorld(sx, sy);
      this.camera.zoom = clamped;
      this.camera.targetZoom = clamped;
      this.camera.x = worldBefore.x - sx / clamped;
      this.camera.y = worldBefore.y - sy / clamped;

      const m = map || this.lastMap;
      if (m) {
        this._clampCamera(m);
      }
      return clamped;
    }

    screenToWorld(sx, sy) {
      if (sx && typeof sx === 'object') {
        sy = sx.y;
        sx = sx.x;
      }
      const z = this.camera.zoom || 1.0;
      return {
        x: sx / z + this.camera.x,
        y: sy / z + this.camera.y
      };
    }

    worldToScreen(wx, wy) {
      if (wx && typeof wx === 'object') {
        wy = wx.y;
        wx = wx.x;
      }
      const z = this.camera.zoom || 1.0;
      return {
        x: (wx - this.camera.x) * z,
        y: (wy - this.camera.y) * z
      };
    }

    addMovePulse(wx, wy, color = '#22c55e') {
      this.movePulses.push({
        x: wx,
        y: wy,
        color,
        life: 0.45,
        maxLife: 0.45
      });
    }

    // =========================================================================
    // THEATER PALETTE RESOLVER
    // =========================================================================

    _getTheaterPalette(theaterId) {
      const id =
        theaterId === 'snow' || theaterId === 'desert' || theaterId === 'temperate'
          ? theaterId
          : 'temperate';
      const fallback = DEFAULT_THEATERS[id] || DEFAULT_THEATERS.temperate;
      const ext =
        window.RA.DATA && window.RA.DATA.THEATERS && window.RA.DATA.THEATERS[id]
          ? window.RA.DATA.THEATERS[id]
          : null;

      if (!ext) return fallback;

      const grass =
        (Array.isArray(ext.grass) && ext.grass.length > 0 && ext.grass) ||
        (Array.isArray(ext.grassShades) && ext.grassShades.length > 0 && ext.grassShades) ||
        (Array.isArray(ext.ground) && ext.ground.length > 0 && ext.ground) ||
        fallback.grass;
      const dirt =
        (Array.isArray(ext.dirt) && ext.dirt.length > 0 && ext.dirt) ||
        (Array.isArray(ext.dirtShades) && ext.dirtShades.length > 0 && ext.dirtShades) ||
        fallback.dirt;
      const road =
        (Array.isArray(ext.road) && ext.road.length > 0 && ext.road) ||
        (Array.isArray(ext.roadShades) && ext.roadShades.length > 0 && ext.roadShades) ||
        fallback.road;
      const water =
        (Array.isArray(ext.water) && ext.water.length > 0 && ext.water) ||
        (Array.isArray(ext.waterShades) && ext.waterShades.length > 0 && ext.waterShades) ||
        fallback.water;
      const rock =
        (Array.isArray(ext.rock) && ext.rock.length > 0 && ext.rock) ||
        (Array.isArray(ext.rockFacets) && ext.rockFacets.length > 0 && ext.rockFacets) ||
        (Array.isArray(ext.rockShades) && ext.rockShades.length > 0 && ext.rockShades) ||
        fallback.rock;

      return {
        ...fallback,
        ...ext,
        id,
        grass,
        dirt,
        road,
        water,
        rock,
        minimap: {
          ...fallback.minimap,
          ...(ext.minimap || {})
        }
      };
    }

    // =========================================================================
    // MAIN BATTLEFIELD RENDER PASS
    // =========================================================================

    render(engine, dt) {
      const step = typeof dt === 'number' && dt > 0 ? Math.min(dt, 0.1) : 0.016;
      this.animTime += step;

      if (!this.ctx || !this.canvas) return;
      const ctx = this.ctx;

      // Clear full viewport
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      if (!engine || !engine.map) return;
      const map = engine.map;
      this.lastMap = map;
      this.lastEngine = engine;
      this._clampCamera(map);

      const tileSize = map.tileSize || window.RA.TILE_SIZE || 40;
      const T = window.RA.TILE_TYPES || {
        GRASS: 0,
        DIRT: 1,
        WATER: 2,
        BRIDGE: 3,
        ROCK: 4,
        ORE: 5,
        GEMS: 6,
        ROAD: 7
      };
      const FOG = window.RA.FOG || {
        UNEXPLORED: 0,
        EXPLORED: 1,
        VISIBLE: 2
      };

      const z = this.camera.zoom || 1.0;
      const viewW = this.camera.width / z;
      const viewH = this.camera.height / z;

      const startTx = Math.max(0, Math.floor(this.camera.x / tileSize) - 1);
      const endTx = Math.min(map.width - 1, Math.ceil((this.camera.x + viewW) / tileSize) + 1);
      const startTy = Math.max(0, Math.floor(this.camera.y / tileSize) - 1);
      const endTy = Math.min(map.height - 1, Math.ceil((this.camera.y + viewH) / tileSize) + 1);

      ctx.save();
      ctx.scale(z, z);
      ctx.translate(-this.camera.x, -this.camera.y);

      // 1. Visible Tile Culling & Terrain Rendering
      this._renderTerrain(ctx, map, startTx, endTx, startTy, endTy, tileSize, T, FOG);

      // 1b. Persistent Battlefield Decals (Craters, Nuke Craters, Rubble, Tank Tracks)
      this._renderDecals(ctx, engine, map, tileSize, FOG);

      // 1c. Bonus Supply Crates
      this._renderCrates(ctx, engine, map, tileSize, FOG);

      // Update & render move order pulses on terrain
      this._renderMovePulses(ctx, step);

      // 2. Buildings Rendering
      this._renderBuildings(ctx, engine, map, tileSize, FOG);

      // 3. Units Rendering
      this._renderUnits(ctx, engine, map, tileSize, FOG);

      // 4. Projectiles, Particles & Floating Texts
      this._renderProjectiles(ctx, engine, map, tileSize, FOG);
      this._renderParticles(ctx, engine, map, tileSize, FOG);
      this._renderFloatingTexts(ctx, engine);

      // 5. Fog of War Pass
      this._renderFogOfWar(ctx, map, startTx, endTx, startTy, endTy, tileSize, FOG);

      // 6. World-space Overlays (Placement Footprint, Superweapon Reticle, Waypoints & Patrol)
      this._renderWorldOverlays(ctx, engine, map, tileSize);

      ctx.restore();

      // 7. Screen-space Overlays (Selection Box)
      this._renderScreenOverlays(ctx, engine);
    }

    // =========================================================================
    // 1. TERRAIN RENDERING (WITH THEATERS & DESTRUCTIBLE BRIDGES / HUTS)
    // =========================================================================

    _renderTerrain(ctxOrEngine, map, startTx, endTx, startTy, endTy, tileSize, T, FOG) {
      let ctx = ctxOrEngine;
      if (!ctx || typeof ctx.fillRect !== 'function') {
        const eng = ctxOrEngine;
        ctx = this.ctx;
        map = map || (eng && eng.map) || this.lastMap;
        if (!ctx || !map) return;
        tileSize = map.tileSize || window.RA.TILE_SIZE || 40;
        T = window.RA.TILE_TYPES || {
          GRASS: 0,
          DIRT: 1,
          WATER: 2,
          BRIDGE: 3,
          ROCK: 4,
          ORE: 5,
          GEMS: 6,
          ROAD: 7
        };
        FOG = window.RA.FOG || { UNEXPLORED: 0, EXPLORED: 1, VISIBLE: 2 };
        const z = this.camera.zoom || 1.0;
        startTx = Math.max(0, Math.floor(this.camera.x / tileSize) - 1);
        endTx = Math.min(map.width - 1, Math.ceil((this.camera.x + this.camera.width / z) / tileSize) + 1);
        startTy = Math.max(0, Math.floor(this.camera.y / tileSize) - 1);
        endTy = Math.min(map.height - 1, Math.ceil((this.camera.y + this.camera.height / z) / tileSize) + 1);
      }

      const theaterId = map.theater || 'temperate';
      const palette = this._getTheaterPalette(theaterId);
      const fogEnabled = map.fogEnabled !== false && Array.isArray(map.fog);
      const showGrid = this.cursorMode === 'place' || Boolean(this.placementPreview);

      for (let ty = startTy; ty <= endTy; ty++) {
        const row = map.tiles && map.tiles[ty];
        if (!row) continue;
        const fogRow = fogEnabled ? map.fog[ty] : null;
        const py = ty * tileSize;

        for (let tx = startTx; tx <= endTx; tx++) {
          if (fogRow && fogRow[tx] === FOG.UNEXPLORED) {
            continue;
          }

          const tile = row[tx];
          if (!tile) continue;
          const px = tx * tileSize;
          const variant = tile.variant || 0;
          const h1 = tileHash(tx, ty, 1);
          const h2 = tileHash(tx, ty, 2);

          switch (tile.type) {
            case T.WATER: {
              this._drawWaterTile(ctx, map, tile, tx, ty, px, py, tileSize, T, palette);
              break;
            }
            case T.BRIDGE: {
              this._drawBridgeTile(ctx, map, tile, tx, ty, px, py, tileSize, T, palette);
              break;
            }
            case T.DIRT: {
              const dirtShades = palette.dirt;
              ctx.fillStyle = dirtShades[variant % dirtShades.length];
              ctx.fillRect(px, py, tileSize, tileSize);
              ctx.fillStyle = palette.dirtDetailDark;
              ctx.fillRect(px + h1 * 22, py + h2 * 22, 6, 5);
              ctx.fillStyle = palette.dirtDetailLight;
              ctx.fillRect(px + (1 - h2) * 26, py + h1 * 26, 4, 4);
              break;
            }
            case T.ROAD: {
              ctx.fillStyle = palette.road[0];
              ctx.fillRect(px, py, tileSize, tileSize);
              ctx.fillStyle = palette.road[1] || palette.road[0];
              ctx.fillRect(px + 4, py + 4, tileSize - 8, tileSize - 8);
              ctx.fillStyle = palette.roadTrack;
              ctx.fillRect(px + 9, py, 4, tileSize);
              ctx.fillRect(px + tileSize - 13, py, 4, tileSize);
              ctx.fillRect(px, py + 9, tileSize, 4);
              ctx.fillRect(px, py + tileSize - 13, tileSize, 4);
              break;
            }
            case T.ROCK: {
              this._drawRockTile(ctx, px, py, tileSize, tx, ty, h1, h2, palette);
              break;
            }
            case T.ORE: {
              this._drawGrassBase(ctx, px, py, tileSize, variant, h1, h2, palette);
              this._drawOreOverlay(ctx, px, py, tileSize, tile, tx, ty, false);
              break;
            }
            case T.GEMS: {
              this._drawGrassBase(ctx, px, py, tileSize, variant, h1, h2, palette);
              this._drawOreOverlay(ctx, px, py, tileSize, tile, tx, ty, true);
              break;
            }
            case T.GRASS:
            default: {
              this._drawGrassBase(ctx, px, py, tileSize, variant, h1, h2, palette);
              break;
            }
          }

          // Bridge Repair Hut on approach tiles next to bridges
          if (tile.hasBridgeHut) {
            this._drawBridgeRepairHut(ctx, px, py, tileSize);
          }

          if (showGrid && tile.type !== T.WATER && tile.type !== T.ROCK && tile.type !== T.BRIDGE) {
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
          }
        }
      }
    }

    _drawGrassBase(ctx, px, py, tileSize, variant, h1, h2, palette) {
      const pal = palette || DEFAULT_THEATERS.temperate;
      const shades = pal.grass || DEFAULT_THEATERS.temperate.grass;
      ctx.fillStyle = shades[variant % shades.length];
      ctx.fillRect(px, py, tileSize, tileSize);

      ctx.fillStyle = pal.grassDetailDark;
      ctx.fillRect(px + Math.floor(h1 * 26), py + Math.floor(h2 * 26), 6, 4);
      ctx.fillStyle = pal.grassDetailLight;
      ctx.fillRect(px + Math.floor((1 - h1) * 28), py + Math.floor(h1 * 28), 4, 3);

      if (pal.id === 'snow') {
        // Siberian snow drift ridges & frost glints
        if (h1 > 0.35) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
          ctx.fillRect(px + Math.floor(h2 * 16) + 3, py + Math.floor(h1 * 24) + 4, 14, 3);
        }
      } else if (pal.id === 'desert') {
        // Arid wind-swept sand dune ripples
        if (h2 > 0.35) {
          ctx.fillStyle = 'rgba(253, 230, 138, 0.32)';
          ctx.fillRect(px + 4, py + Math.floor(h1 * 28) + 4, tileSize - 10, 2);
        }
      } else if (h2 > 0.55) {
        ctx.fillStyle = pal.grassBlade;
        ctx.fillRect(px + Math.floor(h2 * 24) + 4, py + Math.floor((1 - h2) * 24) + 2, 2, 4);
      }
    }

    _drawWaterTile(ctx, map, tile, tx, ty, px, py, tileSize, T, palette) {
      const pal = palette || DEFAULT_THEATERS.temperate;
      const waterShades = pal.water || DEFAULT_THEATERS.temperate.water;
      const wave = Math.sin(this.animTime * 2.6 + tx * 0.7 + ty * 0.5);
      ctx.fillStyle = wave > 0 ? waterShades[0] : waterShades[1] || waterShades[0];
      ctx.fillRect(px, py, tileSize, tileSize);

      // Animated water ripple bands
      ctx.fillStyle = waterShades[2] || waterShades[0];
      const offset1 = Math.floor(((Math.sin(this.animTime * 2.2 + tx * 0.9 + ty * 0.4) + 1) * 0.5) * 10);
      ctx.fillRect(px + 4, py + 8 + offset1, tileSize - 8, 3);

      // Shimmering specular wave highlight
      ctx.fillStyle = pal.waterShimmer;
      const offset2 = Math.floor(((Math.cos(this.animTime * 3.1 + tx * 0.6 - ty * 0.8) + 1) * 0.5) * 14);
      ctx.fillRect(px + 8 + (offset2 % 8), py + 22 - Math.floor(offset2 * 0.5), 12, 2);

      // Snow theater floating ice floe chunks
      if (pal.id === 'snow' && tileHash(tx, ty, 7) > 0.62) {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
        ctx.beginPath();
        ctx.moveTo(px + 10, py + 12);
        ctx.lineTo(px + 22, py + 9);
        ctx.lineTo(px + 26, py + 18);
        ctx.lineTo(px + 14, py + 21);
        ctx.closePath();
        ctx.fill();
      }

      // Shoreline foam / ice shelf edges where water meets land
      const up = map.getTile ? map.getTile(tx, ty - 1) : null;
      const down = map.getTile ? map.getTile(tx, ty + 1) : null;
      const left = map.getTile ? map.getTile(tx - 1, ty) : null;
      const right = map.getTile ? map.getTile(tx + 1, ty) : null;

      const edgeThickness = pal.id === 'snow' ? 4 : 3;
      ctx.fillStyle = pal.waterFoam;
      if (up && up.type !== T.WATER && up.type !== T.BRIDGE) ctx.fillRect(px, py, tileSize, edgeThickness);
      if (down && down.type !== T.WATER && down.type !== T.BRIDGE) {
        ctx.fillRect(px, py + tileSize - edgeThickness, tileSize, edgeThickness);
      }
      if (left && left.type !== T.WATER && left.type !== T.BRIDGE) ctx.fillRect(px, py, edgeThickness, tileSize);
      if (right && right.type !== T.WATER && right.type !== T.BRIDGE) {
        ctx.fillRect(px + tileSize - edgeThickness, py, edgeThickness, tileSize);
      }

      // Demolished bridge pilings & submerged wreckage in water
      if (tile && tile.demolishedBridge) {
        ctx.save();
        // Swirling white water eddies around broken pilings
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px + 10, py + 12, 6 + Math.sin(this.animTime * 4 + tx) * 1.5, 0, Math.PI * 2);
        ctx.arc(px + tileSize - 10, py + tileSize - 12, 6 + Math.cos(this.animTime * 4 + ty) * 1.5, 0, Math.PI * 2);
        ctx.stroke();

        // Broken concrete piers & twisted steel I-beams
        ctx.fillStyle = '#334155';
        ctx.fillRect(px + 6, py + 8, 8, 8);
        ctx.fillRect(px + tileSize - 14, py + tileSize - 16, 8, 8);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(px + 7, py + 9, 5, 5);
        ctx.fillRect(px + tileSize - 13, py + tileSize - 15, 5, 5);

        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px + 10, py + 12);
        ctx.lineTo(px + 20, py + 18);
        ctx.moveTo(px + tileSize - 10, py + tileSize - 12);
        ctx.lineTo(px + 22, py + 24);
        ctx.stroke();
        ctx.restore();
      }
    }

    _drawBridgeTile(ctx, map, tile, tx, ty, px, py, tileSize, T, palette) {
      const pal = palette || DEFAULT_THEATERS.temperate;
      ctx.fillStyle = (pal.water && pal.water[1]) || '#0b253c';
      ctx.fillRect(px, py, tileSize, tileSize);

      // Steel bridge deck
      ctx.fillStyle = '#475569';
      ctx.fillRect(px, py, tileSize, tileSize);

      // Wooden/steel reinforced roadway planks
      ctx.fillStyle = '#334155';
      for (let i = 2; i < tileSize; i += 8) {
        ctx.fillRect(px + 2, py + i, tileSize - 4, 5);
      }

      // Center yellow tactical divider line
      ctx.fillStyle = 'rgba(250, 204, 21, 0.55)';
      ctx.fillRect(px + tileSize / 2 - 1, py + 4, 2, tileSize - 8);

      // Industrial steel guardrails & rivets on left/right if adjacent to water
      const left = map.getTile ? map.getTile(tx - 1, ty) : null;
      const right = map.getTile ? map.getTile(tx + 1, ty) : null;
      const up = map.getTile ? map.getTile(tx, ty - 1) : null;
      const down = map.getTile ? map.getTile(tx, ty + 1) : null;

      ctx.fillStyle = '#94a3b8';
      if (left && left.type === T.WATER) {
        ctx.fillRect(px, py, 5, tileSize);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(px + 1, py + 4, 3, 6);
        ctx.fillRect(px + 1, py + 24, 3, 6);
      }
      ctx.fillStyle = '#94a3b8';
      if (right && right.type === T.WATER) {
        ctx.fillRect(px + tileSize - 5, py, 5, tileSize);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(px + tileSize - 4, py + 4, 3, 6);
        ctx.fillRect(px + tileSize - 4, py + 24, 3, 6);
      }
      ctx.fillStyle = '#94a3b8';
      if (up && up.type === T.WATER) {
        ctx.fillRect(px, py, tileSize, 5);
      }
      if (down && down.type === T.WATER) {
        ctx.fillRect(px, py + tileSize - 5, tileSize, 5);
      }

      // Structural damage cracks when bridgeHp < maxBridgeHp
      const maxHp = (tile && tile.maxBridgeHp) || 600;
      const curHp = tile && typeof tile.bridgeHp === 'number' ? tile.bridgeHp : maxHp;
      if (curHp < maxHp) {
        const dmgRatio = 1 - Math.max(0, curHp / maxHp);
        ctx.save();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = dmgRatio > 0.5 ? 2.5 : 1.6;
        ctx.beginPath();
        ctx.moveTo(px + 8, py + 6);
        ctx.lineTo(px + 18, py + 19);
        ctx.lineTo(px + 14, py + 31);
        ctx.moveTo(px + 18, py + 19);
        ctx.lineTo(px + 31, py + 24);
        ctx.stroke();

        if (dmgRatio > 0.45) {
          // Shell hole showing dark water beneath deck
          ctx.fillStyle = '#090d16';
          ctx.beginPath();
          ctx.arc(px + 20, py + 20, 5 * dmgRatio, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    _drawBridgeRepairHut(ctx, px, py, tileSize) {
      ctx.save();
      const hx = px + tileSize - 18;
      const hy = py + 4;
      // Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(hx + 2, hy + 2, 14, 14);
      // Hut walls & steel roof
      ctx.fillStyle = '#334155';
      ctx.fillRect(hx, hy, 14, 14);
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hx + 0.5, hy + 0.5, 13, 13);
      // Engineering cross / wrench emblem
      ctx.fillStyle = '#facc15';
      ctx.fillRect(hx + 5, hy + 3, 4, 8);
      ctx.fillRect(hx + 3, hy + 5, 8, 4);
      // Blinking beacon dot
      const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 6);
      ctx.fillStyle = `rgba(56, 189, 248, ${pulse})`;
      ctx.beginPath();
      ctx.arc(hx + 11, hy + 3, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _drawRockTile(ctx, px, py, tileSize, tx, ty, h1, h2, palette) {
      const pal = palette || DEFAULT_THEATERS.temperate;
      const facets = pal.rock || DEFAULT_THEATERS.temperate.rock;

      // Base dark earth under cliff
      ctx.fillStyle = pal.rockBase || '#232924';
      ctx.fillRect(px, py, tileSize, tileSize);

      // Drop shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.arc(px + tileSize * 0.54, py + tileSize * 0.56, tileSize * 0.44, 0, Math.PI * 2);
      ctx.fill();

      // 3D-shaded boulder facets
      ctx.fillStyle = facets[0] || '#374151';
      ctx.beginPath();
      ctx.moveTo(px + 4, py + tileSize - 6);
      ctx.lineTo(px + 6, py + 10);
      ctx.lineTo(px + 18, py + 4);
      ctx.lineTo(px + tileSize - 5, py + 9);
      ctx.lineTo(px + tileSize - 4, py + tileSize - 7);
      ctx.lineTo(px + 20, py + tileSize - 3);
      ctx.closePath();
      ctx.fill();

      // Top-left illuminated ridge facet
      ctx.fillStyle = facets[1] || '#64748b';
      ctx.beginPath();
      ctx.moveTo(px + 7, py + 12);
      ctx.lineTo(px + 18, py + 5);
      ctx.lineTo(px + 28, py + 13);
      ctx.lineTo(px + 17, py + 22);
      ctx.closePath();
      ctx.fill();

      // Bottom-right dark shadow facet
      ctx.fillStyle = facets[2] || '#1e293b';
      ctx.beginPath();
      ctx.moveTo(px + 17, py + 22);
      ctx.lineTo(px + 28, py + 13);
      ctx.lineTo(px + tileSize - 5, py + tileSize - 7);
      ctx.lineTo(px + 14, py + tileSize - 5);
      ctx.closePath();
      ctx.fill();
    }

    _drawOreOverlay(ctx, px, py, tileSize, tile, tx, ty, isGems) {
      const ratio = Math.max(0.2, Math.min(1, (tile.oreAmount || 50) / (tile.maxOre || 100)));
      const count = Math.max(2, Math.round(ratio * (isGems ? 7 : 8)));

      // Dirt patch beneath ore
      ctx.fillStyle = 'rgba(74, 58, 42, 0.55)';
      ctx.beginPath();
      ctx.arc(px + tileSize / 2, py + tileSize / 2, tileSize * (0.22 + ratio * 0.2), 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < count; i++) {
        const hx = tileHash(tx, ty, 10 + i * 2);
        const hy = tileHash(tx, ty, 11 + i * 2);
        const ox = px + 6 + hx * (tileSize - 12);
        const oy = py + 6 + hy * (tileSize - 12);
        const sz = (isGems ? 3.5 : 3.2) + (i % 2) * 1.4;

        if (isGems) {
          ctx.fillStyle = i % 2 === 0 ? '#e11d48' : '#a855f7';
          ctx.beginPath();
          ctx.moveTo(ox, oy - sz);
          ctx.lineTo(ox + sz, oy);
          ctx.lineTo(ox, oy + sz);
          ctx.lineTo(ox - sz, oy);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#fda4af';
          ctx.fillRect(ox - 1, oy - sz * 0.5, 2, 2);
        } else {
          ctx.fillStyle = '#b45309';
          ctx.fillRect(ox - sz * 0.5 + 1, oy - sz * 0.5 + 1, sz, sz);
          ctx.fillStyle = i % 2 === 0 ? '#fbbf24' : '#f59e0b';
          ctx.fillRect(ox - sz * 0.5, oy - sz * 0.5, sz, sz);
        }
      }

      const glint = Math.sin(this.animTime * 4.5 + tx * 1.7 + ty * 2.3);
      if (glint > 0.75) {
        ctx.fillStyle = isGems ? '#ffffff' : '#fef08a';
        ctx.fillRect(px + tileSize * 0.45, py + tileSize * 0.4, 3, 3);
      }
    }

    // =========================================================================
    // 1B. PERSISTENT BATTLEFIELD DECALS & BONUS SUPPLY CRATES
    // =========================================================================

    _renderDecals(ctxOrEngine, maybeEngine, map, tileSize, FOG) {
      let ctx = ctxOrEngine;
      let engine = maybeEngine;
      if (!ctx || typeof ctx.save !== 'function') {
        engine = ctxOrEngine;
        ctx = this.ctx;
      }
      if (!ctx || !engine || !Array.isArray(engine.decals) || engine.decals.length === 0) return;

      map = map || engine.map || this.lastMap;
      tileSize = (map && map.tileSize) || window.RA.TILE_SIZE || 40;
      FOG = FOG || window.RA.FOG || { UNEXPLORED: 0, EXPLORED: 1, VISIBLE: 2 };
      const fogEnabled = map && map.fogEnabled !== false && Array.isArray(map.fog);
      const z = this.camera.zoom || 1.0;
      const viewW = this.camera.width / z;
      const viewH = this.camera.height / z;

      for (let i = 0; i < engine.decals.length; i++) {
        const d = engine.decals[i];
        if (!d) continue;

        const r = d.radius || (d.type === 'nuke_crater' ? 46 : d.type === 'rubble' ? 22 : 14);
        if (
          d.x + r < this.camera.x - 40 ||
          d.x - r > this.camera.x + viewW + 40 ||
          d.y + r < this.camera.y - 40 ||
          d.y - r > this.camera.y + viewH + 40
        ) {
          continue;
        }

        if (fogEnabled && map) {
          const tx = Math.max(0, Math.min(map.width - 1, Math.floor(d.x / tileSize)));
          const ty = Math.max(0, Math.min(map.height - 1, Math.floor(d.y / tileSize)));
          if (map.fog[ty] && map.fog[ty][tx] === FOG.UNEXPLORED) continue;
        }

        let alpha = typeof d.alpha === 'number' ? d.alpha : 0.72;
        if (typeof d.createdAt === 'number' && typeof engine.elapsedTime === 'number' && d.maxAge > 0) {
          const age = Math.max(0, engine.elapsedTime - d.createdAt);
          alpha *= Math.max(0.12, 1 - age / d.maxAge);
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0.05, Math.min(1, alpha));
        ctx.translate(d.x, d.y);
        if (d.angle) ctx.rotate(d.angle);

        if (d.type === 'tracks') {
          ctx.fillStyle = 'rgba(28, 25, 23, 0.55)';
          for (let ox = -6; ox <= 6; ox += 4) {
            ctx.fillRect(ox, -9, 2.5, 4);
            ctx.fillRect(ox, 5, 2.5, 4);
          }
        } else if (d.type === 'rubble') {
          // Scorched foundation & shattered concrete chunks
          ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
          ctx.beginPath();
          ctx.ellipse(0, 0, r, r * 0.82, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#334155';
          ctx.fillRect(-r * 0.55, -r * 0.4, r * 0.45, r * 0.35);
          ctx.fillRect(r * 0.1, -r * 0.5, r * 0.4, r * 0.38);
          ctx.fillRect(-r * 0.3, r * 0.1, r * 0.5, r * 0.32);

          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(-r * 0.4, -r * 0.2);
          ctx.lineTo(r * 0.45, r * 0.35);
          ctx.moveTo(r * 0.3, -r * 0.35);
          ctx.lineTo(-r * 0.35, r * 0.3);
          ctx.stroke();
        } else if (d.type === 'nuke_crater') {
          // Massive glassed nuclear blast crater
          ctx.fillStyle = 'rgba(9, 13, 22, 0.82)';
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = 'rgba(71, 85, 105, 0.6)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = 'rgba(34, 197, 94, 0.18)';
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Standard artillery/shell scorch crater
          ctx.fillStyle = 'rgba(15, 23, 42, 0.68)';
          ctx.beginPath();
          ctx.ellipse(0, 0, r, r * 0.78, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = 'rgba(5, 7, 10, 0.75)';
          ctx.beginPath();
          ctx.ellipse(0, 0, r * 0.52, r * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
    }

    _renderCrates(ctxOrEngine, maybeEngine, map, tileSize, FOG) {
      let ctx = ctxOrEngine;
      let engine = maybeEngine;
      if (!ctx || typeof ctx.save !== 'function') {
        engine = ctxOrEngine;
        ctx = this.ctx;
      }
      if (!ctx || !engine || !Array.isArray(engine.crates) || engine.crates.length === 0) return;

      map = map || engine.map || this.lastMap;
      tileSize = (map && map.tileSize) || window.RA.TILE_SIZE || 40;
      FOG = FOG || window.RA.FOG || { UNEXPLORED: 0, EXPLORED: 1, VISIBLE: 2 };
      const fogEnabled = map && map.fogEnabled !== false && Array.isArray(map.fog);
      const z = this.camera.zoom || 1.0;
      const viewW = this.camera.width / z;
      const viewH = this.camera.height / z;

      for (let i = 0; i < engine.crates.length; i++) {
        const c = engine.crates[i];
        if (!c || c.dead || c.collected) continue;

        const cx = typeof c.x === 'number' ? c.x : (c.tx + 0.5) * tileSize;
        const cy = typeof c.y === 'number' ? c.y : (c.ty + 0.5) * tileSize;

        if (
          cx < this.camera.x - 40 ||
          cx > this.camera.x + viewW + 40 ||
          cy < this.camera.y - 40 ||
          cy > this.camera.y + viewH + 40
        ) {
          continue;
        }

        if (fogEnabled && map) {
          const tx = typeof c.tx === 'number' ? c.tx : Math.floor(cx / tileSize);
          const ty = typeof c.ty === 'number' ? c.ty : Math.floor(cy / tileSize);
          const fState = map.fog[ty] ? map.fog[ty][tx] : FOG.UNEXPLORED;
          if (fState === FOG.UNEXPLORED) continue;
        }

        const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 5 + (c.id || i));

        ctx.save();
        ctx.translate(cx, cy);

        // Pulsing beacon highlight ring
        ctx.strokeStyle = `rgba(250, 204, 21, ${0.35 + pulse * 0.45})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 12 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();

        // Drop shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(-7, -6, 17, 17);

        // Wooden/steel reinforced military supply crate
        ctx.fillStyle = '#92400e';
        ctx.fillRect(-8, -8, 16, 16);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.strokeRect(-8, -8, 16, 16);

        // Diagonal wooden cross-braces
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-7, -7);
        ctx.lineTo(7, 7);
        ctx.moveTo(7, -7);
        ctx.lineTo(-7, 7);
        ctx.stroke();

        // Glowing tactical beacon core
        ctx.fillStyle = c.type === 'heal' ? '#4ade80' : c.type === 'nukeTrap' ? '#ef4444' : '#facc15';
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();

        // Descending parachute canopy right after air-drop spawn
        if (typeof c.spawnTime === 'number' && typeof engine.elapsedTime === 'number') {
          const dropAge = engine.elapsedTime - c.spawnTime;
          if (dropAge >= 0 && dropAge < 1.8) {
            const lift = (1 - dropAge / 1.8) * 22;
            ctx.strokeStyle = 'rgba(226, 232, 240, 0.75)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-6, -6);
            ctx.lineTo(-10, -14 - lift);
            ctx.moveTo(6, -6);
            ctx.lineTo(10, -14 - lift);
            ctx.stroke();

            ctx.fillStyle = 'rgba(241, 245, 249, 0.88)';
            ctx.beginPath();
            ctx.arc(0, -14 - lift, 11, Math.PI, 0);
            ctx.closePath();
            ctx.fill();
          }
        }

        ctx.restore();
      }
    }

    _renderMovePulses(ctx, dt) {
      for (let i = this.movePulses.length - 1; i >= 0; i--) {
        const p = this.movePulses[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.movePulses.splice(i, 1);
          continue;
        }
        const t = 1 - p.life / p.maxLife;
        const r = 4 + t * 20;
        ctx.save();
        ctx.strokeStyle = p.color || '#22c55e';
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // =========================================================================
    // 2. BUILDINGS RENDERING (INCLUDING WALLS, NAVAL YARDS, AIRFIELDS & [PRI])
    // =========================================================================

    _getFactionColors(entity, engine) {
      const teamObj = engine && engine.teams && engine.teams[entity.team];
      const factionId =
        entity.faction ||
        (teamObj && teamObj.faction) ||
        (entity.team === 'player' ? 'allied' : 'soviet');

      // Multi-AI distinct team colors for enemy2 (Gold) & enemy3 (Purple)
      if (entity.team === 'enemy2') {
        return {
          main: (teamObj && teamObj.color) || '#eab308',
          dark: '#a16207',
          accent: '#fde047',
          factionId
        };
      }
      if (entity.team === 'enemy3') {
        return {
          main: (teamObj && teamObj.color) || '#a855f7',
          dark: '#7e22ce',
          accent: '#d8b4fe',
          factionId
        };
      }
      if (teamObj && teamObj.color && entity.team !== 'player' && entity.team !== 'enemy') {
        return {
          main: teamObj.color,
          dark: teamObj.darkColor || '#1e293b',
          accent: teamObj.accent || '#e2e8f0',
          factionId
        };
      }

      const fData = window.RA.DATA && window.RA.DATA.FACTIONS && window.RA.DATA.FACTIONS[factionId];
      if (fData) {
        return {
          main: fData.color || (factionId === 'allied' ? '#3b82f6' : '#ef4444'),
          dark: fData.darkColor || (factionId === 'allied' ? '#1d4ed8' : '#b91c1c'),
          accent: fData.accent || (factionId === 'allied' ? '#93c5fd' : '#fca5a5'),
          factionId
        };
      }
      return factionId === 'allied'
        ? { main: '#3b82f6', dark: '#1d4ed8', accent: '#93c5fd', factionId: 'allied' }
        : { main: '#ef4444', dark: '#b91c1c', accent: '#fca5a5', factionId: 'soviet' };
    }

    _isBuildingVisible(b, map, FOG) {
      if (b.team === 'player') return true;
      if (map.fogEnabled === false || !Array.isArray(map.fog)) return true;
      const w = b.w || (b.def && b.def.footprint ? b.def.footprint[0] : 2);
      const h = b.h || (b.def && b.def.footprint ? b.def.footprint[1] : 2);
      for (let dy = 0; dy < h; dy++) {
        const row = map.fog[b.ty + dy];
        if (!row) continue;
        for (let dx = 0; dx < w; dx++) {
          if (row[b.tx + dx] !== FOG.UNEXPLORED) return true;
        }
      }
      return false;
    }

    _renderBuildings(ctx, engine, map, tileSize, FOG) {
      if (!Array.isArray(engine.entities)) return;
      const z = this.camera.zoom || 1.0;
      const viewW = this.camera.width / z;
      const viewH = this.camera.height / z;

      for (let i = 0; i < engine.entities.length; i++) {
        const b = engine.entities[i];
        if (!b || !b.isBuilding || b.dead) continue;
        if (!this._isBuildingVisible(b, map, FOG)) continue;

        const wTiles = b.w || (b.def && b.def.footprint ? b.def.footprint[0] : 2);
        const hTiles = b.h || (b.def && b.def.footprint ? b.def.footprint[1] : 2);
        const bw = wTiles * tileSize;
        const bh = hTiles * tileSize;
        const bx = typeof b.tx === 'number' ? b.tx * tileSize : b.x - bw / 2;
        const by = typeof b.ty === 'number' ? b.ty * tileSize : b.y - bh / 2;

        // Zoom-aware camera frustum cull
        if (
          bx + bw < this.camera.x - 40 ||
          bx > this.camera.x + viewW + 40 ||
          by + bh < this.camera.y - 40 ||
          by > this.camera.y + viewH + 40
        ) {
          continue;
        }

        const colors = this._getFactionColors(b, engine);
        this._drawBuildingSprite(ctx, b, bx, by, bw, bh, colors, engine);

        // Primary producer gold [PRI] badge
        if (b.isPrimary) {
          this._drawPrimaryBadge(ctx, bx + bw - 28, by + 3);
        }

        // Selection brackets, weapon range ring & rally point line
        if (b.selected) {
          this._drawSelectionBrackets(ctx, bx + 2, by + 2, bw - 4, bh - 4);

          if (b.def && b.def.range > 0) {
            ctx.save();
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.35)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.arc(bx + bw / 2, by + bh / 2, b.def.range, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          if (
            b.rallyPoint &&
            ['barracks', 'weap', 'helipad', 'afld', 'syrd', 'spen'].includes(b.defId)
          ) {
            ctx.save();
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(bx + bw / 2, by + bh / 2);
            ctx.lineTo(b.rallyPoint.x, b.rallyPoint.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#22c55e';
            ctx.beginPath();
            ctx.arc(b.rallyPoint.x, b.rallyPoint.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillRect(b.rallyPoint.x - 1, b.rallyPoint.y - 14, 2, 14);
            ctx.beginPath();
            ctx.moveTo(b.rallyPoint.x + 1, b.rallyPoint.y - 14);
            ctx.lineTo(b.rallyPoint.x + 11, b.rallyPoint.y - 10);
            ctx.lineTo(b.rallyPoint.x + 1, b.rallyPoint.y - 6);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }

        // Building Health Bar at top
        if (b.selected || b.hp < b.maxHp) {
          this._drawHealthBar(ctx, bx + 4, by - 7, bw - 8, 5, b.hp, b.maxHp);
        }

        // Animated Golden Wrench Icon if repairing
        if (b.isRepairing) {
          this._drawRepairWrench(ctx, bx + bw / 2, by + bh / 2);
        }
      }
    }

    _drawPrimaryBadge(ctx, x, y) {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.fillRect(x, y, 25, 12);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x + 0.5, y + 0.5, 24, 11);
      ctx.font = 'bold 8px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#facc15';
      ctx.fillText('PRI', x + 12.5, y + 9);
      ctx.restore();
    }

    _drawWallSprite(ctx, b, bx, by, bw, bh, colors, engine) {
      const map = (engine && engine.map) || this.lastMap;
      const mask =
        map && typeof map.getWallBitmask === 'function'
          ? map.getWallBitmask(b.tx, b.ty, b.defId)
          : 0;
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      const halfThick = b.defId === 'fenc' ? 3 : 6;

      ctx.save();

      // Helper to draw center hub + N(1), E(2), S(4), W(8) arms
      const drawSegments = (fillColor, strokeColor, thickness) => {
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.2;

        // Center post
        ctx.fillRect(cx - thickness, cy - thickness, thickness * 2, thickness * 2);

        if (mask === 0) {
          // Standalone wall barrier segment
          ctx.fillRect(bx + 6, cy - thickness, bw - 12, thickness * 2);
          ctx.strokeRect(bx + 6, cy - thickness, bw - 12, thickness * 2);
        } else {
          if (mask & 1) ctx.fillRect(cx - thickness, by, thickness * 2, bh / 2);
          if (mask & 2) ctx.fillRect(cx, cy - thickness, bw / 2, thickness * 2);
          if (mask & 4) ctx.fillRect(cx - thickness, cy, thickness * 2, bh / 2);
          if (mask & 8) ctx.fillRect(bx, cy - thickness, bw / 2, thickness * 2);
        }
      };

      if (b.defId === 'sbag') {
        // Sandbag fortification with stacked khaki bags
        drawSegments('#a18868', '#5c4938', halfThick);
        ctx.fillStyle = '#c2a886';
        ctx.fillRect(cx - 4, cy - 4, 8, 8);
        if (mask & 1) ctx.fillRect(cx - 3, by + 3, 6, 8);
        if (mask & 2) ctx.fillRect(cx + 4, cy - 3, 8, 6);
        if (mask & 4) ctx.fillRect(cx - 3, cy + 4, 6, 8);
        if (mask & 8) ctx.fillRect(bx + 3, cy - 3, 8, 6);
      } else if (b.defId === 'fenc') {
        // Barbed-wire chainlink fence with steel posts
        drawSegments('#64748b', '#94a3b8', halfThick);
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (mask & 1) {
          ctx.moveTo(cx - 3, cy);
          ctx.lineTo(cx + 3, by + 2);
        }
        if (mask & 2) {
          ctx.moveTo(cx, cy - 3);
          ctx.lineTo(bx + bw - 2, cy + 3);
        }
        if (mask & 4) {
          ctx.moveTo(cx - 3, cy);
          ctx.lineTo(cx + 3, by + bh - 2);
        }
        if (mask & 8) {
          ctx.moveTo(cx, cy - 3);
          ctx.lineTo(bx + 2, cy + 3);
        }
        ctx.stroke();
      } else {
        // Concrete wall ('brik') with armor cap & faction trim
        drawSegments('#64748b', '#334155', halfThick + 1);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(cx - 4, cy - 4, 8, 8);
        ctx.fillStyle = colors.main;
        ctx.fillRect(cx - 2, cy - 2, 4, 4);
      }

      // Damage cracks at < 50% HP
      if (b.hp < b.maxHp * 0.5) {
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy - 4);
        ctx.lineTo(cx + 4, cy + 5);
        ctx.stroke();
      }

      ctx.restore();
    }

    _drawBuildingSprite(ctx, b, bx, by, bw, bh, colors, engine) {
      // 4-Bit Auto-Tiled Wall Buildings (sbag, fenc, brik)
      if (
        b.defId === 'sbag' ||
        b.defId === 'fenc' ||
        b.defId === 'brik' ||
        (b.def && b.def.isWall)
      ) {
        this._drawWallSprite(ctx, b, bx, by, bw, bh, colors, engine);
        return;
      }

      ctx.save();

      const isNavalStructure = b.defId === 'syrd' || b.defId === 'spen' || (b.def && b.def.waterOnly);

      if (isNavalStructure) {
        // Submerged naval pier foundation instead of land concrete slab
        ctx.fillStyle = 'rgba(7, 25, 46, 0.72)';
        ctx.fillRect(bx + 4, by + 4, bw - 8, bh - 8);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx + 5, by + 5, bw - 10, bh - 10);
      } else {
        // Drop shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(bx + 6, by + 6, bw - 2, bh - 2);

        // Concrete foundation slab
        ctx.fillStyle = '#334155';
        ctx.fillRect(bx + 2, by + 2, bw - 4, bh - 4);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx + 3, by + 3, bw - 6, bh - 6);

        // Inner concrete tarmac
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(bx + 6, by + 6, bw - 12, bh - 12);
      }

      const cx = bx + bw / 2;
      const cy = by + bh / 2;

      switch (b.defId) {
        case 'conyard': {
          ctx.fillStyle = '#475569';
          ctx.fillRect(bx + 10, by + 12, bw * 0.52, bh - 24);
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 12, by + 14, bw * 0.52 - 4, 14);
          ctx.fillStyle = '#64748b';
          ctx.fillRect(bx + 16, by + 34, bw * 0.4, bh - 54);
          ctx.fillStyle = '#eab308';
          ctx.fillRect(bx + bw - 34, by + 14, 20, 20);
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(bx + bw - 24, by + 24);
          ctx.lineTo(bx + bw - 14, by + bh - 16);
          ctx.lineTo(bx + bw - 36, by + bh - 22);
          ctx.closePath();
          ctx.stroke();
          ctx.fillStyle = colors.dark;
          ctx.fillRect(bx + 14, by + bh - 24, bw * 0.45, 8);
          break;
        }
        case 'power':
        case 'advpower': {
          const isAdv = b.defId === 'advpower';
          ctx.fillStyle = '#475569';
          ctx.fillRect(bx + 8, by + bh * 0.45, bw - 16, bh * 0.45);
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 10, by + bh * 0.48, bw - 20, 7);

          const towers = isAdv ? [bx + bw * 0.3, bx + bw * 0.7] : [bx + bw * 0.65];
          const pulse = 0.65 + 0.35 * Math.sin(this.animTime * 4);
          for (const txPos of towers) {
            const tyPos = by + bh * 0.33;
            const r = isAdv ? 14 : 16;
            ctx.fillStyle = '#64748b';
            ctx.beginPath();
            ctx.arc(txPos, tyPos, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(txPos, tyPos, r * 0.65, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = `rgba(56, 189, 248, ${pulse})`;
            ctx.beginPath();
            ctx.arc(txPos, tyPos, r * 0.42, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case 'refinery': {
          ctx.fillStyle = '#475569';
          ctx.fillRect(bx + 10, by + 10, bw - 20, bh * 0.48);
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 12, by + 14, bw - 24, 10);

          ctx.fillStyle = '#94a3b8';
          ctx.beginPath();
          ctx.arc(bx + 26, by + 36, 11, 0, Math.PI * 2);
          ctx.arc(bx + 52, by + 36, 11, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#0f172a';
          ctx.fillRect(bx + 18, by + bh * 0.58, bw - 36, bh * 0.32);
          ctx.strokeStyle = '#eab308';
          ctx.lineWidth = 2;
          ctx.strokeRect(bx + 18, by + bh * 0.58, bw - 36, bh * 0.32);
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(cx, by + bh * 0.73, 10, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#1e293b';
          ctx.fillRect(bx + bw - 26, by + 14, 10, 10);
          ctx.fillRect(bx + bw - 26, by + 28, 10, 10);
          break;
        }
        case 'barracks': {
          ctx.fillStyle = '#a18868';
          ctx.fillRect(bx + 10, by + bh - 16, bw - 20, 7);
          ctx.fillStyle = '#475569';
          ctx.fillRect(bx + 10, by + 10, bw - 20, bh - 30);
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 12, by + 14, bw - 24, 12);
          ctx.fillStyle = '#334155';
          for (let rx = bx + 18; rx < bx + bw - 18; rx += 12) {
            ctx.fillRect(rx, by + 28, 4, bh - 50);
          }
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(bx + bw - 18, by + 8, 2, 22);
          ctx.fillStyle = colors.main;
          const wave = Math.sin(this.animTime * 5) * 2;
          ctx.beginPath();
          ctx.moveTo(bx + bw - 16, by + 8);
          ctx.lineTo(bx + bw - 4, by + 12 + wave);
          ctx.lineTo(bx + bw - 16, by + 17);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'weap': {
          ctx.fillStyle = '#475569';
          ctx.fillRect(bx + 10, by + 10, bw - 20, bh * 0.65);
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 10, by + 10, bw - 20, 12);
          ctx.fillStyle = '#38bdf8';
          for (let sx = bx + 20; sx < bx + bw - 24; sx += 24) {
            ctx.fillRect(sx, by + 30, 14, 18);
          }
          ctx.fillStyle = '#eab308';
          ctx.fillRect(bx + 24, by + bh * 0.68, bw - 48, 8);
          ctx.fillStyle = '#334155';
          ctx.fillRect(bx + 32, by + bh * 0.76, 8, bh * 0.18);
          ctx.fillRect(bx + bw - 40, by + bh * 0.76, 8, bh * 0.18);
          break;
        }
        case 'radar': {
          ctx.fillStyle = '#475569';
          ctx.fillRect(bx + 10, by + 10, bw - 20, bh - 20);
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 12, by + 12, bw - 24, 8);
          const dishAngle = this.animTime * 1.8;
          ctx.save();
          ctx.translate(cx, cy + 4);
          ctx.rotate(dishAngle);
          ctx.fillStyle = '#cbd5e1';
          ctx.beginPath();
          ctx.ellipse(0, 0, 22, 13, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = colors.main;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(0, -4, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'fix': {
          ctx.strokeStyle = '#eab308';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, Math.min(bw, bh) * 0.36, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#334155';
          ctx.beginPath();
          ctx.arc(cx, cy, Math.min(bw, bh) * 0.28, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 8, by + 8, bw - 16, 10);
          break;
        }
        case 'helipad': {
          // Circular VTOL landing pad with hazard ring, 'H' marking & blinking lights
          const padR = Math.min(bw, bh) * 0.36;
          ctx.fillStyle = '#334155';
          ctx.beginPath();
          ctx.arc(cx, cy, padR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#eab308';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.arc(cx, cy, padR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);

          // Bold 'H' helipad emblem
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(cx - 9, cy - 10, 4, 20);
          ctx.fillRect(cx + 5, cy - 10, 4, 20);
          ctx.fillRect(cx - 9, cy - 2, 18, 4);

          // Faction fuel/ammo bunker strip at top
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 10, by + 8, bw - 20, 7);

          // Corner blinking landing lights
          const blink = Math.sin(this.animTime * 6) > 0 ? '#4ade80' : '#facc15';
          ctx.fillStyle = blink;
          ctx.fillRect(bx + 10, by + bh - 14, 4, 4);
          ctx.fillRect(bx + bw - 14, by + bh - 14, 4, 4);
          break;
        }
        case 'afld': {
          // Soviet Airfield: asphalt runway strip + hangar + animated windsock
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(bx + 8, by + bh * 0.46, bw - 16, bh * 0.42);
          ctx.strokeStyle = '#f8fafc';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(bx + 14, by + bh * 0.67);
          ctx.lineTo(bx + bw - 14, by + bh * 0.67);
          ctx.stroke();
          ctx.setLineDash([]);

          // Maintenance hangar at top-left
          ctx.fillStyle = '#475569';
          ctx.fillRect(bx + 10, by + 8, bw * 0.56, bh * 0.34);
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 12, by + 10, bw * 0.56 - 4, 8);

          // Animated windsock at top-right
          const sockX = bx + bw - 22;
          const sockY = by + 16;
          const sway = Math.sin(this.animTime * 5) * 3;
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sockX, sockY + 12);
          ctx.lineTo(sockX, sockY);
          ctx.stroke();
          ctx.fillStyle = '#f97316';
          ctx.beginPath();
          ctx.moveTo(sockX, sockY);
          ctx.lineTo(sockX + 12, sockY + 3 + sway);
          ctx.lineTo(sockX, sockY + 6);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'syrd': {
          // Allied Naval Yard: U-shaped drydock pier + gantry crane
          ctx.fillStyle = '#475569';
          ctx.fillRect(bx + 6, by + 6, bw - 12, 22);
          ctx.fillRect(bx + 6, by + 26, 18, bh - 34);
          ctx.fillRect(bx + bw - 24, by + 26, 18, bh - 34);

          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 10, by + 10, bw - 20, 10);

          // Yellow drydock crane boom
          ctx.strokeStyle = '#eab308';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(bx + bw - 15, by + 34);
          ctx.lineTo(cx, cy + 8);
          ctx.stroke();
          ctx.fillStyle = '#facc15';
          ctx.fillRect(bx + bw - 20, by + 30, 10, 10);
          break;
        }
        case 'spen': {
          // Soviet Sub Pen: heavy reinforced concrete submarine bunker dome + water berth
          ctx.fillStyle = '#334155';
          ctx.fillRect(bx + 8, by + 8, bw - 16, bh * 0.54);
          ctx.fillStyle = '#475569';
          ctx.fillRect(bx + 8, by + bh * 0.54, 18, bh * 0.38);
          ctx.fillRect(bx + bw - 26, by + bh * 0.54, 18, bh * 0.38);

          // Sub bunker roof ribs & Soviet faction stripe
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 12, by + 12, bw - 24, 10);
          ctx.fillStyle = '#1e293b';
          for (let rx = bx + 20; rx < bx + bw - 20; rx += 18) {
            ctx.fillRect(rx, by + 26, 6, bh * 0.32);
          }

          // Hazard stripes along sub slipway entrance
          ctx.strokeStyle = '#eab308';
          ctx.lineWidth = 2;
          ctx.strokeRect(bx + 26, by + bh * 0.54, bw - 52, bh * 0.38);
          break;
        }
        case 'sam': {
          // Soviet SAM Site: bunker base + rotatable twin missile launcher
          ctx.fillStyle = '#475569';
          ctx.fillRect(bx + 8, by + 6, bw - 16, bh - 12);
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 10, by + 8, 14, bh - 16);

          const ang =
            b.turretAngle ??
            (b.target ? Math.atan2(b.target.y - b.y, b.target.x - b.x) : -Math.PI / 4);
          ctx.save();
          ctx.translate(cx + 6, cy);
          ctx.rotate(ang);
          // Launcher pedestal
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(-8, -8, 16, 16);
          // Twin white/red SAM missiles on rails
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(-6, -6, 16, 4);
          ctx.fillRect(-6, 2, 16, 4);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(8, -6, 4, 4);
          ctx.fillRect(8, 2, 4, 4);
          ctx.restore();
          break;
        }
        case 'agun': {
          // Allied AA Flak Gun: sandbagged mount + rotatable quad-barrel flak cannon
          ctx.fillStyle = '#64748b';
          ctx.beginPath();
          ctx.arc(cx, cy, bw * 0.36, 0, Math.PI * 2);
          ctx.fill();

          const ang =
            b.turretAngle ??
            (b.target ? Math.atan2(b.target.y - b.y, b.target.x - b.x) : -Math.PI / 3);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(ang);
          // Quad flak barrels
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(2, -6, bw * 0.42, 2.2);
          ctx.fillRect(4, -2.5, bw * 0.42, 2.2);
          ctx.fillRect(4, 0.5, bw * 0.42, 2.2);
          ctx.fillRect(2, 4, bw * 0.42, 2.2);
          // Armored gun shield
          ctx.fillStyle = colors.main;
          ctx.beginPath();
          ctx.arc(0, 0, bw * 0.22, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'pillbox': {
          ctx.fillStyle = '#64748b';
          ctx.beginPath();
          ctx.arc(cx, cy, bw * 0.36, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(cx - 8, cy - 3, 16, 6);
          ctx.fillStyle = colors.main;
          ctx.beginPath();
          ctx.arc(cx, cy, 5, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'turret': {
          ctx.fillStyle = '#475569';
          ctx.beginPath();
          ctx.arc(cx, cy, bw * 0.34, 0, Math.PI * 2);
          ctx.fill();
          const ang =
            b.turretAngle ??
            (b.target ? Math.atan2(b.target.y - b.y, b.target.x - b.x) : -Math.PI / 2);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(ang);
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, -3, bw * 0.46, 6);
          ctx.fillStyle = colors.main;
          ctx.beginPath();
          ctx.arc(0, 0, bw * 0.24, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'tesla': {
          ctx.fillStyle = colors.dark;
          ctx.beginPath();
          ctx.arc(cx, cy + bh * 0.18, 13, 0, Math.PI * 2);
          ctx.fill();

          for (let r = 0; r < 3; r++) {
            const ry = cy + bh * 0.1 - r * 11;
            const rw = 12 - r * 2;
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(cx - rw, ry - 3, rw * 2, 5);
          }

          const lowPower =
            engine && engine.teams && engine.teams[b.team] && engine.teams[b.team].lowPower;
          const topY = cy - bh * 0.24;
          ctx.fillStyle = lowPower ? '#64748b' : '#38bdf8';
          ctx.beginPath();
          ctx.arc(cx, topY, 9, 0, Math.PI * 2);
          ctx.fill();

          if (!lowPower) {
            ctx.strokeStyle = '#bae6fd';
            ctx.lineWidth = 1.5;
            const sparkAngle = this.animTime * 12;
            ctx.beginPath();
            ctx.moveTo(cx, topY);
            ctx.lineTo(cx + Math.cos(sparkAngle) * 15, topY + Math.sin(sparkAngle) * 15);
            ctx.stroke();
          }
          break;
        }
        case 'silo': {
          ctx.fillStyle = '#475569';
          ctx.beginPath();
          ctx.arc(cx, cy, bw * 0.36, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#eab308';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.strokeStyle = '#0f172a';
          ctx.beginPath();
          ctx.moveTo(cx - bw * 0.34, cy);
          ctx.lineTo(cx + bw * 0.34, cy);
          ctx.moveTo(cx, cy - bh * 0.34);
          ctx.lineTo(cx, cy + bh * 0.34);
          ctx.stroke();
          ctx.fillStyle = colors.main;
          ctx.beginPath();
          ctx.arc(cx, cy, 7, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        default: {
          ctx.fillStyle = colors.main;
          ctx.fillRect(bx + 12, by + 12, bw - 24, bh - 24);
          break;
        }
      }

      // Construction scaffolding animation if newly placed
      if (b.constructionAnim && b.constructionAnim > 0) {
        ctx.fillStyle = 'rgba(234, 179, 8, 0.28)';
        const h = bh * b.constructionAnim;
        ctx.fillRect(bx + 4, by + bh - h, bw - 8, h);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx + 4, by + bh - h, bw - 8, h);
      }

      // Damage fire flicker when below 50% HP
      if (b.hp < b.maxHp * 0.5) {
        const flicker = 4 + Math.sin(this.animTime * 14 + b.id) * 2;
        ctx.fillStyle = 'rgba(249, 115, 22, 0.85)';
        ctx.beginPath();
        ctx.arc(cx - 8, cy + 4, flicker, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(250, 204, 21, 0.9)';
        ctx.beginPath();
        ctx.arc(cx - 8, cy + 4, flicker * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    _drawRepairWrench(ctx, cx, cy) {
      const bob = Math.sin(this.animTime * 6) * 3;
      ctx.save();
      ctx.translate(cx, cy - 10 + bob);
      ctx.rotate(Math.sin(this.animTime * 5) * 0.35);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-5, 5);
      ctx.lineTo(4, -4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(5, -5, 3.5, 0.5, Math.PI * 1.8);
      ctx.stroke();
      ctx.restore();
    }

    // =========================================================================
    // 3. UNITS RENDERING (AIR, NAVAL, INFANTRY, VEHICLES & SPECIALISTS)
    // =========================================================================

    _renderUnits(ctx, engine, map, tileSize, FOG) {
      if (!Array.isArray(engine.entities)) return;
      const fogEnabled = map.fogEnabled !== false && Array.isArray(map.fog);
      const z = this.camera.zoom || 1.0;
      const viewW = this.camera.width / z;
      const viewH = this.camera.height / z;

      for (let i = 0; i < engine.entities.length; i++) {
        const u = engine.entities[i];
        if (!u || u.isBuilding || u.dead) continue;

        // Enemy units on non-VISIBLE tiles must NOT be drawn
        if (u.team !== 'player' && fogEnabled) {
          const tx = Math.max(0, Math.min(map.width - 1, Math.floor(u.x / tileSize)));
          const ty = Math.max(0, Math.min(map.height - 1, Math.floor(u.y / tileSize)));
          if (!map.fog[ty] || map.fog[ty][tx] !== FOG.VISIBLE) {
            continue;
          }
        }

        // Zoom-aware frustum check
        if (
          u.x < this.camera.x - 60 ||
          u.x > this.camera.x + viewW + 60 ||
          u.y < this.camera.y - 60 ||
          u.y > this.camera.y + viewH + 60
        ) {
          continue;
        }

        const colors = this._getFactionColors(u, engine);
        const r = u.radius || (u.category === 'infantry' ? 10 : 16);
        const isAir =
          u.locomotion === 'air' ||
          u.category === 'aircraft' ||
          ['heli', 'hind', 'yak', 'mig'].includes(u.defId);
        const isNaval =
          u.locomotion === 'naval' ||
          u.category === 'naval' ||
          ['gnbt', 'dd', 'ca', 'ss'].includes(u.defId);

        const alt = isAir ? u.altitude || 0 : 0;
        const drawY = u.y - alt;

        if (isAir) {
          // Ground shadow offset at (u.x + 10, u.y + 12)
          ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
          ctx.beginPath();
          ctx.ellipse(u.x + 10, u.y + 12, r * 0.95, r * 0.55, u.angle || 0, 0, Math.PI * 2);
          ctx.fill();

          this._drawAircraftSprite(ctx, u, u.x, drawY, colors);
        } else if (isNaval) {
          this._drawNavalSprite(ctx, u, colors);
        } else {
          // Standard ground drop shadow
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.beginPath();
          ctx.ellipse(u.x + 2, u.y + 4, r * 0.95, r * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();

          if (
            u.category === 'infantry' ||
            ['rifle', 'rocket', 'engineer', 'tanya', 'dog', 'spy', 'thf', 'shok'].includes(u.defId)
          ) {
            this._drawInfantrySprite(ctx, u, colors);
          } else {
            this._drawVehicleSprite(ctx, u, colors);
          }
        }

        // Iron Curtain pulsing crimson invulnerability shield
        if (u.ironCurtainTimer && u.ironCurtainTimer > 0) {
          const pulse = 0.55 + 0.35 * Math.sin(this.animTime * 10);
          ctx.save();
          ctx.strokeStyle = `rgba(239, 68, 68, ${pulse})`;
          ctx.fillStyle = `rgba(220, 38, 38, ${pulse * 0.3})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(u.x, drawY, r + 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }

        // Veterancy gold chevron badges
        if (u.veterancy && u.veterancy > 0) {
          this._drawVeterancyBadge(ctx, u.x + r - 2, drawY + r - 2, u.veterancy);
        }

        // Selection brackets & health/ammo/cargo bars
        if (u.selected) {
          const boxSize = r * 2 + 6;
          this._drawSelectionBrackets(ctx, u.x - boxSize / 2, drawY - boxSize / 2, boxSize, boxSize);
        }

        if (u.selected || u.hp < u.maxHp) {
          const barW = Math.max(22, r * 2);
          this._drawHealthBar(ctx, u.x - barW / 2, drawY - r - 9, barW, 4, u.hp, u.maxHp);
        }

        // Aircraft ammo pips below health bar
        if (isAir && (u.maxAmmo > 0 || (u.def && u.def.maxAmmo > 0))) {
          const maxAmmo = u.maxAmmo || (u.def && u.def.maxAmmo) || 6;
          const curAmmo = typeof u.ammo === 'number' && u.ammo >= 0 ? u.ammo : maxAmmo;
          const barW = Math.max(22, r * 2);
          const pipW = Math.max(2, Math.floor((barW - (maxAmmo - 1)) / maxAmmo));
          const startX = u.x - barW / 2;
          const pipY = drawY - r - 4;
          for (let a = 0; a < maxAmmo; a++) {
            ctx.fillStyle = a < curAmmo ? '#facc15' : 'rgba(15, 23, 42, 0.85)';
            ctx.fillRect(startX + a * (pipW + 1), pipY, pipW, 2.5);
          }
        }

        // Harvester cargo bar
        if (u.defId === 'harvester' && (u.selected || (u.cargo && u.cargo > 0))) {
          const barW = Math.max(24, r * 2);
          const ratio = Math.max(0, Math.min(1, (u.cargo || 0) / (u.maxCargo || 700)));
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(u.x - barW / 2, drawY - r - 4, barW, 3);
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(u.x - barW / 2, drawY - r - 4, barW * ratio, 3);
        }
      }
    }

    _drawAircraftSprite(ctx, u, x, y, colors) {
      const ang = u.angle || 0;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);

      if (u.defId === 'heli' || u.defId === 'hind') {
        const isHind = u.defId === 'hind';
        // Tail boom
        ctx.fillStyle = '#334155';
        ctx.fillRect(-16, -2, 12, 4);
        ctx.fillStyle = colors.main;
        ctx.fillRect(-17, -4, 3, 8);

        // Stub wings & rocket pods
        ctx.fillStyle = '#475569';
        ctx.fillRect(-3, -11, 7, 22);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(-1, -12, 6, 3);
        ctx.fillRect(-1, 9, 6, 3);

        // Fuselage & armored cockpit
        ctx.fillStyle = isHind ? colors.dark : '#475569';
        ctx.beginPath();
        ctx.ellipse(2, 0, isHind ? 12 : 10, isHind ? 6 : 4.8, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = colors.main;
        ctx.fillRect(-4, -3, 9, 6);

        // Glass canopy
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(6, 0, 3.2, 0, Math.PI * 2);
        ctx.fill();

        // Spinning rotor blades
        const rotorAng = this.animTime * 28 + (u.id || 0);
        ctx.save();
        ctx.rotate(rotorAng);
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-15, 0);
        ctx.lineTo(15, 0);
        ctx.moveTo(0, -15);
        ctx.lineTo(0, 15);
        ctx.stroke();
        ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        // Fixed-wing attack planes: 'yak' & 'mig'
        const isMig = u.defId === 'mig';

        // Afterburner flame when airborne/moving
        if ((u.altitude || 0) > 2 || u.state === 'move' || u.state === 'attack') {
          const flameLen = (isMig ? 10 : 6) + Math.sin(this.animTime * 40) * 3;
          ctx.fillStyle = '#f97316';
          ctx.beginPath();
          ctx.moveTo(-12, -3);
          ctx.lineTo(-12 - flameLen, 0);
          ctx.lineTo(-12, 3);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#fef08a';
          ctx.beginPath();
          ctx.moveTo(-12, -1.5);
          ctx.lineTo(-12 - flameLen * 0.55, 0);
          ctx.lineTo(-12, 1.5);
          ctx.closePath();
          ctx.fill();
        }

        // Swept delta wings (MiG) or straight attack wings (Yak)
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        if (isMig) {
          ctx.moveTo(6, 0);
          ctx.lineTo(-8, -14);
          ctx.lineTo(-11, -14);
          ctx.lineTo(-6, 0);
          ctx.lineTo(-11, 14);
          ctx.lineTo(-8, 14);
        } else {
          ctx.moveTo(4, -13);
          ctx.lineTo(-3, -13);
          ctx.lineTo(-3, 13);
          ctx.lineTo(4, 13);
        }
        ctx.closePath();
        ctx.fill();

        // Faction wing markings
        ctx.fillStyle = colors.main;
        ctx.fillRect(-5, -10, 4, 4);
        ctx.fillRect(-5, 6, 4, 4);

        // Jet/plane fuselage
        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(-12, -4);
        ctx.lineTo(-12, 4);
        ctx.closePath();
        ctx.fill();

        // Cockpit canopy
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.ellipse(4, 0, 4, 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    _drawNavalSprite(ctx, u, colors) {
      const ang = u.angle || 0;
      const turretAngle = u.turretAngle ?? ang;
      const isMoving =
        u.state === 'move' || u.state === 'attackMove' || u.state === 'patrol' || (u.path && u.path.length > 0);

      ctx.save();
      ctx.translate(u.x, u.y);

      // V-shaped white water foam wake behind moving vessels
      if (isMoving || !u.submerged) {
        ctx.save();
        ctx.rotate(ang);
        const wakeLen = isMoving ? 22 : 12;
        const spread = isMoving ? 10 : 6;
        const shimmer = 0.45 + 0.2 * Math.sin(this.animTime * 8 + (u.id || 0));
        ctx.strokeStyle = `rgba(224, 242, 254, ${shimmer})`;
        ctx.lineWidth = isMoving ? 2.2 : 1.4;
        ctx.beginPath();
        ctx.moveTo(-10, -2);
        ctx.lineTo(-10 - wakeLen, -spread);
        ctx.moveTo(-10, 2);
        ctx.lineTo(-10 - wakeLen, spread);
        ctx.stroke();
        ctx.restore();
      }

      if (u.defId === 'ss') {
        // Torpedo Submarine: semi-transparent silhouette + periscope ring when submerged
        ctx.save();
        ctx.rotate(ang);
        if (u.submerged) {
          ctx.globalAlpha = 0.42;
        }
        // Cigar-shaped submarine hull
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.ellipse(0, 0, 16, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = colors.main;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // Conning tower
        ctx.fillStyle = '#334155';
        ctx.fillRect(-3, -2.5, 7, 5);
        ctx.restore();

        if (u.submerged) {
          // Pulsing periscope & sonar bubble ring
          const ringPulse = (this.animTime * 2.5 + (u.id || 0)) % 1;
          ctx.strokeStyle = `rgba(186, 230, 253, ${0.85 * (1 - ringPulse)})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, 4 + ringPulse * 10, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#e2e8f0';
          ctx.beginPath();
          ctx.arc(2, 0, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        return;
      }

      // Surface warships: Gunboat ('gnbt'), Destroyer ('dd'), Cruiser ('ca')
      const hw = u.defId === 'ca' ? 20 : u.defId === 'dd' ? 16 : 12;
      const hh = u.defId === 'ca' ? 8.5 : u.defId === 'dd' ? 6.8 : 5.5;

      ctx.save();
      ctx.rotate(ang);

      // Pointed naval warship hull
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.moveTo(hw + 4, 0);
      ctx.lineTo(hw - 4, -hh);
      ctx.lineTo(-hw, -hh + 1);
      ctx.lineTo(-hw, hh - 1);
      ctx.lineTo(hw - 4, hh);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Deck & faction superstructure
      ctx.fillStyle = '#334155';
      ctx.fillRect(-hw + 4, -hh + 2, hw * 1.3, (hh - 2) * 2);
      ctx.fillStyle = colors.main;
      ctx.fillRect(-6, -hh + 3, 10, (hh - 3) * 2);

      // Bridge radar tower
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(-3, -3, 5, 6);
      ctx.restore();

      // Rotating naval gun/missile turret(s)
      ctx.save();
      ctx.rotate(turretAngle);
      ctx.fillStyle = '#0f172a';
      if (u.defId === 'ca') {
        // Heavy twin 8-inch naval battery barrels
        ctx.fillRect(4, -3.5, 16, 2.5);
        ctx.fillRect(4, 1, 16, 2.5);
      } else {
        ctx.fillRect(3, -1.8, u.defId === 'dd' ? 13 : 10, 3.6);
      }
      ctx.fillStyle = colors.dark;
      ctx.beginPath();
      ctx.arc(4, 0, u.defId === 'ca' ? 5.5 : 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.restore();
    }

    _drawInfantrySprite(ctx, u, colors) {
      const isMoving = u.state === 'move' || u.state === 'attackMove' || (u.path && u.path.length > 0);
      const bob = isMoving ? Math.sin(this.animTime * 14 + u.id) * 1.5 : 0;
      const ang = u.angle || 0;

      // Specialist: Attack Dog ('dog')
      if (u.defId === 'dog') {
        ctx.save();
        ctx.translate(u.x, u.y + bob * 0.8);
        ctx.rotate(ang);
        // German Shepherd body & dark saddle
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.ellipse(0, 0, 6.5, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1c1917';
        ctx.beginPath();
        ctx.ellipse(-1, 0, 4, 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
        // Head, snout & pointed ears
        ctx.fillStyle = '#d97706';
        ctx.beginPath();
        ctx.arc(6, 0, 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1c1917';
        ctx.fillRect(7, -1, 3, 2);
        ctx.fillRect(4, -3.5, 2, 2);
        ctx.fillRect(4, 1.5, 2, 2);
        ctx.restore();
        return;
      }

      // Specialist: Allied Spy ('spy'), Thief ('thf'), Shock Trooper ('shok')
      if (u.defId === 'spy' || u.defId === 'thf' || u.defId === 'shok') {
        const ox = u.x;
        const oy = u.y + bob;
        ctx.save();

        if (u.defId === 'shok') {
          // Backpack Tesla coil & glowing capacitor
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(ox - Math.cos(ang) * 4, oy - Math.sin(ang) * 4, 4.2, 0, Math.PI * 2);
          ctx.fill();
        } else if (u.defId === 'thf') {
          // Gold bullion satchel on back
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(ox - Math.cos(ang) * 3.5, oy - Math.sin(ang) * 3.5, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Torso (Spy wears tuxedo black; Thief wears stealth slate; Shock wears Soviet crimson)
        ctx.fillStyle = u.defId === 'spy' ? '#0f172a' : u.defId === 'thf' ? '#334155' : colors.main;
        ctx.beginPath();
        ctx.arc(ox, oy, 4.2, 0, Math.PI * 2);
        ctx.fill();

        if (u.defId === 'spy') {
          // Crisp white tuxedo shirt V & faction pin
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(ox - 1, oy - 1, 2.5, 3);
          ctx.fillStyle = colors.main;
          ctx.fillRect(ox + 1, oy - 1, 1.5, 1.5);
        }

        // Head / Helmet
        ctx.fillStyle = u.defId === 'shok' ? '#38bdf8' : '#e2e8f0';
        ctx.beginPath();
        ctx.arc(ox, oy - 1, 2.4, 0, Math.PI * 2);
        ctx.fill();

        // Weapon / Gadget
        ctx.strokeStyle = u.defId === 'shok' ? '#38bdf8' : '#94a3b8';
        ctx.lineWidth = u.defId === 'shok' ? 2.2 : 1.5;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + Math.cos(ang) * 7, oy + Math.sin(ang) * 7);
        ctx.stroke();

        ctx.restore();
        return;
      }

      // Single hero/specialist vs 3-soldier squad
      const offsets =
        u.defId === 'tanya' || u.defId === 'engineer'
          ? [{ dx: 0, dy: 0 }]
          : [
              { dx: 0, dy: -4 },
              { dx: -4.5, dy: 3.5 },
              { dx: 4.5, dy: 3.5 }
            ];

      for (let i = 0; i < offsets.length; i++) {
        const ox = u.x + offsets[i].dx;
        const oy = u.y + offsets[i].dy + (i % 2 === 0 ? bob : -bob);

        ctx.fillStyle = colors.main;
        ctx.beginPath();
        ctx.arc(ox, oy, 3.6, 0, Math.PI * 2);
        ctx.fill();

        if (u.defId === 'engineer') {
          ctx.fillStyle = '#facc15';
        } else if (u.defId === 'tanya') {
          ctx.fillStyle = '#fef08a';
        } else {
          ctx.fillStyle = '#e2e8f0';
        }
        ctx.beginPath();
        ctx.arc(ox, oy - 1, 2.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = u.defId === 'rocket' ? '#94a3b8' : '#1e293b';
        ctx.lineWidth = u.defId === 'rocket' ? 2.2 : 1.4;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + Math.cos(ang) * 6, oy + Math.sin(ang) * 6);
        ctx.stroke();
      }
    }

    _drawVehicleSprite(ctx, u, colors) {
      const hullAngle = u.angle || 0;
      const turretAngle = u.turretAngle ?? hullAngle;

      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(hullAngle);

      const isHeavy =
        u.defId === 'mammoth' ||
        u.defId === 'harvester' ||
        u.defId === 'mcv' ||
        u.defId === 'htnk' ||
        u.defId === 'qtnk';
      const hw = isHeavy ? 15 : 12;
      const hh = isHeavy ? 11 : 8.5;

      // Treads / Wheels
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-hw, -hh - 2, hw * 2, 4);
      ctx.fillRect(-hw, hh - 2, hw * 2, 4);

      // Main armored hull
      ctx.fillStyle = '#475569';
      ctx.fillRect(-hw + 1, -hh, hw * 2 - 2, hh * 2);

      // Faction armor panels
      ctx.fillStyle = colors.main;
      ctx.fillRect(-hw + 3, -hh + 2, hw * 1.4, hh * 2 - 4);

      if (u.defId === 'harvester') {
        const clawJiggle = u.state === 'harvest' ? Math.sin(this.animTime * 18) * 2 : 0;
        ctx.fillStyle = '#eab308';
        ctx.fillRect(hw - 1, -hh + 1 + clawJiggle, 5, 4);
        ctx.fillRect(hw - 1, hh - 5 - clawJiggle, 5, 4);
        const fill = Math.max(0, Math.min(1, (u.cargo || 0) / (u.maxCargo || 700)));
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-hw + 2, -hh + 3, 12, hh * 2 - 6);
        if (fill > 0) {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(-hw + 3, -hh + 4, 10 * fill, hh * 2 - 8);
        }
      } else if (u.defId === 'mcv') {
        ctx.fillStyle = '#eab308';
        ctx.fillRect(-hw + 2, -hh + 2, 6, hh * 2 - 4);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(-4, -3, 14, 6);
      } else if (u.defId === 'v2rl') {
        const ready = (u.attackCooldown || 0) <= ((u.def && u.def.fireRate) || 5) * 0.5;
        if (ready) {
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(-10, -2.5, 20, 5);
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.moveTo(10, -3);
          ctx.lineTo(16, 0);
          ctx.lineTo(10, 3);
          ctx.closePath();
          ctx.fill();
        }
      } else if (u.defId === 'ctnk') {
        // Chrono Tank glowing blue temporal core coils
        const pulse = 0.6 + 0.4 * Math.sin(this.animTime * 8);
        ctx.fillStyle = `rgba(56, 189, 248, ${pulse})`;
        ctx.fillRect(-hw + 2, -hh + 2, 7, hh * 2 - 4);
        ctx.strokeStyle = '#bae6fd';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(-hw + 2, -hh + 2, hw * 2 - 4, hh * 2 - 4);
      } else if (u.defId === 'qtnk') {
        // M.A.D. Seismic Tank with central hydraulic thumper piston
        const charging = (u.madChargeTimer && u.madChargeTimer > 0) || u.state === 'madCharge';
        const pistonR = charging ? 7 + Math.sin(this.animTime * 28) * 2.5 : 7;
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = charging ? '#ef4444' : '#eab308';
        ctx.beginPath();
        ctx.arc(0, 0, pistonR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // M.A.D. Tank expanding seismic shockwave rings during charge
      if (u.defId === 'qtnk' && ((u.madChargeTimer && u.madChargeTimer > 0) || u.state === 'madCharge')) {
        const waveR = ((this.animTime * 90) % 48) + 12;
        ctx.save();
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(u.x, u.y, waveR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Rotating Turret & Cannon Barrels for combat vehicles
      if (['ranger', 'ltnk', 'mtnk', 'htnk', 'mammoth', 'arty', 'ctnk'].includes(u.defId)) {
        ctx.save();
        ctx.translate(u.x, u.y);
        ctx.rotate(turretAngle);

        if (u.defId === 'htnk' || u.defId === 'mammoth') {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(2, -4.5, u.defId === 'mammoth' ? 18 : 15, 2.8);
          ctx.fillRect(2, 1.7, u.defId === 'mammoth' ? 18 : 15, 2.8);
        } else if (u.defId === 'ctnk') {
          // Dual Chrono missile pods
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(-2, -6.5, 13, 3.2);
          ctx.fillRect(-2, 3.3, 13, 3.2);
        } else if (u.defId === 'arty') {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, -2.2, 19, 4.4);
        } else {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(2, -1.8, u.defId === 'ranger' ? 10 : 14, 3.6);
        }

        ctx.fillStyle = u.defId === 'ctnk' ? '#0284c7' : colors.dark;
        ctx.beginPath();
        ctx.arc(0, 0, u.defId === 'mammoth' ? 8 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = u.defId === 'ctnk' ? '#bae6fd' : '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
      }
    }

    _drawVeterancyBadge(ctx, x, y, vet) {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.4;
      const ranks = Math.min(3, vet);
      for (let r = 0; r < ranks; r++) {
        const cy = y + 2 - r * 3;
        ctx.beginPath();
        ctx.moveTo(x - 3, cy);
        ctx.lineTo(x, cy - 2.5);
        ctx.lineTo(x + 3, cy);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawSelectionBrackets(ctx, x, y, w, h) {
      const len = Math.max(4, Math.min(10, Math.min(w, h) * 0.28));
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y + len);
      ctx.lineTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.moveTo(x + w - len, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + len);
      ctx.moveTo(x + w, y + h - len);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w - len, y + h);
      ctx.moveTo(x + len, y + h);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y + h - len);
      ctx.stroke();
      ctx.restore();
    }

    _drawHealthBar(ctx, x, y, w, h, hp, maxHp) {
      const ratio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
      ctx.fillStyle = 'rgba(5, 7, 10, 0.85)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#eab308' : '#ef4444';
      ctx.fillRect(x, y, w * ratio, h);
    }

    // =========================================================================
    // 4. PROJECTILES, PARTICLES & FLOATING TEXTS
    // =========================================================================

    _renderProjectiles(ctx, engine, map, tileSize, FOG) {
      if (!Array.isArray(engine.projectiles)) return;

      for (let i = 0; i < engine.projectiles.length; i++) {
        const p = engine.projectiles[i];
        if (!p || p.dead) continue;

        const type = p.type || p.projectileType || 'shell';
        ctx.save();

        if (type === 'tesla') {
          const sx = p.startX ?? p.sourceX ?? p.x;
          const sy = p.startY ?? p.sourceY ?? p.y;
          const tx = p.targetX ?? p.tx ?? p.x;
          const ty = p.targetY ?? p.ty ?? p.y;
          this._drawTeslaArc(ctx, sx, sy, tx, ty);
        } else if (type === 'flak') {
          // Black/charcoal anti-aircraft airburst puff + shrapnel flash
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.arc(p.x + 4, p.y - 3, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fb923c';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (type === 'torpedo') {
          // Submerged torpedo with white underwater cavitation bubble trail
          const ang =
            p.angle ?? Math.atan2((p.ty ?? p.targetY ?? p.y) - p.y, (p.tx ?? p.targetX ?? p.x) - p.x);
          ctx.translate(p.x, p.y);
          ctx.rotate(ang);
          ctx.fillStyle = 'rgba(224, 242, 254, 0.72)';
          for (let b = 1; b <= 3; b++) {
            ctx.beginPath();
            ctx.arc(-b * 5, Math.sin(this.animTime * 20 + b) * 1.5, 2.2 - b * 0.4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#94a3b8';
          ctx.fillRect(-4, -1.6, 8, 3.2);
        } else if (type === 'rocket' || type === 'sam_missile' || type === 'nuke') {
          const ang =
            p.angle ?? Math.atan2((p.ty ?? p.targetY ?? p.y) - p.y, (p.tx ?? p.targetX ?? p.x) - p.x);
          ctx.translate(p.x, p.y);
          ctx.rotate(ang);
          const sz = type === 'nuke' ? 2.2 : type === 'sam_missile' ? 1.2 : 1;
          // Smoke contrail for SAM missile
          if (type === 'sam_missile') {
            ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(-6, 0);
            ctx.lineTo(-18, 0);
            ctx.stroke();
          }
          // Exhaust flame plume
          ctx.fillStyle = '#f97316';
          ctx.beginPath();
          ctx.arc(-7 * sz, 0, 4 * sz, 0, Math.PI * 2);
          ctx.fill();
          // Rocket body
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(-5 * sz, -2 * sz, 10 * sz, 4 * sz);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(3 * sz, -2 * sz, 4 * sz, 4 * sz);
        } else if (type === 'bullet') {
          const ang = p.angle || 0;
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - Math.cos(ang) * 7, p.y - Math.sin(ang) * 7);
          ctx.stroke();
        } else {
          // Glowing tank shell
          ctx.fillStyle = '#fb923c';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fef08a';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
    }

    _drawTeslaArc(ctx, x1, y1, x2, y2) {
      const segments = 7;
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      const pts = [];
      for (let s = 1; s < segments; s++) {
        const t = s / segments;
        const jx = (Math.sin(this.animTime * 45 + s * 9) - 0.5) * 16;
        const jy = (Math.cos(this.animTime * 43 + s * 7) - 0.5) * 16;
        const px = x1 + (x2 - x1) * t + jx;
        const py = y1 + (y2 - y1) * t + jy;
        pts.push({ px, py });
        ctx.lineTo(px, py);
      }
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      for (const pt of pts) ctx.lineTo(pt.px, pt.py);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }

    _renderParticles(ctx, engine) {
      if (!Array.isArray(engine.particles)) return;

      for (let i = 0; i < engine.particles.length; i++) {
        const pt = engine.particles[i];
        if (!pt || pt.dead) continue;

        const maxLife = pt.maxLife || 0.5;
        const lifeRatio = typeof pt.life === 'number' ? Math.max(0, Math.min(1, pt.life / maxLife)) : 1;
        const alpha = pt.alpha !== undefined ? pt.alpha : lifeRatio;

        ctx.save();
        ctx.globalAlpha = alpha;

        if (pt.type === 'ring' || pt.ring || pt.isRing) {
          const r = pt.radius || pt.size || (1 - lifeRatio) * (pt.maxRadius || 45) + 4;
          ctx.strokeStyle = pt.color || '#fb923c';
          ctx.lineWidth = pt.lineWidth || 2.5;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, Math.max(1, r), 0, Math.PI * 2);
          ctx.stroke();
        } else if (pt.type === 'lightning' && pt.tx !== undefined) {
          this._drawTeslaArc(ctx, pt.x, pt.y, pt.tx, pt.ty);
        } else {
          const r = Math.max(1, pt.radius || pt.size || 4);
          ctx.fillStyle = pt.color || '#f97316';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
    }

    _renderFloatingTexts(ctx, engine) {
      if (!Array.isArray(engine.floatingTexts)) return;

      ctx.save();
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.textAlign = 'center';

      for (let i = 0; i < engine.floatingTexts.length; i++) {
        const ft = engine.floatingTexts[i];
        if (!ft || ft.dead) continue;
        const maxLife = ft.maxLife || 1.2;
        const alpha = typeof ft.life === 'number' ? Math.max(0, Math.min(1, ft.life / maxLife)) : 1;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#05070a';
        ctx.lineWidth = 3;
        ctx.strokeText(ft.text || '', ft.x, ft.y);
        ctx.fillStyle = ft.color || '#facc15';
        ctx.fillText(ft.text || '', ft.x, ft.y);
      }

      ctx.restore();
    }

    // =========================================================================
    // 5. FOG OF WAR PASS
    // =========================================================================

    _renderFogOfWar(ctx, map, startTx, endTx, startTy, endTy, tileSize, FOG) {
      if (map.fogEnabled === false || !Array.isArray(map.fog)) return;

      for (let ty = startTy; ty <= endTy; ty++) {
        const row = map.fog[ty];
        if (!row) continue;
        const py = ty * tileSize;

        for (let tx = startTx; tx <= endTx; tx++) {
          const state = row[tx];
          if (state === FOG.VISIBLE) continue;

          const px = tx * tileSize;
          if (state === FOG.UNEXPLORED) {
            ctx.fillStyle = '#05070a';
            ctx.fillRect(px, py, tileSize, tileSize);
          } else if (state === FOG.EXPLORED) {
            ctx.fillStyle = 'rgba(5, 10, 18, 0.58)';
            ctx.fillRect(px, py, tileSize, tileSize);
          }
        }
      }
    }

    // =========================================================================
    // 6. OVERLAYS (FOOTPRINT, SUPERWEAPON, WAYPOINTS, PATROL, SELECTION BOX)
    // =========================================================================

    _renderWorldOverlays(ctx, engine, map, tileSize) {
      // A. Queued Waypoint Paths & Patrol Routes for Selected Units
      if (engine && Array.isArray(engine.entities)) {
        for (let i = 0; i < engine.entities.length; i++) {
          const u = engine.entities[i];
          if (!u || u.dead || u.isBuilding || !u.selected) continue;

          // Green dashed patrol route when u.state === 'patrol'
          if (u.state === 'patrol' && (u.patrolA || u.patrolB)) {
            const pA = u.patrolA || { x: u.x, y: u.y };
            const pB = u.patrolB || { x: u.x, y: u.y };
            ctx.save();
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(pA.x, pA.y);
            ctx.lineTo(pB.x, pB.y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#22c55e';
            ctx.beginPath();
            ctx.arc(pA.x, pA.y, 4, 0, Math.PI * 2);
            ctx.arc(pB.x, pB.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          // Cyan dashed queued waypoints & numbered badges (1, 2, 3...)
          if (Array.isArray(u.commandQueue) && u.commandQueue.length > 0) {
            ctx.save();
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.6;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(u.x, u.y);

            if (Array.isArray(u.path) && u.path.length > 0) {
              const curGoal = u.path[u.path.length - 1];
              if (curGoal && typeof curGoal.x === 'number') {
                ctx.lineTo(curGoal.x, curGoal.y);
              }
            }

            const pts = [];
            for (let q = 0; q < u.commandQueue.length; q++) {
              const cmd = u.commandQueue[q];
              if (!cmd) continue;
              const wx =
                cmd.targetEntity && !cmd.targetEntity.dead
                  ? cmd.targetEntity.x
                  : cmd.worldX ?? cmd.x ?? u.x;
              const wy =
                cmd.targetEntity && !cmd.targetEntity.dead
                  ? cmd.targetEntity.y
                  : cmd.worldY ?? cmd.y ?? u.y;
              pts.push({ x: wx, y: wy, orderType: cmd.orderType });
              ctx.lineTo(wx, wy);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.font = 'bold 9px "Courier New", monospace';
            ctx.textAlign = 'center';
            for (let q = 0; q < pts.length; q++) {
              const pt = pts[q];
              ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = pt.orderType === 'attack' ? '#ef4444' : '#38bdf8';
              ctx.lineWidth = 1.4;
              ctx.stroke();
              ctx.fillStyle = '#f8fafc';
              ctx.fillText(String(q + 1), pt.x, pt.y + 3);
            }

            ctx.restore();
          }
        }
      }

      // B. Building Placement Footprint Preview
      if (this.placementPreview) {
        const p = this.placementPreview;
        const def =
          p.def ||
          (window.RA.DATA && window.RA.DATA.BUILDINGS && window.RA.DATA.BUILDINGS[p.defId]) ||
          null;
        const footprint = def && Array.isArray(def.footprint) ? def.footprint : [p.w || 2, p.h || 2];
        const w = footprint[0];
        const h = footprint[1];
        const tx = p.tx ?? 0;
        const ty = p.ty ?? 0;

        let status = null;
        if (typeof map.getTilePlacementStatus === 'function') {
          status = map.getTilePlacementStatus(tx, ty, w, h, 'player', engine.entities || [], null, def);
        } else {
          const valid =
            typeof map.canPlaceBuilding === 'function'
              ? map.canPlaceBuilding(tx, ty, w, h, 'player', engine.entities || [], null, def)
              : true;
          const tiles = [];
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
              tiles.push({ tx: tx + dx, ty: ty + dy, ok: valid });
            }
          }
          status = { valid, adjacentOk: valid, tiles };
        }

        // Range ring if defensive building
        if (def && def.range > 0) {
          const cx = (tx + w / 2) * tileSize;
          const cy = (ty + h / 2) * tileSize;
          ctx.save();
          ctx.strokeStyle = status.valid ? 'rgba(34, 197, 94, 0.55)' : 'rgba(239, 68, 68, 0.55)';
          ctx.lineWidth = 1.8;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.arc(cx, cy, def.range, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        for (const t of status.tiles || []) {
          const cellOk = Boolean(t.ok && status.adjacentOk !== false);
          const px = t.tx * tileSize;
          const py = t.ty * tileSize;
          ctx.fillStyle = cellOk ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.5)';
          ctx.fillRect(px, py, tileSize, tileSize);
          ctx.strokeStyle = cellOk ? '#4ade80' : '#f87171';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
        }

        if (status.adjacentOk === false) {
          ctx.save();
          ctx.font = 'bold 11px "Courier New", monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#fca5a5';
          ctx.fillText('MUST BUILD NEAR FRIENDLY BASE', (tx + w / 2) * tileSize, (ty + h) * tileSize + 14);
          ctx.restore();
        }
      }

      // C. Superweapon Targeting Reticle
      if (this.superweaponTargeting) {
        const sw = this.superweaponTargeting;
        const swDef =
          window.RA.DATA && window.RA.DATA.SUPERWEAPONS && window.RA.DATA.SUPERWEAPONS[sw.swId];
        const radius = (swDef && swDef.radius) || 160;
        const wx = sw.worldX ?? this.mouseWorld.x;
        const wy = sw.worldY ?? this.mouseWorld.y;
        const color =
          sw.swId === 'chronosphere' ? '#38bdf8' : sw.swId === 'ironcurtain' ? '#ef4444' : '#facc15';

        ctx.save();
        ctx.translate(wx, wy);
        ctx.strokeStyle = color;
        ctx.fillStyle =
          sw.swId === 'chronosphere'
            ? 'rgba(56, 189, 248, 0.14)'
            : sw.swId === 'ironcurtain'
            ? 'rgba(239, 68, 68, 0.14)'
            : 'rgba(250, 204, 21, 0.14)';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.rotate(this.animTime * 2);
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-30, 0);
        ctx.lineTo(-10, 0);
        ctx.moveTo(10, 0);
        ctx.lineTo(30, 0);
        ctx.moveTo(0, -30);
        ctx.lineTo(0, -10);
        ctx.moveTo(0, 10);
        ctx.lineTo(0, 30);
        ctx.stroke();
        ctx.restore();
      }
    }

    _renderScreenOverlays(ctx) {
      if (this.selectionBox) {
        const sb = this.selectionBox;
        let x1 = sb.x1 ?? sb.startX ?? sb.x ?? 0;
        let y1 = sb.y1 ?? sb.startY ?? sb.y ?? 0;
        let x2 = sb.x2 ?? sb.endX ?? (sb.x !== undefined && sb.w !== undefined ? sb.x + sb.w : x1);
        let y2 = sb.y2 ?? sb.endY ?? (sb.y !== undefined && sb.h !== undefined ? sb.y + sb.h : y1);

        if (sb.isWorld || sb.world) {
          const s1 = this.worldToScreen(x1, y1);
          const s2 = this.worldToScreen(x2, y2);
          x1 = s1.x;
          y1 = s1.y;
          x2 = s2.x;
          y2 = s2.y;
        }

        const rx = Math.min(x1, x2);
        const ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1);
        const rh = Math.abs(y2 - y1);

        if (rw > 2 || rh > 2) {
          ctx.save();
          ctx.fillStyle = 'rgba(34, 197, 94, 0.16)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = '#86efac';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
          ctx.restore();
        }
      }
    }

    // =========================================================================
    // MINIMAP RENDERER (WITH THEATER PALETTE, ZOOM VIEWPORT & RADAR PINGS)
    // =========================================================================

    renderMinimap(engine) {
      if (!this.minimapCtx || !this.minimapCanvas || !engine || !engine.map) return;

      const ctx = this.minimapCtx;
      const cw = this.minimapCanvas.width;
      const ch = this.minimapCanvas.height;
      const map = engine.map;
      const palette = this._getTheaterPalette(map.theater || 'temperate');
      const mmColors = palette.minimap || DEFAULT_THEATERS.temperate.minimap;

      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, cw, ch);

      const T = window.RA.TILE_TYPES || {
        GRASS: 0,
        DIRT: 1,
        WATER: 2,
        BRIDGE: 3,
        ROCK: 4,
        ORE: 5,
        GEMS: 6,
        ROAD: 7
      };
      const FOG = window.RA.FOG || {
        UNEXPLORED: 0,
        EXPLORED: 1,
        VISIBLE: 2
      };

      const scaleX = cw / map.width;
      const scaleY = ch / map.height;
      const fogEnabled = map.fogEnabled !== false && Array.isArray(map.fog);

      const playerTeam = engine.teams && engine.teams.player;
      const hasRadarBuilding =
        (playerTeam && playerTeam.hasRadar) ||
        (Array.isArray(engine.entities) &&
          engine.entities.some((e) => e && !e.dead && e.team === 'player' && e.defId === 'radar'));
      const lowPower = Boolean(playerTeam && playerTeam.lowPower);
      const radarActive = hasRadarBuilding && !lowPower;

      // 1. Draw Terrain & Fog on Minimap using active Theater palette
      for (let ty = 0; ty < map.height; ty++) {
        const row = map.tiles && map.tiles[ty];
        if (!row) continue;
        const fogRow = fogEnabled ? map.fog[ty] : null;

        for (let tx = 0; tx < map.width; tx++) {
          const fogState = fogRow ? fogRow[tx] : FOG.VISIBLE;
          if (fogState === FOG.UNEXPLORED) continue;

          const tile = row[tx];
          if (!tile) continue;

          switch (tile.type) {
            case T.WATER:
              ctx.fillStyle = mmColors.water || '#143d66';
              break;
            case T.BRIDGE:
              ctx.fillStyle = mmColors.bridge || '#94a3b8';
              break;
            case T.ROCK:
              ctx.fillStyle = mmColors.rock || '#475569';
              break;
            case T.ORE:
              ctx.fillStyle = '#eab308';
              break;
            case T.GEMS:
              ctx.fillStyle = '#ec4899';
              break;
            case T.DIRT:
              ctx.fillStyle = mmColors.dirt || '#5c4938';
              break;
            case T.ROAD:
              ctx.fillStyle = mmColors.road || '#5c4938';
              break;
            case T.GRASS:
            default:
              ctx.fillStyle = mmColors.grass || '#2d4c2b';
              break;
          }

          const px = tx * scaleX;
          const py = ty * scaleY;
          ctx.fillRect(px, py, Math.ceil(scaleX), Math.ceil(scaleY));

          if (fogState === FOG.EXPLORED) {
            ctx.fillStyle = 'rgba(5, 10, 18, 0.5)';
            ctx.fillRect(px, py, Math.ceil(scaleX), Math.ceil(scaleY));
          }
        }
      }

      // 2. Draw Friendly & Visible Enemy Blips
      const tileSize = map.tileSize || window.RA.TILE_SIZE || 40;
      const pixelWidth = map.pixelWidth || map.width * tileSize;
      const pixelHeight = map.pixelHeight || map.height * tileSize;

      if (Array.isArray(engine.entities)) {
        for (let i = 0; i < engine.entities.length; i++) {
          const e = engine.entities[i];
          if (!e || e.dead) continue;

          const tx = Math.max(0, Math.min(map.width - 1, Math.floor(e.x / tileSize)));
          const ty = Math.max(0, Math.min(map.height - 1, Math.floor(e.y / tileSize)));

          if (e.team !== 'player' && fogEnabled) {
            const fState = map.fog[ty] ? map.fog[ty][tx] : FOG.UNEXPLORED;
            if (e.isBuilding) {
              if (fState === FOG.UNEXPLORED && !radarActive) continue;
            } else {
              if (fState !== FOG.VISIBLE && !radarActive) continue;
            }
          }

          const colors = this._getFactionColors(e, engine);
          ctx.fillStyle = e.team === 'player' ? colors.main : colors.main || '#ef4444';

          if (e.isBuilding) {
            const bw = (e.w || 2) * scaleX;
            const bh = (e.h || 2) * scaleY;
            const bx = (e.tx ?? tx) * scaleX;
            const by = (e.ty ?? ty) * scaleY;
            ctx.fillRect(bx, by, Math.max(3, bw), Math.max(3, bh));
          } else {
            const mx = (e.x / pixelWidth) * cw;
            const my = (e.y / pixelHeight) * ch;
            ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
          }
        }
      }

      // 3. Radar Sweep Effect & Animated Radar Event Pings
      if (radarActive) {
        const sweepY = (this.animTime * 45) % ch;
        ctx.fillStyle = 'rgba(34, 197, 94, 0.12)';
        ctx.fillRect(0, sweepY, cw, 4);
      }

      if (Array.isArray(engine.radarPings) && engine.radarPings.length > 0) {
        for (let i = 0; i < engine.radarPings.length; i++) {
          const ping = engine.radarPings[i];
          if (!ping) continue;
          const wx = ping.x ?? ping.wx ?? 0;
          const wy = ping.y ?? ping.wy ?? 0;
          const px = (wx / pixelWidth) * cw;
          const py = (wy / pixelHeight) * ch;

          let prog = (this.animTime * 1.4 + i * 0.25) % 1;
          if (typeof ping.life === 'number') {
            const maxL = ping.maxLife || 4.0;
            prog = (1 - Math.max(0, Math.min(1, ping.life / maxL)) * 2) % 1;
          }

          const r = 3 + Math.abs(prog) * 15;
          ctx.save();
          ctx.strokeStyle = ping.color || '#ef4444';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.stroke();

          // Crosshairs
          ctx.beginPath();
          ctx.moveTo(px - 5, py);
          ctx.lineTo(px + 5, py);
          ctx.moveTo(px, py - 5);
          ctx.lineTo(px, py + 5);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 4. White Camera Viewport Rectangle (scaled by 1 / zoom)
      const z = this.camera.zoom || 1.0;
      const vx = (this.camera.x / pixelWidth) * cw;
      const vy = (this.camera.y / pixelHeight) * ch;
      const vw = (this.camera.width / z / pixelWidth) * cw;
      const vh = (this.camera.height / z / pixelHeight) * ch;

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        Math.max(0, vx),
        Math.max(0, vy),
        Math.min(cw, vw),
        Math.min(ch, vh)
      );

      // 5. Compact Status Pill at Top-Left of Minimap
      ctx.save();
      ctx.fillStyle = 'rgba(5, 7, 10, 0.72)';
      ctx.fillRect(4, 4, 108, 15);
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.fillStyle = radarActive ? '#4ade80' : '#fbbf24';
      ctx.fillText(radarActive ? '● RADAR ACTIVE' : '○ TACTICAL MAP', 8, 14);
      ctx.restore();
    }
  }

  window.RA.Renderer = Renderer;
})();
