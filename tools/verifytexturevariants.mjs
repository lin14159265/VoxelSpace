// 第 50 轮验证：材质变体——常见方块按世界位置使用不同瓦片，打破大面积重复感
// 运行：node tools/verifytexturevariants.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-texturevariants';
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
});

// 1. 图集扩展为 50 瓦片，常见方块定义了多瓦片变体
R.registry = await ev(async () => {
  const { TILE_COUNT, TILE } = await import('/src/world/tiles.js');
  const { B, def } = await import('/src/world/blocks.js');
  const pools = {
    grassTop: def(B.GRASS).variants.top,
    dirtAll: def(B.DIRT).variants.all,
    stoneAll: def(B.STONE).variants.all,
    sandAll: def(B.SAND).variants.all,
  };
  return {
    tileCount: TILE_COUNT,
    pools,
    tileV2Valid: TILE.GRASS_TOP_V2 < TILE_COUNT && TILE.STONE_V3 < TILE_COUNT,
  };
});
check('图集 50 瓦片 + 草/泥/石/沙变体池', R.registry && R.registry.tileCount === 50 && R.registry.pools.grassTop.length === 3 && R.registry.pools.dirtAll.length === 3 && R.registry.pools.stoneAll.length === 3 && R.registry.pools.sandAll.length === 3 && R.registry.tileV2Valid, R.registry);

// 2. 变体选择确定且实际使用多个变体
R.selection = await ev(async () => {
  const { pickTileVariant } = await import('/src/world/mesher.js');
  const { B, def } = await import('/src/world/blocks.js');
  const d = def(B.STONE);
  const used = new Set();
  for (let x = 0; x < 96; x++) used.add(pickTileVariant(d, 2, x, 16, 32));
  return {
    deterministic: pickTileVariant(d, 2, 11, 16, 32) === pickTileVariant(d, 2, 11, 16, 32),
    used: [...used],
  };
});
check('岩石顶面 96 位置使用多个变体且确定', R.selection && R.selection.deterministic && R.selection.used.length >= 2, R.selection);

// 3. 图标画布确实生成了变体瓦片，且不同变体像素不同
R.canvases = await ev(async () => {
  const { TILE } = await import('/src/world/tiles.js');
  const canvases = window.game.ui.tileCanvases;
  const hash = (tile) => {
    const cv = canvases.get(tile);
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < d.length; i += 16) {
      h ^= d[i] + (d[i + 1] << 8) + (d[i + 2] << 16);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  };
  return {
    stone1: hash(TILE.STONE),
    stone2: hash(TILE.STONE_V2),
    stone3: hash(TILE.STONE_V3),
    grass1: hash(TILE.GRASS_TOP),
    grass2: hash(TILE.GRASS_TOP_V2),
  };
});
check('变体瓦片画布已生成且互不相同', R.canvases && R.canvases.stone1 !== null && R.canvases.stone1 !== R.canvases.stone2 && R.canvases.stone2 !== R.canvases.stone3 && R.canvases.grass1 !== R.canvases.grass2, R.canvases);

// 4. 地表截图：确保变体网格正常渲染
await ev(() => {
  const g = window.game; const p = g.player;
  p.pos.set(10.5, g.world.getGroundY(10, 10) + 2.2, 10.5);
  p.yaw = 0.4; p.pitch = -0.28; p.updateCamera();
});
await sleep(300);
await page.screenshot({ path: `${outDir}/terrain-variants.png` });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const ok = allOk() && errors.length === 0;
console.log(ok ? 'CHECKS: all passed' : 'CHECKS: failed');
await browser.close();
if (!ok) process.exit(1);
