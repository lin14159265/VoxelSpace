// 第 31 轮验证：存档导出/导入（备份与分享）——
// 导出文本→清档→导入→读档恢复一致；非法文本被拒；菜单按钮可见性。
// 运行：node tools/verifysavetransfer.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots53';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const ctx = await browser.newContext();
const errors = [];
const page = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.addInitScript(() => localStorage.clear());
await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

const R = {};
const ev = (fn, arg) => page.evaluate(fn, arg);

// 1. 写入一个带内容的存档
await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  g.inventory.addItem('stone', 23);
  g.inventory.addItem('credits', 77);
  g.quests.onInteractShip();
});
R.write = await ev(async () => {
  const g = window.game;
  const { saveGame } = await import('/src/systems/save.js');
  saveGame(g);
  return { hasSave: (await import('/src/systems/save.js')).hasSave() };
});

// 2. 导出文本 → 清档 → 导入 → 恢复
R.exportText = await ev(async () => {
  const { exportSaveText, hasSave, clearSave } = await import('/src/systems/save.js');
  const text = exportSaveText();
  const d = text ? JSON.parse(text) : null;
  clearSave();
  const afterClear = hasSave();
  return {
    textLength: text ? text.length : 0,
    seed: d ? d.seed : null,
    stone: d && d.inventory ? d.inventory.slots.reduce((n, s) => n + (s && s.itemId === 'stone' ? s.count : 0), 0) : 0,
    afterClear,
  };
});
R.import = await ev(async () => {
  const { exportSaveText, importSaveText, hasSave } = await import('/src/systems/save.js');
  // 重新写入（上一段清档了）
  const g = window.game;
  const { saveGame } = await import('/src/systems/save.js');
  saveGame(g);
  const text = exportSaveText();
  const { clearSave } = await import('/src/systems/save.js');
  clearSave();
  const cleared = !hasSave();
  const r = importSaveText(text);
  return { ok: r.ok, cleared, hasSave: hasSave() };
});

// 3. 非法导入被拒（已有存档不被改动）
R.invalid = await ev(async () => {
  const { importSaveText, exportSaveText } = await import('/src/systems/save.js');
  const before = exportSaveText();
  const r1 = importSaveText('this is garbage, not json at all');
  const r2 = importSaveText(JSON.stringify({ version: 9, seed: '999' }));
  return { r1, r2, unchanged: exportSaveText() === before };
});

// 4. 读档恢复内容一致
R.reload = await (async () => {
  // 重新导入有效存档（invalid 测试后存档是空的）
  await ev(async () => {
    const g = window.game;
    const { saveGame, exportSaveText, importSaveText, clearSave } = await import('/src/systems/save.js');
    saveGame(g);
    const text = exportSaveText();
    clearSave();
    importSaveText(text);
  });
  const page2 = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
  page2.on('pageerror', (e) => errors.push('PAGEERROR2: ' + e.message));
  await page2.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page2.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
  const btnVisible = await page2.evaluate(() => ({
    continueVisible: !document.getElementById('btn-continue').classList.contains('hidden'),
    exportVisible: !document.getElementById('btn-export').classList.contains('hidden'),
    importVisible: !document.getElementById('btn-import').classList.contains('hidden'),
  }));
  await page2.click('#btn-continue');
  await new Promise((r) => setTimeout(r, 2500));
  const restored = await page2.evaluate(() => ({
    stone: window.game.inventory.countOf('stone'),
    credits: window.game.inventory.countOf('credits'),
    questStep: window.game.quests.currentStep.id,
  }));
  await page2.close();
  return { btnVisible, restored };
})();

console.log(JSON.stringify({ R, errors }, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('导出文本非空且含种子与背包', R.exportText && R.exportText.textLength > 500 && R.exportText.seed === SEED && R.exportText.stone === 23, R.exportText);
check('清档后导入恢复存档', R.import && R.import.ok && R.import.cleared && R.import.hasSave, R.import);
check('非法 JSON 导入被拒', R.invalid && R.invalid.r1.ok === false && R.invalid.r1.reason === 'parse');
check('非法结构导入被拒', R.invalid && R.invalid.r2.ok === false && R.invalid.r2.reason === 'invalid');
check('被拒后存档不被改动', R.invalid && R.invalid.unchanged === true);
check('菜单按钮可见性（继续/导出/导入）', R.reload.btnVisible.continueVisible && R.reload.btnVisible.exportVisible && R.reload.btnVisible.importVisible, R.reload.btnVisible);
check('导入后读档内容完整恢复', R.reload.restored.stone === 23 && R.reload.restored.credits === 77 && R.reload.restored.questStep === 'gather', R.reload.restored);
check('无页面错误', errors.length === 0, errors.slice(0, 3));

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
