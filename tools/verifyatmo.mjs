// 本轮验证：大气差异化——真实大气密度接入阻力与再入热障
// 地球基准阻力 → 金星浓密阻力/长热障 → 火星稀薄短促 → 月球真空滑翔、无热障
// 运行：node tools/verifyatmo.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-atmo';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
console.log('game ready, seed=', SEED);

const R = {};
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail) => { R[name] = { ok: !!ok, detail }; console.log(`${ok ? '  ✓' : '  ✗'} ${name}`, detail ?? ''); };
const allOk = () => Object.values(R).filter((v) => v && typeof v === 'object' && 'ok' in v).every((v) => v.ok);

await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.input.locked = true;
  g.setPaused(false);
});
await sleep(300);

// 1. 纯数据驱动：同一天体模型下，阻力/热障参数由 atmoDensity 决定
R.factors = await ev(() => {
  const g = window.game;
  const find = (id) => g.space.resolveTargetNode(id);
  const earth = find('planet:solar.earth');
  const venus = find('planet:solar.venus');
  const mars = find('planet:solar.mars');
  const moon = find('moon:solar.earth.luna');
  g.applyBodyProfile(earth); const kEarth = g.flight.airDragK;
  g.applyBodyProfile(venus); const kVenus = g.flight.airDragK;
  g.applyBodyProfile(mars); const kMars = g.flight.airDragK;
  g.applyBodyProfile(moon); const kMoon = g.flight.airDragK;
  g.applyBodyProfile(venus); const vEntry = g.flight.beginReentry();
  const vStrength = g.flight.reentryStrength, vDuration = g.flight.reentryTotal;
  g.flight.clearReentry();
  g.applyBodyProfile(earth); const eEntry = g.flight.beginReentry();
  const eStrength = g.flight.reentryStrength, eDuration = g.flight.reentryTotal;
  g.flight.clearReentry();
  g.applyBodyProfile(mars); g.flight.beginReentry();
  const mStrength = g.flight.reentryStrength, mDuration = g.flight.reentryTotal;
  g.flight.clearReentry();
  g.applyBodyProfile(earth); // 恢复地球基准
  return {
    kEarth, kVenus, kMars, kMoon,
    vEntry, vStrength, vDuration, eEntry, eStrength, eDuration, mStrength, mDuration,
  };
});
check('atmo.dragVenusHeavy', R.factors.kVenus > 1.7 && R.factors.kEarth === 1, JSON.stringify(R.factors));
check('atmo.dragMoonGlide', R.factors.kMoon === 0.15 && R.factors.kMars < R.factors.kEarth, JSON.stringify(R.factors));
check('atmo.entryOrdered', R.factors.vEntry === true && R.factors.eEntry === true
  && R.factors.vStrength === 1 && R.factors.vDuration > R.factors.eDuration
  && R.factors.eDuration > R.factors.mDuration && R.factors.mDuration > 0, JSON.stringify(R.factors));

// 2. 实际物理回路：无油门 1/60s，月球速度损失 << 地球
R.decay = await ev(() => {
  const g = window.game;
  const earth = g.space.resolveTargetNode('planet:solar.earth');
  const moon = g.space.resolveTargetNode('moon:solar.earth.luna');
  const gy = g.world.getGroundY(8.5, 8.5);
  g.flight.piloting = true;
  g.flight.pos.set(8.5, gy + 120, 8.5);
  g.flight.speed = 10; g.flight.vertVel = 0; g.flight.onGround = false; g.flight.launched = true;
  g.applyBodyProfile(earth);
  const s0 = g.flight.speed; g.flight.update(1 / 60); const eDrop = s0 - g.flight.speed;
  g.applyBodyProfile(moon);
  g.flight.speed = 10; const s1 = g.flight.speed; g.flight.update(1 / 60); const mDrop = s1 - g.flight.speed;
  g.applyBodyProfile(earth);
  return { eDrop, mDrop };
});
check('atmo.dragPhysics', R.decay.mDrop < R.decay.eDrop * 0.4, JSON.stringify(R.decay));

// 3. 地球再入：太空 → 降到 130 以下 → 等离子体热障 + 屏幕灼热滤镜
R.earthEntry = await ev(() => {
  const g = window.game;
  const earth = g.space.resolveTargetNode('planet:solar.earth');
  g.applyBodyProfile(earth);
  g.space.active = false;
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.update(1 / 60); // enterSpace
  const inSpace = g.space.active && g.flight.spaceMode;
  g.flight.pos.y = g.world.getGroundY(g.flight.pos.x, g.flight.pos.z) + 120;
  g.flight.speed = 60;
  g.space.update(1 / 60); // exitSpace → beginReentry
  const el = document.getElementById('reentry-overlay');
  return {
    inSpace, exited: !g.space.active && !g.flight.spaceMode,
    active: g.flight.reentryActive, left: g.flight.reentryLeft,
    kind: g.flight.lastEntry && g.flight.lastEntry.kind,
    strength: g.flight.reentryStrength,
    opacity: el.style.opacity, cls: el.classList.contains('active'),
  };
});
check('reentry.earthPlasma', R.earthEntry.inSpace && R.earthEntry.exited && R.earthEntry.active
  && R.earthEntry.kind === 'plasma' && R.earthEntry.strength > 0.5, JSON.stringify(R.earthEntry));
check('reentry.overlayGlow', R.earthEntry.cls === true && Number(R.earthEntry.opacity) > 0, JSON.stringify(R.earthEntry));
// 截取驾驶舱视角：推几帧把相机摆到座舱，等 0.25s 滤镜渐变完成
await ev(() => {
  const g = window.game;
  for (let i = 0; i < 6; i++) g.flight.update(1 / 60);
});
await sleep(450);
await page.screenshot({ path: `${outDir}/reentry-earth.png` });

// 4. 热障按时间衰减并自动熄灭
R.decayFx = await ev(() => {
  const g = window.game;
  for (let i = 0; i < 240; i++) g.flight.updateReentry(1 / 60);
  const el = document.getElementById('reentry-overlay');
  return { active: g.flight.reentryActive, k: g.flight.reentryK, opacity: el.style.opacity, cls: el.classList.contains('active') };
});
check('reentry.fadesOut', R.decayFx.active === false && R.decayFx.k === 0 && Number(R.decayFx.opacity) === 0 && !R.decayFx.cls, JSON.stringify(R.decayFx));

// 5. 月球无大气：同样高速下落 → 没有热障、没有滤镜
R.airless = await ev(() => {
  const g = window.game;
  const moon = g.space.resolveTargetNode('moon:solar.earth.luna');
  g.applyBodyProfile(moon);
  g.space.bodyId = 'moon:solar.earth.luna';
  g.space.active = true;
  g.flight.spaceMode = true;
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 120, 8.5);
  g.flight.speed = 60;
  g.space.update(1 / 60);
  const el = document.getElementById('reentry-overlay');
  return {
    exited: !g.space.active && !g.flight.spaceMode,
    kind: g.flight.lastEntry && g.flight.lastEntry.kind,
    left: g.flight.reentryLeft, active: g.flight.reentryActive,
    opacity: el.style.opacity, cls: el.classList.contains('active'),
  };
});
check('reentry.airlessMoonNone', R.airless.exited && R.airless.kind === 'airless'
  && R.airless.left === 0 && !R.airless.active && Number(R.airless.opacity) === 0 && !R.airless.cls, JSON.stringify(R.airless));

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const pass = allOk() && errors.length === 0;
console.log(pass ? 'CHECKS: all passed' : 'CHECKS: FAILED');
await browser.close();
process.exitCode = pass ? 0 : 1;
