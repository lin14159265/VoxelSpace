import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

const res = await page.evaluate(async () => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(false);
  g.running = true; g.paused = false; g.input.locked = true;
  g.player.flyMode = true;
  g.particles.mesh.visible = false;
  await new Promise((r) => setTimeout(r, 300));

  // 飞船包围盒
  const box = new (g.ship.group.children[0] ? Object : Object)();
  const bb = g.ship.group.children.length;
  const box3 = g.ship.group.children.reduce((acc, o) => o.geometry ? o.geometry.boundingBox : acc, null);

  function centerPixel() {
    g.renderer.render(g.scene, g.camera);
    const gl = g.renderer.getContext();
    const w = gl.drawingBufferWidth, hgt = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * hgt * 4);
    gl.readPixels(0, 0, w, hgt, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const x = Math.floor(w / 2), y0 = Math.floor(hgt / 2);
    const i = (y0 * w + x) * 4;
    return [buf[i], buf[i + 1], buf[i + 2]];
  }

  // 相机正对飞船 5 格外
  const sp = g.ship.worldPos;
  g.player.pos.set(sp.x, sp.y + 1.5, sp.z + 5);
  g.player.yaw = Math.PI; g.player.pitch = -0.12;
  await new Promise((r) => setTimeout(r, 300));
  return {
    shipPos: [sp.x.toFixed(1), sp.y.toFixed(1), sp.z.toFixed(1)],
    children: bb,
    pixel: centerPixel(),
    cam: [g.camera.position.x.toFixed(1), g.camera.position.y.toFixed(1), g.camera.position.z.toFixed(1)],
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
