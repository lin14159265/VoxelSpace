// 飞船残骸第一印象截图：出生视角 + 近距离两个角度（白天）
// 运行：node tools/shipview.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots38';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  g.world.time = 0.28; // 上午，光线充足
});
await new Promise((r) => setTimeout(r, 2400));

// 1. 出生视角（默认朝向，即朝飞船方向；等待烟柱累积）
await page.screenshot({ path: `${outDir}/ship_spawn.png` });

// 2. 距离 14m 平视
await ev(() => {
  const g = window.game;
  const s = g.ship.worldPos;
  g.player.pos.set(s.x - 14, g.world.getGroundY(s.x - 14, s.z) + 1.62, s.z);
  const dx = s.x - g.player.pos.x, dz = s.z - g.player.pos.z;
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = -0.02;
  g.player.vel.set(0, 0, 0);
});
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${outDir}/ship_14m.png` });

// 3. 距离 7m，稍侧角度（看到机翼/机身）
await ev(() => {
  const g = window.game;
  const s = g.ship.worldPos;
  g.player.pos.set(s.x - 5.5, g.world.getGroundY(s.x - 5.5, s.z + 6) + 1.62, s.z + 6);
  const dx = s.x - g.player.pos.x, dz = s.z - g.player.pos.z;
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = -0.05;
  g.player.vel.set(0, 0, 0);
});
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${outDir}/ship_7m.png` });

console.log('errors:', JSON.stringify(errors));
await browser.close();
