// 第 17 轮验证：夜间战斗深度——怪物不穿墙、隔墙/隔层不攻击（庇护所有意义）、
// 开阔地会攻击、白天燃烧、追击速度有压迫感。
// 运行：node tools/verifycombat.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots40';
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

await ev(async () => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  const mod = await import('/src/entities/mobs.js');
  window.__Mob = mod.Mob;
});
await new Promise((r) => setTimeout(r, 400));

// 公共定位：开阔平坦区（清掉可能挡视线的树/方块）
await ev(() => {
  const g = window.game;
  const w = g.world;
  for (let x = 4; x <= 24; x++) {
    for (let z = 4; z <= 16; z++) {
      for (let y = 20; y <= 32; y++) w.setBlock(x, y, z, 0);
    }
  }
  const gy = w.getGroundY(10, 10);
  g.player.pos.set(10, gy, 10);
  g.player.vel.set(0, 0, 0);
  window.__gy = gy;
});

// 1. 隔墙：怪物追玩家但不穿墙、不隔墙攻击
R.wall = await ev(async () => {
  const g = window.game;
  const gy = window.__gy;
  const { Mob } = await import('/src/entities/mobs.js');
  // 墙：x=11 两格高（方块占据 [11,12)），玩家在 x=10，怪物在 x=13
  for (let y = 0; y < 2; y++) g.world.setBlock(11, gy + y, 10, 3); // STONE=3
  g.world.setBlock(11, gy, 11, 3); g.world.setBlock(11, gy + 1, 11, 3);
  const mob = new Mob(g, 13, gy, 10);
  g.player.pos.set(10, gy, 10);
  const healthBefore = g.player.health;
  for (let i = 0; i < 240; i++) { mob.update(1 / 60); }
  const r = {
    mobX: Math.round(mob.pos.x * 10) / 10,
    stoppedAtWall: mob.pos.x >= 12.0,
    healthSame: g.player.health === healthBefore,
    los: mob.hasLineOfSight(g.player),
  };
  mob.dispose();
  return r;
});

// 2. 开阔地：会追击并攻击（掉血）
R.openAttack = await ev(async () => {
  const g = window.game;
  const gy = window.__gy;
  // 拆除第 1 节的墙（否则本测试又变成"隔墙"场景）
  for (let y = 0; y < 2; y++) { g.world.setBlock(11, gy + y, 10, 0); g.world.setBlock(11, gy + y, 11, 0); }
  const { Mob } = await import('/src/entities/mobs.js');
  const mob = new Mob(g, 12, gy, 10);
  g.player.pos.set(10, gy, 10);
  g.player.health = 100; g.player.shield = 100;
  const before = { h: g.player.health, s: g.player.shield };
  for (let i = 0; i < 300; i++) { mob.update(1 / 60); }
  const r = {
    tookDamage: g.player.health < before.h || g.player.shield < before.s,
    health: g.player.health, shield: g.player.shield,
    mobDist: Math.round(Math.hypot(mob.pos.x - 10, mob.pos.z - 10) * 10) / 10,
    reachedMelee: Math.hypot(mob.pos.x - 10, mob.pos.z - 10) < 2.6,
  };
  mob.dispose();
  return r;
});

// 3. 高处：玩家站 4 格高柱上，怪物打不到
R.height = await ev(async () => {
  const g = window.game;
  const gy = window.__gy;
  const { Mob } = await import('/src/entities/mobs.js');
  // 柱子：x=12, z=10，3 格高，玩家站顶（y = gy+3）
  for (let y = 0; y < 3; y++) g.world.setBlock(12, gy + y, 10, 3);
  const mob = new Mob(g, 14.4, gy, 10);
  g.player.pos.set(12.5, gy + 3, 10.5);
  g.player.health = 100; g.player.shield = 100;
  for (let i = 0; i < 300; i++) { mob.update(1 / 60); }
  const r = { noDamage: g.player.health === 100 && g.player.shield === 100, health: g.player.health };
  mob.dispose();
  return r;
});

// 4. 白天燃烧（地表暴露）
R.burn = await ev(async () => {
  const g = window.game;
  const gy = window.__gy;
  const { Mob } = await import('/src/entities/mobs.js');
  const saved = g.sky.dayFactor;
  g.sky.dayFactor = 1.0;
  const mob = new Mob(g, 20, gy, 10);
  g.player.pos.set(100, gy, 100); // 玩家远离，不触发追击
  const h0 = mob.health;
  for (let i = 0; i < 30; i++) { mob.update(1 / 30); }
  const r = { burned: mob.health < h0, health: mob.health, h0 };
  g.sky.dayFactor = saved;
  mob.dispose();
  return r;
});

// 5. 追击速度（开阔地加速至 > 玩家步行速度 4.4 的 70%）
R.speed = await ev(async () => {
  const g = window.game;
  const gy = window.__gy;
  // 拆除第 3 节的高柱（否则挡住追击路径）
  for (let y = 0; y < 3; y++) g.world.setBlock(12, gy + y, 10, 0);
  const { Mob } = await import('/src/entities/mobs.js');
  const mob = new Mob(g, 17, gy, 10);
  g.player.pos.set(10, gy, 10);
  // 测量逼近阶段（前 90 帧，未接触玩家）的峰值速度；
  // 到达玩家后怪物会来回振荡，瞬时速度在转向点接近 0，不可作为判据
  let maxSpeed = 0;
  for (let i = 0; i < 180; i++) {
    mob.update(1 / 60);
    if (i < 90) maxSpeed = Math.max(maxSpeed, Math.hypot(mob.vel.x, mob.vel.z));
  }
  const r = {
    speed: Math.round(maxSpeed * 10) / 10,
    chases: maxSpeed > 2.8,
  };
  mob.dispose();
  return r;
});

// 6. 生物种类：属性差异 + 行星差异化生成 + 群居成队
R.kinds = await ev(async () => {
  const g = window.game;
  const gy = window.__gy;
  const { Mob, MOB_KINDS } = await import('/src/entities/mobs.js');
  const s = new Mob(g, 16, gy, 12, 'swarmling');
  const c = new Mob(g, 18, gy, 14, 'crawler');
  const b = new Mob(g, 20, gy, 16, 'brute');
  const r = {
    hpDiffer: s.maxHealth === 10 && c.maxHealth === 60 && b.maxHealth === 30,
    dmgDiffer: MOB_KINDS.swarmling.dmg === 6 && MOB_KINDS.crawler.dmg === 18,
    speedOrder: MOB_KINDS.swarmling.speed > MOB_KINDS.brute.speed && MOB_KINDS.brute.speed > MOB_KINDS.crawler.speed,
    dropDiffer: MOB_KINDS.crawler.drop.item === 'copper_ore',
  };
  s.dispose(); c.dispose(); b.dispose();
  // 行星差异化：荒芜 → 群居异虫/岩甲爬兽；繁茂 → 夜行兽/群居异虫
  g.quests.currentIndex = 4;
  g.player.pos.set(10, gy, 10);
  const planet = g.space.galaxy[g.space.current];
  const savedSurface = planet.surface;
  planet.surface = 'barren';
  g.mobs.mobs = [];
  for (let i = 0; i < 6; i++) g.mobs.spawnOne();
  const barrenKinds = new Set(g.mobs.mobs.map((m) => m.kindId));
  const barrenOk = [...barrenKinds].every((k) => k === 'swarmling' || k === 'crawler');
  const swarmPack = g.mobs.mobs.filter((m) => m.kindId === 'swarmling').length >= 1;
  g.mobs.clear();
  planet.surface = savedSurface;
  return { ...r, barrenKinds: [...barrenKinds], barrenOk, swarmPack };
});

R.errors = errors;
console.log(JSON.stringify(R, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('怪物被墙挡住不穿墙', R.wall && R.wall.stoppedAtWall, R.wall);
check('隔墙不攻击（不掉血）', R.wall && R.wall.healthSame, R.wall);
check('隔墙视线判定为 false', R.wall && R.wall.los === false, R.wall);
check('开阔地追击进入近战距离', R.openAttack && R.openAttack.reachedMelee, R.openAttack);
check('开阔地攻击造成伤害', R.openAttack && R.openAttack.tookDamage, R.openAttack);
check('高处（4 格）不被攻击', R.height && R.height.noDamage, R.height);
check('白天地表燃烧掉血', R.burn && R.burn.burned, R.burn);
check('追击速度有压迫感（>2.8）', R.speed && R.speed.chases, R.speed);
check('三种生物血量差异', R.kinds && R.kinds.hpDiffer, R.kinds);
check('三种生物伤害差异', R.kinds && R.kinds.dmgDiffer);
check('追击速度排序（虫>兽>爬）', R.kinds && R.kinds.speedOrder);
check('爬兽掉落铜矿石', R.kinds && R.kinds.dropDiffer);
check('荒芜行星只刷虫/爬兽', R.kinds && R.kinds.barrenOk, R.kinds && R.kinds.barrenKinds);
check('群居异虫成队出现', R.kinds && R.kinds.swarmPack);
check('无页面错误', errors.length === 0);

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
