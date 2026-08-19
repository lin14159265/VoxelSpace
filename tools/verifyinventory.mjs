// 第 19 轮验证：背包满时的边界行为——合成按钮置灰、合成被拒且材料不吞、
// 空间站购买被拒且信用点不吞、满背包挖掘不崩溃。
// 运行：node tools/verifyinventory.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots44';
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

await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
});
await new Promise((r) => setTimeout(r, 400));

// 塞满背包（36 格全满，保留铁氧体 8 与信用点 100 作为"材料/钱"）
await ev(() => {
  const g = window.game;
  g.inventory.addItem('ferrite_dust', 8);
  g.inventory.addItem('credits', 100);
  for (let i = 0; i < 35; i++) g.inventory.addItem('dirt', 64);
  g.inventory.addItem('sand', 64);
});

// 1. 合成按钮置灰（材料够但放不下）
R.craftDisabled = await ev(() => {
  const g = window.game;
  g.openBackpack();
  const btn = document.querySelector('#craft-list .craft-item[data-recipe="metal_plating"] .craft-btn');
  return {
    disabled: btn ? btn.classList.contains('disabled') : null,
    backpackVisible: g.ui.backpackVisible(),
  };
});
await page.screenshot({ path: `${outDir}/full_backpack.png` });

// 2. 直接合成：拒绝 + 材料不吞 + 提示
R.craftReject = await ev(() => {
  const g = window.game;
  const before = g.inventory.countOf('ferrite_dust');
  g.craftItem('metal_plating');
  const toasts = document.getElementById('toasts').textContent;
  return {
    ferriteBefore: before,
    ferriteAfter: g.inventory.countOf('ferrite_dust'),
    toastFull: toasts.includes('背包已满'),
  };
});
await ev(() => { const g = window.game; g.closeBackpack(); });

// 3. 空间站购买：拒绝 + 信用点不吞
R.buyReject = await ev(() => {
  const g = window.game;
  const before = g.inventory.countOf('credits');
  g.handleStationAction('buy1', 'carbon', 2);
  const toasts = document.getElementById('toasts').textContent;
  return {
    creditsBefore: before,
    creditsAfter: g.inventory.countOf('credits'),
    carbonAfter: g.inventory.countOf('carbon'),
    toastFull: toasts.includes('背包已满，无法购买'),
  };
});

// 4. 满背包挖掘：不崩溃（掉落丢失但无错误）
R.mineFull = await ev(() => {
  const g = window.game;
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.world.getGroundY(px, pz);
  g.player.breakBlock({ x: px, y: gy, z: pz, id: g.world.getBlock(px, gy, pz) });
  return { ok: true };
});

R.errors = errors;
console.log(JSON.stringify(R, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('满背包时合成按钮置灰', R.craftDisabled && R.craftDisabled.disabled === true, R.craftDisabled);
check('满背包合成被拒且材料不吞', R.craftReject && R.craftReject.ferriteAfter === R.craftReject.ferriteBefore, R.craftReject);
check('满背包合成有提示', R.craftReject && R.craftReject.toastFull);
check('满背包购买被拒且信用点不吞', R.buyReject && R.buyReject.creditsAfter === R.buyReject.creditsBefore && R.buyReject.carbonAfter === 0, R.buyReject);
check('满背包购买有提示', R.buyReject && R.buyReject.toastFull);
check('满背包挖掘不崩溃', R.mineFull && R.mineFull.ok);
check('无页面错误', errors.length === 0, errors.slice(0, 3));

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
