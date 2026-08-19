// 第 20 轮验证：行星地表异常点（遗迹/无人机/补给箱）——
// 确定性生成、扫描品红标记、E 调查领奖、防重复领取、满背包拒绝、存档读档恢复、视觉。
// 运行：node tools/verifyanomaly.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots45';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const ctx = await browser.newContext();
const errors = [];
const page = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
console.log('game ready, seed=', SEED);

const R = {};
const ev = (fn, arg) => page.evaluate(fn, arg);

await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
});
await new Promise((r) => setTimeout(r, 400));

// 1. 生成：数量合理、类型齐全、离坠机点足够远、与日志互不冲突
R.generation = await ev(() => {
  const g = window.game;
  const types = new Set(g.anomalies.list.map((a) => a.type));
  const farFromCrash = g.anomalies.list.every((a) => Math.hypot(a.pos.x - g.world.crashX, a.pos.z - g.world.crashZ) >= 24);
  return {
    count: g.anomalies.list.length,
    types: [...types].sort(),
    farFromCrash,
    firstId: g.anomalies.list[0] && g.anomalies.list[0].id,
    firstPos: g.anomalies.list[0] ? { x: g.anomalies.list[0].pos.x, z: g.anomalies.list[0].pos.z } : null,
  };
});

// 2. 确定性：同种子新页面 → 首个异常点位置一致
{
  const page2 = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
  await page2.addInitScript(() => localStorage.clear());
  await page2.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
  await page2.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
  R.determinism = await page2.evaluate((firstPos) => {
    const g = window.game;
    const a = g.anomalies.list[0];
    return { same: a && a.pos.x === firstPos.x && a.pos.z === firstPos.z, pos: a ? { x: a.pos.x, z: a.pos.z } : null };
  }, R.generation.firstPos);
  await page2.close();
}

// 3. 扫描：品红标记 + toast 计数（站到异常点旁再扫，保证半径内有信号）
R.scan = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  const an = g.anomalies.list[0];
  g.player.pos.set(an.pos.x + 3.0, an.pos.y + 0.1, an.pos.z);
  g.player.vel.set(0, 0, 0);
  const before = g.scanning.markers.length;
  g.input.pressedSet.add('KeyC'); g.input.pressedAge.set('KeyC', g.input.age);
  g.accumulator += 0.1; g.loop();
  const toasts = document.getElementById('toasts').textContent;
  return {
    markersAdded: g.scanning.markers.length > before,
    toastHasAnomaly: toasts.includes('异常信号'),
    anomalyCount: g.anomalies.markForScan(36, g.player.pos.x, g.player.pos.z).length,
  };
});

// 4. 靠近调查：提示 + E 领奖 + 防重复
R.interact = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  const an = g.anomalies.list[0];
  const lootBefore = {};
  for (const [item] of an.loot) lootBefore[item] = g.inventory.countOf(item);
  g.player.pos.set(an.pos.x + 3.0, an.pos.y + 0.1, an.pos.z);
  g.player.vel.set(0, 0, 0);
  // 跑满 14 帧：互动提示在 frame%12 的 HUD 刷新里更新，单帧读不到
  for (let i = 0; i < 14; i++) { g.accumulator += 0.1; g.loop(); }
  const hint = document.getElementById('interact-hint').textContent;
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.accumulator += 0.1; g.loop();
  const toastAfter = document.getElementById('toasts').textContent;
  const lootGained = an.loot.some(([item, count]) => g.inventory.countOf(item) > (lootBefore[item] || 0));
  const collected = g.collectedAnomalies.has(an.id);
  // 再按 E：不应重复领取
  const lootMid = {};
  for (const [item] of an.loot) lootMid[item] = g.inventory.countOf(item);
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.accumulator += 0.1; g.loop();
  const noRepeat = an.loot.every(([item]) => g.inventory.countOf(item) === lootMid[item]);
  return {
    hint: hint.includes('调查'),
    lootGained,
    collected,
    toastHasName: toastAfter.includes(an.name),
    noRepeat,
    anId: an.id,
  };
});
// 无头指针锁在 eval 之间会漂移（可能误弹暂停）——截图前重新钉住状态并目视对准异常点
await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  g.ui.showPaused(false);
  const an = g.anomalies.list[0];
  const dx = an.pos.x - g.player.pos.x, dz = an.pos.z - g.player.pos.z;
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = Math.atan2(an.pos.y + 0.5 - (g.player.pos.y + 1.62), Math.hypot(dx, dz));
  g.player.updateCamera();
});
await page.screenshot({ path: `${outDir}/anomaly_near.png` });

// 5. 满背包拒绝（另一个异常点）
R.fullRefuse = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  for (let i = 0; i < 35; i++) g.inventory.addItem('dirt', 64);
  g.inventory.addItem('sand', 64);
  const an = g.anomalies.list.find((a) => !a.collected);
  if (!an) return { skipped: true };
  g.player.pos.set(an.pos.x + 3.0, an.pos.y + 0.1, an.pos.z);
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.accumulator += 0.1; g.loop();
  return {
    refused: !an.collected,
    toastFull: document.getElementById('toasts').textContent.includes('背包已满'),
  };
});

// 6. 存档 → 重载 → 收集状态恢复
R.saveReload = await ev(async () => {
  const g = window.game;
  const { saveGame } = await import('/src/systems/save.js');
  saveGame(g);
  return { saved: g.collectedAnomalies.size };
});
{
  const page3 = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
  page3.on('pageerror', (e) => errors.push('PAGEERROR3: ' + e.message));
  await page3.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page3.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
  await page3.click('#btn-continue');
  await new Promise((r) => setTimeout(r, 2500));
  R.reload = await page3.evaluate(() => {
    const g = window.game;
    const an = g.anomalies.list.find((a) => g.collectedAnomalies.has(a.id));
    const uncollected = g.anomalies.list.filter((a) => !a.collected);
    return {
      collectedCount: g.collectedAnomalies.size,
      restoredMarked: !!an && an.collected === true,
      othersUncollected: uncollected.length > 0,
    };
  });
  await page3.close();
}

console.log(JSON.stringify({ R, errors }, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('异常点数量合理（>10）', R.generation && R.generation.count > 10, R.generation);
check('三种类型齐全', R.generation && R.generation.types.join(',') === 'cache,drone,ruin', R.generation);
check('异常点远离坠机点', R.generation && R.generation.farFromCrash);
check('同种子布局确定', R.determinism && R.determinism.same, R.determinism);
check('扫描产生异常标记与计数', R.scan && R.scan.markersAdded && R.scan.toastHasAnomaly && R.scan.anomalyCount > 0, R.scan);
check('靠近显示调查提示', R.interact && R.interact.hint);
check('E 调查获得奖励', R.interact && R.interact.lootGained);
check('调查后标记已收集', R.interact && R.interact.collected);
check('调查 toast 含名称', R.interact && R.interact.toastHasName);
check('重复按 E 不重复领奖', R.interact && R.interact.noRepeat);
check('满背包调查被拒绝并提示', R.fullRefuse && (R.fullRefuse.skipped || (R.fullRefuse.refused && R.fullRefuse.toastFull)), R.fullRefuse);
check('存档含收集状态', R.saveReload && R.saveReload.saved >= 1, R.saveReload);
check('读档恢复已收集标记', R.reload && R.reload.collectedCount >= 1 && R.reload.restoredMarked, R.reload);
check('其他异常点保持未收集', R.reload && R.reload.othersUncollected);
check('无页面错误', errors.length === 0, errors.slice(0, 3));

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
