// 飞船驾驶流程验证：登船 → 起飞 → 绕圈巡航 → 降落 → 离船
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const outDir = 'shots14';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

// 准备：修好飞船 + 推进任务到 launch 步骤
await page.evaluate(async () => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(true);
  g.running = true; g.paused = false; g.input.locked = true;
  g.ship.repair('pulse');
  g.ship.repair('thruster');
  g.quests.onInteractShip();
  for (let i = 0; i < 15; i++) g.quests.onMine(3, 'stone', 1);
  g.quests.onCraft('multitool', 1);
  for (let i = 0; i < 12; i++) g.quests.onPlace(7);
  g.quests.onMine(12, 'di_hydrogen', 2);
  g.quests.onMine(12, 'di_hydrogen', 2);
  g.quests.onMine(8, 'ferrite_dust', 1);
  g.quests.onMine(8, 'ferrite_dust', 3);
  g.quests.onCraft('metal_plating', 2);
  g.quests.onShipRepair('pulse');
  g.quests.onShipRepair('thruster');
  g.player.pos.set(g.ship.worldPos.x - 3, g.ship.worldPos.y + 1.8, g.ship.worldPos.z);
  g.player.flyMode = true;
  await new Promise((r) => setTimeout(r, 300));
});

// 登船
await page.evaluate(async () => {
  const g = window.game;
  g.onInteract();
  await new Promise((r) => setTimeout(r, 500));
});
await page.screenshot({ path: outDir + '/cockpit.png' });

// 起飞：空格上升 + W 前进
await page.evaluate(async () => {
  const g = window.game;
  g.input.down.add('Space');
  await new Promise((r) => setTimeout(r, 1000));
  g.input.down.add('KeyW');
  await new Promise((r) => setTimeout(r, 2000));
  g.input.down.delete('Space');
});
const flying = await page.evaluate(() => {
  const g = window.game;
  return {
    alt: (g.flight.pos.y - g.flight.groundHeight()).toFixed(1),
    speed: g.flight.speed.toFixed(1),
    launched: g.flight.launched,
    quest: g.quests.currentStep.id,
  };
});
console.log('flying:', JSON.stringify(flying));
await page.screenshot({ path: outDir + '/flying.png' });

// 绕圈巡航（转动方向）
await page.evaluate(async () => {
  const g = window.game;
  for (let i = 0; i < 10; i++) {
    g.flight.yaw += 0.45;
    await new Promise((r) => setTimeout(r, 250));
  }
});
await page.screenshot({ path: outDir + '/cruise.png' });

// 降落：松油门 + S 刹车停稳 + Shift 下降直到触地
const landed = await page.evaluate(async () => {
  const g = window.game;
  g.input.down.delete('KeyW');
  g.input.down.add('KeyS'); // 刹车
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (g.flight.speed < 1) break;
  }
  g.input.down.delete('KeyS');
  g.input.down.add('ShiftLeft'); // 下降
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (g.flight.onGround && g.flight.speed < 1) break;
  }
  g.input.down.delete('ShiftLeft');
  await new Promise((r) => setTimeout(r, 400));
  return {
    onGround: g.flight.onGround,
    alt: (g.flight.pos.y - g.flight.groundHeight()).toFixed(1),
    speed: g.flight.speed.toFixed(1),
  };
});
console.log('landed:', JSON.stringify(landed));
await page.screenshot({ path: outDir + '/landed.png' });

// 离船
const exited = await page.evaluate(async () => {
  const g = window.game;
  g.flight.exit();
  await new Promise((r) => setTimeout(r, 300));
  return {
    piloting: g.flight.piloting,
    playerActive: g.player.active,
    fhHidden: document.getElementById('flight-hud').classList.contains('hidden'),
    playerY: Math.round(g.player.pos.y),
  };
});
console.log('exit:', JSON.stringify(exited));
await page.screenshot({ path: outDir + '/after-exit.png' });

if (errors.length) {
  console.log('ERRORS:');
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('no page errors');
}
await browser.close();

