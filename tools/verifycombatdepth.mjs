// 第 46 轮验证：战斗可读性与来回——怪物血条 / 受击硬直 / 攻击前摇与闪避窗口 / 命中标记 / 能量线圈模块
// 运行：node tools/verifycombatdepth.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots-combatdepth';
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
  // 固定为夜间（避免白天燃烧干扰伤害读数），并清理一块平坦测试区
  g.sky._dayFactor = 0;
  for (let x = 4; x <= 30; x++) for (let z = 4; z <= 20; z++) for (let y = 18; y <= 34; y++) g.world.setBlock(x, y, z, 0);
  window.__gy = g.world.getGroundY(10, 10);
});

// 1. 血条：满血隐藏；受击后出现且比例正确；二次受击比例下降；死亡/销毁清理
R.hpBar = await ev(async () => {
  const g = window.game; const gy = window.__gy;
  const { Mob } = await import('/src/entities/mobs.js');
  const m = new Mob(g, 20, gy, 12, 'brute');
  const fullHidden = m.hpGroup.visible === false;
  m.hit(10, { x: 1, z: 0 });
  const afterFirst = { visible: m.hpGroup.visible, ratio: Number((m.health / m.maxHealth).toFixed(2)), fillScale: Number(m.hpFill.scale.x.toFixed(2)) };
  m.hit(10, { x: 1, z: 0 });
  const afterSecond = { ratio: Number((m.health / m.maxHealth).toFixed(2)), fillScale: Number(m.hpFill.scale.x.toFixed(2)) };
  m.dispose();
  return { fullHidden, afterFirst, afterSecond, disposed: m.hpGroup === null };
});

// 2. 受击硬直：命中会设置 stagger 并打断攻击前摇
R.stagger = await ev(async () => {
  const g = window.game; const gy = window.__gy;
  const { Mob } = await import('/src/entities/mobs.js');
  const m = new Mob(g, 20, gy, 12, 'brute');
  m.attackWindup = 0.5;
  m.hit(5, { x: 1, z: 0 });
  const r = { stagger: m.stagger, windupInterrupted: m.attackWindup === 0 };
  // 硬直期间移速应显著下降（对比正常追击瞬时速度）
  g.player.pos.set(10, gy, 10); m.pos.set(17, gy, 10); m.vel.set(0, 0, 0);
  m.update(1 / 60);
  const slowSpeed = Math.hypot(m.vel.x, m.vel.z);
  m.stagger = 0; m.vel.set(0, 0, 0); m.pos.set(17, gy, 10);
  m.update(1 / 60);
  const normalSpeed = Math.hypot(m.vel.x, m.vel.z);
  m.dispose();
  return { ...r, slowSpeed: Number(slowSpeed.toFixed(2)), normalSpeed: Number(normalSpeed.toFixed(2)) };
});

// 3. 攻击前摇：进入范围先亮红灯与 warn，前摇期间不扣血，结算后扣血
R.windup = await ev(async () => {
  const g = window.game; const gy = window.__gy;
  const { Mob } = await import('/src/entities/mobs.js');
  const m = new Mob(g, 12, gy, 10, 'brute');
  g.player.pos.set(10, gy, 10); g.player.health = 100; g.player.shield = 100;
  m.update(1 / 60);
  const started = m.attackWindup > 0;
  const eyeRed = started && m.eyeMat.color.getHex() === 0xff2a1a;
  const noDamageDuringWindup = g.player.health === 100 && g.player.shield === 100;
  let damageDealt = false;
  for (let i = 0; i < 90; i++) {
    m.update(1 / 60);
    if (g.player.health < 100 || g.player.shield < 100) { damageDealt = true; break; }
  }
  const r = { started, eyeRed, noDamageDuringWindup, damageDealt, attackCd: Number(m.attackCd.toFixed(2)), windupAfter: Number(m.attackWindup.toFixed(2)) };
  m.dispose();
  return r;
});

// 4. 闪避窗口：前摇中退开 → 怪物挥空且进入更短后摇（有来有回）
R.dodge = await ev(async () => {
  const g = window.game; const gy = window.__gy;
  const { Mob } = await import('/src/entities/mobs.js');
  const m = new Mob(g, 12, gy, 10, 'brute');
  g.player.pos.set(10, gy, 10); g.player.health = 100; g.player.shield = 100;
  for (let i = 0; i < 3; i++) m.update(1 / 60); // 进入前摇
  const windupBefore = m.attackWindup;
  g.player.pos.set(5.5, gy, 10); // 退到 reach+0.6 之外
  let recoveryAfterMiss = 0;
  for (let i = 0; i < 60; i++) {
    m.update(1 / 60);
    // 前摇刚结算完、攻击后摇刚写入的瞬间才是有效读数
    if (m.attackWindup === 0 && m.attackCd > 0) { recoveryAfterMiss = m.attackCd; break; }
  }
  const r = {
    enteredWindup: windupBefore > 0,
    noDamage: g.player.health === 100 && g.player.shield === 100,
    shortRecovery: recoveryAfterMiss > 0 && recoveryAfterMiss < 0.7,
    attackCd: Number(recoveryAfterMiss.toFixed(2)),
  };
  m.dispose();
  return r;
});

// 5. 命中标记：四道短斜线反馈出现后自动消失
R.hitmarker = await (async () => {
  await ev(() => { window.game.ui.hitmarker(); });
  const shown = await ev(() => document.getElementById('hitmarker').classList.contains('show'));
  await sleep(450);
  const cleared = await ev(() => !document.getElementById('hitmarker').classList.contains('show'));
  return { shown, cleared };
})();

// 6. 能量线圈：无模块 14 伤/0.32s 冷却/青色；合成后 22 伤/0.24s/橙色 + 里程碑
R.coil = await ev(() => {
  const g = window.game;
  const before = { damage: g.combat.damage, cd: g.combat.fireCooldown, color: g.combat.boltColor };
  g.inventory.addItem('copper_ore', 3); g.inventory.addItem('carbon', 4); g.inventory.addItem('gold_ore', 1);
  g.craftItem('energy_coil');
  const after = {
    damage: g.combat.damage, cd: g.combat.fireCooldown, color: g.combat.boltColor,
    hasCoil: g.inventory.countOf('energy_coil') === 1,
    milestone: g.milestones.earned.has('weapon_smith'),
  };
  return { before, after };
});

// 7. 存档重载：能量线圈与里程碑恢复
R.save = await ev(async () => {
  const { saveGame } = await import('/src/systems/save.js');
  saveGame(window.game);
  return true;
});
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
R.reload = await ev(() => ({
  coil: window.game.inventory.countOf('energy_coil'),
  damage: window.game.combat.damage,
  milestone: window.game.milestones.earned.has('weapon_smith'),
}));

await page.screenshot({ path: `${outDir}/combatdepth.png` });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');

let failed = 0;
const check2 = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };
check2('满血隐藏、受击显示、血条比例下降', R.hpBar && R.hpBar.fullHidden && R.hpBar.afterFirst.visible && R.hpBar.afterSecond.ratio < R.hpBar.afterFirst.ratio && R.hpBar.disposed, R.hpBar);
check2('命中触发硬直并打断前摇', R.stagger && R.stagger.stagger > 0 && R.stagger.windupInterrupted && R.stagger.slowSpeed < R.stagger.normalSpeed * 0.5, R.stagger);
check2('攻击前摇可读且不瞬间扣血', R.windup && R.windup.started && R.windup.eyeRed && R.windup.noDamageDuringWindup && R.windup.damageDealt, R.windup);
check2('前摇中退开可闪避并进入短后摇', R.dodge && R.dodge.enteredWindup && R.dodge.noDamage && R.dodge.shortRecovery, R.dodge);
check2('能量弹命中标记出现并消失', R.hitmarker && R.hitmarker.shown && R.hitmarker.cleared, R.hitmarker);
check2('能量线圈改变伤害/射速/弹色并点亮里程碑', R.coil && R.coil.before.damage === 14 && R.coil.before.cd === 0.32 && R.coil.after.damage === 22 && R.coil.after.cd === 0.24 && R.coil.after.color === 0xffb84d && R.coil.after.hasCoil && R.coil.after.milestone, R.coil);
check2('能量线圈与里程碑存档重载恢复', R.save && R.reload.coil >= 1 && R.reload.damage === 22 && R.reload.milestone, R.reload);
check2('无页面错误', errors.length === 0, errors.slice(0, 3));

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
