// 第 26 轮验证：行星地标植被（地表差异化）——冰巨星二氢晶体塔、
// 荒漠岩石柱（铁氧体帽）、气态碳晶簇；繁茂地球无地标（只有树）。
// 直接实例化 WorldGen/Chunk 扫描区块数据（无需完整游戏渲染管线）。
// 运行：node tools/verifysurface.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '27182818';
const outDir = 'shots52';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`http://localhost:8080/?seed=${SEED}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });

const R = await page.evaluate(async () => {
  const { WorldGen, Chunk } = await import('/src/world/chunk.js');
  const { B } = await import('/src/world/blocks.js');
  const scan = (profile, spireBlock) => {
    const gen = new WorldGen('27182818', profile);
    const chunks = new Map();
    let towers = 0, capCount = 0;
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const c = new Chunk(cx, cz);
        c.generate(gen); // 构造不自动生成，需显式调用
        chunks.set(cx * 100 + cz, c);
        for (let lx = 0; lx < 16; lx++) {
          for (let lz = 0; lz < 16; lz++) {
            const wx = cx * 16 + lx, wz = cz * 16 + lz;
            const h = gen.heightAt(wx, wz);
            if (h <= 2 || h >= 56) continue;
            // 统计连续立柱高度
            let run = 0;
            for (let dy = 1; dy <= 6; dy++) {
              if (c.get(lx, h + dy, lz) === spireBlock) run++;
              else break;
            }
            if (run >= 2) {
              towers++;
              if (c.get(lx, h + run + 1, lz) === B.FERROCK) capCount++;
            }
          }
        }
      }
    }
    return { towers, capCount, chunks: chunks.size };
  };
  const base = { terrain: { base: 20, amp: 0.5, mounts: 1.7, caves: 1.1, trees: 0 }, ores: { coal: 1, ferrock: 1, copper: 1, gold: 1 }, plants: { sodium: 1, oxygen: 1, dihydrogen: 1, carbon: 1 } };
  return {
    ice: scan({ ...base, surface: 'ice' }, B.DIHYDROGEN),
    mars: scan({ ...base, terrain: { ...base.terrain, mounts: 2.2 }, surface: 'mars' }, B.STONE),
    jupiter: scan({ ...base, surface: 'jupiter' }, B.CARBON),
    earth: scan({ ...base, surface: 'grass', terrain: { ...base.terrain, trees: 1.15 } }, B.DIHYDROGEN),
  };
});
console.log(JSON.stringify({ R, errors }, null, 2));

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); };

check('冰巨星：二氢晶体塔 ≥3 处', R.ice.towers >= 3, R.ice);
check('荒漠：岩石柱 ≥3 处', R.mars.towers >= 3, R.mars);
check('荒漠：部分岩柱带铁氧体帽', R.mars.capCount >= 1, R.mars);
check('气态巨星：碳晶簇 ≥3 处', R.jupiter.towers >= 3, R.jupiter);
check('繁茂地球：无晶体塔（只有树）', R.earth.towers === 0, R.earth);
check('无页面错误', errors.length === 0, errors.slice(0, 3));

console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
console.log('ERRORS: ' + (errors.length ? errors.join(' | ') : 'none'));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
