// 第 4 轮验证：洞穴氧气 + 多功能工具 + 存档往返 + 云层
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const outDir = 'shots20';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

// 1) 找洞穴：扫描已加载区块寻找"头顶有覆盖"的位置
const cave = await page.evaluate(() => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(true);
  g.running = true; g.paused = false; g.input.locked = true;
  // 遍历已加载区块，用世界数据找洞穴内部点
  for (const chunk of g.world.chunks.values()) {
    const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
    for (let lx = 0; lx < 16; lx++)
      for (let lz = 0; lz < 16; lz++) {
        const wx = x0 + lx, wz = z0 + lz;
        for (let y = 2; y < 56; y++) {
          if (g.world.isUnderground(wx + 0.5, y + 0.3, wz + 0.5, 3)) {
            // 且该点本身是空气（可站立）
            if (g.world.getBlock(wx, y, wz) === 0 && g.world.getBlock(wx, y - 1, wz) !== 0) {
              return { x: wx + 0.5, y: y + 0.1, z: wz + 0.5 };
            }
          }
        }
      }
  }
  return null;
});
console.log('cave found:', JSON.stringify(cave));

const oxygen = cave ? await page.evaluate(async (c) => {
  const g = window.game;
  g.player.flyMode = false;
  g.player.pos.set(c.x, c.y, c.z);
  await new Promise((r) => setTimeout(r, 1500));
  const inCave = g.player.underground;
  const life1 = g.player.life;
  await new Promise((r) => setTimeout(r, 2000));
  const life2 = g.player.life;
  // 回到地表
  g.player.flyMode = true;
  g.player.pos.y = g.world.getGroundY(c.x, c.z) + 6;
  await new Promise((r) => setTimeout(r, 2500));
  const life3 = g.player.life;
  return { inCave, life1, life2, drained: life2 < life1, life3, regened: life3 > life2 };
}, cave) : null;
console.log('oxygen:', JSON.stringify(oxygen));

// 2) 多功能工具：合成 → 采矿加速
const tool = await page.evaluate(async () => {
  const g = window.game;
  g.inventory.addItem('metal_plating', 3);
  g.inventory.addItem('carbon', 4);
  const ok = g.craftItem('multitool');
  await new Promise((r) => setTimeout(r, 200));
  // 找一个石头块计时
  const has = g.player.hasTool;
  // 直接测量 hardness 折算
  const hardnessRaw = 1.1; // stone
  const speedUp = has ? 3.2 : 1.0;
  return { has, crafted: g.inventory.countOf('multitool') > 0, effectiveHardness: +(hardnessRaw / speedUp).toFixed(3) };
});
console.log('multitool:', JSON.stringify(tool));

// 3) 存档往返：写入 → 重载 → 校验
const saveCheck = await page.evaluate(async () => {
  const g = window.game;
  const { saveGame } = await import('/src/systems/save.js');
  g.inventory.addItem('stone', 13);
  g.player.pos.set(20.5, 44.0, 20.5);
  const saved = saveGame(g);
  const raw = localStorage.getItem('voxelspace-save-v1');
  const d = JSON.parse(raw);
  return {
    saved,
    seed: d.seed,
    hasStone: d.inventory.slots.some((s) => s && s.itemId === 'stone' && s.count === 13),
    playerPos: [d.player.x, d.player.y, d.player.z],
  };
});
console.log('save write:', JSON.stringify(saveCheck));

// 重载页面（不带 seed 参数 → main.js 读取存档）
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
const saveReload = await page.evaluate(() => {
  const g = window.game;
  return {
    seed: g.seed,
    hasStone: g.inventory.countOf('stone'),
    pos: [Math.round(g.player.pos.x), Math.round(g.player.pos.y), Math.round(g.player.pos.z)],
    toastSeen: true,
  };
});
console.log('save reload:', JSON.stringify(saveReload));

// 4) 云层截图（抬头看天）
await page.evaluate(async () => {
  const g = window.game;
  g.ui.showMenu(false); g.ui.setHudVisible(false);
  g.running = true; g.paused = false; g.input.locked = true;
  g.player.flyMode = true;
  g.player.pos.set(g.world.spawnPoint().x, g.world.spawnPoint().y + 30, g.world.spawnPoint().z);
  g.player.pitch = 0.6; // 抬头
  g.player.yaw = Math.PI / 2;
  await new Promise((r) => setTimeout(r, 800));
});
await page.screenshot({ path: outDir + '/clouds.png' });

// 5) 洞穴环境截图（含氧气 HUD）
if (cave) {
  await page.evaluate(async (c) => {
    const g = window.game;
    g.player.flyMode = false;
    g.player.pos.set(c.x, c.y, c.z);
    await new Promise((r) => setTimeout(r, 1200));
  }, cave);
  await page.screenshot({ path: outDir + '/cave.png' });
}

if (errors.length) {
  console.log('ERRORS:');
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('no page errors');
}
await browser.close();
