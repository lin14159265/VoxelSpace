// 本轮验证：主小行星带开采节点（接近/冷却/矿点消耗/里程碑）+ 天王星五卫星可登陆
// 运行：node tools/verifybelt.mjs [seed]
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

// 1. 进入太空 → 小行星带资源节点初始化
R.enter = await ev(() => {
  const g = window.game;
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  g.space.update(0.016);
  return { charges: g.beltCharges, beltMarker: !!g.space.beltMarker };
});
check('belt.chargesInit', R.enter.charges === 14 && R.enter.beltMarker, JSON.stringify(R.enter));

// 2. 飞向小行星带 → 接近检测 + E 开采 + 冷却
R.mine1 = await ev(() => {
  const g = window.game;
  const m = g.space.beltMarker;
  g.flight.pos.x = m.position.x - 80;
  g.flight.pos.z = m.position.z - 40;
  g.space.update(0.016);
  const near = g.beltNear;
  const before = { charges: g.beltCharges, ferrite: g.inventory.countOf('ferrite_dust'), carbon: g.inventory.countOf('carbon'), copper: g.inventory.countOf('copper_ore'), gold: g.inventory.countOf('gold_ore') };
  g.harvestBelt();
  const after = { charges: g.beltCharges, ferrite: g.inventory.countOf('ferrite_dust'), carbon: g.inventory.countOf('carbon'), copper: g.inventory.countOf('copper_ore'), gold: g.inventory.countOf('gold_ore') };
  const gained = (after.ferrite + after.carbon + after.copper + after.gold) - (before.ferrite + before.carbon + before.copper + before.gold);
  const cd = g.beltHarvestCd;
  const againBefore = gained;
  g.harvestBelt(); // 冷却中，不应再采
  const gainedAgain = (g.inventory.countOf('ferrite_dust') + g.inventory.countOf('carbon') + g.inventory.countOf('copper_ore') + g.inventory.countOf('gold_ore'))
    - (after.ferrite + after.carbon + after.copper + after.gold);
  return { near, beforeCharges: before.charges, afterCharges: after.charges, gained, cd, gainedAgain };
});
check('belt.nearDetect', R.mine1.near === true, `${R.mine1.near}`);
check('belt.harvestGain', R.mine1.gained > 0 && R.mine1.afterCharges === 13, JSON.stringify(R.mine1));
check('belt.cooldownBlocks', R.mine1.cd > 0 && R.mine1.gainedAgain === 0, `cd=${R.mine1.cd.toFixed(2)} gainedAgain=${R.mine1.gainedAgain}`);

// 3. 连续开采至矿点耗尽 → 里程碑“小行星矿工”
R.mineAll = await ev(() => {
  const g = window.game;
  const beforeTotal = g.inventory.countOf('ferrite_dust') + g.inventory.countOf('carbon') + g.inventory.countOf('copper_ore') + g.inventory.countOf('gold_ore');
  let tries = 0;
  while (g.beltCharges > 0 && tries++ < 30) {
    g.beltHarvestCd = 0;
    g.harvestBelt();
  }
  const afterTotal = g.inventory.countOf('ferrite_dust') + g.inventory.countOf('carbon') + g.inventory.countOf('copper_ore') + g.inventory.countOf('gold_ore');
  return { charges: g.beltCharges, gained: afterTotal - beforeTotal, beltMiner: g.milestones.earned.has('belt_miner'), stat: g.milestones.data.beltHarvest };
});
check('belt.depleteAndMilestone', R.mineAll.charges === 0 && R.mineAll.gained > 0 && R.mineAll.beltMiner && R.mineAll.stat >= 5, JSON.stringify(R.mineAll));

// 4. 天王星：五卫星实体 + 天卫一登陆
R.warpUranus = await ev(() => {
  const g = window.game;
  g.space.setTarget(6); // 天王星（数字兼容 id）
  g.space.update(0.016);
  const m = g.space.neighborMeshes.find((mm) => mm.np.id === 6);
  if (!m) return { err: 'no uranus' };
  g.flight.pos.x = g.space.enteredAt.x + m.np.dx;
  g.flight.pos.z = g.space.enteredAt.z + m.np.dz;
  let guard = 0;
  while (!g.space.warping && guard++ < 90) g.space.update(1 / 60);
  guard = 0;
  while (g.space.warping && guard++ < 300) g.space.update(1 / 60);
  g.space.update(0.016);
  return { current: g.space.current, moons: g.space.moonMeshes.map((mm) => mm.np.name), name: g.planetName };
});
check('uranus.fiveMoons', R.warpUranus.current === 6 && R.warpUranus.moons.length === 5
  && R.warpUranus.moons.includes('天卫一') && R.warpUranus.moons.includes('天卫五'), JSON.stringify(R.warpUranus));

R.warpAriel = await ev(() => {
  const g = window.game;
  const m = g.space.moonMeshes.find((mm) => mm.np.navId === 'moon:solar.uranus.ariel');
  if (!m) return { err: 'no ariel' };
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
  return { bodyId: g.space.bodyId, surface: g.world.gen.terrain.surface, name: g.planetName, gravity: g.gravity, airless: g.sky.airless, visitedMoons: [...g.space.visitedMoons] };
});
check('uranus.arielLanding', R.warpAriel.bodyId === 'moon:solar.uranus.ariel' && R.warpAriel.surface === 'ice'
  && String(R.warpAriel.name).includes('天卫一') && R.warpAriel.gravity <= 4.0 && R.warpAriel.airless, JSON.stringify(R.warpAriel));

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const pass = allOk() && errors.length === 0;
console.log(pass ? 'CHECKS: all passed' : 'CHECKS: FAILED');
await browser.close();
process.exitCode = pass ? 0 : 1;
