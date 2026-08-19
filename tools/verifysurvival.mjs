// 第 17 轮验证：生存资源补给循环——钠自动补危险防护、氧自动补生命维持、
// 阈值与上限、创造模式免疫、首次拾取提示（钠/氧不再是无用途的死资源）。
// 运行：node tools/verifysurvival.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots39';
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

// 基线：满状态 + 无补给品
R.base = await ev(() => {
  const g = window.game;
  g.player.hazard = 100; g.player.life = 100;
  g.inventory.removeItem('sodium', 99); g.inventory.removeItem('oxygen', 99);
  return { hazard: g.player.hazard, life: g.player.life, sodium: g.inventory.countOf('sodium'), oxygen: g.inventory.countOf('oxygen') };
});

// 1. 危险防护低 + 有钠 → 自动消耗补充
R.sodiumConsume = await ev(() => {
  const g = window.game;
  g.player.hazard = 10;
  g.inventory.addItem('sodium', 3);
  const before = { hazard: g.player.hazard, sodium: g.inventory.countOf('sodium') };
  g.player.updateVitals(0.1);
  const toasts = document.getElementById('toasts').textContent;
  return {
    before,
    hazardAfter: g.player.hazard,
    sodiumAfter: g.inventory.countOf('sodium'),
    gained: g.player.hazard - before.hazard,
    toast: toasts.includes('危险防护 +50'),
  };
});

// 2. 危险防护充足（≥15）→ 不消耗
R.sodiumNoConsume = await ev(() => {
  const g = window.game;
  g.player.hazard = 70;
  const n = g.inventory.countOf('sodium');
  g.player.updateVitals(0.1);
  return { hazard: g.player.hazard, sodiumSame: g.inventory.countOf('sodium') === n };
});

// 3. 生命维持低 + 有氧 → 自动消耗补充
R.oxygenConsume = await ev(() => {
  const g = window.game;
  g.player.life = 8;
  g.inventory.addItem('oxygen', 2);
  const before = { life: g.player.life, oxygen: g.inventory.countOf('oxygen') };
  g.player.updateVitals(0.1);
  const toasts = document.getElementById('toasts').textContent;
  return {
    before,
    lifeAfter: g.player.life,
    oxygenAfter: g.inventory.countOf('oxygen'),
    gained: g.player.life - before.life,
    toast: toasts.includes('生命维持 +60'),
  };
});

// 4. 生命维持充足 → 不消耗
R.oxygenNoConsume = await ev(() => {
  const g = window.game;
  g.player.life = 80;
  const n = g.inventory.countOf('oxygen');
  g.player.updateVitals(0.1);
  return { oxygenSame: g.inventory.countOf('oxygen') === n, life: g.player.life };
});

// 5. 无补给品时不崩溃（阈值触发但库存为空）
R.noCrashEmpty = await ev(() => {
  const g = window.game;
  g.inventory.removeItem('sodium', 99); g.inventory.removeItem('oxygen', 99);
  g.player.hazard = 5; g.player.life = 5;
  g.player.updateVitals(0.1);
  g.player.updateVitals(0.1);
  return { hazard: g.player.hazard, life: g.player.life, ok: true };
});

// 6. 创造模式免疫（不消耗补给）
R.creativeImmune = await ev(() => {
  const g = window.game;
  g.creative = true;
  g.inventory.addItem('sodium', 2); g.inventory.addItem('oxygen', 2);
  g.player.hazard = 5; g.player.life = 5;
  g.player.updateVitals(0.1);
  const r = { sodium: g.inventory.countOf('sodium'), oxygen: g.inventory.countOf('oxygen'), hazard: g.player.hazard, life: g.player.life };
  g.creative = false;
  return r;
});

// 7. 首次拾取提示（只提示一次）
R.pickupHints = await ev(() => {
  const g = window.game;
  g.hintedSodium = false; g.hintedOxygen = false;
  const before = document.getElementById('toasts').childElementCount;
  g.player.notePickup('sodium');
  const afterSodium = document.getElementById('toasts').childElementCount;
  g.player.notePickup('sodium'); // 第二次：不再提示
  const afterSodium2 = document.getElementById('toasts').childElementCount;
  g.player.notePickup('oxygen');
  const afterOxygen = document.getElementById('toasts').childElementCount;
  g.player.notePickup('oxygen');
  const afterOxygen2 = document.getElementById('toasts').childElementCount;
  return {
    sodiumHintShown: afterSodium === before + 1 && document.getElementById('toasts').textContent.includes('钠：危险防护耗尽时自动补充'),
    sodiumOnce: afterSodium2 === afterSodium,
    oxygenHintShown: afterOxygen === afterSodium2 + 1 && document.getElementById('toasts').textContent.includes('氧：洞穴中生命维持耗尽时自动补充'),
    oxygenOnce: afterOxygen2 === afterOxygen,
  };
});

// 8. 危险防护低时警告提示（<25 → 引导采集钠花）
R.hazardWarn = await ev(() => {
  const g = window.game;
  g.player.hazardWarned = false;
  g.player.hazard = 20;
  const before = document.getElementById('toasts').childElementCount;
  g.planetHazard = { kind: 'toxic', drain: 2.0, when: 'always', label: '剧毒' };
  g.player.updateVitals(0.05);
  const after = document.getElementById('toasts').childElementCount;
  return {
    warned: after === before + 1 && document.getElementById('toasts').textContent.includes('采集钠花'),
    warnedFlag: g.player.hazardWarned,
  };
});

// 9. 护盾电池：护盾 <30% 自动消耗补充；≥30 不消耗；首次合成提示一次
R.shieldCell = await ev(() => {
  const g = window.game;
  g.player.shield = 20;
  g.inventory.addItem('shield_cell', 2);
  const before = { shield: g.player.shield, cell: g.inventory.countOf('shield_cell') };
  g.player.updateVitals(0.1);
  const toasts = document.getElementById('toasts').textContent;
  const first = {
    gained: g.player.shield - before.shield,
    cellAfter: g.inventory.countOf('shield_cell'),
    toast: toasts.includes('护盾 +60'),
  };
  // ≥30 不消耗
  g.player.shield = 70;
  const n = g.inventory.countOf('shield_cell');
  g.player.updateVitals(0.1);
  const noConsume = g.inventory.countOf('shield_cell') === n;
  return { ...first, noConsume };
});
R.shieldHint = await ev(() => {
  const g = window.game;
  g.hintedShield = false;
  g.inventory.addItem('sodium', 3);
  g.inventory.addItem('ferrite_dust', 2);
  const before = document.getElementById('toasts').childElementCount;
  g.craftItem('shield_cell');
  const after = document.getElementById('toasts').childElementCount;
  g.craftItem('shield_cell'); // 材料不足会失败，但提示已标记，不再弹
  const after2 = document.getElementById('toasts').childElementCount;
  return {
    hintShown: after >= before + 1 && document.getElementById('toasts').textContent.includes('护盾低于 30% 时自动补充'),
    hintOnce: g.hintedShield === true && after2 === after,
  };
});

R.errors = errors;
console.log(JSON.stringify(R, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('基线：状态满、无补给', R.base.hazard === 100 && R.base.sodium === 0 && R.base.oxygen === 0, R.base);
check('危险防护<15 自动消耗钠', R.sodiumConsume.sodiumAfter === R.sodiumConsume.before.sodium - 1, R.sodiumConsume);
check('钠补充 +50', R.sodiumConsume.gained >= 49 && R.sodiumConsume.gained <= 51, R.sodiumConsume);
check('钠补给有 toast 反馈', R.sodiumConsume.toast);
check('危险防护≥15 不消耗钠', R.sodiumNoConsume.sodiumSame);
check('生命维持<15 自动消耗氧', R.oxygenConsume.oxygenAfter === R.oxygenConsume.before.oxygen - 1, R.oxygenConsume);
check('氧补充 +60', R.oxygenConsume.gained >= 59 && R.oxygenConsume.gained <= 61, R.oxygenConsume);
check('氧补给有 toast 反馈', R.oxygenConsume.toast);
check('生命维持≥15 不消耗氧', R.oxygenNoConsume.oxygenSame);
check('无补给时低状态不崩溃', R.noCrashEmpty.ok);
check('创造模式不消耗补给', R.creativeImmune.sodium === 2 && R.creativeImmune.oxygen === 2 && R.creativeImmune.hazard === 100, R.creativeImmune);
check('首次拾取钠提示一次', R.pickupHints.sodiumHintShown && R.pickupHints.sodiumOnce);
check('首次拾取氧提示一次', R.pickupHints.oxygenHintShown && R.pickupHints.oxygenOnce);
check('危险防护<25 警告引导采集', R.hazardWarn.warned && R.hazardWarn.warnedFlag);
check('护盾<30 自动消耗护盾电池', R.shieldCell && R.shieldCell.cellAfter === 1, R.shieldCell);
check('护盾电池补充 +60', R.shieldCell && R.shieldCell.gained >= 59 && R.shieldCell.gained <= 61, R.shieldCell);
check('护盾电池有 toast 反馈', R.shieldCell && R.shieldCell.toast);
check('护盾≥30 不消耗电池', R.shieldCell && R.shieldCell.noConsume);
check('首次合成护盾电池提示一次', R.shieldHint && R.shieldHint.hintShown && R.shieldHint.hintOnce, R.shieldHint);
check('无页面错误', errors.length === 0);

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
