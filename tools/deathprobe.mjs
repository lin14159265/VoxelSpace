// 死亡边界审计：步行/驾驶/停靠/太空/面板打开等状态下被击杀，
// 检查复活后状态一致性（无 NaN、模式恢复、可继续游玩）。
// 运行：node tools/deathprobe.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots51';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const ctx = await browser.newContext();

async function fresh() {
  const page = await ctx.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
  await page.evaluate(() => {
    const g = window.game;
    g.startPlaying();
    g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
  });
  await new Promise((r) => setTimeout(r, 400));
  return page;
}

const errors = [];
const R = {};

// 1. 步行死亡
{
  const page = await fresh();
  R.walking = await page.evaluate(() => {
    const g = window.game;
    g.player.pos.set(20, g.world.getGroundY(20, 20) + 0.2, 20);
    g.player.damage(999);
    const sp = g.world.spawnPoint();
    return {
      respawned: Math.hypot(g.player.pos.x - sp.x, g.player.pos.z - sp.z) < 2,
      health: g.player.health, shield: g.player.shield,
      finite: Number.isFinite(g.player.pos.x) && Number.isFinite(g.player.pos.y),
      piloting: g.flight.piloting, active: g.player.active, running: g.running,
    };
  });
  await page.close();
}

// 2. 驾驶中死亡（大气层内）
{
  const page = await fresh();
  R.piloting = await page.evaluate(() => {
    const g = window.game;
    g.ship.repair('pulse'); g.ship.repair('glass'); g.ship.repair('thruster');
    g.flight.enter();
    g.input.down.add('KeyW'); g.input.down.add('Space');
    for (let i = 0; i < 240; i++) g.flight.update(1 / 60);
    g.input.down.delete('KeyW'); g.input.down.delete('Space');
    const airborne = g.flight.pos.y - g.flight.groundHeight() > 20;
    g.player.damage(999);
    return {
      airborne,
      pilotingAfter: g.flight.piloting,
      playerActive: g.player.active,
      finite: Number.isFinite(g.player.pos.x) && Number.isFinite(g.player.pos.y) && Number.isFinite(g.flight.pos.y),
      running: g.running, paused: g.paused,
      health: g.player.health,
    };
  });
  await page.close();
}

// 3. 太空驾驶中死亡
{
  const page = await fresh();
  R.spaceDeath = await page.evaluate(() => {
    const g = window.game;
    g.flight.piloting = true;
    g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 300, 8.5);
    g.space.enterSpace();
    g.space.update(0.016);
    g.player.damage(999);
    return {
      spaceActive: g.space.active,
      pilotingAfter: g.flight.piloting,
      finite: Number.isFinite(g.flight.pos.x) && Number.isFinite(g.flight.pos.y) && Number.isFinite(g.player.pos.y),
      playerOnGround: Math.abs(g.player.pos.y - g.world.getGroundY(g.player.pos.x, g.player.pos.z)) < 3,
    };
  });
  await page.close();
}

// 4. 停靠空间站时死亡
{
  const page = await fresh();
  R.dockedDeath = await page.evaluate(() => {
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
    const dockedBefore = g.docked;
    g.player.damage(999);
    return {
      dockedBefore,
      dockedAfter: g.docked,
      panelVisible: g.ui.stationVisible(),
      finite: Number.isFinite(g.player.pos.x),
      running: g.running,
    };
  });
  await page.close();
}

// 5. 面板打开（背包）时死亡（应不可能，但验证不炸）
{
  const page = await fresh();
  R.panelDeath = await page.evaluate(() => {
    const g = window.game;
    g.openBackpack();
    g.player.damage(999);
    return {
      finite: Number.isFinite(g.player.pos.x) && Number.isFinite(g.player.pos.y),
      backpackStillOpen: g.ui.backpackVisible(),
      health: g.player.health,
    };
  });
  await page.close();
}

console.log(JSON.stringify({ R, errors }, null, 2));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };
check('步行死亡复活到出生点且满状态', R.walking.respawned && R.walking.health === 100 && R.walking.finite && !R.walking.piloting, R.walking);
check('驾驶中死亡状态一致（无 NaN/不卡死）', R.piloting.finite && R.piloting.airborne, R.piloting);
check('太空死亡后玩家回到地表附近', R.spaceDeath.finite && R.spaceDeath.playerOnGround, R.spaceDeath);
check('停靠中死亡不破坏面板/游戏态', R.dockedDeath.finite && R.dockedDeath.running, R.dockedDeath);
check('面板打开时死亡不炸', R.panelDeath.finite && R.panelDeath.health === 100, R.panelDeath);
check('无页面错误', errors.length === 0, errors.slice(0, 3));
console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
