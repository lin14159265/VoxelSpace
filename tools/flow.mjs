// 第 2 轮全流程验证（按任务链顺序）：检查飞船 → 采集/合成 → 修复 → 引擎点亮
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const outDir = 'shots13';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

// 第一步：游戏态 + 靠近飞船检查（完成 checkShip）
await page.evaluate(async () => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(true);
  g.running = true; g.paused = false; g.input.locked = true;
  g.player.flyMode = true;
  g.player.pos.set(g.ship.worldPos.x - 3, g.ship.worldPos.y + 2, g.ship.worldPos.z);
  await new Promise((r) => setTimeout(r, 300));
  g.onInteract(); // 打开维修面板并完成 checkShip
  await new Promise((r) => setTimeout(r, 200));
  g.closeRepair();
  await new Promise((r) => setTimeout(r, 200));
});
await page.screenshot({ path: outDir + '/after-check.png' });

// 第二步：模拟采集推进任务链（gather→dihy→ferrite→craftPlating），再合成全套
await page.evaluate(async () => {
  const g = window.game;
  for (let i = 0; i < 15; i++) g.quests.onMine(3, 'stone', 1);
  g.quests.onCraft('multitool', 1);
  for (let i = 0; i < 12; i++) g.quests.onPlace(7);
  g.quests.onMine(12, 'di_hydrogen', 2);
  g.quests.onMine(12, 'di_hydrogen', 2);
  g.quests.onMine(8, 'ferrite_dust', 1);
  g.quests.onMine(8, 'ferrite_dust', 3);
  g.inventory.addItem('ferrite_dust', 12);
  g.inventory.addItem('carbon', 4);
  g.inventory.addItem('di_hydrogen', 10);
  g.inventory.addItem('stone', 30);
  g.openBackpack();
  await new Promise((r) => setTimeout(r, 200));
});
await page.screenshot({ path: outDir + '/backpack.png' });

const mid = await page.evaluate(async () => {
  const g = window.game;
  g.craftItem('metal_plating');
  g.craftItem('metal_plating');
  g.craftItem('hermetic_seal');
  g.craftItem('di_hydrogen_jelly');
  g.craftItem('launch_fuel');
  await new Promise((r) => setTimeout(r, 200));
  return { step: g.quests.currentStep.id };
});
await page.screenshot({ path: outDir + '/backpack-crafted.png' });
console.log('after craft:', JSON.stringify(mid));

// 第三步：关背包 → 打开维修面板
const rep = await page.evaluate(async () => {
  const g = window.game;
  g.closeBackpack();
  await new Promise((r) => setTimeout(r, 200));
  g.onInteract();
  await new Promise((r) => setTimeout(r, 300));
  return { visible: g.ui.repairVisible(), rows: document.querySelectorAll('#repair-list .repair-item').length };
});
await page.screenshot({ path: outDir + '/repair.png' });
console.log('repair panel:', JSON.stringify(rep));

// 第四步：修复两个组件
const fin = await page.evaluate(async () => {
  const g = window.game;
  const steps = [];
  g.repairComponent('pulse');
  steps.push(g.quests.currentStep.id);
  g.repairComponent('thruster');
  steps.push(g.quests.currentStep.id);
  await new Promise((r) => setTimeout(r, 200));
  return {
    steps,
    allRepaired: g.ship.allRepaired,
    sub: document.getElementById('repair-sub').textContent,
    fuelLeft: g.inventory.countOf('launch_fuel'),
    platingLeft: g.inventory.countOf('metal_plating'),
    sealLeft: g.inventory.countOf('hermetic_seal'),
  };
});
await page.screenshot({ path: outDir + '/repair-done.png' });
console.log('final:', JSON.stringify(fin));

// 第五步：关面板 → 引擎辉光像素验证
const glow = await page.evaluate(async () => {
  const g = window.game;
  g.closeRepair();
  g.particles.mesh.visible = false;
  const sp = g.ship.worldPos;
  g.player.pos.set(sp.x + 1, sp.y + 1.2, sp.z + 6);
  g.player.yaw = 0; g.player.pitch = -0.06;
  await new Promise((r) => setTimeout(r, 400));
  g.renderer.render(g.scene, g.camera);
  const gl = g.renderer.getContext();
  const w = gl.drawingBufferWidth, hgt = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * hgt * 4);
  gl.readPixels(0, 0, w, hgt, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let glowPx = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], gg = buf[i + 1], b = buf[i + 2];
    const cyanGlow = b > 200 && gg > 150 && r < 150;            // 脉冲引擎青
    const warmGlow = r > 200 && gg > 110 && gg < 210 && b < 100; // 推进器暖橙
    if (cyanGlow || warmGlow) glowPx++;
  }
  return glowPx;
});
console.log('glow pixels:', glow);
await page.screenshot({ path: outDir + '/repaired-ship.png' });

if (errors.length) {
  console.log('ERRORS:');
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('no page errors');
}
await browser.close();

