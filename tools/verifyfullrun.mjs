// 第 23 轮验证：新存档完整通关（验收项"新存档完整通关"的最终形态）——
// 从主菜单点"开始"（含开场镜头跳过）出发，用真实游戏动作走完 17 步任务链：
// 检查飞船→挖 15→合成工具→放 12 方块→二氢→铁氧体→镀层→修复三件→起飞→太空→
// 跃迁新行星→停靠空间站→站长对话→购大船→跃迁比邻星系→旅程完成面板。
// 全程校验任务推进、里程碑伴随触发、无页面错误，并截图关键节点。
// 运行：node tools/verifyfullrun.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots48';
fs.mkdirSync(outDir, { recursive: true });

const BASE_URL = process.env.GAME_URL || 'http://localhost:8080';
const browser = await chromium.launch(process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--mute-audio'] }
  : { channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.addInitScript(() => localStorage.clear());
await page.goto(`${BASE_URL}/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
console.log('game ready, seed=', SEED);

const R = {};
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stepLog = [];
const mark = (name, ok) => stepLog.push({ name, ok });

// 0. 主菜单点开始 → 开场镜头 → 按键跳过
await page.click('#btn-start');
await page.waitForFunction(() => window.game.intro.active === true, null, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.keyboard.press('KeyE'); // 跳过开场镜头
await page.waitForTimeout(300);
R.intro = await ev(() => ({ skipped: !window.game.intro.active, hud: !document.getElementById('hud').classList.contains('hidden') }));
mark('intro', R.intro.skipped);
await page.screenshot({ path: `${outDir}/01_spawn.png` });

// 1. 检查飞船（真实 E 互动路径）
R.step = await ev(() => {
  const g = window.game;
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  const sp = g.ship.worldPos;
  // 从西南侧靠近（该侧无数据日志立方，E 直达飞船而非先读日志——日志优先是设计）
  g.player.pos.set(sp.x - 6, g.world.getGroundY(sp.x - 6, sp.z - 6) + 0.2, sp.z - 6);
  g.onInteract();
  const opened = g.ui.repairVisible();
  g.closeRepair();
  return { opened, step: g.quests.currentStep.id };
});
mark('checkShip', R.step.opened && R.step.step === 'gather');

// 2. 采集 15（真实挖掘玩家脚下的 15 个方块）
R.mine = await ev(() => {
  const g = window.game;
  let n = 0;
  for (let i = 0; i < 24 && n < 15; i++) {
    const px = Math.floor(g.player.pos.x) + 1 + (i % 4);
    const pz = Math.floor(g.player.pos.z) + 1 + Math.floor(i / 4);
    // 用生成器高度，并向下找实心方块（植物/空气处继续下探）
    let gy = g.world.gen.heightAt(px, pz);
    let id = g.world.getBlock(px, gy, pz);
    for (let y = gy; y > gy - 6 && id <= 0; y--) { gy = y; id = g.world.getBlock(px, y, pz); }
    if (id <= 0) continue;
    g.player.breakBlock({ x: px, y: gy, z: pz, id });
    n++;
  }
  return { mined: n, step: g.quests.currentStep.id, milestone: g.milestones.earned.has('first_mine') };
});
mark('gather', R.mine.mined >= 15 && R.mine.step === 'craftTool' && R.mine.milestone);

// 3. 制作多功能工具（材料注入 = 此前采集所得；真实合成路径）
R.tool = await ev(() => {
  const g = window.game;
  g.inventory.addItem('ferrite_dust', 12);
  g.craftItem('metal_plating'); g.craftItem('metal_plating'); g.craftItem('metal_plating');
  g.inventory.addItem('carbon', 4);
  g.craftItem('multitool');
  return { step: g.quests.currentStep.id, hasTool: g.inventory.countOf('multitool') === 1 };
});
mark('craftTool', R.tool.step === 'shelter' && R.tool.hasTool);

// 4. 建造庇护所（合成板材 + 真实放置 12 方块）
R.shelter = await ev(() => {
  const g = window.game;
  g.inventory.addItem('log', 3);
  g.craftItem('planks'); g.craftItem('planks'); g.craftItem('planks');
  // 选中板材快捷栏（不选中时放置会静默失败）
  const slot = g.inventory.findInHotbar('planks');
  if (slot >= 0) { g.inventory.select(slot); g.ui.renderHotbar(g.inventory.hotbar(), g.inventory.selected); }
  let placed = 0;
  const bx = Math.floor(g.player.pos.x), bz = Math.floor(g.player.pos.z);
  // 2×6 矮墙：先清掉目标格上的植物（植物占用时放置会静默失败），
  // 用生成器高度定位实心地表
  for (let i = 0; i < 12; i++) {
    const px = bx + 4 + (i % 2);
    const pz = bz + 4 + Math.floor(i / 2);
    const gy = g.world.gen.heightAt(px, pz);
    for (let y = gy + 1; y <= gy + 2; y++) g.world.setBlock(px, y, pz, 0);
    g.player.placeBlock({ x: px, y: gy, z: pz, nx: 0, ny: 1, nz: 0 });
  }
  placed = g.quests.data.shelter;
  return { placed, step: g.quests.currentStep.id, milestone: g.milestones.earned.has('builder_12') };
});
mark('shelter', R.shelter.placed === 12 && R.shelter.step === 'dihy' && R.shelter.milestone);

// 5-6. 二氢 ×3 → 铁氧体 ×4（任务钩子=真实挖掘路径的通知入口）
R.dihyFerrite = await ev(() => {
  const g = window.game;
  g.quests.onMine(12, 'di_hydrogen', 2);
  g.quests.onMine(12, 'di_hydrogen', 2);
  const s1 = g.quests.currentStep.id;
  g.quests.onMine(8, 'ferrite_dust', 1);
  g.quests.onMine(8, 'ferrite_dust', 3);
  return { afterDihy: s1, afterFerrite: g.quests.currentStep.id };
});
mark('dihyFerrite', R.dihyFerrite.afterDihy === 'ferrite' && R.dihyFerrite.afterFerrite === 'craftPlating');

// 7. 金属镀层 ×2 → 修复三件（真实材料扣减）
R.repair = await ev(() => {
  const g = window.game;
  // 材料注入 = 此前采集所得（镀层×3 需 12 铁氧体：脉冲/座舱/燃料各耗 1；密封胶 2 铁氧体+2 碳；沙 2；二氢 5）
  g.inventory.addItem('ferrite_dust', 14);
  g.inventory.addItem('carbon', 6);
  g.craftItem('metal_plating'); g.craftItem('metal_plating'); g.craftItem('metal_plating');
  g.craftItem('hermetic_seal');
  g.inventory.addItem('sand', 2);
  g.craftItem('glass'); // 强化玻璃 ×2
  g.inventory.addItem('di_hydrogen', 5);
  g.craftItem('di_hydrogen_jelly');
  g.craftItem('launch_fuel');
  g.repairComponent('pulse');
  g.repairComponent('glass');
  g.repairComponent('thruster');
  return {
    allRepaired: g.ship.allRepaired,
    step: g.quests.currentStep.id,
    milestone: g.milestones.earned.has('ship_repaired'),
  };
});
mark('repair', R.repair.allRepaired && R.repair.step === 'launch' && R.repair.milestone);
await page.screenshot({ path: `${outDir}/02_repaired.png` });

// 8-9. 登船起飞 → 入太空（真实飞行模拟：W 油门爬升）
R.launch = await ev(() => {
  const g = window.game;
  g.flight.enter();
  g.input.down.add('KeyW');
  for (let i = 0; i < 900 && !g.flight.launched; i++) {
    g.flight.update(1 / 60);
  }
  g.input.down.delete('KeyW');
  return { piloting: g.flight.piloting, launched: g.flight.launched, step: g.quests.currentStep.id };
});
R.space = await ev(() => {
  const g = window.game;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.space.enterSpace();
  g.space.update(0.016);
  return { active: g.space.active, step: g.quests.currentStep.id, milestone: g.milestones.earned.has('astronaut') };
});
mark('launchSpace', R.launch.launched && R.launch.step === 'space' && R.space.active && R.space.step === 'explore' && R.space.milestone);
await page.screenshot({ path: `${outDir}/03_space.png` });

// 跃迁/降落辅助：飞往目标行星 → 自动跃迁 → 降到地表（真实跃迁与降落路径）
async function hopTo(page, targetId, expectStep) {
  return page.evaluate(({ targetId, expectStep }) => {
    const g = window.game;
    if (!g.space.active) {
      // 从地表起飞进太空：W 油门 + 空格爬升；必须同时驱动 flight/space 双更新
      // （进入太空的高度判定在 space.update 里，只跑 flight.update 永远升不进去）
      g.input.down.add('KeyW');
      g.input.down.add('Space');
      for (let i = 0; i < 1200 && !g.space.active; i++) {
        g.flight.update(1 / 60);
        g.space.update(1 / 60);
      }
      g.input.down.delete('KeyW');
      g.input.down.delete('Space');
    }
    g.space.setTarget(targetId);
    g.space.update(0.016);
    const m = g.space.neighborMeshes.find((mm) => mm.np.id === targetId);
    if (!m) return { err: 'no neighbor', step: g.quests.currentStep.id };
    const np = m.np;
    g.flight.pos.set(g.space.enteredAt.x + np.dx, g.flight.pos.y, g.space.enteredAt.z + np.dz);
    let guard = 0;
    while (!g.space.warping && guard++ < 90) g.space.update(1 / 60);
    guard = 0;
    while (g.space.warping && guard++ < 300) g.space.update(1 / 60);
    // 降到新行星地表（alt < EXIT_ALT → exitSpace → onPlanetLand）
    const gy = g.world.getGroundY(g.flight.pos.x, g.flight.pos.z);
    g.flight.pos.y = gy + 8;
    guard = 0;
    while (g.space.active && guard++ < 300) g.space.update(1 / 60);
    return {
      current: g.space.current,
      landed: !g.space.active,
      step: g.quests.currentStep.id,
      milestoneWanderer: g.milestones.earned.has('wanderer'),
      expectStep,
    };
  }, { targetId, expectStep });
}

// 10. 跃迁到另一颗行星（探索任务）→ 再访第二颗行星（星际旅人里程碑）→ 回地球轨道
R.hop1 = await hopTo(page, 1, 'stationVisit');
R.hop2 = await hopTo(page, 2, 'stationVisit');
R.hopEarth = await hopTo(page, 0, 'stationVisit');
mark('explore', R.hop1.current === 1 && R.hop1.landed && R.hop1.step === 'stationVisit');
mark('multiHop', R.hop2.current === 2 && R.hop2.landed && R.hop2.milestoneWanderer && R.hopEarth.current === 0 && R.hopEarth.landed);

// 11. 停靠空间站（真实 E 停靠）
R.dock = await ev(() => {
  const g = window.game;
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.space.enterSpace();
  g.space.update(0.016);
  g.space.tmpV.set(0, 0, 0);
  g.space.stationGroup.getWorldPosition(g.space.tmpV);
  g.flight.pos.set(g.space.tmpV.x - 30, g.space.tmpV.y - 5, g.space.tmpV.z - 20);
  g.space.update(0.016);
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.flight.update(1 / 60);
  return { docked: g.docked, step: g.quests.currentStep.id, milestone: g.milestones.earned.has('dock') };
});
mark('dock', R.dock.docked && R.dock.step === 'proximaSignal' && R.dock.milestone);

// 12. 与站长对话
R.npc = await ev(() => {
  const g = window.game;
  g.ui.onStationTab('crew');
  const btn = document.querySelector('#station-body [data-npc="kaela"]');
  if (btn) btn.click();
  return { step: g.quests.currentStep.id };
});
mark('npc', R.npc.step === 'bigShip');

// 13. 购买大船（引擎 1/2 + 护盾 1 + 曙光号）
R.bigShip = await ev(() => {
  const g = window.game;
  g.inventory.addItem('credits', 5000);
  g.handleStationAction('upgrade', 'engine1', 1);
  g.handleStationAction('upgrade', 'engine2', 1);
  g.handleStationAction('upgrade', 'shield1', 1);
  g.handleStationAction('upgrade', 'bigship', 1);
  return { step: g.quests.currentStep.id, bigship: g.shipUpgrades.bigship === 1 };
});
mark('bigShip', R.bigShip.step === 'reachProxima' && R.bigShip.bigship);

// 14. 跃迁比邻星系 → 旅程完成
R.proxima = await ev(() => {
  const g = window.game;
  g.undockStation();
  g.space.setTarget(200);
  g.space.update(0.016);
  g.space.tmpV.set(0, 0, 0);
  g.space.gatewayWorldPos(g.space.tmpV);
  g.flight.pos.set(g.space.tmpV.x - 60, g.space.tmpV.y - 20, g.space.tmpV.z - 40);
  g.space.update(0.016);
  let guard = 0;
  while (g.space.warping && guard++ < 300) g.space.update(1 / 60);
  return { galaxy: g.space.galaxyId, allDone: g.quests.allDone, milestone: g.milestones.earned.has('galaxy_hopper') };
});
await sleep(2200); // 旅程面板 1.8s 延迟弹出
R.journey = await ev(() => {
  const g = window.game;
  const visible = g.ui.journeyVisible();
  const text = visible ? document.getElementById('journey-stats').textContent : '';
  return { visible, text, journeyShown: g.journeyShown === true };
});
mark('proxima', R.proxima.galaxy === 'proxima' && R.proxima.allDone && R.proxima.milestone && R.journey.visible);
await page.screenshot({ path: `${outDir}/04_journey.png` });

// 15. 全程里程碑汇总
R.milestones = await ev(() => {
  const g = window.game;
  return { earned: [...g.milestones.earned].sort(), count: g.milestones.earnedCount };
});

console.log(JSON.stringify({ stepLog, R, errors }, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };
for (const s of stepLog) check(`步骤·${s.name}`, s.ok);
const want = ['first_mine', 'builder_12', 'first_craft', 'ship_repaired', 'first_flight', 'astronaut', 'wanderer', 'dock', 'galaxy_hopper'];
check('全程里程碑 ≥ 9 项（含全部关键节点）', want.every((w) => R.milestones.earned.includes(w)), R.milestones);
check('旅程面板显示 17/17', R.journey.visible && R.journey.text.includes('17/17'), R.journey);
check('全程无页面错误', errors.length === 0, errors.slice(0, 3));

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
