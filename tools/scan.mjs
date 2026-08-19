// 扫描脉冲验证：C 键触发 → 圆环 + 资源标记数量
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const outDir = 'shots18';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

const res = await page.evaluate(async () => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(true);
  g.running = true; g.paused = false; g.input.locked = true;
  g.player.flyMode = true;
  // 站在坠毁点旁（资源丰富区），面向资源方向
  g.player.pos.set(g.world.crashX - 6, g.world.getGroundY(g.world.crashX - 6, g.world.crashZ) + 2, g.world.crashZ);
  g.player.yaw = Math.PI / 2; // 面朝 -x（背离飞船方向，资源散布区）
  g.player.pitch = 0.42;      // 俯视地面资源
  await new Promise((r) => setTimeout(r, 500));
  g.scanning.trigger();
  await new Promise((r) => setTimeout(r, 300));
  const out = {
    rings: g.scanning.rings.length,
    markers: g.scanning.markers.length,
    cooldown: g.scanning.cooldown > 0,
  };
  return out;
});
console.log(JSON.stringify(res));
await page.screenshot({ path: outDir + '/scan-pulse.png' });
await page.waitForTimeout(1500);
await page.screenshot({ path: outDir + '/scan-markers.png' });

if (errors.length) {
  console.log('ERRORS:');
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('no page errors');
}
await browser.close();
