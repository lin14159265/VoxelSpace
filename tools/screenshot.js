// 截图验证脚本（开发辅助）：用系统 Chrome 打开游戏并截图
// 用法: node tools/screenshot.js [输出目录] [等待毫秒]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] || 'shots';
const waitMs = Number(process.argv[3] || 4000);
const url = process.env.GAME_URL || 'http://localhost:8080/';

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Math.min(waitMs, 1500));
await page.screenshot({ path: path.join(outDir, 'menu.png') });

// 等待初始化完成（game.player 出现）
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
console.log('init complete');
await page.waitForTimeout(400);

// headless 下指针锁定不可用：直接驱动 Game 进入游戏态
await page.evaluate(() => {
  const g = window.game;
  g.ui.showMenu(false);
  g.ui.setHudVisible(true);
  g.running = true;
  g.paused = false;
  g.input.locked = true;
});
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, 'game.png') });

// 望向飞船（自动对准，适配任意种子）
await page.evaluate(() => {
  const g = window.game;
  const sp = g.ship.worldPos;
  g.player.pos.set(sp.x - 7, sp.y + 2.5, sp.z);
  const pp = g.player.pos;
  const dx = sp.x - pp.x, dz = sp.z - pp.z, dy = sp.y + 1.5 - (pp.y + 1.62);
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = Math.atan2(-dy, Math.hypot(dx, dz));
});
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(outDir, 'ship.png') });

// 低头挖掘：视线向下，按住左键
await page.evaluate(() => {
  const g = window.game;
  g.player.pitch = 0.75;
});
await page.mouse.move(640, 360);
await page.mouse.down({ button: 'left' });
await page.waitForTimeout(1200);
await page.mouse.up({ button: 'left' });
await page.screenshot({ path: path.join(outDir, 'mining.png') });

// 夜晚视角：时间快进到午夜（DAY_LENGTH=480，t01=0.75 为午夜）
await page.evaluate(() => { window.game.sky.timeSec = 360; });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, 'night.png') });

console.log('shots saved to', outDir);
if (errors.length) {
  console.log('ERRORS:');
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('no page errors');
}
await browser.close();
