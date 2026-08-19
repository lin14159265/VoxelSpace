// 第 16 轮验证：新玩家开场体验——任务面板渐进显示（反剧透/防遮挡）、
// 调试痕迹清理（G 键重生成世界已移除、"(开发)"标签、菜单 G 提示）、
// 日志→修船引导、强化玻璃/碳图标对比度。
// 运行：node tools/verifyfirstplay.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots36';
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
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
});
await sleep(300);

// 1. 菜单/HUD 文案：无调试痕迹
R.menuTexts = await ev(() => {
  const mcRows = Array.from(document.querySelectorAll('#menu .mc-row')).map((e) => e.textContent);
  const seedRow = document.querySelector('.menu-seed')?.textContent || '';
  const hintLine = document.querySelector('#hints .hint-line')?.textContent || '';
  return {
    hasDevLabel: mcRows.some((t) => t.includes('(开发)') || t.includes('开发')),
    hasGFreeRegen: seedRow.includes('按 G'),
    hudHasBClosePanel: hintLine.includes('[B] 关面板'),
    seedRow,
    hintLine,
  };
});

// 2. 开局任务面板：渐进显示 + 反剧透 + 标题进度
R.spawnMissions = await ev(() => {  const items = Array.from(document.querySelectorAll('#mission-list > *')).map((e) => e.textContent.trim());
  const full = items.join('\n');
  const title = document.querySelector('#missions .panel-title')?.textContent || '';
  return {
    items,
    title,
    hasCurrent: full.includes('检查坠毁的飞船'),
    hasNext1: full.includes('采集基础资源'),
    hasNext2: full.includes('制作多功能工具'),
    hasFold: full.includes('后续目标 ×14'),
    count: items.length,
    spoilsProxima: full.includes('跃迁至比邻星系'),
    spoilsBigShip: full.includes('购买大型殖民船'),
    spoilsStation: full.includes('空间站'),
  };
});
await page.screenshot({ path: `${outDir}/spawn_missions.png` });

// 2b. 出生视角对准飞船 + 飞船高出弹坑 + 视线走廊无大树（第一眼看到任务目标）
R.spawnAim = await ev(() => {
  const g = window.game;
  const w = g.world;
  const dx = w.crashX - g.player.pos.x;
  const dz = w.crashZ - g.player.pos.z;
  const want = Math.atan2(-dx, -dz);
  let delta = Math.abs(g.player.yaw - want);
  if (delta > Math.PI) delta = Math.PI * 2 - delta;
  const rimH = w.gen.heightAt(w.crashX, w.crashZ);
  // 视线走廊采样：出生点→坠毁点线段 1/4、1/2、3/4 处，地面上方 8 格内不得有树木/植物
  let blocked = 0;
  for (const t of [0.25, 0.5, 0.75]) {
    const sx = Math.round(g.player.pos.x + dx * t);
    const sz = Math.round(g.player.pos.z + dz * t);
    const h = w.gen.heightAt(sx, sz);
    for (let y = h + 1; y <= h + 8; y++) {
      const id = w.getBlock(sx, y, sz);
      if (id === 5 || id === 8) blocked++;
    }
  }
  return {
    yaw: g.player.yaw, want, delta,
    facingShip: delta < 0.01,
    shipAboveRim: g.ship.worldPos.y - rimH >= 2,
    shipY: g.ship.worldPos.y, rimH,
    sightlineBlocked: blocked,
  };
});

// 3. 完成第一步后：完成数、折叠数、当前步骤同步更新
R.afterCheckShip = await ev(() => {
  const g = window.game;
  g.quests.onInteractShip();
  const items = Array.from(document.querySelectorAll('#mission-list > *')).map((e) => e.textContent.trim());
  const full = items.join('\n');
  return {
    items,
    title: document.querySelector('#missions .panel-title')?.textContent || '',
    hasDoneLine: full.includes('已完成 1 项'),
    hasCurrent: full.includes('采集基础资源'),
    hasFold13: full.includes('后续目标 ×13'),
  };
});
await page.screenshot({ path: `${outDir}/missions_after_check.png` });

// 4. G 键不再触发世界重生成（调试热键已移除）
R.keyG = await ev(() => {
  const g = window.game;
  const seedBefore = g.seed;
  const questIndexBefore = g.quests.currentIndex;
  const posBefore = { x: g.player.pos.x, z: g.player.pos.z };
  g.input.pressedSet.add('KeyG'); g.input.pressedAge.set('KeyG', g.input.age);
  g.accumulator += 0.2;
  g.loop();
  g.loop();
  return {
    seedSame: g.seed === seedBefore,
    questSame: g.quests.currentIndex === questIndexBefore,
    posSame: Math.abs(g.player.pos.x - posBefore.x) < 0.001 && Math.abs(g.player.pos.z - posBefore.z) < 0.001,
    pressedConsumed: !g.input.pressedSet.has('KeyG'),
  };
});

// 5. 读取数据日志后关闭：出现"继续检查飞船"指引（仅限 checkShip 步骤前）
// 场景 A：已过 checkShip 步骤（第 3 节已推进）→ 不弹冗余指引
R.logNudge = await ev(() => {
  const g = window.game;
  const id = g.logs.items[0].id;
  const before = document.getElementById('toasts').textContent;
  g.openLogPanel(id);
  g.closeLogPanel();
  const toasts = document.getElementById('toasts').textContent;
  return {
    opened: !!id,
    nudgeAfterStepDone: toasts.includes('继续任务：靠近飞船机身按 E 检查') && !before.includes('继续任务'),
  };
});

// 正向：重置任务到第一步（fresh Quests 实例挂在 game 上，loop 只读当前引用）
R.logNudgeEarly = await ev(async () => {
  const g = window.game;
  const { Quests } = await import('/src/systems/quests.js');
  g.quests = new Quests(g);
  g.quests.render();
  const id = g.logs.items.find((i) => !g.collectedLogs.has(i.id))?.id || g.logs.items[1].id;
  g.openLogPanel(id);
  const toastsAfterOpen = document.getElementById('toasts').textContent;
  g.closeLogPanel();
  const toasts = document.getElementById('toasts').textContent;
  return {
    stepIsCheckShip: g.quests.currentStep.id === 'checkShip',
    nudgeShown: toasts.includes('继续任务：靠近飞船机身按 E 检查'),
    notShownWhilePanelOpen: !toastsAfterOpen.includes('继续任务：靠近飞船机身'),
  };
});
await page.screenshot({ path: `${outDir}/log_nudge.png` });

// 6. 图标对比度：强化玻璃（tile 19）主体不透明度、碳（tile 16）亮度
R.icons = await ev(() => {
  const tiles = window.game.ui.tileCanvases;
  const glass = tiles.get(19);
  const carbon = tiles.get(16);
  const sample = (cv, x, y) => {
    const c = cv.getContext('2d');
    const d = c.getImageData(x, y, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  };
  const gBody = sample(glass, 8, 8);
  const gBorder = sample(glass, 0, 0);
  let cMax = 0;
  const cc = carbon.getContext('2d');
  const cd = cc.getImageData(0, 0, 16, 16).data;
  for (let i = 0; i < cd.length; i += 4) cMax = Math.max(cMax, cd[i]);
  return {
    glassBodyAlpha: gBody.a,
    glassBorderAlpha: gBorder.a,
    glassBodyReadable: gBody.a >= 120,
    glassBorderOpaque: gBorder.a === 255,
    carbonMaxRed: cMax,
    carbonBright: cMax >= 230,
  };
});

// 7. 背包界面：图标可见 + 无调试文案
await ev(() => {
  const g = window.game;
  g.running = true; g.input.locked = true; g.wantLock = true;
  g.openBackpack();
});
await sleep(200);
await page.screenshot({ path: `${outDir}/backpack.png` });
R.backpack = await ev(() => {
  const body = document.body.textContent;
  return {
    visible: !document.getElementById('inventory-panel').classList.contains('hidden'),
    hasDevTraces: body.includes('开发') || body.includes('DEBUG') || body.includes('调试'),
  };
});

// 8. 面板打开时 toast 贴底（不再叠在合成列表上）
R.toastPos = await ev(() => {
  const g = window.game;
  g.ui.toast('测试提示 · 扫描完成');
  const open = {
    panelOpenClass: document.body.classList.contains('panel-open'),
    bottom: getComputedStyle(document.getElementById('toasts')).bottom,
  };
  return open;
});
await page.screenshot({ path: `${outDir}/backpack_toast.png` });
R.toastPos.closed = await ev(() => {
  const g = window.game;
  g.closeBackpack();
  return {
    panelOpenClass: document.body.classList.contains('panel-open'),
    bottom: getComputedStyle(document.getElementById('toasts')).bottom,
  };
});

// 9. 设置面板音量控制：滑块存在 → 修改 → 设置与音频总线同步
R.volume = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  g.openSettings();
  const music = document.getElementById('set-musicvol');
  const sfx = document.getElementById('set-sfxvol');
  const labelsBefore = [document.getElementById('set-musicvol-val').textContent, document.getElementById('set-sfxvol-val').textContent];
  music.value = '25'; music.dispatchEvent(new Event('input'));
  sfx.value = '40'; sfx.dispatchEvent(new Event('input'));
  const out = {
    slidersExist: !!music && !!sfx,
    labelsBefore,
    labelsAfter: [document.getElementById('set-musicvol-val').textContent, document.getElementById('set-sfxvol-val').textContent],
    musicVol: g.settings.musicVol,
    sfxVol: g.settings.sfxVol,
    engineMusicVol: g.audio.musicVol,
    engineSfxVol: g.audio.sfxVol,
    busMusicGain: g.audio.musicBus ? Math.round(g.audio.musicBus.gain.value * 100) / 100 : null,
    busMasterGain: g.audio.master ? Math.round(g.audio.master.gain.value * 100) / 100 : null,
  };
  g.closeSettings();
  return out;
});

// 10. 背包整理按钮 + 暂停菜单旅程概览
R.sortAndStats = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  g.inventory.slots[9] = { itemId: 'sodium', count: 3 };
  g.inventory.slots[10] = { itemId: 'stone', count: 5 };
  g.inventory.slots[11] = null;
  g.inventory.slots[12] = { itemId: 'carbon', count: 2 };
  g.inventory.slots[13] = null;
  g.inventory.slots[14] = { itemId: 'ferrite_dust', count: 1 };
  g.openBackpack();
  const sortBtn = document.getElementById('btn-sort');
  sortBtn.click();
  const packAfter = g.inventory.slots.slice(9, 15).map((s) => (s ? s.itemId : null));
  const firstNull = packAfter.indexOf(null);
  const nullsSunk = firstNull >= 0 && packAfter.slice(firstNull).every((s) => s === null);
  g.closeBackpack();
  g.setPaused(true);
  const stats = document.getElementById('pause-stats').textContent;
  const statsHasAll = stats.includes('探索行星') && stats.includes('信用点') && stats.includes('里程碑') && stats.includes('任务');
  g.ui.showPaused(false); g.paused = false;
  return { packAfter, nullsSunk, itemsKept: packAfter.filter(Boolean).length === 4, statsHasAll, stats };
});

R.errors = errors;
console.log(JSON.stringify(R, null, 2));

let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

check('菜单无"(开发)"标签', R.menuTexts && R.menuTexts.hasDevLabel === false);
check('菜单种子行无"按 G 重新生成"', R.menuTexts && R.menuTexts.hasGFreeRegen === false);
check('HUD 快捷键行无"[B] 关面板"', R.menuTexts && R.menuTexts.hudHasBClosePanel === false);
check('开局面板含当前步骤', R.spawnMissions && R.spawnMissions.hasCurrent);
check('开局面板含后续 2 步', R.spawnMissions && R.spawnMissions.hasNext1 && R.spawnMissions.hasNext2);
check('开局面板折叠 14 步', R.spawnMissions && R.spawnMissions.hasFold);
check('开局面板共 4 行', R.spawnMissions && R.spawnMissions.count === 4);
check('开局不剧透比邻星系', R.spawnMissions && R.spawnMissions.spoilsProxima === false);
check('开局不剧透大船', R.spawnMissions && R.spawnMissions.spoilsBigShip === false);
check('开局不剧透空间站', R.spawnMissions && R.spawnMissions.spoilsStation === false);
check('面板标题进度 0/17', R.spawnMissions && R.spawnMissions.title.includes('0/17'));
check('出生视角对准飞船', R.spawnAim && R.spawnAim.facingShip, R.spawnAim && R.spawnAim.delta);
check('飞船高出弹坑边缘 2 格以上', R.spawnAim && R.spawnAim.shipAboveRim, R.spawnAim);
check('出生→坠毁点视线走廊无大树', R.spawnAim && R.spawnAim.sightlineBlocked === 0, R.spawnAim && R.spawnAim.sightlineBlocked);
check('完成 1 步后出现"已完成 1 项"', R.afterCheckShip && R.afterCheckShip.hasDoneLine);
check('完成 1 步后当前=采集基础资源', R.afterCheckShip && R.afterCheckShip.hasCurrent);
check('完成 1 步后折叠 ×13', R.afterCheckShip && R.afterCheckShip.hasFold13);
check('G 键不再重建世界（种子不变）', R.keyG && R.keyG.seedSame);
check('G 键不推进任务', R.keyG && R.keyG.questSame);
check('G 键不传送玩家', R.keyG && R.keyG.posSame);
check('任务完成后再读日志无冗余指引', R.logNudge && R.logNudge.opened && R.logNudge.nudgeAfterStepDone === false);
check('任务第一步读日志关闭后有指引', R.logNudgeEarly && R.logNudgeEarly.nudgeShown);
check('日志面板打开期间不提前弹指引', R.logNudgeEarly && R.logNudgeEarly.notShownWhilePanelOpen);
check('强化玻璃图标主体可读', R.icons && R.icons.glassBodyReadable);
check('强化玻璃图标边框不透明', R.icons && R.icons.glassBorderOpaque);
check('碳图标有高亮像素', R.icons && R.icons.carbonBright);
check('全页面无开发/调试痕迹文案', R.backpack && R.backpack.hasDevTraces === false);
check('背包面板正常打开', R.backpack && R.backpack.visible);
check('面板打开时 toast 贴底 20px', R.toastPos && R.toastPos.panelOpenClass === true && R.toastPos.bottom === '20px');
check('面板关闭后 toast 回到默认位置', R.toastPos && R.toastPos.closed && R.toastPos.closed.panelOpenClass === false && R.toastPos.closed.bottom === '92px');
check('音量滑块存在', R.volume && R.volume.slidersExist);
check('音乐音量修改生效（0.25）', R.volume && R.volume.musicVol === 0.25 && R.volume.engineMusicVol === 0.25, R.volume);
check('音效音量修改生效（0.4）', R.volume && R.volume.sfxVol === 0.4 && R.volume.engineSfxVol === 0.4, R.volume);
check('音频总线增益同步', R.volume && R.volume.busMusicGain === 0.25 && R.volume.busMasterGain === 0.24, R.volume);
check('音量标签文本更新', R.volume && R.volume.labelsAfter[0] === '25%' && R.volume.labelsAfter[1] === '40%', R.volume);
check('整理背包：空位沉底且物品保留', R.sortAndStats && R.sortAndStats.nullsSunk && R.sortAndStats.itemsKept, R.sortAndStats);
check('暂停菜单旅程概览齐全', R.sortAndStats && R.sortAndStats.statsHasAll, R.sortAndStats && R.sortAndStats.stats);
check('无页面错误', errors.length === 0);

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
