// 本轮验证：菜单/面板进出修复——设置覆盖层级、修理页重弹、背包/星图/日志/旅程/空间站开关、
// 指针锁失败不误弹暂停、陈旧按键吞咽
// 运行：node tools/verifypanels.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots35';
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
// 钉住游戏态并关闭所有面板（无头环境 pointerlock 事件在各 eval 之间漂移，
// 参照 verifynpc 的做法：每个驱动 eval 内部先钉住再操作；wantLock=true 可
// 让异步 lockchange(false) 走"重试待锁"分支而不是弹暂停）
const pin = (opts = {}) => ev((o) => {
  const g = window.game;
  const ui = g.ui;
  ui.showBackpack(false); ui.showRepair(false); ui.showStation(false);
  ui.showLog(false); ui.showStarMap(false); ui.showSettings(false); ui.showJourney(false);
  ui.showPaused(false);
  g.running = true;
  g.paused = !!o.paused;
  g.docked = false;
  g.refreshInMenu();
  g.input.locked = true;
  g.wantLock = true;
  g.relockGrace = performance.now();
  g.clearRelockRetry();
  if (o.piloting !== undefined) g.flight.piloting = o.piloting;
}, opts);

await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
});
await sleep(200);

// 1. 设置面板盖在暂停菜单之上（z-index 层叠）→ Esc 返回暂停 → Esc 恢复
R.settingsOverPause = await ev(() => {
  const g = window.game;
  g.running = true; g.wantLock = true; g.input.locked = true;
  g.setPaused(true);
  const pauseShown = !document.getElementById('paused').classList.contains('hidden');
  g.openSettings();
  const sp = document.getElementById('settings-panel');
  const pa = document.getElementById('paused');
  const zSp = +getComputedStyle(sp).zIndex, zPa = +getComputedStyle(pa).zIndex;
  const r = sp.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    pauseShownBefore: pauseShown,
    settingsVisible: g.ui.settingsVisible(),
    pauseStillBehind: !pa.classList.contains('hidden'),
    zAbovePause: zSp > zPa,
    topHitInsideSettings: sp.contains(el),
  };
});
await sleep(150);
await page.screenshot({ path: `${outDir}/settings_over_pause.png` });
R.settingsEscToPause = await ev(() => {
  const g = window.game;
  g.paused = true;
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  return {
    settingsClosed: !g.ui.settingsVisible(),
    pauseStillShown: !document.getElementById('paused').classList.contains('hidden'),
    paused: g.paused,
    inMenu: g.inMenu,
  };
});
R.pauseEscResume = await ev(() => {
  const g = window.game;
  g.paused = true;
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  return {
    paused: g.paused,
    pauseHidden: document.getElementById('paused').classList.contains('hidden'),
  };
});

// 2. 设置面板盖在主菜单之上 → Esc 返回主菜单
R.settingsOverMenu = await ev(() => {
  const g = window.game;
  g.exitToMenu();
  const menuShown = !document.getElementById('menu').classList.contains('hidden');
  g.openSettings();
  const sp = document.getElementById('settings-panel');
  const zSp = +getComputedStyle(sp).zIndex, zMenu = +getComputedStyle(document.getElementById('menu')).zIndex;
  const r = sp.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    menuShownBefore: menuShown,
    settingsVisible: g.ui.settingsVisible(),
    zAboveMenu: zSp > zMenu,
    topHitInsideSettings: sp.contains(el),
  };
});
await sleep(150);
await page.screenshot({ path: `${outDir}/settings_over_menu.png` });
R.settingsEscToMenu = await ev(() => {
  const g = window.game;
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  return {
    settingsClosed: !g.ui.settingsVisible(),
    menuStillShown: !document.getElementById('menu').classList.contains('hidden'),
    inMenu: g.inMenu,
  };
});

// 3. 修理面板：E 打开 → 面板打开期间残留 E + Esc 关闭 → 不重弹（历史 bug 修复）
await ev(() => { const g = window.game; g.startPlaying(); });
await pin();
await sleep(120);
R.repairNoReopen = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.player.pos.x = g.world.crashX - 6;
  g.player.pos.z = g.world.crashZ;
  // E 打开修理面板（补足累计器保证本帧至少一个固定步长，消除 0 步帧影响）
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.accumulator += 0.1;
  g.loop();
  const opened = g.ui.repairVisible() && g.inMenu === true;
  // 面板打开期间用户又按了一次 E（陈旧边沿，存活 2 帧）
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  // 同帧按 Esc 关闭
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  const closed = !g.ui.repairVisible() && g.inMenu === false;
  // 重锁恢复后再跑一帧：确认不会因陈旧 E 重开
  g.accumulator += 0.1;
  g.loop();
  const stillClosed = !g.ui.repairVisible();
  return { opened, closed, stillClosed, wantLock: g.wantLock };
});
await sleep(150);
await page.screenshot({ path: `${outDir}/repair_closed.png` });

// 4. 按住 E 不放：关闭面板后不得立即重开（边沿语义）
R.repairHeldE = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.accumulator += 0.1;
  g.loop();
  const opened = g.ui.repairVisible();
  g.input.down.add('KeyE'); // 模拟按住不放
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  const closed = !g.ui.repairVisible() && g.inMenu === false;
  g.accumulator += 0.1;
  g.loop(); // 再跑一帧（down 里仍有 E）
  const stillClosed = !g.ui.repairVisible();
  g.input.down.delete('KeyE');
  return { opened, closed, stillClosed };
});

// 5. 重锁失败（浏览器冷却/拒绝）不得误弹暂停；wantLock 保持待重试
R.relockFailNoPause = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.accumulator += 0.1;
  g.loop();
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  const wantLockAfterClose = g.wantLock === true;
  g.input.onLockChange(false); // 指针锁请求失败 → 不应弹暂停
  const pausedAfterFail = g.paused;
  g.input.onGesture('key', 'KeyW'); // 手势兜底重试 → wantLock 保持
  const wantLockStillArmed = g.wantLock === true;
  return { wantLockAfterClose, pausedAfterFail, wantLockStillArmed };
});

// 5b. 关面板后的 Esc 缓冲窗口：第二下 Esc 只重试锁、不弹暂停（历史 bug 修复）
R.escGraceNoPause = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.accumulator += 0.1;
  g.loop(); // E 打开修理面板
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop(); // Esc 关闭 → 进入重锁待处理
  const wantLockAfterClose = g.wantLock === true;
  const graceSet = g.relockGrace > 0;
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop(); // 缓冲窗口内的第二下 Esc → 吞掉，不弹暂停
  return {
    wantLockAfterClose, graceSet,
    pausedAfterSecondEsc: g.paused,
    pauseHidden: document.getElementById('paused').classList.contains('hidden'),
  };
});

// 5c. 缓冲期过后 Esc 正常打开暂停（卡死态仍可暂停）
R.escAfterGracePauses = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.relockGrace = performance.now() - 2000;
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  const paused = g.paused && !document.getElementById('paused').classList.contains('hidden');
  g.setPaused(false);
  g.wantLock = false;
  return { paused };
});

// 5d. Esc keydown 拦截浏览器默认动作（退出浏览器全屏）
R.escPreventDefault = await ev(() => {
  const g = window.game;
  const evt = new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true });
  window.dispatchEvent(evt);
  const prevented = evt.defaultPrevented === true;
  g.input.pressedSet.delete('Escape');
  g.input.pressedAge.delete('Escape');
  return { prevented };
});

// 5e. 重锁失败 → 定时自动重试已排程（光标自由状态自愈）
R.relockRetryScheduled = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.relockGrace = performance.now();
  g.input.onLockChange(false);
  const scheduled = !!g.relockRetryTimer;
  g.clearRelockRetry();
  return { scheduled };
});

// 6. 背包：Tab 开 → Tab 关 → Tab 开 → Esc 关
await pin();
R.backpack = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.input.pressedSet.add('Tab'); g.input.pressedAge.set('Tab', g.input.age);
  g.loop();
  const opened = g.ui.backpackVisible() && g.inMenu === true;
  g.input.pressedSet.add('Tab'); g.input.pressedAge.set('Tab', g.input.age);
  g.loop();
  const closedByTab = !g.ui.backpackVisible() && g.inMenu === false;
  g.input.pressedSet.add('Tab'); g.input.pressedAge.set('Tab', g.input.age);
  g.loop();
  const reopened = g.ui.backpackVisible();
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  const closedByEsc = !g.ui.backpackVisible() && g.inMenu === false;
  return { opened, closedByTab, reopened, closedByEsc };
});

// 7. 星图（太空）：M 开 → Esc 关
await pin({ piloting: true });
R.starmap = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.flight.piloting = true;
  g.flight.pos.set(g.world.crashX, g.world.getGroundY(g.world.crashX, g.world.crashZ) + 260, g.world.crashZ);
  g.space.enterSpace();
  g.space.update(0.016);
  const inSpace = g.space.active === true;
  g.input.pressedSet.add('KeyM'); g.input.pressedAge.set('KeyM', g.input.age);
  g.loop();
  const opened = g.ui.starMapVisible() && g.inMenu === true;
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  const closed = !g.ui.starMapVisible() && g.inMenu === false;
  return { inSpace, opened, closed };
});

// 8. 空间站：E 停靠 → 面板开 → Esc 离站
R.station = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.flight.piloting = true;
  g.space.update(0.016);
  const st = g.space.stationGroup;
  const v = new (st.position.constructor)(0, 0, 0);
  st.getWorldPosition(v);
  g.flight.pos.set(v.x - 30, v.y - 5, v.z - 20);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.update(0.016);
  const near = g.stationNear;
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.flight.update(1 / 60);
  const docked = g.docked && g.ui.stationVisible() && g.inMenu === true;
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  const undocked = !g.docked && !g.ui.stationVisible() && g.inMenu === false;
  return { near, docked, undocked };
});
await sleep(150);
await page.screenshot({ path: `${outDir}/station_after_undock.png` });

// 9. 数据日志：靠近按 E 打开 → Esc 关闭
R.log = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.space.forceExit();
  g.flight.piloting = false;
  g.flight.launched = false;
  const it = g.logs.items[0];
  g.player.pos.x = it.group.position.x;
  g.player.pos.z = it.group.position.z;
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.accumulator += 0.1;
  g.loop();
  const opened = g.ui.logVisible() && g.inMenu === true && g.collectedLogs.has(it.id);
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  const closed = !g.ui.logVisible() && g.inMenu === false;
  return { opened, closed };
});

// 10. 旅程面板：打开 → Esc 关闭
R.journey = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.showJourney();
  const opened = g.ui.journeyVisible() && g.inMenu === true;
  g.input.pressedSet.add('Escape'); g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  const closed = !g.ui.journeyVisible() && g.inMenu === false;
  return { opened, closed };
});

// 11. B 键（KEY.CLOSE）关闭所有面板——主关闭键；Esc 仅为兜底
R.closeKeyBackpack = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.input.pressedSet.add('Tab'); g.input.pressedAge.set('Tab', g.input.age);
  g.loop();
  const opened = g.ui.backpackVisible();
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.loop();
  return { opened, closed: !g.ui.backpackVisible() && g.inMenu === false };
});
R.closeKeyRepair = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  // 前面空间站章节把船体移到了太空 → 复位到坠机点
  g.ship.setPosition(g.world.crashX, g.world.getGroundY(g.world.crashX, g.world.crashZ) + 0.05, g.world.crashZ);
  g.player.pos.x = g.world.crashX - 6;
  g.player.pos.z = g.world.crashZ;
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.accumulator += 0.1;
  g.loop();
  const opened = g.ui.repairVisible();
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.loop();
  return { opened, closed: !g.ui.repairVisible() && g.inMenu === false };
});
R.closeKeyStarmap = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.flight.piloting = true;
  g.flight.pos.set(g.world.crashX, g.world.getGroundY(g.world.crashX, g.world.crashZ) + 260, g.world.crashZ);
  g.space.enterSpace();
  g.space.update(0.016);
  g.input.pressedSet.add('KeyM'); g.input.pressedAge.set('KeyM', g.input.age);
  g.loop();
  const opened = g.ui.starMapVisible();
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.loop();
  return { opened, closed: !g.ui.starMapVisible() && g.inMenu === false };
});
R.closeKeyStation = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.flight.piloting = true;
  g.space.update(0.016);
  const st = g.space.stationGroup;
  const v = new (st.position.constructor)(0, 0, 0);
  st.getWorldPosition(v);
  g.flight.pos.set(v.x - 30, v.y - 5, v.z - 20);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.update(0.016);
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.flight.update(1 / 60);
  const docked = g.docked && g.ui.stationVisible();
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.loop();
  return { docked, undocked: !g.docked && !g.ui.stationVisible() && g.inMenu === false };
});
R.closeKeyLog = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.space.forceExit();
  g.flight.piloting = false;
  g.flight.launched = false;
  const it = g.logs.items[1]; // items[0] 已在前面章节被收集 → 用未读日志
  g.player.pos.x = it.group.position.x;
  g.player.pos.z = it.group.position.z;
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.accumulator += 0.1;
  g.loop();
  const opened = g.ui.logVisible();
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.loop();
  return { opened, closed: !g.ui.logVisible() && g.inMenu === false };
});
R.closeKeyJourney = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.showJourney();
  const opened = g.ui.journeyVisible();
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.loop();
  return { opened, closed: !g.ui.journeyVisible() && g.inMenu === false };
});
R.closeKeySettingsOverPause = await ev(() => {
  const g = window.game;
  g.running = true; g.wantLock = true; g.input.locked = true;
  g.setPaused(true);
  g.openSettings();
  const opened = g.ui.settingsVisible();
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.loop();
  return {
    opened,
    closed: !g.ui.settingsVisible(),
    pauseStillShown: !document.getElementById('paused').classList.contains('hidden'),
    paused: g.paused,
  };
});
R.closeKeySettingsOverMenu = await ev(() => {
  const g = window.game;
  g.exitToMenu();
  g.openSettings();
  const opened = g.ui.settingsVisible();
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.loop();
  return {
    opened,
    closed: !g.ui.settingsVisible(),
    menuStillShown: !document.getElementById('menu').classList.contains('hidden'),
  };
});
// B 在游戏进行中无副作用（不开面板/不暂停）
R.closeKeyNoOpWhilePlaying = await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.input.locked = true; g.wantLock = true;
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.loop();
  return {
    running: g.running,
    paused: g.paused,
    inMenu: g.inMenu,
    anyPanel: g.ui.backpackVisible() || g.ui.repairVisible() || g.ui.stationVisible()
      || g.ui.logVisible() || g.ui.starMapVisible() || g.ui.settingsVisible() || g.ui.journeyVisible(),
  };
});
// 提示文案已改为 B
R.closeKeyHint = await ev(() => ({
  repairHint: document.querySelector('#repair-panel .repair-hint').textContent,
  stationHint: document.querySelector('#station-panel .repair-hint').textContent,
  logHint: document.querySelector('#log-panel .repair-hint').textContent,
  hudHint: document.querySelector('#hints .hint-line').textContent,
}));

// 汇总断言
const fails = [];
const check = (name, cond, detail) => {
  if (!cond) fails.push(`${name}: ${JSON.stringify(detail)}`);
};
check('settingsOverPause', R.settingsOverPause.settingsVisible && R.settingsOverPause.zAbovePause
  && R.settingsOverPause.topHitInsideSettings && R.settingsOverPause.pauseStillBehind, R.settingsOverPause);
check('settingsEscToPause', R.settingsEscToPause.settingsClosed && R.settingsEscToPause.pauseStillShown
  && R.settingsEscToPause.paused === true && R.settingsEscToPause.inMenu === false, R.settingsEscToPause);
check('pauseEscResume', R.pauseEscResume.paused === false && R.pauseEscResume.pauseHidden, R.pauseEscResume);
check('settingsOverMenu', R.settingsOverMenu.settingsVisible && R.settingsOverMenu.zAboveMenu
  && R.settingsOverMenu.topHitInsideSettings && R.settingsOverMenu.menuShownBefore, R.settingsOverMenu);
check('settingsEscToMenu', R.settingsEscToMenu.settingsClosed && R.settingsEscToMenu.menuStillShown
  && R.settingsEscToMenu.inMenu === false, R.settingsEscToMenu);
check('repairNoReopen', R.repairNoReopen.opened && R.repairNoReopen.closed && R.repairNoReopen.stillClosed, R.repairNoReopen);
check('repairHeldE', R.repairHeldE.opened && R.repairHeldE.closed && R.repairHeldE.stillClosed, R.repairHeldE);
check('relockFailNoPause', R.relockFailNoPause.wantLockAfterClose && R.relockFailNoPause.pausedAfterFail === false
  && R.relockFailNoPause.wantLockStillArmed, R.relockFailNoPause);
check('escGraceNoPause', R.escGraceNoPause.wantLockAfterClose && R.escGraceNoPause.graceSet
  && R.escGraceNoPause.pausedAfterSecondEsc === false && R.escGraceNoPause.pauseHidden, R.escGraceNoPause);
check('escAfterGracePauses', R.escAfterGracePauses.paused === true, R.escAfterGracePauses);
check('escPreventDefault', R.escPreventDefault.prevented === true, R.escPreventDefault);
check('relockRetryScheduled', R.relockRetryScheduled.scheduled === true, R.relockRetryScheduled);
check('backpack', R.backpack.opened && R.backpack.closedByTab && R.backpack.reopened && R.backpack.closedByEsc, R.backpack);
check('starmap', R.starmap.inSpace && R.starmap.opened && R.starmap.closed, R.starmap);
check('station', R.station.near && R.station.docked && R.station.undocked, R.station);
check('log', R.log.opened && R.log.closed, R.log);
check('journey', R.journey.opened && R.journey.closed, R.journey);
check('closeKeyBackpack', R.closeKeyBackpack.opened && R.closeKeyBackpack.closed, R.closeKeyBackpack);
check('closeKeyRepair', R.closeKeyRepair.opened && R.closeKeyRepair.closed, R.closeKeyRepair);
check('closeKeyStarmap', R.closeKeyStarmap.opened && R.closeKeyStarmap.closed, R.closeKeyStarmap);
check('closeKeyStation', R.closeKeyStation.docked && R.closeKeyStation.undocked, R.closeKeyStation);
check('closeKeyLog', R.closeKeyLog.opened && R.closeKeyLog.closed, R.closeKeyLog);
check('closeKeyJourney', R.closeKeyJourney.opened && R.closeKeyJourney.closed, R.closeKeyJourney);
check('closeKeySettingsOverPause', R.closeKeySettingsOverPause.opened && R.closeKeySettingsOverPause.closed
  && R.closeKeySettingsOverPause.pauseStillShown && R.closeKeySettingsOverPause.paused === true, R.closeKeySettingsOverPause);
check('closeKeySettingsOverMenu', R.closeKeySettingsOverMenu.opened && R.closeKeySettingsOverMenu.closed
  && R.closeKeySettingsOverMenu.menuStillShown, R.closeKeySettingsOverMenu);
check('closeKeyNoOpWhilePlaying', R.closeKeyNoOpWhilePlaying.running && R.closeKeyNoOpWhilePlaying.paused === false
  && R.closeKeyNoOpWhilePlaying.inMenu === false && !R.closeKeyNoOpWhilePlaying.anyPanel, R.closeKeyNoOpWhilePlaying);
// 提示文案已改为 B（HUD 常驻快捷键行不含"[B] 关面板"——B 只在面板打开时有效，
// 各面板自己的提示栏会显示 [B]；HUD 行放 [B] 会让玩家误以为游戏中随时可按 B）
check('closeKeyHint', R.closeKeyHint.repairHint.includes('[B]') && R.closeKeyHint.stationHint.includes('[B]')
  && R.closeKeyHint.logHint.includes('[B]') && !R.closeKeyHint.hudHint.includes('[B] 关面板'), R.closeKeyHint);

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('CHECKS:', fails.length ? 'FAIL\n' + fails.join('\n') : 'all passed');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
if (fails.length || errors.length) process.exitCode = 1;
