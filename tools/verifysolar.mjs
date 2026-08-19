// 本轮验证：太阳系 8 行星 / 母星地球 / 行星地表差异化(火星红沙·冰巨星雪·地球草地) / 太空视觉(太阳·土星环) / 星图
// 运行：node tools/verifysolar.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240101';
const outDir = 'shots29';
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

// 进入游戏（无头环境模拟指针锁定成功）
await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.input.locked = true;
  g.setPaused(false);
});
await sleep(400);

// 1. 太阳系数据
R.galaxy = await ev(() => {
  const g = window.game;
  const gal = g.space.galaxy;
  return {
    count: gal.length,
    names: gal.map((p) => p.name),
    home: gal[0].name,
    homeSeedMatches: gal[0].seed === g.seed,
    saturnRing: (gal.find((p) => p.name === '土星') || {}).ring === true,
    surfaces: [...new Set(gal.map((p) => p.surface))],
    planetName: g.planetName,
    earthTerrain: gal[0].terrain,
  };
});

// 2. 星图面板显示真实行星名
await ev(() => window.game.openStarMap());
R.starMap = await ev(() => {
  const text = document.getElementById('starmap-list').textContent;
  return {
    hasEarth: text.includes('地球'), hasMars: text.includes('火星'),
    hasSaturn: text.includes('土星'), hasNeptune: text.includes('海王星'),
  };
});
await ev(() => window.game.closeStarMap());
await page.screenshot({ path: `${outDir}/menu.png` });

// 3. 地表差异化：火星 → 红沙
R.mars = await ev(() => {
  const g = window.game;
  const np = g.space.galaxy.find((p) => p.name === '火星');
  g.applyNewWorld(np.seed, np.palette, { terrain: np.terrain, surface: np.surface, planetName: `${np.name} · 太阳系` });
  g.player.respawn(g.world.spawnPoint());
  // 预加载采样范围内的区块
  const pcx = Math.floor(g.player.pos.x / 16), pcz = Math.floor(g.player.pos.z / 16);
  g.world.ensureArea(pcx, pcz, 7);
  let guard = 0;
  while (g.world.dirty.size > 0 && guard++ < 6000) g.world.remeshQueue(g.player.pos.x, g.player.pos.z, 16);
  g.player.yaw = -Math.PI / 2; g.player.pitch = -0.3; g.player.updateCamera();
  // 地表方块统计（远离坠毁点）
  let redSand = 0, stone = 0, other = 0, total = 0;
  for (let x = -100; x <= 100; x += 4) {
    for (let z = -100; z <= 100; z += 4) {
      const h = g.world.gen.heightAt(x, z);
      const id = g.world.getBlock(x, h, z);
      total++;
      if (id === 20) redSand++; else if (id === 3) stone++; else other++;
    }
  }
  return { planetName: g.planetName, redSand, stone, other, total, redDominant: redSand > total * 0.5 };
});
await sleep(300);
await page.screenshot({ path: `${outDir}/mars.png` });

// 4. 海王星 → 雪
R.neptune = await ev(() => {
  const g = window.game;
  const np = g.space.galaxy.find((p) => p.name === '海王星');
  g.applyNewWorld(np.seed, np.palette, { terrain: np.terrain, surface: np.surface, planetName: `${np.name} · 太阳系` });
  g.player.respawn(g.world.spawnPoint());
  const pcx = Math.floor(g.player.pos.x / 16), pcz = Math.floor(g.player.pos.z / 16);
  g.world.ensureArea(pcx, pcz, 7);
  let guard = 0;
  while (g.world.dirty.size > 0 && guard++ < 6000) g.world.remeshQueue(g.player.pos.x, g.player.pos.z, 16);
  g.player.yaw = -Math.PI / 2; g.player.pitch = -0.3; g.player.updateCamera();
  let snow = 0, stone = 0, other = 0, total = 0;
  for (let x = -100; x <= 100; x += 4) {
    for (let z = -100; z <= 100; z += 4) {
      const h = g.world.gen.heightAt(x, z);
      const id = g.world.getBlock(x, h, z);
      total++;
      if (id === 21) snow++; else if (id === 3) stone++; else other++;
    }
  }
  return { planetName: g.planetName, snow, stone, other, total, snowDominant: snow > total * 0.5 };
});
await sleep(300);
await page.screenshot({ path: `${outDir}/neptune.png` });

// 5. 回到地球 → 草地
R.earth = await ev(() => {
  const g = window.game;
  const home = g.space.galaxy[0];
  g.applyNewWorld(home.seed, home.palette, { terrain: home.terrain, surface: home.surface, planetName: '地球 · 太阳系' });
  g.player.respawn(g.world.spawnPoint());
  const pcx = Math.floor(g.player.pos.x / 16), pcz = Math.floor(g.player.pos.z / 16);
  g.world.ensureArea(pcx, pcz, 7);
  let guard = 0;
  while (g.world.dirty.size > 0 && guard++ < 6000) g.world.remeshQueue(g.player.pos.x, g.player.pos.z, 16);
  g.player.yaw = -Math.PI / 2; g.player.pitch = -0.3; g.player.updateCamera();
  let grass = 0, sand = 0, other = 0, total = 0;
  for (let x = -100; x <= 100; x += 4) {
    for (let z = -100; z <= 100; z += 4) {
      const h = g.world.gen.heightAt(x, z);
      const id = g.world.getBlock(x, h, z);
      total++;
      if (id === 1) grass++; else if (id === 4) sand++; else other++;
    }
  }
  return { planetName: g.planetName, grass, sand, other, total, grassDominant: grass > total * 0.5 };
});
await sleep(300);
await page.screenshot({ path: `${outDir}/earth.png` });

// 6. 太空视觉：进入太空 → 母星球体/太阳/邻居行星/土星环
R.space = await ev(() => {
  const g = window.game;
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  // 邻居行星：检查土星带环
  const saturnMesh = g.space.neighborMeshes.find((m) => m.np.name === '土星');
  const ringChild = saturnMesh && saturnMesh.group.children.some((c) => c.geometry && c.geometry.type === 'RingGeometry');
  const planets = g.space.neighborMeshes.map((m) => m.np.name);
  // 太阳：统一模型中相对地球的固定世界节点（真实轨道关系 ≈ 1 AU，而非跟随玩家的装饰球）
  const sun = g.space.sunMarker;
  const sunDist = sun ? Math.hypot(sun.position.x - g.space.enteredAt.x, sun.position.z - g.space.enteredAt.z) : null;
  const sunInScene = !!sun && sun.name === 'space-sun' && Math.abs(sunDist - 1000) < 2 && !!g.space.beltMarker;
  // 冻结游戏循环，手动摆相机俯瞰母星（无头环境 rAF 会覆盖相机）
  g.running = false;
  const gY = g.space.enteredAt.groundY;
  g.space.planetGroup.position.set(8.5, gY - 246, 8.5);
  g.sky.update(0.016, { x: 8.5, y: gY + 20, z: 8.5 });
  const cam = g.camera;
  cam.position.set(8.5, gY + 26, 8.5 + 230);
  cam.lookAt(8.5, gY - 320, 8.5);
  return { neighbors: planets, saturnHasRing: ringChild === true, sunPresent: sunInScene, active: g.space.active };
});
await sleep(500);
await page.screenshot({ path: `${outDir}/space.png` });
// 恢复
await ev(() => { const g = window.game; g.space.forceExit(); g.flight.piloting = false; g.running = true; });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
