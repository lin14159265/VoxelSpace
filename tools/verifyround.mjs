// 本轮功能验证：主菜单/设置/创造模式/放置消抖/草皮UV/飞船/Esc流程/激光枪
// 运行：node tools/verifyround.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '987654321';
const outDir = 'shots27';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);
// 确定性按键：帧1（可能 0 固定步）验证事件存活，帧2 强制消费
const press = (code) => page.evaluate((c) => {
  const g = window.game;
  g.input.pressedSet.add(c);
  g.input.pressedAge.set(c, g.input.age);
  g.clock.getDelta(); g.loop();
  g.accumulator = 0.03;
  g.clock.getDelta(); g.loop();
}, code);

// 1. 主菜单按钮
R.menuButtons = await ev(() => ({
  start: !document.getElementById('btn-start').classList.contains('hidden'),
  cont: !document.getElementById('btn-continue').classList.contains('hidden'),
  load: !document.getElementById('btn-load').classList.contains('hidden'),
  settings: !!document.getElementById('btn-settings-menu'),
  quit: !!document.getElementById('btn-quit'),
}));
await page.screenshot({ path: `${outDir}/menu.png` });

// 2. 进入游戏（无头环境模拟指针锁定成功）
await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.input.locked = true;
  g.setPaused(false);
});
await sleep(600);
await page.screenshot({ path: `${outDir}/game_gun.png` });

// 3. 草皮侧面 UV 全局审计（顶角 v 一致、底角 v 一致、二者不同）
R.grassUv = await ev(() => {
  const g = window.game;
  let sideQuads = 0, bad = 0;
  for (const c of g.world.chunks.values()) {
    for (const m of [c.meshOpaque, c.meshCutout]) {
      if (!m || !m.geometry.index) continue;
      const pos = m.geometry.getAttribute('position');
      const nrm = m.geometry.getAttribute('normal');
      const uv = m.geometry.getAttribute('uv');
      const idx = m.geometry.index;
      for (let i = 0; i < idx.count; i += 6) {
        const a = idx.getX(i), b = idx.getX(i + 1), c2 = idx.getX(i + 2), d = idx.getX(i + 5);
        if (Math.abs(nrm.getX(a)) + Math.abs(nrm.getZ(a)) < 0.5) continue; // 仅侧面
        sideQuads++;
        let maxY = -Infinity, minY = Infinity, vTop = 0, vBot = 0, ok = true;
        for (const vi of [a, b, c2, d]) {
          const y = pos.getY(vi);
          if (y > maxY) maxY = y;
          if (y < minY) minY = y;
        }
        let topV = null, botV = null;
        for (const vi of [a, b, c2, d]) {
          const y = pos.getY(vi), v = uv.getY(vi);
          if (y === maxY) { if (topV === null) topV = v; else if (topV !== v) ok = false; }
          if (y === minY) { if (botV === null) botV = v; else if (botV !== v) ok = false; }
        }
        if (!ok || topV === botV) bad++;
        if (topV !== null && botV !== null) { vTop += topV; vBot += botV; }
      }
    }
  }
  return { sideQuads, bad };
});

// 4. 放置消抖：右键按下一次 → 固定步长循环 6 步只放 1 个方块
R.placeDebounce = await ev(() => {
  const g = window.game;
  // 新档背包为空：先给一把泥土
  g.inventory.addItem('dirt', 64);
  g.inventory.select(g.inventory.findInHotbar('dirt') >= 0 ? g.inventory.findInHotbar('dirt') : 0);
  let placed = 0;
  const old = g.world.events.onBlockPlaced;
  g.world.events.onBlockPlaced = () => placed++;
  // 低头保证 5 格内有地面目标
  const savedPitch = g.player.pitch;
  g.player.pitch = -1.3;
  const ep = g.player.eyePos;
  const yaw = g.player.yaw, pitch = g.player.pitch;
  const dir = {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
  const t = g.world.raycast(ep.x, ep.y, ep.z, dir.x, dir.y, dir.z, 5);
  g.player.pitch = savedPitch;
  if (!t) { g.world.events.onBlockPlaced = old; return { skipped: true, why: 'no target' }; }
  g.input.mousePressedSet.add(2);
  for (let i = 0; i < 6; i++) g.player.update(1 / 60);
  g.world.events.onBlockPlaced = old;
  return { placed, expected: 1 };
});

// 5. 按键：F=手电筒，X 在生存模式不得开启免费飞行（核心乐趣保护）
await ev(() => { window.game.creative = false; window.game.player.flyMode = false; window.game.flashlightOn = false; });
await press('KeyF');
await press('KeyX');
R.keys = await ev(() => {
  const g = window.game;
  const r = { flashlightOn: g.flashlightOn, flyBlocked: g.player.flyMode === false };
  g.player.flyMode = false;
  return r;
});

// 5b. 0 步帧不丢输入（高刷新率显示器场景回归）
R.pressedSurvival = await ev(() => {
  const g = window.game;
  g.flashlightOn = false;
  g.input.pressedSet.add('KeyF');
  g.input.pressedAge.set('KeyF', g.input.age);
  g.clock.getDelta(); g.loop();          // 0 固定步帧：不消费也不丢
  const afterFrame1 = g.input.pressed('KeyF');
  g.accumulator = 0.03;                   // 强制下一帧执行固定步
  g.clock.getDelta(); g.loop();
  const afterFrame2 = g.input.pressed('KeyF');
  const toggled = g.flashlightOn;
  g.flashlightOn = false;
  return { survivedZeroStepFrame: afterFrame1, consumedAfter: !afterFrame2, toggled };
});

// 6. 飞行下降（Shift）
R.flyDescend = await ev(() => {
  const g = window.game;
  g.player.flyMode = true;
  g.player.pos.y += 6;
  g.player.vel.set(0, 0, 0);
  g.input.down.add('ShiftLeft');
  for (let i = 0; i < 30; i++) g.player.update(1 / 60);
  g.input.down.delete('ShiftLeft');
  const r = { vy: g.player.vel.y, descendWorks: g.player.vel.y < -0.5 };
  g.player.flyMode = false;
  return r;
});

// 7. 飞船面板 E → Esc 关闭流程（回归历史卡死 bug）
R.repairEsc = await ev(() => {
  const g = window.game;
  g.player.pos.x = g.world.crashX - 6;
  g.player.pos.z = g.world.crashZ;
  g.onInteract();
  const opened = g.ui.repairVisible() && g.inMenu === true;
  g.input.pressedSet.add('Escape');
  g.loop();
  const closed = !g.ui.repairVisible() && g.inMenu === false;
  const wantLock = g.wantLock === true; // 无头环境指针锁不可用 → 应进入手势兜底
  g.input.onGesture('key', 'KeyW');
  return { opened, closed, wantLock, locked: g.input.locked };
});

// 8. 暂停菜单按钮 + 设置面板
R.pauseMenu = await ev(() => {
  const g = window.game;
  g.setPaused(true);
  return {
    resume: !!document.getElementById('btn-resume'),
    save: !!document.getElementById('btn-save'),
    settings: !!document.getElementById('btn-settings'),
    menu: !!document.getElementById('btn-menu'),
    overlay: !document.getElementById('paused').classList.contains('hidden'),
  };
});
await page.screenshot({ path: `${outDir}/pause.png` });

await ev(() => window.game.openSettings());
await sleep(120);
R.settingsOpen = await ev(() => !document.getElementById('settings-panel').classList.contains('hidden'));

// 9. 设置即时生效：FOV/渲染距离/灵敏度/创造模式
R.settings = await ev(() => {
  const g = window.game;
  const set = (id, v) => {
    const el = document.getElementById(id);
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('set-fov', '60');
  set('set-renderdist', '4');
  set('set-sens', '150');
  // 游戏进行中禁止一键切创造：按钮应被锁定（主菜单才能选择模式）
  const modeBtn = document.getElementById('set-mode');
  const modeLocked = modeBtn.disabled === true;
  if (!modeLocked) modeBtn.click();
  return {
    fov: g.camera.fov,
    renderDist: g.world.renderDist,
    sens: g.settings.sens,
    creative: g.creative,
    flyMode: g.player.flyMode,
    modeLocked,
    inventoryFilled: g.inventory.slots.filter((s) => s && s.count > 0).length,
    persisted: (localStorage.getItem('voxelspace-settings-v1') || '').includes('creative'),
  };
});
await page.screenshot({ path: `${outDir}/settings.png` });
await ev(() => window.game.closeSettings());

// 10. 创造模式：秒破方块 + 免疫伤害 + 状态冻结
R.creative = await ev(() => {
  const g = window.game;
  // 创造模式由主菜单选择；回归测试直接进入创造态验证秒破/免疫/飞行
  g.setCreative(true);
  g.setPaused(false);
  g.input.locked = true;
  const savedPitch = g.player.pitch;
  g.player.pitch = -1.3; // 低头：用游戏自身的射线目标（避免体素边界浮点抖动）
  let first = null;
  const orig = g.player.update.bind(g.player);
  g.player.update = (dt) => {
    orig(dt);
    if (!first && g.player.mineTarget) {
      first = { x: g.player.mineTarget.x, y: g.player.mineTarget.y, z: g.player.mineTarget.z, id: g.player.mineTarget.id };
    }
  };
  g.input.mouseDownSet.add(0);
  for (let i = 0; i < 6; i++) g.player.update(1 / 60);
  g.player.update = orig;
  g.input.mouseDownSet.delete(0);
  g.player.pitch = savedPitch;
  if (!first) return { skipped: true, why: 'no target' };
  const after = g.world.getBlock(first.x, first.y, first.z);
  g.player.damage(50);
  return {
    target: `${first.x},${first.y},${first.z}`,
    was: first.id, now: after, instantBreak: first.id !== 0 && after === 0,
    health: g.player.health, shield: g.player.shield,
    life: g.player.life, hazard: g.player.hazard,
  };
});

// 11. 飞船罗盘（远离飞船时显示）
R.shipCompass = await ev(() => {
  const g = window.game;
  g.player.pos.set(8.5, g.player.pos.y, 8.5);
  g.player.yaw = -Math.PI / 2;
  g.loop();
  const visible = !document.getElementById('ship-compass').classList.contains('hidden');
  const dist = document.getElementById('ship-compass-dist').textContent;
  const shipY = g.ship.worldPos.y;
  const craterFloor = g.world.crashGroundY();
  return { visible, dist, shipY, craterFloor, shipAboveFloor: shipY > craterFloor };
});

// 12. 座舱玻璃修复状态
R.glassRepair = await ev(() => {
  const g = window.game;
  const before = g.ship.cockpitMesh.material === g.ship.glassBrokenMat;
  const changed = g.ship.repair('glass');
  const after = g.ship.cockpitMesh.material === g.ship.glassMat;
  return { brokenInitially: before, changed, repairedMaterial: after, allRepaired: g.ship.allRepaired };
});

// 13. 扫描：飞船方位标记与文案
R.scan = await ev(() => {
  const g = window.game;
  const nBefore = g.scanning.markers.length;
  g.scanning.trigger();
  const added = g.scanning.markers.length - nBefore;
  const shipMarkers = g.scanning.markers.filter((m) => m.sprite.material.map === g.scanning.shipTex).length;
  return { added, shipMarkers };
});

// 14. 飞船可见性截图（出生点面向飞船）
await ev(() => {
  const g = window.game;
  const p = g.player;
  p.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 2.0, 8.5);
  const s = g.ship.worldPos;
  const eye = p.eyePos;
  const dx = s.x - eye.x, dy = s.y + 1 - eye.y, dz = s.z - eye.z;
  const horiz = Math.hypot(dx, dz);
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, horiz);
  p.updateCamera();
});
await sleep(300);
await page.screenshot({ path: `${outDir}/ship.png` });

// 15. 草皮特写截图（俯视草地）
await ev(() => {
  const g = window.game;
  const p = g.player;
  const x = 6.5, z = 10.5;
  p.pos.set(x, g.world.getGroundY(x, z) + 2.0, z);
  p.yaw = 0.6; p.pitch = -0.5;
  p.updateCamera();
});
await sleep(300);
await page.screenshot({ path: `${outDir}/grass.png` });

// 16. 主菜单「退出到主菜单」流程
await ev(() => {
  const g = window.game;
  g.exitToMenu();
});
R.exitToMenu = await ev(() => ({
  running: window.game.running,
  menuVisible: !document.getElementById('menu').classList.contains('hidden'),
  hudHidden: document.getElementById('hud').classList.contains('hidden'),
}));
await page.screenshot({ path: `${outDir}/back_to_menu.png` });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
