// 日志信标视觉验证：站在日志点附近截图，并确认信标光柱存在/收集后熄灭
// 运行：node tools/logview.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots37';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
});
await new Promise((r) => setTimeout(r, 400));

// 站在日志 0 前方 4.5m，目视对准
const R = await ev(() => {
  const g = window.game;
  const it = g.logs.items[0];
  const p = it.group.position;
  g.player.pos.set(p.x + 4.5, g.world.getGroundY(p.x + 4.5, p.z + 4.5) + 1.62, p.z + 4.5);
  const dx = p.x - g.player.pos.x, dz = p.z - g.player.pos.z;
  const dy = p.y - g.player.pos.y;
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  g.player.vel.set(0, 0, 0);
  return {
    beamVisible: it.beam.visible,
    beamOpacity: it.beam.material.opacity,
    coreExists: !!it.core,
  };
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: `${outDir}/log_unread.png` });

// 收集后：信标熄灭、立方体变暗
const R2 = await ev(() => {
  const g = window.game;
  g.collectedLogs.add(g.logs.items[0].id);
  g.logs.setCollected(g.collectedLogs);
  const it = g.logs.items[0];
  return {
    beamHidden: it.beam.visible === false,
    boxDim: it.box.material.color.getHexString() === '46565e',
    ringFaded: it.ring.material.opacity < 0.5,
  };
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${outDir}/log_collected.png` });

console.log(JSON.stringify({ unread: R, collected: R2, errors }, null, 2));
let fail = 0;
const check = (n, ok) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
check('未读日志信标光柱可见', R.beamVisible);
check('光柱半透明(0.3)', R.beamOpacity === 0.3);
check('全息内芯存在', R.coreExists);
check('收集后信标熄灭', R2.beamHidden);
check('收集后立方体变暗', R2.boxDim);
check('收集后光环淡出', R2.ringFaded);
check('无页面错误', errors.length === 0);
console.log(fail === 0 ? '全部通过' : `${fail} 项失败`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
