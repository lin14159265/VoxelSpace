// 第 5 轮验证：夜间生物、能量武器、洞穴暗化+头灯、旅程完成面板
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const outDir = 'shots23';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

// 1) 夜晚 + 庇护所阶段 → 生物生成
const mobs = await page.evaluate(async () => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(true);
  g.running = true; g.paused = false; g.input.locked = true;
  // 推进到庇护所之后
  g.quests.onInteractShip();
  for (let i = 0; i < 15; i++) g.quests.onMine(3, 'stone', 1);
  g.quests.onCraft('multitool', 1);
  for (let i = 0; i < 12; i++) g.quests.onPlace(7);
  // 给工具（Q 开火需要）
  g.inventory.addItem('multitool', 1);
  // 快进到午夜
  g.sky.timeSec = 360;
  await new Promise((r) => setTimeout(r, 500));
  // 等待生成（最多 15s）
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (g.mobs.mobs.length > 0) break;
  }
  return { count: g.mobs.mobs.length, night: g.sky.nightFactor };
});
console.log('mobs:', JSON.stringify(mobs));

// 2) 战斗：冻结生物 → 瞄准开火（弹道）→ 直接受击致死（掉落）
const combat = await page.evaluate(async () => {
  const g = window.game;
  if (g.mobs.mobs.length === 0) return { skipped: true };
  const mob = g.mobs.mobs[0];
  const hpBefore = mob.health;
  // 冻结生物移动（保留渲染）
  mob.update = () => false;
  // 玩家瞬移到生物旁，视线对准生物身体
  g.player.flyMode = true;
  g.player.pos.set(mob.pos.x + 4, mob.pos.y + 2, mob.pos.z + 4);
  const dx = mob.pos.x - g.player.pos.x;
  const dz = mob.pos.z - g.player.pos.z;
  const dy = (mob.pos.y + 0.8) - (g.player.pos.y + 1.62);
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = -Math.atan2(-dy, Math.hypot(dx, dz)); // 相机俯仰：正值向上
  await new Promise((r) => setTimeout(r, 200));
  // 弹道开火（模拟 Q，尊重冷却）
  const carbonBefore = g.inventory.countOf('carbon');
  let fired = 0;
  for (let i = 0; i < 10 && mob.alive; i++) {
    g.combat.fire();
    fired++;
    await new Promise((r) => setTimeout(r, 130));
  }
  const afterBolts = { hp: mob.health, alive: mob.alive };
  // 直接受击致死验证（每击 14 伤害，30 血需 3 击）
  while (mob.alive) {
    mob.hit(14, { x: 0, z: -1 });
  }
  await new Promise((r) => setTimeout(r, 300));
  const dead = !mob.alive;
  const carbonAfter = g.inventory.countOf('carbon');
  // 恢复 update（死亡动画由 manager 处理）
  return {
    hpBefore,
    afterBolts,
    dead,
    dropCarbon: carbonAfter - carbonBefore,
    fired,
  };
});
console.log('combat:', JSON.stringify(combat));
await page.waitForTimeout(600);
await page.screenshot({ path: outDir + '/mob-night.png' });

// 3) 洞穴暗化 + 头灯
const cave = await page.evaluate(async () => {
  const g = window.game;
  // 找洞穴点
  let target = null;
  for (const chunk of g.world.chunks.values()) {
    const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
    for (let lx = 0; lx < 16 && !target; lx++)
      for (let lz = 0; lz < 16 && !target; lz++)
        for (let y = 4; y < 50 && !target; y++) {
          const wx = x0 + lx, wz = z0 + lz;
          if (g.world.getBlock(wx, y, wz) !== 0 || g.world.getBlock(wx, y - 1, wz) === 0) continue;
          if (g.world.isUnderground(wx + 0.5, y + 0.3, wz + 0.5, 3)) {
            target = { x: wx + 0.5, y: y + 0.1, z: wz + 0.5 };
          }
        }
  }
  if (!target) return { skipped: true };
  g.player.flyMode = false;
  g.player.pos.set(target.x, target.y, target.z);
  await new Promise((r) => setTimeout(r, 2000));
  const sunI = g.sky.sunLight.intensity;
  const hemiI = g.sky.hemi.intensity;
  const lampI = g.headlamp.intensity;
  // 回到地表对比
  g.player.flyMode = true;
  g.player.pos.y = g.world.getGroundY(target.x, target.z) + 5;
  await new Promise((r) => setTimeout(r, 2000));
  return {
    inCave: g.player.underground === false ? 'wasTrue' : 'stillTrue',
    caveSun: sunI, caveHemi: hemiI, caveLamp: lampI,
    surfaceSun: g.sky.sunLight.intensity, surfaceHemi: g.sky.hemi.intensity, surfaceLamp: g.headlamp.intensity,
  };
});
console.log('cave dim:', JSON.stringify(cave));

// 4) 旅程完成面板
const journey = await page.evaluate(async () => {
  const g = window.game;
  // 快速完成全部任务
  g.quests.onMine(12, 'di_hydrogen', 2);
  g.quests.onMine(12, 'di_hydrogen', 2);
  g.quests.onMine(8, 'ferrite_dust', 1);
  g.quests.onMine(8, 'ferrite_dust', 3);
  g.quests.onCraft('metal_plating', 2);
  g.quests.onShipRepair('pulse');
  g.quests.onShipRepair('thruster');
  g.quests.onLaunch();
  g.quests.onEnterSpace();
  g.quests.onPlanetLand();
  await new Promise((r) => setTimeout(r, 2500));
  return {
    allDone: g.quests.allDone,
    panelVisible: !document.getElementById('journey-panel').classList.contains('hidden'),
    stats: document.getElementById('journey-stats').textContent,
  };
});
console.log('journey:', JSON.stringify(journey));
await page.screenshot({ path: outDir + '/journey.png' });

if (errors.length) {
  console.log('ERRORS:');
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('no page errors');
}
await browser.close();
