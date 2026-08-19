import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const ctx = await browser.newContext();
const page1 = await ctx.newPage();
await page1.goto('http://localhost:8080/', { waitUntil: 'load' });
await page1.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
// 写存档
const written = await page1.evaluate(async () => {
  const { saveGame } = await import('/src/systems/save.js');
  window.game.inventory.addItem('stone', 7);
  return saveGame(window.game);
});
console.log('saved:', written);

// 同会话新页面 → 应读取存档并显示继续按钮
const page2 = await ctx.newPage();
await page2.goto('http://localhost:8080/', { waitUntil: 'load' });
await page2.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
const state = await page2.evaluate(() => ({
  continueHidden: document.getElementById('btn-continue').classList.contains('hidden'),
  newHidden: document.getElementById('btn-new').classList.contains('hidden'),
  startHidden: document.getElementById('btn-start').classList.contains('hidden'),
  stone: window.game.inventory.countOf('stone'),
  seed: window.game.seed,
}));
console.log(JSON.stringify(state));

// 点继续 → 应直接进入游戏
await page2.click('#btn-continue');
await page2.waitForTimeout(600);
const playing = await page2.evaluate(() => ({
  menuHidden: document.getElementById('menu').classList.contains('hidden'),
  hudVisible: !document.getElementById('hud').classList.contains('hidden'),
  running: window.game.running,
  stone: window.game.inventory.countOf('stone'),
}));
console.log(JSON.stringify(playing));
await browser.close();
