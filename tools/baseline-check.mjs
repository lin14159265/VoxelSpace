// 基线对比：服务器版（源码 ES module）在相同无头 SwiftShader 环境下的报错情况
// 用法: node tools/baseline-check.mjs <url>
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:8090/';
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
console.log('loading:', url);
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 120000 });
console.log('init complete');
await page.evaluate(() => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(true); g.running = true; g.paused = false; g.input.locked = true;
});
await page.waitForTimeout(1200);
console.log('total errors:', errors.length);
for (const e of errors) console.log(' -', e);
await browser.close();
process.exitCode = errors.length ? 2 : 0;
