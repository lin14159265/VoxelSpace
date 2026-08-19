// 长时间连续游玩稳定性测试（soak）：
// 无头环境以固定步长快进模拟 ~50 分钟游戏时间——昼夜循环、走动/传送、
// 挖掘、扫描、夜间怪物、自动存档；监控内存/区块数/页面错误，
// 最后保存→重新加载页面→校验存档完整恢复（背包/坐标/任务/升级）。
// 运行：node tools/soaktest.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots41';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const ctx = await browser.newContext();
const page = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
console.log('game ready, seed=', SEED);

const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
});
await new Promise((r) => setTimeout(r, 500));

const R = {};
R.start = await ev(() => {
  const g = window.game;
  const mem = performance.memory ? performance.memory.usedJSHeapSize : null;
  return {
    heapMB: mem ? Math.round(mem / 1048576) : null,
    chunks: g.world.chunks.size,
    questIndex: g.quests.currentIndex,
    inventory: g.inventory.countOf('stone') + g.inventory.countOf('carbon'),
  };
});

// 快进模拟：每次迭代 = ~0.5s 游戏时间；共 6000 次 ≈ 50 分钟
const soak = await ev(async () => {
  const g = window.game;
  const { saveGame } = await import('/src/systems/save.js');
  // 让测试存档有"内容"：物品、任务进度、日志、升级——校验读档完整性
  g.inventory.addItem('stone', 37);
  g.inventory.addItem('sodium', 12);
  g.inventory.addItem('oxygen', 5);
  g.inventory.addItem('ferrite_dust', 11);
  g.inventory.addItem('credits', 40);
  g.quests.onInteractShip(); // 完成第 1 步
  g.collectedLogs.add(g.logs.items[0].id);
  g.logs.setCollected(g.collectedLogs);
  g.shipUpgrades = { engine: 1, shield: 0 };
  g.quests.currentIndex = 4; // 庇护所阶段后：夜间刷怪生效
  const steps = [];
  const TAU = Math.PI * 2;
  let t = 0;
  for (let i = 0; i < 6000; i++) {
    t += 0.5;
    // 玩家沿大圈缓慢移动（模拟探索）
    if (i % 4 === 0) {
      const a = t * 0.03;
      const px = 26 + Math.cos(a) * 30;
      const pz = 8 + Math.sin(a) * 30;
      const gy = g.world.getGroundY(px, pz);
      g.player.pos.set(px, gy + 0.2, pz);
      g.player.vel.set(0, 0, 0);
    }
    // 周期行为：白天挖矿、夜晚被动挨打/扫描
    const night = g.world.time > 0.55 && g.world.time < 0.95;
    if (i % 30 === 0 && !night) {
      // 朝脚下挖 2 秒（模拟采集）
      g.input.mouseDownSet.add(0);
      g.input.mousePressedSet.add(0);
      g.input.mousePressedAge.set(0, g.input.age);
    }
    if (i % 30 === 8) g.input.mouseDownSet.delete(0);
    if (i % 600 === 0) {
      g.input.pressedSet.add('KeyC'); g.input.pressedAge.set('KeyC', g.input.age); // 扫描
    }
    if (i % 1200 === 0) {
      g.input.pressedSet.add('Tab'); g.input.pressedAge.set('Tab', g.input.age); // 开背包
    }
    if (i % 1202 === 0) {
      g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age); // 关背包
    }
    g.accumulator += 0.5;
    g.loop();
    // 天空昼夜时钟与怪物管理按"游戏时间"推进（g.loop 的 rawDt 是真实毫秒，
    // 快进模拟需要手动驱动这两个系统才能覆盖昼夜循环/夜间刷怪/白天燃烧）
    g.sky.timeSec = (g.sky.timeSec + 0.5) % 480;
    g.sky.update(0, g.player.pos);
    g.mobs.update(0.5);
    if (i === 1500) steps.push({ at: '12.5min', chunks: g.world.chunks.size, dirty: g.world.dirty.size, mobs: g.mobs.mobs.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null });
    if (i === 3000) steps.push({ at: '25min', chunks: g.world.chunks.size, dirty: g.world.dirty.size, mobs: g.mobs.mobs.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null });
    if (i === 4500) steps.push({ at: '37.5min', chunks: g.world.chunks.size, dirty: g.world.dirty.size, mobs: g.mobs.mobs.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null });
  }
  const mem = performance.memory ? performance.memory.usedJSHeapSize : null;
  const inv = {};
  for (const s of g.inventory.slots) if (s) inv[s.itemId] = (inv[s.itemId] || 0) + s.count;
  // 手动保存（自动存档 60s 应也已触发过多次）
  const saveOk = saveGame(g) !== false;
  const saveSize = localStorage.getItem('voxelspace-save-v1')?.length || 0;
  return {
    heapMB: mem ? Math.round(mem / 1048576) : null,
    chunks: g.world.chunks.size,
    dirty: g.world.dirty.size,
    mobs: g.mobs.mobs.length,
    bolts: g.combat.bolts.length,
    particles: g.particles.mesh.count,
    questIndex: g.quests.currentIndex,
    inventory: inv,
    saveOk,
    saveSize,
    steps,
    pos: { x: Math.round(g.player.pos.x), y: Math.round(g.player.pos.y), z: Math.round(g.player.pos.z) },
    time: Math.round(g.world.time * 100) / 100,
    collectedLogs: [...g.collectedLogs],
    upgrades: { ...g.shipUpgrades },
    seed: g.seed,
  };
});

// 重新加载页面 → 继续游戏 → 校验存档恢复（同一 context 共享 localStorage）
const page2 = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
const errors2 = [];
page2.on('pageerror', (e) => errors2.push('PAGEERROR: ' + e.message));
page2.on('console', (m) => { if (m.type() === 'error') errors2.push('CONSOLE: ' + m.text()); });
await page2.goto(`http://localhost:8080/`, { waitUntil: 'load' });
await page2.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
const R2 = await page2.evaluate(() => {
  const g = window.game;
  const before = { inventory: {}, questIndex: g.quests ? g.quests.currentIndex : -1 };
  for (const s of g.inventory.slots) if (s) before.inventory[s.itemId] = (before.inventory[s.itemId] || 0) + s.count;
  // 走"继续游戏"路径（loadFromSave）
  const btn = document.getElementById('btn-continue');
  const hasContinue = !btn.classList.contains('hidden');
  let loaded = null;
  if (hasContinue) {
    btn.click();
    // 等读档完成
    return { hasContinue, clicked: true };
  }
  return { hasContinue, clicked: false };
});
await new Promise((r) => setTimeout(r, 2500));
R2.after = await page2.evaluate(() => {
  const g = window.game;
  const inv = {};
  for (const s of g.inventory.slots) if (s) inv[s.itemId] = (inv[s.itemId] || 0) + s.count;
  return {
    inventory: inv,
    questIndex: g.quests ? g.quests.currentIndex : -1,
    pos: { x: Math.round(g.player.pos.x), y: Math.round(g.player.pos.y), z: Math.round(g.player.pos.z) },
    running: g.running,
    seed: g.seed,
    upgrades: { ...g.shipUpgrades },
    collectedLogs: g.collectedLogs ? [...g.collectedLogs] : [],
    saveTime: g.saveData ? g.saveData.time : null,
  };
});

// 断言
const invEqual = (a, b) => {
  const ka = Object.keys(a).filter((k) => a[k] > 0).sort();
  const kb = Object.keys(b).filter((k) => b[k] > 0).sort();
  return JSON.stringify(ka) === JSON.stringify(kb) && ka.every((k) => a[k] === b[k]);
};

console.log(JSON.stringify({ soak, R2, errors, errors2 }, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('50 分钟快进无页面错误', errors.length === 0, errors.slice(0, 3));
check('手动保存成功', soak.saveOk === true);
check('存档文件非空（>1KB）', soak.saveSize > 1024, soak.saveSize);
check('区块数保持有界（≤ 卸载窗口 21×21）', soak.chunks <= 450, soak.chunks);
check('脏区块队列收敛（无持续积压）', soak.dirty <= 40, soak.dirty);
check('粒子池有界（<640）', soak.particles < 640, soak.particles);
check('能量弹不泄漏（<50）', soak.bolts < 50, soak.bolts);
check('内存增长可接受（<512MB）', soak.heapMB === null || soak.heapMB < 512, soak.heapMB);
check('模拟期存在夜间怪物阶段', soak.steps.some((s) => s.mobs > 0) || soak.mobs > 0, soak.steps);
check('读档页面有"继续游戏"', R2.hasContinue === true);
check('读档后背包物品一致', invEqual(R2.after.inventory, soak.inventory), { before: soak.inventory, after: R2.after.inventory });
check('读档后任务进度一致', R2.after.questIndex === soak.questIndex, { before: soak.questIndex, after: R2.after.questIndex });
check('读档后飞船升级一致', JSON.stringify(R2.after.upgrades) === JSON.stringify(soak.upgrades), { before: soak.upgrades, after: R2.after.upgrades });
check('读档后日志收集一致', JSON.stringify([...R2.after.collectedLogs].sort()) === JSON.stringify([...soak.collectedLogs].sort()));
check('读档页面无错误', errors2.length === 0, errors2.slice(0, 3));

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length || errors2.length ? [...errors, ...errors2].join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
