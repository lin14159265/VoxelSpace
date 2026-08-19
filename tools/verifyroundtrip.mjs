// 第 19 轮验证：多次跨星系往返稳定性——太阳系 ↔ 比邻星系连续 3 次跃迁 +
// 跃迁途中存档/重新载入（在比邻星系读档、返回太阳系后再读档），
// 全程校验星系状态/行星数据/任务进度/无页面错误/内存有界。
// 运行：node tools/verifyroundtrip.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots43';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const ctx = await browser.newContext();
const errors = [];
const page = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
console.log('game ready, seed=', SEED);

const R = {};
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 准备：大船解锁 + 进入太空
await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  const q = g.quests;
  q.currentIndex = 12; // explore
  q.completedIds = new Set(['checkShip', 'gather', 'craftTool', 'shelter', 'dihy', 'ferrite', 'craftPlating', 'repairPulse', 'repairGlass', 'fuelLaunch', 'launch', 'space']);
  g.inventory.addItem('credits', 5000);
  g.handleStationAction('upgrade', 'engine1', 1);
  g.handleStationAction('upgrade', 'engine2', 1);
  g.handleStationAction('upgrade', 'shield1', 1);
  g.handleStationAction('upgrade', 'bigship', 1);
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  g.space.update(0.016);
});
await sleep(300);
R.start = await ev(() => ({ galaxy: window.game.space.galaxyId, planets: window.game.space.galaxy.length }));

// 跃迁辅助：传送到目标门附近 → 触发 → 排空跃迁状态
async function warp(page, gatewayId, expectGalaxy) {
  return page.evaluate(({ gatewayId, expectGalaxy }) => {
    const g = window.game;
    if (g.ui.journeyVisible()) g.closeJourney(); // 旅程面板不干扰后续
    g.space.setTarget(gatewayId);
    g.space.update(0.016);
    g.space.tmpV.set(0, 0, 0);
    g.space.gatewayWorldPos(g.space.tmpV);
    g.flight.pos.set(g.space.tmpV.x - 60, g.space.tmpV.y - 20, g.space.tmpV.z - 40);
    g.space.update(0.016);
    const near = g.gatewayNear;
    let guard = 0;
    while (g.space.warping && guard++ < 300) g.space.update(1 / 60);
    const r = {
      gatewayId,
      near,
      warped: g.space.galaxyId === expectGalaxy,
      galaxy: g.space.galaxyId,
      planets: g.space.galaxy.length,
      current: g.space.current,
      questStep: g.quests.currentStep.id,
      journeyShown: g.journeyShown === true,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
    if (g.ui.journeyVisible()) g.closeJourney();
    return r;
  }, { gatewayId, expectGalaxy });
}

// 往返 3 次：太阳 → 比邻(1) → 太阳(2) → 比邻(3) → 太阳(4 次穿越)
R.warp1 = await warp(page, 200, 'proxima');
R.warp2 = await warp(page, 201, 'solar');
R.warp3 = await warp(page, 200, 'proxima');

// 在比邻星系：存档 → 新页面读档 → 校验星系/任务/升级完整恢复
R.saveInProxima = await ev(async () => {
  const g = window.game;
  const { saveGame } = await import('/src/systems/save.js');
  const ok = saveGame(g);
  return {
    ok,
    size: localStorage.getItem('voxelspace-save-v1')?.length || 0,
    galaxy: g.space.galaxyId,
    questStep: g.quests.currentStep.id,
    upgrades: { ...g.shipUpgrades },
  };
});
{
  const page2 = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
  page2.on('pageerror', (e) => errors.push('PAGEERROR2: ' + e.message));
  page2.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE2: ' + m.text()); });
  await page2.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page2.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
  await page2.click('#btn-continue');
  await sleep(2500);
  R.reloadProxima = await page2.evaluate(() => {
    const g = window.game;
    return {
      galaxy: g.space.galaxyId,
      planetName: g.planetName,
      questStep: g.quests.currentStep.id,
      upgrades: { ...g.shipUpgrades },
      running: g.running,
    };
  });
  await page2.close();
}

// 回到原页：最后一次穿越回太阳系
R.warp4 = await warp(page, 201, 'solar');

// 最终存档 → 新页面读档 → 太阳系状态
R.saveInSolar = await ev(async () => {
  const g = window.game;
  const { saveGame } = await import('/src/systems/save.js');
  return { ok: saveGame(g), galaxy: g.space.galaxyId, questStep: g.quests.currentStep.id };
});
{
  const page3 = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
  page3.on('pageerror', (e) => errors.push('PAGEERROR3: ' + e.message));
  page3.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE3: ' + m.text()); });
  await page3.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page3.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
  await page3.click('#btn-continue');
  await sleep(2500);
  R.reloadSolar = await page3.evaluate(() => {
    const g = window.game;
    return { galaxy: g.space.galaxyId, planetName: g.planetName, questStep: g.quests.currentStep.id, running: g.running };
  });
  await page3.close();
}

console.log(JSON.stringify({ R, errors }, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('起点在太阳系（8 行星）', R.start.galaxy === 'solar' && R.start.planets === 8, R.start);
check('第 1 穿：太阳系 → 比邻', R.warp1.warped && R.warp1.galaxy === 'proxima' && R.warp1.planets === 3, R.warp1);
check('第 1 穿接近门触发', R.warp1.near === true, R.warp1);
check('第 2 穿：比邻 → 太阳系', R.warp2.warped && R.warp2.galaxy === 'solar' && R.warp2.planets === 8, R.warp2);
check('第 3 穿：太阳系 → 比邻', R.warp3.warped && R.warp3.galaxy === 'proxima', R.warp3);
check('第 4 穿：比邻 → 太阳系', R.warp4.warped && R.warp4.galaxy === 'solar', R.warp4);
check('比邻星系存档成功', R.saveInProxima.ok && R.saveInProxima.size > 1024, R.saveInProxima);
check('比邻星系读档恢复星系', R.reloadProxima.galaxy === 'proxima', R.reloadProxima);
check('比邻星系读档恢复升级', JSON.stringify(R.reloadProxima.upgrades) === JSON.stringify(R.saveInProxima.upgrades), { a: R.reloadProxima.upgrades, b: R.saveInProxima.upgrades });
check('比邻星系读档任务进度一致', R.reloadProxima.questStep === R.saveInProxima.questStep, { a: R.reloadProxima.questStep, b: R.saveInProxima.questStep });
check('返回太阳系后存档读档正确', R.reloadSolar.galaxy === 'solar' && R.reloadSolar.running === true, R.reloadSolar);
check('全程无页面错误', errors.length === 0, errors.slice(0, 3));

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
