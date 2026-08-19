// 第 52 轮验证：空间站任务板——接单/HUD/自动进度/交付/完成奖励/冷却/存档
// 运行：node tools/verifymissionboard.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-missionboard';
fs.mkdirSync(outDir, { recursive: true });

const BASE_URL = process.env.GAME_URL || 'http://localhost:8080';
const browser = await chromium.launch(process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--mute-audio'] }
  : { channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`${BASE_URL}/?seed=${SEED}`, { waitUntil: 'load' });
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

// 1. 任务板 UI：3 个不同悬赏 + 接受后 HUD 显示
R.board = await ev(() => {
  const g = window.game;
  g.docked = true;
  g.ui.showStation(true);
  g.missionSeed = 5;
  g.renderStationUI('missions');
  const offerBtns = [...document.querySelectorAll('#station-body [data-action="mission_accept"]')];
  const offerIds = offerBtns.map((b) => b.dataset.id);
  offerBtns[0].click();
  const mission = g.mission;
  g.ui.setActiveMission(mission ? `${mission.label} · ${mission.progress}/${mission.need}` : null);
  const hudShown = !document.getElementById('active-mission').classList.contains('hidden');
  const hudText = document.getElementById('active-mission').textContent;
  g.abandonMission();
  return { offerCount: offerBtns.length, offerIds, unique: new Set(offerIds).size, firstKind: mission && mission.kind, hudShown, hudText };
});
check('任务板提供 3 个悬赏 + HUD 显示当前任务', R.board && R.board.offerCount === 3 && R.board.unique === 3 && R.board.firstKind === 'mine' && R.board.hudShown && R.board.hudText.includes('矿区采掘'), R.board);

// 2. 采矿悬赏：40 次挖掘事件自动完成并发赏金
R.mineMission = await ev(async () => {
  const { createMission } = await import('/src/systems/missions.js');
  const g = window.game;
  g.mission = createMission({ id: 'mine_blocks', kind: 'mine', need: 40, reward: 80, label: '矿区采掘：40 方块', desc: 'x' });
  const before = g.inventory.countOf('credits');
  for (let i = 0; i < 39; i++) g.onMissionEvent('mine', {});
  const stillActive = !!g.mission;
  g.onMissionEvent('mine', {});
  return { stillActive, gained: g.inventory.countOf('credits') - before, cd: g.missionCd, done: !g.mission };
});
check('采矿悬赏自动计数并完成', R.mineMission && R.mineMission.stillActive && R.mineMission.done && R.mineMission.gained === 80 && R.mineMission.cd === 60, R.mineMission);

// 3. 猎杀悬赏：错误生物不计，3 只夜行兽完成；白昼自燃死亡不计入
R.killMission = await ev(async () => {
  const { createMission } = await import('/src/systems/missions.js');
  const { Mob } = await import('/src/entities/mobs.js');
  const g = window.game;
  g.missionCd = 0;
  g.milestones.earned.add('merchant'); // 已触发过 merchant，隔离本次悬赏赏金读数
  g.mission = createMission({ id: 'hunt_brute', kind: 'kill', mob: 'brute', need: 3, reward: 110, label: '猎杀悬赏：夜行兽', desc: 'x' });
  g.onMissionEvent('kill', { mob: 'swarmling' });
  const wrongIgnored = g.mission && g.mission.progress === 0;
  const before = g.inventory.countOf('credits');
  for (let i = 0; i < 3; i++) g.onMissionEvent('kill', { mob: 'brute' });
  const done = !g.mission;
  const gained = g.inventory.countOf('credits') - before;
  // 真实死亡路径：白天自燃 die(true) 不推进；正常 die(false) 推进
  g.missionCd = 0;
  g.mission = createMission({ id: 'hunt_brute', kind: 'kill', mob: 'brute', need: 1, reward: 110, label: '猎杀悬赏：夜行兽', desc: 'x' });
  const gy = g.world.getGroundY(g.player.pos.x + 6, g.player.pos.z);
  const burnMob = new Mob(g, g.player.pos.x + 6, gy, g.player.pos.z, 'brute');
  burnMob.die(true);
  const burnIgnored = !!g.mission && g.mission.progress === 0;
  const killMob = new Mob(g, g.player.pos.x + 8, gy, g.player.pos.z, 'brute');
  killMob.die(false);
  const normalCounted = g.mission === null; // need=1：正常击杀后悬赏立即自动完成
  burnMob.dispose(); killMob.dispose(); g.mission = null;
  return { wrongIgnored, done, gained, burnIgnored, normalCounted };
});
check('猎杀悬赏只计指定生物', R.killMission && R.killMission.wrongIgnored && R.killMission.done && R.killMission.gained === 110, R.killMission);
check('白昼自燃死亡不计入猎杀悬赏', R.killMission && R.killMission.burnIgnored && R.killMission.normalCounted, R.killMission);

// 4. 访问悬赏：抵达指定天体自动完成
R.visitMission = await ev(async () => {
  const { createMission } = await import('/src/systems/missions.js');
  const g = window.game;
  g.missionCd = 0;
  g.mission = createMission({ id: 'visit_mars', kind: 'visit', target: 'planet:solar.mars', need: 1, reward: 120, label: '探索悬赏：火星', desc: 'x' });
  const before = g.inventory.countOf('credits');
  g.onMissionEvent('visit', { target: 'planet:solar.venus' });
  const wrongIgnored = g.mission && g.mission.progress === 0;
  g.onMissionEvent('visit', { target: 'planet:solar.mars' });
  return { wrongIgnored, done: !g.mission, gained: g.inventory.countOf('credits') - before };
});
check('访问悬赏只认目标天体', R.visitMission && R.visitMission.wrongIgnored && R.visitMission.done && R.visitMission.gained === 120, R.visitMission);

// 5. 送货悬赏：任务板交付扣货发钱
R.deliver = await ev(async () => {
  const { createMission } = await import('/src/systems/missions.js');
  const g = window.game;
  g.missionCd = 0;
  g.mission = createMission({ id: 'deliver_ferrite', kind: 'deliver', item: 'ferrite_dust', need: 20, reward: 90, label: '物资补给：铁氧体', desc: 'x' });
  g.inventory.addItem('ferrite_dust', 15);
  g.handleStationAction('mission_deliver', g.mission.id, 1);
  const tooFew = !!g.mission && g.inventory.countOf('ferrite_dust') === 15;
  g.inventory.addItem('ferrite_dust', 5);
  const before = g.inventory.countOf('credits');
  g.handleStationAction('mission_deliver', g.mission.id, 1);
  return { tooFew, done: !g.mission, gained: g.inventory.countOf('credits') - before, ferriteLeft: g.inventory.countOf('ferrite_dust') };
});
check('送货悬赏交付扣货发钱', R.deliver && R.deliver.tooFew && R.deliver.done && R.deliver.gained === 90 && R.deliver.ferriteLeft === 0, R.deliver);

// 6. 创造模式：任务板不可用，自动进度/交付均被冻结
R.creative = await ev(async () => {
  const { createMission } = await import('/src/systems/missions.js');
  const g = window.game;
  g.mission = null; g.missionCd = 0;
  g.creative = true;
  const seedBefore = g.missionSeed;
  g.acceptMission('mine_blocks');
  const acceptBlocked = !g.mission && g.missionSeed === seedBefore;
  g.mission = createMission({ id: 'mine_blocks', kind: 'mine', need: 40, reward: 80, label: '矿区采掘：40 方块', desc: 'x' });
  g.onMissionEvent('mine', {});
  const progressFrozen = g.mission.progress === 0;
  g.mission = createMission({ id: 'deliver_ferrite', kind: 'deliver', item: 'ferrite_dust', need: 20, reward: 90, label: '物资补给：铁氧体', desc: 'x' });
  g.inventory.addItem('ferrite_dust', 20);
  const creditsBefore = g.inventory.countOf('credits');
  g.deliverMission();
  const deliverBlocked = !!g.mission && g.inventory.countOf('ferrite_dust') === 20 && g.inventory.countOf('credits') === creditsBefore;
  g.renderStationUI('missions');
  const body = document.getElementById('station-body');
  const notice = body ? body.textContent.includes('任务板不可用') : false;
  const acceptButtons = body ? [...body.querySelectorAll('[data-action="mission_accept"]')].length : -1;
  const abandonButtons = body ? [...body.querySelectorAll('[data-action="mission_abandon"]')].length : -1;
  g.mission = null; g.inventory.removeItem('ferrite_dust', 20); g.creative = false;
  return { acceptBlocked, progressFrozen, deliverBlocked, notice, acceptButtons, abandonButtons };
});
check('创造模式任务板禁用（接单/进度/交付）', R.creative && R.creative.acceptBlocked && R.creative.progressFrozen && R.creative.deliverBlocked && R.creative.notice && R.creative.acceptButtons === 0 && R.creative.abandonButtons === 1, R.creative);

// 7. 存档：悬赏/冷却/种子重载恢复
R.save = await ev(async () => {
  const { createMission } = await import('/src/systems/missions.js');
  const g = window.game;
  g.mission = createMission({ id: 'mine_blocks', kind: 'mine', need: 40, reward: 80, label: '矿区采掘：40 方块', desc: 'x' });
  g.mission.progress = 13; g.missionCd = 22; g.missionSeed = 7;
  const { saveGame } = await import('/src/systems/save.js');
  saveGame(g);
  return true;
});
await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
R.reload = await ev(() => ({
  progress: window.game.mission && window.game.mission.progress,
  cd: window.game.missionCd,
  seed: window.game.missionSeed,
}));
check('任务板悬赏状态存档重载恢复', R.save && R.reload.progress === 13 && R.reload.cd === 22 && R.reload.seed === 7, R.reload);

await page.screenshot({ path: `${outDir}/missionboard.png` });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const ok = allOk() && errors.length === 0;
console.log(ok ? 'CHECKS: all passed' : 'CHECKS: failed');
await browser.close();
if (!ok) process.exit(1);
