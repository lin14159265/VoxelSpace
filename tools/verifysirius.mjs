// 本轮验证：恒星图第三节点——天狼星系统（星图/双跃迁门/跃迁往返/行星登陆/存档）
// 运行：node tools/verifysirius.mjs [seed]
import { chromium } from 'playwright-core';

const SEED = process.argv[2] || '20240815';
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
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  g.inventory.addItem('credits', 5000);
  g.handleStationAction('upgrade', 'engine1', 1);
  g.handleStationAction('upgrade', 'engine2', 1);
  g.handleStationAction('upgrade', 'shield1', 1);
  g.handleStationAction('upgrade', 'bigship', 1);
});

// 1. 恒星级星图：太阳系 / 比邻星系 / 天狼星系三节点
R.stellar = await ev(() => {
  const g = window.game;
  g.openStarMap();
  g.starMapAction('back', null); // → 恒星级
  const names = g.ui.starmapViewNodes.map((n) => n.name);
  g.starMapSelectNode('star:sirius');
  const info = document.getElementById('starmap-info').textContent;
  return { level: g.starMapState.level, names, hasDistance: info.includes('8.6') };
});
check('stellar.threeStars', R.stellar.level === 'stellar' && R.stellar.names.includes('太阳') && R.stellar.names.includes('比邻星') && R.stellar.names.includes('天狼星') && R.stellar.names.length === 3, JSON.stringify(R.stellar));
check('stellar.siriusDistance', R.stellar.hasDistance, '');

// 2. 太阳系系统图：两个外向跃迁门（比邻 + 天狼星）
R.solarMap = await ev(() => {
  const g = window.game;
  g.starMapAction('enter', 'star:solar');
  const rows = [...document.querySelectorAll('#starmap-list .starmap-row')].map((r) => r.dataset.id);
  return { rows, has200: rows.includes('200'), hasSirius: rows.includes('gateway:solar.sirius'), names: g.ui.starmapViewNodes.map((n) => n.name) };
});
check('solar.twoGateways', R.solarMap.has200 && R.solarMap.hasSirius && R.solarMap.names.includes('天狼星系跃迁点'), JSON.stringify(R.solarMap));

// 3. 设目标 → 飞向天狼星门 → 跃迁进入天狼星系
R.warpSirius = await ev(() => {
  const g = window.game;
  g.closeStarMap();
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  g.space.update(0.016);
  const node = g.space.resolveTargetNode('gateway:solar.sirius');
  const ok = g.space.setTarget(node.navId);
  const comp = g.space.compass();
  const gatewayCountBefore = g.space.gatewayGroups.length;
  const off = node.offset;
  g.flight.pos.set(g.space.enteredAt.x + off.x - 60, g.space.enteredAt.groundY + off.y - 20, g.space.enteredAt.z + off.z - 40);
  g.space.update(0.016);
  const near = g.gatewayNear;
  let guard = 0;
  while (g.space.warping && guard++ < 300) g.space.update(1 / 60);
  return {
    ok, compLabel: comp && comp.label, near,
    gatewayCount: gatewayCountBefore, galaxy: g.space.galaxyId,
    planets: g.space.galaxy.length, name: g.planetName, visited: [...(g.space.visitedSirius || [])],
  };
});
check('nav.siriusTarget', R.warpSirius.ok && R.warpSirius.compLabel === '天狼星系跃迁点' && R.warpSirius.gatewayCount === 2, `${R.warpSirius.compLabel} gates=${R.warpSirius.gatewayCount}`);
check('warp.intoSirius', R.warpSirius.near && R.warpSirius.galaxy === 'sirius' && R.warpSirius.planets === 2 && String(R.warpSirius.name).includes('天狼星 b'), JSON.stringify(R.warpSirius));

// 4. 天狼星系内跃迁到外围冰行星 c（等待跃迁保护期）
R.warpPlanetC = await ev(() => {
  const g = window.game;
  for (let i = 0; i < 90 && g.space.warpGrace > 0; i++) g.space.update(1 / 60);
  g.space.setTarget(1);
  g.space.update(0.016);
  const m = g.space.neighborMeshes.find((mm) => mm.np.id === 1);
  if (!m) return { err: 'no c marker' };
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
  return { current: g.space.current, surface: g.world.gen.terrain.surface, name: g.planetName, visited: [...(g.space.visitedSirius || [])] };
});
check('sirius.landPlanetC', R.warpPlanetC.current === 1 && R.warpPlanetC.surface === 'ice' && String(R.warpPlanetC.name).includes('天狼星 c') && R.warpPlanetC.visited.includes(1), JSON.stringify(R.warpPlanetC));

// 5. 天狼星系存档 → 重载恢复
R.saveSirius = await ev(async () => {
  const g = window.game;
  const { saveGame } = await import('/src/systems/save.js');
  const ok = saveGame(g);
  return { ok, galaxy: g.space.galaxyId };
});
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
R.reloadSirius = await ev(() => ({
  galaxy: window.game.space.galaxyId, planets: window.game.space.galaxy.length,
  name: window.game.planetName, visited: [...(window.game.space.visitedSirius || [])],
}));
check('sirius.saveReload', R.saveSirius.ok && R.reloadSirius.galaxy === 'sirius' && R.reloadSirius.planets === 2
  && String(R.reloadSirius.name).includes('天狼星 c') && R.reloadSirius.visited.includes(1), JSON.stringify({ save: R.saveSirius, reload: R.reloadSirius }));

// 6. 从新页面直接返回太阳系（跨星系跃迁门反向）
R.warpBack = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  g.space.update(0.016);
  const node = g.space.resolveTargetNode('gateway:sirius.solar');
  g.space.setTarget(node.navId);
  g.space.update(0.016);
  const off = node.offset;
  g.flight.pos.set(g.space.enteredAt.x + off.x - 60, g.space.enteredAt.groundY + off.y - 20, g.space.enteredAt.z + off.z - 40);
  g.space.update(0.016);
  let guard = 0;
  while (g.space.warping && guard++ < 300) g.space.update(1 / 60);
  return { galaxy: g.space.galaxyId, name: g.planetName, near: g.gatewayNear };
});
check('sirius.returnSolar', R.warpBack.galaxy === 'solar' && String(R.warpBack.name).includes('地球'), JSON.stringify(R.warpBack));

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const pass = allOk() && errors.length === 0;
console.log(pass ? 'CHECKS: all passed' : 'CHECKS: FAILED');
await browser.close();
process.exitCode = pass ? 0 : 1;
