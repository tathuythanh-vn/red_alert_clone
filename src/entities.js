(function () {
  'use strict';

  window.RA = window.RA || {};

  let NEXT_ENTITY_ID = 1;

  const INFANTRY_IDS = ['rifle', 'rocket', 'engineer', 'tanya', 'dog', 'spy', 'thf', 'shok'];
  const AIRCRAFT_IDS = ['heli', 'hind', 'yak', 'mig'];
  const NAVAL_IDS = ['gnbt', 'dd', 'ca', 'ss'];
  const TRACKED_VEHICLE_IDS = ['htnk', 'mammoth', 'harvester', 'mcv', 'qtnk', 'ctnk', 'mtnk', 'ltnk', 'v2rl', 'arty'];

  function getTileSize() {
    return window.RA.TILE_SIZE || 40;
  }

  function getData() {
    return window.RA.DATA || { FACTIONS: {}, BUILDINGS: {}, UNITS: {}, SUPERWEAPONS: {} };
  }

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function lerpAngle(current, target, maxDelta) {
    const diff = normalizeAngle(target - current);
    if (Math.abs(diff) <= maxDelta) return target;
    return normalizeAngle(current + Math.sign(diff) * maxDelta);
  }

  /**
   * Base Entity class for all buildings and units
   */
  class Entity {
    constructor(opts = {}) {
      const DATA = getData();
      if (opts.id !== undefined && opts.id !== null) {
        this.id = Number(opts.id);
        if (this.id >= NEXT_ENTITY_ID) {
          NEXT_ENTITY_ID = this.id + 1;
        }
      } else {
        this.id = NEXT_ENTITY_ID++;
      }

      this.team = opts.team || 'player';
      this.faction = opts.faction || (this.team === 'player' ? 'allied' : 'soviet');
      this.defId = opts.defId || '';
      this.def =
        opts.def ||
        (DATA.BUILDINGS && DATA.BUILDINGS[this.defId]) ||
        (DATA.UNITS && DATA.UNITS[this.defId]) ||
        {};
      this.name = this.def.name || this.defId || 'Entity';

      this.x = opts.x !== undefined ? opts.x : 0;
      this.y = opts.y !== undefined ? opts.y : 0;

      const baseHp = opts.maxHp !== undefined ? opts.maxHp : (this.def.hp || 100);
      this.maxHp = Math.round(baseHp);
      this.hp = opts.hp !== undefined ? opts.hp : this.maxHp;

      this.dead = Boolean(opts.dead);
      this.selected = Boolean(opts.selected);
      this.sight = opts.sight !== undefined ? opts.sight : (this.def.sight || 6);
      this.radius = opts.radius || 16;
      this.lastDamagedTime = -999;
    }

    static resetIds(nextId = 1) {
      NEXT_ENTITY_ID = Math.max(1, Number(nextId) || 1);
    }

    static setNextId(nextId) {
      NEXT_ENTITY_ID = Math.max(NEXT_ENTITY_ID, Number(nextId) || 1);
    }

    isFriendly(other) {
      if (!other) return false;
      const otherTeam = typeof other === 'object' ? other.team : other;
      return this.team === otherTeam;
    }

    getTilePos() {
      const ts = getTileSize();
      return {
        tx: Math.floor(this.x / ts),
        ty: Math.floor(this.y / ts)
      };
    }

    distanceTo(otherOrX, y) {
      if (otherOrX && typeof otherOrX === 'object') {
        const dx = (otherOrX.x || 0) - this.x;
        const dy = (otherOrX.y || 0) - this.y;
        return Math.hypot(dx, dy);
      }
      return Math.hypot((otherOrX || 0) - this.x, (y || 0) - this.y);
    }

    edgeDistanceTo(other) {
      if (!other) return Infinity;
      const centerDist = this.distanceTo(other);
      const r1 = this.radius || 12;
      const r2 = other.radius || 12;
      return Math.max(0, centerDist - (r1 + r2) * 0.65);
    }

    /**
     * Multi-domain & specialist targeting rules (land, air, naval, submarine stealth, spy disguise)
     */
    canTarget(target, isExplicitOrder = false) {
      if (!target || target.dead || target === this) return false;

      const def = this.def || {};

      // 1. Infantry-only attacker (Attack Dog 'dog')
      if (def.infantryOnlyTarget || this.defId === 'dog') {
        return Boolean(target.isUnit && (target.category === 'infantry' || target.isInfantry));
      }

      const targetLocomotion =
        target.locomotion ||
        (target.def && target.def.locomotion) ||
        (target.category === 'aircraft' || AIRCRAFT_IDS.includes(target.defId)
          ? 'air'
          : target.category === 'naval' || NAVAL_IDS.includes(target.defId)
          ? 'naval'
          : 'land');
      const targetAltitude =
        target.altitude !== undefined ? target.altitude : (targetLocomotion === 'air' ? 28 : 0);

      // 2. Airborne target check
      if (targetLocomotion === 'air' && targetAltitude > 4) {
        const canHitAir = Boolean(
          def.canTargetAir ||
            def.antiAirOnly ||
            this.defId === 'rocket' ||
            this.defId === 'mammoth' ||
            this.defId === 'sam' ||
            this.defId === 'agun' ||
            this.defId === 'dd' ||
            this.defId === 'heli' ||
            this.defId === 'mig'
        );
        if (!canHitAir) return false;
      }

      // 3. Anti-air-only attacker ('sam', 'agun')
      if (def.antiAirOnly || this.defId === 'sam' || this.defId === 'agun') {
        return targetLocomotion === 'air';
      }

      // 4. Naval-only attacker ('ss' Submarine)
      if (def.navalOnlyTarget || this.defId === 'ss') {
        return Boolean(
          targetLocomotion === 'naval' ||
            target.category === 'naval' ||
            (target.isBuilding && target.def && target.def.waterOnly)
        );
      }

      // 5. Submerged submarine ('ss' while cloaked)
      if (target.submerged) {
        const canHitSub = Boolean(
          def.antiSub ||
            this.defId === 'dd' ||
            this.defId === 'gnbt' ||
            this.defId === 'heli'
        );
        if (!canHitSub) return false;
      }

      // 6. Disguised Allied Spy ('spy'): auto-acquisition ignores spy unless attacker is 'dog' or within 48px
      if (target.defId === 'spy' && target.disguised && !isExplicitOrder) {
        if (this.defId !== 'dog' && !def.detectsSpy && this.distanceTo(target) > 48) {
          return false;
        }
      }

      return true;
    }

    takeDamage(amount, attacker, engine) {
      if (this.dead || amount <= 0) return 0;

      // Invulnerable while Iron Curtain is active
      if (this.ironCurtainTimer && this.ironCurtainTimer > 0 && amount < 9000) {
        return 0;
      }

      // Soviet faction armor bonus reduces standard incoming combat damage by ~13%
      let finalDamage = amount;
      if (amount < 9000 && this.faction === 'soviet') {
        finalDamage = Math.max(1, amount / 1.15);
      }

      this.hp = Math.max(0, this.hp - finalDamage);
      if (engine) {
        this.lastDamagedTime = engine.elapsedTime || 0;
        if (typeof engine.onEntityDamaged === 'function') {
          engine.onEntityDamaged(this, attacker, finalDamage);
        }
      }

      // Auto-retaliation for idle combat units when hit (unless stance is 'holdFire')
      if (
        !this.dead &&
        this.isUnit &&
        this.stance !== 'holdFire' &&
        (this.state === 'idle' || this.state === 'attackMove' || this.state === 'patrol') &&
        !this.targetEntity &&
        attacker &&
        !attacker.dead &&
        !this.isFriendly(attacker) &&
        (this.def.range || 0) > 0 &&
        this.canTarget(attacker)
      ) {
        if (this.stance !== 'holdGround' || this.edgeDistanceTo(attacker) <= (this.def.range || 0)) {
          this.targetEntity = attacker;
          this.target = attacker;
          if (this.state === 'idle') {
            this.state = 'attack';
          }
        }
      }

      if (this.hp <= 0 && !this.dead) {
        this.hp = 0;
        this.dead = true;
        this.selected = false;
        this.onDeath(attacker, engine);
      }

      return finalDamage;
    }

    onDeath(attacker, engine) {
      if (attacker && !attacker.dead && !this.isFriendly(attacker)) {
        attacker.kills = (attacker.kills || 0) + 1;
        if (attacker.kills >= 6) attacker.veterancy = 3;
        else if (attacker.kills >= 3) attacker.veterancy = 2;
        else if (attacker.kills >= 1) attacker.veterancy = 1;
      }
      if (engine && typeof engine.onEntityKilled === 'function') {
        engine.onEntityKilled(this, attacker);
      }
    }
  }

  /**
   * Building Entity
   */
  class Building extends Entity {
    constructor(opts = {}) {
      super(opts);
      const ts = getTileSize();
      this.isBuilding = true;
      this.isUnit = false;
      this.category = this.def.category || 'building';
      this.locomotion = 'land';
      this.altitude = 0;

      const fp = this.def.footprint || [this.def.w || 2, this.def.h || 2];
      this.w = opts.w || fp[0] || 2;
      this.h = opts.h || fp[1] || 2;

      this.tx = opts.tx !== undefined ? opts.tx : Math.floor((opts.x || 0) / ts);
      this.ty = opts.ty !== undefined ? opts.ty : Math.floor((opts.y || 0) / ts);

      this.x = (this.tx + this.w / 2) * ts;
      this.y = (this.ty + this.h / 2) * ts;
      this.radius = Math.max(this.w, this.h) * ts * 0.45;

      this.isWall = Boolean(this.def.isWall || ['sbag', 'fenc', 'brik'].includes(this.defId));
      this.unCrushable = Boolean(this.def.unCrushable || this.defId === 'brik');
      this.isPrimary = Boolean(opts.isPrimary);

      this.isRepairing = Boolean(opts.isRepairing);
      this.attackCooldown = opts.attackCooldown || 0;
      this.target = opts.targetEntity || null;
      this.targetEntity = opts.targetEntity || null;
      this.turretAngle =
        opts.turretAngle !== undefined ? opts.turretAngle : (this.team === 'player' ? -Math.PI / 2 : Math.PI / 2);

      this.rallyPoint = opts.rallyPoint
        ? { x: opts.rallyPoint.x, y: opts.rallyPoint.y }
        : {
            x: this.x,
            y: this.y + (this.h / 2 + 1.5) * ts
          };

      this.constructionAnim = opts.constructionAnim !== undefined ? opts.constructionAnim : 1.0;
      this.animTime = 0;
      this.chargeAnim = 0;
    }

    occupiesTile(tx, ty) {
      return tx >= this.tx && tx < this.tx + this.w && ty >= this.ty && ty < this.ty + this.h;
    }

    update(dt, engine) {
      if (this.dead) return;
      const ts = getTileSize();
      this.animTime += dt;

      if (this.constructionAnim > 0) {
        this.constructionAnim = Math.max(0, this.constructionAnim - dt * 1.8);
      }

      // Active structural repair
      if (this.isRepairing) {
        if (this.hp >= this.maxHp) {
          this.hp = this.maxHp;
          this.isRepairing = false;
        } else if (engine && engine.teams && engine.teams[this.team]) {
          const teamState = engine.teams[this.team];
          const repairRate = 45; // HP per sec
          const hpToGain = Math.min(this.maxHp - this.hp, repairRate * dt);
          const repairCost = hpToGain * 0.25;
          if (teamState.credits >= repairCost) {
            teamState.credits = Math.max(0, teamState.credits - repairCost);
            this.hp = Math.min(this.maxHp, this.hp + hpToGain);
            if (this.hp >= this.maxHp) {
              this.hp = this.maxHp;
              this.isRepairing = false;
            }
          }
        }
      }

      // Service Depot ('fix') passively repairs nearby friendly vehicles
      if (this.defId === 'fix' && engine && Array.isArray(engine.entities)) {
        const teamState = engine.teams && engine.teams[this.team];
        for (let i = 0; i < engine.entities.length; i++) {
          const e = engine.entities[i];
          if (
            e &&
            !e.dead &&
            e.isUnit &&
            e.locomotion === 'land' &&
            !e.isInfantry &&
            e.team === this.team &&
            e.hp < e.maxHp &&
            this.distanceTo(e) <= ts * 2.8
          ) {
            const gain = Math.min(e.maxHp - e.hp, 35 * dt);
            const cost = gain * 0.15;
            if (!teamState || teamState.credits >= cost) {
              if (teamState) teamState.credits = Math.max(0, teamState.credits - cost);
              e.hp = Math.min(e.maxHp, e.hp + gain);
            }
          }
        }
      }

      // Naval Yard ('syrd') & Sub Pen ('spen') passively repair nearby friendly naval vessels
      if ((this.defId === 'syrd' || this.defId === 'spen') && engine && Array.isArray(engine.entities)) {
        const teamState = engine.teams && engine.teams[this.team];
        for (let i = 0; i < engine.entities.length; i++) {
          const e = engine.entities[i];
          if (
            e &&
            !e.dead &&
            e.isUnit &&
            e.locomotion === 'naval' &&
            e.team === this.team &&
            e.hp < e.maxHp &&
            this.distanceTo(e) <= ts * 3.0
          ) {
            const gain = Math.min(e.maxHp - e.hp, 35 * dt);
            const cost = gain * 0.15;
            if (!teamState || teamState.credits >= cost) {
              if (teamState) teamState.credits = Math.max(0, teamState.credits - cost);
              e.hp = Math.min(e.maxHp, e.hp + gain);
            }
          }
        }
      }

      // Helipad ('helipad') & Airfield ('afld') repair and reload nearby friendly aircraft
      if ((this.defId === 'helipad' || this.defId === 'afld') && engine && Array.isArray(engine.entities)) {
        for (let i = 0; i < engine.entities.length; i++) {
          const e = engine.entities[i];
          if (
            e &&
            !e.dead &&
            e.isUnit &&
            e.locomotion === 'air' &&
            e.team === this.team &&
            this.distanceTo(e) <= ts * 3.2
          ) {
            if (e.hp < e.maxHp) {
              e.hp = Math.min(e.maxHp, e.hp + 30 * dt);
            }
            if (e.maxAmmo > 0 && e.ammo < e.maxAmmo) {
              e.reloadTimer = (e.reloadTimer || 0) + dt * 1.5;
              if (e.reloadTimer >= 1.5) {
                e.reloadTimer = 0;
                e.ammo = Math.min(e.maxAmmo, e.ammo + 1);
              }
            }
          }
        }
      }

      // Defensive structure combat logic
      const range = this.def.range || 0;
      const damage = this.def.damage || 0;
      if (range > 0 && damage > 0 && engine) {
        if (this.attackCooldown > 0) {
          this.attackCooldown = Math.max(0, this.attackCooldown - dt);
        }

        // Tesla Coil requires base power (!engine.isLowPower(this.team)) to fire
        if (this.defId === 'tesla' && typeof engine.isLowPower === 'function' && engine.isLowPower(this.team)) {
          this.target = null;
          this.targetEntity = null;
          return;
        }

        // Validate existing target
        if (
          this.target &&
          (this.target.dead ||
            this.isFriendly(this.target) ||
            !this.canTarget(this.target) ||
            this.edgeDistanceTo(this.target) > range)
        ) {
          this.target = null;
          this.targetEntity = null;
        }

        // Acquire nearest valid enemy within range
        if (!this.target && typeof engine.findNearestEnemy === 'function') {
          this.target = engine.findNearestEnemy(this.x, this.y, this.team, range, this);
          this.targetEntity = this.target;
        }

        if (this.target) {
          const desiredAngle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
          this.turretAngle = lerpAngle(this.turretAngle, desiredAngle, dt * 8);

          if (this.attackCooldown <= 0) {
            this.fireAt(this.target, engine);
            this.attackCooldown = Math.max(0.2, this.def.fireRate || 1.2);
          }
        }
      }
    }

    fireAt(target, engine) {
      if (!target || target.dead || !engine) return;
      const projType = this.def.projectileType || 'shell';
      const muzzleDist = Math.max(12, this.w * getTileSize() * 0.35);
      const angle = Math.atan2(target.y - this.y, target.x - this.x);
      const sx = this.x + Math.cos(angle) * muzzleDist;
      const sy = this.y + Math.sin(angle) * muzzleDist;

      engine.spawnProjectile({
        type: projType,
        team: this.team,
        faction: this.faction,
        attacker: this,
        startX: sx,
        startY: sy,
        targetX: target.x,
        targetY: target.y,
        targetEntity: target,
        damage: this.def.damage || 40,
        splash: this.def.splash || 0
      });

      if (window.RA.audio) {
        if (projType === 'tesla') window.RA.audio.playSfx('tesla');
        else if (projType === 'flak') window.RA.audio.playSfx('flak');
        else if (projType === 'sam_missile' || projType === 'rocket') window.RA.audio.playSfx('rocket');
        else if (projType === 'bullet') window.RA.audio.playSfx('machinegun');
        else window.RA.audio.playSfx('cannon');
      }
    }
  }

  /**
   * Unit Entity (Infantry, Vehicles, Aircraft & Naval Vessels)
   */
  class Unit extends Entity {
    constructor(opts = {}) {
      super(opts);
      this.isUnit = true;
      this.isBuilding = false;

      const rawCat =
        opts.category ||
        this.def.category ||
        (INFANTRY_IDS.includes(this.defId)
          ? 'infantry'
          : AIRCRAFT_IDS.includes(this.defId)
          ? 'aircraft'
          : NAVAL_IDS.includes(this.defId)
          ? 'naval'
          : 'vehicle');

      this.category = rawCat;
      this.isInfantry = this.category === 'infantry' || INFANTRY_IDS.includes(this.defId);

      // Multi-domain locomotion ('land' | 'air' | 'naval')
      this.locomotion =
        opts.locomotion ||
        this.def.locomotion ||
        (this.category === 'aircraft' ||
        this.def.unitSubCategory === 'aircraft' ||
        AIRCRAFT_IDS.includes(this.defId)
          ? 'air'
          : this.category === 'naval' ||
            this.def.unitSubCategory === 'naval' ||
            NAVAL_IDS.includes(this.defId)
          ? 'naval'
          : 'land');

      this.altitude = opts.altitude !== undefined ? opts.altitude : (this.locomotion === 'air' ? 28 : 0);
      this.maxAmmo =
        opts.maxAmmo !== undefined
          ? opts.maxAmmo
          : this.def.maxAmmo !== undefined
          ? this.def.maxAmmo
          : -1;
      this.ammo = opts.ammo !== undefined ? opts.ammo : this.maxAmmo;
      this.reloadTimer = 0;

      // Submarine stealth & Sonar detection
      this.submerged =
        opts.submerged !== undefined
          ? Boolean(opts.submerged)
          : Boolean(this.defId === 'ss' || this.def.cloaked);
      this.uncloakTimer = opts.uncloakTimer !== undefined ? opts.uncloakTimer : 0;
      this.sonarRange =
        this.def.sonarRange || (this.defId === 'dd' || this.defId === 'gnbt' ? 260 : 0);

      // Spy disguise & Shock Trooper uncrushable flag
      this.disguised =
        opts.disguised !== undefined
          ? Boolean(opts.disguised)
          : Boolean(this.defId === 'spy' || this.def.disguised);
      this.unCrushable = Boolean(
        opts.unCrushable ||
          this.def.unCrushable ||
          this.defId === 'shok' ||
          this.locomotion !== 'land' ||
          !this.isInfantry
      );

      this.radius = opts.radius !== undefined ? opts.radius : (this.isInfantry ? 10 : 16);

      this.angle =
        opts.angle !== undefined ? opts.angle : (this.team === 'player' ? -Math.PI / 2 : Math.PI / 2);
      this.turretAngle = opts.turretAngle !== undefined ? opts.turretAngle : this.angle;

      // Allied faction bonus: +15% unit speed
      const baseSpeed =
        opts.speed !== undefined ? opts.speed : (this.def.speed || (this.isInfantry ? 72 : 90));
      const speedMult = this.faction === 'allied' ? 1.15 : 1.0;
      this.speed = opts.rawSpeed ? opts.speed : baseSpeed * speedMult;

      this.state = opts.state || (this.defId === 'harvester' ? 'harvest' : 'idle');
      this.stance = opts.stance || 'guard'; // 'aggressive' | 'guard' | 'holdGround' | 'holdFire'
      this.guardOrigin = opts.guardOrigin
        ? { x: opts.guardOrigin.x, y: opts.guardOrigin.y }
        : { x: this.x, y: this.y };

      this.path = Array.isArray(opts.path) ? opts.path.slice() : [];
      this.commandQueue = Array.isArray(opts.commandQueue)
        ? opts.commandQueue.map((c) => Object.assign({}, c))
        : [];

      // Patrol state
      this.patrolA = opts.patrolA ? { x: opts.patrolA.x, y: opts.patrolA.y } : null;
      this.patrolB = opts.patrolB ? { x: opts.patrolB.x, y: opts.patrolB.y } : null;
      this.patrolForward = opts.patrolForward !== undefined ? Boolean(opts.patrolForward) : true;

      this.targetEntity = opts.targetEntity || null;
      this.target = this.targetEntity;
      this.targetPos = opts.targetPos || null;
      this.attackMovePos = opts.attackMovePos || null;
      this.explicitAttackOrder = Boolean(opts.explicitAttackOrder);
      this.bridgeTarget = opts.bridgeTarget || null;

      this.attackCooldown = opts.attackCooldown || 0;
      this.repathTimer = 0;
      this.scanTimer = Math.random() * 0.2;
      this.veterancy = opts.veterancy || 0;
      this.kills = opts.kills || 0;
      this.ironCurtainTimer = opts.ironCurtainTimer || 0;
      this.moveAnim = 0;
      this.trackDistAccum = 0;

      // Specialist timers (Chrono Tank & M.A.D. Tank)
      this.chronoCooldown = opts.chronoCooldown || 0;
      this.maxChronoCooldown = (this.def && this.def.chronoCooldown) || 35;
      this.madChargeTimer = opts.madChargeTimer !== undefined ? opts.madChargeTimer : 0;
      this.madCharging = Boolean(opts.madCharging || this.madChargeTimer > 0);
      this.madPulseAccum = 0;

      // Harvester fields
      this.cargo = opts.cargo || 0;
      this.maxCargo = opts.maxCargo || 700;
      this.harvestTimer = 0;
      this.harvestAnim = 0;
      this.oreTile = opts.oreTile || null;
    }

    getDamageMultiplier() {
      return 1 + (this.veterancy || 0) * 0.15;
    }

    _getAcquireRange() {
      const range = this.def.range || 0;
      const ts = getTileSize();
      if (this.stance === 'holdGround') {
        return range;
      }
      if (this.stance === 'aggressive') {
        return Math.max(range, (this.sight || 6) * ts * 1.4);
      }
      return Math.max(range, (this.sight || 6) * ts * 0.9);
    }

    _dequeueNextCommand(engine) {
      if (!this.commandQueue || this.commandQueue.length === 0 || !engine) return false;
      const nextCmd = this.commandQueue.shift();
      if (!nextCmd) return false;
      const wx = nextCmd.worldX !== undefined ? nextCmd.worldX : nextCmd.x;
      const wy = nextCmd.worldY !== undefined ? nextCmd.worldY : nextCmd.y;
      engine._applySingleUnitOrder(
        this,
        nextCmd.orderType || 'move',
        wx,
        wy,
        nextCmd.targetEntity || null
      );
      return true;
    }

    update(dt, engine) {
      if (this.dead || !engine) return;
      const ts = getTileSize();

      if (this.ironCurtainTimer > 0) {
        this.ironCurtainTimer = Math.max(0, this.ironCurtainTimer - dt);
      }

      if (this.attackCooldown > 0) {
        this.attackCooldown = Math.max(0, this.attackCooldown - dt);
      }

      if (this.repathTimer > 0) {
        this.repathTimer = Math.max(0, this.repathTimer - dt);
      }

      if (this.chronoCooldown > 0) {
        this.chronoCooldown = Math.max(0, this.chronoCooldown - dt);
      }

      // Maintain airborne altitude & ammo auto-reload
      if (this.locomotion === 'air') {
        if (!this.altitude || this.altitude < 24) {
          this.altitude = 28;
        }
        if (this.maxAmmo > 0 && this.ammo < this.maxAmmo) {
          this.reloadTimer += dt;
          if (this.reloadTimer >= 2.2) {
            this.reloadTimer = 0;
            this.ammo = Math.min(this.maxAmmo, this.ammo + 1);
          }
        }
      }

      // Submarine ('ss') stealth & enemy sonar detection ('dd', 'gnbt')
      if (this.defId === 'ss' || this.def.cloaked) {
        let detectedBySonar = false;
        if (Array.isArray(engine.entities)) {
          for (let i = 0; i < engine.entities.length; i++) {
            const e = engine.entities[i];
            if (!e || e.dead || this.isFriendly(e)) continue;
            const hasSonar =
              e.defId === 'dd' ||
              e.defId === 'gnbt' ||
              Boolean(e.def && (e.def.sonarRange || e.def.antiSub));
            if (hasSonar) {
              const sRange = e.sonarRange || (e.def && e.def.sonarRange) || 260;
              if (this.distanceTo(e) <= sRange) {
                detectedBySonar = true;
                break;
              }
            }
          }
        }

        if (detectedBySonar) {
          this.submerged = false;
          this.uncloakTimer = Math.max(this.uncloakTimer, 3.0);
        } else if (this.uncloakTimer > 0) {
          this.uncloakTimer = Math.max(0, this.uncloakTimer - dt);
          if (this.uncloakTimer <= 0) {
            this.submerged = true;
          }
        } else {
          this.submerged = true;
        }
      }

      // Attack Dog ('dog') automatically detects and uncloaks enemy Spies within 7 tiles
      if ((this.defId === 'dog' || (this.def && this.def.detectsSpy)) && Array.isArray(engine.entities)) {
        const detectRadius = 7 * ts;
        for (let i = 0; i < engine.entities.length; i++) {
          const e = engine.entities[i];
          if (e && !e.dead && e.defId === 'spy' && !this.isFriendly(e)) {
            if (this.distanceTo(e) <= detectRadius) {
              e.disguised = false;
              if (
                this.stance !== 'holdFire' &&
                (this.state === 'idle' || this.state === 'attackMove' || this.state === 'patrol') &&
                !this.targetEntity
              ) {
                this.targetEntity = e;
                this.target = e;
                this.state = 'attack';
              }
            }
          }
        }
      }

      // M.A.D. Tank ('qtnk') seismic shockwave charge sequence
      if (this.defId === 'qtnk' && (this.madCharging || this.madChargeTimer > 0)) {
        this.madChargeTimer = Math.max(0, this.madChargeTimer - dt);
        this.madPulseAccum = (this.madPulseAccum || 0) + dt;
        if (this.madPulseAccum >= 0.45) {
          this.madPulseAccum = 0;
          engine.particles.push(
            new Particle({
              x: this.x,
              y: this.y,
              size: 14,
              radius: 14,
              maxRadius: 320,
              color: '#f59e0b',
              life: 0.5,
              type: 'shockwave'
            })
          );
        }
        if (this.madChargeTimer <= 0) {
          this.detonateMadBlast(engine);
        }
        return;
      }

      this.scanTimer -= dt;
      this.target = this.targetEntity;

      // Handle Harvester state machine
      if (this.defId === 'harvester') {
        this.updateHarvester(dt, engine);
        this.applySeparation(dt, engine);
        this.checkCrush(engine);
        return;
      }

      // Handle MCV deploy state
      if (this.defId === 'mcv' && this.state === 'deploy') {
        if (
          this.targetPos &&
          this.distanceTo(this.targetPos.x, this.targetPos.y) > 20 &&
          this.path.length > 0
        ) {
          this.followPath(dt, engine);
        } else {
          this.deploy(engine);
        }
        this.applySeparation(dt, engine);
        return;
      }

      // Handle Engineer Bridge Repair state
      if (this.defId === 'engineer' && this.state === 'repairBridge') {
        this.updateEngineerBridgeRepair(dt, engine);
        this.applySeparation(dt, engine);
        return;
      }

      // Handle Engineer building capture / instant repair state
      if (this.defId === 'engineer' && (this.state === 'capture' || this.state === 'repair')) {
        this.updateEngineer(dt, engine);
        this.applySeparation(dt, engine);
        return;
      }

      // Handle Spy / Thief building infiltration state
      if (
        (this.defId === 'spy' || this.defId === 'thf') &&
        (this.state === 'infiltrate' ||
          this.state === 'capture' ||
          (this.state === 'attack' && this.targetEntity && this.targetEntity.isBuilding))
      ) {
        this.updateInfiltrator(dt, engine);
        this.applySeparation(dt, engine);
        return;
      }

      // Handle active combat, patrol, or movement states
      if (this.state === 'move') {
        if (this.path && this.path.length > 0) {
          this.followPath(dt, engine);
          if (this.path.length === 0) {
            if (this.defId === 'engineer' && this._tryAutoRepairNearbyBridge(engine)) {
              return;
            }
            if (!this._dequeueNextCommand(engine)) {
              this.state = 'idle';
              this.targetPos = null;
              this.guardOrigin = { x: this.x, y: this.y };
            }
          }
        } else {
          if (this.defId === 'engineer' && this._tryAutoRepairNearbyBridge(engine)) {
            return;
          }
          if (!this._dequeueNextCommand(engine)) {
            this.state = 'idle';
            this.targetPos = null;
            this.guardOrigin = { x: this.x, y: this.y };
          }
        }
      } else if (this.state === 'patrol') {
        this.updatePatrol(dt, engine);
      } else if (this.state === 'attackMove') {
        this.updateAttackMove(dt, engine);
      } else if (this.state === 'attack') {
        this.updateAttack(dt, engine);
      } else {
        if (!this._dequeueNextCommand(engine)) {
          this.updateIdle(dt, engine);
        }
      }

      this.applySeparation(dt, engine);
      this.checkCrush(engine);
    }

    updateIdle(dt, engine) {
      const range = this.def.range || 0;
      if (range <= 0 || this.stance === 'holdFire') return;

      if (this.scanTimer <= 0) {
        this.scanTimer = 0.2;
        const acquireRange = this._getAcquireRange();
        const enemy = engine.findNearestEnemy(this.x, this.y, this.team, acquireRange, this);
        if (enemy) {
          this.targetEntity = enemy;
          this.target = enemy;
          this.explicitAttackOrder = false;
          this.state = 'attack';
        }
      }
    }

    updatePatrol(dt, engine) {
      const ts = getTileSize();
      const range = this.def.range || 0;

      if (range > 0 && this.stance !== 'holdFire' && this.scanTimer <= 0) {
        this.scanTimer = 0.2;
        const acquireRange = this._getAcquireRange();
        const enemy = engine.findNearestEnemy(this.x, this.y, this.team, acquireRange, this);
        if (enemy) {
          this.targetEntity = enemy;
          this.target = enemy;
        }
      }

      if (this.targetEntity && !this.targetEntity.dead && this.canTarget(this.targetEntity)) {
        const dist = this.edgeDistanceTo(this.targetEntity);
        if (dist <= range) {
          const desiredAngle = Math.atan2(this.targetEntity.y - this.y, this.targetEntity.x - this.x);
          this.turretAngle = lerpAngle(this.turretAngle, desiredAngle, dt * 10);
          if (this.isInfantry) this.angle = this.turretAngle;
          if (this.attackCooldown <= 0 && (this.maxAmmo <= 0 || this.ammo > 0)) {
            this.fireAt(this.targetEntity, engine);
            this.attackCooldown = Math.max(0.2, this.def.fireRate || 1.0);
          }
          return;
        } else if (this.stance !== 'holdGround') {
          if (this.repathTimer <= 0 && engine.map) {
            this.repathTimer = 0.65;
            this.path = engine.map.findPath(
              this.x,
              this.y,
              this.targetEntity.x,
              this.targetEntity.y,
              this.locomotion,
              this.targetEntity.isBuilding ? this.targetEntity.id : null
            );
          }
          this.followPath(dt, engine);
          return;
        } else {
          this.targetEntity = null;
          this.target = null;
        }
      } else {
        this.targetEntity = null;
        this.target = null;
      }

      if (!this.patrolA || !this.patrolB) {
        this.state = 'idle';
        return;
      }

      const goal = this.patrolForward ? this.patrolB : this.patrolA;
      const distToGoal = this.distanceTo(goal.x, goal.y);

      if (distToGoal <= ts * 0.75 || (!this.path || this.path.length === 0)) {
        if (distToGoal <= ts * 0.95) {
          this.patrolForward = !this.patrolForward;
        }
        const nextGoal = this.patrolForward ? this.patrolB : this.patrolA;
        if (engine.map) {
          this.path = engine.map.findPath(this.x, this.y, nextGoal.x, nextGoal.y, this.locomotion);
        }
      }

      if (this.path && this.path.length > 0) {
        this.followPath(dt, engine);
      }
    }

    updateAttackMove(dt, engine) {
      const range = this.def.range || 0;
      if (range > 0 && this.stance !== 'holdFire' && this.scanTimer <= 0) {
        this.scanTimer = 0.2;
        const acquireRange = this._getAcquireRange();
        const enemy = engine.findNearestEnemy(this.x, this.y, this.team, acquireRange, this);
        if (enemy) {
          this.targetEntity = enemy;
          this.target = enemy;
        }
      }

      if (this.targetEntity && !this.targetEntity.dead && this.canTarget(this.targetEntity)) {
        const dist = this.edgeDistanceTo(this.targetEntity);
        if (dist <= range) {
          const desiredAngle = Math.atan2(this.targetEntity.y - this.y, this.targetEntity.x - this.x);
          this.turretAngle = lerpAngle(this.turretAngle, desiredAngle, dt * 10);
          if (this.isInfantry) this.angle = this.turretAngle;
          if (this.attackCooldown <= 0 && (this.maxAmmo <= 0 || this.ammo > 0)) {
            this.fireAt(this.targetEntity, engine);
            this.attackCooldown = Math.max(0.2, this.def.fireRate || 1.0);
          }
          return;
        } else if (this.stance !== 'holdGround') {
          if (this.repathTimer <= 0 && engine.map) {
            this.repathTimer = 0.7;
            this.path = engine.map.findPath(
              this.x,
              this.y,
              this.targetEntity.x,
              this.targetEntity.y,
              this.locomotion,
              this.targetEntity.isBuilding ? this.targetEntity.id : null
            );
          }
          this.followPath(dt, engine);
          return;
        } else {
          this.targetEntity = null;
          this.target = null;
        }
      } else {
        this.targetEntity = null;
        this.target = null;
      }

      // Continue along attack-move destination
      if (this.path && this.path.length > 0) {
        this.followPath(dt, engine);
      } else if (
        this.attackMovePos &&
        this.distanceTo(this.attackMovePos.x, this.attackMovePos.y) > getTileSize()
      ) {
        if (this.repathTimer <= 0 && engine.map) {
          this.repathTimer = 1.0;
          this.path = engine.map.findPath(
            this.x,
            this.y,
            this.attackMovePos.x,
            this.attackMovePos.y,
            this.locomotion
          );
        }
      } else {
        this.attackMovePos = null;
        if (!this._dequeueNextCommand(engine)) {
          this.state = 'idle';
          this.guardOrigin = { x: this.x, y: this.y };
        }
      }
    }

    updateAttack(dt, engine) {
      if (
        !this.targetEntity ||
        this.targetEntity.dead ||
        !this.canTarget(this.targetEntity, this.explicitAttackOrder)
      ) {
        this.targetEntity = null;
        this.target = null;
        this.explicitAttackOrder = false;
        if (this.attackMovePos) {
          this.state = 'attackMove';
        } else if (!this._dequeueNextCommand(engine)) {
          this.state = 'idle';
          this.path = [];
        }
        return;
      }

      const range = this.def.range || 0;
      if (range <= 0) {
        if (this.defId === 'engineer' && this.targetEntity.isBuilding) {
          this.state = 'capture';
          return;
        }
        if ((this.defId === 'spy' || this.defId === 'thf') && this.targetEntity.isBuilding) {
          this.state = 'infiltrate';
          return;
        }
        this.state = 'idle';
        return;
      }

      const dist = this.edgeDistanceTo(this.targetEntity);
      if (dist <= range) {
        // In firing range: stop moving and fire
        this.path = [];
        const desiredAngle = Math.atan2(this.targetEntity.y - this.y, this.targetEntity.x - this.x);
        this.turretAngle = lerpAngle(this.turretAngle, desiredAngle, dt * 10);
        if (this.isInfantry || this.locomotion === 'air') {
          this.angle = this.turretAngle;
        }
        if (this.attackCooldown <= 0 && (this.maxAmmo <= 0 || this.ammo > 0)) {
          this.fireAt(this.targetEntity, engine);
          this.attackCooldown = Math.max(0.2, this.def.fireRate || 1.0);
        }
      } else {
        // Hold Ground stance prevents chasing out-of-range targets
        if (this.stance === 'holdGround') {
          this.path = [];
          if (!this.explicitAttackOrder) {
            this.targetEntity = null;
            this.target = null;
            this.state = 'idle';
          }
          return;
        }

        // Guard stance limits auto-chase distance to 4.5 tiles from guardOrigin
        const ts = getTileSize();
        if (
          this.stance === 'guard' &&
          !this.explicitAttackOrder &&
          this.guardOrigin &&
          this.distanceTo(this.guardOrigin.x, this.guardOrigin.y) > ts * 4.5
        ) {
          this.targetEntity = null;
          this.target = null;
          this.state = 'move';
          this.targetPos = { x: this.guardOrigin.x, y: this.guardOrigin.y };
          if (engine.map) {
            this.path = engine.map.findPath(
              this.x,
              this.y,
              this.guardOrigin.x,
              this.guardOrigin.y,
              this.locomotion
            );
          }
          return;
        }

        // Out of range: path toward target
        if ((this.path.length === 0 || this.repathTimer <= 0) && engine.map) {
          this.repathTimer = 0.65;
          this.path = engine.map.findPath(
            this.x,
            this.y,
            this.targetEntity.x,
            this.targetEntity.y,
            this.locomotion,
            this.targetEntity.isBuilding ? this.targetEntity.id : null
          );
        }
        this.followPath(dt, engine);
      }
    }

    _tryAutoRepairNearbyBridge(engine) {
      if (!engine || !engine.map || typeof engine.map.repairBridgeSpan !== 'function') return false;
      const ts = getTileSize();
      const cur = engine.map.worldToTile(this.x, this.y);
      let nearHutOrBridge = false;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const tile = engine.map.getTile(cur.tx + dx, cur.ty + dy);
          if (tile && (tile.hasBridgeHut || tile.demolishedBridge)) {
            nearHutOrBridge = true;
            break;
          }
        }
        if (nearHutOrBridge) break;
      }
      if (!nearHutOrBridge) return false;

      const restored = engine.map.repairBridgeSpan(cur.tx, cur.ty);
      if (restored > 0) {
        this.dead = true;
        this.selected = false;
        engine.spawnFloatingText(this.x, this.y - 24, 'BRIDGE REPAIRED!', '#22c55e');
        engine.spawnParticles(this.x, this.y, 'spark', 12);
        if (typeof engine.notifyEVA === 'function') {
          engine.notifyEVA('BRIDGE REPAIRED', 'Bridge repaired');
        }
        if (window.RA.audio) {
          window.RA.audio.playSfx('repair');
        }
        return true;
      }
      return false;
    }

    updateEngineerBridgeRepair(dt, engine) {
      if (!engine || !engine.map) {
        this.state = 'idle';
        return;
      }
      const ts = getTileSize();
      const target = this.bridgeTarget || this.targetPos || { x: this.x, y: this.y };
      const dist = this.distanceTo(target.x, target.y);

      if (dist <= ts * 2.2 || this.path.length === 0) {
        const cur = engine.map.worldToTile(this.x, this.y);
        const targetTile = engine.map.worldToTile(target.x, target.y);
        let restored = 0;
        if (typeof engine.map.repairBridgeSpan === 'function') {
          restored =
            engine.map.repairBridgeSpan(cur.tx, cur.ty) ||
            engine.map.repairBridgeSpan(targetTile.tx, targetTile.ty);
        }
        if (restored > 0 || dist <= ts * 1.5) {
          this.dead = true;
          this.selected = false;
          engine.spawnFloatingText(this.x, this.y - 24, 'BRIDGE REPAIRED!', '#22c55e');
          engine.spawnParticles(this.x, this.y, 'spark', 12);
          if (typeof engine.notifyEVA === 'function') {
            engine.notifyEVA('BRIDGE REPAIRED', 'Bridge repaired');
          }
          if (window.RA.audio) {
            window.RA.audio.playSfx('repair');
          }
          return;
        }
      }

      if ((this.path.length === 0 || this.repathTimer <= 0) && engine.map) {
        this.repathTimer = 0.8;
        this.path = engine.map.findPath(this.x, this.y, target.x, target.y, this.locomotion);
      }
      this.followPath(dt, engine);
    }

    updateEngineer(dt, engine) {
      const b = this.targetEntity;
      if (!b || b.dead || !b.isBuilding) {
        this.targetEntity = null;
        this.target = null;
        this.state = 'idle';
        this.path = [];
        return;
      }

      const ts = getTileSize();
      const captureDist = (Math.max(b.w, b.h) * 0.5 + 1.15) * ts;
      const dist = this.distanceTo(b);

      if (dist <= captureDist || this.edgeDistanceTo(b) <= ts * 0.9) {
        if (!this.isFriendly(b)) {
          // Capture enemy building!
          const oldTeam = b.team;
          b.team = this.team;
          b.faction = this.faction;
          b.hp = Math.min(
            b.maxHp,
            Math.max(Math.round(b.maxHp * 0.5), b.hp + Math.round(b.maxHp * 0.5))
          );
          b.target = null;
          b.targetEntity = null;

          this.dead = true;
          this.selected = false;

          if (typeof engine.recalculatePower === 'function') {
            engine.recalculatePower(oldTeam);
            engine.recalculatePower(this.team);
          }
          if (engine.map && typeof engine.map.revealCircle === 'function') {
            engine.map.revealCircle(b.x, b.y, b.sight || 7);
          }
          engine.spawnFloatingText(b.x, b.y - 24, 'CAPTURED!', '#22c55e');
          engine.spawnParticles(b.x, b.y, 'spark', 12);
          if (window.RA.audio) {
            window.RA.audio.playSfx('cash');
            window.RA.audio.speak('Construction complete');
          }
        } else {
          // Repair friendly building to full HP!
          if (b.hp < b.maxHp) {
            b.hp = b.maxHp;
            b.isRepairing = false;
            this.dead = true;
            this.selected = false;
            engine.spawnFloatingText(b.x, b.y - 24, 'REPAIRED 100%!', '#38bdf8');
            engine.spawnParticles(b.x, b.y, 'spark', 10);
            if (window.RA.audio) {
              window.RA.audio.playSfx('repair');
              window.RA.audio.speak('Repairing');
            }
          } else {
            this.state = 'idle';
            this.targetEntity = null;
          }
        }
        return;
      }

      if ((this.path.length === 0 || this.repathTimer <= 0) && engine.map) {
        this.repathTimer = 0.8;
        this.path = engine.map.findPath(this.x, this.y, b.x, b.y, this.locomotion, b.id);
      }
      this.followPath(dt, engine);
    }

    /**
     * Spy ('spy') & Thief ('thf') covert building infiltration
     */
    updateInfiltrator(dt, engine) {
      const b = this.targetEntity;
      if (!b || b.dead || !b.isBuilding) {
        this.targetEntity = null;
        this.target = null;
        this.state = 'idle';
        this.path = [];
        return;
      }

      const ts = getTileSize();
      const reachDist = (Math.max(b.w, b.h) * 0.5 + 1.15) * ts;
      const dist = this.distanceTo(b);

      if (dist <= reachDist || this.edgeDistanceTo(b) <= ts * 0.95) {
        this.infiltrate(b, engine);
        return;
      }

      if ((this.path.length === 0 || this.repathTimer <= 0) && engine.map) {
        this.repathTimer = 0.8;
        this.path = engine.map.findPath(this.x, this.y, b.x, b.y, this.locomotion, b.id);
      }
      this.followPath(dt, engine);
    }

    infiltrate(b, engine) {
      if (!b || b.dead || !engine) return false;
      const enemyTeam = engine.teams && engine.teams[b.team];
      const myTeam = engine.teams && engine.teams[this.team];

      if (this.defId === 'thf') {
        const avail = enemyTeam ? Math.max(0, enemyTeam.credits) : 1000;
        const stolen = avail > 0 ? Math.round(avail * 0.5) : 500;
        if (enemyTeam) {
          enemyTeam.credits = Math.max(0, enemyTeam.credits - stolen);
        }
        engine.addCredits(this.team, stolen, false);
        engine.spawnFloatingText(b.x, b.y - 24, '+$' + stolen + ' SIPHONED!', '#facc15');
        engine.spawnParticles(b.x, b.y, 'spark', 10);
        if (window.RA.audio) {
          window.RA.audio.playSfx('spy_infiltrate');
          window.RA.audio.playSfx('cash');
        }
      } else {
        // Allied Spy ('spy')
        if (b.defId === 'refinery' || b.defId === 'silo') {
          const avail = enemyTeam ? Math.max(0, enemyTeam.credits) : 1000;
          const stolen = avail > 0 ? Math.round(avail * 0.25) : 250;
          if (enemyTeam) enemyTeam.credits = Math.max(0, enemyTeam.credits - stolen);
          engine.addCredits(this.team, stolen, false);
          engine.spawnFloatingText(b.x, b.y - 24, '+$' + stolen + ' INTEL SIPHON!', '#facc15');
        } else if (b.defId === 'power' || b.defId === 'advpower') {
          if (enemyTeam) {
            enemyTeam.blackoutTimer = 30.0;
            enemyTeam.lowPower = true;
          }
          engine.spawnFloatingText(b.x, b.y - 24, 'ENEMY POWER BLACKOUT (30s)!', '#38bdf8');
        } else if (b.defId === 'radar') {
          if (myTeam) myTeam.revealAllTimer = 60.0;
          if (engine.map && typeof engine.map.updateFog === 'function') {
            engine.map.updateFog(engine.entities, this.team, true);
          }
          engine.spawnFloatingText(b.x, b.y - 24, 'RADAR INFILTRATED — MAP REVEALED!', '#38bdf8');
        } else if (b.defId === 'weap' || b.defId === 'barracks' || b.defId === 'helipad' || b.defId === 'afld') {
          if (enemyTeam && enemyTeam.queues) {
            if (Array.isArray(enemyTeam.queues.infantry)) {
              enemyTeam.queues.infantry.forEach((q) => {
                q.progress = 0;
              });
            }
            if (Array.isArray(enemyTeam.queues.vehicle)) {
              enemyTeam.queues.vehicle.forEach((q) => {
                q.progress = 0;
              });
            }
          }
          engine.spawnFloatingText(b.x, b.y - 24, 'PRODUCTION RESET!', '#f97316');
        } else {
          // Default infiltration effect on ConYard or other structures
          const avail = enemyTeam ? Math.max(0, enemyTeam.credits) : 1000;
          const stolen = avail > 0 ? Math.round(avail * 0.25) : 250;
          if (enemyTeam) {
            enemyTeam.credits = Math.max(0, enemyTeam.credits - stolen);
            enemyTeam.blackoutTimer = 30.0;
            enemyTeam.lowPower = true;
          }
          engine.addCredits(this.team, stolen, false);
          engine.spawnFloatingText(b.x, b.y - 24, 'INFILTRATED! +$' + stolen, '#38bdf8');
        }
        engine.spawnParticles(b.x, b.y, 'chrono', 10);
        if (window.RA.audio) {
          window.RA.audio.playSfx('spy_infiltrate');
        }
      }

      this.dead = true;
      this.selected = false;
      return true;
    }

    /**
     * Chrono Tank ('ctnk') personal Chrono Blink teleport within 14 tiles
     */
    chronoBlink(wx, wy, engine) {
      const eng = engine || (window.RA.app && window.RA.app.engine);
      if (this.dead || !eng || this.chronoCooldown > 0) return false;
      const ts = getTileSize();

      let targetX = wx !== undefined && wx !== null ? Number(wx) : this.x + Math.cos(this.angle) * ts * 5;
      let targetY = wy !== undefined && wy !== null ? Number(wy) : this.y + Math.sin(this.angle) * ts * 5;

      const maxDist = 14 * ts;
      const dx = targetX - this.x;
      const dy = targetY - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > maxDist && dist > 0.001) {
        targetX = this.x + (dx / dist) * maxDist;
        targetY = this.y + (dy / dist) * maxDist;
      }

      const destTx = Math.floor(targetX / ts);
      const destTy = Math.floor(targetY / ts);
      const spot =
        typeof eng._findClearUnitTile === 'function'
          ? eng._findClearUnitTile(destTx, destTy, this.locomotion)
          : { x: targetX, y: targetY };

      eng.spawnParticles(this.x, this.y, 'chrono', 14);
      this.x = spot.x;
      this.y = spot.y;
      this.path = [];
      this.state = 'idle';
      this.guardOrigin = { x: this.x, y: this.y };
      this.chronoCooldown = this.maxChronoCooldown || 35;

      eng.spawnParticles(this.x, this.y, 'chrono', 14);
      eng.spawnFloatingText(this.x, this.y - 20, 'CHRONO BLINK!', '#38bdf8');
      if (window.RA.audio) {
        window.RA.audio.playSfx('chrono');
      }
      return true;
    }

    /**
     * M.A.D. Tank ('qtnk') seismic shockwave detonation
     */
    detonateMadBlast(engine) {
      if (!engine) return false;
      const radius = 320;
      const blastDamage = 450;

      for (let i = 0; i < engine.entities.length; i++) {
        const e = engine.entities[i];
        if (!e || e.dead || e === this || this.isFriendly(e)) continue;
        if (e.locomotion === 'air') continue;
        const d = Math.hypot(e.x - this.x, e.y - this.y);
        if (d <= radius) {
          e.takeDamage(blastDamage, this, engine);
        }
      }

      engine.spawnParticles(this.x, this.y, 'explosion', 28);
      engine.particles.push(
        new Particle({
          x: this.x,
          y: this.y,
          size: 18,
          radius: 18,
          maxRadius: radius,
          color: '#f59e0b',
          life: 0.75,
          type: 'shockwave'
        })
      );
      if (typeof engine.addDecal === 'function') {
        engine.addDecal(this.x, this.y, 'crater', 36, 0);
      }
      engine.spawnFloatingText(this.x, this.y - 28, 'SEISMIC SHOCKWAVE!', '#f59e0b', 16);
      if (window.RA.audio) {
        window.RA.audio.playSfx('big_explosion');
      }

      this.hp = 0;
      this.dead = true;
      this.selected = false;
      this.madCharging = false;
      this.madChargeTimer = 0;
      return true;
    }

    updateHarvester(dt, engine) {
      const ts = getTileSize();
      if (!engine.map) return;

      if (this.state === 'move') {
        if (this.path && this.path.length > 0) {
          this.followPath(dt, engine);
          return;
        } else {
          this.state = this.cargo >= this.maxCargo ? 'returnOre' : 'harvest';
        }
      }

      if (this.state === 'idle') {
        this.state = this.cargo >= this.maxCargo ? 'returnOre' : 'harvest';
      }

      if (this.state === 'harvest') {
        if (this.cargo >= this.maxCargo) {
          this.state = 'returnOre';
          this.path = [];
          this.oreTile = null;
          return;
        }

        const curTile = engine.map.worldToTile(this.x, this.y);
        const currentTileObj = engine.map.getTile(curTile.tx, curTile.ty);

        let activeOreTx = -1;
        let activeOreTy = -1;

        if (currentTileObj && currentTileObj.oreAmount > 0) {
          activeOreTx = curTile.tx;
          activeOreTy = curTile.ty;
        } else if (
          this.oreTile &&
          this.distanceTo(this.oreTile.x, this.oreTile.y) <= ts * 0.95
        ) {
          const ot = engine.map.getTile(this.oreTile.tx, this.oreTile.ty);
          if (ot && ot.oreAmount > 0) {
            activeOreTx = this.oreTile.tx;
            activeOreTy = this.oreTile.ty;
          }
        }

        if (activeOreTx >= 0 && activeOreTy >= 0) {
          this.path = [];
          this.harvestAnim += dt * 6;
          this.harvestTimer += dt;
          if (this.harvestTimer >= 0.6) {
            this.harvestTimer -= 0.6;
            const creditsEarned = engine.map.harvestTile(activeOreTx, activeOreTy, 25);
            if (creditsEarned > 0) {
              this.cargo = Math.min(this.maxCargo, this.cargo + creditsEarned);
            }
            const remainingTile = engine.map.getTile(activeOreTx, activeOreTy);
            if (this.cargo >= this.maxCargo) {
              this.state = 'returnOre';
              this.oreTile = null;
              this.path = [];
            } else if (!remainingTile || remainingTile.oreAmount <= 0) {
              this.oreTile = null;
            }
          }
          return;
        }

        if (this.oreTile) {
          const ot = engine.map.getTile(this.oreTile.tx, this.oreTile.ty);
          if (!ot || ot.oreAmount <= 0) {
            this.oreTile = null;
            this.path = [];
          }
        }

        if (!this.oreTile && this.repathTimer <= 0) {
          this.repathTimer = 0.8;
          const found = engine.map.findNearestOre(curTile.tx, curTile.ty, 64);
          if (found) {
            this.oreTile = found;
            this.path = engine.map.findPath(this.x, this.y, found.x, found.y, this.locomotion);
          } else if (this.cargo > 0) {
            this.state = 'returnOre';
            this.path = [];
          }
        } else if (this.oreTile && this.path.length === 0 && this.repathTimer <= 0) {
          this.repathTimer = 0.8;
          this.path = engine.map.findPath(
            this.x,
            this.y,
            this.oreTile.x,
            this.oreTile.y,
            this.locomotion
          );
        }

        if (this.path.length > 0) {
          this.followPath(dt, engine);
        }
        return;
      }

      if (this.state === 'returnOre') {
        const refinery = engine.findNearestBuilding(this.x, this.y, this.team, 'refinery');
        if (!refinery) {
          if (this.cargo < this.maxCargo) {
            this.state = 'harvest';
          }
          return;
        }

        const dockX = refinery.x;
        const dockY = refinery.y + (refinery.h / 2 + 0.4) * ts;
        const distToDock = Math.hypot(this.x - dockX, this.y - dockY);
        const distToRefinery = this.edgeDistanceTo(refinery);

        if (distToDock <= ts * 1.35 || distToRefinery <= ts * 0.95) {
          const amount = Math.round(this.cargo);
          if (amount > 0) {
            engine.addCredits(this.team, amount, true);
            engine.spawnFloatingText(refinery.x, refinery.y - 20, '+$' + amount, '#facc15');
            if (this.team === 'player' && window.RA.audio) {
              window.RA.audio.playSfx('cash');
            }
          }
          this.cargo = 0;
          this.harvestTimer = 0;
          this.oreTile = null;
          this.path = [];
          this.state = 'harvest';
          return;
        }

        if ((this.path.length === 0 || this.repathTimer <= 0) && engine.map) {
          this.repathTimer = 0.9;
          this.path = engine.map.findPath(this.x, this.y, dockX, dockY, this.locomotion, refinery.id);
        }

        if (this.path.length > 0) {
          this.followPath(dt, engine);
        }
      }
    }

    followPath(dt, engine) {
      if (!this.path || this.path.length === 0) return;
      const wp = this.path[0];
      const dx = wp.x - this.x;
      const dy = wp.y - this.y;
      const dist = Math.hypot(dx, dy);

      const reachThreshold = this.path.length > 1 ? 10 : 6;
      if (dist <= reachThreshold) {
        this.path.shift();
        if (this.path.length === 0) return;
      }

      const targetWp = this.path[0];
      if (!targetWp) return;

      const tdx = targetWp.x - this.x;
      const tdy = targetWp.y - this.y;
      const tdist = Math.hypot(tdx, tdy);
      if (tdist < 0.001) {
        this.path.shift();
        return;
      }

      const desiredAngle = Math.atan2(tdy, tdx);
      this.angle = lerpAngle(this.angle, desiredAngle, dt * 12);
      if (!this.targetEntity || this.targetEntity.dead) {
        this.turretAngle = lerpAngle(this.turretAngle, this.angle, dt * 10);
      }

      const step = Math.min(tdist, this.speed * dt);
      const nextX = this.x + (tdx / tdist) * step;
      const nextY = this.y + (tdy / tdist) * step;

      if (engine && engine.map && this.locomotion !== 'air') {
        const nextTile = engine.map.worldToTile(nextX, nextY);
        const curTile = engine.map.worldToTile(this.x, this.y);
        if (
          (nextTile.tx !== curTile.tx || nextTile.ty !== curTile.ty) &&
          !engine.map.isPassable(nextTile.tx, nextTile.ty, this.locomotion)
        ) {
          // Allow heavy crusher tanks to crush enemy sandbag/wire walls on the next tile
          if (this.def.crusher) {
            this.checkCrush(engine, nextX, nextY);
          }
          if (!engine.map.isPassable(nextTile.tx, nextTile.ty, this.locomotion)) {
            const finalGoal = this.path[this.path.length - 1];
            this.path = engine.map.findPath(
              this.x,
              this.y,
              finalGoal.x,
              finalGoal.y,
              this.locomotion
            );
            return;
          }
        }
      }

      this.x = nextX;
      this.y = nextY;
      this.moveAnim += dt * 8;

      // Spawn persistent tank track marks for tracked vehicles
      if (
        this.locomotion === 'land' &&
        TRACKED_VEHICLE_IDS.includes(this.defId) &&
        engine &&
        typeof engine.addDecal === 'function'
      ) {
        this.trackDistAccum = (this.trackDistAccum || 0) + step;
        if (this.trackDistAccum >= 28) {
          this.trackDistAccum = 0;
          engine.addDecal(this.x, this.y, 'tracks', 12, this.angle);
        }
      }
    }

    applySeparation(dt, engine) {
      if (!engine || !Array.isArray(engine.entities)) return;
      const ts = getTileSize();
      let pushX = 0;
      let pushY = 0;

      for (let i = 0; i < engine.entities.length; i++) {
        const other = engine.entities[i];
        if (!other || other === this || other.dead || !other.isUnit) continue;
        if (other.locomotion !== this.locomotion) continue;

        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const minDist = (this.radius + other.radius) * 0.85;
        if (Math.abs(dx) > minDist || Math.abs(dy) > minDist) continue;
        const dist = Math.hypot(dx, dy);
        if (dist < minDist) {
          // Don't separate enemy crushable infantry from a crushing tank
          if (
            !this.isFriendly(other) &&
            ((this.def.crusher && other.isInfantry && !other.unCrushable) ||
              (other.def.crusher && this.isInfantry && !this.unCrushable))
          ) {
            continue;
          }
          const overlap = minDist - dist;
          const nx = dist > 0.01 ? dx / dist : (this.id > other.id ? 1 : -1);
          const ny = dist > 0.01 ? dy / dist : (this.id % 2 === 0 ? 1 : -1);
          pushX += nx * overlap * 3.0 * dt;
          pushY += ny * overlap * 3.0 * dt;
        }
      }

      if (pushX !== 0 || pushY !== 0) {
        const candX = Math.max(
          ts * 0.5,
          Math.min((engine.map ? engine.map.pixelWidth : 2560) - ts * 0.5, this.x + pushX)
        );
        const candY = Math.max(
          ts * 0.5,
          Math.min((engine.map ? engine.map.pixelHeight : 2560) - ts * 0.5, this.y + pushY)
        );
        if (
          !engine.map ||
          engine.map.isPassable(Math.floor(candX / ts), Math.floor(candY / ts), this.locomotion)
        ) {
          this.x = candX;
          this.y = candY;
        }
      }
    }

    checkCrush(engine, probeX = this.x, probeY = this.y) {
      if (!this.def.crusher || this.locomotion !== 'land' || !engine || !Array.isArray(engine.entities)) {
        return;
      }
      for (let i = 0; i < engine.entities.length; i++) {
        const other = engine.entities[i];
        if (!other || other.dead || this.isFriendly(other)) continue;
        if (other.ironCurtainTimer && other.ironCurtainTimer > 0) continue;

        // 1. Crush enemy infantry (except Shock Trooper / unCrushable)
        if (
          other.isUnit &&
          other.isInfantry &&
          !other.unCrushable &&
          !(other.def && other.def.unCrushable) &&
          other.defId !== 'shok'
        ) {
          const dist = Math.hypot(other.x - probeX, other.y - probeY);
          if (dist <= this.radius + other.radius * 0.75) {
            other.takeDamage(9999, this, engine);
            engine.spawnParticles(other.x, other.y, 'blood', 6);
            engine.spawnFloatingText(other.x, other.y - 12, 'CRUSHED!', '#ef4444');
            if (window.RA.audio) {
              window.RA.audio.playSfx('explosion');
            }
          }
        }

        // 2. Crush enemy Sandbag ('sbag') and Wire Fence ('fenc') walls (not Concrete 'brik')
        if (
          other.isBuilding &&
          (other.isWall || (other.def && other.def.isWall)) &&
          !other.unCrushable &&
          !(other.def && other.def.unCrushable) &&
          other.defId !== 'brik'
        ) {
          const dist = Math.hypot(other.x - probeX, other.y - probeY);
          if (dist <= this.radius + 22) {
            other.takeDamage(9999, this, engine);
            engine.spawnParticles(other.x, other.y, 'smoke', 6);
          }
        }
      }
    }

    fireAt(target, engine) {
      if (!target || target.dead || !engine) return;

      // Consume aircraft ammo if applicable
      if (this.maxAmmo > 0) {
        if (this.ammo <= 0) return;
        this.ammo = Math.max(0, this.ammo - 1);
        this.reloadTimer = 0;
      }

      // Submarine uncloaks for 3.0s when firing torpedoes
      if (this.defId === 'ss' || this.def.cloaked) {
        this.submerged = false;
        this.uncloakTimer = 3.0;
      }

      // Attack Dog ('dog') performs instant lethal melee leap against infantry
      if (this.defId === 'dog') {
        const dogDamage = (this.def.damage || 999) * this.getDamageMultiplier();
        target.takeDamage(dogDamage, this, engine);
        engine.spawnParticles(target.x, target.y, 'blood', 8);
        if (window.RA.audio) {
          window.RA.audio.playSfx('dog_bark');
        }
        return;
      }

      const projType = this.def.projectileType || 'bullet';
      const angle = Math.atan2(target.y - this.y, target.x - this.x);
      const muzzleDist = this.radius + 4;
      const sx = this.x + Math.cos(angle) * muzzleDist;
      const sy = this.y + Math.sin(angle) * muzzleDist;

      let baseDamage = (this.def.damage || 15) * this.getDamageMultiplier();
      if (this.defId === 'tanya' && target.isBuilding) {
        baseDamage *= 3.0;
      }

      engine.spawnProjectile({
        type: projType,
        team: this.team,
        faction: this.faction,
        attacker: this,
        startX: sx,
        startY: sy,
        targetX: target.x,
        targetY: target.y,
        targetEntity: target,
        damage: baseDamage,
        splash: this.def.splash || 0
      });

      if (window.RA.audio) {
        if (projType === 'torpedo') {
          window.RA.audio.playSfx('torpedo');
        } else if (projType === 'flak') {
          window.RA.audio.playSfx('flak');
        } else if (projType === 'bullet') {
          window.RA.audio.playSfx(this.isInfantry ? 'rifle' : 'machinegun');
        } else if (projType === 'rocket' || projType === 'sam_missile') {
          window.RA.audio.playSfx('rocket');
        } else if (projType === 'tesla') {
          window.RA.audio.playSfx('tesla');
        } else if (projType === 'c4') {
          window.RA.audio.playSfx(target.isBuilding ? 'big_explosion' : 'rifle');
        } else {
          window.RA.audio.playSfx('cannon');
        }
      }
    }

    /**
     * Deploys an MCV into a 3x3 Construction Yard ('conyard'),
     * triggers M.A.D. Tank ('qtnk') seismic charge,
     * or triggers Chrono Tank ('ctnk') Chrono Blink.
     */
    deploy(engine, targetWorldPos = null) {
      if (this.dead || !engine) return false;

      if (this.defId === 'qtnk') {
        if (this.madCharging) return true;
        this.madCharging = true;
        this.madChargeTimer = 3.0;
        this.path = [];
        this.state = 'deploy';
        const ts = getTileSize();
        const driverSpot =
          typeof engine._findClearUnitTile === 'function'
            ? engine._findClearUnitTile(Math.floor(this.x / ts) - 1, Math.floor(this.y / ts) + 1, 'land')
            : { x: this.x - 28, y: this.y + 28 };
        engine.spawnUnit('rifle', driverSpot.x, driverSpot.y, this.team, { faction: this.faction });
        engine.spawnFloatingText(this.x, this.y - 24, 'SEISMIC CHARGE ARMED (3s)!', '#f59e0b');
        if (window.RA.audio) {
          window.RA.audio.playSfx('seismic_charge');
        }
        return true;
      }

      if (this.defId === 'ctnk') {
        const wx = targetWorldPos && targetWorldPos.x !== undefined ? targetWorldPos.x : undefined;
        const wy = targetWorldPos && targetWorldPos.y !== undefined ? targetWorldPos.y : undefined;
        return this.chronoBlink(wx, wy, engine);
      }

      if (this.defId !== 'mcv' || !engine.map) return false;

      const ts = getTileSize();
      const centerTile = engine.map.worldToTile(this.x, this.y);
      const baseTx = centerTile.tx - 1;
      const baseTy = centerTile.ty - 1;

      const offsets = [
        [0, 0],
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
        [0, -2],
        [0, 2],
        [-2, 0],
        [2, 0]
      ];

      let validTx = -1;
      let validTy = -1;

      for (let k = 0; k < offsets.length; k++) {
        const candTx = baseTx + offsets[k][0];
        const candTy = baseTy + offsets[k][1];
        if (this._canDeployAt(candTx, candTy, 3, 3, engine)) {
          validTx = candTx;
          validTy = candTy;
          break;
        }
      }

      if (validTx < 0 || validTy < 0) {
        if (this.team === 'player' && typeof engine.notifyEVA === 'function') {
          engine.notifyEVA('Cannot deploy here — terrain blocked');
        }
        return false;
      }

      const minPx = validTx * ts;
      const maxPx = (validTx + 3) * ts;
      const minPy = validTy * ts;
      const maxPy = (validTy + 3) * ts;

      for (let i = 0; i < engine.entities.length; i++) {
        const e = engine.entities[i];
        if (e && !e.dead && e !== this && e.isUnit && e.locomotion === 'land') {
          if (e.x >= minPx - 8 && e.x <= maxPx + 8 && e.y >= minPy - 8 && e.y <= maxPy + 8) {
            e.y = maxPy + ts * 0.6;
          }
        }
      }

      const wasSelected = this.selected;
      this.dead = true;
      this.selected = false;

      const conyard = engine.spawnBuilding('conyard', validTx, validTy, this.team, {
        faction: this.faction,
        selected: wasSelected
      });

      if (engine.map && typeof engine.map.revealCircle === 'function') {
        engine.map.revealCircle(conyard.x, conyard.y, conyard.sight || 8);
        engine.map.updateFog(engine.entities, 'player', !engine.map.fogEnabled);
      }

      if (this.team === 'player') {
        engine.spawnFloatingText(conyard.x, conyard.y - 28, 'CONSTRUCTION YARD DEPLOYED', '#38bdf8');
        if (window.RA.audio) {
          window.RA.audio.playSfx('build_place');
          window.RA.audio.speak('Construction complete');
        }
      }

      return conyard;
    }

    _canDeployAt(tx, ty, w, h, engine) {
      const TILE_TYPES = window.RA.TILE_TYPES || { WATER: 2, BRIDGE: 3, ROCK: 4 };
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const cx = tx + dx;
          const cy = ty + dy;
          if (!engine.map.inBounds(cx, cy)) return false;
          const tile = engine.map.getTile(cx, cy);
          if (!tile) return false;
          if (
            tile.type === TILE_TYPES.WATER ||
            tile.type === TILE_TYPES.ROCK ||
            tile.type === TILE_TYPES.BRIDGE
          ) {
            return false;
          }
          if (tile.buildingId !== null && tile.buildingId !== undefined) {
            return false;
          }
        }
      }
      return true;
    }
  }

  /**
   * Projectile class ('bullet', 'shell', 'rocket', 'sam_missile', 'flak', 'torpedo', 'tesla', 'c4', 'nuke')
   */
  class Projectile {
    constructor(opts = {}) {
      this.id = NEXT_ENTITY_ID++;
      this.type = opts.type || opts.projectileType || 'bullet';
      this.projectileType = this.type;
      this.team = opts.team || 'player';
      this.faction = opts.faction || 'allied';
      this.attacker = opts.attacker || null;
      this.attackerId = this.attacker ? this.attacker.id : null;

      this.startX = opts.startX !== undefined ? opts.startX : (opts.x || 0);
      this.startY = opts.startY !== undefined ? opts.startY : (opts.y || 0);
      this.sx = this.startX;
      this.sy = this.startY;

      this.x = this.startX;
      this.y = this.startY;

      this.targetEntity = opts.targetEntity || null;
      this.targetX = opts.targetX !== undefined ? opts.targetX : (opts.tx !== undefined ? opts.tx : this.x);
      this.targetY = opts.targetY !== undefined ? opts.targetY : (opts.ty !== undefined ? opts.ty : this.y);
      this.tx = this.targetX;
      this.ty = this.targetY;

      this.damage = opts.damage !== undefined ? opts.damage : 25;
      this.splash = opts.splash !== undefined ? opts.splash : 0;

      const defaultSpeeds = {
        bullet: 620,
        shell: 440,
        rocket: 380,
        sam_missile: 520,
        flak: 680,
        torpedo: 340,
        tesla: 950,
        c4: 480,
        nuke: 420
      };
      this.speed = opts.speed || defaultSpeeds[this.type] || 460;
      this.angle = Math.atan2(this.ty - this.y, this.tx - this.x);

      this.totalDist = Math.max(1, Math.hypot(this.tx - this.startX, this.ty - this.startY));
      this.progress = 0;
      this.dead = false;
      this.trail = [{ x: this.x, y: this.y }];
      this.life = this.type === 'tesla' ? 0.16 : 5.0;
      this.maxLife = this.life;
      this.impacted = false;
    }

    update(dt, engine) {
      if (this.dead) return;

      // Track moving target for guided projectiles
      if (
        this.targetEntity &&
        !this.targetEntity.dead &&
        (this.type === 'rocket' ||
          this.type === 'sam_missile' ||
          this.type === 'flak' ||
          this.type === 'torpedo' ||
          this.type === 'bullet' ||
          this.type === 'tesla' ||
          this.type === 'c4')
      ) {
        this.targetX = this.targetEntity.x;
        this.targetY = this.targetEntity.y;
        this.tx = this.targetX;
        this.ty = this.targetY;
      }

      if (this.type === 'tesla') {
        if (!this.impacted) {
          this.impacted = true;
          this.x = this.tx;
          this.y = this.ty;
          this.explode(engine);
        }
        this.life -= dt;
        this.progress = 1 - Math.max(0, this.life / this.maxLife);
        if (this.life <= 0) {
          this.dead = true;
        }
        return;
      }

      const dx = this.tx - this.x;
      const dy = this.ty - this.y;
      const dist = Math.hypot(dx, dy);
      const step = this.speed * dt;

      if (dist <= step || dist <= 8) {
        this.x = this.tx;
        this.y = this.ty;
        this.progress = 1;
        this.explode(engine);
        this.dead = true;
        return;
      }

      this.angle = Math.atan2(dy, dx);
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;

      const traveled = Math.hypot(this.x - this.startX, this.y - this.startY);
      this.progress = Math.min(1, traveled / this.totalDist);

      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 8) {
        this.trail.shift();
      }

      if (
        engine &&
        (this.type === 'rocket' ||
          this.type === 'sam_missile' ||
          this.type === 'torpedo' ||
          this.type === 'nuke') &&
        Math.random() < 0.65
      ) {
        engine.particles.push(
          new Particle({
            x: this.x - Math.cos(this.angle) * 6,
            y: this.y - Math.sin(this.angle) * 6,
            vx: (Math.random() - 0.5) * 18,
            vy: (Math.random() - 0.5) * 18,
            size: this.type === 'nuke' ? 9 : 4,
            color:
              this.type === 'nuke'
                ? '#fb923c'
                : this.type === 'torpedo'
                ? '#e0f2fe'
                : '#94a3b8',
            life: 0.35,
            type: 'smoke'
          })
        );
      }

      this.life -= dt;
      if (this.life <= 0) {
        this.dead = true;
      }
    }

    explode(engine) {
      if (!engine) return;

      if (this.type === 'nuke') {
        engine.detonateNukeAt(this.tx, this.ty, this.team);
        return;
      }

      // Bridge demolition check on splash/heavy ordnance
      if (
        engine.map &&
        typeof engine.map.damageBridgeTile === 'function' &&
        (this.splash >= 20 || this.type === 'c4' || this.type === 'shell')
      ) {
        const hitTile = engine.map.worldToTile(this.tx, this.ty);
        const tileObj = engine.map.getTile(hitTile.tx, hitTile.ty);
        const TILE_TYPES = window.RA.TILE_TYPES || { BRIDGE: 3 };
        if (tileObj && tileObj.type === TILE_TYPES.BRIDGE) {
          engine.map.damageBridgeTile(hitTile.tx, hitTile.ty, this.damage);
          if (typeof engine.checkDrownedLandUnits === 'function') {
            engine.checkDrownedLandUnits();
          }
        }
      }

      if (this.splash > 0) {
        for (let i = 0; i < engine.entities.length; i++) {
          const e = engine.entities[i];
          if (!e || e.dead) continue;
          if (typeof engine.isFriendly === 'function' ? engine.isFriendly(this.team, e.team) : e.team === this.team) {
            continue;
          }
          if (this.attacker && typeof this.attacker.canTarget === 'function' && !this.attacker.canTarget(e, true)) {
            continue;
          }
          const centerDist = Math.hypot(e.x - this.tx, e.y - this.ty);
          const effDist = Math.max(0, centerDist - (e.radius || 12) * 0.5);
          if (effDist <= this.splash) {
            const falloff = Math.max(0.25, 1 - effDist / (this.splash * 1.25));
            e.takeDamage(this.damage * falloff, this.attacker, engine);
          }
        }
      } else if (this.targetEntity && !this.targetEntity.dead) {
        this.targetEntity.takeDamage(this.damage, this.attacker, engine);
      } else {
        const hit = engine.findNearestEnemy(this.tx, this.ty, this.team, 24, this.attacker);
        if (hit) {
          hit.takeDamage(this.damage, this.attacker, engine);
        }
      }

      // Add persistent scorch crater decal for explosive shells/rockets on land
      if (
        (this.splash >= 20 || this.type === 'shell' || this.type === 'c4') &&
        this.type !== 'flak' &&
        this.type !== 'torpedo' &&
        typeof engine.addDecal === 'function'
      ) {
        const radius = Math.max(12, Math.min(28, (this.splash || 24) * 0.45));
        engine.addDecal(this.tx, this.ty, 'crater', radius, Math.random() * Math.PI * 2);
      }

      if (this.type === 'tesla') {
        engine.spawnParticles(this.tx, this.ty, 'spark', 10);
      } else if (this.type === 'flak') {
        engine.spawnParticles(this.tx, this.ty, 'smoke', 8);
      } else if (this.type === 'c4' || this.splash >= 35) {
        engine.spawnParticles(this.tx, this.ty, 'explosion', 14);
        if (window.RA.audio) window.RA.audio.playSfx('big_explosion');
      } else if (
        this.type === 'shell' ||
        this.type === 'rocket' ||
        this.type === 'sam_missile' ||
        this.type === 'torpedo'
      ) {
        engine.spawnParticles(this.tx, this.ty, 'explosion', 8);
        if (window.RA.audio) window.RA.audio.playSfx('explosion');
      } else {
        engine.spawnParticles(this.tx, this.ty, 'spark', 4);
      }
    }
  }

  /**
   * Visual Particle class
   */
  class Particle {
    constructor(opts = {}) {
      this.x = opts.x || 0;
      this.y = opts.y || 0;
      this.vx = opts.vx || 0;
      this.vy = opts.vy || 0;
      this.size = opts.size !== undefined ? opts.size : 5;
      this.radius = opts.radius !== undefined ? opts.radius : this.size;
      this.maxRadius = opts.maxRadius !== undefined ? opts.maxRadius : this.size * 4;
      this.color = opts.color || '#f97316';
      this.type = opts.type || 'explosion';
      this.life = opts.life !== undefined ? opts.life : 0.5;
      this.maxLife = opts.maxLife !== undefined ? opts.maxLife : this.life;
      this.alpha = 1.0;
      this.dead = false;
      this.gravity = opts.gravity || 0;
    }

    update(dt) {
      if (this.dead) return;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.gravity) {
        this.vy += this.gravity * dt;
      }
      this.life -= dt;
      if (this.life <= 0) {
        this.life = 0;
        this.alpha = 0;
        this.dead = true;
        return;
      }
      const ratio = this.life / this.maxLife;
      this.alpha = Math.max(0, Math.min(1, ratio));
      if (this.type === 'shockwave' || this.type === 'move_pulse') {
        this.radius = this.size + (1 - ratio) * (this.maxRadius - this.size);
      }
    }
  }

  /**
   * Rising FloatingText class (e.g., '+$700')
   */
  class FloatingText {
    constructor(opts = {}) {
      this.x = opts.x || 0;
      this.y = opts.y || 0;
      this.text = opts.text !== undefined ? String(opts.text) : '';
      this.color = opts.color || '#facc15';
      this.vy = opts.vy !== undefined ? opts.vy : -28;
      this.life = opts.life !== undefined ? opts.life : 1.4;
      this.maxLife = opts.maxLife !== undefined ? opts.maxLife : this.life;
      this.size = opts.size || 14;
      this.fontSize = this.size;
      this.alpha = 1.0;
      this.dead = false;
    }

    update(dt) {
      if (this.dead) return;
      this.y += this.vy * dt;
      this.life -= dt;
      if (this.life <= 0) {
        this.life = 0;
        this.alpha = 0;
        this.dead = true;
        return;
      }
      this.alpha = Math.max(0, Math.min(1, this.life / this.maxLife));
    }
  }

  window.RA.Entity = Entity;
  window.RA.Building = Building;
  window.RA.Unit = Unit;
  window.RA.Projectile = Projectile;
  window.RA.Particle = Particle;
  window.RA.FloatingText = FloatingText;
})();
