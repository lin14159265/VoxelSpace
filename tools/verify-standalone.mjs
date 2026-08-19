// 验证单文件自包含版 VOXELSPACE.html 可脱离服务器、以 file:// 直开游玩。
// 用法: node tools/verify-standalone.mjs [VOXELSPACE.html 路径]
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.join(here, '..', 'VOXELSPACE.html');
const targetAbs = path.resolve(target);
const pageUrl = pathToFileURL(targetAbs).href;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

console.log('loading (file://):', pageUrl);
await page.goto(pageUrl, { waitUntil: 'load' });
await page.waitForTimeout(1200);

const menuShown = await page.evaluate(() => {
  const m = document.getElementById('menu');
  return !!(m && !m.classList.contains('hidden'));
});
console.log('menu visible after load:', menuShown);
await page.screenshot({ path: path.join(here, '..', 'shots-standalone', 'menu.png') });

console.log('waiting for world init (window.game.player)...');
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 120000 });
console.log('world init complete');

await page.evaluate(() => {
  const g = window.game;
  g.ui.showMenu(false);
  g.ui.setHudVisible(true);
  g.running = true;
  g.paused = false;
  g.input.locked = true;
});
await page.waitForTimeout(800);
console.log('in-game state forced; chunkCount =', await page.evaluate(() => !!window.game.world && window.game.world.chunks.size));

// 望向飞船
await page.evaluate(() => {
  const g = window.game;
  const sp = g.ship.worldPos;
  g.player.pos.set(sp.x - 7, sp.y + 2.5, sp.z);
  const pp = g.player.pos;
  const dx = sp.x - pp.x, dz = sp.z - pp.z, dy = sp.y + 1.5 - (pp.y + 1.62);
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = Math.atan2(-dy, Math.hypot(dx, dz));
});
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(here, '..', 'shots-standalone', 'game-ship.png') });

console.log('total errors:', errors.length);
for (const e of errors) console.log(' -', e);
await browser.close();
process.exitCode = errors.length ? 2 : 0;
