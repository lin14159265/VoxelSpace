// 第 51 轮验证：太空威胁与舰载战斗——舰船护盾/船体 HUD、微陨石、海盗、Q 舰炮、紧急返航、赏金与存档
// 运行：node tools/verifyspacecombat.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-spacecombat';
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
  // 直接进入太空战斗上下文（不依赖爬升动画）
  g.flight.piloting = true;
  g.flight.spaceMode = true;
  g.space.active = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 240, 8.5);
  g.flight.yaw = Math.PI / 2;
});

// 1. 舰船护盾/船体 HUD：updateHUD 后显示正确
R.hud = await ev(() => {
  const g = window.game;
  g.flight.shield = 74; g.flight.shieldMax = 100; g.flight.hull = 41; g.flight.hullMax = 100;
  g.flight.updateHUD();
  return {
    shieldWidth: document.getElementById('bar-ship-shield').style.width,
    hullWidth: document.getElementById('bar-ship-hull').style.width,
    shieldText: document.getElementById('ship-shield-text').textContent,
    hullText: document.getElementById('ship-hull-text').textContent,
  };
});
check('舰船护盾/船体 HUD 正确', R.hud && R.hud.shieldWidth === '74%' && R.hud.hullWidth === '41%' && R.hud.shieldText === '74' && R.hud.hullText === '41', R.hud);

// 2. 统一伤害结算：先盾后船体
R.damage = await ev(() => {
  const g = window.game; const f = g.flight;
  f.shield = 30; f.shieldMax = 100; f.hull = 90; f.hullMax = 100; f.piloting = true; g.creative = false;
  f.takeShipDamage(50);
  const afterShieldHit = { shield: f.shield, hull: f.hull };
  f.takeShipDamage(10);
  const afterHullHit = { shield: f.shield, hull: f.hull };
  return { afterShieldHit, afterHullHit };
});
check('舰船伤害先扣盾再扣船体', R.damage && R.damage.afterShieldHit.shield === 0 && R.damage.afterShieldHit.hull === 70 && R.damage.afterHullHit.hull === 60, R.damage);

// 3. 小行星带微陨石：beltNear 时定时撞击扣盾/船体
R.meteor = await ev(() => {
  const g = window.game; const f = g.flight;
  f.shield = 100; f.hull = 100; f.piloting = true; g.creative = false;
  g.beltNear = true;
  g.spaceCombat.meteorTimer = 0;
  const before = { s: f.shield, h: f.hull };
  g.spaceCombat.update(0.016);
  const after = { s: f.shield, h: f.hull };
  g.beltNear = false;
  return { before, after, hit: after.s < before.s || after.h < before.h };
});
check('小行星带微陨石造成舰船伤害', R.meteor && R.meteor.hit, R.meteor);

// 4. 安全空域护盾/船体缓慢回复
R.regen = await ev(() => {
  const g = window.game; const f = g.flight;
  f.shield = 40; f.hull = 60; f.piloting = true;
  g.beltNear = false; g.spaceCombat.units = [];
  for (let i = 0; i < 120; i++) g.spaceCombat.update(1 / 60); // 2s 安全空域
  return { shield: Math.round(f.shield), hull: Math.round(f.hull), regen: f.shield > 40 && f.hull > 60 };
});
check('离开危险区后护盾/船体回复', R.regen && R.regen.regen, R.regen);

// 5. 海盗刷新、舰炮击毁、赏金与里程碑
R.pirate = await ev(() => {
  const g = window.game; const f = g.flight;
  g.beltNear = true;
  g.spaceCombat.spawnTimer = 0;
  g.spaceCombat.meteorTimer = 99;
  f.shield = 100; f.hull = 100; f.piloting = true; g.creative = false;
  g.spaceCombat.update(0.016);
  const spawned = g.spaceCombat.units.length > 0;
  const creditsBefore = g.inventory.countOf('credits');
  let destroyed = false;
  if (spawned) {
    // 把目标放到舰首前方并发射，再把弹丸放到目标身上模拟一次确定命中：
    // 主要验证舰炮命中判定、击毁奖励与里程碑闭环。
    const u = g.spaceCombat.units[0];
    u.hp = 25; // 舰炮弹伤害 25：残血海盗一炮击毁（满血需两炮）
    const fwd = f.forward();
    u.pos.copy(f.pos).addScaledVector(fwd, 20);
    u.group.position.copy(u.pos);
    g.spaceCombat.fireShipBolt();
    const bolt = g.spaceCombat.shipBolts[g.spaceCombat.shipBolts.length - 1];
    if (bolt) {
      bolt.pos.copy(u.pos);
      bolt.mesh.position.copy(u.pos);
    }
    g.spaceCombat.update(1 / 30);
    destroyed = g.spaceCombat.units.length === 0;
  }
  const reward = g.inventory.countOf('credits') - creditsBefore;
  const milestone = g.milestones.earned.has('space_ace');
  g.beltNear = false;
  g.spaceCombat.clear();
  return { spawned, destroyed, reward, milestone };
});
check('海盗刷新 + 舰炮击毁 + 赏金里程碑', R.pirate && R.pirate.spawned && R.pirate.destroyed && R.pirate.reward >= 60 && R.pirate.milestone, R.pirate);

// 5b. 海盗弹命中导致船体归零：update 必须立即退出，不残留实体/弹丸（P2-5 回归）
R.boltEmergency = await ev(async () => {
  const THREE = await import('three');
  const g = window.game; const f = g.flight;
  g.spaceCombat.clear();
  f.piloting = true; g.space.active = true; g.creative = false;
  f.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  f.shield = 0; f.hull = 5; f.impactCd = 0;
  const fake = { pos: { x: f.pos.x, y: f.pos.y, z: f.pos.z } };
  g.spaceCombat.spawnEnemyBolt(fake, new THREE.Vector3(0, 0, 1));
  const bolt = g.spaceCombat.enemyBolts[g.spaceCombat.enemyBolts.length - 1];
  if (bolt) {
    bolt.pos.copy(f.pos);
    bolt.mesh.position.copy(f.pos);
  }
  g.spaceCombat.update(1 / 30);
  return {
    piloting: f.piloting,
    spaceActive: g.space.active,
    hull: f.hull,
    units: g.spaceCombat.units.length,
    shipBolts: g.spaceCombat.shipBolts.length,
    enemyBolts: g.spaceCombat.enemyBolts.length,
    toast: document.getElementById('toasts').textContent.includes('紧急返航'),
  };
});
check('海盗弹致死路径：立即返航且数组清空', R.boltEmergency && R.boltEmergency.piloting === false && R.boltEmergency.spaceActive === false && R.boltEmergency.hull === 100 && R.boltEmergency.units === 0 && R.boltEmergency.shipBolts === 0 && R.boltEmergency.enemyBolts === 0 && R.boltEmergency.toast, R.boltEmergency);

// 6. 船体归零：紧急返航回到星球，护盾/船体回满
R.emergency = await ev(() => {
  const g = window.game; const f = g.flight;
  f.piloting = true; g.space.active = true; g.creative = false;
  f.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  f.shield = 0; f.hull = 10;
  f.takeShipDamage(20);
  return {
    piloting: f.piloting, spaceActive: g.space.active,
    playerActive: g.player.active, shield: f.shield, hull: f.hull,
    toast: document.getElementById('toasts').textContent.includes('紧急返航'),
  };
});
check('船体失效触发紧急返航并回满', R.emergency && R.emergency.piloting === false && R.emergency.spaceActive === false && R.emergency.playerActive === true && R.emergency.shield === 100 && R.emergency.hull === 100 && R.emergency.toast, R.emergency);

// 6b. 满背包击毁海盗：不得显示 +0 信用点（P3-7 回归）
R.pirateFull = await ev(() => {
  const g = window.game;
  const savedSlots = g.inventory.slots.map((s) => (s ? { itemId: s.itemId, count: s.count } : null));
  for (let i = 0; i < g.inventory.slots.length; i++) g.inventory.slots[i] = { itemId: 'stone', count: 64 };
  const creditsBefore = g.inventory.countOf('credits');
  g.spaceCombat.clear();
  g.spaceCombat.spawnPirate();
  const unitsBefore = g.spaceCombat.units.length;
  g.spaceCombat.destroyPirate(0);
  const toast = document.getElementById('toasts').textContent.includes('海盗拦截机击毁 · 背包已满，赏金无法接收');
  const gained = g.inventory.countOf('credits') - creditsBefore;
  const destroyed = g.spaceCombat.units.length === unitsBefore - 1;
  g.inventory.slots = savedSlots;
  return { toast, gained, destroyed };
});
check('满背包击毁海盗：文案正确且不入账', R.pirateFull && R.pirateFull.toast && R.pirateFull.gained === 0 && R.pirateFull.destroyed, R.pirateFull);

// 7. 存档：舰船护盾/船体重载恢复
R.save = await ev(async () => {
  const g = window.game;
  g.flight.shield = 66; g.flight.shieldMax = 100; g.flight.hull = 54; g.flight.hullMax = 100;
  const { saveGame } = await import('/src/systems/save.js');
  saveGame(g);
  return true;
});
await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
R.reload = await ev(() => ({ shield: window.game.flight.shield, hull: window.game.flight.hull }));
check('舰船护盾/船体存档重载恢复', R.save && R.reload.shield === 66 && R.reload.hull === 54, R.reload);

await page.screenshot({ path: `${outDir}/spacecombat.png` });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const ok = allOk() && errors.length === 0;
console.log(ok ? 'CHECKS: all passed' : 'CHECKS: failed');
await browser.close();
if (!ok) process.exit(1);
