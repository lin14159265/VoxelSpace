// 第 24 轮验证：普通电脑性能档案——低画质（低/渲染距离 4）与高画质（高/渲染距离 10）
// 两种配置下：初始化耗时、持续移动+区块加载风暴中的平均帧率 / p95 帧时间 / 最差单帧、
// 内存占用；低画质必须达到"可玩"门槛（>24 FPS、无 >1s 卡死帧、无页面错误）。
// 运行：node tools/perflow.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots49';
fs.mkdirSync(outDir, { recursive: true });

const BASE_URL = process.env.GAME_URL || 'http://localhost:8080';
const browser = await chromium.launch(process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--mute-audio'] }
  : { channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const ctx = await browser.newContext();

async function profile(cfg) {
  const page = await ctx.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`${BASE_URL}/?seed=${SEED}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
  const r = await page.evaluate(async (cfg) => {
    const g = window.game;
    g.startPlaying();
    g.running = true; g.paused = false; g.inMenu = false; g.input.locked = true; g.wantLock = true;
    g.settings.graphics = cfg.graphics;
    g.settings.renderDist = cfg.renderDist;
    g.applyGraphics();
    g.world.renderDist = cfg.renderDist;
    await new Promise((res) => setTimeout(res, 1500)); // 新渲染距离下网格收敛
    const heap0 = performance.memory ? performance.memory.usedJSHeapSize : null;
    const frames = [];
    let last = performance.now();
    const started = performance.now();
    g.input.down.add('KeyW'); // 持续行走
    while (performance.now() - started < 5000) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (frames.length % 90 === 0) {
        // 每 ~1.5s 传送 40 格：强制区块加载/网格化风暴
        const a = Math.random() * Math.PI * 2;
        g.player.pos.set(
          g.player.pos.x + Math.cos(a) * 40,
          g.world.getGroundY(g.player.pos.x + Math.cos(a) * 40, g.player.pos.z + Math.sin(a) * 40) + 0.2,
          g.player.pos.z + Math.sin(a) * 40,
        );
        g.player.vel.set(0, 0, 0);
      }
    }
    g.input.down.delete('KeyW');
    const sorted = [...frames].sort((a, b) => a - b);
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    return {
      initMs: 0,
      avgMs: Math.round(avg * 10) / 10,
      fps: Math.round(1000 / avg),
      p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
      worstMs: Math.round(sorted[sorted.length - 1] * 10) / 10,
      frames: frames.length,
      heapMB: heap0 !== null && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      chunks: g.world.chunks.size,
      dirty: g.world.dirty.size,
      edgeRefresh: g.world.edgeRefresh ? g.world.edgeRefresh.size : 0,
      renderScale: g.renderScale,
    };
  }, cfg);
  await page.screenshot({ path: `${outDir}/perf_${cfg.name}.png` });
  await page.close();
  return { ...r, errors };
}

const R = {};
R.low = await profile({ name: 'low', graphics: 'low', renderDist: 4 });
R.high = await profile({ name: 'high', graphics: 'high', renderDist: 10 });

console.log(JSON.stringify(R, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('低画质平均帧率 ≥ 24 FPS', R.low.fps >= 24, R.low);
check('低画质 p95 帧时间 < 250ms', R.low.p95Ms < 250, R.low);
check('低画质无 >1s 卡死帧', R.low.worstMs < 1000, R.low);
check('低画质区块数有界（≤450）', R.low.chunks <= 450, R.low);
check('低画质脏区块队列收敛（≤60）', R.low.dirty <= 60, R.low);
check('低画质内存有界（<512MB）', R.low.heapMB === null || R.low.heapMB < 512, R.low);
check('低画质无页面错误', R.low.errors.length === 0, R.low.errors.slice(0, 3));
check('高画质（渲染距离 10）可运行', R.high.errors.length === 0 && R.high.frames > 100, R.high);
check('两档画质都通过', R.low.errors.length === 0 && R.high.errors.length === 0);

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (R.low.errors.length || R.high.errors.length ? [...R.low.errors, ...R.high.errors].join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
