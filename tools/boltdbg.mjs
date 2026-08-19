import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

const res = await page.evaluate(async () => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(false);
  g.running = true; g.paused = false; g.input.locked = true;
  g.quests.onInteractShip();
  for (let i = 0; i < 15; i++) g.quests.onMine(3, 'stone', 1);
  g.quests.onCraft('multitool', 1);
  for (let i = 0; i < 12; i++) g.quests.onPlace(7);
  g.inventory.addItem('multitool', 1);
  g.sky.timeSec = 360;
  await new Promise((r) => setTimeout(r, 400));
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (g.mobs.mobs.length > 0) break;
  }
  const mob = g.mobs.mobs[0];
  mob.update = () => false;
  g.player.flyMode = true;
  g.player.pos.set(mob.pos.x + 4, mob.pos.y + 2, mob.pos.z + 4);
  const dx = mob.pos.x - g.player.pos.x;
  const dz = mob.pos.z - g.player.pos.z;
  const dy = (mob.pos.y + 0.8) - (g.player.pos.y + 1.62);
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = Math.atan2(-dy, Math.hypot(dx, dz));
  await new Promise((r) => setTimeout(r, 200));

  const out = { cam: [], dir: [], mobHitCenter: [], trace: [] };
  const cam = g.camera;
  out.cam = [cam.position.x.toFixed(2), cam.position.y.toFixed(2), cam.position.z.toFixed(2)];
  const q = cam.quaternion;
  const dir = {
    x: -2 * (q.x * q.z + q.w * q.y),
    y: -2 * (q.y * q.z - q.w * q.x),
    z: -(1 - 2 * (q.x * q.x + q.y * q.y)),
  };
  out.dir = [dir.x.toFixed(3), dir.y.toFixed(3), dir.z.toFixed(3)];
  out.mobHitCenter = [mob.pos.x.toFixed(2), (mob.pos.y + 0.8).toFixed(2), mob.pos.z.toFixed(2)];
  // 模拟弹道：沿 dir 步进 0.7 每帧，检查命中判定
  let p = {
    x: cam.position.x + dir.x * 0.8,
    y: cam.position.y + dir.y * 0.8,
    z: cam.position.z + dir.z * 0.8,
  };
  for (let i = 0; i < 20; i++) {
    p.x += dir.x * 0.7; p.y += dir.y * 0.7; p.z += dir.z * 0.7;
    const ddx = mob.pos.x - p.x;
    const ddy = mob.pos.y + 0.8 - p.y;
    const ddz = mob.pos.z - p.z;
    const dist2 = ddx * ddx + ddy * ddy + ddz * ddz;
    const solid = g.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) !== 0;
    out.trace.push({
      step: i + 1,
      pos: [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)],
      hitMob: dist2 < 1.1,
      dist2: dist2.toFixed(2),
      solid,
    });
    if (dist2 < 1.1 || solid) break;
  }
  return out;
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
