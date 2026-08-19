// 第 18 轮验证：开场俯瞰镜头（新游戏触发/继续存档跳过/按键跳过/自然结束/输入抑制/HUD 隐藏）
// + 背景音乐（菜单模式→游戏模式→返回菜单切换、手势后开播、无泄漏）
// 运行：node tools/verifyintro.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const outDir = 'shots42';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const ctx = await browser.newContext();
const errors = [];

async function freshPage(seed) {
  const page = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  // 真·新玩家：清掉上一节可能写入的存档（beforeunload 自动存档会残留）
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`http://localhost:8080/?seed=${seed}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
  // 音乐请求在 init() 收尾时写入；等它落盘再断言，避免快机器上的竞态。
  await page.waitForFunction(() => window.game.audio && window.game.audio.musicRequested === 'menu', null, { timeout: 10000 });
  return page;
}

const R = {};

// 1. 新游戏：点"开始"→ 开场镜头激活、HUD 隐藏、相机高空、输入被抑制
{
  const page = await freshPage('27182818');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.game.intro.active === true, null, { timeout: 30000 });
  // 检测到即读：淡入遮罩只在 t<0.66s 内存在，等 450ms 会错过窗口（flaky）
  R.startEarly = await page.evaluate(() => {
    const g = window.game;
    return {
      camY: g.camera.position.y,
      playerY: g.player.pos.y,
      fade: +getComputedStyle(document.getElementById('intro-fade')).opacity,
      introActive: g.intro.active,
      hudHidden: document.getElementById('hud').classList.contains('hidden'),
      gunHidden: !g.player.gun.visible,
    };
  });
  await page.waitForTimeout(1100); // 到 ~1.2s，验证输入抑制（此时镜头已低飞）
  R.start = await page.evaluate(() => {
    const g = window.game;
    const before = { x: g.player.pos.x, y: g.player.pos.y, z: g.player.pos.z };
    // 注入 W 前进键并跑 3 帧：开场镜头期间玩家不应移动
    g.input.pressedSet.add('KeyW'); g.input.pressedAge.set('KeyW', g.input.age);
    g.input.down.add('KeyW');
    g.accumulator += 0.1; g.loop(); g.loop(); g.loop();
    const moved = Math.abs(g.player.pos.x - before.x) + Math.abs(g.player.pos.z - before.z) > 0.01;
    return {
      introActive: g.intro.active,
      hudHidden: document.getElementById('hud').classList.contains('hidden'),
      playerSuppressed: !moved,
      running: g.running,
    };
  });
  await page.screenshot({ path: `${outDir}/intro_high.png` });
  await page.close();
}

// 2. 按键跳过（真实键盘事件 → onGesture → endIntro）
{
  const page = await freshPage('31415926');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.game.intro.active === true, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  R.skip = await page.evaluate(() => {
    const g = window.game;
    return {
      introActive: g.intro.active,
      hudVisible: !document.getElementById('hud').classList.contains('hidden'),
      fadeCleared: +getComputedStyle(document.getElementById('intro-fade')).opacity === 0,
      toastShown: document.getElementById('toasts').textContent.includes('意识恢复'),
      camAtEye: Math.abs(g.camera.position.y - (g.player.pos.y + 1.62)) < 0.05,
    };
  });
  await page.close();
}

// 3. 自然播完（快进到最后 0.1s → loop 结束镜头）
{
  const page = await freshPage('16180339');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.game.intro.active === true, null, { timeout: 30000 });
  R.natural = await page.evaluate(() => {
    const g = window.game;
    g.intro.t = g.intro.dur - 0.005; // 一帧后自然到达终点（dt 可能很小，循环驱动直到结束）
    let guard = 0;
    while (g.intro.active && guard++ < 10) g.loop();
    return {
      introActive: g.intro.active,
      hudVisible: !document.getElementById('hud').classList.contains('hidden'),
      camAtEye: Math.abs(g.camera.position.y - (g.player.pos.y + 1.62)) < 0.05,
    };
  });
  await page.screenshot({ path: `${outDir}/intro_end.png` });
  await page.close();
}

// 4. 继续存档：不播开场镜头
{
  const page = await freshPage('27182818');
  await page.evaluate(async () => {
    const g = window.game;
    g.startPlaying();
    g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
    const { saveGame } = await import('/src/systems/save.js');
    saveGame(g);
  });
  await page.waitForTimeout(300);
  const page2 = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
  page2.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page2.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page2.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
  await page2.click('#btn-continue');
  await page2.waitForTimeout(800);
  R.continueGame = await page2.evaluate(() => ({
    introActive: window.game.intro.active,
    hudVisible: !document.getElementById('hud').classList.contains('hidden'),
    running: window.game.running,
  }));
  await page2.close();
  await page.close();
}

// 5. 背景音乐：菜单请求 → 游戏模式 → 返回菜单 → 停止干净
{
  const page = await freshPage('27182818');
  // 第 4 节写入了存档（btn-start 会被隐藏）→ 清档后重载，还原"新玩家"菜单
  await page.evaluate(() => localStorage.removeItem('voxelspace-save-v1'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
  await page.waitForFunction(() => window.game.audio && window.game.audio.musicRequested === 'menu', null, { timeout: 10000 });
  R.musicMenu = await page.evaluate(() => ({
    requested: window.game.audio.musicRequested,
    on: window.game.audio.musicOn,
  }));
  await page.click('#btn-start');
  await page.waitForFunction(() => window.game.intro.active === true, null, { timeout: 30000 });
  R.musicGame = await page.evaluate(() => {
    const a = window.game.audio;
    return { ctxExists: !!a.ctx, on: a.musicOn, mode: a.musicMode, nodes: a.musicNodes ? a.musicNodes.length : 0 };
  });
  R.musicBackToMenu = await page.evaluate(() => {
    const g = window.game;
    g.exitToMenu();
    const a = g.audio;
    return { mode: a.musicMode, on: a.musicOn };
  });
  await page.close();
}

console.log(JSON.stringify({ R, errors }, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('新游戏触发开场镜头', R.start && R.start.introActive === true);
check('镜头期间 HUD 隐藏', R.start && R.start.hudHidden);
check('镜头早期相机高空俯瞰', R.startEarly && R.startEarly.camY > R.startEarly.playerY + 5, R.startEarly);
check('镜头早期淡入遮罩在场', R.startEarly && R.startEarly.fade > 0.1, R.startEarly && R.startEarly.fade);
check('镜头期间枪模隐藏', R.startEarly && R.startEarly.gunHidden);
check('镜头期间玩家输入被抑制', R.start && R.start.playerSuppressed);
check('任意按键跳过镜头', R.skip && R.skip.introActive === false && R.skip.hudVisible && R.skip.toastShown);
check('跳过后相机回到眼睛', R.skip && R.skip.camAtEye);
check('跳过后遮罩清除', R.skip && R.skip.fadeCleared);
check('自然播完自动结束', R.natural && R.natural.introActive === false && R.natural.hudVisible);
check('自然结束后相机在眼睛', R.natural && R.natural.camAtEye);
check('继续存档不播镜头', R.continueGame && R.continueGame.introActive === false && R.continueGame.running === true);
check('菜单音乐在首帧已请求', R.musicMenu && R.musicMenu.requested === 'menu');
check('手势后音乐开播（游戏模式）', R.musicGame && R.musicGame.ctxExists && R.musicGame.on && R.musicGame.mode === 'game');
check('音乐节点已建立', R.musicGame && R.musicGame.nodes >= 6);
check('返回菜单切回菜单音乐', R.musicBackToMenu && R.musicBackToMenu.on && R.musicBackToMenu.mode === 'menu');
check('无页面错误', errors.length === 0, errors.slice(0, 3));

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
