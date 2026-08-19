// 本轮验证：多星系大任务——站长线任务链 / 大船购买(前置) / 跃迁门(锁定/罗盘/穿越) / 比邻星系
// 运行：node tools/verifyproxima.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '31415926';
const outDir = 'shots33';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);

await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.input.locked = true;
  g.setPaused(false);
});
await sleep(400);

// 1. 跃迁门初始锁定（无大船）
R.gatewayLocked = await ev(() => {
  const g = window.game;
  g.openStarMap();
  const row = document.querySelector('#starmap-list [data-id="200"]');
  const lockedText = row ? row.textContent.includes('需大型飞船') : false;
  const btn = row ? row.querySelector('.craft-btn') : null;
  const disabled = btn ? btn.classList.contains('disabled') : false;
  g.closeStarMap();
  g.space.setTarget(-1);
  const setOk = g.space.setTarget(200);
  return { rowExists: !!row, lockedText, disabled, targetSetDespiteLock: setOk && g.space.targetId === 200 };
});
await page.screenshot({ path: `${outDir}/starmap_locked.png` });

// 2. 任务推进：探索 → 造访空间站 → 站长对话 → 购船 → 跃迁
await ev(() => {
  const g = window.game;
  const q = g.quests;
  q.currentIndex = 12; // explore
  q.completedIds = new Set(['checkShip', 'gather', 'craftTool', 'shelter', 'dihy', 'ferrite', 'craftPlating', 'repairPulse', 'repairGlass', 'fuelLaunch', 'launch', 'space']);
  q.onPlanetLand();
  // 进入太空并停靠
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  g.space.update(0.016);
  g.space.tmpV.set(0, 0, 0);
  g.space.stationGroup.getWorldPosition(g.space.tmpV);
  g.flight.pos.set(g.space.tmpV.x - 30, g.space.tmpV.y - 5, g.space.tmpV.z - 20);
  g.space.update(0.016);
  g.input.pressedSet.add('KeyE');
  g.input.pressedAge.set('KeyE', g.input.age);
  g.flight.update(1 / 60);
});
R.questDock = await ev(() => ({ step: window.game.quests.currentStep.id, docked: window.game.docked }));
await ev(() => {
  const g = window.game;
  g.ui.onStationTab('crew');
  document.querySelector('#station-body [data-npc="kaela"]').click();
});
R.questNpc = await ev(() => window.game.quests.currentStep.id);
// 购船：引擎 Lv1/Lv2 + 护盾 Lv1 + 大船
await ev(() => {
  const g = window.game;
  g.inventory.addItem('credits', 5000);
  g.handleStationAction('upgrade', 'engine1', 1);
  g.handleStationAction('upgrade', 'engine2', 1);
  g.handleStationAction('upgrade', 'shield1', 1);
  g.handleStationAction('upgrade', 'bigship', 1);
});
R.questBigShip = await ev(() => {
  const g = window.game;
  return {
    step: g.quests.currentStep.id,
    bigship: g.shipUpgrades.bigship,
    engine: g.shipUpgrades.engine,
    shield: g.shipUpgrades.shield,
    shipScale: +g.ship.group.scale.x.toFixed(2),
    pulseSpeed: g.flight.maxSpeed,
  };
});

// 3. 跃迁门解锁 + 罗盘
await ev(() => { const g = window.game; g.undockStation(); g.space.setTarget(200); });
R.gatewayTarget = await ev(() => {
  const g = window.game;
  const comp = g.space.compass();
  return { targetId: g.space.targetId, compassDist: comp ? comp.dist : null };
});

// 4. 飞往跃迁门 → 自动跃迁 → 比邻星系
R.warp = await ev(() => {
  const g = window.game;
  g.space.gatewayWorldPos(g.space.tmpV);
  g.flight.pos.set(g.space.tmpV.x - 60, g.space.tmpV.y - 20, g.space.tmpV.z - 40);
  g.space.update(0.016);
  const near = g.gatewayNear;
  const warping = g.space.warping;
  let guard = 0;
  while (g.space.warping && guard++ < 200) g.space.update(1 / 60);
  return {
    near, warping,
    galaxyId: g.space.galaxyId,
    planetCount: g.space.galaxy.length,
    planetName: g.planetName,
    current: g.space.current,
    surface: g.world.gen.terrain.surface,
    questStep: g.quests.currentStep.id,
    allDone: g.quests.allDone,
    visitedProxima: [...g.space.visitedProxima],
  };
});

// 5. 比邻星系星图：3 行星 + 返回太阳系跃迁门（无空间站条目）
R.proximaStarMap = await ev(() => {
  const g = window.game;
  g.openStarMap();
  const text = document.getElementById('starmap-list').textContent;
  const backRow = document.querySelector('#starmap-list [data-id="201"]');
  const backLocked = backRow ? backRow.textContent.includes('需大型飞船') : null;
  g.closeStarMap();
  return {
    hasProximaB: text.includes('比邻星 b'),
    hasProximaD: text.includes('比邻星 d'),
    hasBackGateway: !!backRow,
    backLocked,
    noStationRow: !text.includes('地球轨道空间站'),
  };
});
await page.screenshot({ path: `${outDir}/proxima_starmap.png` });

// 6. 比邻星系太空截图（手动相机俯瞰比邻星 b）
await ev(() => {
  const g = window.game;
  g.running = false;
  g.space.planetGroup.position.set(8.5, g.space.enteredAt.groundY - 246, 8.5);
  g.sky.update(0.016, { x: 8.5, y: g.space.enteredAt.groundY + 20, z: 8.5 });
  const cam = g.camera;
  cam.position.set(8.5, g.space.enteredAt.groundY + 26, 8.5 + 230);
  cam.lookAt(8.5, g.space.enteredAt.groundY - 320, 8.5);
  g.renderer.render(g.scene, g.camera);
});
await sleep(400);
await page.screenshot({ path: `${outDir}/proxima_space.png` });
await ev(() => { const g = window.game; g.running = true; });

// 7. 跃迁门视觉截图（太阳系门，手动相机）
await ev(() => {
  const g = window.game;
  g.running = false;
  g.space.gatewayWorldPos(g.space.tmpV);
  const cam = g.camera;
  cam.position.set(g.space.tmpV.x - 60, g.space.tmpV.y + 20, g.space.tmpV.z - 80);
  cam.lookAt(g.space.tmpV.x, g.space.tmpV.y, g.space.tmpV.z);
  g.renderer.render(g.scene, g.camera);
});
await sleep(400);
await page.screenshot({ path: `${outDir}/gateway.png` });
await ev(() => { const g = window.game; g.running = true; });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
