// 本轮验证：木星系统——四大伽利略卫星实体 / 木卫二登陆 / 导航距离与 ETA / 星图重定位
// 运行：node tools/verifyjovian.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-jovian';
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

// 1. 从地球太空跃迁到木星
R.warpJupiter = await ev(() => {
  const g = window.game;
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  g.space.setTarget(4); // 木星（数字兼容 id）
  g.space.update(0.016);
  const m = g.space.neighborMeshes.find((mm) => mm.np.id === 4);
  if (!m) return { err: 'no jupiter marker' };
  g.flight.pos.x = g.space.enteredAt.x + m.np.dx;
  g.flight.pos.z = g.space.enteredAt.z + m.np.dz;
  let guard = 0;
  while (!g.space.warping && guard++ < 90) g.space.update(1 / 60);
  guard = 0;
  while (g.space.warping && guard++ < 300) g.space.update(1 / 60);
  return { current: g.space.current, bodyId: g.space.bodyId, name: g.planetName };
});
check('warp.toJupiter', R.warpJupiter.current === 4 && R.warpJupiter.bodyId === null && String(R.warpJupiter.name).includes('木星'), JSON.stringify(R.warpJupiter));

// 2. 木星系统：四颗伽利略卫星实体 + 导航距离/ETA
R.jupiterMoons = await ev(() => {
  const g = window.game;
  g.space.update(0.016);
  const names = g.space.moonMeshes.map((m) => m.np.name);
  const europa = g.space.moonMeshes.find((m) => m.np.navId === 'moon:solar.jupiter.europa');
  const setOk = g.space.setTarget('moon:solar.jupiter.europa');
  const comp = g.space.compass();
  // 触发一次 HUD 刷新，检查距离格式与 ETA
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true;
  g.frame = 11;
  g.loop();
  const distText = document.getElementById('compass-dist').textContent;
  const etaText = document.getElementById('compass-eta').textContent;
  return { names, europa: !!europa, setOk, compDist: comp && comp.dist, distText, etaText, target: g.space.targetId };
});
check('jupiter.fourMoonMarkers', R.jupiterMoons.names.includes('木卫一') && R.jupiterMoons.names.includes('木卫二')
  && R.jupiterMoons.names.includes('木卫三') && R.jupiterMoons.names.includes('木卫四'), R.jupiterMoons.names.join(','));
check('jupiter.europaTarget', R.jupiterMoons.europa && R.jupiterMoons.setOk && R.jupiterMoons.compDist > 0, `${R.jupiterMoons.compDist}`);
check('nav.distanceFormattedAU', String(R.jupiterMoons.distText).includes('AU'), R.jupiterMoons.distText);
check('nav.etaShown', String(R.jupiterMoons.etaText).includes('预计'), R.jupiterMoons.etaText);

// 3. 星图重定位：木星系统图里欧罗巴是当前目标
R.relocate = await ev(() => {
  const g = window.game;
  g.openStarMap();
  g.starMapAction('enter', 'planet:solar.jupiter');
  const view = g.buildStarMapView();
  const targetNode = view.nodes.find((n) => n.id === 'moon:solar.jupiter.europa');
  const mapLevel = g.starMapState.level;
  g.closeStarMap();
  return { mapLevel, targetHighlight: targetNode ? targetNode.target : false, hasMoonNode: !!targetNode };
});
check('nav.starMapRelocate', R.relocate.mapLevel === 'planet' && R.relocate.hasMoonNode && R.relocate.targetHighlight === true, JSON.stringify(R.relocate));

// 4. 跃迁到木卫二 → 冰面世界
R.warpEuropa = await ev(() => {
  const g = window.game;
  const m = g.space.moonMeshes.find((mm) => mm.np.navId === 'moon:solar.jupiter.europa');
  if (!m) return { err: 'no europa marker' };
  g.flight.pos.x = g.space.enteredAt.x + m.np.dx;
  g.flight.pos.z = g.space.enteredAt.z + m.np.dz;
  let guard = 0;
  while (!g.space.warping && guard++ < 90) g.space.update(1 / 60);
  guard = 0;
  while (g.space.warping && guard++ < 300) g.space.update(1 / 60);
  const gy = g.world.getGroundY(g.flight.pos.x, g.flight.pos.z);
  g.flight.pos.y = gy + 8;
  guard = 0;
  while (g.space.active && guard++ < 300) g.space.update(1 / 60);
  return {
    bodyId: g.space.bodyId, current: g.space.current, surface: g.world.gen.terrain.surface,
    planetName: g.planetName, gravity: g.gravity, airless: g.sky.airless,
    moonWalker: g.milestones.earned.has('moonwalker'), region: g.regionLabel(),
  };
});
check('warp.europaWorld', R.warpEuropa.bodyId === 'moon:solar.jupiter.europa' && R.warpEuropa.current === 4
  && R.warpEuropa.surface === 'ice' && String(R.warpEuropa.planetName).includes('木卫二'), JSON.stringify(R.warpEuropa));
check('europa.lowGravity', Math.abs(R.warpEuropa.gravity - 3.9) < 0.01, `g=${R.warpEuropa.gravity.toFixed(3)}`);
check('europa.airless', R.warpEuropa.airless === true && R.warpEuropa.moonWalker === true, JSON.stringify(R.warpEuropa));
check('europa.region', String(R.warpEuropa.region).includes('木卫二'), R.warpEuropa.region);

// 5. 连续降落 2 颗卫星（木卫一、木卫三）→ “卫星巡游者”里程碑（共 3 颗）
R.moonHopper = await ev(() => {
  const g = window.game;
  const hop = (navId) => {
    // 返回木星轨道（从当前卫星起飞进太空）
    g.flight.piloting = true;
    g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
    g.flight.speed = 0; g.flight.vertVel = 0;
    g.space.active = false;
    g.space.bodyId = null;
    g.space.current = 4;
    g.space.enterSpace();
    const node = window.game.space.landableMoons().find((mm) => mm.navId === navId);
    if (!node) return false;
    // 直接调用统一卫星跃迁（与真实接近检测共用 landOnMoon）
    g.space.beginWarp(node);
    let guard = 0;
    while (g.space.warping && guard++ < 300) g.space.update(1 / 60);
    if (g.space.bodyId !== navId) return false;
    // 真实下降：高度压到大气阈值下触发 exitSpace → 里程碑计数
    const gy = g.world.getGroundY(g.flight.pos.x, g.flight.pos.z);
    g.flight.pos.y = gy + 8;
    guard = 0;
    while (g.space.active && guard++ < 300) g.space.update(1 / 60);
    return g.space.bodyId === navId;
  };
  const io = hop('moon:solar.jupiter.io');
  const gany = hop('moon:solar.jupiter.ganymede');
  return {
    io, gany, earnedHopper: g.milestones.earned.has('moon_hopper'),
    visitedMoons: [...g.space.visitedMoons], count: g.space.visitedMoons.size,
  };
});
check('milestone.moonHopperAfter3', R.moonHopper.io && R.moonHopper.gany && R.moonHopper.earnedHopper && R.moonHopper.count >= 3,
  JSON.stringify(R.moonHopper));

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const pass = allOk() && errors.length === 0;
console.log(pass ? 'CHECKS: all passed' : 'CHECKS: FAILED');
await browser.close();
process.exitCode = pass ? 0 : 1;
