// 世界渲染体检：高分辨率截图 + 几何审计（检测拉伸/撕裂三角形）
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '123456789';
const W = Number(process.argv[3] || 2560);
const H = Number(process.argv[4] || 1600);
const outDir = 'shots26';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
console.log('game ready, seed=', SEED, 'viewport=', W + 'x' + H);

// 进入游戏
await page.evaluate(() => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(true);
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true;
});

// 模拟行走：按住 W 前进 + 缓慢转视角，共 12 秒
for (let i = 0; i < 12; i++) {
  await page.evaluate((ii) => {
    const g = window.game;
    g.input.down.add('KeyW');
    g.player.yaw = (ii % 2 === 0 ? 0.3 : -0.5); // 蛇形
  }, i);
  await new Promise((r) => setTimeout(r, 1000));
  if (i === 1 || i === 5 || i === 11) {
    await page.screenshot({ path: `${outDir}/t${i}.png` });
  }
}
await page.evaluate(() => { window.game.input.down.delete('KeyW'); });
await page.screenshot({ path: `${outDir}/final.png` });

// 几何审计
const audit = await page.evaluate(() => {
  const g = window.game;
  const r = {
    webgl2: g.renderer.capabilities.isWebGL2,
    maxTextureSize: g.renderer.capabilities.maxTextureSize,
    precision: g.renderer.capabilities.precision,
    chunks: g.world.chunks.size,
    meshes: 0,
    totalTris: 0,
    badMeshes: [],
  };
  let totalVerts = 0, naNCount = 0, longEdges = 0, degen = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of g.world.chunks.values()) {
    for (const m of [c.meshOpaque, c.meshCutout]) {
      if (!m) continue;
      r.meshes++;
      const pos = m.geometry.getAttribute('position');
      if (!pos) continue;
      const n = pos.count;
      totalVerts += n;
      const idx = m.geometry.index;
      const triCount = idx ? idx.count / 3 : n / 3;
      r.totalTris += triCount;
      const arr = pos.array;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (!Number.isFinite(v)) naNCount++;
      }
      // 每个三角形的最大边长（优先走索引缓冲）
      let longE = 0, deg = 0;
      const triAt = (t) => {
        if (idx) {
          const ia = idx.getX(t * 3), ib = idx.getX(t * 3 + 1), ic = idx.getX(t * 3 + 2);
          return [ia * 3, ib * 3, ic * 3];
        }
        return [t * 9, (t * 3 + 1) * 3, (t * 3 + 2) * 3];
      };
      for (let t = 0; t < triCount; t++) {
        const [i0, i1, i2] = triAt(t);
        const dx1 = arr[i1] - arr[i0], dy1 = arr[i1 + 1] - arr[i0 + 1], dz1 = arr[i1 + 2] - arr[i0 + 2];
        const dx2 = arr[i2] - arr[i0], dy2 = arr[i2 + 1] - arr[i0 + 1], dz2 = arr[i2 + 2] - arr[i0 + 2];
        const dx3 = arr[i2] - arr[i1], dy3 = arr[i2 + 1] - arr[i1 + 1], dz3 = arr[i2 + 2] - arr[i1 + 2];
        const e1 = Math.hypot(dx1, dy1, dz1), e2 = Math.hypot(dx2, dy2, dz2), e3 = Math.hypot(dx3, dy3, dz3);
        const mx = Math.max(e1, e2, e3);
        if (mx > 2.5) longE++;
        if (e1 < 1e-6 || e2 < 1e-6 || e3 < 1e-6) deg++;
      }
      if (longE > 0 || deg > 0) {
        r.badMeshes.push({ cx: c.cx, cz: c.cz, kind: m.material === g.opaqueMat ? 'opaque' : 'cutout', verts: n, longEdges: longE, degen: deg });
      }
      longEdges += longE; degen += deg;
      const bb = m.geometry.boundingBox;
      if (bb) {
        minX = Math.min(minX, bb.min.x); maxX = Math.max(maxX, bb.max.x);
        minY = Math.min(minY, bb.min.y); maxY = Math.max(maxY, bb.max.y);
        minZ = Math.min(minZ, bb.min.z); maxZ = Math.max(maxZ, bb.max.z);
      }
    }
  }
  r.totalVerts = totalVerts; r.naNCount = naNCount; r.longEdges = longEdges; r.degen = degen;
  r.bbox = { minX, maxX, minY, maxY, minZ, maxZ };
  r.player = { x: g.player.pos.x, y: g.player.pos.y, z: g.player.pos.z };
  r.frame = g.frame;
  return r;
});
console.log('AUDIT:', JSON.stringify(audit, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
