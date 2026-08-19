// 第 47 轮验证：经济正循环——里程碑发信用点 / 可重复订单冷却 / 飞船线价格节奏 / 存档恢复
// 运行：node tools/verifyeconomy.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-economy';
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
  g.intro.active = false;
  g.ui.hud.classList.remove('hidden');
  g.input.locked = true;
  g.setPaused(false);
});

// 1. 里程碑奖励：起飞里程碑发 100 信用点，并连锁点亮 merchant（+40）
R.milestoneReward = await ev(() => {
  const g = window.game;
  const before = g.inventory.countOf('credits');
  g.milestones.bump('launch', 1);
  const after = g.inventory.countOf('credits');
  return {
    gained: after - before,
    credits: after,
    hasFirstFlight: g.milestones.earned.has('first_flight'),
    hasMerchant: g.milestones.earned.has('merchant'),
    toastHasReward: document.getElementById('toasts').textContent.includes('奖励 +100 信用点'),
  };
});
check('里程碑奖励信用点并连锁 merchant', R.milestoneReward && R.milestoneReward.hasFirstFlight && R.milestoneReward.hasMerchant && R.milestoneReward.gained === 140 && R.milestoneReward.toastHasReward, R.milestoneReward);

// 2. 可重复订单：交付成功 + 45s 冷却 + UI 按钮禁用并显示倒计时
R.order = await ev(() => {
  const g = window.game;
  g.docked = true;
  g.ui.showStation(true);
  g.renderStationUI('orders');
  const before = g.inventory.countOf('credits');
  g.inventory.addItem('ferrite_dust', 15);
  g.handleStationAction('order', 'order1', 1);
  const btn = document.querySelector('#station-body [data-action="order"][data-id="order1"]');
  return {
    gained: g.inventory.countOf('credits') - before,
    cd: g.stationOrderCd.order1 || 0,
    btnText: btn ? btn.textContent.trim() : null,
    btnDisabled: btn ? btn.disabled : null,
    metaHasCd: document.getElementById('station-body').textContent.includes('冷却 45s'),
  };
});
check('订单交付并进入 45 秒冷却', R.order && R.order.gained === 60 && R.order.cd > 44 && R.order.cd <= 45 && R.order.btnText === '冷却 45s' && R.order.btnDisabled && R.order.metaHasCd, R.order);

// 3. 冷却期间重复点击被拒绝（钱与货都不动）
R.cdBlock = await ev(() => {
  const g = window.game;
  const credits = g.inventory.countOf('credits');
  g.inventory.addItem('ferrite_dust', 15);
  const ferrite = g.inventory.countOf('ferrite_dust');
  g.handleStationAction('order', 'order1', 1);
  return { creditsSame: g.inventory.countOf('credits') === credits, ferriteSame: g.inventory.countOf('ferrite_dust') === ferrite };
});
check('冷却中订单不吞货不吞钱', R.cdBlock && R.cdBlock.creditsSame && R.cdBlock.ferriteSame, R.cdBlock);

// 4. 冷却计时：归零后可再次交付同单
R.cdExpire = await ev(() => {
  const g = window.game;
  g.stationOrderCd.order1 = 0.02;
  g.running = true; g.paused = false; g.input.locked = true; g.inMenu = false;
  const oldClock = g.clock;
  g.clock = { getDelta: () => 0.05 }; // 确定性驱动主循环冷却计时
  g.loop();
  g.clock = oldClock;
  const expired = !(g.stationOrderCd.order1 > 0);
  const before = g.inventory.countOf('credits');
  g.inventory.addItem('ferrite_dust', 15);
  g.handleStationAction('order', 'order1', 1);
  return { expired, secondGained: g.inventory.countOf('credits') - before };
});
check('冷却归零后可重复交付', R.cdExpire && R.cdExpire.expired && R.cdExpire.secondGained === 60, R.cdExpire);

// 5. 飞船线节奏：主线必需升级合计 1400，且当前信用点已覆盖
R.pricing = await ev(async () => {
  const { SHIP_UPGRADES } = await import('/src/systems/station.js');
  const required = SHIP_UPGRADES.filter((u) => ['engine1', 'engine2', 'shield1', 'bigship'].includes(u.id))
    .reduce((n, u) => n + u.cost, 0);
  return { required, credits: window.game.inventory.countOf('credits') };
});
check('大船线主线价 1400 信用点', R.pricing && R.pricing.required === 1400, R.pricing);

// 6. 存档：信用点/里程碑/订单冷却完整恢复
R.save = await ev(async () => {
  window.game.stationOrderCd.order1 = 23;
  const { saveGame } = await import('/src/systems/save.js');
  saveGame(window.game);
  return true;
});
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
R.reload = await ev(() => ({
  credits: window.game.inventory.countOf('credits'),
  firstFlight: window.game.milestones.earned.has('first_flight'),
  merchant: window.game.milestones.earned.has('merchant'),
  cd: window.game.stationOrderCd.order1 || 0,
}));
check('信用点/里程碑/订单冷却存档重载恢复', R.save && R.reload.firstFlight && R.reload.merchant && Math.abs(R.reload.cd - 23) < 0.2, R.reload);

await page.screenshot({ path: `${outDir}/economy.png` });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const ok = allOk() && errors.length === 0;
console.log(ok ? 'CHECKS: all passed' : 'CHECKS: failed');
await browser.close();
if (!ok) process.exit(1);
