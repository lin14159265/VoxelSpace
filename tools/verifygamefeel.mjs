// 核心乐趣回归：移动手感（疾跑/FOV 冲击/跳跃缓冲）、生存禁飞、任务配方高亮、首次入夜提示
// 运行：node tools/verifygamefeel.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots-gamefeel';
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

// 1. 疾跑：W+Ctrl 前进时水平速度显著高于步行，FOV 有冲击
R.sprint = await ev(() => {
  const g = window.game; const p = g.player;
  g.creative = false; p.flyMode = false;
  const gy = g.world.getGroundY(p.pos.x, p.pos.z);
  p.pos.set(8.5, gy + 0.1, 8.5); p.vel.set(0, 0, 0); p.onGround = true;
  const baseFov = g.settings.fov || 75;
  g.camera.fov = baseFov; g.camera.updateProjectionMatrix();
  g.input.down.add('KeyW');
  for (let i = 0; i < 30; i++) p.update(1 / 60);
  const walkSpeed = Math.hypot(p.vel.x, p.vel.z);
  g.input.down.add('ControlLeft');
  for (let i = 0; i < 30; i++) p.update(1 / 60);
  const sprintSpeed = Math.hypot(p.vel.x, p.vel.z);
  const sprintFov = g.camera.fov;
  g.input.down.delete('KeyW'); g.input.down.delete('ControlLeft');
  for (let i = 0; i < 45; i++) p.update(1 / 60);
  const settleFov = g.camera.fov;
  return { walked: Number(walkSpeed.toFixed(2)), sprint: Number(sprintSpeed.toFixed(2)), sprintFov: Number(sprintFov.toFixed(2)), settleFov: Number(settleFov.toFixed(2)) };
});
check('疾跑速度 ×1.45', R.sprint && R.sprint.sprint > R.sprint.walked * 1.3, R.sprint);
check('疾跑 FOV 冲击并回落', R.sprint && R.sprint.sprintFov > (R.sprint.settleFov + 1), R.sprint);

// 2. 生存模式按 X 不得开启免费飞行
R.noFreeFlight = await ev(() => {
  const g = window.game; const p = g.player;
  g.creative = false; p.flyMode = false;
  g.input.pressedSet.add('KeyX'); g.input.pressedAge.set('KeyX', g.input.age);
  for (let i = 0; i < 6; i++) p.update(1 / 60);
  return { flyMode: p.flyMode, creative: g.creative };
});
check('生存模式 X 不送飞行', R.noFreeFlight && R.noFreeFlight.flyMode === false && R.noFreeFlight.creative === false, R.noFreeFlight);

// 2b. 游戏进行中创造模式开关锁定（防止一键上帝模式短路生存玩法）
R.creativeLock = await ev(() => {
  const g = window.game;
  g.openSettings();
  const btn = document.getElementById('set-mode');
  const r = { running: g.running, disabled: btn.disabled };
  g.closeSettings();
  return r;
});
check('游戏进行中锁定创造模式切换', R.creativeLock && R.creativeLock.running && R.creativeLock.disabled, R.creativeLock);

// 3. 跳跃缓冲：空中提前按空格，触地瞬间起跳（"按了没跳"修复）
R.jumpBuffer = await ev(() => {
  const g = window.game; const p = g.player;
  g.creative = false; p.flyMode = false;
  const gy = g.world.getGroundY(p.pos.x, p.pos.z);
  p.pos.set(8.5, gy + 0.6, 8.5); p.vel.set(0, -7, 0); p.onGround = false;
  p.jumpBuffer = 0; p.coyoteTimer = 0;
  g.input.pressedSet.add('Space'); g.input.pressedAge.set('Space', g.input.age);
  let bounced = false;
  for (let i = 0; i < 20; i++) {
    p.update(1 / 60);
    if (p.onGround) { bounced = false; }
    if (p.jumpBuffer === 0 && p.vel.y > 7) { bounced = true; break; }
  }
  g.input.pressedSet.delete('Space');
  p.vel.set(0, 0, 0); p.pos.y = gy + 0.2;
  return { bounced, vy: Number(p.vel.y.toFixed(2)) };
});
check('落地前 0.12s 按跳跃会被缓冲执行', R.jumpBuffer && R.jumpBuffer.bounced === true, R.jumpBuffer);

// 4. 任务配方高亮置顶：craftTool 步骤打开背包，第一个配方应为多功能工具并带任务标记
R.questRecipe = await ev(() => {
  const g = window.game;
  g.quests.currentIndex = 2; // craftTool
  g.openBackpack();
  const first = document.querySelector('#craft-list .craft-item');
  const badge = first ? first.querySelector('.craft-quest-badge') : null;
  const r = {
    firstRecipe: first ? first.dataset.recipe : null,
    focused: first ? first.classList.contains('quest-focus') : false,
    badge: badge ? badge.textContent.trim() : null,
  };
  g.closeBackpack();
  return r;
});
check('当前任务配方置顶高亮', R.questRecipe && R.questRecipe.firstRecipe === 'multitool' && R.questRecipe.focused && R.questRecipe.badge === '当前任务', R.questRecipe);

// 5. 首次入夜生存提示（只提示一次，白昼重置）
R.firstNight = await ev(() => {
  const g = window.game;
  g.nightWarned = false;
  g.sky.timeSec = g.sky.dayLength * 0.75; // 夜间
  g.accumulator = 0.03;
  const before = document.getElementById('toasts').textContent;
  g.clock.getDelta(); g.loop();
  g.accumulator = 0.03;
  g.clock.getDelta(); g.loop();
  const after = document.getElementById('toasts').textContent;
  const warned = g.nightWarned === true;
  const hasText = after.includes('夜幕降临') && after.includes('钠花') && after.includes('庇护所');
  g.sky.timeSec = g.sky.dayLength * 0.1;
  g.accumulator = 0.03; g.clock.getDelta(); g.loop();
  g.accumulator = 0.03; g.clock.getDelta(); g.loop();
  const reset = g.nightWarned === false;
  return { warned, hasText, reset, changed: after !== before };
});
check('首次入夜提示并白昼重置', R.firstNight && R.firstNight.warned && R.firstNight.hasText && R.firstNight.reset, R.firstNight);

await page.screenshot({ path: `${outDir}/gamefeel.png` });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const ok = allOk() && errors.length === 0;
console.log(ok ? 'CHECKS: all passed' : 'CHECKS: failed');
await browser.close();
if (!ok) process.exit(1);
