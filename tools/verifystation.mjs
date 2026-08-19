// 本轮验证：空间站——太空实体/星图标记/停靠/交易/订单/船坞升级
// 运行：node tools/verifystation.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots31';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
console.log('game ready, seed=', SEED);

const R = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);

await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.input.locked = true;
  g.setPaused(false);
});
await sleep(400);

// 1. 星图：地球轨道显示空间站条目，可设目标
R.starMap = await ev(() => {
  const g = window.game;
  g.openStarMap();
  const text = document.getElementById('starmap-list').textContent;
  const row = document.querySelector('#starmap-list [data-id="100"]');
  return { hasStationRow: text.includes('地球轨道空间站'), rowExists: !!row };
});
await ev(() => {
  const btn = document.querySelector('#starmap-list [data-id="100"] .craft-btn');
  btn.click();
});
R.starMap.targetAfterClick = await ev(() => window.game.space.targetId);
await page.screenshot({ path: `${outDir}/starmap.png` });

// 2. 进入太空：空间站实体存在 + 罗盘指向
R.space = await ev(() => {
  const g = window.game;
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  g.space.update(0.016);
  const st = g.space.stationGroup;
  let worldPos = null, compass = null;
  if (st) {
    const v = new (st.position.constructor)(0, 0, 0);
    st.getWorldPosition(v);
    worldPos = { x: +v.x.toFixed(0), y: +v.y.toFixed(0), z: +v.z.toFixed(0) };
  }
  const comp = g.space.compass();
  if (comp) compass = { angle: +comp.angle.toFixed(2), dist: comp.dist };
  return { stationExists: !!st, worldPos, compass, targetId: g.space.targetId };
});

// 3. 靠近空间站 → stationNear → 按 E 停靠 → 面板打开
R.dock = await ev(() => {
  const g = window.game;
  const st = g.space.stationGroup;
  const v = new (st.position.constructor)(0, 0, 0);
  st.getWorldPosition(v);
  g.flight.pos.set(v.x - 30, v.y - 5, v.z - 20);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.update(0.016);
  const near = g.stationNear;
  g.input.pressedSet.add('KeyE');
  g.input.pressedAge.set('KeyE', g.input.age);
  g.flight.update(1 / 60);
  return {
    near, docked: g.docked,
    panelVisible: g.ui.stationVisible(),
    inMenu: g.inMenu,
    credits: +document.getElementById('station-credits').textContent,
    rows: document.querySelectorAll('#station-body .station-row').length,
  };
});
await sleep(200);
await page.screenshot({ path: `${outDir}/station_panel.png` });

// 4. 交易：出售铁氧体 → 信用点；购买金属镀层
R.trade = await ev(() => {
  const g = window.game;
  g.inventory.addItem('ferrite_dust', 20);
  g.handleStationAction('sellAll', 'ferrite_dust', 1);
  const creditsAfterSell = g.inventory.countOf('credits');
  g.handleStationAction('buy1', 'metal_plating', 1);
  const boughtOk = g.inventory.countOf('metal_plating') >= 1;
  const creditsAfterBuy = g.inventory.countOf('credits');
  return { creditsAfterSell, boughtOk, creditsAfterBuy, expectedSell: 20 * 3 };
});

// 5. 订单：交付铁氧体订单
R.order = await ev(() => {
  const g = window.game;
  const before = g.inventory.countOf('credits');
  g.inventory.addItem('ferrite_dust', 15);
  g.handleStationAction('order', 'order1', 1);
  const after = g.inventory.countOf('credits');
  return { gained: after - before, delivered: after - before === 60 };
});

// 6. 船坞：引擎 Lv1 → 最大速度 40；护盾 Lv1 → 护盾上限 150
R.upgrade = await ev(() => {
  const g = window.game;
  g.inventory.addItem('credits', 1000);
  g.handleStationAction('upgrade', 'engine1', 1);
  g.handleStationAction('upgrade', 'shield1', 1);
  return {
    engine: g.shipUpgrades.engine,
    shield: g.shipUpgrades.shield,
    maxSpeed: g.flight.maxSpeed,
    shieldMax: g.player.shieldMax,
  };
});

// 7. Esc 离站
R.undock = await ev(() => {
  const g = window.game;
  g.input.pressedSet.add('Escape');
  g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  return { docked: g.docked, panelVisible: g.ui.stationVisible(), inMenu: g.inMenu };
});

// 8. 空间站截图（手动相机，冻结循环）
await ev(() => {
  const g = window.game;
  g.running = false;
  g.space.planetGroup.position.set(8.5, g.space.enteredAt.groundY - 246, 8.5);
  g.sky.update(0.016, { x: 8.5, y: g.space.enteredAt.groundY + 20, z: 8.5 });
  const st = g.space.stationGroup;
  g.space.tmpV.set(0, 0, 0);
  st.getWorldPosition(g.space.tmpV);
  const v = g.space.tmpV;
  const cam = g.camera;
  cam.position.set(v.x - 70, v.y + 20, v.z + 60);
  cam.lookAt(v.x, v.y, v.z);
});
await sleep(500);
await page.screenshot({ path: `${outDir}/station_view.png` });
await ev(() => { const g = window.game; g.space.forceExit(); g.flight.piloting = false; g.running = true; });
R.atmoSpeed = await ev(() => ({ maxSpeed: window.game.flight.maxSpeed, spaceMode: window.game.flight.spaceMode }));

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
