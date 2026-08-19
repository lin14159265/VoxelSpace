// Universe V2 纯逻辑验证：真实米制、地表↔宇宙映射、太阳方向、脉冲包线、飞行矢量。
import * as THREE from 'three';
import {
  Universe, surfaceToUniverse, universeToSurface, surfaceBasisAt, starDirectionM,
  pulseAllowedSpeedM_S, formatDistanceM, AU_M, PULSE_DECEL_M_S2, PULSE_APPROACH_DIST_M,
} from '../src/space/universe.js';
import { ShipFlight } from '../src/entities/shipflight.js';
import { SpaceSystem } from '../src/space/systemV2.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', msg); }
}

// 1. 真实天体距离
{
  const u = new Universe('123456789');
  const e = u.body('planet:solar.earth');
  const m = u.body('moon:solar.earth.luna');
  const d = Math.hypot(m.posM.x - e.posM.x, m.posM.z - e.posM.z);
  assert(Math.abs(d - 384400000) < 1000, `地月距离 384400 km（实际 ${d / 1000}）`);
  assert(Math.abs(e.radiusM - 6371000) < 1, '地球半径 6371 km');
  assert(Math.abs(m.radiusM - 1737400) < 1, '月球半径 1737.4 km');
  const venus = u.body('planet:solar.venus');
  const dEV = Math.hypot(venus.posM.x - e.posM.x, venus.posM.z - e.posM.z);
  assert(dEV > 0.8 * AU_M && dEV < 1.5 * AU_M, '地球-金星在真实 AU 尺度内');
  assert(formatDistanceM(d) === '384,400 km', `距离格式化 ${formatDistanceM(d)}`);
  assert(formatDistanceM(AU_M) === '1.00 AU', 'AU 格式化');
}

// 2. 地表 ↔ 宇宙双向映射（含自转）
{
  const u = new Universe('123456789');
  const e = u.body('planet:solar.earth');
  e.__spin = 1.234;
  const p = surfaceToUniverse(e, 100, 50, 35, 30);
  const back = universeToSurface(e, p.pos, e.__anchor);
  assert(Math.hypot(back.x - 100, back.z - 50) < 1e-3, '地表→宇宙→地表坐标闭合');
  assert(Math.abs(back.altitudeM - 5) < 1e-3, '高度往返保持 5m');
  // 自转旋转基向量，但同一固连点仍映射回同一经纬度
  e.__spin = 2.345;
  const p2 = surfaceToUniverse(e, 100, 50, 35, 30);
  const back2 = universeToSurface(e, p2.pos, e.__anchor);
  assert(Math.hypot(back2.x - 100, back2.z - 50) < 1e-3, '自转下固连点映射仍闭合');
}

// 3. 太阳方向来自恒星位置，而非本地时钟
{
  const u = new Universe('123456789');
  const e = u.body('planet:solar.earth');
  const day = surfaceToUniverse(e, 0, 0, 30, 28);
  const night = surfaceToUniverse(e, 0, Math.PI * e.radiusM, 30, 28); // 半圈外
  const dDay = starDirectionM(u, 'solar', day.pos);
  const dNight = starDirectionM(u, 'solar', night.pos);
  assert(Math.abs(dDay.x - dNight.x) + Math.abs(dDay.y - dNight.y) + Math.abs(dDay.z - dNight.z) > 1e-6, '不同地表位置太阳方向不同');
}

// 4. 脉冲包线：远处允许高速、近处收束到 0
{
  const near = pulseAllowedSpeedM_S(20000 + 100, 20000);
  const mid = pulseAllowedSpeedM_S(100000000, 0);
  const far = pulseAllowedSpeedM_S(4e12, 0);
  assert(near < 1000, `近天体交接速度应收束（${near.toFixed(1)} m/s）`);
  assert(mid > 1000000 && mid < 3e8, `中距离脉冲速度（${mid / 1000} km/s）`);
  assert(far > 1e8, `远距离脉冲可到高速（${far / 3e8} c）`);
  assert(PULSE_APPROACH_DIST_M === 20000000, '最后 2 万公里线性收束');
}

// 5. 飞船前向包含 pitch，W 推力随朝向
{
  const fake = { shipUpgrades: { engine: 0, shield: 0 } };
  const f = new ShipFlight(fake);
  f.pitch = Math.PI / 2;
  const fwd = f.forward();
  assert(Math.abs(fwd.y - 1) < 1e-6, `抬头 90° 机头朝上（y=${fwd.y.toFixed(3)}）`);
  f.pitch = 0; f.yaw = 0;
  const fwd0 = f.forward();
  assert(Math.abs(fwd0.z + 1) < 1e-6 && Math.abs(fwd0.y) < 1e-9, '平飞机头朝 -z 且无垂直分量');
  // 参考系转换后保持长度
  f.localBasis = { east: { x: 1, y: 0, z: 0 }, north: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } };
  const v = new THREE.Vector3(3, 4, 12);
  const world = f.localVectorToUniverse(v);
  assert(Math.abs(world.length() - 13) < 1e-6, '速度矢量转换保持模长');
  const local = f.universeVectorToLocal(world);
  assert(Math.abs(local.x - 3) < 1e-6 && Math.abs(local.y - 4) < 1e-6 && Math.abs(local.z - 12) < 1e-6, '宇宙帧→地表帧速度闭合');
}

// 6. 太空真实速度积分（不依赖倍率造假）
{
  const fake = { shipUpgrades: { engine: 0, shield: 0 } };
  const f = new ShipFlight(fake);
  f.spaceMode = true;
  f.spaceBody = { posM: { x: 0, y: 0, z: 0 }, radiusM: 6371000 };
  f.universePos = { x: 6371000, y: 0, z: 0 };
  f.vel.set(1000, 0, 0);
  f.integrateSpace(2);
  assert(Math.abs(f.universePos.x - (6371000 + 2000)) < 1e-6, '太空按真实速度积分');
  assert(f.effectiveSpeed === 1000, 'effectiveSpeed 即真实速度');
}

// 7. 地球→月球脉冲航线模拟：约 1 分钟，交接速度 < 800 m/s
{
  const u = new Universe('123456789');
  const E = u.body('planet:solar.earth'), M = u.body('moon:solar.earth.luna');
  const dist = Math.hypot(M.posM.x - E.posM.x, M.posM.z - E.posM.z);
  const dir = { x: (M.posM.x - E.posM.x) / dist, z: (M.posM.z - E.posM.z) / dist };
  const pos = { x: E.posM.x + dir.x * (E.radiusM + 40000), z: E.posM.z + dir.z * (E.radiusM + 40000) };
  let v = 0, t = 0;
  const dt = 0.001, A = PULSE_DECEL_M_S2;
  function nearest(p) {
    const de = Math.hypot(p.x - E.posM.x, p.z - E.posM.z) - E.radiusM;
    const dm = Math.hypot(p.x - M.posM.x, p.z - M.posM.z) - M.radiusM;
    return de <= dm ? { d: de, h0: 40000, body: 'earth' } : { d: dm, h0: 20000, body: 'moon' };
  }
  while (t < 120) {
    const n = nearest(pos);
    const allowed = Math.max(220, pulseAllowedSpeedM_S(n.d, n.h0));
    if (v < allowed) v = Math.min(allowed, v + A * dt);
    else if (v > allowed) v = Math.max(allowed, v - 2 * A * dt);
    pos.x += dir.x * v * dt; pos.z += dir.z * v * dt; t += dt;
    if (n.body === 'moon' && n.d < 28000 && v < 800) break;
  }
  assert(t > 20 && t < 90, `地月脉冲航行约 1 分钟（${t.toFixed(1)} s）`);
  assert(v < 800, `交接速度 < 800 m/s（${v.toFixed(1)}）`);
}

// 7.5 W 推力随 pitch：抬头后机头推进会产生垂直速度分量
{
  const input = { down: new Set(['KeyW']), pressedSet: new Set(), isDown(c) { return this.down.has(c); }, pressed() { return false; }, consume() {}, takeMouseDelta() { return { x: 0, y: -2 }; }, takeWheel() { return 0 } };
  const group = new THREE.Group();
  const fake = {
    shipUpgrades: { engine: 0, shield: 0 }, settings: { sens: 1, fov: 75 }, input,
    camera: new THREE.PerspectiveCamera(),
    audio: { setEngine() {}, play() {}, startEngine() {}, stopEngine() {} },
    ui: { setFlightHud() {}, setReentry() {}, toast() {}, shake() {}, setInteractHint() {} },
    quests: { onLaunch() {} }, milestones: { bump() {} }, particles: { spawnBurst() {} },
    world: { getGroundY: () => 25, getBlock: () => 0 },
    ship: { group, smokePos: new THREE.Vector3(), setEngineGlow() {} },
    player: { active: false, placeGhost: null, highlight: { visible: false }, mineTarget: null, mineFrac: 0 },
    bodyProfile: { atmoDensity: 1 },
  };
  const f = new ShipFlight(fake);
  f.piloting = true; f.pos.set(0, 300, 0); f.launched = true;
  for (let i = 0; i < 180; i++) f.update(1 / 60);
  assert(f.pitch > 0.5, `鼠标抬头生效（pitch=${f.pitch.toFixed(2)}）`);
  assert(f.vel.y > 5, `W 推进包含垂直分量（vy=${f.vel.y.toFixed(1)} m/s）`);
  assert(Math.abs(f.forward().y) > 0.4, `机头方向含 pitch（fy=${f.forward().y.toFixed(2)}）`);
}

// 8. 地球→月球连续转换（不重置位置、不固定出生点）
{
  const world = { getGroundY: () => 20, ensureArea() {}, setMeshesVisible() {} };
  const fake = {
    seed: '123456789', scene: new THREE.Scene(), shipUpgrades: { engine: 0, shield: 0 },
    camera: new THREE.PerspectiveCamera(75, 1, 0.1, 1000), world,
    sky: { timeSec: 0, nightFactor: 0, setSpaceMode() {}, setWorldSun() {}, setWorldMoon() {}, setWorldUp() {}, uniforms: { sunSharp: { value: 1 }, sunSoft: { value: 1 }, moonSharp: { value: 1 }, moonSoft: { value: 1 } }, sunTint: { setHex() {} } },
    ui: { setReentry() {}, toast() {}, shake() {}, setFlightHud() {}, warpFlash() {} },
    audio: { play() {}, setAmbient() {}, setEngine() {}, startEngine() {}, stopEngine() {} },
    quests: { onEnterSpace() {}, onPlanetLand() {}, onReachProxima() {} },
    milestones: { bump() {} }, onMissionEvent() {},
    applyNewWorld() { fake.applyCount = (fake.applyCount || 0) + 1; },
    spaceCombat: { clear() {} },
  };
  fake.flight = new ShipFlight(fake);
  fake.space = new SpaceSystem(fake);
  const sp = fake.space, f = fake.flight;
  sp.buildVisuals = () => {}; sp.syncVisuals = () => {};
  f.piloting = true; f.pos.set(8.5, 40020, 8.5);
  f.setLocalFrame(sp.universe.body('planet:solar.earth'), 8.5, 40020, 8.5, new THREE.Vector3(), null);
  sp.ensureSurfaceFrame(true);
  sp.enterSpace();
  assert(sp.active, '起飞后进入太空帧');
  const E = sp.universe.body('planet:solar.earth');
  const alt0 = Math.hypot(f.universePos.x - E.posM.x, f.universePos.y - E.posM.y, f.universePos.z - E.posM.z) - E.radiusM;
  assert(alt0 > 39000 && alt0 < 41000, `大气层顶连续进入（高度 ${alt0.toFixed(0)} m）`);
  const M = sp.universe.body('moon:solar.earth.luna');
  const dx = M.posM.x - f.universePos.x, dz = M.posM.z - f.universePos.z;
  const len = Math.hypot(dx, dz);
  f.universePos = { x: M.posM.x - dx / len * (M.radiusM + 30000), y: M.posM.y, z: M.posM.z - dz / len * (M.radiusM + 30000) };
  f.vel.set(dx / len * 700, 0, dz / len * 700);
  f.universeVel = { x: f.vel.x, y: 0, z: f.vel.z };
  for (let i = 0; i < 600 && sp.active; i++) {
    f.integrateSpace(1 / 60);
    sp.update(1 / 60);
  }
  assert(!sp.active, '接近月球后连续转入月球地表帧');
  assert(sp.currentUniverseNavId() === 'moon:solar.earth.luna', '当前天体切换为月球');
  assert(Math.abs(f.pos.x) > 1000, `月面局部坐标由真实落点反算（x=${f.pos.x.toFixed(0)}），不是固定出生点`);
  assert(f.vel.length() > 500, '交接时速度矢量连续保留');
  assert(fake.applyCount === 1, '月球世界只重建一次');
}

console.log(`Universe V2: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
