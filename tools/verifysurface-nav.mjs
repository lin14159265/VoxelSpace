// 本轮验证：行星地表导航层——航点数据 / 四级星图 / 步行罗盘 / 抵达自动完成
// 运行：node tools/verifysurface-nav.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-surfacenav';
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
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail) => { R[name] = { ok: !!ok, detail }; console.log(`${ok ? '  ✓' : '  ✗'} ${name}`, detail ?? ''); };
const allOk = () => Object.values(R).filter((v) => v && typeof v === 'object' && 'ok' in v).every((v) => v.ok);

await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.input.locked = true;
  g.setPaused(false);
});
await sleep(300);

// 1. 地表航点数据 + 探索迷雾：未发现的异常点不出现在地表图
R.waypoints = await ev(() => {
  const g = window.game;
  const visible = g.surfaceWaypoints();
  const all = g.surfaceWaypoints({ includeHidden: true });
  return {
    visibleTotal: visible.length,
    visibleAnomalies: visible.filter((w) => w.kind !== 'ship' && w.kind !== 'log').length,
    hiddenTotal: all.length,
    hiddenAnomalies: all.filter((w) => w.kind !== 'ship' && w.kind !== 'log').length,
    hasShip: visible.some((w) => w.kind === 'ship'),
    logs: visible.filter((w) => w.kind === 'log').length,
    allHavePos: all.every((w) => Number.isFinite(w.x) && Number.isFinite(w.z)),
  };
});
check('surface.waypointsData', R.waypoints.hasShip && R.waypoints.logs === 3 && R.waypoints.hiddenAnomalies > 10 && R.waypoints.allHavePos, JSON.stringify(R.waypoints));
check('surface.fogHidesUndiscovered', R.waypoints.visibleAnomalies < R.waypoints.hiddenAnomalies, `visible=${R.waypoints.visibleAnomalies} all=${R.waypoints.hiddenAnomalies}`);

// 2. 探索迷雾：靠近/大半径发现 → 航点进入地表图
R.discover = await ev(() => {
  const g = window.game;
  const before = g.surfaceWaypoints().length;
  const found = g.discoverSurfaceAround(500);
  const after = g.surfaceWaypoints().length;
  const saved = [...g.discoveredSurface].length;
  return { before, found, after, saved };
});
check('surface.discoverReveals', R.discover.found > 0 && R.discover.after > R.discover.before && R.discover.saved === R.discover.found, JSON.stringify(R.discover));

// 2. 四级星图：地表导航层打开（画布/面包屑/节点/列表）
R.map = await ev(() => {
  const g = window.game;
  g.openSurfaceMap();
  const view = g.buildStarMapView();
  const names = g.ui.starmapViewNodes.map((n) => n.name);
  const crumb = document.getElementById('starmap-breadcrumb').textContent;
  const rows = document.querySelectorAll('#starmap-list .starmap-row').length;
  return {
    level: g.starMapState.level, names: names.slice(0, 8), crumb, rows,
    surfaceName: view.surfaceName, hasPlayer: names.includes('当前位置'),
  };
});
check('map.surfaceLevelOpen', R.map.level === 'surface' && R.map.hasPlayer && R.map.rows >= R.waypoints.logs + 1, JSON.stringify(R.map));
check('map.surfaceBreadcrumb', String(R.map.crumb).includes('地球地表') && String(R.map.surfaceName).includes('地表'), `${R.map.crumb} | ${R.map.surfaceName}`);
await page.screenshot({ path: `${outDir}/surface-map.png` });

// 3. 设定地面目标：异常点 → 罗盘可见 + 目标名称
R.target = await ev(() => {
  const g = window.game;
  const wp = g.surfaceWaypoints().find((w) => w.kind !== 'ship' && w.kind !== 'log' && !w.collected);
  g.starMapSelectNode(wp.id);
  g.starMapAction('target', wp.id);
  // 跑一帧游戏循环刷新 HUD
  g.frame = 11;
  g.loop();
  const compassVisible = !document.getElementById('surface-compass').classList.contains('hidden');
  const label = document.getElementById('surface-compass-label').textContent;
  const dist = document.getElementById('surface-compass-dist').textContent;
  return { id: wp.id, name: wp.name, targetId: g.surfaceTarget && g.surfaceTarget.id, compassVisible, label, dist };
});
check('surface.setTarget', R.target.targetId === R.target.id && R.target.compassVisible && R.target.label === R.target.name, JSON.stringify(R.target));
check('surface.compassDistance', /\d+ m/.test(R.target.dist), R.target.dist);

// 4. 抵达目标：距离 <3m 自动完成并清除罗盘
R.arrive = await ev((arg) => {
  const g = window.game;
  const t = g.surfaceTarget;
  g.player.pos.set(t.x, g.world.getGroundY(t.x, t.z) + 2.2, t.z);
  g.player.updateCamera();
  g.frame = 11;
  g.loop();
  return { cleared: g.surfaceTarget === null, hidden: document.getElementById('surface-compass').classList.contains('hidden') };
}, R.target);
check('surface.arrivalClearsTarget', R.arrive.cleared && R.arrive.hidden, JSON.stringify(R.arrive));

// 5. 层级返回：地表 → 行星系统 → 系统图
R.back = await ev(() => {
  const g = window.game;
  g.openSurfaceMap();
  g.starMapAction('back', null);
  const afterBack = g.starMapState.level;
  const focus = g.starMapState.focusId;
  g.starMapAction('back', null);
  return { afterBack, focus, afterSecond: g.starMapState.level };
});
check('surface.backHierarchy', R.back.afterBack === 'planet' && R.back.focus === 'planet:solar.earth' && R.back.afterSecond === 'system', JSON.stringify(R.back));

// 6. 已发现航点随存档持久化（重载后探索迷雾保持）
R.saveDisc = await ev(() => {
  const g = window.game;
  g.closeStarMap();
  g.running = true;
  g.autoSaveTimer = 999;
  g.loop();
  return { saved: g.discoveredSurface.size };
});
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
R.reloadDisc = await ev(() => {
  const g = window.game;
  return { saved: g.discoveredSurface.size, visible: g.surfaceWaypoints().length };
});
check('surface.discoveryPersists', R.reloadDisc.saved === R.saveDisc.saved && R.reloadDisc.visible > 4, JSON.stringify({ save: R.saveDisc, reload: R.reloadDisc }));

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const pass = allOk() && errors.length === 0;
console.log(pass ? 'CHECKS: all passed' : 'CHECKS: FAILED');
await browser.close();
process.exitCode = pass ? 0 : 1;
