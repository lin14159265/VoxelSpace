// 第 21 轮验证：里程碑（成就）系统——挖掘/合成/击杀即时提示、面板展示与关闭、
// 不重复触发、存档读档恢复、视觉。
// 运行：node tools/verifymilestones.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots46';
fs.mkdirSync(outDir, { recursive: true });

const BASE_URL = process.env.GAME_URL || 'http://localhost:8080';
const browser = await chromium.launch(process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--mute-audio'] }
  : { channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const ctx = await browser.newContext();
const errors = [];
const page = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`${BASE_URL}/?seed=${SEED}`, { waitUntil: 'load' });
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

// 1. 初始 0 达成 → 挖掘一块方块 → 达成"第一次挖掘"
R.mine = await ev(() => {
  const g = window.game;
  const before = g.milestones.earnedCount;
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.world.getGroundY(px, pz);
  const id = g.world.getBlock(px, gy, pz);
  g.player.breakBlock({ x: px, y: gy, z: pz, id });
  const toasts = document.getElementById('toasts').textContent;
  return {
    before,
    after: g.milestones.earnedCount,
    hasFirstMine: g.milestones.earned.has('first_mine'),
    toastStar: toasts.includes('★ 里程碑达成：第一次挖掘'),
  };
});

// 2. 合成 → "第一件造物"（先给材料）
R.craft = await ev(() => {
  const g = window.game;
  g.inventory.addItem('log', 1);
  g.craftItem('planks');
  return {
    hasFirstCraft: g.milestones.earned.has('first_craft'),
    count: g.milestones.earnedCount,
  };
});

// 3. 击杀一只生物 → "猎手"
R.kill = await ev(async () => {
  const g = window.game;
  const { Mob } = await import('/src/entities/mobs.js');
  const gy = g.world.getGroundY(g.player.pos.x + 4, g.player.pos.z);
  const mob = new Mob(g, g.player.pos.x + 4, gy, g.player.pos.z);
  mob.hit(40, { x: 1, y: 0, z: 0 }); // 30 血 → 直接击杀（hit 内触发 die→milestone）
  const r = { hasFirstKill: g.milestones.earned.has('first_kill'), count: g.milestones.earnedCount };
  mob.dispose();
  return r;
});

// 3b. P1-2 回归：背包满时奖励暂缓，腾出空位后自动补发
R.pending = await ev(() => {
  const g = window.game;
  const savedSlots = g.inventory.slots.map((s) => (s ? { itemId: s.itemId, count: s.count } : null));
  for (let i = 0; i < g.inventory.slots.length; i++) g.inventory.slots[i] = { itemId: 'stone', count: 64 };
  const creditsBefore = g.inventory.countOf('credits');
  g.milestones.bump('space', 1); // astronaut = +150，满包暂缓
  const pendingBefore = [...g.milestones.pending];
  const earned = g.milestones.earned.has('astronaut');
  const toast = document.getElementById('toasts').textContent.includes('有空位时自动补发');
  g.inventory.slots[1] = null;
  g.milestones.flushPendingRewards();
  const gained = g.inventory.countOf('credits') - creditsBefore;
  const pendingAfter = g.milestones.pending.length;
  const flushToast = document.getElementById('toasts').textContent.includes('里程碑奖励补发');
  g.inventory.slots = savedSlots;
  return { pendingBefore, earned, toast, gained, pendingAfter, flushToast };
});
// 4. 暂停菜单 → 里程碑面板：计数、行数、B 关闭
R.panel = await ev(() => {
  const g = window.game;
  g.setPaused(true);
  document.getElementById('btn-milestones').click();
  const visible = !document.getElementById('milestones-panel').classList.contains('hidden');
  const countText = document.getElementById('milestones-count').textContent;
  const rows = document.querySelectorAll('#milestones-list .milestone-item').length;
  const earnedRows = document.querySelectorAll('#milestones-list .milestone-item.earned').length;
  const lockedRows = document.querySelectorAll('#milestones-list .milestone-item.locked').length;
  return { visible, countText, rows, earnedRows, lockedRows, paused: g.paused };
});
await page.screenshot({ path: `${outDir}/milestones_panel.png` });
R.panelClose = await ev(() => {
  const g = window.game;
  g.running = true; g.input.locked = true; g.wantLock = true;
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.accumulator += 0.1; g.loop();
  return {
    closed: document.getElementById('milestones-panel').classList.contains('hidden'),
    backToPause: !document.getElementById('paused').classList.contains('hidden'),
  };
});

// 5. 存档 → 重载 → 里程碑恢复
R.save = await ev(async () => {
  const g = window.game;
  const { saveGame } = await import('/src/systems/save.js');
  saveGame(g);
  return { earned: [...g.milestones.earned], data: { ...g.milestones.data } };
});
{
  const page2 = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
  page2.on('pageerror', (e) => errors.push('PAGEERROR2: ' + e.message));
  await page2.goto(`${BASE_URL}/`, { waitUntil: 'load' });
  await page2.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
  await page2.click('#btn-continue');
  await new Promise((r) => setTimeout(r, 2500));
  R.reload = await page2.evaluate(() => {
    const g = window.game;
    return { earnedCount: g.milestones.earnedCount, hasFirstMine: g.milestones.earned.has('first_mine'), hasFirstCraft: g.milestones.earned.has('first_craft'), hasFirstKill: g.milestones.earned.has('first_kill'), hasAstronaut: g.milestones.earned.has('astronaut'), hasMerchant: g.milestones.earned.has('merchant') };
  });
  await page2.close();
}

console.log(JSON.stringify({ R, errors }, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('挖掘达成"第一次挖掘"+toast', R.mine && R.mine.after === R.mine.before + 1 && R.mine.hasFirstMine && R.mine.toastStar, R.mine);
check('合成达成"第一件造物"', R.craft && R.craft.hasFirstCraft && R.craft.count >= 2);
check('击杀达成"猎手"', R.kill && R.kill.hasFirstKill);
check('里程碑奖励满包暂缓 + 腾位补发', R.pending && R.pending.pendingBefore.includes('astronaut') && R.pending.earned && R.pending.toast && R.pending.gained === 190 && R.pending.pendingAfter === 0 && R.pending.flushToast, R.pending);
check('面板可见 + 计数正确', R.panel && R.panel.visible && R.panel.countText === `${R.panel.earnedRows}/23`, R.panel);
check('面板共 23 行、5 达成 18 锁定', R.panel && R.panel.rows === 23 && R.panel.earnedRows === 5 && R.panel.lockedRows === 18, R.panel);
check('B 关闭面板回到暂停', R.panelClose && R.panelClose.closed && R.panelClose.backToPause, R.panelClose);
check('读档恢复里程碑', R.reload && R.reload.earnedCount === 5 && R.reload.hasFirstMine && R.reload.hasFirstCraft && R.reload.hasFirstKill && R.reload.hasAstronaut && R.reload.hasMerchant, R.reload);
check('无页面错误', errors.length === 0, errors.slice(0, 3));

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
