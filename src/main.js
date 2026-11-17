/**
 * Command & Conquer: RED ALERT — Web Tactical Command
 * Main UI Controller, Screen State Machine, HUD Sync & RTS Input Handler
 * Exports: window.RA.app
 */
(function () {
  'use strict';

  window.RA = window.RA || {};

  class TacticalCommandApp {
    constructor() {
      this.screen = 'menu'; // 'menu' | 'briefing' | 'playing' | 'gameover'
      this.selectedFaction = 'allied';
      this.selectedMode = 'campaign'; // 'campaign' | 'skirmish'
      this.selectedMissionIndex = 0;

      this.skirmishOptions = {
        difficulty: 'medium',
        credits: 8000,
        fog: true,
        theater: 'temperate',
        aiCount: 1,
        aiDoctrine: 'balanced'
      };

      this.campaignProgress = this.loadCampaignProgress();

      this.currentMission = null;
      this.currentCustomOptions = {};
      this.activeTab = 'building'; // 'building' | 'defense' | 'infantry' | 'vehicle'

      // Cursor & Tactical Tool Modes: 'normal' | 'place' | 'repair' | 'sell' | 'attackMove' | 'patrol' | 'chronoBlink' | 'superweapon'
      this.cursorMode = 'normal';
      this.pendingPlacement = null; // { category, defId, def }
      this.pendingSuperweapon = null; // swId

      // Mouse & Drag-Box state
      this.mouseScreen = { x: 0, y: 0, inside: false };
      this.dragState = {
        active: false,
        startX: 0,
        startY: 0,
        currX: 0,
        currY: 0,
        isBoxSelecting: false
      };
      this.minimapDragging = false;
      this.lastClickTime = 0;
      this.lastClickedEntityId = null;

      // Keyboard Panning state
      this.keysDown = new Set();
      this.edgeScrollEnabled = false; // Enabled only when pointer moves near edge after entering canvas

      // Control Groups 1..9
      this.controlGroups = {};
      for (let i = 1; i <= 9; i++) {
        this.controlGroups[i] = [];
      }

      // Teletype & HUD timers
      this.teletypeTimer = null;
      this.notificationTimer = null;
      this.hudSyncAccum = 0;
      this.lastFrameTime = performance.now();
      this.gameOverTriggered = false;
      this.readyNotified = { building: null, defense: null };

      this.initDOMReferences();
      this.initEngineAndRenderer();
      this.bindUIEvents();
      this.bindCanvasEvents();
      this.bindKeyboardEvents();
      this.renderMenuMissions();
      this.applyFactionTheme(this.selectedFaction);
      this.updateControlGroupsBar();

      // Start master loop
      requestAnimationFrame((ts) => this.loop(ts));
    }

    initDOMReferences() {
      // Screens
      this.screens = {
        menu: document.getElementById('menu-screen'),
        briefing: document.getElementById('briefing-screen'),
        playing: document.getElementById('game-screen'),
        gameover: document.getElementById('gameover-screen')
      };

      // Canvases
      this.canvas = document.getElementById('battlefield-canvas');
      this.minimapCanvas = document.getElementById('minimap-canvas');
      this.battlefieldContainer = document.getElementById('battlefield-container');

      // Top HUD Elements
      this.elCredits = document.getElementById('credits-display');
      this.elPower = document.getElementById('power-display');
      this.elMissionTitle = document.getElementById('mission-title-display');
      this.elTimer = document.getElementById('timer-display');
      this.elEvaMessage = document.getElementById('eva-message');
      this.elNotification = document.getElementById('battlefield-notification');
      this.elCursorBadge = document.getElementById('cursor-mode-badge');
      this.elCursorText = document.getElementById('cursor-mode-text');

      // Sidebar Elements
      this.elRadarBadge = document.getElementById('radar-status-badge');
      this.elPowerFill = document.getElementById('power-meter-fill');
      this.elPowerDemand = document.getElementById('power-meter-demand');
      this.elPowerTag = document.getElementById('power-status-tag');
      this.elProdGrid = document.getElementById('production-grid');
      this.elSuperweapons = document.getElementById('superweapons-panel');
      this.elInspector = document.getElementById('selection-inspector');
      this.elInspectorCount = document.getElementById('inspector-count-badge');
      this.elControlGroupsBar = document.getElementById('control-groups-bar');
      this.elStanceSelector = document.getElementById('stance-selector');

      // Modals
      this.elPauseModal = document.getElementById('pause-modal');
      this.elControlsModal = document.getElementById('controls-modal');
    }

    initEngineAndRenderer() {
      const w = window.RA.MAP_WIDTH || 64;
      const h = window.RA.MAP_HEIGHT || 64;
      const initialMap = window.RA.GameMap ? new window.RA.GameMap(w, h) : null;

      this.renderer = new window.RA.Renderer(this.canvas, this.minimapCanvas);
      this.engine = new window.RA.GameEngine(initialMap, this.renderer);
      this.engine.renderer = this.renderer;
      this.audio = window.RA.audio;

      // Engine hooks
      this.engine.onGameOver = (result) => this.handleGameOver(result);
      this.engine.onNotification = (msg, isAlert) => this.showNotification(msg, isAlert);
      this.engine.onEvaMessage = (msg) => this.setEvaMessage(msg);
    }

    /* ========================================================================
       MENU & SCREEN FLOW STATE MACHINE
       ======================================================================== */
    showScreen(screenName) {
      const normalized = screenName === 'game' ? 'playing' : screenName;
      this.screen = normalized;

      Object.keys(this.screens).forEach((key) => {
        const el = this.screens[key];
        if (!el) return;
        if (key === normalized) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      });

      if (normalized === 'playing') {
        this.resizeCanvas();
        this.syncHUD(true);
      }
    }

    applyFactionTheme(factionId) {
      document.body.classList.remove('faction-theme-allied', 'faction-theme-soviet');
      document.body.classList.add(factionId === 'soviet' ? 'faction-theme-soviet' : 'faction-theme-allied');

      const alliedCard = document.getElementById('faction-allied');
      const sovietCard = document.getElementById('faction-soviet');
      if (alliedCard && sovietCard) {
        const isAllied = factionId === 'allied';
        alliedCard.classList.toggle('selected', isAllied);
        sovietCard.classList.toggle('selected', !isAllied);
        const alliedTag = alliedCard.querySelector('.faction-status-tag');
        const sovietTag = sovietCard.querySelector('.faction-status-tag');
        if (alliedTag) alliedTag.textContent = isAllied ? 'SELECTED' : 'STANDBY';
        if (sovietTag) sovietTag.textContent = !isAllied ? 'SELECTED' : 'STANDBY';
      }
    }

    selectFaction(factionId) {
      if (factionId !== 'allied' && factionId !== 'soviet') return;
      this.selectedFaction = factionId;
      this.applyFactionTheme(factionId);
      if (this.audio) {
        this.audio.init();
        this.audio.playSfx('click');
      }
    }

    selectMode(mode) {
      this.selectedMode = mode === 'skirmish' ? 'skirmish' : 'campaign';
      const tabCampaign = document.getElementById('tab-campaign');
      const tabSkirmish = document.getElementById('tab-skirmish');
      const panelCampaign = document.getElementById('campaign-panel');
      const panelSkirmish = document.getElementById('skirmish-panel');

      if (tabCampaign && tabSkirmish && panelCampaign && panelSkirmish) {
        const isCamp = this.selectedMode === 'campaign';
        tabCampaign.classList.toggle('active', isCamp);
        tabCampaign.setAttribute('aria-selected', String(isCamp));
        tabSkirmish.classList.toggle('active', !isCamp);
        tabSkirmish.setAttribute('aria-selected', String(!isCamp));
        panelCampaign.classList.toggle('active', isCamp);
        panelSkirmish.classList.toggle('active', !isCamp);
      }

      if (this.audio) {
        this.audio.init();
        this.audio.playSfx('click');
      }
    }

    loadCampaignProgress() {
      const defaultProgress = {
        unlockedMission: 1,
        completedRanks: {}
      };
      try {
        const raw = localStorage.getItem('ra_campaign_progress_v2');
        if (!raw) {
          localStorage.setItem('ra_campaign_progress_v2', JSON.stringify(defaultProgress));
          return defaultProgress;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return defaultProgress;
        return {
          unlockedMission: Math.max(1, Number(parsed.unlockedMission) || 1),
          completedRanks: parsed.completedRanks && typeof parsed.completedRanks === 'object' ? parsed.completedRanks : {}
        };
      } catch (e) {
        return defaultProgress;
      }
    }

    saveCampaignProgress(missionId, missionNumber, rankLetter) {
      const rankOrder = { S: 5, A: 4, B: 3, C: 2, D: 1 };
      const progress = this.loadCampaignProgress();
      const key = missionId || `mission_${missionNumber || 1}`;
      const prevRank = progress.completedRanks[key];
      if (!prevRank || (rankOrder[rankLetter] || 0) >= (rankOrder[prevRank] || 0)) {
        progress.completedRanks[key] = rankLetter;
      }
      const nextUnlock = Math.min(3, (Number(missionNumber) || 1) + 1);
      progress.unlockedMission = Math.max(progress.unlockedMission || 1, nextUnlock);
      this.campaignProgress = progress;
      try {
        localStorage.setItem('ra_campaign_progress_v2', JSON.stringify(progress));
      } catch (e) {
        // Ignore storage quota errors
      }
      this.renderMenuMissions();
    }

    renderMenuMissions() {
      const listEl = document.getElementById('mission-list');
      if (!listEl || !window.RA.DATA || !window.RA.DATA.MISSIONS) return;

      const progress = this.loadCampaignProgress();
      const missions = window.RA.DATA.MISSIONS;
      listEl.innerHTML = '';

      missions.forEach((m, idx) => {
        const missionNum = m.number || idx + 1;
        const missionKey = m.id || `mission_${missionNum}`;
        const savedRank = progress.completedRanks && progress.completedRanks[missionKey];
        const isUnlocked = missionNum <= (progress.unlockedMission || 1) || Boolean(savedRank);

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'mission-card' + (idx === this.selectedMissionIndex ? ' selected' : '');
        card.dataset.missionIndex = String(idx);

        const factionLabel = m.faction === 'allied'
          ? '🦅 ALLIED'
          : m.faction === 'soviet'
          ? '☭ SOVIET'
          : '🦅/☭ JOINT OP';

        const rankBadgeHtml = savedRank
          ? `<span class="mission-badge-rank">★ ${savedRank}-RANK</span>`
          : `<span class="mission-badge-rank rank-pending">${isUnlocked ? 'UNLOCKED' : 'CLASSIFIED'}</span>`;

        card.innerHTML = `
          <div class="mission-card-left">
            <span class="mission-num">OP 0${missionNum}</span>
            <div>
              <div class="mission-name">${m.title}</div>
              <div class="mission-sub">${m.subtitle || m.location || ''}</div>
            </div>
          </div>
          <div class="mission-badges">
            <span class="mission-badge-faction">${factionLabel}</span>
            ${rankBadgeHtml}
            <span>${(m.aiDifficulty || 'medium').toUpperCase()} // $${(m.startCredits || 5000).toLocaleString()}</span>
          </div>
        `;

        card.addEventListener('click', () => {
          this.selectMission(idx);
        });

        listEl.appendChild(card);
      });
    }

    selectMission(index) {
      const missions = (window.RA.DATA && window.RA.DATA.MISSIONS) || [];
      if (index < 0 || index >= missions.length) return;
      this.selectedMissionIndex = index;

      const mission = missions[index];
      if (mission.faction === 'allied' || mission.faction === 'soviet') {
        this.selectedFaction = mission.faction;
        this.applyFactionTheme(this.selectedFaction);
      }

      this.renderMenuMissions();
      if (this.audio) {
        this.audio.init();
        this.audio.playSfx('click');
      }
    }

    buildMissionDescriptor(forceSkirmish = false) {
      const isSkirmish = forceSkirmish || this.selectedMode === 'skirmish';
      if (isSkirmish) {
        const enemyFaction = this.selectedFaction === 'allied' ? 'soviet' : 'allied';
        const theater = this.skirmishOptions.theater || 'temperate';
        const aiCount = Number(this.skirmishOptions.aiCount) || 1;
        const aiDoctrine = this.skirmishOptions.aiDoctrine || 'balanced';
        const creator = (window.RA.DATA && window.RA.DATA.createSkirmishMission) || window.RA.createSkirmishMission;
        const mission = creator
          ? creator({
              faction: this.selectedFaction,
              enemyFaction,
              aiDifficulty: this.skirmishOptions.difficulty,
              startCredits: this.skirmishOptions.credits,
              fogEnabled: this.skirmishOptions.fog,
              theater,
              aiCount,
              aiDoctrine,
              doctrine: aiDoctrine
            })
          : {
              id: 'skirmish_custom',
              number: 4,
              title: 'Operation: Total Domination (Skirmish)',
              subtitle: 'Unrestricted Tactical Engagement',
              faction: this.selectedFaction,
              enemyFaction,
              startCredits: this.skirmishOptions.credits,
              aiDifficulty: this.skirmishOptions.difficulty,
              theater,
              aiCount,
              aiDoctrine,
              location: 'CONTESTED FRONTIER SECTOR',
              briefing: [
                'Commander, satellite reconnaissance confirms hostile base construction across the river valley.',
                'Establish your Construction Yard, secure local ore and high-density gem fields, and annihilate all enemy forces.'
              ],
              objectives: [
                'Deploy your MCV or expand your Construction Yard.',
                'Secure rich Ore & Gem fields to fund high-tech armor, air & naval production.',
                'Destroy all enemy structures and units in the sector.'
              ],
              mapConfig: { width: 64, height: 64, seed: 4242, theater, aiCount }
            };

        if (mission && mission.mapConfig) {
          mission.mapConfig.theater = mission.mapConfig.theater || theater;
          mission.mapConfig.aiCount = mission.mapConfig.aiCount || aiCount;
        }

        return {
          mission,
          customOptions: {
            faction: this.selectedFaction,
            enemyFaction,
            aiDifficulty: this.skirmishOptions.difficulty,
            startCredits: this.skirmishOptions.credits,
            fogEnabled: this.skirmishOptions.fog,
            theater,
            aiCount,
            aiDoctrine,
            doctrine: aiDoctrine
          }
        };
      }

      const missions = (window.RA.DATA && window.RA.DATA.MISSIONS) || [];
      const baseMission = missions[this.selectedMissionIndex] || missions[0];
      const playerFaction =
        baseMission.faction === 'both'
          ? this.selectedFaction
          : baseMission.faction || this.selectedFaction;
      const enemyFaction =
        baseMission.enemyFaction || (playerFaction === 'allied' ? 'soviet' : 'allied');
      const theater =
        (baseMission.mapConfig && baseMission.mapConfig.theater) ||
        baseMission.theater ||
        (this.selectedMissionIndex === 1 ? 'snow' : this.selectedMissionIndex === 2 ? 'desert' : 'temperate');

      return {
        mission: baseMission,
        customOptions: {
          faction: playerFaction,
          enemyFaction,
          aiDifficulty: baseMission.aiDifficulty || 'medium',
          startCredits: baseMission.startCredits || 5000,
          fogEnabled: true,
          theater,
          aiCount: (baseMission.mapConfig && baseMission.mapConfig.aiCount) || baseMission.aiCount || 1,
          aiDoctrine: baseMission.aiDoctrine || 'balanced'
        }
      };
    }

    openBriefing(forceSkirmish = false) {
      if (this.audio) {
        this.audio.init();
        this.audio.playSfx('click');
      }

      const { mission, customOptions } = this.buildMissionDescriptor(forceSkirmish);
      this.currentMission = mission;
      this.currentCustomOptions = customOptions;

      const factionData =
        window.RA.DATA && window.RA.DATA.FACTIONS && window.RA.DATA.FACTIONS[customOptions.faction];
      this.applyFactionTheme(customOptions.faction);

      // Populate Briefing DOM
      const elInsignia = document.getElementById('briefing-insignia');
      const elFactionName = document.getElementById('briefing-faction-name');
      const elTitle = document.getElementById('briefing-title');
      const elSubtitle = document.getElementById('briefing-subtitle');
      const elLocation = document.getElementById('briefing-location');
      const elDiff = document.getElementById('briefing-difficulty');
      const elCredits = document.getElementById('briefing-credits');
      const elObjectives = document.getElementById('briefing-objectives');
      const elIntel = document.getElementById('briefing-intel');
      const elText = document.getElementById('briefing-text');

      if (elInsignia) elInsignia.textContent = factionData ? factionData.emblem : '🦅';
      if (elFactionName) {
        elFactionName.textContent =
          (factionData ? factionData.name.toUpperCase() : 'ALLIED FORCES') + ' // TACTICAL COMMAND';
      }
      if (elTitle) elTitle.textContent = (mission.title || 'OPERATION').toUpperCase();
      if (elSubtitle) elSubtitle.textContent = (mission.subtitle || 'CLASSIFIED OPERATION').toUpperCase();
      if (elLocation) elLocation.textContent = (mission.location || 'EUROPEAN THEATER').toUpperCase();
      if (elDiff) elDiff.textContent = (customOptions.aiDifficulty || 'MEDIUM').toUpperCase();
      if (elCredits) elCredits.textContent = '$' + Number(customOptions.startCredits || 5000).toLocaleString();

      if (elObjectives) {
        elObjectives.innerHTML = '';
        (mission.objectives || ['Eliminate all hostile forces in the sector.']).forEach((obj) => {
          const li = document.createElement('li');
          li.textContent = obj;
          elObjectives.appendChild(li);
        });
      }

      if (elIntel) {
        const bonus = factionData ? factionData.bonusText : '+15% Tactical Bonus';
        const enemyName = customOptions.enemyFaction === 'soviet' ? 'Soviet Union' : 'Allied Forces';
        elIntel.innerHTML = `
          <div><strong>COMMAND FACTION:</strong> ${factionData ? factionData.name : customOptions.faction}</div>
          <div><strong>DOCTRINE BONUS:</strong> ${bonus}</div>
          <div><strong>OPPOSING FORCE:</strong> ${enemyName} (${(customOptions.aiDifficulty || 'medium').toUpperCase()} AI)</div>
          <div><strong>TERRAIN INTEL:</strong> 64x64 Sector, River Crossings, Rich Ore &amp; Gem Deposits</div>
        `;
      }

      // Animated Teletype Transmission
      if (this.teletypeTimer) {
        clearInterval(this.teletypeTimer);
        this.teletypeTimer = null;
      }

      const paragraphs = Array.isArray(mission.briefing)
        ? mission.briefing
        : [String(mission.briefing || 'Destroy all enemy forces.')];

      if (elText) {
        elText.innerHTML = '';
        const fullText = paragraphs.join('\n\n');
        let charIdx = 0;
        const pEl = document.createElement('div');
        pEl.style.whiteSpace = 'pre-wrap';
        elText.appendChild(pEl);

        // Render initial chunk immediately so tests inspecting #briefing-text right away see text
        const initialChunk = Math.min(fullText.length, 60);
        pEl.textContent = fullText.slice(0, initialChunk);
        charIdx = initialChunk;

        this.teletypeTimer = setInterval(() => {
          if (charIdx >= fullText.length) {
            clearInterval(this.teletypeTimer);
            this.teletypeTimer = null;
            return;
          }
          charIdx = Math.min(fullText.length, charIdx + 5);
          pEl.textContent = fullText.slice(0, charIdx);
        }, 18);
      }

      this.showScreen('briefing');
    }

    startInstantSkirmish() {
      if (this.audio) {
        this.audio.init();
        this.audio.playSfx('click');
      }
      const { mission, customOptions } = this.buildMissionDescriptor(true);
      this.launchMission(mission, customOptions);
    }

    deployToBattlefield() {
      if (this.teletypeTimer) {
        clearInterval(this.teletypeTimer);
        this.teletypeTimer = null;
      }
      if (!this.currentMission) {
        const desc = this.buildMissionDescriptor(false);
        this.currentMission = desc.mission;
        this.currentCustomOptions = desc.customOptions;
      }
      this.launchMission(this.currentMission, this.currentCustomOptions);
    }

    launchMission(mission, customOptions = {}) {
      this.currentMission = mission;
      this.currentCustomOptions = customOptions;
      this.gameOverTriggered = false;
      this.readyNotified = { building: null, defense: null };
      this.setCursorMode('normal');

      // Reset control groups
      for (let i = 1; i <= 9; i++) {
        this.controlGroups[i] = [];
      }
      this.updateControlGroupsBar();

      // Hide any open modals
      if (this.elPauseModal) this.elPauseModal.classList.add('hidden');
      if (this.elControlsModal) this.elControlsModal.classList.add('hidden');

      this.applyFactionTheme(customOptions.faction || mission.faction || this.selectedFaction);
      this.showScreen('playing');
      this.resizeCanvas();

      // Start mission in engine
      this.engine.startMission(mission, customOptions);
      if (this.engine.map && customOptions.fogEnabled !== undefined) {
        this.engine.map.fogEnabled = Boolean(customOptions.fogEnabled);
        this.engine.map.updateFog(this.engine.entities, 'player', !this.engine.map.fogEnabled);
      }

      this.centerCameraOnBase();

      if (this.elMissionTitle) {
        this.elMissionTitle.textContent = (mission.title || 'OPERATION').toUpperCase();
      }

      this.setEvaMessage('BATTLEFIELD CONTROL ONLINE. GOOD LUCK, COMMANDER.');
      this.showNotification(`${mission.title || 'Operation'} — Deploy & Conquer!`, false);

      if (this.audio) {
        this.audio.init();
        if (this.audio.musicEnabled) {
          this.audio.startMusic();
        }
      }

      this.syncHUD(true);
    }

    /* ========================================================================
       MAIN GAME LOOP (requestAnimationFrame)
       ======================================================================== */
    loop(timestamp) {
      const rawDt = (timestamp - this.lastFrameTime) / 1000;
      this.lastFrameTime = timestamp;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.1);

      if (this.screen === 'playing' && this.engine) {
        this.updateCameraPanning(dt);

        if (this.engine.state === 'playing') {
          this.engine.update(dt);
        }

        // Check if engine transitioned to victory/defeat
        if (
          !this.gameOverTriggered &&
          (this.engine.state === 'victory' || this.engine.state === 'defeat')
        ) {
          this.handleGameOver(this.engine.state);
        }

        // Keep placement preview coordinates synced with camera + mouse
        this.updatePlacementPreviewFromMouse();

        // Render battlefield & minimap
        if (this.renderer && this.engine.map) {
          this.renderer.render(this.engine, dt);
          this.renderer.renderMinimap(this.engine);
        }

        // Sync DOM HUD at ~15Hz for crisp responsiveness without layout thrashing
        this.hudSyncAccum += dt;
        if (this.hudSyncAccum >= 0.065) {
          this.hudSyncAccum = 0;
          this.syncHUD(false);
        }
      }

      requestAnimationFrame((ts) => this.loop(ts));
    }

    /* ========================================================================
       CAMERA & CANVAS RESIZING
       ======================================================================== */
    resizeCanvas() {
      if (!this.canvas || !this.battlefieldContainer || !this.renderer) return;
      const rect = this.battlefieldContainer.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width || window.innerWidth - 300));
      const h = Math.max(240, Math.floor(rect.height || window.innerHeight - 46));
      this.renderer.resize(w, h);
    }

    centerCameraOnBase() {
      if (!this.engine || !this.engine.map || !this.renderer) return;
      const playerEntities = this.engine.entities.filter(
        (e) => e.team === 'player' && !e.dead
      );
      const conyard =
        playerEntities.find((e) => e.defId === 'conyard') ||
        playerEntities.find((e) => e.defId === 'mcv') ||
        playerEntities[0];

      if (conyard) {
        this.renderer.centerOn(conyard.x, conyard.y, this.engine.map);
      } else if (this.currentMission && this.currentMission.mapConfig && this.currentMission.mapConfig.playerStart) {
        const ps = this.currentMission.mapConfig.playerStart;
        const ts = window.RA.TILE_SIZE || 40;
        this.renderer.centerOn(ps.tx * ts, ps.ty * ts, this.engine.map);
      }
    }

    handleSpacebarJump() {
      if (!this.engine || !this.engine.map || !this.renderer) return;
      const alert = this.engine.lastAlertPos;
      if (alert && typeof alert.x === 'number' && typeof alert.y === 'number') {
        const age = (this.engine.elapsedTime || 0) - (alert.time || 0);
        const isRecent = alert.time === undefined || age <= 12.0;
        if (isRecent) {
          const cam = this.renderer.camera || { x: 0, y: 0, width: 960, height: 720, zoom: 1.0 };
          const z = cam.zoom || 1.0;
          const centerWx = cam.x + (cam.width * 0.5) / z;
          const centerWy = cam.y + (cam.height * 0.5) / z;
          const distToAlert = Math.hypot(centerWx - alert.x, centerWy - alert.y);
          if (distToAlert > 60) {
            this.renderer.centerOn(alert.x, alert.y, this.engine.map);
            return;
          }
        }
      }
      this.centerCameraOnBase();
    }

    updateCameraPanning(dt) {
      if (!this.renderer || !this.engine || !this.engine.map) return;
      if (this.engine.state !== 'playing') return;

      const speed = (this.renderer.camera && this.renderer.camera.speed) || 640;
      let dx = 0;
      let dy = 0;

      if (this.keysDown.has('ArrowLeft') || this.keysDown.has('KeyA_pan')) dx -= speed * dt;
      if (this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD_pan')) dx += speed * dt;
      if (this.keysDown.has('ArrowUp') || this.keysDown.has('KeyW')) dy -= speed * dt;
      if (this.keysDown.has('ArrowDown') || this.keysDown.has('KeyS_pan')) dy += speed * dt;

      // Optional Edge Scrolling when pointer is near canvas edge
      if (this.edgeScrollEnabled && this.mouseScreen.inside && !this.dragState.active) {
        const margin = 18;
        const w = this.canvas.width;
        const h = this.canvas.height;
        if (this.mouseScreen.x < margin) dx -= speed * 0.75 * dt;
        else if (this.mouseScreen.x > w - margin) dx += speed * 0.75 * dt;
        if (this.mouseScreen.y < margin) dy -= speed * 0.75 * dt;
        else if (this.mouseScreen.y > h - margin) dy += speed * 0.75 * dt;
      }

      if (dx !== 0 || dy !== 0) {
        this.renderer.pan(dx, dy, this.engine.map);
      }
    }

    /* ========================================================================
       CURSOR MODES & PLACEMENT / TARGETING HELPERS
       ======================================================================== */
    setCursorMode(mode, payload = null) {
      this.cursorMode = mode || 'normal';
      if (this.renderer) {
        this.renderer.cursorMode = this.cursorMode;
      }

      // Reset canvas cursor classes
      if (this.canvas) {
        this.canvas.classList.remove(
          'cursor-place',
          'cursor-repair',
          'cursor-sell',
          'cursor-attackMove',
          'cursor-patrol',
          'cursor-chronoBlink',
          'cursor-superweapon'
        );
        if (this.cursorMode !== 'normal') {
          this.canvas.classList.add(`cursor-${this.cursorMode}`);
        }
      }

      // Configure mode-specific state
      if (this.cursorMode === 'place' && payload) {
        this.pendingPlacement = payload; // { category, defId, def }
        this.pendingSuperweapon = null;
        if (this.renderer) this.renderer.superweaponTargeting = null;
        this.updatePlacementPreviewFromMouse();
      } else if (this.cursorMode === 'superweapon' && payload) {
        this.pendingSuperweapon = payload; // swId
        this.pendingPlacement = null;
        if (this.renderer) {
          this.renderer.placementPreview = null;
          const world = this.renderer.screenToWorld(this.mouseScreen.x, this.mouseScreen.y);
          this.renderer.superweaponTargeting = {
            swId: payload,
            worldX: world.x,
            worldY: world.y
          };
        }
      } else {
        this.pendingPlacement = null;
        this.pendingSuperweapon = null;
        if (this.renderer) {
          this.renderer.placementPreview = null;
          this.renderer.superweaponTargeting = null;
        }
      }

      // Update Top Bar & Command Bar active button highlights
      const btnRepair = document.getElementById('btn-top-repair');
      const btnSell = document.getElementById('btn-top-sell');
      const btnAttackMove = document.getElementById('cmd-attack-move');
      const btnPatrol = document.getElementById('cmd-patrol');
      if (btnRepair) btnRepair.classList.toggle('active', this.cursorMode === 'repair');
      if (btnSell) btnSell.classList.toggle('active', this.cursorMode === 'sell');
      if (btnAttackMove) btnAttackMove.classList.toggle('active', this.cursorMode === 'attackMove');
      if (btnPatrol) btnPatrol.classList.toggle('active', this.cursorMode === 'patrol');

      // Update floating Cursor Mode badge
      if (this.elCursorBadge && this.elCursorText) {
        if (this.cursorMode === 'normal') {
          this.elCursorBadge.classList.add('hidden');
        } else {
          this.elCursorBadge.classList.remove('hidden');
          const messages = {
            place: `DEPLOYING ${(this.pendingPlacement && this.pendingPlacement.def && this.pendingPlacement.def.name) || 'STRUCTURE'} — LEFT-CLICK TO PLACE, RIGHT-CLICK TO CANCEL`,
            repair: 'REPAIR MODE [R] — LEFT-CLICK DAMAGED FRIENDLY STRUCTURE, RIGHT-CLICK TO CANCEL',
            sell: 'SELL STRUCTURE MODE [X] — LEFT-CLICK FRIENDLY STRUCTURE FOR 50% REFUND',
            attackMove: 'ATTACK-MOVE MODE [A] — LEFT-CLICK DESTINATION TO ADVANCE & ENGAGE',
            patrol: 'PATROL MODE [P] — LEFT-CLICK DESTINATION WAYPOINT TO OSCILLATE & PATROL',
            chronoBlink: 'CHRONO BLINK MODE [D] — LEFT-CLICK TARGET LOCATION WITHIN 14 TILES TO TELEPORT',
            superweapon: `TARGETING ${(this.pendingSuperweapon || '').toUpperCase()} — LEFT-CLICK TARGET SECTOR`
          };
          this.elCursorText.textContent = messages[this.cursorMode] || 'SPECIAL CURSOR MODE';
        }
      }
    }

    enterPlacementMode(category, def) {
      if (!def) return;
      this.setCursorMode('place', {
        category: def.category || category,
        defId: def.id,
        def
      });
    }

    updatePlacementPreviewFromMouse() {
      if (!this.renderer || !this.engine || !this.engine.map) return;

      if (this.cursorMode === 'place' && this.pendingPlacement) {
        const world = this.renderer.screenToWorld(this.mouseScreen.x, this.mouseScreen.y);
        const tile = this.engine.map.worldToTile(world.x, world.y);
        const def = this.pendingPlacement.def;
        const fp = (def && def.footprint) || [2, 2];
        const w = fp[0] || 2;
        const h = fp[1] || 2;
        const tx = Math.max(0, Math.min(this.engine.map.width - w, tile.tx));
        const ty = Math.max(0, Math.min(this.engine.map.height - h, tile.ty));

        this.renderer.placementPreview = {
          category: this.pendingPlacement.category,
          defId: this.pendingPlacement.defId,
          def,
          tx,
          ty
        };
      } else if (this.cursorMode === 'superweapon' && this.pendingSuperweapon) {
        const world = this.renderer.screenToWorld(this.mouseScreen.x, this.mouseScreen.y);
        this.renderer.superweaponTargeting = {
          swId: this.pendingSuperweapon,
          worldX: world.x,
          worldY: world.y
        };
      }
    }

    /* ========================================================================
       ENTITY SELECTION & HIT TESTING
       ======================================================================== */
    getSelectedEntities() {
      if (!this.engine || !this.engine.entities) return [];
      return this.engine.entities.filter((e) => !e.dead && e.selected);
    }

    getSelectedUnits() {
      return this.getSelectedEntities().filter((e) => e.isUnit && e.team === 'player');
    }

    getSelectedBuildings() {
      return this.getSelectedEntities().filter((e) => e.isBuilding && e.team === 'player');
    }

    clearSelection() {
      if (!this.engine || !this.engine.entities) return;
      for (const e of this.engine.entities) {
        e.selected = false;
      }
    }

    findEntityAtWorld(wx, wy) {
      if (!this.engine || !this.engine.entities) return null;
      const ts = window.RA.TILE_SIZE || 40;

      // 1. Check alive units first (closest within click radius, including airborne altitude offset)
      let bestUnit = null;
      let bestDist = Infinity;
      for (const e of this.engine.entities) {
        if (e.dead || !e.isUnit) continue;
        if (e.team !== 'player' && this.engine.map && !this.engine.map.isWorldPosVisible(e.x, e.y)) {
          continue;
        }
        const hitRadius = (e.radius || 15) + 8;
        const dGround = Math.hypot(e.x - wx, e.y - wy);
        const dAir = e.altitude ? Math.hypot(e.x - wx, e.y - e.altitude - wy) : dGround;
        const d = Math.min(dGround, dAir);
        if (d <= hitRadius && d < bestDist) {
          bestDist = d;
          bestUnit = e;
        }
      }
      if (bestUnit) return bestUnit;

      // 2. Check alive buildings by tile footprint
      for (const e of this.engine.entities) {
        if (e.dead || !e.isBuilding) continue;
        const x1 = e.tx * ts;
        const y1 = e.ty * ts;
        const x2 = (e.tx + (e.w || 2)) * ts;
        const y2 = (e.ty + (e.h || 2)) * ts;
        if (wx >= x1 && wx <= x2 && wy >= y1 && wy <= y2) {
          return e;
        }
      }

      return null;
    }

    deploySelected() {
      if (!this.engine) return false;
      const selectedUnits = this.getSelectedUnits();

      // 1. Check for Chrono Tanks (ctnk)
      const ctnks = selectedUnits.filter((u) => u.defId === 'ctnk');
      if (ctnks.length > 0) {
        if (this.mouseScreen.inside && this.renderer) {
          const world = this.renderer.screenToWorld(this.mouseScreen.x, this.mouseScreen.y);
          return this.triggerChronoBlink(ctnks, world.x, world.y);
        }
        this.setCursorMode(this.cursorMode === 'chronoBlink' ? 'normal' : 'chronoBlink');
        return true;
      }

      // 2. Check for M.A.D. Tanks (qtnk)
      const qtnks = selectedUnits.filter((u) => u.defId === 'qtnk');
      if (qtnks.length > 0) {
        let activated = false;
        if (typeof this.engine.deploySelected === 'function') {
          activated = Boolean(this.engine.deploySelected(qtnks));
        }
        if (!activated) {
          for (const u of qtnks) {
            if (typeof u.deploy === 'function' && u.deploy(this.engine)) {
              activated = true;
            } else {
              u.madChargeTimer = 3.0;
              activated = true;
            }
          }
        }
        if (activated) {
          this.setEvaMessage('WARNING: M.A.D. SEISMIC SHOCKWAVE CHARGING!');
          this.showNotification('M.A.D. Tank seismic charge armed — detonation in 3.0s!', false);
          this.syncHUD(true);
        }
        return activated;
      }

      // 3. Check for Mobile Construction Vehicles (mcv)
      const mcvs = selectedUnits.filter((u) => u.defId === 'mcv');
      if (mcvs.length === 0) {
        // Also check if there is an unselected player MCV if nothing is selected
        const anyMcv = this.engine.entities.find(
          (e) => !e.dead && e.team === 'player' && e.defId === 'mcv'
        );
        if (selectedUnits.length === 0 && anyMcv) {
          anyMcv.selected = true;
          mcvs.push(anyMcv);
        }
      }
      if (mcvs.length === 0) {
        this.showNotification('Select an MCV, Chrono Tank, or M.A.D. Tank to deploy [D].', false);
        return false;
      }

      const ok = this.engine.deploySelected ? this.engine.deploySelected(mcvs) : mcvs[0].deploy(this.engine);
      if (ok === false) {
        this.showNotification('Cannot deploy MCV here — clear flat 3x3 terrain required!', true);
      } else {
        this.setEvaMessage('CONSTRUCTION YARD DEPLOYED. BASE OPERATIONS ONLINE.');
        this.syncHUD(true);
      }
      return Boolean(ok);
    }

    triggerChronoBlink(ctnks, wx, wy) {
      if (!this.engine || !Array.isArray(ctnks) || ctnks.length === 0) return false;
      let blinked = false;
      for (const u of ctnks) {
        if (typeof u.chronoBlink === 'function') {
          if (u.chronoBlink(wx, wy, this.engine)) blinked = true;
        } else if (typeof this.engine.deploySelected === 'function') {
          if (this.engine.deploySelected([u], { x: wx, y: wy })) blinked = true;
        }
      }
      if (blinked) {
        if (this.audio) this.audio.playSfx('chrono');
        this.showNotification('CHRONO BLINK TELEPORT EXECUTED!', false);
        this.syncHUD(true);
      } else {
        this.showNotification('Chrono Drive recharging or target outside 14-tile range!', true);
      }
      return blinked;
    }

    setPrimarySelectedBuilding(targetBuilding = null) {
      if (!this.engine) return false;
      const producerTypes = ['barracks', 'weap', 'helipad', 'afld', 'syrd', 'spen'];
      let bld = targetBuilding;
      if (!bld) {
        const selectedBlds = this.getSelectedBuildings();
        bld = selectedBlds.find(
          (b) => producerTypes.includes(b.defId) || (b.def && b.def.produces)
        );
      }
      if (!bld || bld.team !== 'player') {
        this.showNotification(
          'Select a production structure (Barracks, War Factory, Helipad, Airfield, Naval Yard) to set as PRIMARY.',
          false
        );
        return false;
      }

      if (typeof this.engine.setPrimaryBuilding === 'function') {
        this.engine.setPrimaryBuilding(bld);
      } else {
        for (const e of this.engine.entities) {
          if (!e.dead && e.isBuilding && e.team === bld.team && e.defId === bld.defId) {
            e.isPrimary = false;
          }
        }
        bld.isPrimary = true;
      }

      if (this.audio) this.audio.playSfx('click');
      const name = (bld.def && bld.def.name) || bld.name || bld.defId.toUpperCase();
      this.showNotification(`${name} designated as PRIMARY [PRI].`, false);
      this.syncHUD(true);
      return true;
    }

    setSelectedUnitsStance(stance) {
      if (!stance || !this.engine) return;
      const units = this.getSelectedUnits();
      if (units.length === 0) {
        this.showNotification('Select combat units to set tactical stance.', false);
        return;
      }
      if (typeof this.engine.setUnitStance === 'function') {
        this.engine.setUnitStance(units, stance);
      } else {
        for (const u of units) {
          u.stance = stance;
          if (stance === 'guard') {
            u.guardOrigin = { x: u.x, y: u.y };
          }
        }
      }
      if (this.audio) this.audio.playSfx('click');
      this.syncStanceSelector(units);
      this.syncHUD(false);
    }

    syncStanceSelector(selectedUnits = null) {
      if (!this.elStanceSelector) return;
      const units = selectedUnits || this.getSelectedUnits();
      const activeStance = units.length > 0 ? units[0].stance || 'guard' : 'guard';
      this.elStanceSelector.querySelectorAll('.stance-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.stance === activeStance);
      });
    }

    scatterSelected() {
      const units = this.getSelectedUnits();
      if (units.length === 0 || !this.engine) return;
      for (const u of units) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 55 + Math.random() * 45;
        const tx = Math.max(40, Math.min(this.engine.map.pixelWidth - 40, u.x + Math.cos(angle) * dist));
        const ty = Math.max(40, Math.min(this.engine.map.pixelHeight - 40, u.y + Math.sin(angle) * dist));
        this.engine.issueOrder([u], 'move', tx, ty, null);
      }
      if (this.audio) this.audio.playSfx('move');
    }

    /* ========================================================================
       BATTLEFIELD CANVAS & MINIMAP MOUSE CONTROLLER
       ======================================================================== */
    bindCanvasEvents() {
      if (!this.canvas) return;

      this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      // Smooth Mouse-Wheel Camera Zoom (0.6x to 1.5x)
      this.canvas.addEventListener(
        'wheel',
        (e) => {
          if (!this.renderer || !this.engine || !this.engine.map) return;
          e.preventDefault();
          const rect = this.canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const curZoom = (this.renderer.camera && this.renderer.camera.zoom) || 1.0;
          if (typeof this.renderer.setZoom === 'function') {
            this.renderer.setZoom(curZoom + (e.deltaY < 0 ? 0.12 : -0.12), sx, sy, this.engine.map);
          }
          this.updatePlacementPreviewFromMouse();
        },
        { passive: false }
      );

      this.canvas.addEventListener('mouseenter', () => {
        this.mouseScreen.inside = true;
      });

      this.canvas.addEventListener('mouseleave', () => {
        this.mouseScreen.inside = false;
      });

      this.canvas.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseScreen.x = e.clientX - rect.left;
        this.mouseScreen.y = e.clientY - rect.top;
        this.mouseScreen.inside = true;

        if (this.dragState.active) {
          this.dragState.currX = this.mouseScreen.x;
          this.dragState.currY = this.mouseScreen.y;
          const dist = Math.hypot(
            this.dragState.currX - this.dragState.startX,
            this.dragState.currY - this.dragState.startY
          );
          if (dist > 6 && this.cursorMode === 'normal') {
            this.dragState.isBoxSelecting = true;
            if (this.renderer) {
              this.renderer.selectionBox = {
                x1: this.dragState.startX,
                y1: this.dragState.startY,
                x2: this.dragState.currX,
                y2: this.dragState.currY
              };
            }
          }
        }

        this.updatePlacementPreviewFromMouse();
      });

      this.canvas.addEventListener('mousedown', (e) => {
        if (!this.engine || !this.renderer) return;
        if (this.audio) this.audio.init();

        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        this.mouseScreen.x = sx;
        this.mouseScreen.y = sy;

        // RIGHT-CLICK (button === 2)
        if (e.button === 2) {
          e.preventDefault();
          this.handleRightClick(sx, sy, e);
          return;
        }

        // LEFT-CLICK (button === 0)
        if (e.button === 0) {
          if (this.cursorMode !== 'normal') {
            this.handleSpecialLeftClick(sx, sy, e);
            return;
          }

          this.dragState.active = true;
          this.dragState.startX = sx;
          this.dragState.startY = sy;
          this.dragState.currX = sx;
          this.dragState.currY = sy;
          this.dragState.isBoxSelecting = false;
        }
      });

      window.addEventListener('mouseup', (e) => {
        if (!this.dragState.active) return;
        const wasBox = this.dragState.isBoxSelecting;
        const box = {
          x1: this.dragState.startX,
          y1: this.dragState.startY,
          x2: this.dragState.currX,
          y2: this.dragState.currY
        };

        this.dragState.active = false;
        this.dragState.isBoxSelecting = false;
        if (this.renderer) {
          this.renderer.selectionBox = null;
        }

        if (e.button !== 0 || this.screen !== 'playing') return;

        if (wasBox) {
          this.handleBoxSelection(box, e.shiftKey);
        } else {
          this.handleNormalLeftClick(box.x2, box.y2, e.shiftKey);
        }
      });

      // Minimap Mouse Events
      if (this.minimapCanvas) {
        this.minimapCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

        const getMinimapWorld = (e) => {
          const rect = this.minimapCanvas.getBoundingClientRect();
          const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
          const pw = (this.engine && this.engine.map && this.engine.map.pixelWidth) || 2560;
          const ph = (this.engine && this.engine.map && this.engine.map.pixelHeight) || 2560;
          return { x: nx * pw, y: ny * ph };
        };

        this.minimapCanvas.addEventListener('mousedown', (e) => {
          if (!this.engine || !this.engine.map || !this.renderer) return;
          const world = getMinimapWorld(e);

          if (e.button === 2) {
            // Right-click on minimap issues move order to selected units (Shift queues waypoint)
            const selectedUnits = this.getSelectedUnits();
            if (selectedUnits.length > 0) {
              const queueOrder = Boolean(e && e.shiftKey);
              this.engine.issueOrder(selectedUnits, 'move', world.x, world.y, null, queueOrder);
              if (this.renderer.addMovePulse) {
                this.renderer.addMovePulse(world.x, world.y, '#22c55e');
              }
              if (this.audio) this.audio.playSfx('move');
            }
          } else if (e.button === 0) {
            this.minimapDragging = true;
            this.renderer.centerOn(world.x, world.y, this.engine.map);
          }
        });

        this.minimapCanvas.addEventListener('mousemove', (e) => {
          if (!this.minimapDragging || !this.engine || !this.engine.map || !this.renderer) return;
          const world = getMinimapWorld(e);
          this.renderer.centerOn(world.x, world.y, this.engine.map);
        });

        window.addEventListener('mouseup', () => {
          this.minimapDragging = false;
        });
      }
    }

    handleSpecialLeftClick(sx, sy, e = null) {
      const world = this.renderer.screenToWorld(sx, sy);
      const queueOrder = Boolean(e && e.shiftKey);

      // 1. PLACE BUILDING MODE
      if (this.cursorMode === 'place' && this.pendingPlacement) {
        const preview = this.renderer.placementPreview;
        const tile = this.engine.map.worldToTile(world.x, world.y);
        const tx = preview ? preview.tx : tile.tx;
        const ty = preview ? preview.ty : tile.ty;
        const cat = this.pendingPlacement.category;
        const def = this.pendingPlacement.def;

        const placed = this.engine.placeBuilding(cat, tx, ty, 'player');
        if (placed) {
          this.setCursorMode('normal');
          this.syncHUD(true);
        } else if (def && def.waterOnly) {
          this.showNotification('Cannot build Naval structure here — requires clear 3x3 WATER tiles near base!', true);
        } else {
          this.showNotification('Cannot build here — requires clear flat terrain near existing base!', true);
        }
        return;
      }

      // 2. REPAIR MODE
      if (this.cursorMode === 'repair') {
        const clicked = this.findEntityAtWorld(world.x, world.y);
        if (clicked && clicked.isBuilding && clicked.team === 'player') {
          this.engine.toggleRepair(clicked);
          this.syncHUD(true);
        } else {
          this.showNotification('Click a friendly structure to toggle repair.', false);
        }
        return;
      }

      // 3. SELL MODE
      if (this.cursorMode === 'sell') {
        const clicked = this.findEntityAtWorld(world.x, world.y);
        if (clicked && clicked.isBuilding && clicked.team === 'player') {
          this.engine.sellBuilding(clicked);
          this.setCursorMode('normal');
          this.syncHUD(true);
        } else {
          this.showNotification('Click a friendly structure to sell for 50% refund.', false);
        }
        return;
      }

      // 4. SUPERWEAPON TARGETING MODE
      if (this.cursorMode === 'superweapon' && this.pendingSuperweapon) {
        const selectedUnits = this.getSelectedUnits();
        const ok = this.engine.activateSuperweapon(
          this.pendingSuperweapon,
          world.x,
          world.y,
          selectedUnits
        );
        if (ok !== false) {
          this.setCursorMode('normal');
          this.syncHUD(true);
        }
        return;
      }

      // 5. ATTACK-MOVE MODE
      if (this.cursorMode === 'attackMove') {
        const selectedUnits = this.getSelectedUnits();
        if (selectedUnits.length > 0) {
          this.engine.issueOrder(selectedUnits, 'attackMove', world.x, world.y, null, queueOrder);
          if (this.renderer.addMovePulse) {
            this.renderer.addMovePulse(world.x, world.y, '#ef4444');
          }
          if (this.audio) this.audio.playSfx('move');
        }
        this.setCursorMode('normal');
        return;
      }

      // 6. PATROL MODE
      if (this.cursorMode === 'patrol') {
        const selectedUnits = this.getSelectedUnits();
        if (selectedUnits.length > 0) {
          this.engine.issueOrder(selectedUnits, 'patrol', world.x, world.y, null, queueOrder);
          if (this.renderer.addMovePulse) {
            this.renderer.addMovePulse(world.x, world.y, '#38bdf8');
          }
          if (this.audio) this.audio.playSfx('move');
        }
        this.setCursorMode('normal');
        return;
      }

      // 7. CHRONO BLINK MODE
      if (this.cursorMode === 'chronoBlink') {
        const ctnks = this.getSelectedUnits().filter((u) => u.defId === 'ctnk');
        if (ctnks.length > 0) {
          this.triggerChronoBlink(ctnks, world.x, world.y);
        }
        this.setCursorMode('normal');
      }
    }

    handleNormalLeftClick(sx, sy, shiftKey) {
      const world = this.renderer.screenToWorld(sx, sy);
      const clicked = this.findEntityAtWorld(world.x, world.y);
      const now = performance.now();

      if (clicked && clicked.team === 'player') {
        const isDoubleClick =
          this.lastClickedEntityId === clicked.id && now - this.lastClickTime < 340;
        this.lastClickTime = now;
        this.lastClickedEntityId = clicked.id;

        if (isDoubleClick && clicked.isBuilding) {
          const producerTypes = ['barracks', 'weap', 'helipad', 'afld', 'syrd', 'spen'];
          if (producerTypes.includes(clicked.defId) || (clicked.def && clicked.def.produces)) {
            clicked.selected = true;
            this.setPrimarySelectedBuilding(clicked);
            return;
          }
        }

        if (isDoubleClick && clicked.isUnit) {
          if (clicked.defId === 'mcv' || clicked.defId === 'qtnk') {
            clicked.selected = true;
            this.deploySelected();
            return;
          }
          // Select all visible friendly units of same defId
          this.clearSelection();
          for (const e of this.engine.entities) {
            if (!e.dead && e.isUnit && e.team === 'player' && e.defId === clicked.defId) {
              const scr = this.renderer.worldToScreen(e.x, e.y - (e.altitude || 0));
              if (
                scr.x >= 0 &&
                scr.x <= this.canvas.width &&
                scr.y >= 0 &&
                scr.y <= this.canvas.height
              ) {
                e.selected = true;
              }
            }
          }
          if (this.audio) this.audio.playSfx('select');
          this.syncHUD(true);
          return;
        }

        if (!shiftKey) {
          this.clearSelection();
        }
        clicked.selected = true;
        if (this.audio) this.audio.playSfx('select');
      } else if (!shiftKey) {
        this.clearSelection();
        this.lastClickedEntityId = null;
      }

      this.syncHUD(true);
    }

    handleBoxSelection(box, shiftKey) {
      const minX = Math.min(box.x1, box.x2);
      const maxX = Math.max(box.x1, box.x2);
      const minY = Math.min(box.y1, box.y2);
      const maxY = Math.max(box.y1, box.y2);

      if (!shiftKey) {
        this.clearSelection();
      }

      let foundUnit = false;
      for (const e of this.engine.entities) {
        if (e.dead || !e.isUnit || e.team !== 'player') continue;
        const scr = this.renderer.worldToScreen(e.x, e.y);
        const scrAir = e.altitude ? this.renderer.worldToScreen(e.x, e.y - e.altitude) : scr;
        const inGround = scr.x >= minX && scr.x <= maxX && scr.y >= minY && scr.y <= maxY;
        const inAir = scrAir.x >= minX && scrAir.x <= maxX && scrAir.y >= minY && scrAir.y <= maxY;
        if (inGround || inAir) {
          e.selected = true;
          foundUnit = true;
        }
      }

      if (foundUnit && this.audio) {
        this.audio.playSfx('select');
      }
      this.syncHUD(true);
    }

    handleRightClick(sx, sy, e = null) {
      // 1. If in special cursor mode, cancel back to normal
      if (this.cursorMode !== 'normal') {
        this.setCursorMode('normal');
        return;
      }

      const queueOrder = Boolean(e && e.shiftKey);
      const world = this.renderer.screenToWorld(sx, sy);
      const clickedEntity = this.findEntityAtWorld(world.x, world.y);
      const selectedUnits = this.getSelectedUnits();
      const selectedBuildings = this.getSelectedBuildings();

      // 2. If friendly units are selected, issue contextual tactical orders
      if (selectedUnits.length > 0) {
        // Right-click on an enemy unit or building
        if (clickedEntity && clickedEntity.team !== 'player') {
          const engineers = selectedUnits.filter((u) => u.defId === 'engineer');
          const infiltrators = selectedUnits.filter((u) => u.defId === 'spy' || u.defId === 'thf');
          const others = selectedUnits.filter(
            (u) => u.defId !== 'engineer' && u.defId !== 'spy' && u.defId !== 'thf'
          );

          if (engineers.length > 0 && clickedEntity.isBuilding) {
            this.engine.issueOrder(
              engineers,
              'capture',
              clickedEntity.x,
              clickedEntity.y,
              clickedEntity,
              queueOrder
            );
          }
          if (infiltrators.length > 0 && clickedEntity.isBuilding) {
            this.engine.issueOrder(
              infiltrators,
              'infiltrate',
              clickedEntity.x,
              clickedEntity.y,
              clickedEntity,
              queueOrder
            );
          }
          if (others.length > 0) {
            this.engine.issueOrder(
              others,
              'attack',
              clickedEntity.x,
              clickedEntity.y,
              clickedEntity,
              queueOrder
            );
          }
          if (this.renderer.addMovePulse) {
            this.renderer.addMovePulse(clickedEntity.x, clickedEntity.y, '#ef4444');
          }
          if (this.audio) this.audio.playSfx('move');
          return;
        }

        // Right-click on friendly building (Refinery for Harvester OR damaged building for Engineer)
        if (clickedEntity && clickedEntity.team === 'player' && clickedEntity.isBuilding) {
          const harvesters = selectedUnits.filter((u) => u.defId === 'harvester');
          const engineers = selectedUnits.filter((u) => u.defId === 'engineer');

          if (clickedEntity.defId === 'refinery' && harvesters.length > 0) {
            this.engine.issueOrder(
              harvesters,
              'returnOre',
              clickedEntity.x,
              clickedEntity.y,
              clickedEntity,
              queueOrder
            );
            if (this.renderer.addMovePulse) {
              this.renderer.addMovePulse(clickedEntity.x, clickedEntity.y, '#f59e0b');
            }
            if (this.audio) this.audio.playSfx('move');
            return;
          }

          if (engineers.length > 0 && clickedEntity.hp < clickedEntity.maxHp) {
            this.engine.issueOrder(
              engineers,
              'capture',
              clickedEntity.x,
              clickedEntity.y,
              clickedEntity,
              queueOrder
            );
            if (this.audio) this.audio.playSfx('repair');
            return;
          }
        }

        // Check tile for Bridge Repair Hut / demolished bridge OR Ore / Gems
        const tileCoord = this.engine.map.worldToTile(world.x, world.y);
        const tile = this.engine.map.getTile(tileCoord.tx, tileCoord.ty);

        // Right-clicking a demolished bridge or Bridge Repair Hut with an Engineer selected
        const engineers = selectedUnits.filter((u) => u.defId === 'engineer');
        if (engineers.length > 0 && tile) {
          let isBridgeRepairTarget = Boolean(tile.hasBridgeHut || tile.demolishedBridge);
          if (!isBridgeRepairTarget && this.engine.map) {
            for (let dy = -1; dy <= 1 && !isBridgeRepairTarget; dy++) {
              for (let dx = -1; dx <= 1 && !isBridgeRepairTarget; dx++) {
                const nt = this.engine.map.getTile(tileCoord.tx + dx, tileCoord.ty + dy);
                if (nt && (nt.hasBridgeHut || nt.demolishedBridge)) {
                  isBridgeRepairTarget = true;
                }
              }
            }
          }
          if (isBridgeRepairTarget) {
            const nonEngineers = selectedUnits.filter((u) => u.defId !== 'engineer');
            this.engine.issueOrder(engineers, 'repairBridge', world.x, world.y, null, queueOrder);
            if (nonEngineers.length > 0) {
              this.engine.issueOrder(nonEngineers, 'move', world.x, world.y, null, queueOrder);
            }
            if (this.renderer.addMovePulse) {
              this.renderer.addMovePulse(world.x, world.y, '#38bdf8');
            }
            if (this.audio) this.audio.playSfx('repair');
            return;
          }
        }

        // Right-click on Ore or Gems tile with Harvester selected
        const harvesters = selectedUnits.filter((u) => u.defId === 'harvester');
        if (tile && tile.oreAmount > 0 && harvesters.length > 0) {
          const nonHarvesters = selectedUnits.filter((u) => u.defId !== 'harvester');
          this.engine.issueOrder(harvesters, 'harvest', world.x, world.y, null, queueOrder);
          if (nonHarvesters.length > 0) {
            this.engine.issueOrder(nonHarvesters, 'move', world.x, world.y, null, queueOrder);
          }
          if (this.renderer.addMovePulse) {
            this.renderer.addMovePulse(world.x, world.y, '#f59e0b');
          }
          if (this.audio) this.audio.playSfx('move');
          return;
        }

        // Standard terrain Move order
        this.engine.issueOrder(selectedUnits, 'move', world.x, world.y, null, queueOrder);
        if (this.renderer.addMovePulse) {
          this.renderer.addMovePulse(world.x, world.y, '#22c55e');
        }
        if (this.audio) this.audio.playSfx('move');
        return;
      }

      // 3. If a production building is selected, set its Rally Point!
      if (selectedBuildings.length > 0) {
        let rallySet = false;
        const producerTypes = ['barracks', 'weap', 'helipad', 'afld', 'syrd', 'spen'];
        for (const b of selectedBuildings) {
          if (b.rallyPoint || producerTypes.includes(b.defId) || (b.def && b.def.produces)) {
            b.rallyPoint = { x: world.x, y: world.y };
            rallySet = true;
          }
        }
        if (rallySet) {
          if (this.renderer.addMovePulse) {
            this.renderer.addMovePulse(world.x, world.y, '#3b82f6');
          }
          this.showNotification('Rally point updated.', false);
        }
      }
    }

    /* ========================================================================
       KEYBOARD CONTROLLER & CONTROL GROUPS
       ======================================================================== */
    bindKeyboardEvents() {
      window.addEventListener('keydown', (e) => {
        if (this.screen !== 'playing' || !this.engine) return;

        // Quicksave [F5] & Quickload [F9]
        if (e.code === 'F5' || e.key === 'F5') {
          e.preventDefault();
          this.quickSave();
          return;
        }
        if (e.code === 'F9' || e.key === 'F9') {
          e.preventDefault();
          this.quickLoad();
          return;
        }

        // Camera Panning keys
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
          this.keysDown.add(e.code);
        }
        if (e.code === 'KeyW') this.keysDown.add('KeyW');

        // Control Groups 1..9
        if (e.code >= 'Digit1' && e.code <= 'Digit9') {
          const num = Number(e.code.replace('Digit', ''));
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.assignControlGroup(num);
          } else {
            this.recallControlGroup(num);
          }
          return;
        }

        if (e.code === 'Space' || e.key === ' ') {
          e.preventDefault();
          this.handleSpacebarJump();
          return;
        }

        if (e.code === 'KeyH' || e.key === 'h' || e.key === 'H') {
          e.preventDefault();
          this.centerCameraOnBase();
          return;
        }

        switch (e.code) {
          case 'Escape': {
            e.preventDefault();
            if (this.cursorMode !== 'normal') {
              this.setCursorMode('normal');
            } else if (this.getSelectedEntities().length > 0 && this.engine.state === 'playing') {
              this.clearSelection();
              this.syncHUD(true);
            } else {
              this.togglePauseModal();
            }
            break;
          }
          case 'KeyD': {
            const selectedUnits = this.getSelectedUnits();
            if (
              selectedUnits.some(
                (u) => u.defId === 'mcv' || u.defId === 'ctnk' || u.defId === 'qtnk'
              )
            ) {
              this.deploySelected();
            } else {
              this.keysDown.add('KeyD_pan');
            }
            break;
          }
          case 'KeyA': {
            if (this.getSelectedUnits().length > 0) {
              this.setCursorMode(this.cursorMode === 'attackMove' ? 'normal' : 'attackMove');
            } else {
              this.keysDown.add('KeyA_pan');
            }
            break;
          }
          case 'KeyP': {
            if (this.getSelectedUnits().length > 0) {
              this.setCursorMode(this.cursorMode === 'patrol' ? 'normal' : 'patrol');
            }
            break;
          }
          case 'KeyS': {
            const selectedUnits = this.getSelectedUnits();
            if (selectedUnits.length > 0) {
              this.engine.issueOrder(selectedUnits, 'stop', 0, 0, null);
              for (const u of selectedUnits) {
                u.state = 'idle';
                u.path = [];
                u.targetEntity = null;
              }
            } else {
              this.keysDown.add('KeyS_pan');
            }
            break;
          }
          case 'KeyG': {
            this.scatterSelected();
            break;
          }
          case 'KeyR': {
            this.setCursorMode(this.cursorMode === 'repair' ? 'normal' : 'repair');
            break;
          }
          case 'KeyX': {
            this.setCursorMode(this.cursorMode === 'sell' ? 'normal' : 'sell');
            break;
          }
          case 'KeyF': {
            this.toggleFogOfWar();
            break;
          }
          case 'KeyM': {
            this.toggleAudioMute();
            break;
          }
        }
      });

      window.addEventListener('keyup', (e) => {
        this.keysDown.delete(e.code);
        if (e.code === 'KeyA') this.keysDown.delete('KeyA_pan');
        if (e.code === 'KeyD') this.keysDown.delete('KeyD_pan');
        if (e.code === 'KeyS') this.keysDown.delete('KeyS_pan');
        if (e.code === 'KeyW') this.keysDown.delete('KeyW');
      });

      window.addEventListener('resize', () => {
        if (this.screen === 'playing') {
          this.resizeCanvas();
        }
      });
    }

    assignControlGroup(num) {
      const units = this.getSelectedUnits();
      if (units.length === 0) return;
      this.controlGroups[num] = units.map((u) => u.id);
      this.updateControlGroupsBar();
      this.showNotification(`Squad #${num} assigned (${units.length} units).`, false);
    }

    recallControlGroup(num) {
      const ids = this.controlGroups[num] || [];
      if (ids.length === 0 || !this.engine) return;
      const alive = this.engine.entities.filter(
        (e) => !e.dead && e.team === 'player' && ids.includes(e.id)
      );
      if (alive.length === 0) {
        this.controlGroups[num] = [];
        this.updateControlGroupsBar();
        return;
      }
      this.clearSelection();
      for (const u of alive) {
        u.selected = true;
      }
      if (this.audio) this.audio.playSfx('select');
      this.syncHUD(true);
    }

    updateControlGroupsBar() {
      if (!this.elControlGroupsBar) return;
      this.elControlGroupsBar.innerHTML = '';
      for (let i = 1; i <= 5; i++) {
        const ids = (this.controlGroups[i] || []).filter((id) =>
          this.engine && this.engine.entities
            ? this.engine.entities.some((e) => !e.dead && e.id === id)
            : false
        );
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'ctrl-group-pill' + (ids.length > 0 ? ' has-units' : '');
        pill.textContent = `[${i}] ${ids.length || '-'}`;
        pill.addEventListener('click', () => this.recallControlGroup(i));
        this.elControlGroupsBar.appendChild(pill);
      }
    }

    /* ========================================================================
       UI BUTTONS & MODAL EVENT BINDINGS
       ======================================================================== */
    bindUIEvents() {
      // Main Menu Faction Selector Cards
      document.querySelectorAll('.faction-card').forEach((card) => {
        card.addEventListener('click', () => {
          this.selectFaction(card.dataset.faction);
        });
      });

      // Mode Tabs
      const tabCampaign = document.getElementById('tab-campaign');
      const tabSkirmish = document.getElementById('tab-skirmish');
      if (tabCampaign) tabCampaign.addEventListener('click', () => this.selectMode('campaign'));
      if (tabSkirmish) tabSkirmish.addEventListener('click', () => this.selectMode('skirmish'));

      // Skirmish Segmented Controls
      this.bindSegmentedControl('skirmish-difficulty', (btn) => {
        this.skirmishOptions.difficulty = btn.dataset.difficulty || 'medium';
      });
      this.bindSegmentedControl('skirmish-credits', (btn) => {
        this.skirmishOptions.credits = Number(btn.dataset.credits || 8000);
      });
      this.bindSegmentedControl('skirmish-fog', (btn) => {
        this.skirmishOptions.fog = btn.dataset.fog === 'true';
      });
      this.bindSegmentedControl('skirmish-theater', (btn) => {
        this.skirmishOptions.theater = btn.dataset.theater || 'temperate';
      });
      this.bindSegmentedControl('skirmish-ai-count', (btn) => {
        this.skirmishOptions.aiCount = Number(btn.dataset.aiCount || 1);
      });
      this.bindSegmentedControl('skirmish-ai-doctrine', (btn) => {
        this.skirmishOptions.aiDoctrine = btn.dataset.doctrine || 'balanced';
      });

      // Main Menu CTAs
      const btnBriefing = document.getElementById('btn-launch-briefing');
      const btnSkirmish = document.getElementById('btn-instant-skirmish');
      const btnControls = document.getElementById('btn-controls-manual');
      if (btnBriefing) btnBriefing.addEventListener('click', () => this.openBriefing(false));
      if (btnSkirmish) btnSkirmish.addEventListener('click', () => this.startInstantSkirmish());
      if (btnControls) {
        btnControls.addEventListener('click', () => {
          if (this.elControlsModal) this.elControlsModal.classList.remove('hidden');
        });
      }

      // Briefing Buttons
      const btnBackMenu = document.getElementById('btn-back-menu');
      const btnDeploy = document.getElementById('btn-deploy-battlefield');
      if (btnBackMenu) btnBackMenu.addEventListener('click', () => this.showScreen('menu'));
      if (btnDeploy) btnDeploy.addEventListener('click', () => this.deployToBattlefield());

      // Top HUD Quick-Action Buttons
      const btnTopRepair = document.getElementById('btn-top-repair');
      const btnTopSell = document.getElementById('btn-top-sell');
      const btnTopDeploy = document.getElementById('btn-top-deploy');
      const btnTopFog = document.getElementById('btn-top-fog');
      const btnTopAudio = document.getElementById('btn-top-audio');
      const btnTopPause = document.getElementById('btn-top-pause');

      if (btnTopRepair) {
        btnTopRepair.addEventListener('click', () => {
          const selectedBlds = this.getSelectedBuildings();
          if (selectedBlds.length === 1 && selectedBlds[0].hp < selectedBlds[0].maxHp) {
            this.engine.toggleRepair(selectedBlds[0]);
            this.syncHUD(true);
          } else {
            this.setCursorMode(this.cursorMode === 'repair' ? 'normal' : 'repair');
          }
        });
      }

      if (btnTopSell) {
        btnTopSell.addEventListener('click', () => {
          this.setCursorMode(this.cursorMode === 'sell' ? 'normal' : 'sell');
        });
      }

      if (btnTopDeploy) {
        btnTopDeploy.addEventListener('click', () => this.deploySelected());
      }

      if (btnTopFog) {
        btnTopFog.addEventListener('click', () => this.toggleFogOfWar());
      }

      if (btnTopAudio) {
        btnTopAudio.addEventListener('click', () => this.toggleAudioMute());
      }

      if (btnTopPause) {
        btnTopPause.addEventListener('click', () => this.togglePauseModal());
      }

      // Bottom Command Bar Buttons
      const cmdMove = document.getElementById('cmd-move');
      const cmdAttackMove = document.getElementById('cmd-attack-move');
      const cmdPatrol = document.getElementById('cmd-patrol');
      const cmdStop = document.getElementById('cmd-stop');
      const cmdDeploy = document.getElementById('cmd-deploy');
      const cmdPrimary = document.getElementById('cmd-primary');
      const cmdScatter = document.getElementById('cmd-scatter');
      const cmdHome = document.getElementById('cmd-home');

      if (cmdMove) {
        cmdMove.addEventListener('click', () => {
          this.setCursorMode('normal');
          this.showNotification('Right-click anywhere on the battlefield to move selected units.', false);
        });
      }
      if (cmdAttackMove) {
        cmdAttackMove.addEventListener('click', () => {
          this.setCursorMode(this.cursorMode === 'attackMove' ? 'normal' : 'attackMove');
        });
      }
      if (cmdPatrol) {
        cmdPatrol.addEventListener('click', () => {
          this.setCursorMode(this.cursorMode === 'patrol' ? 'normal' : 'patrol');
        });
      }
      if (cmdStop) {
        cmdStop.addEventListener('click', () => {
          const units = this.getSelectedUnits();
          if (units.length > 0 && this.engine) {
            this.engine.issueOrder(units, 'stop', 0, 0, null);
            for (const u of units) {
              u.state = 'idle';
              u.path = [];
              u.targetEntity = null;
            }
          }
        });
      }
      if (cmdDeploy) {
        cmdDeploy.addEventListener('click', () => this.deploySelected());
      }
      if (cmdPrimary) {
        cmdPrimary.addEventListener('click', () => this.setPrimarySelectedBuilding());
      }
      if (cmdScatter) {
        cmdScatter.addEventListener('click', () => this.scatterSelected());
      }
      if (cmdHome) {
        cmdHome.addEventListener('click', () => this.handleSpacebarJump());
      }

      // Unit Stance Selector Buttons (#stance-selector)
      if (this.elStanceSelector) {
        this.elStanceSelector.querySelectorAll('.stance-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            this.setSelectedUnitsStance(btn.dataset.stance || 'guard');
          });
        });
      }

      // Sidebar 4-Tab Production Selector
      document.querySelectorAll('.prod-tab').forEach((tabBtn) => {
        tabBtn.addEventListener('click', () => {
          this.activeTab = tabBtn.dataset.tab || 'building';
          document.querySelectorAll('.prod-tab').forEach((b) => {
            b.classList.toggle('active', b === tabBtn);
          });
          if (this.audio) this.audio.playSfx('click');
          this.syncHUD(true);
        });
      });

      // Pause & Controls Modals
      const btnResume = document.getElementById('btn-resume-game');
      const btnQuicksave = document.getElementById('btn-quicksave');
      const btnQuickload = document.getElementById('btn-quickload');
      const btnExportSave = document.getElementById('btn-export-save');
      const btnImportSave = document.getElementById('btn-import-save');
      const inputImportSave = document.getElementById('input-import-save');
      const btnPauseControls = document.getElementById('btn-pause-controls');
      const btnRestart = document.getElementById('btn-restart-mission');
      const btnAbort = document.getElementById('btn-abort-mission');
      const btnCloseControls = document.getElementById('btn-close-controls');

      if (btnResume) btnResume.addEventListener('click', () => this.togglePauseModal(false));
      if (btnQuicksave) {
        btnQuicksave.addEventListener('click', () => {
          this.quickSave();
        });
      }
      if (btnQuickload) {
        btnQuickload.addEventListener('click', () => {
          this.quickLoad();
        });
      }
      if (btnExportSave) {
        btnExportSave.addEventListener('click', () => {
          this.exportSaveJSON();
        });
      }
      if (btnImportSave && inputImportSave) {
        btnImportSave.addEventListener('click', () => {
          inputImportSave.value = '';
          inputImportSave.click();
        });
        inputImportSave.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) {
            this.importSaveJSON(file);
          }
        });
      }
      if (btnPauseControls) {
        btnPauseControls.addEventListener('click', () => {
          if (this.elControlsModal) this.elControlsModal.classList.remove('hidden');
        });
      }
      if (btnRestart) {
        btnRestart.addEventListener('click', () => {
          this.togglePauseModal(false);
          if (this.currentMission) {
            this.launchMission(this.currentMission, this.currentCustomOptions);
          }
        });
      }
      if (btnAbort) {
        btnAbort.addEventListener('click', () => {
          this.togglePauseModal(false);
          if (this.audio) this.audio.stopMusic();
          this.engine.state = 'menu';
          this.showScreen('menu');
        });
      }
      if (btnCloseControls) {
        btnCloseControls.addEventListener('click', () => {
          if (this.elControlsModal) this.elControlsModal.classList.add('hidden');
        });
      }

      // Volume Sliders
      const sliderSfx = document.getElementById('slider-sfx-volume');
      const sliderMusic = document.getElementById('slider-music-volume');
      const lblSfx = document.getElementById('sfx-volume-label');
      const lblMusic = document.getElementById('music-volume-label');

      const updateVolumes = () => {
        const sfxVal = sliderSfx ? Number(sliderSfx.value) / 100 : 0.75;
        const musicVal = sliderMusic ? Number(sliderMusic.value) / 100 : 0.45;
        if (lblSfx && sliderSfx) lblSfx.textContent = `${sliderSfx.value}%`;
        if (lblMusic && sliderMusic) lblMusic.textContent = `${sliderMusic.value}%`;
        if (this.audio && this.audio.setVolume) {
          this.audio.setVolume(sfxVal, musicVal);
        }
      };
      if (sliderSfx) sliderSfx.addEventListener('input', updateVolumes);
      if (sliderMusic) sliderMusic.addEventListener('input', updateVolumes);

      // Game Over Debriefing Screen Buttons
      const btnNextMission = document.getElementById('btn-next-mission');
      const btnReplayMission = document.getElementById('btn-replay-mission');
      const btnGameoverMenu = document.getElementById('btn-gameover-menu');

      if (btnNextMission) {
        btnNextMission.addEventListener('click', () => {
          const missions = (window.RA.DATA && window.RA.DATA.MISSIONS) || [];
          if (this.selectedMode === 'campaign' && missions.length > 0) {
            this.selectedMissionIndex = (this.selectedMissionIndex + 1) % missions.length;
            this.selectMission(this.selectedMissionIndex);
            this.openBriefing(false);
          } else {
            this.startInstantSkirmish();
          }
        });
      }
      if (btnReplayMission) {
        btnReplayMission.addEventListener('click', () => {
          if (this.currentMission) {
            this.launchMission(this.currentMission, this.currentCustomOptions);
          }
        });
      }
      if (btnGameoverMenu) {
        btnGameoverMenu.addEventListener('click', () => {
          if (this.audio) this.audio.stopMusic();
          this.showScreen('menu');
        });
      }
    }

    bindSegmentedControl(containerId, onSelect) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const buttons = container.querySelectorAll('.seg-btn');
      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          buttons.forEach((b) => b.classList.toggle('active', b === btn));
          if (this.audio) this.audio.playSfx('click');
          onSelect(btn);
        });
      });
    }

    toggleFogOfWar() {
      if (!this.engine || !this.engine.map) return;
      this.engine.map.fogEnabled = !this.engine.map.fogEnabled;
      this.engine.map.updateFog(this.engine.entities, 'player', !this.engine.map.fogEnabled);
      const btnFog = document.getElementById('btn-top-fog');
      if (btnFog) btnFog.classList.toggle('active', !this.engine.map.fogEnabled);
      this.showNotification(
        this.engine.map.fogEnabled ? 'Fog of War: ENABLED' : 'Fog of War: REVEALED',
        false
      );
    }

    toggleAudioMute() {
      if (!this.audio) return;
      this.audio.init();
      this.audio.toggleMute();
      const btnAudio = document.getElementById('btn-top-audio');
      if (btnAudio) {
        btnAudio.classList.toggle('active', !this.audio.enabled);
      }
      this.showNotification(this.audio.enabled ? 'Audio Systems: ONLINE' : 'Audio Systems: MUTED', false);
    }

    togglePauseModal(forceState) {
      if (!this.engine || !this.elPauseModal) return;
      const shouldPause =
        typeof forceState === 'boolean' ? forceState : this.engine.state !== 'paused';

      if (shouldPause) {
        this.engine.state = 'paused';
        const listEl = document.getElementById('pause-objectives-list');
        if (listEl && this.currentMission) {
          listEl.innerHTML = '';
          (this.currentMission.objectives || ['Eliminate all enemy forces.']).forEach((obj) => {
            const li = document.createElement('li');
            li.textContent = obj;
            listEl.appendChild(li);
          });
        }
        this.elPauseModal.classList.remove('hidden');
      } else {
        this.engine.state = 'playing';
        this.elPauseModal.classList.add('hidden');
      }
    }

    /* ========================================================================
       QUICKSAVE [F5], QUICKLOAD [F9] & JSON SAVE EXPORT / IMPORT
       ======================================================================== */
    quickSave() {
      if (!this.engine || typeof this.engine.serializeState !== 'function') {
        this.showNotification('Save system unavailable.', true);
        return false;
      }
      try {
        const snapshot = this.engine.serializeState();
        localStorage.setItem('ra_quicksave_v2', JSON.stringify(snapshot));
        if (this.audio) {
          this.audio.init();
          this.audio.playSfx('quicksave');
        }
        this.showNotification('QUICKSAVE COMPLETE [F5]', false);
        this.setEvaMessage('TACTICAL STATE SAVED TO LOCAL TELEMETRY [F5].');
        return true;
      } catch (err) {
        console.error('Quicksave failed:', err);
        this.showNotification('Quicksave failed: storage error.', true);
        return false;
      }
    }

    quickLoad() {
      if (!this.engine || typeof this.engine.deserializeState !== 'function') {
        this.showNotification('Load system unavailable.', true);
        return false;
      }
      try {
        const raw = localStorage.getItem('ra_quicksave_v2');
        if (!raw) {
          this.showNotification('No Quicksave found in slot [F9].', true);
          return false;
        }
        const snapshot = JSON.parse(raw);
        this.engine.deserializeState(snapshot);
        if (snapshot.customOptions) {
          this.currentCustomOptions = snapshot.customOptions;
        }
        if (this.engine.currentMission) {
          this.currentMission = this.engine.currentMission;
        }
        if (this.engine.teams && this.engine.teams.player && this.engine.teams.player.faction) {
          this.applyFactionTheme(this.engine.teams.player.faction);
        }
        this.togglePauseModal(false);
        if (this.audio) {
          this.audio.init();
          this.audio.playSfx('quicksave');
        }
        this.showNotification('QUICKLOAD RESTORED [F9]', false);
        this.setEvaMessage('TACTICAL STATE RESTORED FROM TELEMETRY [F9].');
        this.syncHUD(true);
        return true;
      } catch (err) {
        console.error('Quickload failed:', err);
        this.showNotification('Quickload failed: invalid save data.', true);
        return false;
      }
    }

    exportSaveJSON() {
      if (!this.engine || typeof this.engine.serializeState !== 'function') {
        this.showNotification('Export unavailable.', true);
        return false;
      }
      try {
        const snapshot = this.engine.serializeState();
        const json = JSON.stringify(snapshot, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `red-alert-save-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (this.audio) {
          this.audio.init();
          this.audio.playSfx('quicksave');
        }
        this.showNotification('SAVE EXPORTED TO JSON', false);
        return true;
      } catch (err) {
        console.error('Export save failed:', err);
        this.showNotification('Failed to export save JSON.', true);
        return false;
      }
    }

    importSaveJSON(file) {
      if (!file || !this.engine || typeof this.engine.deserializeState !== 'function') return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const snapshot = JSON.parse(String(e.target.result || ''));
          this.engine.deserializeState(snapshot);
          if (snapshot.customOptions) {
            this.currentCustomOptions = snapshot.customOptions;
          }
          if (this.engine.currentMission) {
            this.currentMission = this.engine.currentMission;
          }
          if (this.engine.teams && this.engine.teams.player && this.engine.teams.player.faction) {
            this.applyFactionTheme(this.engine.teams.player.faction);
          }
          this.togglePauseModal(false);
          if (this.audio) {
            this.audio.init();
            this.audio.playSfx('quicksave');
          }
          this.showNotification('SAVE JSON IMPORTED SUCCESSFULLY', false);
          this.syncHUD(true);
        } catch (err) {
          console.error('Import save failed:', err);
          this.showNotification('Invalid save JSON file.', true);
        }
      };
      reader.readAsText(file);
    }

    /* ========================================================================
       HUD SYNCHRONIZATION (TOP BAR, SIDEBAR PRODUCTION, SUPERWEAPONS, INSPECTOR)
       ======================================================================== */
    syncHUD(forceRebuild = false) {
      if (!this.engine || !this.engine.teams || !this.engine.teams.player) return;
      const player = this.engine.teams.player;

      // 1. Top Bar Readouts
      if (this.elCredits) {
        this.elCredits.textContent = '$' + Math.floor(player.credits || 0).toLocaleString();
      }

      const prod = Math.floor(player.powerProduced || 0);
      const cons = Math.floor(player.powerConsumed || 0);
      const isLowPower = Boolean(player.lowPower || cons > prod);

      if (this.elPower) {
        this.elPower.textContent = `${prod} / ${cons}`;
        this.elPower.classList.toggle('phosphor-red', isLowPower);
        this.elPower.classList.toggle('phosphor-amber', !isLowPower);
      }

      if (this.elTimer) {
        this.elTimer.textContent = this.formatTime(this.engine.elapsedTime || 0);
      }

      // 2. Vertical Power Meter Bar
      const maxPowerScale = Math.max(200, prod, cons);
      const fillPct = Math.min(100, Math.round((prod / maxPowerScale) * 100));
      const demandPct = Math.min(98, Math.round((cons / maxPowerScale) * 100));
      if (this.elPowerFill) {
        this.elPowerFill.style.height = `${fillPct}%`;
        this.elPowerFill.classList.toggle('low', isLowPower);
      }
      if (this.elPowerDemand) {
        this.elPowerDemand.style.bottom = `${demandPct}%`;
      }
      if (this.elPowerTag) {
        this.elPowerTag.textContent = isLowPower ? 'LOW' : 'OK';
        this.elPowerTag.style.color = isLowPower ? 'var(--phosphor-red)' : 'var(--phosphor-green)';
      }

      // 3. Radar Status Badge
      if (this.elRadarBadge) {
        if (player.hasRadar && !isLowPower) {
          this.elRadarBadge.textContent = 'RADAR ACTIVE';
          this.elRadarBadge.className = 'radar-badge online';
        } else if (player.hasRadar && isLowPower) {
          this.elRadarBadge.textContent = 'LOW POWER';
          this.elRadarBadge.className = 'radar-badge low-power';
        } else {
          this.elRadarBadge.textContent = 'NO RADAR DOME';
          this.elRadarBadge.className = 'radar-badge';
        }
      }

      // 4. Check if a building/defense queue item just finished and became readyToPlace
      this.checkReadyToPlaceAlert(player);

      // 5. Sync Production Grid, Superweapons & Selected Entity Inspector
      this.syncProductionGrid(player, forceRebuild);
      this.syncSuperweaponsPanel(player);
      this.syncSelectionInspector();
      this.updateControlGroupsBar();
    }

    checkReadyToPlaceAlert(player) {
      if (!player || !player.queues) return;
      ['building', 'defense'].forEach((cat) => {
        const q = player.queues[cat];
        if (q && q.readyToPlace) {
          if (this.readyNotified[cat] !== q.defId) {
            this.readyNotified[cat] = q.defId;
            const def = window.RA.DATA && window.RA.DATA.BUILDINGS && window.RA.DATA.BUILDINGS[q.defId];
            this.setEvaMessage(
              `CONSTRUCTION COMPLETE: ${(def && def.name) || q.defId.toUpperCase()} READY TO PLACE.`
            );
          }
        } else {
          this.readyNotified[cat] = null;
        }
      });
    }

    syncProductionGrid(player, forceRebuild = false) {
      if (!this.elProdGrid || !this.engine.getAvailableTech) return;

      const tech = this.engine.getAvailableTech('player') || {};

      // Merge vehicles, aircraft, and naval units into the 'vehicle' sidebar tab
      const rawVehicles = [
        ...(tech.vehicles || tech.vehicle || []),
        ...(tech.aircraft || []),
        ...(tech.naval || [])
      ];
      const seenVehIds = new Set();
      const mergedVehicles = [];
      for (const d of rawVehicles) {
        if (d && d.id && !seenVehIds.has(d.id)) {
          seenVehIds.add(d.id);
          mergedVehicles.push(d);
        }
      }

      const tabToTechMap = {
        building: tech.buildings || tech.building || [],
        defense: tech.defenses || tech.defense || [],
        infantry: tech.infantry || [],
        vehicle: mergedVehicles
      };

      const availableDefs = tabToTechMap[this.activeTab] || [];
      const queues = player.queues || {};

      // Check if we need to rebuild DOM cards or update in-place
      const currentIds = availableDefs.map((d) => d.id).join(',');
      if (forceRebuild || this.elProdGrid.dataset.renderedIds !== currentIds) {
        this.elProdGrid.dataset.renderedIds = currentIds;
        this.elProdGrid.innerHTML = '';

        if (availableDefs.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'inspector-empty';
          empty.style.gridColumn = '1 / -1';
          empty.textContent =
            'Deploy a Construction Yard and prerequisite structures to unlock production in this category.';
          this.elProdGrid.appendChild(empty);
          return;
        }

        availableDefs.forEach((def) => {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'prod-card';
          card.dataset.defId = def.id;
          card.dataset.category = def.category || this.activeTab;
          card.title = `${def.name} ($${def.cost}) — ${def.description || ''}\nLeft-Click: Build / Place | Right-Click: Cancel`;

          card.innerHTML = `
            <div class="prod-card-top">
              <span class="prod-icon">${def.icon || '⚙'}</span>
              <span class="prod-cost">$${def.cost}</span>
            </div>
            <div class="prod-name">${def.name}</div>
            <div class="prod-status-slot"></div>
            <div class="prod-progress-overlay" style="width: 0%;"></div>
          `;

          // Left-Click: Start production or enter Placement Mode if readyToPlace
          card.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.audio) this.audio.init();
            const cat = def.category || this.activeTab;

            if (cat === 'building' || cat === 'defense') {
              const q = queues[cat];
              if (q && q.defId === def.id && q.readyToPlace) {
                this.enterPlacementMode(cat, def);
                return;
              }
              this.engine.startProduction(cat, def.id, 'player');
              // If instant-completed, immediately enter placement mode
              const qAfter = this.engine.teams.player.queues[cat];
              if (qAfter && qAfter.defId === def.id && qAfter.readyToPlace) {
                this.enterPlacementMode(cat, def);
              }
            } else {
              this.engine.startProduction(cat, def.id, 'player');
            }
            this.syncHUD(false);
          });

          // Right-Click: Cancel or pause production
          card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const cat = def.category || this.activeTab;
            if (
              this.cursorMode === 'place' &&
              this.pendingPlacement &&
              this.pendingPlacement.defId === def.id
            ) {
              this.setCursorMode('normal');
            }
            this.engine.cancelProduction(cat, def.id, 'player');
            this.syncHUD(false);
          });

          this.elProdGrid.appendChild(card);
        });
      }

      // Update live progress bars & READY / queue count badges on existing cards
      this.elProdGrid.querySelectorAll('.prod-card').forEach((card) => {
        const defId = card.dataset.defId;
        const cat = card.dataset.category;
        const progressEl = card.querySelector('.prod-progress-overlay');
        const statusSlot = card.querySelector('.prod-status-slot');

        let progress = 0;
        let isReady = false;
        let count = 0;
        let inProgress = false;

        if (cat === 'building' || cat === 'defense') {
          const q = queues[cat];
          if (q && q.defId === defId) {
            progress = Math.max(0, Math.min(1, q.progress || 0));
            isReady = Boolean(q.readyToPlace);
            inProgress = !isReady;
          }
        } else {
          const candidateQueues = [
            queues[cat],
            queues.vehicle,
            queues.aircraft,
            queues.naval,
            queues.infantry
          ].filter(Array.isArray);
          let entry = null;
          for (const list of candidateQueues) {
            entry = list.find((item) => item && item.defId === defId);
            if (entry) break;
          }
          if (entry) {
            progress = Math.max(0, Math.min(1, entry.progress || 0));
            count = entry.count || 1;
            inProgress = true;
          }
        }

        card.classList.toggle('in-progress', inProgress);
        card.classList.toggle('ready-to-place', isReady);

        if (progressEl) {
          progressEl.style.width = `${Math.round(progress * 100)}%`;
        }

        if (statusSlot) {
          if (isReady) {
            statusSlot.innerHTML = `<span class="prod-ready-badge">READY</span>`;
          } else if (count > 0) {
            statusSlot.innerHTML = `<span class="prod-queue-badge">x${count}</span>`;
          } else if (inProgress) {
            statusSlot.innerHTML = `<span class="prod-queue-badge">${Math.round(progress * 100)}%</span>`;
          } else {
            statusSlot.innerHTML = '';
          }
        }
      });
    }

    syncSuperweaponsPanel(player) {
      if (!this.elSuperweapons) return;
      const swDefs = (window.RA.DATA && window.RA.DATA.SUPERWEAPONS) || {};
      const swStates = (player && player.superweapons) || {};
      const tech = (this.engine.getAvailableTech && this.engine.getAvailableTech('player')) || {};
      const unlockedSws = tech.superweapons || [];

      this.elSuperweapons.innerHTML = '';

      const swList = unlockedSws.length > 0 ? unlockedSws : Object.values(swDefs);

      swList.forEach((swDef) => {
        const st = swStates[swDef.id] || { ready: false, progress: 0 };
        const isUnlocked = unlockedSws.some((u) => (u.id || u) === swDef.id) || st.ready || st.progress > 0;
        const pct = Math.min(100, Math.round((st.progress || 0) * 100));

        const card = document.createElement('div');
        card.className = 'sw-card' + (st.ready ? ' ready' : '');
        card.dataset.swId = swDef.id;

        card.innerHTML = `
          <div class="sw-info">
            <div class="sw-title">${swDef.icon || '☢'} ${swDef.name}</div>
            <div class="sw-bar-track">
              <div class="sw-bar-fill" style="width: ${st.ready ? 100 : pct}%;"></div>
            </div>
          </div>
          <button type="button" class="sw-launch-btn ${st.ready ? 'ready' : ''}" ${st.ready ? '' : 'disabled'}>
            ${st.ready ? 'LAUNCH' : isUnlocked ? `${pct}%` : 'LOCKED'}
          </button>
        `;

        const btn = card.querySelector('.sw-launch-btn');
        if (btn && st.ready) {
          btn.addEventListener('click', () => {
            this.setCursorMode('superweapon', swDef.id);
          });
        }

        this.elSuperweapons.appendChild(card);
      });
    }

    syncSelectionInspector() {
      if (!this.elInspector) return;
      const selected = this.getSelectedEntities();
      const selectedUnits = selected.filter((e) => e.isUnit && e.team === 'player');
      this.syncStanceSelector(selectedUnits);

      if (this.elInspectorCount) {
        this.elInspectorCount.textContent = selected.length > 0 ? `${selected.length} SELECTED` : 'NONE';
      }

      if (selected.length === 0) {
        this.elInspector.innerHTML = `
          <div class="inspector-empty">
            Select units or structures on the battlefield to inspect telemetry and issue tactical commands.
          </div>
        `;
        return;
      }

      const primary = selected[0];
      const def = primary.def || {};
      const hpPct = Math.max(0, Math.min(100, Math.round((primary.hp / (primary.maxHp || 1)) * 100)));
      const hpColor =
        hpPct > 55 ? 'var(--phosphor-green)' : hpPct > 25 ? 'var(--phosphor-amber)' : 'var(--phosphor-red)';

      const vetStars = primary.veterancy > 0 ? '★'.repeat(primary.veterancy) : 'ROOKIE';
      const cargoInfo =
        primary.defId === 'harvester'
          ? `<span>ORE: ${Math.floor(primary.cargo || 0)}/${primary.maxCargo || 700}</span>`
          : '';

      // Aircraft Ammo readout
      const isAircraft =
        primary.locomotion === 'air' ||
        primary.category === 'aircraft' ||
        def.category === 'aircraft' ||
        (primary.maxAmmo !== undefined && primary.maxAmmo > 0);
      const maxAmmoVal = primary.maxAmmo !== undefined && primary.maxAmmo > 0 ? primary.maxAmmo : def.maxAmmo || 0;
      const curAmmoVal = primary.ammo !== undefined && primary.ammo >= 0 ? primary.ammo : maxAmmoVal;
      const ammoInfo =
        isAircraft && maxAmmoVal > 0 ? `<span>Ammo: ${curAmmoVal} / ${maxAmmoVal}</span>` : '';

      // Producer building Multi-Factory speed multiplier & Primary status
      const producerMap = {
        barracks: 'infantry',
        weap: 'vehicle',
        helipad: 'aircraft',
        afld: 'aircraft',
        syrd: 'naval',
        spen: 'naval'
      };
      const isProducerBuilding =
        primary.isBuilding &&
        primary.team === 'player' &&
        Boolean(producerMap[primary.defId] || def.produces);
      let factoryBonusInfo = '';
      if (isProducerBuilding) {
        const prodCat = producerMap[primary.defId] || def.produces || 'vehicle';
        const mult =
          this.engine && typeof this.engine.getFactoryMultiplier === 'function'
            ? this.engine.getFactoryMultiplier('player', prodCat)
            : 1.0;
        const multStr = `${Number(mult.toFixed(2))}x`;
        factoryBonusInfo = `<span>BUILD SPEED: ${multStr}</span>`;
      }

      const titleText =
        selected.length > 1
          ? `${def.name || primary.defId} (+${selected.length - 1} more)`
          : def.name || primary.defId;

      let actionsHtml = '';
      if (primary.team === 'player') {
        if (selected.some((e) => e.defId === 'mcv')) {
          actionsHtml += `<button type="button" id="insp-btn-deploy" class="inspector-btn">🏗 DEPLOY MCV [D]</button>`;
        }
        if (selected.some((e) => e.defId === 'ctnk')) {
          const cd = Math.ceil(primary.chronoCooldownTimer || 0);
          const blinkLabel = cd > 0 ? `⚡ CHRONO (${cd}s)` : '⚡ CHRONO BLINK [D]';
          const isBlinkMode = this.cursorMode === 'chronoBlink';
          actionsHtml += `<button type="button" id="insp-btn-chrono" class="inspector-btn ${isBlinkMode ? 'active' : ''}">${blinkLabel}</button>`;
        }
        if (selected.some((e) => e.defId === 'qtnk')) {
          actionsHtml += `<button type="button" id="insp-btn-mad" class="inspector-btn">☢ SEISMIC BLAST [D]</button>`;
        }
        if (primary.isBuilding) {
          if (isProducerBuilding) {
            actionsHtml += `
              <button type="button" id="insp-btn-primary" class="inspector-btn ${primary.isPrimary ? 'active' : ''}">
                ${primary.isPrimary ? '★ PRIMARY [PRI]' : 'SET PRIMARY [PRI]'}
              </button>
            `;
          }
          actionsHtml += `
            <button type="button" id="insp-btn-repair" class="inspector-btn">
              🔧 ${primary.isRepairing ? 'STOP REPAIR' : 'REPAIR'}
            </button>
            <button type="button" id="insp-btn-sell" class="inspector-btn">
              💲 SELL ($${Math.floor((def.cost || 0) * 0.5)})
            </button>
          `;
        }
      }

      this.elInspector.innerHTML = `
        <div class="inspector-top">
          <div class="inspector-portrait">${def.icon || (primary.isBuilding ? '🏭' : '🚜')}</div>
          <div class="inspector-meta">
            <div class="inspector-name">${titleText}</div>
            <div class="inspector-hp-bar">
              <div class="inspector-hp-fill" style="width: ${hpPct}%; background: ${hpColor};"></div>
            </div>
          </div>
        </div>
        <div class="inspector-stats">
          <span>HP: ${Math.ceil(primary.hp)}/${primary.maxHp}</span>
          ${primary.isUnit ? `<span>RANK: ${vetStars}</span>` : ''}
          ${def.damage ? `<span>DMG: ${def.damage}</span>` : ''}
          ${ammoInfo}
          ${cargoInfo}
          ${factoryBonusInfo}
        </div>
        ${actionsHtml ? `<div class="inspector-actions">${actionsHtml}</div>` : ''}
      `;

      const btnDeploy = document.getElementById('insp-btn-deploy');
      const btnChrono = document.getElementById('insp-btn-chrono');
      const btnMad = document.getElementById('insp-btn-mad');
      const btnPrimary = document.getElementById('insp-btn-primary');
      const btnRepair = document.getElementById('insp-btn-repair');
      const btnSell = document.getElementById('insp-btn-sell');

      if (btnDeploy) {
        btnDeploy.addEventListener('click', () => this.deploySelected());
      }
      if (btnChrono) {
        btnChrono.addEventListener('click', () => {
          this.setCursorMode(this.cursorMode === 'chronoBlink' ? 'normal' : 'chronoBlink');
          this.syncSelectionInspector();
        });
      }
      if (btnMad) {
        btnMad.addEventListener('click', () => this.deploySelected());
      }
      if (btnPrimary) {
        btnPrimary.addEventListener('click', () => {
          this.setPrimarySelectedBuilding(primary);
        });
      }
      if (btnRepair) {
        btnRepair.addEventListener('click', () => {
          this.engine.toggleRepair(primary);
          this.syncHUD(true);
        });
      }
      if (btnSell) {
        btnSell.addEventListener('click', () => {
          this.engine.sellBuilding(primary);
          this.syncHUD(true);
        });
      }
    }

    /* ========================================================================
       NOTIFICATIONS, EVA MESSAGES & DEBRIEFING (VICTORY / DEFEAT)
       ======================================================================== */
    setEvaMessage(msg) {
      if (!this.elEvaMessage || !msg) return;
      this.elEvaMessage.textContent = String(msg).toUpperCase();
    }

    showNotification(msg, isAlert = false) {
      if (!this.elNotification || !msg) return;
      this.elNotification.textContent = msg;
      this.elNotification.classList.remove('hidden');
      this.elNotification.classList.toggle('alert-danger', Boolean(isAlert));

      if (this.notificationTimer) {
        clearTimeout(this.notificationTimer);
      }
      this.notificationTimer = setTimeout(() => {
        if (this.elNotification) {
          this.elNotification.classList.add('hidden');
        }
      }, 3400);
    }

    handleGameOver(result) {
      if (this.gameOverTriggered) return;
      this.gameOverTriggered = true;
      this.setCursorMode('normal');

      const isVictory = result === 'victory';
      if (this.audio) {
        this.audio.stopMusic();
        this.audio.playSfx(isVictory ? 'victory' : 'defeat');
        this.audio.speak(isVictory ? 'Mission accomplished' : 'Mission failed');
      }

      const banner = document.getElementById('gameover-banner');
      const subtitle = document.getElementById('gameover-subtitle');
      const rankEl = document.getElementById('gameover-rank');

      if (banner) {
        banner.textContent = isVictory ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED';
        banner.className = 'gameover-banner ' + (isVictory ? 'victory' : 'defeat');
      }
      if (subtitle) {
        subtitle.textContent = isVictory
          ? 'All hostile forces in the sector have been neutralized.'
          : 'Your command headquarters and strike forces have been lost.';
      }

      const stats = this.engine.stats || {};
      const elapsed = this.engine.elapsedTime || stats.elapsedTime || 0;
      const unitsBuilt = stats.unitsBuilt || 0;
      const unitsKilled = stats.unitsKilled || 0;
      const unitsLost = stats.unitsLost || 0;
      const buildingsBuilt = stats.buildingsBuilt || 0;
      const buildingsDestroyed = stats.buildingsDestroyed || 0;
      const creditsHarvested = stats.creditsHarvested || 0;

      // Calculate Commander Rank
      let rank = 'FIELD LIEUTENANT (C-RANK)';
      let rankLetter = 'C';
      if (isVictory) {
        const kdRatio = (unitsKilled + buildingsDestroyed * 2) / Math.max(1, unitsLost);
        if (kdRatio >= 3.0 && elapsed < 900) {
          rank = 'SUPREME MARSHAL (S-RANK)';
          rankLetter = 'S';
        } else if (kdRatio >= 1.8) {
          rank = 'FOUR-STAR GENERAL (A-RANK)';
          rankLetter = 'A';
        } else {
          rank = 'TACTICAL COLONEL (B-RANK)';
          rankLetter = 'B';
        }
      } else {
        rank = 'RELIEVED OF COMMAND (D-RANK)';
        rankLetter = 'D';
      }
      if (rankEl) rankEl.textContent = rank;

      // Persist Campaign progression & rank badge on Victory
      if (isVictory && this.selectedMode === 'campaign' && this.currentMission) {
        const mId = this.currentMission.id || `mission_${this.selectedMissionIndex + 1}`;
        const mNum = this.currentMission.number || this.selectedMissionIndex + 1;
        this.saveCampaignProgress(mId, mNum, rankLetter);
      }

      const setCell = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val);
      };

      setCell('stat-time', this.formatTime(elapsed));
      setCell('stat-units-built', unitsBuilt);
      setCell('stat-units-killed', unitsKilled);
      setCell('stat-units-lost', unitsLost);
      setCell('stat-buildings-built', buildingsBuilt);
      setCell('stat-buildings-destroyed', buildingsDestroyed);
      setCell('stat-credits-harvested', '$' + Math.floor(creditsHarvested).toLocaleString());

      this.showScreen('gameover');
    }

    formatTime(seconds) {
      const total = Math.max(0, Math.floor(seconds || 0));
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }

  function bootstrap() {
    if (!window.RA.app) {
      window.RA.app = new TacticalCommandApp();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
