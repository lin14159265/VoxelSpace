import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
const t0 = Date.now();
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 90000 });
const initMs = Date.now() - t0;
console.log('init ms:', initMs);
await page.evaluate(() => {
  const g = window.game;
  g.ui.showMenu(false);
  g.ui.setHudVisible(true);
  g.running = true; g.paused = false; g.input.locked = true;
});
await page.waitForTimeout(2000);
// 测 FPS：两秒内渲染帧数
const fps = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  const t0 = performance.now();
  function tick() {
    frames++;
    if (performance.now() - t0 >= 2000) resolve(Math.round(frames / 2));
    else requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}));
console.log('fps (menu start):', fps);
// 挖矿压力：按住左键持续
await page.evaluate(() => { window.game.player.pitch = 0.7; });
await page.mouse.move(640, 360);
await page.mouse.down({ button: 'left' });
await page.waitForTimeout(1500);
const fps2 = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  const t0 = performance.now();
  function tick() {
    frames++;
    if (performance.now() - t0 >= 2000) resolve(Math.round(frames / 2));
    else requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}));
await page.mouse.up({ button: 'left' });
console.log('fps (mining):', fps2);
const stats = await page.evaluate(() => ({
  chunks: window.game.world.chunks.size,
  dirty: window.game.world.dirty.size,
  renderer: window.game.renderer.info.render,
}));
console.log(JSON.stringify(stats));
await browser.close();
