// 中期体验审计：空间站四页签、9 配方合成表、星图、暂停菜单、设置面板截图 + 状态导出
// 运行：node tools/uxaudit2.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots50';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.addInitScript(() => localStorage.clear());
await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 快进到中期：任务推进 + 修船 + 进太空 + 停靠
await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  const q = g.quests;
  q.completedIds = new Set(['checkShip', 'gather', 'craftTool', 'shelter', 'dihy', 'ferrite', 'craftPlating', 'repairPulse', 'repairGlass', 'fuelLaunch', 'launch', 'space']);
  q.currentIndex = 12;
  g.ship.repair('pulse'); g.ship.repair('glass'); g.ship.repair('thruster');
  g.inventory.addItem('credits', 240);
  g.inventory.addItem('ferrite_dust', 40);
  g.inventory.addItem('sodium', 20);
  g.inventory.addItem('gold_ore', 5);
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.space.enterSpace();
  g.space.update(0.016);
  g.space.tmpV.set(0, 0, 0);
  g.space.stationGroup.getWorldPosition(g.space.tmpV);
  g.flight.pos.set(g.space.tmpV.x - 30, g.space.tmpV.y - 5, g.space.tmpV.z - 20);
  g.space.update(0.016);
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.flight.update(1 / 60);
});
await sleep(400);
const R = {};

// 空间站：四个页签
for (const tab of ['trade', 'orders', 'shipyard', 'crew']) {
  await ev((tab) => {
    const g = window.game;
    g.running = true; g.input.locked = true; g.wantLock = true; g.paused = false; g.inMenu = true;
    g.ui.onStationTab(tab);
  }, tab);
  await sleep(250);
  await page.screenshot({ path: `${outDir}/station_${tab}.png` });
}
R.station = await ev(() => {
  const g = window.game;
  const body = document.getElementById('station-body').textContent;
  return {
    credits: document.getElementById('station-credits').textContent,
    bodyLen: body.length,
    docked: g.docked,
  };
});

// 背包（9 配方）
await ev(() => { const g = window.game; g.undockStation(); });
await ev(() => {
  const g = window.game;
  g.running = true; g.input.locked = true; g.wantLock = true; g.paused = false; g.inMenu = false;
  g.openBackpack();
});
await sleep(300);
await page.screenshot({ path: `${outDir}/backpack9.png` });
R.backpack = await ev(() => ({
  recipes: document.querySelectorAll('#craft-list .craft-item').length,
  names: Array.from(document.querySelectorAll('#craft-list .craft-name')).map((e) => e.textContent),
}));
await ev(() => { const g = window.game; g.closeBackpack(); });

// 暂停菜单
await ev(() => { const g = window.game; g.running = true; g.input.locked = true; g.wantLock = true; g.setPaused(true); });
await sleep(300);
await page.screenshot({ path: `${outDir}/pause.png` });
R.pause = await ev(() => {
  const btns = Array.from(document.querySelectorAll('#paused .pause-btns .btn')).map((b) => b.textContent);
  return { btns };
});
await ev(() => { const g = window.game; g.ui.showPaused(false); g.paused = false; });

// 星图
await ev(() => {
  const g = window.game;
  g.running = true; g.input.locked = true; g.wantLock = true; g.paused = false; g.inMenu = false;
  g.openStarMap();
});
await sleep(300);
await page.screenshot({ path: `${outDir}/starmap.png` });
R.starmap = await ev(() => ({
  rows: document.querySelectorAll('#starmap-list .starmap-item, #starmap-list .craft-item, #starmap-list > *').length,
}));
await ev(() => { const g = window.game; g.closeStarMap(); });

// 设置面板
await ev(() => { const g = window.game; g.running = true; g.input.locked = true; g.wantLock = true; g.openSettings(); });
await sleep(300);
await page.screenshot({ path: `${outDir}/settings.png` });
await ev(() => { const g = window.game; g.closeSettings(); });

console.log(JSON.stringify({ R, errors }, null, 2));
await browser.close();
