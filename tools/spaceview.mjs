// 太空视觉定向验证：脚下行星/大气辉光、行星标记、新星球地表色板
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const outDir = 'shots17';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

// 准备 + 登船 + 进太空
await page.evaluate(async () => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(true);
  g.running = true; g.paused = false; g.input.locked = true;
  g.ship.repair('pulse'); g.ship.repair('thruster');
  g.player.pos.set(g.ship.worldPos.x - 3, g.ship.worldPos.y + 1.8, g.ship.worldPos.z);
  g.player.flyMode = true;
  await new Promise((r) => setTimeout(r, 200));
  g.onInteract();
  await new Promise((r) => setTimeout(r, 400));
  g.input.down.add('Space');
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (g.space.active) break;
  }
  g.input.down.delete('Space');
  await new Promise((r) => setTimeout(r, 500));
});

// 1) 俯视脚下行星（大气辉光）
await page.evaluate(async () => {
  const g = window.game;
  g.flight.pitch = -0.85;
  await new Promise((r) => setTimeout(r, 600));
});
await page.screenshot({ path: outDir + '/planet-below.png' });

// 2) 平视 + 对准最近的行星标记
await page.evaluate(async () => {
  const g = window.game;
  g.flight.pitch = 0;
  const np = g.space.neighborOffsets()[0];
  const dx = np.dx, dz = np.dz;
  g.flight.yaw = Math.atan2(-dx, -dz) * 1; // 粗略对准
  await new Promise((r) => setTimeout(r, 500));
});
await page.screenshot({ path: outDir + '/marker.png' });

// 3) 直接跃迁：把飞船挪到目标行星旁触发
await page.evaluate(async () => {
  const g = window.game;
  const np = g.space.neighborOffsets()[0];
  g.flight.pos.x = g.space.enteredAt.x + np.dx;
  g.flight.pos.z = g.space.enteredAt.z + np.dz;
  await new Promise((r) => setTimeout(r, 1800));
});
await page.waitForTimeout(800);
const warpState = await page.evaluate(() => ({
  current: window.game.space.current,
  seed: window.game.seed,
  planet: window.game.planetName,
}));
console.log('warped to:', JSON.stringify(warpState));

// 4) 降落并出舱看新行星地表
await page.evaluate(async () => {
  const g = window.game;
  g.flight.pitch = 0;
  g.input.down.add('ShiftLeft');
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (!g.space.active) break;
  }
  g.input.down.delete('ShiftLeft');
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (g.flight.onGround && g.flight.speed < 1) break;
  }
  await new Promise((r) => setTimeout(r, 500));
  g.flight.exit();
  await new Promise((r) => setTimeout(r, 600));
  // 玩家转身环顾
  g.player.yaw = -Math.PI / 2;
  g.player.pitch = -0.1;
  await new Promise((r) => setTimeout(r, 600));
});
await page.screenshot({ path: outDir + '/newplanet-terrain.png' });

// 草地色相验证：读地面像素
const hueCheck = await page.evaluate(() => {
  const g = window.game;
  g.renderer.render(g.scene, g.camera);
  const gl = g.renderer.getContext();
  const w = gl.drawingBufferWidth, hgt = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * hgt * 4);
  gl.readPixels(0, 0, w, hgt, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  // 找画面中下部的主导绿色/紫色
  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  for (let y = Math.floor(hgt * 0.25); y < hgt * 0.7; y += 4)
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      rSum += buf[i]; gSum += buf[i + 1]; bSum += buf[i + 2]; n++;
    }
  return { avg: [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)], seed: g.seed };
});
console.log('terrain avg color:', JSON.stringify(hueCheck));

if (errors.length) {
  console.log('ERRORS:');
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('no page errors');
}
await browser.close();
