(function () {
  'use strict';

  window.RA = window.RA || {};

  const PRODUCER_BUILDING_IDS = ['barracks', 'weap', 'helipad', 'afld', 'syrd', 'spen'];
  const WALL_BUILDING_IDS = ['sbag', 'fenc', 'brik'];
  const CRATE_TYPE_WEIGHTS = [
    { type: 'credits', weight: 35 },
    { type: 'heal', weight: 20 },
    { type: 'veterancy', weight: 15 },
    { type: 'freeUnit', weight: 12 },
    { type: 'reveal', weight: 10 },
    { type: 'nukeTrap', weight: 8 }
  ];

  function getTileSize() {
    return window.RA.TILE_SIZE || 40;
  }

  function getData() {
    return window.RA.DATA || {
      FACTIONS: {},
      BUILDINGS: {},
      UNITS: {},
      SUPERWEAPONS: {},
      MISSIONS: []
    };
  }

  class GameEngine {
    constructor(map, renderer) {
      this.map = map || null;
      this.renderer = renderer || null;

      this.entities = [];
      this.projectiles = [];
      this.particles = [];
      this.floatingTexts = [];
      this.crates = [];
      this.decals = [];
      this.radarPings = [];
      this.lastAlertPos = null;

      this.nextCrateId = 1;
      this.nextDecalId = 1;
      this.crateSpawnTimer = 0;

      this.state = 'menu'; // 'menu' | 'briefing' | 'playing' | 'paused' | 'victory' | 'defeat'
      this.gameSpeed = 1.0;
      this.elapsedTime = 0;

      this.currentMission = null;
      this.customOptions = {};
      this.aiDifficulty = 'medium';
      this.aiCount = 1;
      this.aiDoctrine = 'balanced';

      this.stats = this._createInitialStats();
      this.teams = {
        player: this._createTeamState('player', 'allied', 5000, { color: '#3b82f6' }),
        enemy: this._createTeamState('enemy', 'soviet', 5000, { color: '#ef4444' })
      };

      // EVA alert / HUD notification state
      this.evaMessage = 'BATTLEFIELD CONTROL ONLINE';
      this.evaTimer = 0;
      this.insufficientFundsCooldown = 0;
      this.baseUnderAttackCooldown = 0;
      this.harvesterAttackCooldown = 0;

      // AI Commander state
      this.aiState = {
        thinkTimer: 0,
        waveTimer: 0,
        waveInterval: 55,
        rebuildTimer: 0
      };

      // Event hooks for UI
      this.onGameOver = null;
      this.onEvaMessage = null;
      this.onNotification = null;
      this.onProductionComplete = null;
    }

    _createInitialStats() {
      return {
        unitsBuilt: 0,
        unitsKilled: 0,
        unitsLost: 0,
        buildingsBuilt: 0,
        buildingsDestroyed: 0,
        buildingsLost: 0,
        creditsHarvested: 0,
        cratesCollected: 0,
        elapsedTime: 0
      };
    }

    _createTeamState(id, faction, credits, extra = {}) {
      const DATA = getData();
      const swDefs = DATA.SUPERWEAPONS || {};

      const queues = {
        building: null,
        defense: null,
        infantry: [],
        vehicle: []
      };

      // Provide plural and air/naval aliases on queues so UI/tests can access any category key
      Object.defineProperties(queues, {
        buildings: {
          get() { return this.building; },
          set(v) { this.building = v; }
        },
        structures: {
          get() { return this.building; },
          set(v) { this.building = v; }
        },
        structure: {
          get() { return this.building; },
          set(v) { this.building = v; }
        },
        defenses: {
          get() { return this.defense; },
          set(v) { this.defense = v; }
        },
        vehicles: {
          get() { return this.vehicle; },
          set(v) { this.vehicle = v; }
        },
        aircraft: {
          get() { return this.vehicle; },
          set(v) { this.vehicle = v; }
        },
        air: {
          get() { return this.vehicle; },
          set(v) { this.vehicle = v; }
        },
        naval: {
          get() { return this.vehicle; },
          set(v) { this.vehicle = v; }
        }
      });

      const createSwState = (swId, defaultRecharge) => {
        const def = swDefs[swId] || {};
        return {
          id: swId,
          name: def.name || swId,
          icon: def.icon || '⚡',
          ready: false,
          progress: 0,
          timer: 0,
          rechargeTime: def.rechargeTime || defaultRecharge,
          buildingReq: def.buildingReq || (swId === 'nuke' ? 'silo' : 'radar'),
          faction: def.faction || 'both',
          radius: def.radius || 180,
          unlocked: false
        };
      };

      const resolvedFaction = faction || (id === 'player' ? 'allied' : 'soviet');
      const defaultColor =
        id === 'player'
          ? resolvedFaction === 'soviet'
            ? '#ef4444'
            : '#3b82f6'
          : id === 'enemy2'
          ? '#eab308'
          : id === 'enemy3'
          ? '#a855f7'
          : '#ef4444';

      return {
        id,
        faction: resolvedFaction,
        color: extra.color || defaultColor,
        doctrine: extra.doctrine || 'balanced',
        credits: credits !== undefined ? credits : 5000,
        powerProduced: 0,
        powerConsumed: 0,
        lowPower: false,
        hasRadar: false,
        blackoutTimer: 0,
        revealAllTimer: 0,
        aiThinkTimer: extra.aiThinkTimer !== undefined ? extra.aiThinkTimer : 1.5,
        aiWaveTimer: 0,
        queues,
        superweapons: {
          chronosphere: createSwState('chronosphere', 90),
          ironcurtain: createSwState('ironcurtain', 90),
          nuke: createSwState('nuke', 120)
        }
      };
    }

    isFriendly(a, b) {
      const teamA = typeof a === 'object' && a ? a.team : a;
      const teamB = typeof b === 'object' && b ? b.team : b;
      if (!teamA || !teamB) return false;
      return teamA === teamB;
    }

    getActiveAITeams() {
      return Object.keys(this.teams).filter((k) => k !== 'player' && Boolean(this.teams[k]));
    }

    notifyEVA(message, speakPhrase = null) {
      if (!message) return;
      this.evaMessage = message;
      this.evaTimer = 5.0;
      if (typeof this.onEvaMessage === 'function') {
        this.onEvaMessage(message);
      }
      if (speakPhrase && window.RA.audio && typeof window.RA.audio.speak === 'function') {
        window.RA.audio.speak(speakPhrase);
      }
    }

    // =========================================================================
    // MISSION INITIALIZATION & BASE SPAWNING
    // =========================================================================

    startMission(mission, customOptions = {}) {
      const DATA = getData();
      const activeMission =
        mission ||
        (Array.isArray(DATA.MISSIONS) && DATA.MISSIONS[0]) || {
          id: 'mission_1',
          number: 1,
          title: 'Operation: Iron Dawn',
          faction: 'allied',
          enemyFaction: 'soviet',
          startCredits: 5000,
          aiDifficulty: 'easy',
          mapConfig: {
            width: 64,
            height: 64,
            seed: 101,
            theater: 'temperate',
            playerStart: { tx: 8, ty: 52 },
            enemyStart: { tx: 52, ty: 8 },
            riverY: 30
          }
        };

      this.currentMission = activeMission;
      this.customOptions = customOptions || {};

      const playerFaction = customOptions.faction || activeMission.faction || 'allied';
      const enemyFaction =
        customOptions.enemyFaction ||
        activeMission.enemyFaction ||
        (playerFaction === 'allied' ? 'soviet' : 'allied');
      const startCredits =
        customOptions.startCredits !== undefined
          ? Number(customOptions.startCredits)
          : activeMission.startCredits !== undefined
          ? Number(activeMission.startCredits)
          : 5000;

      this.aiDifficulty = customOptions.aiDifficulty || activeMission.aiDifficulty || 'medium';
      this.aiCount = Math.max(
        1,
        Math.min(
          3,
          Number(
            customOptions.aiCount ||
              activeMission.aiCount ||
              (activeMission.mapConfig && activeMission.mapConfig.aiCount) ||
              1
          )
        )
      );
      this.aiDoctrine =
        customOptions.aiDoctrine ||
        activeMission.aiDoctrine ||
        (activeMission.mapConfig && activeMission.mapConfig.aiDoctrine) ||
        'balanced';

      const theater =
        customOptions.theater ||
        activeMission.theater ||
        (activeMission.mapConfig && activeMission.mapConfig.theater) ||
        (activeMission.number === 2 ? 'snow' : activeMission.number === 3 ? 'desert' : 'temperate');

      if (window.RA.Entity && typeof window.RA.Entity.resetIds === 'function') {
        window.RA.Entity.resetIds();
      }

      const mapCfg = Object.assign(
        {
          width: 64,
          height: 64,
          theater,
          aiCount: this.aiCount,
          extraBases: this.aiCount > 1,
          playerStart: { tx: 8, ty: 52 },
          enemyStart: { tx: 52, ty: 8 }
        },
        activeMission.mapConfig || {},
        {
          theater,
          aiCount: this.aiCount,
          extraBases: this.aiCount > 1
        }
      );

      this.map = new window.RA.GameMap(mapCfg.width || 64, mapCfg.height || 64, mapCfg);
      this.map.theater = theater;
      if (customOptions.fogEnabled !== undefined) {
        this.map.fogEnabled = Boolean(customOptions.fogEnabled);
      }

      this.entities = [];
      this.projectiles = [];
      this.particles = [];
      this.floatingTexts = [];
      this.crates = [];
      this.decals = [];
      this.radarPings = [];
      this.lastAlertPos = null;
      this.crateSpawnTimer = 0;

      this.elapsedTime = 0;
      this.stats = this._createInitialStats();

      const enemyCredits =
        this.aiDifficulty === 'hard' ? 9000 : this.aiDifficulty === 'medium' ? 6500 : 4500;

      this.teams = {
        player: this._createTeamState('player', playerFaction, startCredits, {
          color: playerFaction === 'soviet' ? '#ef4444' : '#3b82f6'
        }),
        enemy: this._createTeamState('enemy', enemyFaction, enemyCredits, {
          color: '#ef4444',
          doctrine: this.aiDoctrine,
          aiThinkTimer: 1.5
        })
      };

      if (this.aiCount >= 2) {
        const enemy2Faction = enemyFaction === 'soviet' ? 'allied' : 'soviet';
        this.teams.enemy2 = this._createTeamState('enemy2', enemy2Faction, enemyCredits, {
          color: '#eab308',
          doctrine: this.aiDoctrine === 'balanced' ? 'rush' : this.aiDoctrine,
          aiThinkTimer: 2.2
        });
      }

      if (this.aiCount >= 3) {
        this.teams.enemy3 = this._createTeamState('enemy3', enemyFaction, enemyCredits, {
          color: '#a855f7',
          doctrine: this.aiDoctrine === 'balanced' ? 'turtle' : this.aiDoctrine,
          aiThinkTimer: 2.8
        });
      }

      let baseWaveInterval =
        this.aiDifficulty === 'hard' ? 42 : this.aiDifficulty === 'medium' ? 54 : 68;
      if (this.aiDoctrine === 'rush') {
        baseWaveInterval = Math.round(baseWaveInterval * 0.65);
      } else if (this.aiDoctrine === 'turtle') {
        baseWaveInterval = Math.round(baseWaveInterval * 1.25);
      }

      this.aiState = {
        thinkTimer: 1.5,
        waveTimer: 0,
        waveInterval: baseWaveInterval,
        rebuildTimer: 2.0
      };

      // Spawn Player & Enemy Starting Bases
      const pStart = mapCfg.playerStart || { tx: 8, ty: 52 };
      const eStart = mapCfg.enemyStart || { tx: 52, ty: 8 };

      this._spawnPlayerBase(pStart.tx, pStart.ty, playerFaction);
      this._spawnEnemyBase(eStart.tx, eStart.ty, enemyFaction, 'enemy');

      if (this.aiCount >= 2 && this.teams.enemy2) {
        const e2Start = { tx: 10, ty: 10 };
        this._clearExtraPlateau(e2Start.tx, e2Start.ty, 7);
        this._spawnEnemyBase(e2Start.tx, e2Start.ty, this.teams.enemy2.faction, 'enemy2');
      }

      if (this.aiCount >= 3 && this.teams.enemy3) {
        const e3Start = { tx: 52, ty: 52 };
        this._clearExtraPlateau(e3Start.tx, e3Start.ty, 7);
        this._spawnEnemyBase(e3Start.tx, e3Start.ty, this.teams.enemy3.faction, 'enemy3');
      }

      // Spawn 5 initial bonus supply crates across the sector
      for (let c = 0; c < 5; c++) {
        this.spawnCrate();
      }

      for (const teamId of Object.keys(this.teams)) {
        this.recalculatePower(teamId);
      }

      // Update Fog of War
      if (this.map && typeof this.map.updateFog === 'function') {
        this.map.updateFog(this.entities, 'player', !this.map.fogEnabled);
      }

      this.state = 'playing';
      this.notifyEVA('MISSION INITIALIZED — ESTABLISH BASE CONTROL', 'Unit ready');

      // Center camera on player's Construction Yard
      this.centerCameraOnPlayerBase();

      return this;
    }

    _clearExtraPlateau(centerTx, centerTy, radius = 7) {
      if (!this.map) return;
      const TILE_TYPES = window.RA.TILE_TYPES || { GRASS: 0, WATER: 2, BRIDGE: 3, ROCK: 4, ORE: 5 };
      for (let ty = centerTy - radius; ty <= centerTy + radius; ty++) {
        for (let tx = centerTx - radius; tx <= centerTx + radius; tx++) {
          if (!this.map.inBounds(tx, ty)) continue;
          const tile = this.map.getTile(tx, ty);
          if (!tile) continue;
          if (
            tile.type === TILE_TYPES.WATER ||
            tile.type === TILE_TYPES.ROCK ||
            tile.type === TILE_TYPES.BRIDGE
          ) {
            tile.type = TILE_TYPES.GRASS;
            tile.oreAmount = 0;
            tile.maxOre = 0;
          }
        }
      }
    }

    _spawnPlayerBase(baseTx, baseTy, faction) {
      const ts = getTileSize();

      // 1. Primary Construction Yard at baseTx, baseTy
      const conyard = this.spawnBuilding('conyard', baseTx, baseTy, 'player', {
        faction,
        constructionAnim: 0.4
      });

      // 2. Starting MCV positioned on a clear 3x3 buildable plateau to the right
      const mcvTile = this._findClearUnitTile(baseTx + 5, baseTy + 1, 'land');
      this.spawnUnit('mcv', mcvTile.x, mcvTile.y, 'player', { faction });

      // 3. Starting Armored Escort (2 tanks appropriate to faction)
      const tankType1 = faction === 'allied' ? 'mtnk' : 'htnk';
      const tankType2 = faction === 'allied' ? 'ltnk' : 'htnk';
      const tPos1 = this._findClearUnitTile(baseTx - 2, baseTy - 1, 'land');
      const tPos2 = this._findClearUnitTile(baseTx + 4, baseTy - 1, 'land');
      this.spawnUnit(tankType1, tPos1.x, tPos1.y, 'player', { faction });
      this.spawnUnit(tankType2, tPos2.x, tPos2.y, 'player', { faction });

      // 4. Starting Infantry Squad (4 rifle, 2 rocket)
      const infOffsets = [
        [-2, 1],
        [-2, 2],
        [-1, 3],
        [0, 4],
        [1, 4],
        [2, 4]
      ];
      for (let i = 0; i < infOffsets.length; i++) {
        const defId = i < 4 ? 'rifle' : 'rocket';
        const pos = this._findClearUnitTile(
          baseTx + infOffsets[i][0],
          baseTy + infOffsets[i][1],
          'land'
        );
        this.spawnUnit(defId, pos.x, pos.y, 'player', { faction });
      }

      // 5. Starting Ore Harvester
      const harvPos = this._findClearUnitTile(baseTx + 3, baseTy + 3, 'land');
      const harv = this.spawnUnit('harvester', harvPos.x, harvPos.y, 'player', {
        faction,
        state: 'harvest'
      });

      if (conyard) {
        conyard.rallyPoint = { x: conyard.x, y: conyard.y + ts * 3.0 };
      }
      if (harv) {
        harv.state = 'harvest';
      }
    }

    _spawnEnemyBase(baseTx, baseTy, faction, teamId = 'enemy') {
      const buildingsToPlace = [
        { defId: 'conyard', ox: 0, oy: 0 },
        { defId: 'power', ox: -3, oy: 0 },
        { defId: 'advpower', ox: -3, oy: 3 },
        { defId: 'refinery', ox: -4, oy: -4 },
        { defId: 'barracks', ox: 4, oy: 0 },
        { defId: 'weap', ox: 0, oy: 4 },
        { defId: faction === 'soviet' ? 'tesla' : 'turret', ox: -2, oy: 6 },
        { defId: 'pillbox', ox: 4, oy: 5 },
        { defId: faction === 'soviet' ? 'tesla' : 'turret', ox: -5, oy: 2 }
      ];

      if (this.aiDifficulty === 'hard') {
        buildingsToPlace.push({ defId: 'radar', ox: 4, oy: -3 });
      }

      for (let i = 0; i < buildingsToPlace.length; i++) {
        const item = buildingsToPlace[i];
        const spot = this._findValidBuildingSpotNear(
          item.defId,
          baseTx + item.ox,
          baseTy + item.oy,
          teamId,
          true
        );
        if (spot) {
          this.spawnBuilding(item.defId, spot.tx, spot.ty, teamId, {
            faction,
            constructionAnim: 0
          });
        }
      }

      // Spawn Enemy Harvester
      const harvSpot = this._findClearUnitTile(baseTx - 3, baseTy - 1, 'land');
      this.spawnUnit('harvester', harvSpot.x, harvSpot.y, teamId, {
        faction,
        state: 'harvest'
      });

      // Spawn Enemy Initial Guard Squad
      const guardDefs = [
        'rifle',
        'rifle',
        'rifle',
        'rocket',
        'rocket',
        faction === 'soviet' ? 'htnk' : 'mtnk',
        faction === 'soviet' ? 'htnk' : 'ltnk'
      ];
      for (let i = 0; i < guardDefs.length; i++) {
        const defId = guardDefs[i];
        const pos = this._findClearUnitTile(
          baseTx - 3 + (i % 4) * 2,
          baseTy + 6 + Math.floor(i / 4) * 2,
          'land'
        );
        this.spawnUnit(defId, pos.x, pos.y, teamId, { faction });
      }
    }

    centerCameraOnPlayerBase() {
      if (!this.renderer || typeof this.renderer.centerOn !== 'function') return;
      const base = this.getBaseCenter('player');
      if (base) {
        this.renderer.centerOn(base.x, base.y, this.map);
      }
    }

    getBaseCenter(team = 'player') {
      const conyard = this.entities.find(
        (e) => e && !e.dead && e.isBuilding && e.team === team && e.defId === 'conyard'
      );
      if (conyard) return { x: conyard.x, y: conyard.y };
      const anyBuilding = this.entities.find(
        (e) => e && !e.dead && e.isBuilding && e.team === team
      );
      if (anyBuilding) return { x: anyBuilding.x, y: anyBuilding.y };
      const anyUnit = this.entities.find((e) => e && !e.dead && e.isUnit && e.team === team);
      if (anyUnit) return { x: anyUnit.x, y: anyUnit.y };
      const ts = getTileSize();
      return team === 'player' ? { x: 10 * ts, y: 52 * ts } : { x: 52 * ts, y: 10 * ts };
    }

    // =========================================================================
    // ENTITY SPAWNING, PRIMARY BUILDINGS, CRATES, DECALS & RADAR PINGS
    // =========================================================================

    spawnBuilding(defId, tx, ty, team = 'player', extraOpts = {}) {
      const DATA = getData();
      const def = DATA.BUILDINGS && DATA.BUILDINGS[defId];
      if (!def) return null;

      const faction =
        extraOpts.faction || (this.teams[team] ? this.teams[team].faction : 'allied');

      // First producer building of its type automatically becomes PRIMARY
      let isPrimary = Boolean(extraOpts.isPrimary);
      if (extraOpts.isPrimary === undefined && PRODUCER_BUILDING_IDS.includes(defId)) {
        const existingPrimary = this.entities.some(
          (e) => e && !e.dead && e.isBuilding && e.team === team && e.defId === defId && e.isPrimary
        );
        if (!existingPrimary) {
          isPrimary = true;
        }
      }

      const building = new window.RA.Building(
        Object.assign(
          {
            defId,
            def,
            tx,
            ty,
            team,
            faction,
            isPrimary
          },
          extraOpts,
          { isPrimary }
        )
      );

      this.entities.push(building);

      if (this.map && typeof this.map.setBuildingFootprint === 'function') {
        this.map.setBuildingFootprint(
          building.tx,
          building.ty,
          building.w,
          building.h,
          building.id,
          defId
        );
      }

      // Mark wall metadata on tile for 4-bit neighbor wall auto-tiling
      if (this.map && (def.isWall || WALL_BUILDING_IDS.includes(defId))) {
        for (let cy = building.ty; cy < building.ty + building.h; cy++) {
          for (let cx = building.tx; cx < building.tx + building.w; cx++) {
            const tile = this.map.getTile(cx, cy);
            if (tile) {
              tile.wallDefId = defId;
              tile.isWall = true;
            }
          }
        }
      }

      this.recalculatePower(team);

      return building;
    }

    setPrimaryBuilding(building) {
      if (!building || building.dead || !building.isBuilding) return false;
      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (
          e &&
          !e.dead &&
          e.isBuilding &&
          e.team === building.team &&
          e.defId === building.defId
        ) {
          e.isPrimary = false;
        }
      }
      building.isPrimary = true;
      if (building.team === 'player') {
        this.notifyEVA(building.name.toUpperCase() + ' DESIGNATED AS PRIMARY', 'Primary building selected');
        if (window.RA.audio) {
          window.RA.audio.playSfx('click');
        }
      }
      return true;
    }

    getPrimaryBuilding(team = 'player', producerDefId = 'weap') {
      const primary = this.entities.find(
        (e) =>
          e &&
          !e.dead &&
          e.isBuilding &&
          e.team === team &&
          e.defId === producerDefId &&
          e.isPrimary
      );
      if (primary) return primary;
      return this.findNearestBuilding(0, 0, team, producerDefId);
    }

    getFactoryMultiplier(team = 'player', category = 'vehicle') {
      const c = String(category || 'vehicle').toLowerCase();
      let matchDefs = ['weap'];
      if (c === 'building' || c === 'buildings' || c === 'defense' || c === 'defenses' || c === 'structure') {
        matchDefs = ['conyard'];
      } else if (c === 'infantry') {
        matchDefs = ['barracks'];
      } else if (c === 'aircraft' || c === 'air') {
        matchDefs = ['helipad', 'afld'];
      } else if (c === 'naval') {
        matchDefs = ['syrd', 'spen'];
      } else {
        matchDefs = ['weap'];
      }

      let count = 0;
      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (e && !e.dead && e.isBuilding && e.team === team && matchDefs.includes(e.defId)) {
          count++;
        }
      }
      if (count <= 1) return 1.0;
      return Math.min(2.0, 1 + 0.25 * Math.max(0, count - 1));
    }

    spawnUnit(defId, x, y, team = 'player', extraOpts = {}) {
      const DATA = getData();
      const def = DATA.UNITS && DATA.UNITS[defId];
      if (!def) return null;

      const faction =
        extraOpts.faction || (this.teams[team] ? this.teams[team].faction : 'allied');
      const unit = new window.RA.Unit(
        Object.assign(
          {
            defId,
            def,
            x,
            y,
            team,
            faction
          },
          extraOpts
        )
      );

      this.entities.push(unit);
      return unit;
    }

    spawnProjectile(opts = {}) {
      const proj = new window.RA.Projectile(opts);
      this.projectiles.push(proj);
      return proj;
    }

    spawnFloatingText(x, y, text, color = '#facc15', size = 14) {
      const ft = new window.RA.FloatingText({ x, y, text, color, size });
      this.floatingTexts.push(ft);
      return ft;
    }

    addDecal(x, y, type = 'crater', radius = 16, angle = 0) {
      const decal = {
        id: this.nextDecalId++,
        x: Number(x) || 0,
        y: Number(y) || 0,
        type: type || 'crater',
        radius: radius || (type === 'nuke_crater' ? 68 : type === 'rubble' ? 28 : 16),
        angle: angle || 0,
        alpha: type === 'tracks' ? 0.42 : 0.85,
        createdAt: this.elapsedTime || 0,
        age: 0,
        maxAge: type === 'tracks' ? 45 : 180
      };
      this.decals.push(decal);
      if (this.decals.length > 250) {
        this.decals.shift();
      }
      return decal;
    }

    addRadarPing(wx, wy, color = '#ef4444', label = 'ALERT') {
      const px = Number(wx) || 0;
      const py = Number(wy) || 0;
      const ping = {
        id: this.nextDecalId++,
        x: px,
        y: py,
        wx: px,
        wy: py,
        color: color || '#ef4444',
        label: label || 'ALERT',
        radius: 3,
        maxRadius: 18,
        life: 4.0,
        maxLife: 4.0,
        age: 0,
        time: this.elapsedTime || 0
      };
      this.radarPings.push(ping);
      this.lastAlertPos = {
        x: px,
        y: py,
        wx: px,
        wy: py,
        color: ping.color,
        label: ping.label,
        time: this.elapsedTime || 0,
        timestamp: Date.now()
      };
      if (window.RA.audio && typeof window.RA.audio.playSfx === 'function') {
        window.RA.audio.playSfx('radar_ping');
      }
      return ping;
    }

    spawnCrate(tx, ty, forcedType = null) {
      if (!this.map) return null;
      const ts = getTileSize();

      if (tx && typeof tx === 'object') {
        forcedType = tx.type || forcedType;
        ty = tx.ty !== undefined ? tx.ty : tx.y;
        tx = tx.tx !== undefined ? tx.tx : tx.x;
      }

      let tileX = tx;
      let tileY = ty;

      if (tileX === undefined || tileY === undefined || tileX === null || tileY === null) {
        // Find a random passable land tile away from buildings
        let found = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          const rx = 4 + Math.floor(Math.random() * (this.map.width - 8));
          const ry = 4 + Math.floor(Math.random() * (this.map.height - 8));
          if (this.map.isPassable(rx, ry, 'land')) {
            const wx = (rx + 0.5) * ts;
            const wy = (ry + 0.5) * ts;
            const nearUnit = this.entities.some(
              (e) => e && !e.dead && Math.hypot(e.x - wx, e.y - wy) < ts * 1.5
            );
            if (!nearUnit) {
              tileX = rx;
              tileY = ry;
              found = true;
              break;
            }
          }
        }
        if (!found) {
          tileX = Math.floor(this.map.width / 2);
          tileY = Math.floor(this.map.height / 2);
        }
      } else if (tileX >= this.map.width || tileY >= this.map.height) {
        // World coordinates were passed; convert to tile coordinates
        const conv = this.map.worldToTile(tileX, tileY);
        tileX = conv.tx;
        tileY = conv.ty;
      }

      tileX = Math.max(0, Math.min(this.map.width - 1, Math.floor(tileX)));
      tileY = Math.max(0, Math.min(this.map.height - 1, Math.floor(tileY)));

      let crateType = forcedType;
      if (!crateType) {
        let roll = Math.random() * 100;
        crateType = 'credits';
        for (let i = 0; i < CRATE_TYPE_WEIGHTS.length; i++) {
          roll -= CRATE_TYPE_WEIGHTS[i].weight;
          if (roll <= 0) {
            crateType = CRATE_TYPE_WEIGHTS[i].type;
            break;
          }
        }
      }

      const crate = {
        id: this.nextCrateId++,
        tx: tileX,
        ty: tileY,
        x: (tileX + 0.5) * ts,
        y: (tileY + 0.5) * ts,
        type: crateType,
        amount: crateType === 'credits' ? 2000 : 1,
        spawnTime: this.elapsedTime || 0,
        pulseAnim: 0
      };

      this.crates.push(crate);
      return crate;
    }

    _updateCrates(dt) {
      this.crateSpawnTimer += dt;
      if (this.crateSpawnTimer >= 75) {
        this.crateSpawnTimer = 0;
        if (this.crates.length < 8) {
          const spawned = this.spawnCrate();
          if (spawned) {
            this.addRadarPing(spawned.x, spawned.y, '#38bdf8', 'CRATE');
          }
        }
      }

      if (!Array.isArray(this.crates) || this.crates.length === 0) return;

      for (let i = this.crates.length - 1; i >= 0; i--) {
        const crate = this.crates[i];
        if (!crate) continue;
        crate.pulseAnim = (crate.pulseAnim || 0) + dt * 3.0;

        // Check if any non-air unit is within 28px of crate
        let collector = null;
        for (let j = 0; j < this.entities.length; j++) {
          const u = this.entities[j];
          if (!u || u.dead || !u.isUnit || u.locomotion === 'air') continue;
          if (Math.hypot(u.x - crate.x, u.y - crate.y) <= 28) {
            collector = u;
            break;
          }
        }

        if (collector) {
          this.crates.splice(i, 1);
          this.collectCrate(crate, collector);
        }
      }
    }

    collectCrate(crate, collector) {
      if (!crate || !collector) return false;
      const type = crate.type || 'credits';
      const team = collector.team || 'player';
      const teamState = this.teams[team];

      if (team === 'player') {
        this.stats.cratesCollected = (this.stats.cratesCollected || 0) + 1;
      }

      if (window.RA.audio) {
        window.RA.audio.playSfx('crate_pickup');
      }

      if (type === 'credits') {
        const amount = crate.amount && crate.amount >= 500 ? crate.amount : 2000;
        this.addCredits(team, amount, false);
        this.spawnFloatingText(crate.x, crate.y - 22, '+$' + amount + ' CRATE!', '#facc15');
        if (window.RA.audio) window.RA.audio.playSfx('cash');
      } else if (type === 'heal') {
        collector.hp = collector.maxHp;
        for (let i = 0; i < this.entities.length; i++) {
          const e = this.entities[i];
          if (e && !e.dead && e.isUnit && e.team === team && Math.hypot(e.x - crate.x, e.y - crate.y) <= 120) {
            e.hp = e.maxHp;
          }
        }
        this.spawnParticles(crate.x, crate.y, 'spark', 12);
        this.spawnFloatingText(crate.x, crate.y - 22, 'SQUAD HEALED 100%!', '#22c55e');
      } else if (type === 'veterancy') {
        collector.veterancy = Math.min(3, (collector.veterancy || 0) + 1);
        collector.kills = Math.max(collector.kills || 0, collector.veterancy * 2);
        for (let i = 0; i < this.entities.length; i++) {
          const e = this.entities[i];
          if (
            e &&
            !e.dead &&
            e !== collector &&
            e.isUnit &&
            e.team === team &&
            Math.hypot(e.x - crate.x, e.y - crate.y) <= 100
          ) {
            e.veterancy = Math.min(3, (e.veterancy || 0) + 1);
          }
        }
        this.spawnParticles(crate.x, crate.y, 'spark', 12);
        this.spawnFloatingText(crate.x, crate.y - 22, 'VETERANCY PROMOTED!', '#38bdf8');
      } else if (type === 'reveal') {
        if (teamState) {
          teamState.revealAllTimer = 30.0;
        }
        if (this.map && typeof this.map.updateFog === 'function') {
          this.map.updateFog(this.entities, team, true);
        }
        this.spawnParticles(crate.x, crate.y, 'chrono', 12);
        this.spawnFloatingText(crate.x, crate.y - 22, 'SATELLITE MAP REVEAL!', '#38bdf8');
      } else if (type === 'freeUnit') {
        const faction = collector.faction || (teamState ? teamState.faction : 'allied');
        const unitId = faction === 'soviet' ? 'htnk' : 'mtnk';
        const spot = this._findClearUnitTile(crate.tx + 1, crate.ty, 'land');
        this.spawnUnit(unitId, spot.x, spot.y, team, { faction });
        this.spawnParticles(spot.x, spot.y, 'chrono', 12);
        this.spawnFloatingText(crate.x, crate.y - 22, 'FREE REINFORCEMENT TANK!', '#38bdf8');
      } else if (type === 'nukeTrap') {
        const radius = 140;
        for (let i = 0; i < this.entities.length; i++) {
          const e = this.entities[i];
          if (e && !e.dead && Math.hypot(e.x - crate.x, e.y - crate.y) <= radius) {
            const dmg = Math.min(180, Math.max(40, e.hp - 25));
            e.takeDamage(dmg, null, this);
          }
        }
        this.spawnParticles(crate.x, crate.y, 'explosion', 18);
        this.addDecal(crate.x, crate.y, 'crater', 24, 0);
        this.spawnFloatingText(crate.x, crate.y - 22, '☢️ BOOBY TRAP!', '#ef4444');
        if (window.RA.audio) window.RA.audio.playSfx('explosion');
      }

      return true;
    }

    checkDrownedLandUnits() {
      if (!this.map) return;
      const TILE_TYPES = window.RA.TILE_TYPES || { WATER: 2 };
      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (!e || e.dead || !e.isUnit || e.locomotion !== 'land') continue;
        const pos = this.map.worldToTile(e.x, e.y);
        const tile = this.map.getTile(pos.tx, pos.ty);
        if (tile && tile.type === TILE_TYPES.WATER && tile.demolishedBridge) {
          e.takeDamage(9999, null, this);
          this.spawnFloatingText(e.x, e.y - 14, 'DROWNED!', '#38bdf8');
        }
      }
    }

    spawnParticles(x, y, type = 'explosion', count = 8) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 20 + Math.random() * (type === 'explosion' ? 95 : 65);
        let color = '#f97316';
        let size = 4 + Math.random() * 5;
        let life = 0.35 + Math.random() * 0.35;

        if (type === 'spark') {
          color = i % 2 === 0 ? '#38bdf8' : '#fef08a';
          size = 2 + Math.random() * 3;
          life = 0.25 + Math.random() * 0.2;
        } else if (type === 'smoke') {
          color = '#64748b';
          size = 6 + Math.random() * 6;
          life = 0.6 + Math.random() * 0.4;
        } else if (type === 'blood') {
          color = '#dc2626';
          size = 3 + Math.random() * 3;
          life = 0.35;
        } else if (type === 'chrono') {
          color = i % 2 === 0 ? '#38bdf8' : '#e0f2fe';
          size = 4 + Math.random() * 5;
          life = 0.6;
        } else if (type === 'iron') {
          color = i % 2 === 0 ? '#ef4444' : '#fca5a5';
          size = 4 + Math.random() * 5;
          life = 0.65;
        } else {
          const colors = ['#f97316', '#facc15', '#ef4444', '#fb923c'];
          color = colors[i % colors.length];
        }

        this.particles.push(
          new window.RA.Particle({
            x: x + (Math.random() - 0.5) * 10,
            y: y + (Math.random() - 0.5) * 10,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size,
            color,
            life,
            type
          })
        );
      }

      if (type === 'explosion' && count >= 10) {
        this.particles.push(
          new window.RA.Particle({
            x,
            y,
            vx: 0,
            vy: 0,
            size: 6,
            radius: 6,
            maxRadius: 42,
            color: '#fb923c',
            life: 0.4,
            type: 'shockwave'
          })
        );
      }
    }

    _findClearUnitTile(targetTx, targetTy, locomotionOrIsInfantry = 'land') {
      const ts = getTileSize();
      const locomotion =
        typeof locomotionOrIsInfantry === 'string' ? locomotionOrIsInfantry : 'land';

      if (!this.map) {
        return {
          tx: targetTx,
          ty: targetTy,
          x: (targetTx + 0.5) * ts,
          y: (targetTy + 0.5) * ts
        };
      }

      if (locomotion === 'air') {
        const clampedTx = Math.max(1, Math.min(this.map.width - 2, targetTx));
        const clampedTy = Math.max(1, Math.min(this.map.height - 2, targetTy));
        return {
          tx: clampedTx,
          ty: clampedTy,
          x: (clampedTx + 0.5) * ts,
          y: (clampedTy + 0.5) * ts
        };
      }

      const maxRadius = locomotion === 'naval' ? 12 : 8;
      for (let r = 0; r <= maxRadius; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const cx = targetTx + dx;
            const cy = targetTy + dy;
            if (!this.map.isPassable(cx, cy, locomotion)) continue;
            const wx = (cx + 0.5) * ts;
            const wy = (cy + 0.5) * ts;
            const occupied = this.entities.some(
              (e) =>
                e &&
                !e.dead &&
                e.isUnit &&
                e.locomotion === locomotion &&
                Math.hypot(e.x - wx, e.y - wy) < ts * 0.45
            );
            if (!occupied) {
              return { tx: cx, ty: cy, x: wx, y: wy };
            }
          }
        }
      }

      const clampedTx = Math.max(1, Math.min(this.map.width - 2, targetTx));
      const clampedTy = Math.max(1, Math.min(this.map.height - 2, targetTy));
      return {
        tx: clampedTx,
        ty: clampedTy,
        x: (clampedTx + 0.5) * ts,
        y: (clampedTy + 0.5) * ts
      };
    }

    _findValidBuildingSpotNear(defId, centerTx, centerTy, team, ignoreAdjacency = false) {
      const DATA = getData();
      const def = DATA.BUILDINGS && DATA.BUILDINGS[defId];
      if (!def || !this.map) return null;
      const [w, h] = def.footprint || [2, 2];

      for (let r = 0; r <= 12; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const tx = centerTx + dx;
            const ty = centerTy + dy;
            if (ignoreAdjacency) {
              if (this._canPlaceRaw(tx, ty, w, h, def)) {
                return { tx, ty };
              }
            } else if (this.map.canPlaceBuilding(tx, ty, w, h, team, this.entities, null, def)) {
              return { tx, ty };
            }
          }
        }
      }
      return null;
    }

    _canPlaceRaw(tx, ty, w, h, def = null) {
      if (!this.map) return false;
      const T = window.RA.TILE_TYPES || { WATER: 2, BRIDGE: 3, ROCK: 4 };
      const waterOnly = Boolean(def && def.waterOnly);
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const cx = tx + dx;
          const cy = ty + dy;
          if (!this.map.inBounds(cx, cy)) return false;
          const tile = this.map.getTile(cx, cy);
          if (!tile) return false;
          if (waterOnly) {
            if (tile.type !== T.WATER) return false;
          } else {
            if (tile.type === T.WATER || tile.type === T.ROCK || tile.type === T.BRIDGE) {
              return false;
            }
          }
          if (tile.buildingId !== null && tile.buildingId !== undefined) return false;
        }
      }
      return true;
    }

    findNearestEnemy(x, y, team, maxRange = Infinity, attacker = null) {
      let best = null;
      let bestDist = maxRange;
      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (!e || e.dead || this.isFriendly(team, e.team)) continue;
        if (attacker && typeof attacker.canTarget === 'function' && !attacker.canTarget(e)) {
          continue;
        }
        const centerDist = Math.hypot(e.x - x, e.y - y);
        const edgeDist = Math.max(0, centerDist - (e.radius || 14) * 0.65);
        if (edgeDist <= bestDist) {
          bestDist = edgeDist;
          best = e;
        }
      }
      return best;
    }

    findNearestBuilding(x, y, team, defId = null) {
      let best = null;
      let bestDist = Infinity;
      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (!e || e.dead || !e.isBuilding || e.team !== team) continue;
        if (defId && e.defId !== defId) continue;
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < bestDist) {
          bestDist = d;
          best = e;
        }
      }
      return best;
    }

    // =========================================================================
    // ECONOMY, POWER & TECH TREE
    // =========================================================================

    addCredits(team, amount, isHarvested = false) {
      const t = this.teams[team];
      if (!t || amount <= 0) return;
      t.credits += amount;
      if (isHarvested && team === 'player') {
        this.stats.creditsHarvested += Math.round(amount);
      }
    }

    isLowPower(team = 'player') {
      const t = this.teams[team];
      return Boolean(t && (t.lowPower || (t.blackoutTimer && t.blackoutTimer > 0)));
    }

    recalculatePower(team = 'player') {
      const t = this.teams[team];
      if (!t) return;

      const wasLowPower = t.lowPower;
      const hadRadar = t.hasRadar;

      let produced = 0;
      let consumed = 0;
      let radarCount = 0;

      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (!e || e.dead || !e.isBuilding || e.team !== team) continue;
        const p = (e.def && e.def.power) || 0;
        if (p > 0) produced += p;
        else if (p < 0) consumed += Math.abs(p);

        if (e.defId === 'radar') radarCount++;
      }

      t.powerProduced = produced;
      t.powerConsumed = consumed;
      t.lowPower = Boolean(consumed > produced || (t.blackoutTimer && t.blackoutTimer > 0));
      t.hasRadar = radarCount > 0 && !t.lowPower;

      if (team === 'player' && this.state === 'playing' && this.elapsedTime > 0.5) {
        if (!wasLowPower && t.lowPower) {
          if (window.RA.audio) {
            window.RA.audio.playSfx('low_power');
            window.RA.audio.speak('Low power');
          }
          this.notifyEVA('WARNING: LOW POWER — DEFENSE & PRODUCTION SLOWED');
        } else if (!hadRadar && t.hasRadar) {
          if (window.RA.audio) {
            window.RA.audio.playSfx('radar_on');
          }
          this.notifyEVA('TACTICAL RADAR DOME ONLINE');
        }
      }
    }

    getOwnedBuildingTypes(team = 'player') {
      const set = new Set();
      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (e && !e.dead && e.isBuilding && e.team === team) {
          set.add(e.defId);
          if (e.defId === 'advpower') {
            set.add('power');
          }
        }
      }
      return set;
    }

    getAvailableTech(team = 'player') {
      const DATA = getData();
      const teamState = this.teams[team] || this.teams.player;
      const faction = teamState ? teamState.faction : 'allied';
      const owned = this.getOwnedBuildingTypes(team);

      const buildings = [];
      const defenses = [];
      const infantry = [];
      const vehicles = [];
      const aircraft = [];
      const naval = [];
      const superweapons = [];

      const bDict = DATA.BUILDINGS || {};
      for (const key of Object.keys(bDict)) {
        const b = bDict[key];
        if (!b || b.buildable === false) continue;
        if (b.faction && b.faction !== 'both' && b.faction !== faction) continue;
        const prereq = b.prereq || [];
        if (!prereq.every((req) => owned.has(req))) continue;

        if (b.category === 'defense') {
          defenses.push(b);
        } else {
          buildings.push(b);
        }
      }

      const uDict = DATA.UNITS || {};
      for (const key of Object.keys(uDict)) {
        const u = uDict[key];
        if (!u) continue;
        if (u.faction && u.faction !== 'both' && u.faction !== faction) continue;
        if (u.producer && !owned.has(u.producer)) continue;
        const prereq = u.prereq || [];
        if (!prereq.every((req) => owned.has(req))) continue;

        if (u.category === 'infantry') {
          infantry.push(u);
        } else {
          vehicles.push(u);
          if (u.category === 'aircraft' || u.locomotion === 'air') {
            aircraft.push(u);
          } else if (u.category === 'naval' || u.locomotion === 'naval') {
            naval.push(u);
          }
        }
      }

      const swDict = DATA.SUPERWEAPONS || {};
      for (const key of Object.keys(swDict)) {
        const sw = swDict[key];
        if (!sw) continue;
        if (sw.faction && sw.faction !== 'both' && sw.faction !== faction) continue;
        if (sw.buildingReq && !owned.has(sw.buildingReq)) continue;

        const swState = teamState.superweapons && teamState.superweapons[sw.id];
        superweapons.push(
          Object.assign(
            {},
            sw,
            swState
              ? {
                  ready: swState.ready,
                  progress: swState.progress,
                  timer: swState.timer,
                  unlocked: true
                }
              : { ready: false, progress: 0, timer: 0, unlocked: true }
          )
        );
      }

      return {
        buildings,
        structures: buildings,
        building: buildings,
        defenses,
        defense: defenses,
        infantry,
        vehicles,
        vehicle: vehicles,
        aircraft,
        naval,
        superweapons
      };
    }

    // =========================================================================
    // PRODUCTION QUEUE SYSTEM
    // =========================================================================

    _normalizeCategory(category, defId) {
      const DATA = getData();
      if (category) {
        const c = String(category).toLowerCase();
        if (c === 'building' || c === 'buildings' || c === 'structure' || c === 'structures') {
          return 'building';
        }
        if (c === 'defense' || c === 'defenses') return 'defense';
        if (c === 'infantry') return 'infantry';
        if (
          c === 'vehicle' ||
          c === 'vehicles' ||
          c === 'aircraft' ||
          c === 'air' ||
          c === 'naval'
        ) {
          return 'vehicle';
        }
      }
      if (defId) {
        if (DATA.BUILDINGS && DATA.BUILDINGS[defId]) {
          return DATA.BUILDINGS[defId].category === 'defense' ? 'defense' : 'building';
        }
        if (DATA.UNITS && DATA.UNITS[defId]) {
          return DATA.UNITS[defId].category === 'infantry' ? 'infantry' : 'vehicle';
        }
      }
      return 'building';
    }

    startProduction(category, defId, team = 'player') {
      const DATA = getData();

      // Support single-argument shorthand startProduction('power')
      if (
        (defId === undefined || this.teams[defId]) &&
        ((DATA.BUILDINGS && DATA.BUILDINGS[category]) || (DATA.UNITS && DATA.UNITS[category]))
      ) {
        if (this.teams[defId]) {
          team = defId;
        }
        defId = category;
        category = this._normalizeCategory(null, defId);
      }

      const normCat = this._normalizeCategory(category, defId);
      const teamState = this.teams[team];
      if (!teamState) return false;

      if (normCat === 'building' || normCat === 'defense') {
        const def = DATA.BUILDINGS && DATA.BUILDINGS[defId];
        if (!def || def.buildable === false) return false;

        const existing = teamState.queues[normCat];
        if (existing) {
          if (existing.defId === defId) {
            if (existing.paused) {
              existing.paused = false;
              return true;
            }
            return existing.readyToPlace ? true : false;
          }
          if (team === 'player') {
            this.notifyEVA('Unable to comply — building in progress');
          }
          return false;
        }

        teamState.queues[normCat] = {
          defId,
          def,
          category: normCat,
          progress: 0,
          paid: 0,
          totalCost: def.cost || 500,
          buildTime: Math.max(1, def.buildTime || 6),
          readyToPlace: false,
          paused: false
        };

        if (team === 'player' && window.RA.audio) {
          window.RA.audio.playSfx('click');
          window.RA.audio.speak('Building');
        }
        return true;
      }

      if (normCat === 'infantry' || normCat === 'vehicle') {
        const def = DATA.UNITS && DATA.UNITS[defId];
        if (!def) return false;

        const queue = teamState.queues[normCat];
        const existing = queue.find((item) => item.defId === defId);
        if (existing) {
          if (existing.paused) {
            existing.paused = false;
          } else {
            existing.count = (existing.count || 1) + 1;
          }
        } else {
          queue.push({
            defId,
            def,
            category: normCat,
            progress: 0,
            paid: 0,
            totalCost: def.cost || 200,
            buildTime: Math.max(1, def.buildTime || 4),
            count: 1,
            paused: false
          });
        }

        if (team === 'player' && window.RA.audio) {
          window.RA.audio.playSfx('click');
          window.RA.audio.speak('Training');
        }
        return true;
      }

      return false;
    }

    cancelProduction(category, defId, team = 'player') {
      const DATA = getData();
      if (
        (defId === undefined || this.teams[defId]) &&
        ((DATA.BUILDINGS && DATA.BUILDINGS[category]) || (DATA.UNITS && DATA.UNITS[category]))
      ) {
        if (this.teams[defId]) {
          team = defId;
        }
        defId = category;
        category = this._normalizeCategory(null, defId);
      }

      const normCat = this._normalizeCategory(category, defId);
      const teamState = this.teams[team];
      if (!teamState) return false;

      if (normCat === 'building' || normCat === 'defense') {
        const slot = teamState.queues[normCat];
        if (!slot) return false;
        if (defId && slot.defId !== defId) return false;

        if (slot.paid > 0) {
          teamState.credits += Math.round(slot.paid);
        }
        teamState.queues[normCat] = null;
        if (team === 'player' && window.RA.audio) {
          window.RA.audio.playSfx('click');
        }
        return true;
      }

      if (normCat === 'infantry' || normCat === 'vehicle') {
        const queue = teamState.queues[normCat];
        if (!Array.isArray(queue) || queue.length === 0) return false;

        const idx = defId ? queue.findIndex((q) => q.defId === defId) : 0;
        if (idx < 0) return false;

        const item = queue[idx];
        if (item.count > 1) {
          item.count -= 1;
        } else {
          if (item.paid > 0) {
            teamState.credits += Math.round(item.paid);
          }
          queue.splice(idx, 1);
        }
        if (team === 'player' && window.RA.audio) {
          window.RA.audio.playSfx('click');
        }
        return true;
      }

      return false;
    }

    placeBuilding(category, tx, ty, team = 'player') {
      const DATA = getData();
      const teamState = this.teams[team];
      if (!teamState || !this.map) return false;

      let normCat = this._normalizeCategory(category, category);
      let slot = teamState.queues[normCat];

      if (!slot) {
        if (
          teamState.queues.building &&
          (teamState.queues.building.defId === category || teamState.queues.building.readyToPlace)
        ) {
          normCat = 'building';
          slot = teamState.queues.building;
        } else if (
          teamState.queues.defense &&
          (teamState.queues.defense.defId === category || teamState.queues.defense.readyToPlace)
        ) {
          normCat = 'defense';
          slot = teamState.queues.defense;
        }
      }

      if (!slot || !slot.readyToPlace) {
        return false;
      }

      const defId = slot.defId;
      const def = slot.def || (DATA.BUILDINGS && DATA.BUILDINGS[defId]);
      if (!def) return false;

      const [w, h] = def.footprint || [2, 2];
      if (!this.map.canPlaceBuilding(tx, ty, w, h, team, this.entities, null, def)) {
        if (team === 'player') {
          this.notifyEVA('Cannot deploy here');
        }
        return false;
      }

      const building = this.spawnBuilding(defId, tx, ty, team, {
        faction: teamState.faction,
        constructionAnim: 1.0
      });

      teamState.queues[normCat] = null;

      if (team === 'player') {
        this.stats.buildingsBuilt += 1;
        if (window.RA.audio) {
          window.RA.audio.playSfx('build_place');
        }
      }

      if (this.map && typeof this.map.revealCircle === 'function') {
        this.map.revealCircle(building.x, building.y, building.sight || 7);
      }

      // When a Refinery is placed, automatically spawn a free Harvester next to it
      if (defId === 'refinery' || def.givesHarvester) {
        const spawnSpot = this._findClearUnitTile(tx + Math.floor(w / 2), ty + h, 'land');
        const harv = this.spawnUnit('harvester', spawnSpot.x, spawnSpot.y, team, {
          faction: teamState.faction,
          state: 'harvest'
        });
        if (harv && team === 'player') {
          this.spawnFloatingText(harv.x, harv.y - 18, 'FREE HARVESTER', '#38bdf8');
        }
      }

      this.recalculatePower(team);
      return building;
    }

    _updateTeamProduction(team, dt) {
      const DATA = getData();
      const teamState = this.teams[team];
      if (!teamState) return;

      const speedFactor = this.isLowPower(team) ? 0.5 : 1.0;

      // 1. Update Building & Defense Single-Slot Queues
      const structCategories = ['building', 'defense'];
      for (let i = 0; i < structCategories.length; i++) {
        const cat = structCategories[i];
        const slot = teamState.queues[cat];
        if (!slot || slot.paused || slot.readyToPlace) continue;

        const def = slot.def || (DATA.BUILDINGS && DATA.BUILDINGS[slot.defId]) || {};
        const buildTime = Math.max(0.5, slot.buildTime || def.buildTime || 6);
        const totalCost = slot.totalCost !== undefined ? slot.totalCost : (def.cost || 500);
        const factoryMult = this.getFactoryMultiplier(team, cat);

        const desiredProgressDelta = (dt * speedFactor * factoryMult) / buildTime;
        const remainingProgress = Math.max(0, 1 - slot.progress);
        const actualProgressDelta = Math.min(remainingProgress, desiredProgressDelta);
        const costForStep = actualProgressDelta * totalCost;

        if (teamState.credits <= 0 && costForStep > 0) {
          if (team === 'player' && this.insufficientFundsCooldown <= 0) {
            this.insufficientFundsCooldown = 8.0;
            this.notifyEVA('INSUFFICIENT FUNDS — PRODUCTION PAUSED', 'Insufficient funds');
          }
          continue;
        }

        const affordableRatio =
          teamState.credits >= costForStep ? 1 : teamState.credits / costForStep;
        const appliedDelta = actualProgressDelta * affordableRatio;
        const appliedCost = costForStep * affordableRatio;

        teamState.credits = Math.max(0, teamState.credits - appliedCost);
        slot.paid = (slot.paid || 0) + appliedCost;
        slot.progress = Math.min(1, slot.progress + appliedDelta);

        if (slot.progress >= 0.9999) {
          slot.progress = 1;
          slot.readyToPlace = true;
          if (team === 'player') {
            this.notifyEVA(
              (def.name || slot.defId).toUpperCase() + ' READY FOR PLACEMENT',
              'Construction complete'
            );
            if (typeof this.onProductionComplete === 'function') {
              this.onProductionComplete(cat, slot.defId);
            }
          }
        }
      }

      // 2. Update Infantry & Vehicle/Air/Naval Array Queues
      const unitCategories = ['infantry', 'vehicle'];
      for (let i = 0; i < unitCategories.length; i++) {
        const cat = unitCategories[i];
        const queue = teamState.queues[cat];
        if (!Array.isArray(queue) || queue.length === 0) continue;

        const item = queue[0];
        if (!item || item.paused) continue;

        const def = item.def || (DATA.UNITS && DATA.UNITS[item.defId]) || {};
        const producerType =
          def.producer ||
          (def.locomotion === 'air'
            ? 'helipad'
            : def.locomotion === 'naval'
            ? 'syrd'
            : cat === 'infantry'
            ? 'barracks'
            : 'weap');
        const producer =
          this.getPrimaryBuilding(team, producerType) ||
          this.findNearestBuilding(0, 0, team, producerType);
        if (!producer) {
          continue;
        }

        const buildTime = Math.max(0.5, item.buildTime || def.buildTime || 4);
        const totalCost = item.totalCost !== undefined ? item.totalCost : (def.cost || 200);
        const multCategory =
          def.locomotion === 'air' || def.category === 'aircraft'
            ? 'aircraft'
            : def.locomotion === 'naval' || def.category === 'naval'
            ? 'naval'
            : cat;
        const factoryMult = this.getFactoryMultiplier(team, multCategory);

        const desiredProgressDelta = (dt * speedFactor * factoryMult) / buildTime;
        const remainingProgress = Math.max(0, 1 - item.progress);
        const actualProgressDelta = Math.min(remainingProgress, desiredProgressDelta);
        const costForStep = actualProgressDelta * totalCost;

        if (teamState.credits <= 0 && costForStep > 0) {
          if (team === 'player' && this.insufficientFundsCooldown <= 0) {
            this.insufficientFundsCooldown = 8.0;
            this.notifyEVA('INSUFFICIENT FUNDS — TRAINING PAUSED', 'Insufficient funds');
          }
          continue;
        }

        const affordableRatio =
          teamState.credits >= costForStep ? 1 : teamState.credits / costForStep;
        const appliedDelta = actualProgressDelta * affordableRatio;
        const appliedCost = costForStep * affordableRatio;

        teamState.credits = Math.max(0, teamState.credits - appliedCost);
        item.paid = (item.paid || 0) + appliedCost;
        item.progress = Math.min(1, item.progress + appliedDelta);

        if (item.progress >= 0.9999) {
          this._completeUnitTraining(team, cat, item, producer);
          item.count = (item.count || 1) - 1;
          if (item.count <= 0) {
            queue.shift();
          } else {
            item.progress = 0;
            item.paid = 0;
          }
        }
      }
    }

    _completeUnitTraining(team, category, item, producer) {
      const DATA = getData();
      const teamState = this.teams[team];
      const ts = getTileSize();
      const def = item.def || (DATA.UNITS && DATA.UNITS[item.defId]) || {};
      const producerType =
        def.producer || (producer && producer.defId) || (category === 'infantry' ? 'barracks' : 'weap');
      const activeProducer = this.getPrimaryBuilding(team, producerType) || producer;
      if (!activeProducer) return null;

      const locomotion =
        def.locomotion ||
        (def.category === 'aircraft' ? 'air' : def.category === 'naval' ? 'naval' : 'land');

      let spawnX = activeProducer.x;
      let spawnY = activeProducer.y;

      if (locomotion === 'air') {
        spawnX = activeProducer.x;
        spawnY = activeProducer.y;
      } else {
        const exitTx = activeProducer.tx + Math.floor(activeProducer.w / 2);
        const exitTy = activeProducer.ty + activeProducer.h;
        const spawnSpot = this._findClearUnitTile(exitTx, exitTy, locomotion);
        spawnX = spawnSpot.x;
        spawnY = spawnSpot.y;
      }

      const unit = this.spawnUnit(item.defId, spawnX, spawnY, team, {
        faction: teamState ? teamState.faction : 'allied'
      });

      if (unit) {
        if (team === 'player') {
          this.stats.unitsBuilt += 1;
          this.notifyEVA(unit.name.toUpperCase() + ' READY', 'Unit ready');
        }

        if (unit.defId === 'harvester') {
          unit.state = 'harvest';
        } else if (activeProducer.rallyPoint && this.map && locomotion !== 'air') {
          const rallySpot = this._findClearUnitTile(
            Math.floor(activeProducer.rallyPoint.x / ts),
            Math.floor(activeProducer.rallyPoint.y / ts),
            unit.locomotion
          );
          unit.state = 'move';
          unit.targetPos = { x: rallySpot.x, y: rallySpot.y };
          unit.path = this.map.findPath(
            unit.x,
            unit.y,
            rallySpot.x,
            rallySpot.y,
            unit.locomotion
          );
        }
      }

      return unit;
    }

    // =========================================================================
    // SUPERWEAPONS SYSTEM
    // =========================================================================

    _updateSuperweapons(team, dt) {
      const teamState = this.teams[team];
      if (!teamState || !teamState.superweapons) return;

      const owned = this.getOwnedBuildingTypes(team);
      const speedMult = this.isLowPower(team) ? 0.35 : 1.0;

      for (const swId of Object.keys(teamState.superweapons)) {
        const sw = teamState.superweapons[swId];
        if (!sw) continue;

        const factionOk = !sw.faction || sw.faction === 'both' || sw.faction === teamState.faction;
        const reqOk = owned.has(sw.buildingReq || 'radar');
        sw.unlocked = Boolean(factionOk && reqOk);

        if (!sw.unlocked) {
          sw.ready = false;
          continue;
        }

        if (!sw.ready) {
          sw.timer = Math.min(sw.rechargeTime, (sw.timer || 0) + dt * speedMult);
          sw.progress = Math.min(1, sw.timer / Math.max(1, sw.rechargeTime));
          if (sw.progress >= 1) {
            sw.progress = 1;
            sw.ready = true;
            if (team === 'player') {
              this.notifyEVA(sw.name.toUpperCase() + ' READY');
            }
          }
        }
      }
    }

    activateSuperweapon(swId, worldX, worldY, selectedUnits = [], team = 'player') {
      const teamState = this.teams[team] || this.teams.player;
      if (!teamState) return false;

      const sw = teamState.superweapons && teamState.superweapons[swId];
      if (sw) {
        sw.ready = false;
        sw.progress = 0;
        sw.timer = 0;
      }

      this.addRadarPing(worldX, worldY, '#facc15', swId.toUpperCase());

      if (swId === 'nuke') {
        if (window.RA.audio) {
          window.RA.audio.playSfx('nuke_siren');
          window.RA.audio.speak('Nuclear weapon launched');
        }
        this.notifyEVA('WARNING: NUCLEAR STRIKE LAUNCHED!', 'Nuclear weapon launched');

        const silo = this.findNearestBuilding(worldX, worldY, team, 'silo');
        const startX = silo ? silo.x : worldX;
        const startY = silo ? silo.y : Math.max(0, worldY - 500);

        this.spawnProjectile({
          type: 'nuke',
          team,
          faction: teamState.faction,
          startX,
          startY,
          targetX: worldX,
          targetY: worldY,
          speed: 550,
          damage: 950,
          splash: 260
        });

        this.detonateNukeAt(worldX, worldY, team, 0.55);
        return true;
      }

      if (swId === 'ironcurtain') {
        if (window.RA.audio) {
          window.RA.audio.playSfx('iron_curtain');
        }
        this.notifyEVA('IRON CURTAIN ACTIVATED — UNITS INVULNERABLE');

        const radius = (sw && sw.radius) || 180;
        const targets = [];
        for (let i = 0; i < this.entities.length; i++) {
          const e = this.entities[i];
          if (!e || e.dead || !e.isUnit || e.team !== team) continue;
          if (Math.hypot(e.x - worldX, e.y - worldY) <= radius) {
            targets.push(e);
          }
        }

        if (targets.length === 0 && Array.isArray(selectedUnits)) {
          for (let i = 0; i < selectedUnits.length; i++) {
            const u = selectedUnits[i];
            if (u && !u.dead && u.isUnit && u.team === team) {
              targets.push(u);
            }
          }
        }

        for (let i = 0; i < targets.length; i++) {
          const u = targets[i];
          u.ironCurtainTimer = 20.0;
          this.spawnParticles(u.x, u.y, 'iron', 10);
        }

        this.spawnParticles(worldX, worldY, 'iron', 16);
        this.particles.push(
          new window.RA.Particle({
            x: worldX,
            y: worldY,
            size: 10,
            radius: 10,
            maxRadius: radius,
            color: '#ef4444',
            life: 0.65,
            type: 'shockwave'
          })
        );
        this.spawnFloatingText(worldX, worldY - 24, 'IRON CURTAIN (20s)', '#ef4444');
        return true;
      }

      if (swId === 'chronosphere') {
        if (window.RA.audio) {
          window.RA.audio.playSfx('chrono');
        }
        this.notifyEVA('CHRONOSPHERE ACTIVATED — TELEPORTING ARMOR');

        let unitsToTeleport = [];
        if (Array.isArray(selectedUnits) && selectedUnits.length > 0) {
          unitsToTeleport = selectedUnits.filter((u) => u && !u.dead && u.isUnit && u.team === team);
        }
        if (unitsToTeleport.length === 0) {
          unitsToTeleport = this.getSelectedUnits(team);
        }
        if (unitsToTeleport.length === 0) {
          unitsToTeleport = this.entities
            .filter(
              (e) => e && !e.dead && e.isUnit && e.team === team && e.defId !== 'harvester'
            )
            .slice(0, 6);
        }

        const ts = getTileSize();
        const destTile = this.map
          ? this.map.worldToTile(worldX, worldY)
          : { tx: Math.floor(worldX / ts), ty: Math.floor(worldY / ts) };

        for (let i = 0; i < unitsToTeleport.length; i++) {
          const u = unitsToTeleport[i];
          this.spawnParticles(u.x, u.y, 'chrono', 12);
          const ox = (i % 3) - 1;
          const oy = Math.floor(i / 3) - 1;
          const spot = this._findClearUnitTile(destTile.tx + ox, destTile.ty + oy, u.locomotion);
          u.x = spot.x;
          u.y = spot.y;
          u.path = [];
          u.state = 'idle';
          this.spawnParticles(u.x, u.y, 'chrono', 12);
        }

        this.particles.push(
          new window.RA.Particle({
            x: worldX,
            y: worldY,
            size: 10,
            radius: 10,
            maxRadius: 160,
            color: '#38bdf8',
            life: 0.65,
            type: 'shockwave'
          })
        );
        if (this.map && typeof this.map.revealCircle === 'function') {
          this.map.revealCircle(worldX, worldY, 8);
        }
        this.spawnFloatingText(worldX, worldY - 24, 'CHRONO SHIFT!', '#38bdf8');
        return true;
      }

      return false;
    }

    detonateNukeAt(worldX, worldY, team = 'player', damageScale = 1.0) {
      const radius = 260;
      const maxDamage = 850 * damageScale;

      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (!e || e.dead || this.isFriendly(team, e.team)) continue;
        const dist = Math.hypot(e.x - worldX, e.y - worldY);
        if (dist <= radius) {
          const falloff = Math.max(0.3, 1 - dist / (radius * 1.15));
          e.takeDamage(maxDamage * falloff, null, this);
        }
      }

      // Check bridge demolition within blast radius
      if (this.map && typeof this.map.damageBridgeTile === 'function') {
        const center = this.map.worldToTile(worldX, worldY);
        const TILE_TYPES = window.RA.TILE_TYPES || { BRIDGE: 3 };
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const tile = this.map.getTile(center.tx + dx, center.ty + dy);
            if (tile && tile.type === TILE_TYPES.BRIDGE) {
              this.map.damageBridgeTile(center.tx + dx, center.ty + dy, 999);
            }
          }
        }
        this.checkDrownedLandUnits();
      }

      this.addDecal(worldX, worldY, 'nuke_crater', 68, 0);

      this.spawnParticles(worldX, worldY, 'explosion', 36);
      this.spawnParticles(worldX, worldY, 'smoke', 20);
      this.particles.push(
        new window.RA.Particle({
          x: worldX,
          y: worldY,
          size: 16,
          radius: 16,
          maxRadius: radius,
          color: '#facc15',
          life: 0.85,
          type: 'shockwave'
        }),
        new window.RA.Particle({
          x: worldX,
          y: worldY,
          size: 24,
          radius: 24,
          maxRadius: radius * 0.75,
          color: '#ef4444',
          life: 0.65,
          type: 'shockwave'
        })
      );

      this.spawnFloatingText(worldX, worldY - 35, '☢️ ATOMIC DETONATION!', '#facc15', 16);
      if (window.RA.audio) {
        window.RA.audio.playSfx('nuke_blast');
      }
      if (this.map && typeof this.map.revealCircle === 'function') {
        this.map.revealCircle(worldX, worldY, 10);
      }
    }

    // =========================================================================
    // STANCES, WAYPOINT QUEUES, PATROL & TACTICAL ORDERS
    // =========================================================================

    setUnitStance(unitsOrStance, stanceArg) {
      let units = unitsOrStance;
      let stance = stanceArg;
      if (typeof unitsOrStance === 'string' && stanceArg === undefined) {
        stance = unitsOrStance;
        units = this.getSelectedUnits('player');
      }
      const list = Array.isArray(units)
        ? units.filter((u) => u && !u.dead && u.isUnit)
        : this.getSelectedUnits('player');
      if (list.length === 0 || !stance) return false;

      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        u.stance = stance;
        u.guardOrigin = { x: u.x, y: u.y };
        if (stance === 'holdFire' && !u.explicitAttackOrder) {
          u.targetEntity = null;
          u.target = null;
          if (u.state === 'attack') {
            u.state = 'idle';
            u.path = [];
          }
        }
      }
      return true;
    }

    _applySingleUnitOrder(u, orderType, destX, destY, targetEntity = null) {
      if (!u || u.dead || !this.map) return;
      const ts = getTileSize();

      if (orderType === 'stop') {
        u.state = 'idle';
        u.path = [];
        u.commandQueue = [];
        u.targetEntity = null;
        u.target = null;
        u.targetPos = null;
        u.attackMovePos = null;
        u.explicitAttackOrder = false;
        return;
      }

      if (orderType === 'deploy') {
        u.deploy(this, destX !== undefined && destY !== undefined ? { x: destX, y: destY } : null);
        return;
      }

      if (orderType === 'chronoBlink') {
        if (typeof u.chronoBlink === 'function') {
          u.chronoBlink(destX, destY, this);
        }
        return;
      }

      if (orderType === 'patrol') {
        u.state = 'patrol';
        u.patrolA = { x: u.x, y: u.y };
        u.patrolB = { x: destX, y: destY };
        u.patrolForward = true;
        u.targetEntity = null;
        u.target = null;
        u.path = this.map.findPath(u.x, u.y, destX, destY, u.locomotion);
        return;
      }

      if (orderType === 'repairBridge') {
        if (u.defId === 'engineer') {
          const tileCoord = this.map.worldToTile(destX, destY);
          u.state = 'repairBridge';
          u.bridgeTarget = { tx: tileCoord.tx, ty: tileCoord.ty, x: destX, y: destY };
          u.targetPos = { x: destX, y: destY };
          u.path = this.map.findPath(u.x, u.y, destX, destY, u.locomotion);
        }
        return;
      }

      if (orderType === 'infiltrate') {
        if (targetEntity && !targetEntity.dead && targetEntity.isBuilding) {
          u.state = 'infiltrate';
          u.targetEntity = targetEntity;
          u.target = targetEntity;
          u.path = this.map.findPath(u.x, u.y, targetEntity.x, targetEntity.y, u.locomotion, targetEntity.id);
        }
        return;
      }

      if (orderType === 'capture' || orderType === 'repair') {
        if (!targetEntity || targetEntity.dead || !targetEntity.isBuilding) return;
        if (u.defId === 'spy' || u.defId === 'thf') {
          u.state = 'infiltrate';
          u.targetEntity = targetEntity;
          u.target = targetEntity;
          u.path = this.map.findPath(u.x, u.y, targetEntity.x, targetEntity.y, u.locomotion, targetEntity.id);
        } else if (u.defId === 'engineer') {
          u.state = 'capture';
          u.targetEntity = targetEntity;
          u.target = targetEntity;
          u.path = this.map.findPath(u.x, u.y, targetEntity.x, targetEntity.y, u.locomotion, targetEntity.id);
        }
        return;
      }

      if (orderType === 'harvest') {
        const clickedTile = this.map.worldToTile(destX, destY);
        const oreSpot = this.map.findNearestOre(clickedTile.tx, clickedTile.ty, 12) || {
          tx: clickedTile.tx,
          ty: clickedTile.ty,
          x: destX,
          y: destY
        };
        if (u.defId === 'harvester') {
          u.state = 'harvest';
          u.oreTile = oreSpot;
          u.path = this.map.findPath(u.x, u.y, oreSpot.x, oreSpot.y, u.locomotion);
        }
        return;
      }

      if (orderType === 'returnOre') {
        if (u.defId === 'harvester') {
          u.state = 'returnOre';
          u.oreTile = null;
          const ref =
            targetEntity && targetEntity.defId === 'refinery'
              ? targetEntity
              : this.findNearestBuilding(u.x, u.y, u.team, 'refinery');
          if (ref) {
            const dockX = ref.x;
            const dockY = ref.y + (ref.h / 2 + 0.4) * ts;
            u.path = this.map.findPath(u.x, u.y, dockX, dockY, u.locomotion, ref.id);
          }
        }
        return;
      }

      if (orderType === 'attack' && targetEntity && !targetEntity.dead) {
        if (u.defId === 'engineer' && targetEntity.isBuilding) {
          u.state = 'capture';
          u.targetEntity = targetEntity;
          u.target = targetEntity;
          u.path = this.map.findPath(u.x, u.y, targetEntity.x, targetEntity.y, u.locomotion, targetEntity.id);
        } else if ((u.defId === 'spy' || u.defId === 'thf') && targetEntity.isBuilding) {
          u.state = 'infiltrate';
          u.targetEntity = targetEntity;
          u.target = targetEntity;
          u.path = this.map.findPath(u.x, u.y, targetEntity.x, targetEntity.y, u.locomotion, targetEntity.id);
        } else if ((u.def.range || 0) > 0) {
          if (targetEntity.defId === 'spy') {
            targetEntity.disguised = false;
          }
          u.state = 'attack';
          u.targetEntity = targetEntity;
          u.target = targetEntity;
          u.explicitAttackOrder = true;
          u.attackMovePos = null;
          if (u.edgeDistanceTo(targetEntity) > u.def.range) {
            u.path = this.map.findPath(
              u.x,
              u.y,
              targetEntity.x,
              targetEntity.y,
              u.locomotion,
              targetEntity.isBuilding ? targetEntity.id : null
            );
          } else {
            u.path = [];
          }
        } else {
          u.state = 'move';
          u.targetPos = { x: targetEntity.x, y: targetEntity.y };
          u.path = this.map.findPath(u.x, u.y, targetEntity.x, targetEntity.y, u.locomotion, targetEntity.id);
        }
        return;
      }

      if (orderType === 'attackMove' && (u.def.range || 0) > 0) {
        u.state = 'attackMove';
        u.attackMovePos = { x: destX, y: destY };
        u.targetPos = { x: destX, y: destY };
        u.guardOrigin = { x: destX, y: destY };
        u.targetEntity = null;
        u.target = null;
        u.explicitAttackOrder = false;
        u.path = this.map.findPath(u.x, u.y, destX, destY, u.locomotion);
        return;
      }

      // Check if an Engineer was ordered to move onto a Bridge Repair Hut or demolished bridge
      if (u.defId === 'engineer' && this.map) {
        const tc = this.map.worldToTile(destX, destY);
        const tile = this.map.getTile(tc.tx, tc.ty);
        if (tile && (tile.hasBridgeHut || tile.demolishedBridge)) {
          u.state = 'repairBridge';
          u.bridgeTarget = { tx: tc.tx, ty: tc.ty, x: destX, y: destY };
          u.targetPos = { x: destX, y: destY };
          u.path = this.map.findPath(u.x, u.y, destX, destY, u.locomotion);
          return;
        }
      }

      // Check if Spy/Thief was ordered to move onto an enemy building
      if ((u.defId === 'spy' || u.defId === 'thf') && targetEntity && targetEntity.isBuilding && !this.isFriendly(u, targetEntity)) {
        u.state = 'infiltrate';
        u.targetEntity = targetEntity;
        u.target = targetEntity;
        u.path = this.map.findPath(u.x, u.y, targetEntity.x, targetEntity.y, u.locomotion, targetEntity.id);
        return;
      }

      u.state = 'move';
      u.targetPos = { x: destX, y: destY };
      u.guardOrigin = { x: destX, y: destY };
      u.attackMovePos = null;
      u.targetEntity = null;
      u.target = null;
      u.explicitAttackOrder = false;
      u.path = this.map.findPath(u.x, u.y, destX, destY, u.locomotion);
    }

    issueOrder(selectedUnits, orderType, worldX, worldY, targetEntity = null, queueOrder = false) {
      const units = Array.isArray(selectedUnits)
        ? selectedUnits.filter((u) => u && !u.dead && u.isUnit)
        : this.getSelectedUnits('player');

      if (units.length === 0 || !this.map) return false;
      const ts = getTileSize();

      if (orderType === 'stop') {
        for (let i = 0; i < units.length; i++) {
          this._applySingleUnitOrder(units[i], 'stop', 0, 0, null);
        }
        return true;
      }

      if (orderType === 'scatter') {
        for (let i = 0; i < units.length; i++) {
          const u = units[i];
          const angle = (i / Math.max(1, units.length)) * Math.PI * 2 + Math.random() * 0.6;
          const sx = u.x + Math.cos(angle) * ts * 2.2;
          const sy = u.y + Math.sin(angle) * ts * 2.2;
          u.commandQueue = [];
          this._applySingleUnitOrder(u, 'move', sx, sy, null);
        }
        if (window.RA.audio) window.RA.audio.playSfx('move');
        return true;
      }

      if (orderType === 'deploy') {
        return this.deploySelected(
          units,
          worldX !== undefined && worldY !== undefined ? { x: worldX, y: worldY } : null
        );
      }

      const cols = Math.max(1, Math.ceil(Math.sqrt(units.length)));
      const spacing = ts * 0.9;
      const isPointOrder =
        orderType === 'attack' ||
        orderType === 'capture' ||
        orderType === 'repair' ||
        orderType === 'infiltrate' ||
        orderType === 'returnOre' ||
        orderType === 'repairBridge';

      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        let destX = worldX !== undefined ? worldX : u.x;
        let destY = worldY !== undefined ? worldY : u.y;

        if (!isPointOrder && units.length > 1) {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const offsetX = (col - (cols - 1) / 2) * spacing;
          const offsetY = (row - (Math.ceil(units.length / cols) - 1) / 2) * spacing;
          destX = Math.max(ts * 0.5, Math.min(this.map.pixelWidth - ts * 0.5, destX + offsetX));
          destY = Math.max(ts * 0.5, Math.min(this.map.pixelHeight - ts * 0.5, destY + offsetY));
        } else if (!isPointOrder) {
          destX = Math.max(ts * 0.5, Math.min(this.map.pixelWidth - ts * 0.5, destX));
          destY = Math.max(ts * 0.5, Math.min(this.map.pixelHeight - ts * 0.5, destY));
        }

        if (queueOrder) {
          if (!Array.isArray(u.commandQueue)) {
            u.commandQueue = [];
          }
          // If unit is completely idle with no active path or queue, start the 1st Shift waypoint immediately
          // and keep subsequent Shift waypoints in commandQueue
          if (
            u.state === 'idle' &&
            (!u.path || u.path.length === 0) &&
            u.commandQueue.length === 0
          ) {
            this._applySingleUnitOrder(u, orderType, destX, destY, targetEntity);
          } else {
            u.commandQueue.push({
              orderType,
              worldX: destX,
              worldY: destY,
              x: destX,
              y: destY,
              targetEntity: targetEntity || null
            });
          }
        } else {
          u.commandQueue = [];
          this._applySingleUnitOrder(u, orderType, destX, destY, targetEntity);
        }
      }

      if (this.renderer && typeof this.renderer.addMovePulse === 'function') {
        const px = targetEntity ? targetEntity.x : worldX;
        const py = targetEntity ? targetEntity.y : worldY;
        if (px !== undefined && py !== undefined) {
          const pulseColor =
            orderType === 'attack' || orderType === 'attackMove'
              ? '#ef4444'
              : orderType === 'patrol'
              ? '#38bdf8'
              : '#22c55e';
          this.renderer.addMovePulse(px, py, pulseColor);
        }
      }
      if (window.RA.audio) {
        window.RA.audio.playSfx('move');
      }
      return true;
    }

    deploySelected(units, targetWorldPos = null) {
      const list =
        Array.isArray(units) && units.length > 0 ? units : this.getSelectedUnits('player');
      let deployedAny = false;
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        if (!u || u.dead) continue;
        if (u.defId === 'mcv' || u.defId === 'qtnk' || u.defId === 'ctnk') {
          const res = u.deploy(this, targetWorldPos);
          if (res) deployedAny = true;
        }
      }
      return deployedAny;
    }

    toggleRepair(building) {
      if (!building || building.dead || !building.isBuilding) return false;
      if (building.hp >= building.maxHp) {
        building.isRepairing = false;
        return false;
      }
      building.isRepairing = !building.isRepairing;
      if (building.isRepairing && window.RA.audio) {
        window.RA.audio.playSfx('repair');
        window.RA.audio.speak('Repairing');
      }
      return building.isRepairing;
    }

    sellBuilding(building) {
      if (!building || building.dead || !building.isBuilding) return 0;

      const cost = (building.def && building.def.cost) || 1000;
      const refund = Math.round(cost * 0.5);
      this.addCredits(building.team, refund, false);

      this._clearBuildingFromMap(building);

      building.dead = true;
      building.selected = false;

      // Spawn 1 infantry survivor for non-wall buildings
      if (!building.isWall && building.locomotion !== 'naval' && !(building.def && building.def.waterOnly)) {
        const survivorSpot = this._findClearUnitTile(
          building.tx + Math.floor(building.w / 2),
          building.ty + Math.floor(building.h / 2),
          'land'
        );
        this.spawnUnit('rifle', survivorSpot.x, survivorSpot.y, building.team, {
          faction: building.faction
        });
      }

      this.spawnFloatingText(building.x, building.y - 20, '+$' + refund, '#facc15');
      this.spawnParticles(building.x, building.y, 'smoke', 12);

      this.recalculatePower(building.team);

      if (building.team === 'player' && window.RA.audio) {
        window.RA.audio.playSfx('sell');
        window.RA.audio.speak('Structure sold');
      }

      return refund;
    }

    _clearBuildingFromMap(building) {
      if (!this.map || !building) return;
      if (typeof this.map.clearBuildingFootprint === 'function') {
        this.map.clearBuildingFootprint(
          building.tx,
          building.ty,
          building.w,
          building.h,
          building.id
        );
      }
      for (let cy = building.ty; cy < building.ty + building.h; cy++) {
        for (let cx = building.tx; cx < building.tx + building.w; cx++) {
          const tile = this.map.getTile(cx, cy);
          if (tile && (!tile.buildingId || tile.buildingId === building.id)) {
            tile.wallDefId = null;
            tile.isWall = false;
          }
        }
      }
    }

    // =========================================================================
    // SAVE / LOAD SERIALIZATION (QUICKSAVE F5 / QUICKLOAD F9 / JSON EXPORT)
    // =========================================================================

    serializeState() {
      const serializeQueueItem = (q) => {
        if (!q) return null;
        return {
          defId: q.defId,
          category: q.category,
          progress: q.progress || 0,
          paid: q.paid || 0,
          totalCost: q.totalCost || 500,
          buildTime: q.buildTime || 6,
          count: q.count || 1,
          readyToPlace: Boolean(q.readyToPlace),
          paused: Boolean(q.paused)
        };
      };

      const teamsSnap = {};
      for (const teamId of Object.keys(this.teams)) {
        const t = this.teams[teamId];
        if (!t) continue;
        teamsSnap[teamId] = {
          id: t.id,
          faction: t.faction,
          color: t.color,
          doctrine: t.doctrine || 'balanced',
          credits: t.credits,
          powerProduced: t.powerProduced || 0,
          powerConsumed: t.powerConsumed || 0,
          lowPower: Boolean(t.lowPower),
          hasRadar: Boolean(t.hasRadar),
          blackoutTimer: t.blackoutTimer || 0,
          revealAllTimer: t.revealAllTimer || 0,
          queues: {
            building: serializeQueueItem(t.queues.building),
            defense: serializeQueueItem(t.queues.defense),
            infantry: Array.isArray(t.queues.infantry)
              ? t.queues.infantry.map(serializeQueueItem)
              : [],
            vehicle: Array.isArray(t.queues.vehicle)
              ? t.queues.vehicle.map(serializeQueueItem)
              : []
          },
          superweapons: JSON.parse(JSON.stringify(t.superweapons || {}))
        };
      }

      const entitiesSnap = [];
      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (!e || e.dead) continue;
        if (e.isBuilding) {
          entitiesSnap.push({
            id: e.id,
            isBuilding: true,
            isUnit: false,
            team: e.team,
            faction: e.faction,
            defId: e.defId,
            tx: e.tx,
            ty: e.ty,
            w: e.w,
            h: e.h,
            x: e.x,
            y: e.y,
            hp: e.hp,
            maxHp: e.maxHp,
            selected: Boolean(e.selected),
            isPrimary: Boolean(e.isPrimary),
            isRepairing: Boolean(e.isRepairing),
            turretAngle: e.turretAngle,
            attackCooldown: e.attackCooldown || 0,
            rallyPoint: e.rallyPoint ? { x: e.rallyPoint.x, y: e.rallyPoint.y } : null,
            constructionAnim: e.constructionAnim || 0,
            targetEntityId: e.targetEntity ? e.targetEntity.id : null
          });
        } else if (e.isUnit) {
          entitiesSnap.push({
            id: e.id,
            isBuilding: false,
            isUnit: true,
            team: e.team,
            faction: e.faction,
            defId: e.defId,
            category: e.category,
            locomotion: e.locomotion,
            altitude: e.altitude,
            ammo: e.ammo,
            maxAmmo: e.maxAmmo,
            submerged: Boolean(e.submerged),
            uncloakTimer: e.uncloakTimer || 0,
            disguised: Boolean(e.disguised),
            x: e.x,
            y: e.y,
            hp: e.hp,
            maxHp: e.maxHp,
            selected: Boolean(e.selected),
            angle: e.angle,
            turretAngle: e.turretAngle,
            speed: e.speed,
            rawSpeed: true,
            state: e.state,
            stance: e.stance || 'guard',
            guardOrigin: e.guardOrigin ? { x: e.guardOrigin.x, y: e.guardOrigin.y } : null,
            path: Array.isArray(e.path) ? e.path.map((p) => ({ x: p.x, y: p.y })) : [],
            commandQueue: Array.isArray(e.commandQueue)
              ? e.commandQueue.map((c) => ({
                  orderType: c.orderType,
                  worldX: c.worldX,
                  worldY: c.worldY,
                  x: c.x,
                  y: c.y,
                  targetEntityId: c.targetEntity ? c.targetEntity.id : null
                }))
              : [],
            patrolA: e.patrolA ? { x: e.patrolA.x, y: e.patrolA.y } : null,
            patrolB: e.patrolB ? { x: e.patrolB.x, y: e.patrolB.y } : null,
            patrolForward: Boolean(e.patrolForward),
            targetPos: e.targetPos ? { x: e.targetPos.x, y: e.targetPos.y } : null,
            attackMovePos: e.attackMovePos
              ? { x: e.attackMovePos.x, y: e.attackMovePos.y }
              : null,
            targetEntityId: e.targetEntity ? e.targetEntity.id : null,
            attackCooldown: e.attackCooldown || 0,
            veterancy: e.veterancy || 0,
            kills: e.kills || 0,
            ironCurtainTimer: e.ironCurtainTimer || 0,
            chronoCooldown: e.chronoCooldown || 0,
            madChargeTimer: e.madChargeTimer || 0,
            madCharging: Boolean(e.madCharging),
            cargo: e.cargo || 0,
            maxCargo: e.maxCargo || 700,
            oreTile: e.oreTile ? Object.assign({}, e.oreTile) : null
          });
        }
      }

      const mapSnap = this.map
        ? {
            width: this.map.width,
            height: this.map.height,
            theater: this.map.theater || 'temperate',
            fogEnabled: Boolean(this.map.fogEnabled),
            regrowTimer: this.map.regrowTimer || 0,
            config: this.map.config ? JSON.parse(JSON.stringify(this.map.config)) : {},
            tiles: this.map.tiles.map((row) =>
              row.map((t) => ({
                tx: t.tx,
                ty: t.ty,
                type: t.type,
                oreAmount: t.oreAmount || 0,
                maxOre: t.maxOre || 0,
                variant: t.variant || 0,
                buildingId: t.buildingId,
                wallDefId: t.wallDefId || null,
                isWall: Boolean(t.isWall),
                bridgeHp: t.bridgeHp,
                maxBridgeHp: t.maxBridgeHp,
                isBridgeSpan: Boolean(t.isBridgeSpan),
                demolishedBridge: Boolean(t.demolishedBridge),
                bridgeId: t.bridgeId,
                hasBridgeHut: Boolean(t.hasBridgeHut),
                bridgeHutId: t.bridgeHutId
              }))
            ),
            fog: this.map.fog.map((row) => row.slice())
          }
        : null;

      return {
        version: 2,
        timestamp: Date.now(),
        state: this.state,
        elapsedTime: this.elapsedTime,
        gameSpeed: this.gameSpeed,
        aiDifficulty: this.aiDifficulty,
        aiCount: this.aiCount,
        aiDoctrine: this.aiDoctrine,
        currentMissionId: this.currentMission ? this.currentMission.id : null,
        currentMission: this.currentMission
          ? JSON.parse(JSON.stringify(this.currentMission))
          : null,
        customOptions: JSON.parse(JSON.stringify(this.customOptions || {})),
        stats: JSON.parse(JSON.stringify(this.stats || {})),
        map: mapSnap,
        teams: teamsSnap,
        entities: entitiesSnap,
        crates: JSON.parse(JSON.stringify(this.crates || [])),
        decals: JSON.parse(JSON.stringify(this.decals || [])),
        lastAlertPos: this.lastAlertPos ? Object.assign({}, this.lastAlertPos) : null
      };
    }

    deserializeState(snapshot) {
      if (typeof snapshot === 'string') {
        try {
          snapshot = JSON.parse(snapshot);
        } catch (err) {
          return false;
        }
      }
      if (!snapshot || typeof snapshot !== 'object') return false;

      const DATA = getData();
      this.state = snapshot.state || 'playing';
      this.elapsedTime = Number(snapshot.elapsedTime) || 0;
      this.gameSpeed = Number(snapshot.gameSpeed) || 1.0;
      this.aiDifficulty = snapshot.aiDifficulty || 'medium';
      this.aiCount = snapshot.aiCount || 1;
      this.aiDoctrine = snapshot.aiDoctrine || 'balanced';
      this.currentMission = snapshot.currentMission || this.currentMission;
      this.customOptions = snapshot.customOptions || {};
      this.stats = Object.assign(this._createInitialStats(), snapshot.stats || {});

      // 1. Restore Map tiles and Fog of War
      if (snapshot.map) {
        if (
          !this.map ||
          this.map.width !== snapshot.map.width ||
          this.map.height !== snapshot.map.height
        ) {
          this.map = new window.RA.GameMap(
            snapshot.map.width || 64,
            snapshot.map.height || 64,
            snapshot.map.config || {}
          );
        }
        this.map.theater = snapshot.map.theater || 'temperate';
        this.map.fogEnabled = Boolean(snapshot.map.fogEnabled);
        this.map.regrowTimer = snapshot.map.regrowTimer || 0;

        if (Array.isArray(snapshot.map.tiles)) {
          for (let ty = 0; ty < this.map.height; ty++) {
            const srcRow = snapshot.map.tiles[ty];
            if (!Array.isArray(srcRow)) continue;
            for (let tx = 0; tx < this.map.width; tx++) {
              const srcTile = srcRow[tx];
              if (srcTile && this.map.tiles[ty] && this.map.tiles[ty][tx]) {
                Object.assign(this.map.tiles[ty][tx], srcTile);
              }
            }
          }
        }

        if (Array.isArray(snapshot.map.fog)) {
          for (let ty = 0; ty < this.map.height; ty++) {
            const srcFogRow = snapshot.map.fog[ty];
            if (!Array.isArray(srcFogRow)) continue;
            for (let tx = 0; tx < this.map.width; tx++) {
              this.map.fog[ty][tx] = srcFogRow[tx];
            }
          }
        }
      }

      // 2. Restore Teams
      this.teams = {};
      if (snapshot.teams) {
        const hydrateQueueItem = (q, isStruct) => {
          if (!q) return null;
          const def = isStruct
            ? DATA.BUILDINGS && DATA.BUILDINGS[q.defId]
            : DATA.UNITS && DATA.UNITS[q.defId];
          return Object.assign({}, q, { def: def || {} });
        };

        for (const teamId of Object.keys(snapshot.teams)) {
          const st = snapshot.teams[teamId];
          if (!st) continue;
          const teamObj = this._createTeamState(st.id || teamId, st.faction, st.credits, {
            color: st.color,
            doctrine: st.doctrine
          });
          teamObj.powerProduced = st.powerProduced || 0;
          teamObj.powerConsumed = st.powerConsumed || 0;
          teamObj.lowPower = Boolean(st.lowPower);
          teamObj.hasRadar = Boolean(st.hasRadar);
          teamObj.blackoutTimer = st.blackoutTimer || 0;
          teamObj.revealAllTimer = st.revealAllTimer || 0;

          if (st.queues) {
            teamObj.queues.building = hydrateQueueItem(st.queues.building, true);
            teamObj.queues.defense = hydrateQueueItem(st.queues.defense, true);
            teamObj.queues.infantry = Array.isArray(st.queues.infantry)
              ? st.queues.infantry.map((q) => hydrateQueueItem(q, false)).filter(Boolean)
              : [];
            teamObj.queues.vehicle = Array.isArray(st.queues.vehicle)
              ? st.queues.vehicle.map((q) => hydrateQueueItem(q, false)).filter(Boolean)
              : [];
          }

          if (st.superweapons) {
            for (const swId of Object.keys(st.superweapons)) {
              if (teamObj.superweapons[swId]) {
                Object.assign(teamObj.superweapons[swId], st.superweapons[swId]);
              }
            }
          }

          this.teams[teamId] = teamObj;
        }
      }

      // 3. Restore Entities & Re-link Target References
      this.entities = [];
      this.projectiles = [];
      this.particles = [];
      this.floatingTexts = [];

      const idMap = new Map();
      let maxEntityId = 1;

      if (Array.isArray(snapshot.entities)) {
        for (let i = 0; i < snapshot.entities.length; i++) {
          const ed = snapshot.entities[i];
          if (!ed) continue;
          if (ed.id && ed.id > maxEntityId) {
            maxEntityId = ed.id;
          }
          if (ed.isBuilding) {
            const def = DATA.BUILDINGS && DATA.BUILDINGS[ed.defId];
            const b = new window.RA.Building(Object.assign({}, ed, { def }));
            this.entities.push(b);
            idMap.set(b.id, b);
          } else if (ed.isUnit) {
            const def = DATA.UNITS && DATA.UNITS[ed.defId];
            const u = new window.RA.Unit(Object.assign({}, ed, { def }));
            this.entities.push(u);
            idMap.set(u.id, u);
          }
        }

        // Second pass: re-link targetEntity references
        for (let i = 0; i < snapshot.entities.length; i++) {
          const ed = snapshot.entities[i];
          if (!ed) continue;
          const inst = idMap.get(ed.id);
          if (!inst) continue;
          if (ed.targetEntityId && idMap.has(ed.targetEntityId)) {
            inst.targetEntity = idMap.get(ed.targetEntityId);
            inst.target = inst.targetEntity;
          }
          if (Array.isArray(inst.commandQueue)) {
            inst.commandQueue.forEach((cmd) => {
              if (cmd.targetEntityId && idMap.has(cmd.targetEntityId)) {
                cmd.targetEntity = idMap.get(cmd.targetEntityId);
              }
            });
          }
        }
      }

      if (window.RA.Entity && typeof window.RA.Entity.setNextId === 'function') {
        window.RA.Entity.setNextId(maxEntityId + 1);
      }

      // 4. Restore Crates, Decals & Last Alert
      this.crates = Array.isArray(snapshot.crates)
        ? snapshot.crates.map((c) => Object.assign({}, c))
        : [];
      this.decals = Array.isArray(snapshot.decals)
        ? snapshot.decals.map((d) => Object.assign({}, d))
        : [];
      this.lastAlertPos = snapshot.lastAlertPos
        ? Object.assign({}, snapshot.lastAlertPos)
        : null;

      for (const teamId of Object.keys(this.teams)) {
        this.recalculatePower(teamId);
      }

      return true;
    }

    // =========================================================================
    // SELECTION & QUERY HELPERS FOR UI
    // =========================================================================

    getEntityAt(worldX, worldY) {
      for (let i = this.entities.length - 1; i >= 0; i--) {
        const e = this.entities[i];
        if (!e || e.dead || !e.isUnit) continue;
        if (
          e.team !== 'player' &&
          this.map &&
          this.map.fogEnabled &&
          !this.map.isWorldPosVisible(e.x, e.y)
        ) {
          continue;
        }
        const hitRadius = Math.max(16, (e.radius || 12) + 6);
        const effY = e.y - (e.altitude || 0);
        if (
          Math.hypot(e.x - worldX, e.y - worldY) <= hitRadius ||
          Math.hypot(e.x - worldX, effY - worldY) <= hitRadius
        ) {
          return e;
        }
      }

      const ts = getTileSize();
      for (let i = this.entities.length - 1; i >= 0; i--) {
        const e = this.entities[i];
        if (!e || e.dead || !e.isBuilding) continue;
        const minX = e.tx * ts;
        const maxX = (e.tx + e.w) * ts;
        const minY = e.ty * ts;
        const maxY = (e.ty + e.h) * ts;
        if (worldX >= minX && worldX <= maxX && worldY >= minY && worldY <= maxY) {
          return e;
        }
      }

      return null;
    }

    getSelectedEntities(team = 'player') {
      return this.entities.filter(
        (e) => e && !e.dead && e.selected && (!team || e.team === team)
      );
    }

    getSelectedUnits(team = 'player') {
      return this.entities.filter(
        (e) => e && !e.dead && e.isUnit && e.selected && (!team || e.team === team)
      );
    }

    getSelectedBuilding(team = 'player') {
      return (
        this.entities.find(
          (e) => e && !e.dead && e.isBuilding && e.selected && (!team || e.team === team)
        ) || null
      );
    }

    clearSelection() {
      for (let i = 0; i < this.entities.length; i++) {
        if (this.entities[i]) this.entities[i].selected = false;
      }
    }

    // =========================================================================
    // DAMAGE & KILL CALLBACKS
    // =========================================================================

    onEntityDamaged(entity, attacker) {
      if (!entity || entity.team !== 'player') return;
      if (entity.isBuilding && this.baseUnderAttackCooldown <= 0) {
        this.baseUnderAttackCooldown = 14.0;
        this.addRadarPing(entity.x, entity.y, '#ef4444', 'BASE ATTACK');
        this.notifyEVA('ALERT: OUR BASE IS UNDER ATTACK!', 'Our base is under attack');
      } else if (entity.defId === 'harvester' && this.harvesterAttackCooldown <= 0) {
        this.harvesterAttackCooldown = 14.0;
        this.addRadarPing(entity.x, entity.y, '#f59e0b', 'HARVESTER');
        this.notifyEVA('ALERT: ORE HARVESTER UNDER ATTACK!', 'Harvester under attack');
      }
    }

    onEntityKilled(entity, attacker) {
      if (!entity) return;

      if (entity.isBuilding) {
        this._clearBuildingFromMap(entity);

        if (!entity.isWall) {
          const rubbleRadius = Math.max(entity.w || 2, entity.h || 2) * getTileSize() * 0.42;
          this.addDecal(entity.x, entity.y, 'rubble', rubbleRadius, 0);
        }

        this.spawnParticles(entity.x, entity.y, 'explosion', entity.isWall ? 6 : 22);
        this.spawnParticles(entity.x, entity.y, 'smoke', entity.isWall ? 4 : 12);
        if (window.RA.audio) {
          window.RA.audio.playSfx(entity.isWall ? 'explosion' : 'big_explosion');
        }
        this.recalculatePower(entity.team);

        if (entity.team !== 'player') {
          this.stats.buildingsDestroyed += 1;
        } else {
          this.stats.buildingsLost += 1;
        }
      } else if (entity.isUnit) {
        this.spawnParticles(
          entity.x,
          entity.y,
          entity.isInfantry ? 'blood' : 'explosion',
          entity.isInfantry ? 6 : 12
        );
        if (!entity.isInfantry && window.RA.audio) {
          window.RA.audio.playSfx('explosion');
        }
        if (entity.team !== 'player') {
          this.stats.unitsKilled += 1;
        } else {
          this.stats.unitsLost += 1;
        }
      }
    }

    // =========================================================================
    // MAIN SIMULATION UPDATE LOOP
    // =========================================================================

    update(dt) {
      if (this.state !== 'playing') return;

      const clampedDt =
        Math.min(0.1, Math.max(0, Number(dt) || 0.016)) * (this.gameSpeed || 1.0);
      if (clampedDt <= 0) return;

      this.elapsedTime += clampedDt;
      this.stats.elapsedTime = this.elapsedTime;

      if (this.evaTimer > 0) this.evaTimer = Math.max(0, this.evaTimer - clampedDt);
      if (this.insufficientFundsCooldown > 0) {
        this.insufficientFundsCooldown = Math.max(0, this.insufficientFundsCooldown - clampedDt);
      }
      if (this.baseUnderAttackCooldown > 0) {
        this.baseUnderAttackCooldown = Math.max(0, this.baseUnderAttackCooldown - clampedDt);
      }
      if (this.harvesterAttackCooldown > 0) {
        this.harvesterAttackCooldown = Math.max(0, this.harvesterAttackCooldown - clampedDt);
      }

      // 1. Update Team Timers, Production Queues & Superweapons across all teams
      for (const teamId of Object.keys(this.teams)) {
        const t = this.teams[teamId];
        if (!t) continue;
        if (t.blackoutTimer > 0) {
          t.blackoutTimer = Math.max(0, t.blackoutTimer - clampedDt);
          if (t.blackoutTimer <= 0) {
            this.recalculatePower(teamId);
          }
        }
        if (t.revealAllTimer > 0) {
          t.revealAllTimer = Math.max(0, t.revealAllTimer - clampedDt);
        }
        this._updateTeamProduction(teamId, clampedDt);
        this._updateSuperweapons(teamId, clampedDt);
      }

      // 2. Update Entities
      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (e && !e.dead && typeof e.update === 'function') {
          e.update(clampedDt, this);
        }
      }

      // 3. Update Supply Crates
      this._updateCrates(clampedDt);

      // 4. Update Projectiles
      for (let i = 0; i < this.projectiles.length; i++) {
        const p = this.projectiles[i];
        if (p && !p.dead && typeof p.update === 'function') {
          p.update(clampedDt, this);
        }
      }

      // 5. Update Particles, Floating Texts, Decals & Radar Pings
      for (let i = 0; i < this.particles.length; i++) {
        const pt = this.particles[i];
        if (pt && !pt.dead && typeof pt.update === 'function') {
          pt.update(clampedDt);
        }
      }
      for (let i = 0; i < this.floatingTexts.length; i++) {
        const ft = this.floatingTexts[i];
        if (ft && !ft.dead && typeof ft.update === 'function') {
          ft.update(clampedDt);
        }
      }
      for (let i = 0; i < this.radarPings.length; i++) {
        const rp = this.radarPings[i];
        if (!rp) continue;
        rp.age = (rp.age || 0) + clampedDt;
        rp.life -= clampedDt;
        rp.radius = 3 + (1 - Math.max(0, rp.life / (rp.maxLife || 4.0))) * 15;
      }

      // Clean up dead objects
      this.entities = this.entities.filter((e) => e && !e.dead);
      this.projectiles = this.projectiles.filter((p) => p && !p.dead);
      this.particles = this.particles.filter((pt) => pt && !pt.dead);
      this.floatingTexts = this.floatingTexts.filter((ft) => ft && !ft.dead);
      this.radarPings = this.radarPings.filter((rp) => rp && rp.life > 0);

      // 6. Check bridge demolition drownings, Map Fog & Ore Regrowth
      this.checkDrownedLandUnits();
      if (this.map) {
        if (typeof this.map.updateFog === 'function') {
          const playerTeam = this.teams.player;
          const revealAll =
            !this.map.fogEnabled || Boolean(playerTeam && playerTeam.revealAllTimer > 0);
          this.map.updateFog(this.entities, 'player', revealAll);
        }
        if (typeof this.map.regrowOre === 'function') {
          this.map.regrowOre(clampedDt);
        }
      }

      // 7. Enemy AI Commanders
      this.updateAI(clampedDt);

      // 8. Check Win / Loss Conditions
      this._checkWinLossConditions();
    }

    _checkWinLossConditions() {
      if (this.state !== 'playing') return;

      let playerAlive = 0;
      let enemyAlive = 0;

      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (!e || e.dead) continue;
        if (e.team === 'player') playerAlive++;
        else enemyAlive++;
      }

      if (enemyAlive === 0) {
        this.state = 'victory';
        if (window.RA.audio) {
          window.RA.audio.playSfx('victory');
          window.RA.audio.speak('Mission accomplished');
        }
        if (typeof this.onGameOver === 'function') {
          this.onGameOver('victory', this.stats);
        }
      } else if (playerAlive === 0) {
        this.state = 'defeat';
        if (window.RA.audio) {
          window.RA.audio.playSfx('defeat');
          window.RA.audio.speak('Mission failed');
        }
        if (typeof this.onGameOver === 'function') {
          this.onGameOver('defeat', this.stats);
        }
      }
    }

    // =========================================================================
    // MULTI-AI COMMANDER & DOCTRINES ('balanced', 'rush', 'turtle', 'air_naval')
    // =========================================================================

    updateAI(dt) {
      if (!this.map) return;

      this.aiState.thinkTimer -= dt;
      this.aiState.waveTimer += dt;

      if (this.aiState.thinkTimer > 0) return;
      this.aiState.thinkTimer = 2.0;

      const aiTeams = this.getActiveAITeams();
      const dispatchWaveNow = this.aiState.waveTimer >= this.aiState.waveInterval;
      if (dispatchWaveNow) {
        this.aiState.waveTimer = 0;
      }

      for (let tIdx = 0; tIdx < aiTeams.length; tIdx++) {
        const teamId = aiTeams[tIdx];
        this._updateSingleAICommander(teamId, dispatchWaveNow);
      }
    }

    _updateSingleAICommander(teamId, dispatchWaveNow) {
      const enemyTeam = this.teams[teamId];
      if (!enemyTeam || !this.map) return;

      const doctrine = enemyTeam.doctrine || this.aiDoctrine || 'balanced';
      const trickle = this.aiDifficulty === 'hard' ? 35 : this.aiDifficulty === 'medium' ? 18 : 8;
      enemyTeam.credits += trickle;

      const enemyBuildings = this.entities.filter(
        (e) => e && !e.dead && e.isBuilding && e.team === teamId
      );
      const enemyUnits = this.entities.filter(
        (e) => e && !e.dead && e.isUnit && e.team === teamId
      );

      if (enemyBuildings.length === 0) return;

      const baseAnchor = enemyBuildings.find((b) => b.defId === 'conyard') || enemyBuildings[0];
      const owned = this.getOwnedBuildingTypes(teamId);

      // 1. Place any completed AI building
      if (enemyTeam.queues.building && enemyTeam.queues.building.readyToPlace) {
        const defId = enemyTeam.queues.building.defId;
        const spot = this._findValidBuildingSpotNear(
          defId,
          baseAnchor.tx,
          baseAnchor.ty,
          teamId,
          false
        );
        if (spot) {
          this.placeBuilding('building', spot.tx, spot.ty, teamId);
        } else {
          enemyTeam.queues.building = null;
        }
      }

      if (enemyTeam.queues.defense && enemyTeam.queues.defense.readyToPlace) {
        const defId = enemyTeam.queues.defense.defId;
        const spot = this._findValidBuildingSpotNear(
          defId,
          baseAnchor.tx,
          baseAnchor.ty + 3,
          teamId,
          false
        );
        if (spot) {
          this.placeBuilding('defense', spot.tx, spot.ty, teamId);
        } else {
          enemyTeam.queues.defense = null;
        }
      }

      // 2. Rebuild / expand essential buildings
      if (!enemyTeam.queues.building && owned.has('conyard') && enemyTeam.credits >= 500) {
        if (enemyTeam.lowPower) {
          this.startProduction('building', owned.has('power') ? 'advpower' : 'power', teamId);
        } else if (!owned.has('power')) {
          this.startProduction('building', 'power', teamId);
        } else if (!owned.has('refinery')) {
          this.startProduction('building', 'refinery', teamId);
        } else if (!owned.has('barracks')) {
          this.startProduction('building', 'barracks', teamId);
        } else if (!owned.has('weap')) {
          this.startProduction('building', 'weap', teamId);
        } else if (
          (this.aiDifficulty !== 'easy' || doctrine === 'air_naval' || doctrine === 'turtle') &&
          !owned.has('radar') &&
          enemyTeam.credits >= 1400
        ) {
          this.startProduction('building', 'radar', teamId);
        } else if (
          doctrine === 'air_naval' &&
          owned.has('radar') &&
          !owned.has('helipad') &&
          !owned.has('afld') &&
          enemyTeam.credits >= 1500
        ) {
          this.startProduction(
            'building',
            enemyTeam.faction === 'soviet' ? 'afld' : 'helipad',
            teamId
          );
        }
      }

      // 3. Build defensive turrets (extra for 'turtle' doctrine)
      const defenseCount = enemyBuildings.filter((b) => b.category === 'defense').length;
      const baseMaxDef =
        this.aiDifficulty === 'hard' ? 5 : this.aiDifficulty === 'medium' ? 3 : 2;
      const maxDefenses = doctrine === 'turtle' ? baseMaxDef + 3 : baseMaxDef;

      if (!enemyTeam.queues.defense && defenseCount < maxDefenses && enemyTeam.credits >= 1200) {
        if (owned.has('radar') && Math.random() < 0.35) {
          this.startProduction(
            'defense',
            enemyTeam.faction === 'soviet' ? 'sam' : 'agun',
            teamId
          );
        } else if (enemyTeam.faction === 'soviet' && owned.has('weap')) {
          this.startProduction('defense', 'tesla', teamId);
        } else if (enemyTeam.faction === 'allied' && owned.has('barracks')) {
          this.startProduction('defense', 'turret', teamId);
        } else if (owned.has('barracks')) {
          this.startProduction('defense', 'pillbox', teamId);
        }
      }

      // 4. Ensure AI has an active Harvester
      const harvesters = enemyUnits.filter((u) => u.defId === 'harvester');
      if (
        harvesters.length === 0 &&
        owned.has('weap') &&
        owned.has('refinery') &&
        enemyTeam.queues.vehicle.length === 0 &&
        enemyTeam.credits >= 1100
      ) {
        this.startProduction('vehicle', 'harvester', teamId);
      }

      // 5. Train Infantry, Vehicles & Aircraft according to doctrine
      const combatUnits = enemyUnits.filter((u) => (u.def.range || 0) > 0);
      const maxArmy = this.aiDifficulty === 'hard' ? 18 : this.aiDifficulty === 'medium' ? 12 : 8;

      if (combatUnits.length < maxArmy) {
        if (
          owned.has('barracks') &&
          enemyTeam.queues.infantry.length === 0 &&
          enemyTeam.credits >= 400
        ) {
          let infChoice = Math.random() < 0.55 ? 'rifle' : 'rocket';
          if (enemyTeam.faction === 'soviet' && doctrine === 'rush' && Math.random() < 0.35) {
            infChoice = 'dog';
          } else if (
            enemyTeam.faction === 'soviet' &&
            owned.has('tesla') &&
            Math.random() < 0.35
          ) {
            infChoice = 'shok';
          }
          this.startProduction('infantry', infChoice, teamId);
        }

        if (enemyTeam.queues.vehicle.length === 0 && enemyTeam.credits >= 850) {
          if (
            doctrine === 'air_naval' &&
            (owned.has('helipad') || owned.has('afld')) &&
            Math.random() < 0.55
          ) {
            const airChoice =
              enemyTeam.faction === 'soviet'
                ? owned.has('afld')
                  ? Math.random() < 0.5
                    ? 'yak'
                    : 'mig'
                  : 'hind'
                : 'heli';
            this.startProduction('vehicle', airChoice, teamId);
          } else if (owned.has('weap')) {
            let vehChoice = enemyTeam.faction === 'soviet' ? 'htnk' : 'mtnk';
            if (doctrine === 'rush') {
              vehChoice = enemyTeam.faction === 'soviet' ? 'htnk' : 'ltnk';
            } else if (this.aiDifficulty === 'hard' && owned.has('radar') && Math.random() < 0.45) {
              vehChoice =
                enemyTeam.faction === 'soviet'
                  ? Math.random() < 0.5
                    ? 'mammoth'
                    : 'v2rl'
                  : Math.random() < 0.5
                  ? 'ctnk'
                  : 'arty';
            } else if (enemyTeam.faction === 'allied' && Math.random() < 0.4) {
              vehChoice = Math.random() < 0.5 ? 'ltnk' : 'arty';
            }
            this.startProduction('vehicle', vehChoice, teamId);
          }
        }
      }

      // 6. Dispatch Attack Wave toward Player Base when timer expires
      if (dispatchWaveNow) {
        const waveMinSize =
          doctrine === 'rush'
            ? 3
            : this.aiDifficulty === 'hard'
            ? 5
            : this.aiDifficulty === 'medium'
            ? 4
            : 3;
        const idleCombat = combatUnits.filter((u) => u.state === 'idle');
        if (idleCombat.length >= waveMinSize) {
          const playerBase = this.getBaseCenter('player');
          const attackers = idleCombat.slice(
            0,
            Math.max(waveMinSize, Math.ceil(idleCombat.length * 0.75))
          );
          this.issueOrder(attackers, 'attackMove', playerBase.x, playerBase.y);
        }
      }
    }
  }

  window.RA.GameEngine = GameEngine;
})();
