// 本轮验证：NPC 对话（空间站人员页）+ 数据日志收集（读取/存档/提示）
// 运行：node tools/verifynpc.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '16180339';
const outDir = 'shots32';
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
  g.input.locked = true;
  g.setPaused(false);
});
await sleep(400);

// 1. 停靠空间站 → 人员页 → NPC 对话
await ev(() => {
  const g = window.game;
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  g.space.update(0.016);
  const st = g.space.stationGroup;
  g.space.tmpV.set(0, 0, 0);
  st.getWorldPosition(g.space.tmpV);
  g.flight.pos.set(g.space.tmpV.x - 30, g.space.tmpV.y - 5, g.space.tmpV.z - 20);
  g.space.update(0.016);
  g.input.pressedSet.add('KeyE');
  g.input.pressedAge.set('KeyE', g.input.age);
  g.flight.update(1 / 60);
});
R.docked = await ev(() => window.game.docked && window.game.ui.stationVisible());
await ev(() => window.game.ui.onStationTab && window.game.ui.onStationTab('crew'));
R.crew = await ev(() => {
  const rows = document.querySelectorAll('#station-body .npc-row');
  return { npcCount: rows.length, names: [...document.querySelectorAll('#station-body .station-name')].map((e) => e.textContent) };
});
await page.screenshot({ path: `${outDir}/crew.png` });
// 点击第一名 NPC → 对话；下一句 → 变化；返回 → 列表
R.dialogue = await ev(() => {
  document.querySelector('#station-body [data-npc="kaela"]').click();
  const line1 = document.querySelector('#station-body .npc-dialogue').textContent;
  document.querySelector('#station-body [data-npc-line]').click();
  const line2 = document.querySelector('#station-body .npc-dialogue').textContent;
  const changed = line1 !== line2;
  document.querySelector('#station-body [data-npc-back]').click();
  const backToList = document.querySelectorAll('#station-body .npc-row').length === 3;
  return { line1: line1.slice(0, 24), line2: line2.slice(0, 24), changed, backToList };
});
await page.screenshot({ path: `${outDir}/npc_dialogue.png` });

// 1b. 状态感知对话：购大船后泰莎台词更新（不再说"蓝图封存"）
R.stateLines = await ev(() => {
  const g = window.game;
  g.inventory.addItem('credits', 5000);
  g.handleStationAction('upgrade', 'engine1', 1);
  g.handleStationAction('upgrade', 'engine2', 1);
  g.handleStationAction('upgrade', 'shield1', 1);
  g.handleStationAction('upgrade', 'bigship', 1);
  g.renderStationUI('crew');
  document.querySelector('#station-body [data-npc="tessa"]').click();
  let seen = null, guard = 0;
  while (guard++ < 10) {
    const line = document.querySelector('#station-body .npc-dialogue').textContent;
    if (line.includes('曙光号交给你了')) { seen = line; break; }
    document.querySelector('#station-body [data-npc-line]').click();
  }
  document.querySelector('#station-body [data-npc-back]').click();
  // 站长在买大船后的台词
  document.querySelector('#station-body [data-npc="kaela"]').click();
  let kaelaSeen = null; guard = 0;
  while (guard++ < 10) {
    const line = document.querySelector('#station-body .npc-dialogue').textContent;
    if (line.includes('曙光号已经出坞')) { kaelaSeen = line; break; }
    document.querySelector('#station-body [data-npc-line]').click();
  }
  document.querySelector('#station-body [data-npc-back]').click();
  return { tessaUpdated: !!seen, kaelaUpdated: !!kaelaSeen };
});
await page.screenshot({ path: `${outDir}/npc_state.png` });

// 2. 离站回地面 → 数据日志
await ev(() => {
  const g = window.game;
  g.space.forceExit(); g.flight.piloting = false;
  g.ui.showStation(false); g.docked = false; // 关闭站台面板（真实流程下站台与日志面板不会并存）
  // 无头环境指针锁事件可能扰动 paused/locked → 钉住状态
  g.running = true; g.paused = false; g.input.locked = true; g.inMenu = false;
});
R.logsWorld = await ev(() => {
  const g = window.game;
  return { logCount: g.logs ? g.logs.items.length : 0, collected: [...g.collectedLogs] };
});
// 走近第一处日志（坠毁点 + (7,-4)）
await ev(() => {
  const g = window.game;
  const it = g.logs.items[0];
  g.player.pos.set(it.group.position.x, g.world.getGroundY(it.group.position.x, it.group.position.z) + 2.0, it.group.position.z);
  g.player.yaw = -Math.PI / 2; g.player.pitch = -0.2;
  g.player.updateCamera();
});
await sleep(300);
await page.screenshot({ path: `${outDir}/log_in_world.png` });
R.logHint = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true; g.inMenu = false;
  g.frame = 11; g.loop(); // 触发 HUD 提示块
  return { nearLog: g.nearLog, hint: document.getElementById('interact-hint').textContent };
});
R.logRead = await ev(() => {
  const g = window.game;
  g.onInteract();
  return {
    panelVisible: g.ui.logVisible(),
    collected: [...g.collectedLogs],
    textHasLog: document.getElementById('log-text').textContent.includes('航行日志'),
    listItems: document.querySelectorAll('#log-list .log-item').length,
  };
});
await page.screenshot({ path: `${outDir}/log_panel.png` });
// 关闭 → 未读跳过已收集 → 第二处日志
R.logClose = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.input.locked = true;
  g.input.pressedSet.add('Escape');
  g.input.pressedAge.set('Escape', g.input.age);
  g.loop();
  const closed = !g.ui.logVisible();
  const near = g.logs.nearestUnread(g.player.pos.x, g.player.pos.y, g.player.pos.z, g.collectedLogs);
  return { closed, nextUnread: near.id };
});

// 3. 存档包含日志收集
R.saveLogs = await ev(() => {
  const g = window.game;
  g.exitToMenu();
  const raw = localStorage.getItem('voxelspace-save-v1');
  const d = raw ? JSON.parse(raw) : null;
  return { saveExists: !!d, logsInSave: d && d.logs ? d.logs : null };
});

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const stateOk = R.stateLines && R.stateLines.tessaUpdated && R.stateLines.kaelaUpdated;
console.log('CHECKS:', errors.length === 0 && stateOk ? 'all passed' : 'FAIL' + (stateOk ? '' : ' state-lines'));
await browser.close();
process.exitCode = errors.length === 0 && stateOk ? 0 : 1;
