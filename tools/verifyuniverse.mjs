// 本轮验证：统一宇宙数据模型 + 三级星图（恒星级/太阳系/行星系统）+ 导航目标闭环
// 运行：node tools/verifyuniverse.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-universe';
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
const check = (name, ok, detail) => { R[name] = { ok: !!ok, detail }; console.log(`${ok ? '  ✓' : '  ✗'} ${name}`, detail ?? ''); };
const allOk = () => Object.values(R).filter((v) => v && typeof v === 'object' && 'ok' in v).every((v) => v.ok);

await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.input.locked = true;
  g.setPaused(false);
});
await new Promise((r) => setTimeout(r, 300));

// 1. 真实轨道数据进入运行时星系（相对距离为真实比例）
R.realOrbits = await ev(() => {
  const gal = window.game.space.galaxy;
  const by = Object.fromEntries(gal.map((p) => [p.name, p]));
  return {
    count: gal.length,
    earthAU: by['地球'] && by['地球'].orbit,
    jupiterAU: by['木星'] && by['木星'].orbit,
    neptuneAU: by['海王星'] && by['海王星'].orbit,
    orderByOrbit: gal.map((p) => p.name).slice().sort((a, b) => by[a].orbit - by[b].orbit),
  };
});
check('galaxy.8planets', R.realOrbits.count === 8, JSON.stringify(R.realOrbits.count));
check('orbit.earthAU', Math.abs(R.realOrbits.earthAU - 1000) < 1, `${R.realOrbits.earthAU}`);
check('orbit.jupiterRatio', Math.abs(R.realOrbits.jupiterAU / R.realOrbits.earthAU - 5.2026) < 0.02, `${(R.realOrbits.jupiterAU / R.realOrbits.earthAU).toFixed(3)}`);
check('orbit.neptuneRatio', Math.abs(R.realOrbits.neptuneAU / R.realOrbits.earthAU - 30.1104) < 0.02, `${(R.realOrbits.neptuneAU / R.realOrbits.earthAU).toFixed(3)}`);

// 2. 星图三级层级：M 默认太阳系图 → 上级进入恒星级 → 进入太阳系 → 木星系统
R.systemMap = await ev(() => {
  const g = window.game;
  g.openStarMap();
  const nodes = g.ui.starmapViewNodes.map((n) => n.name);
  const canvasLit = (() => {
    const cv = document.getElementById('starmap-canvas');
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return lit;
  })();
  return { level: g.starMapState.level, nodeCount: g.ui.starmapViewNodes.length, names: nodes, canvasLit, listText: document.getElementById('starmap-list').textContent };
});
check('map.levelSystem', R.systemMap.level === 'system', R.systemMap.level);
check('map.systemNodes', R.systemMap.names.includes('太阳') && R.systemMap.names.includes('海王星') && R.systemMap.names.includes('主小行星带') && R.systemMap.names.includes('地球轨道空间站'), R.systemMap.names.join(','));
check('map.canvasLit', R.systemMap.canvasLit > 5000, `${R.systemMap.canvasLit} px`);
check('map.legacyListHasBeltAndSun', R.systemMap.listText.includes('主小行星带') && R.systemMap.listText.includes('太阳'), '旧列表兼容扩展');
await page.screenshot({ path: `${outDir}/system-map.png` });

R.stellar = await ev(() => {
  const g = window.game;
  g.starMapAction('back', null);
  const names = g.ui.starmapViewNodes.map((n) => n.name);
  return { level: g.starMapState.level, names, breadcrumb: document.getElementById('starmap-breadcrumb').textContent };
});
check('map.levelStellar', R.stellar.level === 'stellar' && R.stellar.names.includes('太阳') && R.stellar.names.includes('比邻星'), JSON.stringify(R.stellar));
await page.screenshot({ path: `${outDir}/stellar-map.png` });

R.jupiter = await ev(() => {
  const g = window.game;
  g.starMapAction('enter', 'star:solar');
  g.starMapSelectNode('planet:solar.jupiter');
  const infoText = document.getElementById('starmap-info').textContent;
  g.starMapAction('enter', 'planet:solar.jupiter');
  const names = g.ui.starmapViewNodes.map((n) => n.name);
  return { level: g.starMapState.level, names, hasFacts: infoText.includes('大红斑'), planetCrumb: document.getElementById('starmap-crumb-planet').textContent };
});
check('map.jupiterSystem', R.jupiter.level === 'planet' && R.jupiter.names.includes('木卫一') && R.jupiter.names.includes('木卫二') && R.jupiter.names.includes('木卫三') && R.jupiter.names.includes('木卫四'), R.jupiter.names.join(','));
check('map.jupiterFacts', R.jupiter.hasFacts === true, R.jupiter.planetCrumb);
await page.screenshot({ path: `${outDir}/jupiter-system.png` });

// 3. 导航目标：太阳（字符串节点）→ HUD 罗盘标签 + 距离
R.navSun = await ev(() => {
  const g = window.game;
  g.starMapAction('back', null); // 回到太阳系图
  g.starMapAction('target', 'star:solar');
  const targetId = g.space.targetId;
  const node = g.space.targetNode();
  g.closeStarMap();
  // 进入太空，验证罗盘与固定太阳节点
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  g.space.update(0.016);
  const comp = g.space.compass();
  const sun = g.space.sunMarker;
  const off = g.space.targetWorldOffset();
  return {
    targetId, nodeKind: node && node.kind, nodeName: node && node.name,
    compassLabel: comp && comp.label, compassDist: comp && comp.dist,
    sunMarkerExists: !!sun, sunAt: sun ? { x: sun.position.x, y: sun.position.y, z: sun.position.z } : null,
    offDist: off ? Math.hypot(off.x, off.z) : null,
    region: g.regionLabel(),
  };
});
check('nav.sunTarget', R.navSun.targetId === 'star:solar' && R.navSun.nodeKind === 'star', `${R.navSun.targetId}`);
check('nav.sunCompassLabel', R.navSun.compassLabel === '太阳' && R.navSun.compassDist > 500, `label=${R.navSun.compassLabel} dist=${R.navSun.compassDist}`);
check('nav.sunMarkerFixed', R.navSun.sunMarkerExists && Math.abs(R.navSun.offDist - 1000) < 2, `worldOffset=${R.navSun.offDist}`);
check('nav.regionLabel', String(R.navSun.region).includes('太阳系'), R.navSun.region);

// 4. 旧数字目标兼容：空间站 100 / 跃迁门 200 锁定
R.navCompat = await ev(() => {
  const g = window.game;
  const stationOk = g.space.setTarget(100);
  const stationComp = g.space.compass();
  const gateLocked = g.space.setTarget(200);
  return {
    stationOk, stationLabel: stationComp && stationComp.label,
    gateLocked, targetAfterGate: g.space.targetId,
  };
});
check('nav.stationAlias100', R.navCompat.stationOk && R.navCompat.stationLabel === '地球轨道空间站', JSON.stringify(R.navCompat));
check('nav.gatewayLockedNoBigShip', R.navCompat.gateLocked === false && R.navCompat.targetAfterGate === 100, JSON.stringify(R.navCompat));

// 5. 小行星带节点存在（太阳系太空固定实体）
R.belt = await ev(() => {
  const g = window.game;
  return { exists: !!g.space.beltMarker, name: g.space.beltMarker && g.space.beltMarker.name };
});
check('space.beltMarker', R.belt.exists && R.belt.name === 'space-belt', JSON.stringify(R.belt));

// 6. 比邻星系系统图（3 行星 + 红矮星 + 返回跃迁门）
R.proximaMap = await ev(() => {
  const g = window.game;
  g.openStarMap();
  g.starMapAction('back', null);        // 系统图 → 恒星级
  g.starMapAction('enter', 'star:proxima'); // 进入比邻星系系统图
  const names = g.ui.starmapViewNodes.map((n) => n.name);
  return { level: g.starMapState.level, viewSystem: g.starMapState.viewSystemId, names };
});
check('map.proximaData', R.proximaMap.level === 'system' && R.proximaMap.viewSystem === 'proxima'
  && R.proximaMap.names.includes('比邻星') && R.proximaMap.names.includes('比邻星 b') && R.proximaMap.names.includes('比邻星 d'),
  R.proximaMap.names.join(','));

await page.screenshot({ path: `${outDir}/space-sun.png` });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const pass = allOk() && errors.length === 0;
console.log(pass ? 'CHECKS: all passed' : 'CHECKS: FAILED');
await browser.close();
process.exitCode = pass ? 0 : 1;
