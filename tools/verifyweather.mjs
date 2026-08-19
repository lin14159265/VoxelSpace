// 本轮验证：行星环境危险(剧毒/高温/严寒) + 沙暴/暴雪 + 专属资源富集
// 运行：node tools/verifyweather.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '31415926';
const outDir = 'shots30';
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
  g.creative = false;
});
await sleep(400);

const gotoPlanet = (name) => ev((n) => {
  const g = window.game;
  const np = g.space.galaxy.find((p) => p.name === n);
  g.applyNewWorld(np.seed, np.palette, {
    terrain: np.terrain, surface: np.surface, ores: np.ores, plants: np.plants,
    hazard: np.hazard, weather: np.weather, planetName: `${np.name} · 太阳系`,
  });
  g.player.respawn(g.world.spawnPoint());
  const pcx = Math.floor(g.player.pos.x / 16), pcz = Math.floor(g.player.pos.z / 16);
  g.world.ensureArea(pcx, pcz, 6);
  let guard = 0;
  while (g.world.dirty.size > 0 && guard++ < 6000) g.world.remeshQueue(g.player.pos.x, g.player.pos.z, 16);
}, name);

// 1. 金星：剧毒全天消耗 + 环境徽章
await gotoPlanet('金星');
R.venus = await ev(() => {
  const g = window.game;
  g.sky.timeSec = 480 * 0.2; // 白天
  g.sky.update(0.016, g.player.pos);
  const h0 = g.player.hazard;
  g.player.hazard = 100;
  for (let i = 0; i < 120; i++) g.player.update(1 / 60);
  const hazardAfterDay = g.player.hazard;
  g.weather.update(1 / 60, g.player.pos); // 触发徽章刷新
  const badge = document.getElementById('env-badge').textContent;
  const hazardCfg = g.planetHazard;
  return { hazardAfterDay, drained: hazardAfterDay < 98, badge, kind: hazardCfg.kind, label: hazardCfg.label };
});

// 2. 火星：夜晚严寒消耗、白天恢复
await gotoPlanet('火星');
R.mars = await ev(() => {
  const g = window.game;
  g.sky.timeSec = 480 * 0.75; // 午夜
  g.sky.update(0.016, g.player.pos);
  g.player.hazard = 100;
  for (let i = 0; i < 120; i++) g.player.update(1 / 60);
  const hazardNight = g.player.hazard;
  g.sky.timeSec = 480 * 0.2; // 白天
  g.sky.update(0.016, g.player.pos);
  for (let i = 0; i < 240; i++) g.player.update(1 / 60);
  const hazardDay = g.player.hazard;
  return { hazardNight, drainedAtNight: hazardNight < 98, hazardDay, regenAtDay: hazardDay > hazardNight };
});

// 3. 风暴：沙暴来袭 → 强度/滤镜/危险倍率；白天火星无危险+风暴仍无危险（环境匹配）
R.storm = await ev(() => {
  const g = window.game;
  g.sky.timeSec = 480 * 0.2; // 白天
  g.sky.update(0.016, g.player.pos);
  g.weather.startStorm();
  for (let i = 0; i < 180; i++) g.weather.update(1 / 60, g.player.pos);
  const overlay = document.getElementById('weather-overlay');
  const stormState = {
    active: g.weather.stormActive,
    intensity: +g.weather.intensity.toFixed(2),
    inStorm: g.weather.inStorm,
    stormK: +g.weather.stormK.toFixed(2),
    overlayOpacity: +overlay.style.opacity,
    dustClass: overlay.classList.contains('dust'),
    badge: document.getElementById('env-badge').textContent,
  };
  // 金星风暴中危险翻倍
  return stormState;
});

// 4. 海王星：暴雪 + 二氢晶体富集
await gotoPlanet('海王星');
R.neptune = await ev(() => {
  const g = window.game;
  // 二氢晶体数量（已加载区块）
  let dihy = 0;
  for (const c of g.world.chunks.values()) {
    for (const v of c.data) if (v === 12) dihy++;
  }
  g.weather.startStorm();
  for (let i = 0; i < 150; i++) g.weather.update(1 / 60, g.player.pos);
  const overlay = document.getElementById('weather-overlay');
  const r = {
    dihyCount: dihy,
    weatherKind: g.weather.weather.kind,
    snowClass: overlay.classList.contains('snow'),
    intensity: +g.weather.intensity.toFixed(2),
    inStorm: g.weather.inStorm,
  };
  return r;
});
await sleep(400);
await page.screenshot({ path: `${outDir}/neptune_snowstorm.png` });

// 5. 资源富集对比：火星铁氧体 vs 地球铁氧体（已加载区块）
await gotoPlanet('火星');
R.resources = await ev(() => {
  const g = window.game;
  let ferrock = 0;
  for (const c of g.world.chunks.values()) {
    for (const v of c.data) if (v === 8) ferrock++;
  }
  return { marsFerrock: ferrock, chunks: g.world.chunks.size };
});
await ev(() => {
  const g = window.game;
  const home = g.space.galaxy[0];
  g.applyNewWorld(home.seed, home.palette, {
    terrain: home.terrain, surface: home.surface, ores: home.ores, plants: home.plants,
    hazard: home.hazard, weather: home.weather, planetName: '地球 · 太阳系',
  });
  g.player.respawn(g.world.spawnPoint());
  const pcx = Math.floor(g.player.pos.x / 16), pcz = Math.floor(g.player.pos.z / 16);
  g.world.ensureArea(pcx, pcz, 6);
  let guard = 0;
  while (g.world.dirty.size > 0 && guard++ < 6000) g.world.remeshQueue(g.player.pos.x, g.player.pos.z, 16);
});
R.resources.earthFerrock = await ev(() => {
  let n = 0;
  for (const c of window.game.world.chunks.values()) for (const v of c.data) if (v === 8) n++;
  return n;
});

// 6. 金星沙暴截图（风暴中）
await gotoPlanet('金星');
await ev(() => { const g = window.game; g.weather.startStorm(); for (let i = 0; i < 120; i++) g.weather.update(1 / 60, g.player.pos); });
await sleep(400);
await page.screenshot({ path: `${outDir}/venus_storm.png` });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
