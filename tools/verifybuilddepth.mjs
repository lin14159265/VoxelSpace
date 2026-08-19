// 第 45 轮验证：采矿与建造深度——石砖、MkII 工具升级、3×3 区域开采、放置虚影、存档持久化
// 运行：node tools/verifybuilddepth.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-builddepth';
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

// 1. 新物品与配方注册
R.registry = await ev(() => {
  const g = window.game;
  return {
    stoneBrickItem: !!(g.inventory && g.inventory.canAdd('stone_brick', 1)),
    mk2Item: !!(g.inventory && g.inventory.canAdd('mining_beam_mk2', 1)),
    brickRecipe: window.game.ui.craftCtx && true,
    recipeCount: document ? 0 : 0,
  };
});
R.registry.recipeCount = await ev(() => {
  const g = window.game;
  g.openBackpack();
  const n = document.querySelectorAll('#craft-list .craft-item').length;
  g.closeBackpack();
  return n;
});
check('石砖与 MkII 物品注册 + 配方表 14 项', R.registry && R.registry.stoneBrickItem && R.registry.mk2Item && R.registry.recipeCount === 14, R.registry);

// 2. 石砖可放置：预放置虚影出现，放置后世界方块正确
R.stoneBrick = await ev(() => {
  const g = window.game; const p = g.player;
  g.inventory.addItem('stone_brick', 8);
  const slot = g.inventory.findInHotbar('stone_brick');
  if (slot < 0) { g.inventory.slots[0] = { itemId: 'stone_brick', count: 8 }; g.inventory.select(0); }
  else g.inventory.select(slot);
  // 脚下造一块平坦石砖地基，玩家看向它
  const bx = Math.floor(p.pos.x) + 3, bz = Math.floor(p.pos.z);
  const gy = g.world.getGroundY(bx, bz);
  g.world.setBlock(bx, gy, bz, 23);
  for (let y = gy + 1; y <= gy + 3; y++) g.world.setBlock(bx, y, bz, 0); // 保证放置位无植物/树冠
  p.pos.set(bx + 0.5, gy + 2.0, bz + 0.5);
  p.yaw = 0; p.pitch = -1.35; p.updateCamera();
  p.updateTarget();
  const ghostBefore = { visible: p.placeGhost.visible, color: '#' + p.placeGhost.material.color.getHexString() };
  const t = p.target;
  const placed = !!(t && p.placeBlock(t) === true && g.world.getBlock(t.x + t.nx, t.y + t.ny, t.z + t.nz) === 23);
  p.pitch = -0.05; p.updateCamera(); p.updateTarget();
  return { target: t ? [t.x, t.y, t.z, t.nx, t.ny, t.nz] : null, ghostBefore, placed };
});
check('石砖预放置虚影 + 实际放置', R.stoneBrick && R.stoneBrick.ghostBefore.visible && R.stoneBrick.placed, R.stoneBrick);

// 3. MkI 不能开启区域开采；MkII 合成后里程碑点亮
R.mk2 = await ev(() => {
  const g = window.game;
  g.inventory.addItem('multitool', 1);
  g.inventory.addItem('copper_ore', 4);
  g.inventory.addItem('gold_ore', 2);
  g.inventory.addItem('glass', 1);
  const tierBefore = g.player.toolTier;
  const areaBefore = (() => {
    const t = g.player.target || { x: 1, y: 1, z: 1, nx: 0, ny: 1, nz: 0, id: 2 };
    g.player.miningMode = 1;
    const n = g.player.areaMiningTargets(t).length;
    g.player.miningMode = 0;
    return n;
  })();
  g.craftItem('mining_beam_mk2');
  return {
    tierBefore, areaBefore, tierAfter: g.player.toolTier,
    hasMk2: g.inventory.countOf('mining_beam_mk2') === 1,
    hasMk1: g.inventory.countOf('multitool') === 0,
    milestone: g.milestones.earned.has('mining_expert'),
  };
});
check('MkI 无区域模式；MkII 合成消耗 MkI 并解锁里程碑', R.mk2 && R.mk2.tierBefore === 1 && R.mk2.areaBefore === 1 && R.mk2.tierAfter === 2 && R.mk2.hasMk2 && R.mk2.hasMk1 && R.mk2.milestone, R.mk2);

// 4. MkII 3×3 区域开采：瞄准顶面一次破坏 9 块泥土
R.areaMine = await ev(() => {
  const g = window.game; const p = g.player;
  // 在玩家前方铺 3×3 泥土平台（与周围同层隔开，确保只计这 9 块）
  const x0 = Math.floor(p.pos.x) + 6, z0 = Math.floor(p.pos.z) + 6;
  const gy = g.world.getGroundY(x0, z0);
  const spots = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const y = gy + 2;
    g.world.setBlock(x0 + dx, y, z0 + dz, 2);
    spots.push([x0 + dx, y, z0 + dz]);
  }
  // 站到平台上方，垂直向下瞄准中心块
  p.pos.set(x0 + 0.5, gy + 5.5, z0 + 0.5);
  p.yaw = 0; p.pitch = -1.5; p.updateCamera();
  p.updateTarget();
  const t = p.target;
  if (!t) return { skipped: true, why: 'no target' };
  p.miningMode = 1;
  const targets = p.areaMiningTargets(t);
  const countBefore = targets.length;
  p.breakArea(targets);
  const remaining = spots.filter(([x, y, z]) => g.world.getBlock(x, y, z) !== 0).length;
  p.miningMode = 0;
  return { center: [t.x, t.y, t.z], normal: [t.nx, t.ny, t.nz], countBefore, remaining, dirtGained: g.inventory.countOf('dirt') };
});
check('MkII 顶面 3×3 一次破坏 9 块', R.areaMine && R.areaMine.countBefore === 9 && R.areaMine.remaining === 0, R.areaMine);

// 5. 挖掘进度高亮烧红 + 准星下方工具档位
R.feedback = await ev(() => {
  const g = window.game; const p = g.player;
  // 直接驱动高亮颜色：模拟进度 0.8
  const bx = Math.floor(p.pos.x) + 3, bz = Math.floor(p.pos.z);
  const y = g.world.getGroundY(bx, bz);
  g.world.setBlock(bx, y, bz, 2);
  p.pos.set(bx + 0.5, y + 2, bz + 0.5);
  p.yaw = 0; p.pitch = -1.4; p.updateCamera(); p.updateTarget();
  // 通过真实 Player.update 路径得到 ~0.8 进度：高亮应烧红且略微收缩
  const hardness = 0.5 / p.miningMultiplier;
  p.mineTarget = { x: bx, y, z: bz, id: 2, nx: 0, ny: 1, nz: 0 };
  p.mineProgress = hardness * 0.8;
  g.input.mouseDownSet.add(0);
  p.update(1 / 60);
  g.input.mouseDownSet.delete(0);
  const after = { r: p.highlight.material.color.r, g: p.highlight.material.color.g, b: p.highlight.material.color.b, scale: p.highlight.scale.x };
  g.frame = 11; g.clock.getDelta(); g.loop();
  g.frame = 11; g.clock.getDelta(); g.loop();
  const toolText = document.getElementById('tool-mode').textContent;
  const toolHidden = document.getElementById('tool-mode').classList.contains('hidden');
  p.mineFrac = 0; p.mineTarget = null; p.mineProgress = 0;
  return { after, toolText, toolHidden };
});
check('挖掘高亮随进度烧红 + HUD 工具档位常驻', R.feedback && R.feedback.after.r > 0.5 && R.feedback.after.g < 0.8 && R.feedback.after.scale < 1 && R.feedback.toolText.includes('MkII') && !R.feedback.toolHidden, R.feedback);

// 6. 存档持久化：MkII / 石砖 / 里程碑在重载后恢复
R.save = await ev(() => {
  const g = window.game;
  g.saveData = null;
  // 直接调用保存系统写 localStorage
  return import('../src/systems/save.js').then(({ saveGame }) => { saveGame(g); return true; });
});
// 显式 ?seed= 会跳过本地存档恢复；回到无 seed URL 才能验证“继续游戏”路径
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
R.reload = await ev(() => ({
  mk2: window.game.inventory.countOf('mining_beam_mk2'),
  brick: window.game.inventory.countOf('stone_brick'),
  milestone: window.game.milestones.earned.has('mining_expert'),
}));
check('MkII/石砖/里程碑存档重载恢复', R.save && R.reload.mk2 >= 1 && R.reload.brick >= 1 && R.reload.milestone, R.reload);

await page.screenshot({ path: `${outDir}/builddepth.png` });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const ok = allOk() && errors.length === 0;
console.log(ok ? 'CHECKS: all passed' : 'CHECKS: failed');
await browser.close();
if (!ok) process.exit(1);
