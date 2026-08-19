// Universe V2 太空系统：以真实米制宇宙为唯一空间事实来源。
//
// 与 V1（system.js）的本质区别：
//   - 天体位置不再围绕“本次进入太空点”重新摆放，而是来自 Universe 稳定结构；
//   - 地球→太空→月球/其他行星使用同一宇宙坐标连续换算，不做固定出生点传送；
//   - 行星/卫星按真实距离与真实半径渲染，使用浮动原点 + 对数深度缓冲；
//   - 太阳方向由恒星位置计算，地表与太空共用；
//   - 罗盘/星图距离读取同一宇宙状态。
//
// V1 的 system.js 仍保留（兼容旧测试与工具），但游戏运行时改用本文件。
import * as THREE from 'three';
import { clamp } from '../core/constants.js';
import { KM_PER_UNIT, bodyById, systemMeta, homeBodyId } from './celestial.js';
import {
  Universe, surfaceToUniverse, universeToSurface, surfaceBasisAt, starDirectionM, pulseAllowedSpeedM_S,
  AU_M, C_M_S, DRIVE_NORMAL_MAX_M_S, DRIVE_PULSE_MAX_M_S,
} from './universe.js';
import {
  generateGalaxy, generateProximaGalaxy, generateSiriusGalaxy,
  planetTexture, atmosphereMaterial, planetRing, labelSprite, buildGatewayMesh,
} from './system.js';
import { buildStationMesh, STATION_DOCK_DIST } from '../entities/station.js';
import { hashSeed } from '../world/noise.js';

// 兼容旧 system.js 的导出（测试与工具）。
export {
  generateGalaxy, generateProximaGalaxy, generateSiriusGalaxy, planetNameOf,
  SOLAR_SYSTEM, PROXIMA_SYSTEM, SIRIUS_SYSTEM, PLANET_TYPES, GATEWAY_OFFSETS, STATION_OFFSET,
} from './system.js';

export const SPACE_ALT = 170;          // 兼容旧值（V2 不再使用该固定阈值）
export const EXIT_ALT = 130;
export const PULSE_SPEED = DRIVE_NORMAL_MAX_M_S; // 兼容旧值
export const GATEWAY_WARP_DIST = 8000; // 米
export const BELT_HARVEST_DIST = 8e6;  // 米

const ATMO_TOP_DENSE_M = 40000;        // 有大气天体的游戏化大气层顶（米）
const ATMO_TOP_THIN_M = 30000;         // 稀薄大气
const ATMO_TOP_AIRLESS_M = 20000;      // 无大气天体转入地表帧的高度
const ATMO_EXIT_FACTOR = 0.75;
const BODY_TRANSFER_MARGIN_M = 8000;

function atmoTopM(body) {
  if (!body) return ATMO_TOP_DENSE_M;
  if (body.kind === 'star' || body.kind === 'belt' || body.kind === 'gateway') return 0;
  if (body.atmoDensity < 0.3) return ATMO_TOP_AIRLESS_M;
  if (body.atmoDensity < 0.7) return ATMO_TOP_THIN_M;
  return ATMO_TOP_DENSE_M;
}

function formatSpeed(effectiveM_S) {
  const kmh = effectiveM_S * 3.6;
  if (effectiveM_S >= C_M_S * 0.01) return `${(effectiveM_S / C_M_S).toFixed(2)} c`;
  if (kmh >= 100000) return `${Math.round(kmh).toLocaleString('en-US')} km/h`;
  return `${Math.round(kmh).toLocaleString('en-US')} km/h`;
}

function formatDistanceM(m) {
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m >= AU_M * 0.01) return `${(m / AU_M).toFixed(2)} AU`;
  if (m >= 1000) return `${(m / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} km`;
  return `${Math.round(m)} m`;
}

// 行星是否允许体素地表降落。气态巨行星不再默认可登陆。
function isSurfaceLandable(body) {
  if (!body || body.kind !== 'planet') return !!(body && body.landable);
  const gas = ['planet:solar.jupiter', 'planet:solar.saturn', 'planet:solar.uranus', 'planet:solar.neptune'];
  return !gas.includes(body.navId);
}

export class SpaceSystem {
  constructor(game) {
    this.game = game;
    // V2 宇宙状态（唯一空间事实来源）
    this.universe = new Universe(game.seed);
    // 旧数据视图（探索状态、色板、任务兼容）
    this.galaxies = {
      solar: generateGalaxy(game.seed),
      proxima: generateProximaGalaxy(game.seed),
      sirius: generateSiriusGalaxy(game.seed),
    };
    this.galaxyId = 'solar';
    this.galaxy = this.galaxies.solar;
    this.current = 0;
    this.bodyId = null;
    this.visitedMoons = new Set();
    this.visitedSolar = new Set([0]);
    this.visitedProxima = new Set();
    this.visitedSirius = new Set();
    this.visitedMap = { solar: this.visitedSolar, proxima: this.visitedProxima, sirius: this.visitedSirius };
    this.visited = this.visitedSolar;

    this.active = false;
    this.warping = false;
    this.warpTimer = 0;
    this.warpPlanet = null;
    this.targetId = -1;
    this.nonLandableHint = null;
    this.gatewayWarnTimer = 0;
    this.surfaceFrameTimer = 0;

    this.universePos = { x: 0, y: 0, z: 0 };
    this.universeVel = { x: 0, y: 0, z: 0 };
    this.currentUniverseBody = this.universe.body('planet:solar.earth');

    // 视觉
    this.universeRoot = new THREE.Group();
    this.universeRoot.name = 'universe-v2';
    this.universeRoot.visible = false;
    game.scene.add(this.universeRoot);
    this.bodyVisuals = [];
    this.sunSprite = null;
    this.sunGlow = null;
    this.spaceSunLight = null;
    this.stationGroup = null;
    this.gatewayGroups = [];
    this.beltMarker = null;
    this.nebulaSprites = [];
    this.stationNear = false;
    this.gatewayNear = false;
    this.beltNear = false;
    this.tmpV = new THREE.Vector3();
  }

  get ship() { return this.game.ship; }
  get flight() { return this.game.flight; }
  get scene() { return this.game.scene; }

  currentPlanetDef() { return this.galaxy[this.current]; }
  currentBodyDef() {
    if (this.bodyId) return bodyById(this.bodyId);
    return this.galaxy[this.current];
  }
  currentUniverseNavId() {
    return this.bodyId || (this.galaxy[this.current] ? this.galaxy[this.current].navId : 'planet:solar.earth');
  }
  syncLegacyBody() {
    const navId = this.currentUniverseNavId();
    this.currentUniverseBody = this.universe.body(navId) || this.universe.homeBody(this.galaxyId);
  }
  visitedFor(systemId) { return this.visitedMap[systemId] || this.visited; }

  altitude() { return this.flight ? this.flight.altitudeM() : 0; }

  syncBodySpin(body) {
    if (!body) return;
    body.__spin = this.universe.rotationAngle(body, this.game.sky ? this.game.sky.timeSec : 0);
  }

  // ---- 当前天体在地表帧的基向量 ----
  ensureSurfaceFrame(force = false) {
    const f = this.flight;
    if (!f || !f.piloting || this.active) return;
    this.surfaceFrameTimer -= 1 / 60;
    if (!force && f.localBasis && this.surfaceFrameTimer > 0) return;
    const body = this.universe.body(this.currentUniverseNavId());
    if (!body || (body.kind !== 'planet' && body.kind !== 'moon')) return;
    this.syncBodySpin(body);
    const groundY = this.game.world.getGroundY(f.pos.x, f.pos.z);
    const sp = surfaceToUniverse(body, f.pos.x, f.pos.z, f.pos.y, groundY);
    const basis = surfaceBasisAt(body, sp.lat, sp.lon);
    f.spaceBody = body;
    f.localBasis = { east: basis.east, north: basis.north, up: basis.up };
    f.updateRefQuat();
    this.surfaceFrameTimer = 0.25;
  }

  // ---- 导航目标 ----
  resolveTargetNode(id) {
    if (id === null || id === undefined || id === -1 || id === '-1') return null;
    const str = String(id);
    if (/^\d+$/.test(str)) {
      const n = Number(str);
      if (n === 100) return bodyById('station:solar.earth');
      if (n === 200) return bodyById('gateway:solar.proxima');
      if (n === 201) return bodyById('gateway:proxima.solar');
      if (n >= 0 && n < this.galaxy.length) {
        const p = this.galaxy[n];
        return bodyById(p.navId) || { navId: `planet:${this.galaxyId}.${n}`, kind: 'planet', name: p.name, type: p.type, landable: true, aAU: p.aAU, angleDeg: p.angleDeg, radiusKm: p.radiusKm };
      }
      return null;
    }
    return bodyById(str);
  }
  targetNode() { return this.resolveTargetNode(this.targetId); }
  targetUniverseBody() {
    const node = this.targetNode();
    return node ? this.universe.body(node.navId) : null;
  }

  setTarget(id) {
    if (id === null || id === undefined || id === -1 || id === '-1') { this.targetId = -1; this.nonLandableHint = null; return true; }
    const node = this.resolveTargetNode(id);
    if (!node) return false;
    if (node.gateway) {
      const hasBigShip = !!(this.game.shipUpgrades && this.game.shipUpgrades.bigship);
      if (!hasBigShip) return false;
    }
    if (node.kind === 'station' && (this.galaxyId !== 'solar' || this.bodyId)) return false;
    if (node.kind === 'moon' && this.bodyId === node.navId) return false;
    this.targetId = /^\d+$/.test(String(id)) ? Number(id) : String(id);
    this.nonLandableHint = null;
    return true;
  }

  currentPositionM() {
    if (this.active && this.flight && this.flight.universePos) return this.flight.universePos;
    const body = this.currentUniverseBody;
    if (!body || !this.flight) return { x: body.posM.x, y: body.posM.y, z: body.posM.z };
    this.syncBodySpin(body);
    const groundY = this.game.world.getGroundY(this.flight.pos.x, this.flight.pos.z);
    const sp = surfaceToUniverse(body, this.flight.pos.x, this.flight.pos.z, this.flight.pos.y, groundY);
    return sp.pos;
  }

  targetInfo() {
    const node = this.targetNode();
    if (!node) return null;
    const body = this.universe.body(node.navId);
    const pos = body ? body.posM : null;
    const here = this.currentPositionM();
    const distM = pos ? Math.hypot(pos.x - here.x, pos.y - here.y, pos.z - here.z) : null;
    return {
      id: this.targetId,
      navId: node.navId || null,
      name: node.name,
      kind: node.kind,
      landable: body ? isSurfaceLandable(body) : !!node.landable,
      dockable: !!node.dockable,
      gateway: !!node.gateway,
      distM,
      dist: distM === null ? null : distM / KM_PER_UNIT, // 旧单位兼容
      systemId: this.galaxyId,
    };
  }

  // ---- 脉冲包线 ----
  syncPulseEnvelope(dt) {
    const f = this.flight;
    if (!f || !f.spaceMode || !f.universePos) return;
    let best = null;
    for (const list of Object.values(this.universe.systems)) {
      for (const b of list) {
        if (b.kind !== 'planet' && b.kind !== 'moon' && b.kind !== 'station' && b.kind !== 'gateway' && b.kind !== 'belt') continue;
        const d = Math.hypot(f.universePos.x - b.posM.x, f.universePos.y - b.posM.y, f.universePos.z - b.posM.z) - b.radiusM;
        if (!best || d < best.d) best = { body: b, surfaceDist: d };
      }
    }
    if (!best) { f.pulseTarget = 1; return; }
    f.spaceBody = best.body;
    let h0 = atmoTopM(best.body);
    if (best.body.kind === 'station' || best.body.kind === 'gateway') h0 = 2000;
    else if (best.body.kind === 'belt') h0 = BELT_HARVEST_DIST;
    f.pulseLimit = Math.max(DRIVE_NORMAL_MAX_M_S, pulseAllowedSpeedM_S(Math.max(0, best.surfaceDist), h0));
    f.pulseTarget = Math.max(0, Math.min(1, f.pulseLimit / Math.max(1, DRIVE_PULSE_MAX_M_S)));
    f.pulseScale = 1;
  }

  // ---- 每帧 ----
  update(dt) {
    const g = this.game;
    const f = this.flight;
    if (!f || !f.piloting) {
      if (this.active) this.forceExit();
      return;
    }
    if (!this.active) {
      this.ensureSurfaceFrame();
      this.updateSunAndSky();
      const body = this.currentUniverseBody;
      const top = atmoTopM(body);
      if (f.altitudeM() > top) this.enterSpace();
      return;
    }

    if (this.warping) {
      this.warpTimer -= dt;
      if (this.warpTimer <= 0) this.finishWarp();
      return;
    }

    this.syncPulseEnvelope(dt);
    this.syncVisuals();
    this.updateSunAndSky();

    // 空间站/小行星带/跃迁门接近
    this.updateFixedNodes(dt);

    // 主导天体切换：连续转换到另一颗可登陆天体，而不是固定出生点。
    const gov = this.universe.governingBody(f.universePos);
    if (gov.body && gov.body !== this.currentUniverseBody) {
      const top = atmoTopM(gov.body);
      const speedOk = f.vel.length() < 800;
      if (gov.centerDist < gov.body.radiusM + top + BODY_TRANSFER_MARGIN_M && speedOk) {
        if (gov.body.kind === 'planet' || gov.body.kind === 'moon') {
          if (isSurfaceLandable(gov.body)) {
            this.transferToBody(gov.body);
            return;
          } else if (this.nonLandableHint !== gov.body.navId) {
            this.nonLandableHint = gov.body.navId;
            g.ui.toast(`${gov.body.name} 是气态巨行星 · 无法降落，只能近距离观察`, true);
            g.audio.play('warn');
          }
        }
      }
    }

    // 当前天体大气层内回落
    if (gov.body === this.currentUniverseBody) {
      const top = atmoTopM(gov.body);
      if (f.altitudeM() < top * ATMO_EXIT_FACTOR) this.exitSpace();
    }
  }

  // ---- 进入/离开太空 ----
  enterSpace() {
    const g = this.game;
    const f = this.flight;
    const body = this.universe.body(this.currentUniverseNavId());
    if (!body) return;
    this.ensureSurfaceFrame(true);
    this.syncBodySpin(body);
    const groundY = g.world.getGroundY(f.pos.x, f.pos.z);
    const sp = surfaceToUniverse(body, f.pos.x, f.pos.z, f.pos.y, groundY);
    const basis = surfaceBasisAt(body, sp.lat, sp.lon);
    const velM = f.localVectorToUniverse(f.vel);
    f.localBasis = { east: basis.east, north: basis.north, up: basis.up };
    f.setSpaceFrame(body, sp.pos, velM, f.localBasis);
    this.universePos = { ...sp.pos };
    this.universeVel = { x: velM.x, y: velM.y, z: velM.z };
    this.currentUniverseBody = body;
    this.active = true;
    f.setSpaceMode(true);
    f.clearReentry();
    g.world.setMeshesVisible(false);
    g.sky.setSpaceMode(true);
    g.beltCharges = 14;
    g.beltNear = false;
    this.buildVisuals();
    this.syncVisuals();
    g.audio.play('spaceEnter');
    g.audio.setAmbient(0.1, 1.0);
    g.ui.toast(`已离开${body.name}大气层 · 脉冲航行可用 · 打开星图 [M] 选择目标`);
    if (g.quests) g.quests.onEnterSpace();
    if (g.milestones) g.milestones.bump('space', 1);
  }

  exitSpace() {
    const g = this.game;
    const f = this.flight;
    const body = this.currentUniverseBody;
    if (!body || !f.universePos) return;
    this.syncBodySpin(body);
    const anchor = this.universe.anchorOf(body);
    this.universe.setBodyAnchor(body, anchor);
    const surf = universeToSurface(body, f.universePos, anchor);
    const velLocal = this.universeVectorToLocal(f, body, surf);
    this.enterLocalFrame(body, surf, velLocal, true);
    g.audio.setAmbient(0.4, g.sky.nightFactor);
    this.notifyArrival(body);
  }

  // 连续转换到另一颗天体：宇宙位置/速度不重置。
  transferToBody(body) {
    const g = this.game;
    const f = this.flight;
    const posM = { ...f.universePos };
    const velM = { x: f.universeVel.x, y: f.universeVel.y, z: f.universeVel.z };

    // 同步旧数据视图（任务/星图当前天体）
    this.setLegacyBody(body);

    const profile = this.bodyProfile(body);
    g.applyNewWorld(body.seed || g.seed, body.palette, profile);

    const anchor = this.universe.anchorOf(body);
    this.universe.setBodyAnchor(body, anchor);
    this.syncBodySpin(body);
    const surf = universeToSurface(body, posM, anchor);
    const velLocal = this.universeVectorToLocal(f, body, surf);
    this.currentUniverseBody = body;
    this.universePos = { ...posM };
    this.universeVel = { x: velM.x, y: velM.y, z: velM.z };
    this.enterLocalFrame(body, surf, velLocal, body.atmoDensity >= 0.3);
    g.ui.toast(`已进入${body.name}空域 · 高度 ${Math.round(surf.altitudeM).toLocaleString()} m · 连续飞行模式`, true);
    this.notifyArrival(body);
  }

  enterLocalFrame(body, surf, velLocal, withReentry) {
    const g = this.game;
    const f = this.flight;
    const CHUNK = 16;
    this.syncBodySpin(body);
    g.world.ensureArea(Math.floor(surf.x / CHUNK), Math.floor(surf.z / CHUNK), 2);
    const groundY = g.world.getGroundY(surf.x, surf.z);
    const basis = surfaceBasisAt(body, surf.lat, surf.lon);
    f.localBasis = { east: basis.east, north: basis.north, up: basis.up };
    f.setLocalFrame(body, surf.x, groundY + Math.max(0, surf.altitudeM), surf.z, velLocal, f.localBasis);
    this.active = false;
    if (g.spaceCombat) g.spaceCombat.clear();
    f.setSpaceMode(false);
    g.sky.setSpaceMode(false);
    g.world.setMeshesVisible(true);
    this.universeRoot.visible = false;
    for (const v of this.bodyVisuals) v.group.visible = false;
    if (this.stationGroup) this.stationGroup.visible = false;
    for (const gi of this.gatewayGroups) gi.group.visible = false;
    for (const s of this.nebulaSprites) s.visible = false;
    if (this.spaceSunLight) this.spaceSunLight.intensity = 0;
    if (withReentry) f.beginReentry();
    else f.clearReentry();
    g.camera.far = Math.max(900, f.displayAltM * 4 + 2000);
    g.camera.updateProjectionMatrix();
    g.stationNear = false;
    g.gatewayNear = false;
    g.beltNear = false;
  }

  universeVectorToLocal(f, body, surf) {
    const basis = surfaceBasisAt(body, surf.lat, surf.lon);
    const e = basis.east, n = basis.north, u = basis.up;
    return new THREE.Vector3(
      f.universeVel.x * e.x + f.universeVel.y * e.y + f.universeVel.z * e.z,
      f.universeVel.x * u.x + f.universeVel.y * u.y + f.universeVel.z * u.z,
      f.universeVel.x * n.x + f.universeVel.y * n.y + f.universeVel.z * n.z,
    );
  }

  setLegacyBody(body) {
    if (body.kind === 'moon') {
      const parentNav = body.parentId;
      const idx = this.galaxy.findIndex((p) => p.navId === parentNav);
      if (idx >= 0) this.current = idx;
      this.bodyId = body.navId;
      this.visitedMoons.add(body.navId);
      return;
    }
    for (const [sysId, galaxy] of Object.entries(this.galaxies)) {
      const idx = galaxy.findIndex((p) => p.navId === body.navId);
      if (idx >= 0) {
        this.galaxyId = sysId;
        this.galaxy = galaxy;
        this.current = idx;
        this.bodyId = null;
        this.visited = this.visitedFor(sysId);
        this.visited.add(idx);
        return;
      }
    }
  }

  bodyProfile(body) {
    const opts = {
      terrain: body.terrain,
      surface: body.surface || 'barren',
      ores: body.ores,
      plants: body.plants,
      hazard: body.hazard,
      weather: body.weather,
      body: body,
      planetName: `${body.name} · ${systemMeta(body.systemId).name}`,
    };
    if (body.kind === 'moon') opts.noCrashSite = true;
    return opts;
  }

  notifyArrival(body) {
    const g = this.game;
    if (body.kind === 'moon') {
      if (g.milestones) g.milestones.bump('moons', 1);
    } else if (this.galaxyId !== 'solar' || this.current !== 0) {
      g.quests && g.quests.onPlanetLand();
      if (g.milestones) g.milestones.bump('planets', 1);
    }
    if (g.onMissionEvent) g.onMissionEvent('visit', { target: body.navId });
  }

  forceExit() {
    const g = this.game;
    const f = this.flight;
    if (this.active && f && f.universePos && this.currentUniverseBody) {
      const body = this.currentUniverseBody;
      const anchor = this.universe.anchorOf(body);
      const surf = universeToSurface(body, f.universePos, anchor);
      const velLocal = this.universeVectorToLocal(f, body, surf);
      this.enterLocalFrame(body, surf, velLocal, false);
    } else {
      this.active = false;
      if (g.spaceCombat) g.spaceCombat.clear();
      g.world.setMeshesVisible(true);
      g.sky.setSpaceMode(false);
      this.universeRoot.visible = false;
    }
  }

  // ---- 宇宙视觉（真实尺度 + 浮动原点） ----
  makeSunTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const ctx = cv.getContext('2d');
    const grd = ctx.createRadialGradient(128, 128, 4, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,250,235,1)');
    grd.addColorStop(0.2, 'rgba(255,236,180,0.95)');
    grd.addColorStop(0.5, 'rgba(255,190,110,0.35)');
    grd.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  buildVisuals() {
    const g = this.game;
    this.clearVisuals();
    this.universeRoot.visible = true;

    // 行星/卫星/带：真实半径 Mesh。
    for (const b of this.universe.bodies(this.galaxyId)) {
      if (b.kind === 'star' || b.kind === 'station' || b.kind === 'gateway') continue;
      const group = new THREE.Group();
      group.name = 'body-' + b.navId;
      if (b.kind === 'belt') {
        const mat = new THREE.MeshLambertMaterial({ color: 0x9a8a76 });
        for (let i = 0; i < 22; i++) {
          const a = i * 2.39996;
          const size = 800 + (i * 37) % 3000;
          const rock = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.6, size), mat);
          rock.position.set(Math.cos(a) * 2.2e6, (i - 11) * 4e5, Math.sin(a) * 2.2e6);
          group.add(rock);
        }
        this.bodyVisuals.push({ body: b, group, label: null, sphere: null });
      } else {
        const radius = Math.max(1, b.radiusM);
        const mat = new THREE.MeshLambertMaterial(b.palette && b.seed
          ? { map: planetTexture(b.palette, b.seed, b) }
          : { color: 0xb8b8c0 });
        if (mat.map) {
          const [sr, sg, sb] = b.palette ? [(b.palette.surface[0] >> 16) & 255, (b.palette.surface[0] >> 8) & 255, b.palette.surface[0] & 255] : [160, 160, 168];
          mat.emissive = new THREE.Color(sr / 255, sg / 255, sb / 255).multiplyScalar(0.15);
        }
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 24), mat);
        group.add(sphere);
        if (b.kind === 'planet' && b.atmoDensity >= 0.3) {
          const atmos = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.012, 32, 18), atmosphereMaterial(b.palette.atmos));
          group.add(atmos);
        }
        if (b.ring) group.add(planetRing(radius));
        const label = labelSprite(b.name, 'rgba(220,240,255,0.95)', 40, 15);
        label.position.y = radius * 1.5;
        group.add(label);
        this.bodyVisuals.push({ body: b, group, label, sphere });
      }
      this.universeRoot.add(group);
    }

    // 太阳：真实角尺寸的光球 Sprite + 光晕。
    const star = this.universe.starOf(this.galaxyId);
    if (star) {
      const tex = this.makeSunTexture();
      const sunMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
      this.sunSprite = new THREE.Sprite(sunMat);
      this.sunSprite.scale.setScalar(star.radiusM * 2.2);
      this.sunSprite.name = 'v2-sun';
      this.universeRoot.add(this.sunSprite);
      this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.35, depthWrite: false, fog: false, color: 0xffc070,
      }));
      this.sunGlow.scale.setScalar(star.radiusM * 8);
      this.universeRoot.add(this.sunGlow);
      if (!this.spaceSunLight) {
        this.spaceSunLight = new THREE.DirectionalLight(0xfff2c0, 0.65);
        this.scene.add(this.spaceSunLight);
        this.scene.add(this.spaceSunLight.target);
      }
    }

    // 空间站
    const station = this.universe.body('station:solar.earth');
    if (station && this.galaxyId === 'solar' && this.current === 0 && !this.bodyId) {
      this.stationGroup = buildStationMesh();
      this.stationGroup.scale.setScalar(240);
      this.universeRoot.add(this.stationGroup);
    }

    // 跃迁门
    for (const b of this.universe.bodies(this.galaxyId)) {
      if (b.kind !== 'gateway') continue;
      const group = buildGatewayMesh(b.name);
      group.scale.setScalar(260);
      const gi = { body: b, group };
      this.gatewayGroups.push(gi);
      this.universeRoot.add(group);
    }

    // 深空星云（仍是随相机氛围层）
    if (this.nebulaSprites.length === 0) {
      const colors = [0x5a3a9a, 0x2a6a8a, 0x9a3a6a, 0x3a5a9a];
      for (let i = 0; i < 4; i++) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 128;
        const ctx = cv.getContext('2d');
        const [r, gg, b] = [(colors[i] >> 16) & 255, (colors[i] >> 8) & 255, colors[i] & 255];
        const grd = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
        grd.addColorStop(0, `rgba(${r},${gg},${b},0.85)`);
        grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, 128, 128);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
        sp.scale.setScalar(3e6);
        this.scene.add(sp);
        this.nebulaSprites.push(sp);
      }
    }
    for (const s of this.nebulaSprites) s.visible = true;
  }

  clearVisuals() {
    for (const v of this.bodyVisuals) this.disposeGroup(v.group);
    this.bodyVisuals = [];
    for (const gi of this.gatewayGroups) this.disposeGroup(gi.group);
    this.gatewayGroups = [];
    if (this.stationGroup) { this.disposeGroup(this.stationGroup); this.stationGroup = null; }
    if (this.sunSprite) { this.disposeGroup(this.sunSprite); this.sunSprite = null; }
    if (this.sunGlow) { this.disposeGroup(this.sunGlow); this.sunGlow = null; }
    this.beltMarker = null;
  }

  disposeGroup(obj) {
    if (!obj) return;
    obj.removeFromParent();
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }

  // 每帧以飞船宇宙位置为浮动原点，重摆所有天体。
  syncVisuals() {
    const f = this.flight;
    if (!this.active || !f || !f.universePos) return;
    const o = f.universePos;
    for (const v of this.bodyVisuals) {
      const p = v.body.posM;
      v.group.position.set(p.x - o.x, p.y - o.y, p.z - o.z);
      v.group.visible = true;
      v.group.rotation.y = this.universe.rotationAngle(v.body, this.game.sky ? this.game.sky.timeSec : 0);
      if (v.label) {
        const d = Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z);
        const s = clamp(d * 0.045, 20000, 3e9);
        v.label.scale.set(s, s * 0.37, 1);
      }
    }
    const star = this.universe.starOf(this.galaxyId);
    if (star) {
      if (this.sunSprite) this.sunSprite.position.set(star.posM.x - o.x, star.posM.y - o.y, star.posM.z - o.z);
      if (this.sunGlow) this.sunGlow.position.copy(this.sunSprite.position);
      if (this.spaceSunLight) {
        this.spaceSunLight.position.copy(this.sunSprite.position);
        this.spaceSunLight.target.position.set(0, 0, 0);
        this.spaceSunLight.intensity = 0.65;
      }
    }
    const station = this.universe.body('station:solar.earth');
    if (this.stationGroup && station) {
      this.stationGroup.position.set(station.posM.x - o.x, station.posM.y - o.y, station.posM.z - o.z);
      this.stationGroup.rotation.y += 1 / 60 * 0.05;
    }
    for (const gi of this.gatewayGroups) {
      const p = gi.body.posM;
      gi.group.position.set(p.x - o.x, p.y - o.y, p.z - o.z);
      gi.group.rotation.y += 1 / 60 * 0.3;
    }
    // 星云跟随相机
    for (const [i, s] of this.nebulaSprites.entries()) {
      const a = i * 2.1 + 0.5;
      s.position.set(f.pos.x + Math.cos(a) * 3e6, f.pos.y + Math.sin(a * 0.7) * 1e6, f.pos.z + Math.sin(a) * 3e6);
    }
    // 太空相机 far 动态保持可看到全系统。
    const cam = this.game.camera;
    const maxD = this.universe.bodies(this.galaxyId).reduce((m, b) => Math.max(m, Math.hypot(b.posM.x - o.x, b.posM.z - o.z)), 1);
    cam.far = Math.max(cam.far, maxD * 1.25);
  }

  setSkyForPosition(here, upDir) {
    const g = this.game;
    if (!g.sky) return;
    const star = this.universe.starOf(this.galaxyId);
    if (star) {
      const dir = starDirectionM(this.universe, this.galaxyId, here);
      g.sky.setWorldSun(new THREE.Vector3(dir.x, dir.y, dir.z));
      const d = Math.hypot(here.x - star.posM.x, here.y - star.posM.y, here.z - star.posM.z);
      const ang = Math.asin(Math.min(1, star.radiusM / d));
      g.sky.uniforms.sunSharp.value = 1 / Math.max(1e-5, ang);
      g.sky.uniforms.sunSoft.value = 8;
      g.sky.sunTint.setHex(0xfff2c0);
    }
    const moon = this.universe.body('moon:solar.earth.luna');
    if (moon && moon.systemId === this.galaxyId) {
      const d = Math.hypot(here.x - moon.posM.x, here.y - moon.posM.y, here.z - moon.posM.z);
      const dx = (moon.posM.x - here.x) / d, dy = (moon.posM.y - here.y) / d, dz = (moon.posM.z - here.z) / d;
      g.sky.setWorldMoon(new THREE.Vector3(dx, dy, dz));
      const ang = Math.asin(Math.min(1, moon.radiusM / d));
      g.sky.uniforms.moonSharp.value = 1 / Math.max(1e-5, ang);
      g.sky.uniforms.moonSoft.value = 14;
      if (g.sky.uniforms.moonColor) g.sky.uniforms.moonColor.value.setRGB(0.8, 0.85, 0.94);
    } else {
      g.sky.setWorldMoon(null);
      if (g.sky.uniforms.moonColor) g.sky.uniforms.moonColor.value.setRGB(0, 0, 0);
    }
    if (upDir) g.sky.setWorldUp(new THREE.Vector3(upDir.x, upDir.y, upDir.z));
    else if (this.flight && this.flight.localBasis) {
      const ub = this.flight.localBasis.up;
      g.sky.setWorldUp(new THREE.Vector3(ub.x, ub.y, ub.z));
    } else g.sky.setWorldUp(new THREE.Vector3(0, 1, 0));
  }

  updateSunAndSky() {
    const here = this.currentPositionM();
    const upDir = this.flight && this.flight.localBasis ? this.flight.localBasis.up : null;
    this.setSkyForPosition(here, upDir);
  }

  // 步行状态下同样读取宇宙太阳方向。
  syncSurfaceSky() {
    const g = this.game;
    if (this.active || !g.player) return;
    const body = this.currentUniverseBody;
    if (!body || (body.kind !== 'planet' && body.kind !== 'moon')) return;
    this.syncBodySpin(body);
    const groundY = g.world.getGroundY(g.player.pos.x, g.player.pos.z);
    const sp = surfaceToUniverse(body, g.player.pos.x, g.player.pos.z, g.player.pos.y, groundY);
    this.setSkyForPosition(sp.pos, sp.up);
  }

  updateFixedNodes(dt) {
    const g = this.game;
    const f = this.flight;
    this.stationNear = false;
    const station = this.universe.body('station:solar.earth');
    if (station && this.stationGroup) {
      const d = Math.hypot(f.universePos.x - station.posM.x, f.universePos.y - station.posM.y, f.universePos.z - station.posM.z);
      this.stationNear = d < STATION_DOCK_DIST * 240;
    }
    this.gatewayNear = false;
    for (const gi of this.gatewayGroups) {
      const b = gi.body;
      const d = Math.hypot(f.universePos.x - b.posM.x, f.universePos.y - b.posM.y, f.universePos.z - b.posM.z);
      if (d < GATEWAY_WARP_DIST * 260) {
        this.gatewayNear = true;
        const hasBigShip = !!(g.shipUpgrades && g.shipUpgrades.bigship);
        if (hasBigShip) { this.beginWarp({ gateway: true, target: b.targetSystem, name: b.name, kind: 'gateway' }); break; }
        this.gatewayWarnTimer -= dt;
        if (this.gatewayWarnTimer <= 0) {
          this.gatewayWarnTimer = 5;
          g.ui.toast('跨星系跃迁需要大型殖民船 · 前往空间站船坞购买', true);
          g.audio.play('deny');
        }
      }
    }
    this.beltNear = false;
    const belt = this.universe.body('belt:solar.main');
    if (belt) {
      const d = Math.hypot(f.universePos.x - belt.posM.x, f.universePos.y - belt.posM.y, f.universePos.z - belt.posM.z);
      this.beltNear = d < BELT_HARVEST_DIST;
    }
  }

  // ---- 读档恢复飞船空间状态 ----
  restoreSpaceState(saveFlight) {
    const g = this.game;
    const f = this.flight;
    if (!saveFlight || !f) return;
    if (saveFlight.spaceActive && f.universePos) {
      const gov = this.universe.governingBody(f.universePos);
      const body = gov.body || this.currentUniverseBody;
      this.currentUniverseBody = body;
      const dx = f.universePos.x - body.posM.x, dy = f.universePos.y - body.posM.y, dz = f.universePos.z - body.posM.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const up = { x: dx / len, y: dy / len, z: dz / len };
      const basis = surfaceBasisAt(body, Math.asin(up.y), Math.atan2(up.z, up.x));
      f.localBasis = { east: basis.east, north: basis.north, up: basis.up };
      f.updateRefQuat();
      f.setSpaceFrame(body, f.universePos, f.universeVel || { x: 0, y: 0, z: 0 }, f.localBasis);
      this.universePos = { ...f.universePos };
      this.universeVel = { ...(f.universeVel || { x: 0, y: 0, z: 0 }) };
      this.active = true;
      f.setSpaceMode(true);
      g.world.setMeshesVisible(false);
      g.sky.setSpaceMode(true);
      this.buildVisuals();
      this.syncVisuals();
      g.camera.far = 2e12;
      g.camera.updateProjectionMatrix();
      f.applyTransform(1 / 60);
      if (f.piloting) { g.ui.setFlightHud(true); document.body.classList.add('piloting'); }
    } else {
      f.setSpaceMode(false);
      f.universePos = null;
      f.universeVel = null;
      this.active = false;
      this.ensureSurfaceFrame(true);
      f.applyTransform(1 / 60);
    }
  }

  // ---- 跨恒星系统（仍使用跃迁门；门内距离为真实空间，穿越是跃迁） ----
  beginWarp(np) {
    const g = this.game;
    this.warping = true;
    if (g.spaceCombat) g.spaceCombat.clear();
    this.warpPlanet = np;
    this.warpTimer = 1.0;
    g.audio.play('warp');
    g.ui.warpFlash(true);
    g.ui.toast(`穿越跃迁门前往 ${np.name || np.target}`);
  }

  finishWarp() {
    const g = this.game;
    const np = this.warpPlanet;
    this.warpPlanet = null;
    this.warping = false;
    g.ui.warpFlash(false);
    if (!np || !np.gateway) return;
    const target = np.target || 'solar';
    this.galaxyId = target;
    this.galaxy = this.galaxies[target];
    this.current = 0;
    this.bodyId = null;
    this.visited = this.visitedFor(target);
    this.visited.add(0);
    this.targetId = -1;
    const body = this.universe.homeBody(target);
    const homeDef = this.galaxy[0];
    g.applyNewWorld(body.seed, body.palette, this.bodyProfile(body));
    this.currentUniverseBody = body;
    const anchor = this.universe.anchorOf(body);
    this.universe.setBodyAnchor(body, anchor);
    const posM = {
      x: body.posM.x + body.radiusM * 1.01,
      y: body.posM.y + body.radiusM * 0.001,
      z: body.posM.z,
    };
    const basis = surfaceBasisAt(body, 0, 0);
    const velLocal = new THREE.Vector3(0, 40, 0);
    this.universePos = { ...posM };
    this.universeVel = { x: 0, y: 40, z: 0 };
    const surf = universeToSurface(body, posM, anchor);
    const groundY = g.world.getGroundY(surf.x, surf.z);
    this.flight.localBasis = { east: basis.east, north: basis.north, up: basis.up };
    this.flight.setLocalFrame(body, surf.x, groundY + Math.max(100, surf.altitudeM), surf.z, velLocal, this.flight.localBasis);
    this.active = false;
    this.flight.setSpaceMode(false);
    g.world.setMeshesVisible(true);
    g.sky.setSpaceMode(false);
    this.universeRoot.visible = false;
    g.audio.play('spaceEnter');
    g.ui.toast(target === 'solar' ? '已跃迁回太阳系' : `已跃迁至${systemMeta(target).name}`, true);
    if (g.quests) g.quests.onReachProxima(target);
    if (g.milestones && target !== 'solar') g.milestones.bump('warp', 1);
  }

  // ---- 罗盘：目标方向/距离（真实米制） ----
  compass() {
    const node = this.targetNode();
    if (!node) return null;
    const here = this.currentPositionM();
    let tx, ty, tz;
    const body = this.universe.body(node.navId);
    if (body) { tx = body.posM.x; ty = body.posM.y; tz = body.posM.z; }
    else if (node.kind === 'station') { const s = this.universe.body('station:solar.earth'); tx = s.posM.x; ty = s.posM.y; tz = s.posM.z; }
    else return null;
    const distM = Math.hypot(tx - here.x, ty - here.y, tz - here.z);
    if (distM < 1) return null;
    const f = this.flight;
    const fwd = f.forwardUniverse();
    const txz = Math.hypot(tx - here.x, tz - here.z);
    if (txz < 1e-6) return { angle: 0, dist: distM / KM_PER_UNIT, distM, label: node.name };
    const dx = (tx - here.x) / txz, dz = (tz - here.z) / txz;
    const dot = fwd.x * dx + fwd.z * dz;
    const cross = fwd.x * dz - fwd.z * dx;
    const angle = Math.atan2(cross, Math.max(-1, Math.min(1, dot)));
    return { angle, dist: distM / KM_PER_UNIT, distM, label: node.name };
  }
}
