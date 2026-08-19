import { chromium } from 'playwright-core';
import fs from 'node:fs';
const outDir = 'shots24';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

const state = await page.evaluate(async () => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(true);
  g.running = true; g.paused = false; g.input.locked = true;
  g.quests.onInteractShip();
  for (let i = 0; i < 15; i++) g.quests.onMine(3, 'stone', 1);
  g.quests.onCraft('multitool', 1);
  for (let i = 0; i < 12; i++) g.quests.onPlace(7);
  g.sky.timeSec = 360;
  await new Promise((r) => setTimeout(r, 500));
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (g.mobs.mobs.length > 0) break;
  }
  if (g.mobs.mobs.length > 0) {
    const mob = g.mobs.mobs[0];
    // 站在生物旁 6 格，俯视
    g.player.flyMode = true;
    g.player.pos.set(mob.pos.x + 4, mob.pos.y + 3, mob.pos.z + 4);
    g.player.yaw = Math.atan2(-(mob.pos.x - g.player.pos.x), -(mob.pos.z - g.player.pos.z));
    g.player.pitch = -0.5;
    await new Promise((r) => setTimeout(r, 400));
  }
  return { mobs: g.mobs.mobs.length, alive: g.mobs.mobs.filter((m) => m.alive).length };
});
console.log(JSON.stringify(state));
await page.screenshot({ path: outDir + '/mob-alive.png' });
await browser.close();
