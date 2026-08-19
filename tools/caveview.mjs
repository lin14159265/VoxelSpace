import { chromium } from 'playwright-core';
import fs from 'node:fs';
const outDir = 'shots21';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

// 菜单按钮状态（有存档时）
const menuState = await page.evaluate(() => ({
  continueHidden: document.getElementById('btn-continue').classList.contains('hidden'),
  newHidden: document.getElementById('btn-new').classList.contains('hidden'),
  startHidden: document.getElementById('btn-start').classList.contains('hidden'),
}));
console.log('menu:', JSON.stringify(menuState));

// 进游戏，找洞穴，HUD 开启，面向洞内深处
await page.evaluate(async () => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(true);
  g.running = true; g.paused = false; g.input.locked = true;
  let target = null;
  for (const chunk of g.world.chunks.values()) {
    const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
    for (let lx = 0; lx < 16 && !target; lx++)
      for (let lz = 0; lz < 16 && !target; lz++)
        for (let y = 4; y < 40 && !target; y++) {
          const wx = x0 + lx, wz = z0 + lz;
          if (g.world.getBlock(wx, y, wz) !== 0) continue;
          if (g.world.getBlock(wx, y - 1, wz) === 0) continue;
          if (g.world.isUnderground(wx + 0.5, y + 0.3, wz + 0.5, 3)) {
            // 找相邻的洞壁方向（哪个方向有实心 → 面向它）
            target = { x: wx + 0.5, y: y + 0.1, z: wz + 0.5 };
          }
        }
  }
  if (target) {
    g.player.flyMode = false;
    g.player.pos.set(target.x, target.y, target.z);
    await new Promise((r) => setTimeout(r, 1500));
    // 环视找最暗方向（粗略：朝 -x）
    g.player.yaw = Math.PI / 2;
    g.player.pitch = -0.2;
  }
});
await page.screenshot({ path: outDir + '/cave2.png' });
const caveState = await page.evaluate(() => ({
  underground: window.game.player.underground,
  life: window.game.player.life.toFixed(1),
}));
console.log('cave state:', JSON.stringify(caveState));
await browser.close();
