// 第 49 轮验证：水体视觉与浅水玩法——湖泊生成/半透明流体网格/涉水减速/深水缺氧/水上建造
// 运行：node tools/verifywater.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-water';
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

// 1. 水体注册：非固体、透明液体、独立材质
R.registry = await ev(async () => {
  const { B, isSolid, isOpaque } = await import('/src/world/blocks.js');
  return {
    waterId: B.WATER === 26,
    nonSolid: !isSolid(B.WATER),
    nonOpaque: !isOpaque(B.WATER),
    fluidMat: !!(window.game.fluidMat && window.game.fluidMat.transparent && window.game.fluidMat.depthWrite === false),
  };
});
check('水方块注册为透明非固体 + 独立半透明材质', R.registry && R.registry.waterId && R.registry.nonSolid && R.registry.nonOpaque && R.registry.fluidMat, R.registry);

// 2. 草地湖泊自然生成 + 区块生成独立水体网格
R.lake = await ev(() => {
  const g = window.game; const W = g.world;
  const wl = W.gen.terrain.waterLevel || 14;
  let found = null;
  for (let x = -1200; x <= 1200 && !found; x += 4) {
    for (let z = -1200; z <= 1200 && !found; z += 4) {
      const h = W.gen.heightAt(x, z);
      if (h < wl) { found = { x, z, h }; break; }
    }
  }
  if (!found) return { found: false };
  const cx = Math.floor(found.x / 16), cz = Math.floor(found.z / 16);
  W.ensureArea(cx, cz, 2);
  let guard = 0;
  while (W.dirty.size > 0 && guard++ < 200) W.remeshQueue(found.x, found.z, 8);
  const c = W.getChunk(cx, cz, false);
  let waterBlocks = 0;
  if (c) for (const v of c.data) if (v === 26) waterBlocks++;
  // P0-1 回归：所有水面以下列在植物/树木生成后仍完整保留水体
  let waterColumns = 0, waterColumnErrors = 0;
  if (c) {
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const wx = cx * 16 + lx, wz = cz * 16 + lz;
        const h = W.gen.heightAt(wx, wz);
        if (h >= wl) continue;
        waterColumns++;
        for (let y = h + 1; y <= wl; y++) if (c.get(lx, y, lz) !== 26) waterColumnErrors++;
      }
    }
  }
  return {
    found, waterLevel: wl, waterBlocks,
    blockWater: W.getBlock(found.x, wl, found.z) === 26,
    fluidMesh: !!(c && c.meshFluid),
    waterColumns, waterColumnErrors,
  };
});
check('草地洼地湖泊与流体网格', R.lake && R.lake.found && R.lake.waterBlocks > 0 && R.lake.blockWater && R.lake.fluidMesh, R.lake);
check('湖泊水面不被植物/树木覆盖', R.lake && R.lake.waterColumns > 0 && R.lake.waterColumnErrors === 0, R.lake);

// 3. 涉水减速：脚部入水时步行速度明显下降
R.wade = await ev(() => {
  const g = window.game; const p = g.player;
  g.creative = false; p.flyMode = false;
  const bx = Math.floor(p.pos.x) + 20, bz = Math.floor(p.pos.z) + 2;
  const gy = g.world.getGroundY(bx, bz);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    for (let y = gy - 1; y <= gy + 3; y++) g.world.setBlock(bx + dx, y, bz + dz, 0);
    g.world.setBlock(bx + dx, gy - 1, bz + dz, 2); // 湖底
  }
  p.pos.set(bx + 0.5, gy, bz + 0.5); p.vel.set(0, 0, 0); p.onGround = true;
  g.input.down.add('KeyW');
  for (let i = 0; i < 12; i++) p.update(1 / 60);
  const drySpeed = Math.hypot(p.vel.x, p.vel.z);
  g.input.down.delete('KeyW');
  // 灌入 5×5 浅水：起跑全程脚部都泡在水里
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) g.world.setBlock(bx + dx, gy, bz + dz, 26);
  p.vel.set(0, 0, 0);
  g.input.down.add('KeyW');
  for (let i = 0; i < 12; i++) p.update(1 / 60);
  const wetSpeed = Math.hypot(p.vel.x, p.vel.z);
  g.input.down.delete('KeyW');
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) g.world.setBlock(bx + dx, gy, bz + dz, 0);
  return { dry: Number(drySpeed.toFixed(2)), wet: Number(wetSpeed.toFixed(2)), slowed: wetSpeed < drySpeed * 0.75 };
});
check('腿部入水移动减速', R.wade && R.wade.slowed && R.wade.wet > 0, R.wade);

// 4. 深水缺氧：头没入水中消耗生命维持，先警告、耗尽后受伤
R.drown = await ev(() => {
  const g = window.game; const p = g.player;
  g.creative = false; p.flyMode = false;
  const bx = Math.floor(p.pos.x) + 24, bz = Math.floor(p.pos.z) + 2;
  const gy = g.world.getGroundY(bx, bz);
  g.world.setBlock(bx, gy + 1, bz, 26);
  g.world.setBlock(bx, gy + 2, bz, 26);
  p.pos.set(bx + 0.5, gy, bz + 0.5); // 眼睛位于 gy+1.62 的水中
  p.life = 20; p.health = 100; p.shield = 100; p.waterWarned = false;
  p.updateVitals(0.5);
  const warned = p.waterWarned === true && p.life < 20;
  const lifeAfter = p.life;
  p.life = 0; p.health = 50; p.shield = 0; p.hurtTimer = 0;
  p.updateVitals(0.5);
  const damaged = p.health < 50;
  g.world.setBlock(bx, gy + 1, bz, 0); g.world.setBlock(bx, gy + 2, bz, 0);
  return { warned, lifeAfter: Number(lifeAfter.toFixed(1)), damaged, health: p.health };
});
check('头没入水先警告后受伤', R.drown && R.drown.warned && R.drown.damaged, R.drown);

// 5. 水上建造：放置虚影允许替换水，右键可在水格放置方块
R.buildOnWater = await ev(() => {
  const g = window.game; const p = g.player;
  const bx = Math.floor(p.pos.x) + 28, bz = Math.floor(p.pos.z) + 2;
  const gy = g.world.getGroundY(bx, bz);
  g.world.setBlock(bx, gy, bz, 2);
  g.world.setBlock(bx, gy + 1, bz, 26);
  g.inventory.slots[0] = { itemId: 'dirt', count: 10 }; g.inventory.select(0);
  p.pos.set(bx + 0.5, gy + 2, bz + 0.5); p.yaw = 0; p.pitch = -1.4; p.updateCamera(); p.updateTarget();
  const t = p.target;
  const ghostGreen = p.placeGhost.visible && p.placeGhost.material.color.getHex() === 0x7dffb0;
  const placed = !!(t && p.placeBlock(t) === true && g.world.getBlock(t.x + t.nx, t.y + t.ny, t.z + t.nz) === 2);
  g.world.setBlock(bx, gy + 1, bz, 0);
  return { ghostGreen, placed, target: t ? [t.x, t.y, t.z, t.nx, t.ny, t.nz] : null };
});
check('预放置虚影允许填水建造', R.buildOnWater && R.buildOnWater.ghostGreen && R.buildOnWater.placed, R.buildOnWater);

// 6. 截图湖面
if (R.lake && R.lake.found) {
  await ev(({ x, z }) => {
    const g = window.game;
    g.running = false;
    const y = g.world.gen.heightAt(x, z);
    g.camera.position.set(x + 12, y + 7, z + 14);
    g.camera.lookAt(x, y + 1, z);
    g.sky.update(0, g.camera.position);
    g.renderer.render(g.scene, g.camera);
  }, { x: R.lake.found.x, z: R.lake.found.z });
  await sleep(300);
  await page.screenshot({ path: `${outDir}/lake.png` });
  await ev(() => { window.game.running = true; });
}

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const ok = allOk() && errors.length === 0;
console.log(ok ? 'CHECKS: all passed' : 'CHECKS: failed');
await browser.close();
if (!ok) process.exit(1);
