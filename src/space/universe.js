// Universe V2：统一宇宙逻辑层（纯数据 + 纯逻辑，可在 Node 中测试）。
//
// 设计目标：
//   1. 宇宙拥有独立于玩家的稳定空间结构（恒星系统坐标原点是恒星，不是玩家）。
//   2. 恒星系统内使用真实米制距离（double 精度），渲染层通过浮动原点把坐标
//      拉回相机附近，避免 Float32 精度问题。
//   3. 每颗可登陆天体拥有一套“地表局部坐标 ↔ 天体固连坐标 ↔ 宇宙坐标”的
//      双向映射。体素世界仍然是局部平面，但它的原点现在对应天体上一个确定的
//      经纬度；起飞、太空飞行和降落使用同一套宇宙坐标。
//   4. 太阳方向只由“恒星位置 - 观察者位置”计算，地表、太空、星图共用。
//
// 旧 celestial.js 的 AU=1000 单位制仍保留给旧测试与兼容工具使用；
// 新运行时代码以本文件为唯一宇宙状态来源。

import { hashSeed, mulberry32 } from '../world/noise.js';
import {
  bodyById, planetsOfSystem, systemMeta, dayLengthSeconds,
  SOLAR_SYSTEM, PROXIMA_SYSTEM, SIRIUS_SYSTEM, BELT_NODES, STATION_NODES, GATEWAY_NODES,
} from './celestial.js';

// ---- 真实尺度常量 ----
export const AU_M = 149597870700;          // 1 AU（米）
export const C_M_S = 299792458;            // 光速（米/秒）
export const LIGHT_YEAR_M = 9.4607304725808e15;

// ---- 飞船航行尺度（V2 Phase 1；数值为游戏手感，不是现实航天器） ----
export const DRIVE_NORMAL_MAX_M_S = 120;   // 大气/近天体常规推进
export const DRIVE_CRUISE_MAX_M_S = 2500;  // 轨道巡航
export const DRIVE_PULSE_MAX_M_S = 3 * C_M_S; // 深空脉冲（跨外行星用；近天体由速度包线强制减速）
export const DRIVE_PULSE_ACCEL_M_S2 = 2340000; // 脉冲加速（游戏化：连续加速/减速轮廓）
export const DRIVE_BRAKE_M_S2 = 1600;      // 兼容常量
export const PULSE_DECEL_M_S2 = 2340000;   // 脉冲速度包线：v = sqrt(2·a·h)
export const PULSE_APPROACH_DIST_M = 20000000; // 最后 2 万公里线性收束到安全交接速度
export const ATMO_BASE_MAX_M_S = 220;      // 大气层基础速度（引擎升级 +60/级）
export const ATMO_THRUST_M_S2 = 16;        // 大气常规推力
export const ATMO_BRAKE_M_S2 = 22;
export const ATMO_DRAG_M_S2 = 1.2;         // 无油门被动减速率

// 深空脉冲速度包线：离天体表面越远，允许的有效速度越高。
// 远距离 v = sqrt(2·a·h)；最后 APPROACH 距离内线性收束到 0，
// 使“接近天体”以连续制动结束，而不是在交接瞬间速度突变。
export function pulseAllowedSpeedM_S(distToSurfaceM, h0M = 0) {
  const h = Math.max(0, distToSurfaceM - h0M);
  const D = PULSE_APPROACH_DIST_M;
  if (h < D) {
    const vApproach = Math.sqrt(2 * PULSE_DECEL_M_S2 * D);
    return vApproach * (h / D);
  }
  const v = Math.sqrt(2 * PULSE_DECEL_M_S2 * h);
  return Math.min(DRIVE_PULSE_MAX_M_S, v);
}

// ---- 天体轨道参数 ----
// 每颗行星的轨道角保留 celestial 配置，外加种子扰动；V2 Phase 1 轨道为静态，
// 后续阶段再引入公转时钟。
export function systemBodyRecords(systemId, gameSeed) {
  const rng = mulberry32(hashSeed('universe:' + systemId + ':' + gameSeed));
  const systemSeed = systemId === 'solar' ? String(gameSeed) : `${gameSeed}:${systemId}`;
  const out = [];
  const starMeta = systemMeta(systemId);
  const star = bodyById(`star:${systemId}`);
  out.push({
    navId: `star:${systemId}`,
    kind: 'star',
    systemId,
    name: starMeta.starName,
    parentId: null,
    radiusM: (star ? star.radiusKm : 695700) * 1000,
    aAU: 0,
    angleDeg: 0,
    posM: { x: 0, y: 0, z: 0 },
    landable: false,
    dockable: false,
    gateway: false,
    atmoDensity: 0,
    dayHours: star ? star.dayHours : 0,
    dayLength: star ? dayLengthSeconds(star) : 480,
    retrograde: false,
    surface: 'star',
  });

  const defs = planetsOfSystem(systemId);
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const angle = (def.angleDeg + (rng() - 0.5) * 6) * Math.PI / 180;
    const orbitM = def.aAU * AU_M;
    const node = bodyById(def.navId);
    out.push({
      navId: def.navId,
      kind: 'planet',
      systemId,
      name: def.name,
      parentId: `star:${systemId}`,
      radiusM: def.radiusKm * 1000,
      aAU: def.aAU,
      angleDeg: def.angleDeg,
      orbitM,
      posM: { x: Math.cos(angle) * orbitM, y: 0, z: Math.sin(angle) * orbitM },
      landable: true,
      dockable: false,
      gateway: false,
      atmoDensity: def.atmoDensity || 1,
      dayHours: def.dayHours,
      dayLength: dayLengthSeconds(def),
      retrograde: !!(def.dayHours && def.dayHours < 0),
      surface: def.surface,
      gravityG: def.gravityG,
      terrain: def.terrain,
      ores: def.ores,
      plants: def.plants,
      hazard: def.hazard,
      weather: def.weather,
      palette: {
        grassHue: def.grassHue,
        skyTop: def.skyTop,
        skyHorizon: def.skyHorizon,
        surface: def.surfaceColors,
        atmos: def.atmos,
      },
      seed: i === 0 ? systemSeed : String(hashSeed(systemSeed + ':p' + i)),
      facts: def.facts || [],
      ring: !!def.ring,
    });
  }

  // 卫星：真实半长轴（米），轨道角由种子确定。
  // celestial.js 没有导出完整 MOON_DEFS；通过已知父节点 id 列表构建。
  const byParent = new Map(out.map((b) => [b.navId, b]));
  const MOON_NAV_IDS = [
    'moon:solar.earth.luna', 'moon:solar.mars.phobos', 'moon:solar.mars.deimos',
    'moon:solar.jupiter.io', 'moon:solar.jupiter.europa', 'moon:solar.jupiter.ganymede', 'moon:solar.jupiter.callisto',
    'moon:solar.saturn.titan', 'moon:solar.saturn.rhea', 'moon:solar.saturn.iapetus',
    'moon:solar.saturn.dione', 'moon:solar.saturn.tethys', 'moon:solar.saturn.enceladus',
    'moon:solar.uranus.titania', 'moon:solar.uranus.oberon', 'moon:solar.uranus.umbriel',
    'moon:solar.uranus.ariel', 'moon:solar.uranus.miranda', 'moon:solar.neptune.triton',
  ];
  for (const navId of MOON_NAV_IDS) {
    const m = bodyById(navId);
    if (!m || m.systemId !== systemId) continue;
    const parent = byParent.get(m.parentId);
    if (!parent) continue;
    const angle = (m.angleDeg !== undefined ? m.angleDeg : 30 + rng() * 360) * Math.PI / 180;
    const orbitM = m.aAU * AU_M;
    const posM = {
      x: parent.posM.x + Math.cos(angle) * orbitM,
      y: parent.posM.y,
      z: parent.posM.z + Math.sin(angle) * orbitM,
    };
    out.push({
      navId: m.navId,
      kind: 'moon',
      systemId,
      name: m.name,
      parentId: m.parentId,
      radiusM: m.radiusKm * 1000,
      aAU: m.aAU,
      angleDeg: m.angleDeg !== undefined ? m.angleDeg : (angle * 180 / Math.PI),
      orbitM,
      posM,
      landable: !!m.landable,
      dockable: false,
      gateway: false,
      atmoDensity: m.atmoDensity || 0.2,
      sunAU: m.sunAU,
      dayHours: m.dayHours,
      dayLength: dayLengthSeconds(m),
      retrograde: !!(m.dayHours && m.dayHours < 0),
      surface: m.surface || 'moon',
      gravityG: m.gravityG,
      terrain: m.terrain,
      ores: m.ores,
      plants: m.plants,
      hazard: m.hazard,
      weather: m.weather,
      palette: m.palette,
      seed: m.palette ? String(hashSeed(gameSeed + ':moon:' + navId)) : null,
      facts: m.facts || [],
      ring: false,
    });
  }

  // 小行星带
  for (const navId of Object.keys(BELT_NODES)) {
    const n = bodyById(navId);
    if (!n || n.systemId !== systemId) continue;
    const angle = (n.angleDeg || 118) * Math.PI / 180;
    out.push({
      navId: n.navId, kind: 'belt', systemId, name: n.name, parentId: `star:${systemId}`,
      radiusM: (n.radiusKm || 1) * 1000, aAU: n.aAU, angleDeg: n.angleDeg || 118,
      orbitM: n.aAU * AU_M,
      posM: { x: Math.cos(angle) * n.aAU * AU_M, y: 0, z: Math.sin(angle) * n.aAU * AU_M },
      landable: false, dockable: false, gateway: false, atmoDensity: 0, dayHours: 0, dayLength: 480,
      retrograde: false, surface: 'belt', facts: n.facts || [],
    });
  }

  // 空间站：放在母行星附近的人造轨道（Phase 1 使用行星半径 + 42164 km 的同步轨道近似）。
  for (const navId of Object.keys(STATION_NODES)) {
    const n = bodyById(navId);
    if (!n || n.systemId !== systemId) continue;
    const parent = byParent.get(n.parentId);
    if (!parent) continue;
    const angle = (n.angleDeg || 33) * Math.PI / 180;
    const orbitM = parent.radiusM + 42164000;
    out.push({
      navId: n.navId, kind: 'station', systemId, name: n.name, parentId: n.parentId,
      radiusM: 120, aAU: orbitM / AU_M, angleDeg: n.angleDeg || 33, orbitM,
      posM: {
        x: parent.posM.x + Math.cos(angle) * orbitM,
        y: parent.posM.y,
        z: parent.posM.z + Math.sin(angle) * orbitM,
      },
      landable: false, dockable: !!n.dockable, gateway: false, atmoDensity: 0,
      dayHours: 0, dayLength: 480, retrograde: false, surface: 'station', facts: n.facts || [],
    });
  }

  // 跃迁门：V2 中仍是跨恒星系统的人工节点。距离取真实天体尺度内可航行的
  // 位置（Phase 1 暂用 0.13 AU，后续由星际航行能力决定）。
  for (const navId of Object.keys(GATEWAY_NODES)) {
    const n = bodyById(navId);
    if (!n || n.systemId !== systemId) continue;
    const angle = ((n.offset && Math.atan2(n.offset.z, n.offset.x)) || -0.8) * 1;
    const orbitM = 0.13 * AU_M;
    out.push({
      navId: n.navId, kind: 'gateway', systemId, name: n.name, parentId: `star:${systemId}`,
      radiusM: 30, aAU: 0.13, angleDeg: angle * 180 / Math.PI, orbitM,
      posM: { x: Math.cos(angle) * orbitM, y: 0, z: Math.sin(angle) * orbitM },
      landable: false, dockable: false, gateway: true, targetSystem: n.targetSystem,
      atmoDensity: 0, dayHours: 0, dayLength: 480, retrograde: false, surface: 'gateway',
      facts: n.facts || [],
    });
  }
  return out;
}

// ---- 宇宙状态（纯数据） ----
export class Universe {
  constructor(gameSeed) {
    this.gameSeed = String(gameSeed);
    this.systems = { solar: systemBodyRecords('solar', this.gameSeed), proxima: systemBodyRecords('proxima', this.gameSeed), sirius: systemBodyRecords('sirius', this.gameSeed) };
    this.byId = new Map();
    for (const list of Object.values(this.systems)) for (const b of list) this.byId.set(b.navId, b);
    // 每个天体固定一个地表锚点：体素世界原点 (0,0) 对应的经纬度。
    // Phase 1 用种子确定经度、纬度 0；保证同一天体每次会话一致。
    this.anchors = new Map();
    for (const b of this.byId.values()) {
      if (b.kind === 'planet' || b.kind === 'moon') {
        const h = hashSeed('anchor:' + b.navId + ':' + this.gameSeed) / 4294967296;
        this.anchors.set(b.navId, { x0: 0, z0: 0, lat0: 0, lon0: h * Math.PI * 2 });
      }
    }
    this.initBodyAnchors();
  }

  body(id) { return this.byId.get(String(id)) || null; }
  bodies(systemId) { return this.systems[systemId] || []; }
  setBodyAnchor(body, anchor) { if (body) body.__anchor = { ...anchor }; }
  initBodyAnchors() {
    for (const [navId, anchor] of this.anchors.entries()) {
      const b = this.byId.get(navId);
      if (b) b.__anchor = { ...anchor };
    }
  }
  homeBody(systemId) {
    if (systemId === 'proxima') return this.body('planet:proxima.b');
    if (systemId === 'sirius') return this.body('planet:sirius.b');
    return this.body('planet:solar.earth');
  }

  starOf(systemId) { return this.body(`star:${systemId}`); }
  anchorOf(body) { return this.anchors.get(body.navId) || { x0: 0, z0: 0, lat0: 0, lon0: 0 }; }

  // 天体自转相位（游戏昼夜时钟，统一地表与太空）。
  rotationAngle(body, timeSec) {
    const day = body && body.dayLength > 0 ? body.dayLength : 480;
    const phase = (body && body.retrograde ? -1 : 1) * timeSec / day * Math.PI * 2;
    return phase;
  }

  // 最近的可登陆/可停靠天体与表面距离。
  nearestBody(posM, { maxM = Infinity } = {}) {
    let best = null, bestD = Infinity;
    for (const b of this.byId.values()) {
      if (b.kind !== 'planet' && b.kind !== 'moon' && b.kind !== 'station') continue;
      const d = Math.hypot(posM.x - b.posM.x, posM.y - b.posM.y, posM.z - b.posM.z);
      if (d < bestD) { best = b; bestD = d; }
    }
    const distSurface = best ? Math.max(0, bestD - best.radiusM) : Infinity;
    return bestD <= maxM ? { body: best, centerDist: bestD, surfaceDist: distSurface } : null;
  }

  // 玩家所在主导天体（引力/大气/降落归属）。Phase 1 用“在哪个天体表面包络内”判定。
  governingBody(posM) {
    let best = null, bestScore = Infinity;
    for (const b of this.byId.values()) {
      if (b.kind !== 'planet' && b.kind !== 'moon') continue;
      const d = Math.hypot(posM.x - b.posM.x, posM.y - b.posM.y, posM.z - b.posM.z);
      const r = b.radiusM;
      const score = Math.max(0.001, d / Math.max(1, r));
      if (score < bestScore) { best = b; bestScore = score; }
    }
    return { body: best, centerDist: best ? Math.hypot(posM.x - best.posM.x, posM.y - best.posM.y, posM.z - best.posM.z) : Infinity };
  }
}

// ---- 地表局部坐标 ↔ 宇宙坐标 ----
// 约定：局部 x=东、z=北；anchor 是世界原点 (x0,z0) 对应的经纬度。
// 局部 y 仍沿用体素高度；alt = y - groundY（由调用方给出）。
function rotY(v, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

export function surfaceBasisAt(body, lat, lon, spin = body ? (body.__spin || 0) : 0) {
  const cp = Math.cos(lat), sp = Math.sin(lat);
  const cl = Math.cos(lon), sl = Math.sin(lon);
  const up = rotY({ x: cp * cl, y: sp, z: cp * sl }, spin);
  const east = rotY({ x: -sl, y: 0, z: cl }, spin);
  const north = rotY({ x: -sp * cl, y: cp, z: -sp * sl }, spin);
  return { up, east, north };
}

export function surfaceToUniverse(body, x, z, y, groundY, spin = body ? (body.__spin || 0) : 0) {
  const a = body.__anchor || { x0: 0, z0: 0, lat0: 0, lon0: 0 };
  const R = body.radiusM;
  const cosLat = Math.max(0.05, Math.cos(a.lat0));
  const lat = a.lat0 + (z - a.z0) / R;
  const lon = a.lon0 + (x - a.x0) / (R * cosLat);
  const alt = Math.max(0, y - groundY);
  const basis = surfaceBasisAt(body, lat, lon, spin);
  const r = R + alt;
  const pos = {
    x: body.posM.x + basis.up.x * r,
    y: body.posM.y + basis.up.y * r,
    z: body.posM.z + basis.up.z * r,
  };
  return { pos, lat, lon, up: basis.up, east: basis.east, north: basis.north, spin };
}

export function universeToSurface(body, posM, anchor = null, spin = body ? (body.__spin || 0) : 0) {
  const a = anchor || body.__anchor || { x0: 0, z0: 0, lat0: 0, lon0: 0 };
  const R = body.radiusM;
  const dx = posM.x - body.posM.x, dy = posM.y - body.posM.y, dz = posM.z - body.posM.z;
  const r = Math.max(1, Math.hypot(dx, dy, dz));
  // 先转回自转固连系，再求经纬度。
  const up = rotY({ x: dx / r, y: dy / r, z: dz / r }, -spin);
  const lat = Math.asin(Math.max(-1, Math.min(1, up.y)));
  let lon = Math.atan2(up.z, up.x);
  // 把经度归一到锚点附近，避免 ±π 边界跳变。
  while (lon - a.lon0 > Math.PI) lon -= Math.PI * 2;
  while (lon - a.lon0 < -Math.PI) lon += Math.PI * 2;
  const cosLat = Math.max(0.05, Math.cos(a.lat0));
  let x = a.x0 + (lon - a.lon0) * R * cosLat;
  let z = a.z0 + (lat - a.lat0) * R;
  // 选择离最近一次局部坐标更近的经度周期，避免 ±π 跳变。
  const period = Math.PI * 2 * R * cosLat;
  if (a.lastX !== undefined) {
    const k = Math.round((a.lastX - x) / period);
    x += k * period;
  }
  return { x, z, lat, lon, radialDist: r, altitudeM: r - R, spin };
}

// 距离/速度格式化（V2 运行时使用真实米制）。
export function formatDistanceM(m) {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—';
  if (m >= AU_M * 0.01) return `${(m / AU_M).toFixed(2)} AU`;
  if (m >= 1000) return `${(m / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} km`;
  return `${Math.round(m)} m`;
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
  return `${(seconds / 3600).toFixed(1)} 小时`;
}

// 恒星方向（世界坐标系）。地表天空与太空光照都使用这个函数。
export function starDirectionM(universe, systemId, posM) {
  const star = universe.starOf(systemId);
  if (!star) return { x: 0, y: 1, z: 0 };
  const dx = star.posM.x - posM.x, dy = star.posM.y - posM.y, dz = star.posM.z - posM.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

// 本地地平帧中的太阳方位（供 HUD/调试）。
export function sunAzimuthElevation(universe, systemId, posM, up) {
  const d = starDirectionM(universe, systemId, posM);
  const dotUp = Math.max(-1, Math.min(1, d.x * up.x + d.y * up.y + d.z * up.z));
  const elev = Math.asin(dotUp);
  // 粗略方位角：把太阳方向投影到东/北平面。
  const east = { x: 1, y: 0, z: 0 }, north = { x: 0, y: 0, z: 1 };
  const e = d.x * east.x + d.y * east.y + d.z * east.z;
  const n = d.x * north.x + d.y * north.y + d.z * north.z;
  return { elevation: elev, azimuth: Math.atan2(e, n), dir: d };
}

// 为某个天体设置运行时地表锚点（保证同一次会话多次换算稳定）。
export function setBodyAnchor(universe, body, anchor) {
  if (!body) return;
  body.__anchor = { ...anchor };
}
