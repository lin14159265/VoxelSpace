// 本轮验证：行星地下结构差异化——热行星熔岩囊 / 冰世界晶洞 / 地球无特殊地下结构
// 运行：node tools/verifyunderground.mjs [seed]
import { chromium } from 'playwright-core';

const SEED = process.argv[2] || '20240815';
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
const check = (name, ok, detail) => { R[name] = { ok: !!ok, detail }; console.log(`${ok ? '  ✓' : '  ✗'} ${name}`, detail ?? ''); };
const allOk = () => Object.values(R).filter((v) => v && typeof v === 'object' && 'ok' in v).every((v) => v.ok);

const countBlock = (g, pred) => {
  let n = 0;
  for (const chunk of g.world.chunks.values()) {
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      for (let y = 2; y < 34; y++) {
        if (pred(chunk.get(x, y, z))) n++;
      }
    }
  }
  return n;
};
const prepare = (g) => {
  g.player.respawn(g.world.spawnPoint());
  const pcx = Math.floor(g.player.pos.x / 16), pcz = Math.floor(g.player.pos.z / 16);
  g.world.ensureArea(pcx, pcz, 3);
  let guard = 0;
  while (g.world.dirty.size > 0 && guard++ < 3000) g.world.remeshQueue(g.player.pos.x, g.player.pos.z, 8);
};

await ev(() => {
  const g = window.game;
  g.startPlaying(); g.input.locked = true; g.setPaused(false);
  // 把 Node 侧辅助函数注入页面
  window.__countBlock = (pred) => {
    let n = 0;
    for (const chunk of g.world.chunks.values()) {
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
        for (let y = 2; y < 34; y++) if (pred(chunk.get(x, y, z))) n++;
      }
    }
    return n;
  };
  window.__prepare = () => {
    g.player.respawn(g.world.spawnPoint());
    const pcx = Math.floor(g.player.pos.x / 16), pcz = Math.floor(g.player.pos.z / 16);
    g.world.ensureArea(pcx, pcz, 3);
    let guard = 0;
    while (g.world.dirty.size > 0 && guard++ < 3000) g.world.remeshQueue(g.player.pos.x, g.player.pos.z, 8);
  };
});

// 1. 地球：无熔岩（基线）
R.earth = await ev(() => {
  const g = window.game;
  window.__prepare();
  return { magma: window.__countBlock((id) => id === 22), surface: g.world.gen.terrain.surface };
});
check('earth.noMagma', R.earth.surface === 'grass' && R.earth.magma === 0, JSON.stringify(R.earth));

// 2. 水星：地壳浅层熔岩囊
R.mercury = await ev(() => {
  const g = window.game;
  const np = g.space.galaxy.find((p) => p.name === '水星');
  g.applyNewWorld(np.seed, np.palette, { terrain: np.terrain, surface: np.surface, ores: np.ores, plants: np.plants, hazard: np.hazard, weather: np.weather, body: np, planetName: `${np.name} · 太阳系` });
  window.__prepare();
  return { magma: window.__countBlock((id) => id === 22), surface: g.world.gen.terrain.surface, underground: g.world.gen.terrain.underground };
});
check('mercury.magmaLayer', R.mercury.surface === 'barren' && R.mercury.underground === 'magma' && R.mercury.magma > 20, JSON.stringify(R.mercury));

// 2b. 熔岩风险与火光：靠近受伤 + 动态点光
R.magmaDanger = await ev(() => {
  const g = window.game;
  // 找到第一块熔岩并让玩家紧贴站立
  let target = null;
  outer:
  for (const chunk of g.world.chunks.values()) {
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      for (let y = 2; y < 34; y++) {
        if (chunk.get(x, y, z) === 22) { target = { x: chunk.cx * 16 + x, y, z: chunk.cz * 16 + z }; break outer; }
      }
    }
  }
  if (!target) return { err: 'no magma found' };
  g.player.health = 100; g.player.shield = 100;
  g.player.pos.set(target.x + 0.5, target.y, target.z + 0.5);
  g.refreshMagmaLights();
  const lights = g.magmaLights.length;
  const activeLights = g.magmaLights.filter((l) => l.active).length;
  g.updateMagmaHazard(1);
  const h1 = g.player.health;
  g.updateMagmaHazard(1);
  const h2 = g.player.health;
  return { target, lights, activeLights, h1, h2, warned: g.magmaWarned };
});
check('magma.burnsPlayer', R.magmaDanger.h1 < 100 && R.magmaDanger.h2 < R.magmaDanger.h1 && R.magmaDanger.warned, JSON.stringify(R.magmaDanger));
check('magma.dynamicLights', R.magmaDanger.lights > 0 && R.magmaDanger.activeLights > 0, `lights=${R.magmaDanger.lights} active=${R.magmaDanger.activeLights}`);

// 3. 木卫二：洞穴二氢晶簇（冰世界自动启用 crystal）
R.europa = await ev(() => {
  const g = window.game;
  const np = g.space.galaxy.find((p) => p.name === '木星');
  g.applyNewWorld(np.seed, np.palette, { terrain: np.terrain, surface: np.surface, ores: np.ores, plants: np.plants, hazard: np.hazard, weather: np.weather, body: np, planetName: `${np.name} · 太阳系` });
  g.space.current = np.id; // 使 landableMoons 返回木星卫星
  const moon = g.space.landableMoons().find((m) => m.navId === 'moon:solar.jupiter.europa');
  g.applyNewWorld(String(moon.radiusKm), moon.palette, { terrain: moon.terrain, surface: moon.surface, ores: moon.ores, plants: moon.plants, hazard: moon.hazard, weather: moon.weather, body: moon, planetName: `${moon.name} · 木星系统`, noCrashSite: true });
  window.__prepare();
  return { crystals: window.__countBlock((id) => id === 12), surface: g.world.gen.terrain.surface, underground: g.world.gen.terrain.underground };
});
check('europa.crystalCaves', R.europa.surface === 'ice' && R.europa.underground === 'crystal' && R.europa.crystals > 5, JSON.stringify(R.europa));

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const pass = allOk() && errors.length === 0;
console.log(pass ? 'CHECKS: all passed' : 'CHECKS: FAILED');
await browser.close();
process.exitCode = pass ? 0 : 1;
