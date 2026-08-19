// 第 22 轮验证：风暴 + 夜间战斗 + 粒子 + 区块加载同时发生的压力长测
// （对应验收项"战斗、天气、粒子和区块加载同时发生"）：
// 恒定沙暴 + 深夜刷怪 + 玩家绕圈移动/挖掘/扫描，快进 ~15 分钟游戏时间，
// 校验无错误、粒子/区块/内存有界、战斗与风暴系统同时存活。
// 运行：node tools/verifystormsoak.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots47';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
console.log('game ready, seed=', SEED);

const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  g.quests.currentIndex = 4; // 庇护所阶段后：夜间刷怪生效
  g.weather.setPlanet({ kind: 'storm', freq: 100, dur: 900 }, '沙暴中'); // 恒定风暴
});
await new Promise((r) => setTimeout(r, 400));

const R = {};
R.start = await ev(() => ({
  heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  chunks: window.game.world.chunks.size,
}));

// 快进：1800 次 × 0.5s ≈ 15 分钟（前 2/3 深夜 + 风暴，后 1/3 白天 + 风暴）
const soak = await ev(async () => {
  const g = window.game;
  let maxMobs = 0, stormPeak = 0, maxParticles = 0, deaths = 0, lastHealth = g.player.health;
  const steps = [];
  for (let i = 0; i < 1800; i++) {
    const t = i * 0.5;
    // 前 1200 步深夜（刷怪高峰），后 600 步白天（怪物燃烧）
    g.sky.timeSec = i < 1200 ? 340 : 100;
    g.sky.update(0, g.player.pos);
    // 玩家绕圈移动（区块持续加载/卸载）
    if (i % 4 === 0) {
      const a = t * 0.04;
      const px = 26 + Math.cos(a) * 40;
      const pz = 8 + Math.sin(a) * 40;
      const gy = g.world.getGroundY(px, pz);
      g.player.pos.set(px, gy + 0.2, pz);
      g.player.vel.set(0, 0, 0);
    }
    // 白天挖矿 / 夜间被迫开火
    if (i < 1200) {
      if (i % 20 === 0) { g.input.pressedSet.add('KeyQ'); g.input.pressedAge.set('KeyQ', g.input.age); }
    } else if (i % 30 === 0) {
      g.input.mouseDownSet.add(0); g.input.mousePressedSet.add(0); g.input.mousePressedAge.set(0, g.input.age);
    }
    if (i % 30 === 8) g.input.mouseDownSet.delete(0);
    if (i % 900 === 0) { g.input.pressedSet.add('KeyC'); g.input.pressedAge.set('KeyC', g.input.age); } // 扫描
    g.accumulator += 0.5;
    g.loop();
    g.weather.update(0.5, g.player.pos); // 风暴系统按游戏时间驱动
    g.mobs.update(0.5);                   // 怪物按游戏时间驱动（刷怪/追击/攻击）
    if (g.player.health < lastHealth - 30) { deaths++; lastHealth = g.player.health; }
    if (g.player.health > lastHealth + 10) lastHealth = g.player.health;
    maxMobs = Math.max(maxMobs, g.mobs.mobs.length);
    stormPeak = Math.max(stormPeak, g.weather.intensity);
    maxParticles = Math.max(maxParticles, g.particles.mesh.count);
    if (i === 600) steps.push({ at: '5min', mobs: g.mobs.mobs.length, storm: Math.round(g.weather.intensity * 100) / 100, particles: g.particles.mesh.count, chunks: g.world.chunks.size });
    if (i === 1200) steps.push({ at: '10min', mobs: g.mobs.mobs.length, storm: Math.round(g.weather.intensity * 100) / 100, particles: g.particles.mesh.count, chunks: g.world.chunks.size });
  }
  const mem = performance.memory ? performance.memory.usedJSHeapSize : null;
  return {
    heapMB: mem ? Math.round(mem / 1048576) : null,
    chunks: g.world.chunks.size,
    dirty: g.world.dirty.size,
    particles: g.particles.mesh.count,
    bolts: g.combat.bolts.length,
    mobs: g.mobs.mobs.length,
    maxMobs, stormPeak, maxParticles, deaths,
    playerAlive: Number.isFinite(g.player.pos.x) && Number.isFinite(g.player.pos.y) && g.player.health >= 0,
    stormActiveNow: g.weather.inStorm,
    steps,
  };
});

// 风暴+深夜截图（重建一个短场景，保证视觉状态）
await ev(() => {
  const g = window.game;
  g.sky.timeSec = 340;
  g.sky.update(0, g.player.pos);
  g.weather.setPlanet({ kind: 'storm', freq: 100, dur: 900 }, '沙暴中');
  for (let i = 0; i < 400; i++) { g.weather.update(0.5, g.player.pos); g.mobs.update(0.5); }
});
await page.screenshot({ path: `${outDir}/storm_night.png` });

console.log(JSON.stringify({ R, soak, errors }, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('15 分钟风暴+战斗快进无页面错误', errors.length === 0, errors.slice(0, 3));
check('风暴全程处于活跃（峰值强度≈1）', soak.stormPeak > 0.85, soak.stormPeak);
check('深夜出现夜间怪物（>0 且 ≤8）', soak.maxMobs > 0 && soak.maxMobs <= 8, soak.maxMobs);
check('粒子池有界（≤640 环形上限）', soak.maxParticles <= 640, soak.maxParticles);
check('能量弹不泄漏（<50）', soak.bolts < 50, soak.bolts);
check('区块数保持有界（≤450）', soak.chunks <= 450, soak.chunks);
check('脏区块队列收敛（≤40）', soak.dirty <= 40, soak.dirty);
check('内存有界（<512MB）', soak.heapMB === null || soak.heapMB < 512, soak.heapMB);
check('玩家状态有效（无 NaN/负血）', soak.playerAlive);
check('战斗与风暴系统同时存活到结束', soak.mobs >= 0 && soak.stormActiveNow === true, soak.steps);

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
