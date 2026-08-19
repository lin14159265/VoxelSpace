// Universe V2 飞船驾驶：真实三维速度矢量 + 机头朝向推进 + 分级航行。
//
// 与 V1 的关键差异：
//   - W 沿飞船机头方向（含 pitch）施加推力，不再只是水平速度；
//   - 飞船拥有真正的 velocity vector（地表帧 / 宇宙帧之间连续换算）；
//   - 太空深空使用脉冲航行（有效速度包线），天体位置不被移动，由飞船能力
//     跨越真实距离；
//   - 机头姿态由“局部姿态 + 参考系四元数”组成，进出大气层时姿态连续。
import * as THREE from 'three';
import { KEY, clamp, lerp } from '../core/constants.js';
import { isSolid } from '../world/blocks.js';
import { airDragFactor, reentryDurationOf, reentryStrengthOf } from '../space/celestial.js';
import {
  DRIVE_NORMAL_MAX_M_S, DRIVE_PULSE_MAX_M_S, DRIVE_PULSE_ACCEL_M_S2, PULSE_DECEL_M_S2,
  ATMO_BASE_MAX_M_S, ATMO_THRUST_M_S2, ATMO_BRAKE_M_S2, ATMO_DRAG_M_S2,
} from '../space/universe.js';

const MIN_FLY_H = 1.7;       // 船底距地面最小高度（降落）
const ASSIST_THRUST = 18;    // Space/Ctrl 的平移辅助推力（m/s²）
const ASSIST_MAX = 120;      // 平移辅助最大速率（m/s，相对地平帧）
const PULSE_RAMP = 0.45;     // 脉冲倍率平滑速率（越大越跟手）


export class ShipFlight {
  constructor(game) {
    this.game = game;
    this.piloting = false;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.vel = new THREE.Vector3();       // 当前参考系中的真实速度矢量
    this.onGround = true;
    this.launched = false;
    this.engineTimer = 0;
    this.lastYaw = 0;
    this.spaceMode = false;
    this.quat = new THREE.Quaternion();   // 局部姿态（yaw/pitch/roll）
    this.refQuat = new THREE.Quaternion();// 局部参考系 → 宇宙/世界系
    this.worldQuat = new THREE.Quaternion();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');

    // Universe V2 状态
    this.universePos = null;              // 宇宙坐标（真实米，double 精度）
    this.universeVel = null;              // 宇宙帧速度矢量
    this.spaceBody = null;                // 当前主导天体（universe body）
    this.localBasis = null;               // { east, north, up }（地表帧）
    this.pulseScale = 1;                  // 兼容字段（V2 用真实速度）
    this.pulseTarget = 1;
    this.pulseLimit = DRIVE_PULSE_MAX_M_S; // 当前脉冲速度上限（由距离包线给定）
    this.displayAltM = 0;
    this.atmoTopM = null;                 // HUD 高度（地表米 / 天体表面高度）

    // 转向物理
    this.yawRate = 0;
    this.pitchRate = 0;
    this.mouseVelX = 0;
    this.mouseVelY = 0;
    this.cameraMode = 'cockpit';
    this.chasePos = new THREE.Vector3();
    this.chaseReady = false;

    // 再入热障
    this.reentryLeft = 0;
    this.reentryTotal = 0;
    this.reentryK = 0;
    this.reentryStrength = 0;
    this.reentryTimer = 0;
    this.lastEntry = null;

    // 舰船生存
    this.shieldMax = 100;
    this.shield = 100;
    this.hullMax = 100;
    this.hull = 100;
    this.impactCd = 0;
    this.hullWarned = false;
  }

  // ---- 兼容旧接口：speed / vertVel 作为投影值 ----
  get speed() { return this.vel.length(); }
  set speed(v) {
    const len = this.vel.length();
    if (len > 1e-6) this.vel.multiplyScalar(Math.max(0, v) / len);
    else this.vel.copy(this.forward()).multiplyScalar(Math.max(0, v));
  }
  get vertVel() { return this.localBasis ? this.vel.dot(this.localUp()) : this.vel.y; }
  set vertVel(v) {
    if (this.localBasis) {
      const up = this.localUp();
      const cur = this.vel.dot(up);
      this.vel.addScaledVector(up, v - cur);
    } else {
      this.vel.y = v;
    }
  }
  // 有效速度：V2 中太空速度就是真实宇宙速度。
  get effectiveSpeed() { return this.vel.length(); }

  refreshShipVitals() {
    this.shieldMax = 100 + 50 * ((this.game.shipUpgrades && this.game.shipUpgrades.shield) || 0);
    this.shield = Math.min(this.shield, this.shieldMax);
    this.hullMax = 100;
    this.hull = Math.min(this.hull, this.hullMax);
  }

  takeShipDamage(amount) {
    const g = this.game;
    if (!this.piloting || g.creative) return false;
    this.impactCd = 0.25;
    let toHull = amount;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      toHull -= absorbed;
    }
    if (toHull > 0) {
      this.hull = Math.max(0, this.hull - toHull);
      if (this.hull < 30 && !this.hullWarned) {
        this.hullWarned = true;
        g.ui.toast('船体严重受损 · 尽快离开危险区域', true);
        g.audio.play('warn');
      }
    }
    g.ui.shake();
    g.audio.play('hurt');
    if (this.hull <= 0) {
      this.hull = 0;
      g.ui.toast('船体失效 · 紧急返航自动启动', true);
      this.emergencyLand();
      return true;
    }
    return false;
  }

  regenShipShield(dt, safe) {
    if (!this.piloting || !safe) return;
    this.shield = Math.min(this.shieldMax, this.shield + 3.5 * dt);
    if (this.hull < this.hullMax) this.hull = Math.min(this.hullMax, this.hull + 1.2 * dt);
  }

  emergencyLand() {
    const g = this.game;
    if (g.space && g.space.active) g.space.forceExit();
    this.shield = this.shieldMax;
    this.hull = this.hullMax;
    this.hullWarned = false;
    if (this.piloting) this.exit();
    g.ui.shake();
    g.audio.play('mobAttack');
  }

  // ---- 速度能力 ----
  get maxSpeed() {
    if (this.spaceMode) return DRIVE_PULSE_MAX_M_S; // 有效速度上限（脉冲包线会平滑限制）
    const up = (this.game.shipUpgrades && this.game.shipUpgrades.engine) || 0;
    return ATMO_BASE_MAX_M_S + 60 * up;
  }

  setSpaceMode(v) {
    if (this.spaceMode === v) return;
    this.spaceMode = v;
  }

  get airDragK() {
    return airDragFactor(this.game.bodyProfile || { atmoDensity: 1 });
  }

  get reentryActive() { return this.reentryLeft > 0; }

  beginReentry() {
    const g = this.game;
    const def = g.bodyProfile || { atmoDensity: 1 };
    const strength = reentryStrengthOf(def);
    const duration = reentryDurationOf(def);
    this.lastEntry = { kind: strength > 0 ? 'plasma' : 'airless', strength, duration };
    if (strength <= 0 || duration <= 0) {
      this.reentryLeft = 0; this.reentryTotal = 0; this.reentryK = 0; this.reentryStrength = 0;
      g.ui.setReentry(0);
      g.ui.toast('进入无大气空域 · 没有再入热障，自由滑翔');
      return false;
    }
    this.reentryTotal = duration;
    this.reentryLeft = duration;
    this.reentryK = 1;
    this.reentryStrength = strength;
    this.reentryTimer = 0;
    g.ui.setReentry(strength);
    g.ui.shake();
    g.audio.play('warn');
    return true;
  }

  clearReentry() {
    this.reentryLeft = 0; this.reentryTotal = 0; this.reentryK = 0; this.reentryStrength = 0;
    if (this.game.ui) this.game.ui.setReentry(0);
  }

  updateReentry(dt) {
    const g = this.game;
    if (this.reentryLeft <= 0) {
      if (this.reentryK !== 0) { this.reentryK = 0; this.reentryStrength = 0; g.ui.setReentry(0); }
      return;
    }
    this.reentryLeft -= dt;
    if (this.reentryLeft <= 0) {
      this.reentryLeft = 0; this.reentryK = 0; this.reentryStrength = 0; g.ui.setReentry(0);
      return;
    }
    this.reentryK = Math.min(1, this.reentryLeft / (this.reentryTotal * 0.6));
    g.ui.setReentry(this.reentryK * this.reentryStrength);
    this.reentryTimer -= dt;
    if (this.reentryTimer <= 0) {
      this.reentryTimer = this.reentryStrength > 0.6 ? 0.02 : 0.04;
      const fwd = this.forwardUniverse();
      const tail = this.pos.clone().addScaledVector(fwd, -3.2);
      g.particles.spawnBurst(tail.x, this.pos.y + 0.6 + (Math.random() - 0.5) * 2.4, tail.z, 0xff7a2a, {
        count: 2, speed: 4, up: 0, life: 0.5, size: 0.18, gravity: 0, spread: 0.35, jitter: 1.6,
      });
    }
  }

  get ship() { return this.game.ship; }
  get world() { return this.game.world; }
  get player() { return this.game.player; }
  get input() { return this.game.input; }

  nearShip() {
    const p = this.ship.worldPos;
    const pp = this.player.pos;
    return Math.hypot(p.x - pp.x, p.z - pp.z) < 9;
  }
  canEnter() { return this.ship && this.ship.allRepaired && this.nearShip(); }
  groundHeight() { return this.world.getGroundY(this.pos.x, this.pos.z); }

  // ---- 参考系 ----
  localUp() {
    if (this.localBasis) return new THREE.Vector3(this.localBasis.up.x, this.localBasis.up.y, this.localBasis.up.z);
    return new THREE.Vector3(0, 1, 0);
  }
  localEast() {
    if (this.localBasis) return new THREE.Vector3(this.localBasis.east.x, this.localBasis.east.y, this.localBasis.east.z);
    return new THREE.Vector3(1, 0, 0);
  }
  localNorth() {
    if (this.localBasis) return new THREE.Vector3(this.localBasis.north.x, this.localBasis.north.y, this.localBasis.north.z);
    return new THREE.Vector3(0, 0, 1);
  }

  // 局部机头方向（含 pitch）。局部系：x=东、y=上、z=北。
  forward() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return new THREE.Vector3(-cp * Math.sin(this.yaw), sp, -cp * Math.cos(this.yaw));
  }

  // 宇宙/世界帧中的机头方向。
  forwardUniverse() {
    return this.forward().applyQuaternion(this.refQuat);
  }

  // 地表帧 → 宇宙帧；宇宙帧 → 地表帧。
  localVectorToUniverse(v) {
    const e = this.localEast(), n = this.localNorth(), u = this.localUp();
    const out = new THREE.Vector3();
    out.copy(e).multiplyScalar(v.x).addScaledVector(n, v.z).addScaledVector(u, v.y);
    return out;
  }
  universeVectorToLocal(v) {
    const e = this.localEast(), n = this.localNorth(), u = this.localUp();
    return new THREE.Vector3(v.dot(e), v.dot(u), v.dot(n));
  }

  // 进入太空：把地表局部坐标/速度转换到宇宙帧。
  setSpaceFrame(body, posM, velM, basis) {
    this.spaceMode = true;
    this.spaceBody = body;
    this.universePos = { x: posM.x, y: posM.y, z: posM.z };
    this.universeVel = { x: velM.x, y: velM.y, z: velM.z };
    this.vel.set(velM.x, velM.y, velM.z);
    this.localBasis = basis || null;
    this.pulseScale = 1;
    this.pulseTarget = 1;
    this.rebaseSpaceFrame();
  }

  // 返回/进入某天体地表帧。
  setLocalFrame(body, x, y, z, velLocal, basis) {
    this.spaceMode = false;
    this.spaceBody = body;
    this.atmoTopM = body ? (body.atmoDensity < 0.3 ? 20000 : (body.atmoDensity < 0.7 ? 30000 : 40000)) : null;
    this.localBasis = basis || null;
    this.pos.set(x, y, z);
    this.vel.copy(velLocal);
    this.universePos = null;
    this.universeVel = null;
    this.pulseScale = 1;
    this.pulseTarget = 1;
    this.updateRefQuat();
  }

  updateRefQuat() {
    if (this.localBasis) {
      const e = this.localEast(), n = this.localNorth(), u = this.localUp();
      const m = new THREE.Matrix4().makeBasis(e, u, n);
      this.refQuat.setFromRotationMatrix(m);
    } else {
      this.refQuat.identity();
    }
  }

  // 太空浮动原点：保持渲染坐标在原点附近，宇宙状态保持 double 精度。
  rebaseSpaceFrame() {
    if (!this.spaceMode || !this.universePos) return;
    this.pos.set(0, 0, 0);
  }

  enter() {
    const g = this.game;
    const p = this.ship.worldPos;
    this.piloting = true;
    this.pos.set(p.x, p.y + 1.0, p.z);
    this.yaw = Math.PI / 2 + 0.12;
    this.pitch = -0.16;
    this.roll = 0.06;
    this.vel.set(0, 0, 0);
    this.onGround = true;
    this.launched = false;
    this.lastYaw = this.yaw;
    this.yawRate = 0; this.pitchRate = 0;
    this.mouseVelX = 0; this.mouseVelY = 0;
    this.chaseReady = false;
    this.pos.y = Math.max(this.pos.y, this.groundHeight() + 2.0);
    // 地表参考系由 SpaceSystem 同步（真实天体表面帧）。
    if (g.space && typeof g.space.ensureSurfaceFrame === 'function') g.space.ensureSurfaceFrame(true);
    g.audio.startEngine();
    g.audio.setEngine(0.18);
    g.audio.play('enterShip');
    g.ui.setFlightHud(true);
    document.body.classList.add('piloting');
    g.ui.toast('已登船 · W 机头推进 / S 制动 · 空格上升辅助 · 鼠标转向 · V 视角');
    this.player.active = false;
    this.player.highlight.visible = false;
    if (this.player.placeGhost) this.player.placeGhost.visible = false;
    this.player.mineTarget = null;
    this.player.mineFrac = 0;
    g.ui.setInteractHint(null);
  }

  exit() {
    const g = this.game;
    this.piloting = false;
    g.audio.stopEngine();
    g.audio.play('exitShip');
    g.ui.setFlightHud(false);
    document.body.classList.remove('piloting');
    const p = this.ship.worldPos;
    const groundH = this.groundHeight();
    this.player.pos.set(p.x + 4, groundH + 2.2, p.z);
    this.player.vel.set(0, 0, 0);
    this.player.active = true;
    if (this.player.placeGhost) this.player.placeGhost.visible = false;
    this.roll = 0;
    this.applyTransform(1);
    this.player.updateCamera();
    g.ui.toast('已离开飞船');
  }

  // 渲染姿态：地表使用局部体素轴；太空使用宇宙/世界轴。
  renderQuat() {
    this.euler.set(this.pitch, this.yaw, this.roll);
    this.quat.setFromEuler(this.euler);
    this.worldQuat.copy(this.refQuat).multiply(this.quat);
    return this.spaceMode ? this.worldQuat : this.quat;
  }

  applyTransform(dt) {
    this.ship.group.quaternion.copy(this.renderQuat());
    this.ship.group.position.copy(this.pos);
  }

  solidAtWorld(x, y, z) {
    return isSolid(this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  // ---- 主更新 ----
  update(dt) {
    const g = this.game;
    const input = g.input;
    this.updateReentry(dt);
    if (!this.piloting) return;

    // 转向
    const sens = g.settings ? g.settings.sens : 1;
    const md = input.takeMouseDelta();
    const vx = md.x / Math.max(dt, 1e-3);
    const vy = md.y / Math.max(dt, 1e-3);
    this.mouseVelX = lerp(this.mouseVelX, vx, 1 - Math.exp(-10 * dt));
    this.mouseVelY = lerp(this.mouseVelY, vy, 1 - Math.exp(-10 * dt));
    const eff = this.effectiveSpeed;
    const turnFactor = 0.55 + 0.45 * (1 - Math.min(1, eff / Math.max(1, this.maxSpeed)));
    const maxYawRate = (this.spaceMode ? 1.15 : 0.85) * sens;
    const maxPitchRate = (this.spaceMode ? 0.8 : 0.6) * sens;
    const wantYaw = clamp(-this.mouseVelX * 0.0024 * sens * turnFactor, -maxYawRate, maxYawRate);
    const wantPitch = clamp(-this.mouseVelY * 0.0022 * sens * turnFactor, -maxPitchRate, maxPitchRate);
    this.yawRate = lerp(this.yawRate, wantYaw, 1 - Math.exp(-4.2 * dt));
    this.pitchRate = lerp(this.pitchRate, wantPitch, 1 - Math.exp(-4.2 * dt));
    this.yaw += this.yawRate * dt;
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -1.25, 1.25);
    const rollTarget = clamp(-this.yawRate * 150, -0.5, 0.5);
    this.roll = lerp(this.roll, rollTarget, 1 - Math.exp(-6 * dt));
    if (Math.abs(this.mouseVelY) < 12) {
      this.pitch = lerp(this.pitch, 0, 1 - Math.exp(-0.7 * dt));
      this.pitchRate = lerp(this.pitchRate, 0, 1 - Math.exp(-3 * dt));
    }

    // ---- 推进：W 沿机头，S 沿速度反向 ----
    const fwd = this.spaceMode ? this.forwardUniverse() : this.forward();
    const spd = this.vel.length();
    if (input.isDown(KEY.FORWARD)) {
      const thrust = this.spaceMode ? DRIVE_PULSE_ACCEL_M_S2 : ATMO_THRUST_M_S2;
      const cap = this.spaceMode ? this.pulseLimit : this.maxSpeed;
      const along = this.vel.dot(fwd);
      if (along < cap) this.vel.addScaledVector(fwd, thrust * dt);
    } else if (input.isDown(KEY.BACK)) {
      const brake = this.spaceMode ? PULSE_DECEL_M_S2 * 0.25 : ATMO_BRAKE_M_S2;
      if (spd > 1e-3) this.vel.addScaledVector(this.vel.clone().normalize().negate(), Math.min(brake * dt, spd));
    } else if (!this.spaceMode) {
      if (spd > 1e-3) {
        const dec = ATMO_DRAG_M_S2 * this.airDragK;
        this.vel.addScaledVector(this.vel.clone().normalize().negate(), Math.min(dec * dt, spd));
      }
    }
    // 近天体脉冲速度包线：真实速度超过允许上限时自动制动（连续减速，而非传送）。
    if (this.spaceMode && spd > this.pulseLimit) {
      const dec = Math.min(PULSE_DECEL_M_S2 * 2 * dt, spd - this.pulseLimit);
      this.vel.addScaledVector(this.vel.clone().normalize().negate(), dec);
    } else if (!this.spaceMode && this.atmoTopM && this.displayAltM > this.atmoTopM * 0.5 && spd > this.maxSpeed) {
      // 刚从脉冲速度交接进入大气帧时，在高空继续快速制动到大气速度上限。
      const dec = Math.min(PULSE_DECEL_M_S2 * dt, spd - this.maxSpeed);
      this.vel.addScaledVector(this.vel.clone().normalize().negate(), dec);
    }

    // ---- 平移辅助：Space/Ctrl（相对地平帧；太空取主导天体径向） ----
    const up = this.spaceMode ? this.radialUp() : this.localUp();
    const down = up.clone().negate();
    if (input.isDown(KEY.JUMP)) {
      const along = this.vel.dot(up);
      if (along < ASSIST_MAX) this.vel.addScaledVector(up, ASSIST_THRUST * dt);
    } else if (input.isDown(KEY.SNEAK) || input.isDown(KEY.SPRINT)) {
      const along = this.vel.dot(down);
      if (along < ASSIST_MAX * 0.7) this.vel.addScaledVector(down, ASSIST_THRUST * dt);
    }

    // ---- 积分 ----
    if (this.spaceMode) {
      this.integrateSpace(dt);
    } else {
      this.integrateAtmosphere(dt);
    }

    // 地表碰撞（仅大气/局部模式）
    if (!this.spaceMode) this.handleGroundCollision(dt);

    // 起飞判定
    if (!this.launched && !this.spaceMode && this.pos.y - this.groundHeight() > 6 && this.vel.length() > 1) {
      this.launched = true;
      g.audio.play('takeoff');
      g.quests.onLaunch();
      if (g.milestones) g.milestones.bump('launch', 1);
      g.ui.toast('已起飞 · 向大气层外爬升');
    }

    // 引擎表现
    const throttle = Math.min(1, this.effectiveSpeed / Math.max(1, this.maxSpeed));
    g.audio.setEngine(0.16 + throttle * 0.8);
    const glowK = 0.4 + throttle * 0.6 + Math.abs(this.vel.y) / 20 * 0.3 + this.reentryK * 0.8;
    this.ship.setEngineGlow(clamp(glowK, 0.3, 1.4));
    this.engineTimer -= dt;
    if (throttle > 0.15 && this.engineTimer <= 0) {
      this.engineTimer = this.spaceMode ? 0.012 : 0.035;
      const nozzle = this.ship.group.localToWorld(this.ship.smokePos.clone());
      g.particles.spawnBurst(nozzle.x, nozzle.y, nozzle.z, 0x9fe8ff, {
        count: 1, speed: 0.8, up: 0.5, spread: 0.6, life: 0.35, size: 0.12, gravity: 0,
      });
    }

    this.applyTransform(dt);
    this.updateCamera(dt, input);
  }

  radialUp() {
    if (this.spaceBody && this.universePos) {
      const dx = this.universePos.x - this.spaceBody.posM.x;
      const dy = this.universePos.y - this.spaceBody.posM.y;
      const dz = this.universePos.z - this.spaceBody.posM.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      return new THREE.Vector3(dx / len, dy / len, dz / len);
    }
    return new THREE.Vector3(0, 1, 0);
  }

  integrateSpace(dt) {
    // 真实速度直接积分；速度上限由 SpaceSystem 按“到最近天体表面距离”的
    // 脉冲包线每帧更新（v = sqrt(2·a·h)），保证接近天体前自然减速。
    this.universePos.x += this.vel.x * dt;
    this.universePos.y += this.vel.y * dt;
    this.universePos.z += this.vel.z * dt;
    this.universeVel = { x: this.vel.x, y: this.vel.y, z: this.vel.z };
    this.rebaseSpaceFrame();
    this.displayAltM = this.altitudeM();
  }

  integrateAtmosphere(dt) {
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    this.displayAltM = Math.max(0, this.pos.y - this.groundHeight());
  }

  altitudeM() {
    if (this.spaceMode && this.spaceBody) {
      const d = Math.hypot(
        this.universePos.x - this.spaceBody.posM.x,
        this.universePos.y - this.spaceBody.posM.y,
        this.universePos.z - this.spaceBody.posM.z,
      );
      return Math.max(0, d - this.spaceBody.radiusM);
    }
    return Math.max(0, this.pos.y - this.groundHeight());
  }

  handleGroundCollision(dt) {
    const g = this.game;
    const groundH = this.groundHeight();
    const nearGround = this.pos.y - groundH < 5;
    // 近地悬停辅助
    if (nearGround && this.vel.length() < 5 && !g.input.isDown(KEY.JUMP) && !g.input.isDown(KEY.SNEAK) && !g.input.isDown(KEY.SPRINT)) {
      const target = this.vel.length() < 0.6 ? groundH + 1.5 : groundH + 2.8;
      const diff = target - this.pos.y;
      this.vel.y += clamp(diff * 4, -6, 6) * dt * 4;
      this.vel.y = clamp(this.vel.y, -4, 6);
      if (this.pos.y - groundH < 2.0) this.onGround = true;
    }
    const minY = groundH + MIN_FLY_H;
    if (this.pos.y <= minY) {
      if (this.vel.y < -5) {
        g.audio.play('landing');
        g.ui.shake();
        g.particles.spawnBurst(this.pos.x, minY, this.pos.z, 0x9a8a6a, {
          count: 14, speed: 2.5, up: 1.2, life: 0.5, size: 0.12, jitter: 1.4,
        });
      }
      this.pos.y = minY;
      this.vel.y = 0;
      this.onGround = true;
      if (this.vel.length() > 12) {
        this.vel.multiplyScalar(Math.exp(-1.5 * dt));
        if (Math.random() < 0.4) {
          g.particles.spawnBurst(this.pos.x, minY + 0.2, this.pos.z, 0xffd27a, {
            count: 2, speed: 3, up: 1, life: 0.3, size: 0.07, jitter: 1.2,
          });
        }
      }
    } else {
      this.onGround = false;
    }
    // 山体碰撞
    const fwd = this.forward();
    const nose = this.pos.clone().addScaledVector(fwd, 1.6);
    if (this.solidAtWorld(nose.x, this.pos.y, nose.z) || this.solidAtWorld(this.pos.x, this.pos.y, this.pos.z)) {
      let y = Math.floor(this.pos.y);
      while (y < this.pos.y + 12 && this.solidAtWorld(this.pos.x, y, this.pos.z)) y++;
      if (y > this.pos.y) this.pos.y = y + 0.4;
      this.vel.multiplyScalar(0.35);
      g.ui.shake();
      g.audio.play('warn');
      g.particles.spawnBurst(nose.x, this.pos.y, nose.z, 0xffd27a, {
        count: 6, speed: 3, up: 1.5, life: 0.4, size: 0.08,
      });
    }
  }

  updateCamera(dt, input) {
    const g = this.game;
    if (input.pressed(KEY.CAMERA)) {
      input.consume(KEY.CAMERA);
      this.cameraMode = this.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
      this.chaseReady = false;
      g.audio.play('click');
      g.ui.toast(this.cameraMode === 'cockpit' ? '座舱视角' : '第三人称视角');
    }
    const cam = g.camera;
    const speedKmh = this.effectiveSpeed * 3.6;
    const targetFov = (g.settings ? g.settings.fov : 75) + Math.min(1, speedKmh / 1200) * 20;
    cam.fov = lerp(cam.fov, targetFov, 1 - Math.exp(-3 * dt));
    cam.updateProjectionMatrix();

    const rq = this.renderQuat();
    if (this.cameraMode === 'cockpit') {
      const eye = new THREE.Vector3(0, 2.8, 0.25).applyQuaternion(rq);
      cam.position.copy(this.pos).add(eye);
      const lookQ = rq.clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.03 + this.pitch * 0.35, 0, -this.roll * 0.35))
      );
      cam.quaternion.copy(lookQ);
    } else {
      const desired = this.pos.clone().add(new THREE.Vector3(0, 3.4, 10.5).applyQuaternion(rq));
      if (!this.chaseReady) { this.chasePos.copy(desired); this.chaseReady = true; }
      this.chasePos.lerp(desired, 1 - Math.exp(-5 * dt));
      cam.position.copy(this.chasePos);
      const look = this.pos.clone().add(new THREE.Vector3(0, 1.1, -4).applyQuaternion(rq));
      cam.lookAt(look);
    }
  }

  updateHUD() {
    const g = this.game;
    const spd = this.effectiveSpeed;
    const c = 299792458;
    const rel = spd >= c * 0.01;
    g.ui.setFlightHudValues({
      speed: rel ? (spd / c).toFixed(2) : Math.round(spd * 3.6),
      alt: Math.round(this.displayAltM),
      throttle: Math.round((spd / Math.max(1, this.maxSpeed)) * 100),
      onGround: this.onGround,
      space: this.spaceMode,
      speedUnit: rel ? 'c' : 'km/h',
      shield: Math.round(this.shield),
      shieldMax: Math.round(this.shieldMax),
      hull: Math.round(this.hull),
      hullMax: Math.round(this.hullMax),
    });
    if (g.space) g.space.syncPulseEnvelope(1 / 60);
  }
}
