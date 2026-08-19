// 本轮验证：飞船视角(座舱/追尾) + 转向物理(惯性/限幅) + 修复提示 + 任务同步
// 运行：node tools/verifyflight.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '555666777';
const outDir = 'shots28';
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

// 1. 修复提示：未修复 vs 已修复
R.hint = await ev(() => {
  const g = window.game;
  const p = g.player;
  p.pos.set(g.world.crashX - 6, g.world.getGroundY(g.world.crashX - 6, g.world.crashZ) + 2.0, g.world.crashZ);
  g.loop(); // 触发 HUD 刷新逻辑（%12 帧可能未到 → 手动执行低层逻辑）
  // 直接读取任务步骤对应的提示逻辑：未修复
  const step = g.quests.currentStep.id;
  const unrepairedStep = step === 'checkShip' || step === 'repairPulse' || step === 'repairGlass' || step === 'fuelLaunch';
  const before = unrepairedStep ? (step === 'checkShip' ? '检查飞船残骸' : '打开维修面板') : '无提示';
  // 全修好
  g.ship.pulseOk = true; g.ship.glassOk = true; g.ship.thrusterOk = true;
  g.quests.syncShip(g.ship);
  g.frame = 11; g.loop(); // 保证 HUD 块执行
  const hintText = document.getElementById('interact-hint').textContent;
  return { before, hintText, showsBoard: hintText.includes('登上飞船'), questStep: g.quests.currentStep.id };
});
await page.screenshot({ path: `${outDir}/repaired_hint.png` });

// 2. 任务同步：创造模式乱序修复
R.questSync = await ev(() => {
  const g = window.game;
  const q = g.quests;
  // 场景 A：停在 repairGlass（索引 8），飞船全修好 → 同步到 launch
  q.currentIndex = 8;
  q.completedIds = new Set(['checkShip', 'gather', 'craftTool', 'shelter', 'dihy', 'ferrite', 'craftPlating', 'repairPulse']);
  q.syncShip(g.ship);
  const syncA = q.currentStep.id;
  // 场景 B：停在 craftPlating（材料步骤，索引 6），飞船全修好 → 维修步骤标记完成、当前步骤保留
  q.currentIndex = 6;
  q.completedIds = new Set(['checkShip', 'gather', 'craftTool', 'shelter', 'dihy', 'ferrite']);
  q.data.repairPulse = 0; q.data.repairGlass = 0; q.data.fuelLaunch = 0;
  q.syncShip(g.ship);
  const stepB = q.currentStep.id;
  const trioDone = q.completedIds.has('repairPulse') && q.completedIds.has('repairGlass') && q.completedIds.has('fuelLaunch');
  // 完成材料步骤后自动跳过维修步骤直达起飞
  q.onCraft('metal_plating', 2);
  const afterCraft = q.currentStep.id;
  return { syncA, stepB, trioDone, afterCraft };
});

// 3. 登船 + 视角切换
await ev(() => {
  const g = window.game;
  g.player.pos.set(g.world.crashX - 4, g.world.getGroundY(g.world.crashX - 4, g.world.crashZ) + 2.0, g.world.crashZ);
  g.flight.enter();
});
await sleep(300);
R.cockpitCam = await ev(() => {
  const g = window.game;
  const cam = g.camera;
  const ship = g.ship.worldPos;
  return {
    mode: g.flight.cameraMode,
    camY: cam.position.y, shipY: ship.y,
    aboveHull: cam.position.y > ship.y + 2.5,
  };
});
await page.screenshot({ path: `${outDir}/cockpit.png` });

// V 切换第三人称
await ev(() => { const g = window.game; g.input.pressedSet.add('KeyV'); g.input.pressedAge.set('KeyV', g.input.age); g.flight.update(1 / 60); });
await sleep(300);
R.chaseCam = await ev(() => {
  const g = window.game;
  const cam = g.camera;
  const ship = g.ship.worldPos;
  const dist = Math.hypot(cam.position.x - ship.x, cam.position.y - ship.y, cam.position.z - ship.z);
  return { mode: g.flight.cameraMode, distBehind: dist, behindShip: dist > 6 };
});
// 追尾相机多跑几帧平滑
await ev(() => { const g = window.game; for (let i = 0; i < 60; i++) g.flight.update(1 / 60); });
await page.screenshot({ path: `${outDir}/chase.png` });

// 4. 转向物理：大鼠标增量 → 角速度限幅 + 惯性（不会瞬间掉头）；高速转向更慢
R.turnPhysics = await ev(() => {
  const g = window.game;
  const f = g.flight;
  f.cameraMode = 'cockpit';
  const yaw0 = f.yaw;
  g.input.mouseDX = 1200; // 模拟一次巨大的鼠标甩动
  f.update(1 / 60);
  const yaw1 = f.yaw;
  const rate1 = f.yawRate;
  g.input.mouseDX = 0;
  const maxYaw = 0.85 * (g.settings.sens || 1);
  // 稳态对比：相同鼠标速度(200px/s)，低速 vs 高速
  const settle = (speed, pxPerFrame) => {
    f.speed = speed;
    f.yawRate = 0; f.pitchRate = 0; f.mouseVelX = 0; f.mouseVelY = 0; f.yaw = 0;
    for (let i = 0; i < 150; i++) {
      f.speed = speed; // 每步钉住速度（油门/碰撞会改变它，此处只测转向系数）
      g.input.mouseDX = pxPerFrame;
      f.update(1 / 60);
    }
    return Math.abs(f.yawRate);
  };
  const rateLow = settle(0, 200 / 60);
  const rateHigh = settle(f.maxSpeed, 200 / 60);
  f.speed = 0; f.yawRate = 0; f.mouseVelX = 0; f.mouseVelY = 0; f.yaw = 0;
  return {
    sens: g.settings.sens,
    yawDelta: yaw1 - yaw0,
    rateAfterStep: rate1,
    rateLimited: Math.abs(rate1) <= maxYaw + 1e-6,
    smoothNotInstant: Math.abs(yaw1 - yaw0) < 0.3,
    rateLow, rateHigh,
    highSpeedSlower: rateHigh < rateLow,
    lowSpeedCapped: Math.abs(rateLow) <= maxYaw + 1e-6,
  };
});

// 5. 视角切回座舱再离船
await ev(() => { const g = window.game; g.flight.cameraMode = 'cockpit'; g.flight.speed = 0; g.flight.onGround = true; g.flight.exit(); });
await sleep(200);
R.afterExit = await ev(() => ({
  piloting: window.game.flight.piloting,
  playerActive: window.game.player.active,
  camY: +window.game.camera.position.y.toFixed(1),
}));

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
