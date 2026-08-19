// 太空旅程全流程验证：起飞 → 进入太空 → 星图设目标 → 脉冲跃迁 → 新星球降落
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const outDir = 'shots16';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

// 准备：修复飞船 + 推进任务到 launch
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
  g.onInteract();
  await new Promise((r) => setTimeout(r, 500));
});

// 爬升进入太空（空格按住，直到太空模式或超时 ~24s）
await page.evaluate(async () => {
  const g = window.game;
  g.input.down.add('Space');
  g.input.down.add('KeyW');
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (g.space.active) break;
  }
  g.input.down.delete('Space');
});
const inSpace = await page.evaluate(() => {
  const g = window.game;
  return {
    active: g.space.active,
    alt: (g.flight.pos.y - g.flight.groundHeight()).toFixed(0),
    quest: g.quests.currentStep.id,
    terrainHidden: !(g.world.getChunk(Math.floor(g.flight.pos.x / 16), Math.floor(g.flight.pos.z / 16), false)?.meshOpaque?.visible),
    homePlanetVisible: g.space.planetGroup.visible,
    markers: g.space.neighborMeshes.length,
    skySpace: g.sky.spaceMode,
  };
});
console.log('space:', JSON.stringify(inSpace));
await page.screenshot({ path: outDir + '/space.png' });

// 打开星图 → 设定目标
await page.evaluate(async () => {
  const g = window.game;
  g.openStarMap();
  await new Promise((r) => setTimeout(r, 300));
});
await page.screenshot({ path: outDir + '/starmap.png' });
const mapInfo = await page.evaluate(() => ({
  visible: window.game.ui.starMapVisible(),
  rows: document.querySelectorAll('#starmap-list .starmap-row').length,
  btns: document.querySelectorAll('#starmap-list .craft-btn:not(.disabled)').length,
}));
console.log('starmap:', JSON.stringify(mapInfo));

await page.evaluate(async () => {
  const g = window.game;
  g.ui.onSelectTarget(g.space.galaxy.find((p) => p.id !== g.space.current).id);
  await new Promise((r) => setTimeout(r, 300));
});
const target = await page.evaluate(() => ({
  targetId: window.game.space.targetId,
  compassVisible: !document.getElementById('compass').classList.contains('hidden'),
  locked: window.game.input.locked,
}));
console.log('target:', JSON.stringify(target));

// 脉冲飞向目标（W 按住，转向对准目标方向）
await page.evaluate(async () => {
  const g = window.game;
  g.input.down.add('KeyW');
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const comp = g.space.compass();
    if (!comp) break;
    g.flight.yaw -= Math.max(-0.05, Math.min(0.05, comp.angle * 0.3));
    if (g.space.warping || g.space.current !== 0) break;
  }
  g.input.down.delete('KeyW');
});
const afterWarp = await page.evaluate(() => {
  const g = window.game;
  return {
    current: g.space.current,
    warping: g.space.warping,
    seed: g.seed,
    planetName: g.planetName,
    spaceActive: g.space.active,
    shipAlt: (g.flight.pos.y - g.flight.groundHeight()).toFixed(0),
  };
});
console.log('afterWarp:', JSON.stringify(afterWarp));
await page.waitForTimeout(800);
await page.screenshot({ path: outDir + '/newplanet-space.png' });

// 降落到新行星
await page.evaluate(async () => {
  const g = window.game;
  g.input.down.add('ShiftLeft');
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (!g.space.active) break;
  }
  g.input.down.delete('ShiftLeft');
  await new Promise((r) => setTimeout(r, 2000));
});
const landed = await page.evaluate(() => {
  const g = window.game;
  return {
    spaceActive: g.space.active,
    quest: g.quests.currentStep.id,
    questDone: [...g.quests.completedIds],
    onGround: g.flight.onGround,
    terrainVisible: g.world.getChunk(Math.floor(g.flight.pos.x / 16), Math.floor(g.flight.pos.z / 16), false)?.meshOpaque?.visible,
    grassHue: g.world.seed === g.seed,
  };
});
console.log('landed:', JSON.stringify(landed));
await page.screenshot({ path: outDir + '/newplanet-land.png' });

if (errors.length) {
  console.log('ERRORS:');
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('no page errors');
}
await browser.close();

