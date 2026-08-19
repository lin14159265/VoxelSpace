// 第 48 轮验证：基地占有感——基地终端/重生点/休息/安全区/储物箱/存档世界重建
// 运行：node tools/verifybase.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-base';
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

// 1. 新物品注册 + 配方表 14 项
R.registry = await ev(() => {
  const g = window.game;
  const base = g.inventory.canAdd('base_unit', 1);
  const crate = g.inventory.canAdd('storage_crate', 1);
  g.openBackpack();
  const recipes = document.querySelectorAll('#craft-list .craft-item').length;
  g.closeBackpack();
  return { base, crate, recipes };
});
check('基地终端/储物箱注册 + 配方表 14 项', R.registry && R.registry.base && R.registry.crate && R.registry.recipes === 14, R.registry);

// 2. 放置基地终端 → 实体注册 + 信标亮起 + 里程碑
R.placeBase = await ev(() => {
  const g = window.game; const p = g.player;
  g.inventory.addItem('base_unit', 1);
  const slot = g.inventory.findInHotbar('base_unit');
  if (slot >= 0) g.inventory.select(slot); else { g.inventory.slots[0] = { itemId: 'base_unit', count: 1 }; g.inventory.select(0); }
  const bx = Math.floor(p.pos.x) + 6, bz = Math.floor(p.pos.z) + 6;
  const gy = g.world.getGroundY(bx, bz);
  g.world.setBlock(bx, gy, bz, 2);
  for (let y = gy + 1; y <= gy + 3; y++) g.world.setBlock(bx, y, bz, 0);
  p.pos.set(bx + 0.5, gy + 2.0, bz + 0.5); p.yaw = 0; p.pitch = -1.4; p.updateCamera();
  p.updateTarget();
  const t = p.target;
  const placed = !!(t && p.placeBlock(t) === true && g.world.getBlock(t.x + t.nx, t.y + t.ny, t.z + t.nz) === 24);
  const base = g.currentBase();
  return {
    placed,
    base: base ? { x: base.x, y: base.y, z: base.z } : null,
    beacon: !!(g.baseBeacon && g.baseBeacon.visible),
    milestone: g.milestones.earned.has('home_owner'),
    toast: document.getElementById('toasts').textContent.includes('基地已建立'),
  };
});
check('基地终端放置/注册/信标/里程碑', R.placeBase && R.placeBase.placed && R.placeBase.base && R.placeBase.beacon && R.placeBase.milestone && R.placeBase.toast, R.placeBase);

// 3. 基地终端休息：入夜后 E 休息到清晨并回满状态；冷却中不能无限跳夜
R.rest = await ev(() => {
  const g = window.game; const p = g.player;
  const b = g.currentBase();
  const setNightAndInjure = () => {
    g.sky._dayFactor = 0; // 夜间
    p.pos.set(b.x + 0.5, b.y + 1.2, b.z + 0.5);
    p.health = 40; p.shield = 20; p.life = 30; p.hazard = 25;
  };
  setNightAndInjure();
  g.onInteract();
  const first = {
    morning: Math.abs(g.sky.timeSec - g.sky.dayLength * 0.25) < 1,
    health: p.health, shield: p.shield, life: p.life, hazard: p.hazard,
    cd: g.baseRestCd,
  };
  // 立即再次尝试：应在冷却中，时间不跳、状态不回满
  setNightAndInjure();
  g.onInteract();
  const blocked = {
    cd: g.baseRestCd,
    stillNight: g.sky.nightFactor > 0.5,
    health: p.health, shield: p.shield, life: p.life, hazard: p.hazard,
    toast: document.getElementById('toasts').textContent.includes('基地终端充能中'),
  };
  // 冷却清零后可再次休息
  g.baseRestCd = 0;
  g.onInteract();
  const second = {
    morning: Math.abs(g.sky.timeSec - g.sky.dayLength * 0.25) < 1,
    health: p.health, shield: p.shield, life: p.life, hazard: p.hazard,
  };
  return { first, blocked, second };
});
check('基地休息到清晨并恢复状态', R.rest && R.rest.first.morning && R.rest.first.health === 100 && R.rest.first.shield === 100 && R.rest.first.life === 100 && R.rest.first.hazard === 100 && R.rest.first.cd === 240, R.rest);
check('基地休息冷却阻止连续跳夜', R.rest && R.rest.blocked.cd > 0 && R.rest.blocked.cd <= 240 && R.rest.blocked.stillNight && R.rest.blocked.health === 40 && R.rest.blocked.shield === 20 && R.rest.blocked.life === 30 && R.rest.blocked.hazard === 25 && R.rest.blocked.toast, R.rest.blocked);
check('冷却清零后可再次休息', R.rest && R.rest.second.morning && R.rest.second.health === 100 && R.rest.second.shield === 100 && R.rest.second.life === 100 && R.rest.second.hazard === 100, R.rest.second);

// 4. 死亡后在基地重生（不再是坠机点）
R.respawn = await ev(() => {
  const g = window.game; const p = g.player;
  const b = g.currentBase();
  p.shield = 0; p.health = 10;
  p.damage(50);
  return {
    x: Math.round(p.pos.x * 10) / 10,
    y: Math.round(p.pos.y * 10) / 10,
    z: Math.round(p.pos.z * 10) / 10,
    expected: { x: b.x + 0.5, y: b.y + 1.2, z: b.z + 0.5 },
    toast: document.getElementById('toasts').textContent.includes('基地终端重生'),
  };
});
check('死亡后从基地终端重生', R.respawn && Math.abs(R.respawn.x - R.respawn.expected.x) < 0.01 && Math.abs(R.respawn.y - R.respawn.expected.y) < 0.01 && Math.abs(R.respawn.z - R.respawn.expected.z) < 0.01 && R.respawn.toast, R.respawn);

// 5. 基地安全区：终端 28m 内不刷怪
R.safeZone = await ev(() => {
  const g = window.game;
  const b = g.currentBase();
  g.player.pos.set(b.x + 0.5, b.y + 1.2, b.z + 0.5);
  g.mobs.clear();
  for (let i = 0; i < 40; i++) g.mobs.spawnOne();
  const minDist = g.mobs.mobs.reduce((m, mob) => Math.min(m, Math.hypot(mob.pos.x - (b.x + 0.5), mob.pos.z - (b.z + 0.5))), 999);
  g.mobs.clear();
  return { spawned: g.mobs.mobs.length + '?', minDist: Number(minDist.toFixed(1)) };
});
check('基地安全区 28m 内不刷怪', R.safeZone && (R.safeZone.minDist >= 28 || R.safeZone.minDist === 999), R.safeZone);

// 6. 储物箱：部署 → 存入背包区 → 打开面板取出 → 面板状态正确
R.crate = await ev(() => {
  const g = window.game; const p = g.player;
  g.inventory.addItem('storage_crate', 1);
  const slot = g.inventory.findInHotbar('storage_crate');
  if (slot >= 0) g.inventory.select(slot); else { g.inventory.slots[1] = { itemId: 'storage_crate', count: 1 }; g.inventory.select(1); }
  const bx = Math.floor(p.pos.x) + 8, bz = Math.floor(p.pos.z) + 2;
  const gy = g.world.getGroundY(bx, bz);
  g.world.setBlock(bx, gy, bz, 2);
  for (let y = gy + 1; y <= gy + 3; y++) g.world.setBlock(bx, y, bz, 0);
  p.pos.set(bx + 0.5, gy + 2.0, bz + 0.5); p.yaw = 0; p.pitch = -1.4; p.updateCamera(); p.updateTarget();
  const t = p.target;
  const placed = !!(t && p.placeBlock(t) === true && g.world.getBlock(t.x + t.nx, t.y + t.ny, t.z + t.nz) === 25);
  const crate = g.findCrateNear(p.pos.x, p.pos.y, p.pos.z, 3);
  // 背包区放 10 石头，快捷栏保留一个标记物
  g.inventory.slots[9] = { itemId: 'stone', count: 10 };
  g.inventory.slots[0] = { itemId: 'carbon', count: 5 };
  g.openStorage(crate);
  const panelBefore = { visible: g.ui.storageVisible(), inMenu: g.inMenu };
  g.handleStorageAction('storeAll', -1);
  const stored = crate.slots.some((s) => s && s.itemId === 'stone' && s.count === 10);
  const packCleared = !g.inventory.slots[9];
  const hotbarKept = g.inventory.slots[0] && g.inventory.slots[0].itemId === 'carbon';
  g.handleStorageAction('takeAll', -1);
  const takenBack = g.inventory.countOf('stone') >= 10 && crate.slots.every((s) => !s);
  g.closeStorage();
  return { placed, stored, packCleared, hotbarKept, takenBack, panelBefore, panelClosed: !g.ui.storageVisible() };
});
check('储物箱部署/存入背包区/取出/面板状态', R.crate && R.crate.placed && R.crate.stored && R.crate.packCleared && R.crate.hotbarKept && R.crate.takenBack && R.crate.panelBefore.visible && R.crate.panelBefore.inMenu && R.crate.panelClosed, R.crate);

// 7. 存档重载：基地/储物箱方块按实体坐标重建，信标与容器数据恢复
R.save = await ev(async () => {
  const g = window.game;
  g.baseRestCd = 91; // 验证冷却随存档恢复
  const { saveGame } = await import('/src/systems/save.js');
  saveGame(g);
  return true;
});
await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
R.reload = await ev(() => {
  const g = window.game;
  const b = g.currentBase();
  const crates = g.currentCrates();
  return {
    baseExists: !!b && g.world.getBlock(b.x, b.y, b.z) === 24,
    beacon: !!(g.baseBeacon && g.baseBeacon.visible),
    crateBlock: crates[0] ? g.world.getBlock(crates[0].x, crates[0].y, crates[0].z) === 25 : false,
    crateCount: crates.length,
    milestone: g.milestones.earned.has('home_owner'),
    restCd: g.baseRestCd,
  };
});
check('基地/储物箱/休息冷却随存档恢复', R.save && R.reload.baseExists && R.reload.beacon && R.reload.crateBlock && R.reload.crateCount >= 1 && R.reload.milestone && R.reload.restCd > 0 && R.reload.restCd <= 91, R.reload);

await page.screenshot({ path: `${outDir}/base.png` });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const ok = allOk() && errors.length === 0;
console.log(ok ? 'CHECKS: all passed' : 'CHECKS: failed');
await browser.close();
if (!ok) process.exit(1);
