// 新玩家视角体验审计：全新存档 → 主菜单 → 出生 → 前几分钟关键画面截图 + 状态导出
// 用法: node tools/uxaudit.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const OUT = 'shots-ux';
fs.mkdirSync(OUT, { recursive: true });
const url = 'http://127.0.0.1:8080/?seed=uxaudit1';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// 全新玩家：清掉存档与设置
await page.addInitScript(() => {
  localStorage.clear();
  sessionStorage.clear();
});
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/01-loading.png` });

// 等主菜单出现
await page.waitForSelector('#menu:not(.hidden)', { timeout: 20000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/02-menu.png` });

const report = {};

// 点击开始
await page.click('#btn-start');
await page.waitForTimeout(1200);
// 无头环境指针锁不可用，游戏应保持可玩态；手动触发用户手势键继续
await page.keyboard.press('KeyE'); // 手势重锁尝试
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/03-spawn.png` });

report.objective = await page.evaluate(() => {
  const g = window.game;
  return {
    objective: document.getElementById('objective-text')?.textContent,
    missions: Array.from(document.querySelectorAll('#mission-list > *')).map((e) => e.textContent.trim()),
    pos: g?.player ? { x: Math.round(g.player.pos.x), y: Math.round(g.player.pos.y), z: Math.round(g.player.pos.z) } : null,
    paused: g?.paused, inMenu: g?.inMenu, running: g?.running, locked: g?.input?.locked,
    questStep: g?.quests?.step, questTitle: g?.quests?.current?.title,
    inventory: g?.inventory ? g.inventory.slots.map((s) => (s ? `${s.name}x${s.count}` : '')).filter(Boolean) : null,
    hotbar: g?.inventory ? g.inventory.hotbar().map((s) => (s ? s.name : '')).filter(Boolean) : null,
  };
});

// 走到飞船附近看提示（先扫描定位）
await page.keyboard.press('KeyC');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/04-scan.png` });

// 直接传送到飞船旁看互动提示
await page.evaluate(() => {
  const g = window.game;
  if (g?.ship && g?.player) {
    const p = g.ship.worldPos;
    g.player.pos.set(p.x + 6, g.world.getGroundY(p.x + 6, p.z + 6) + 1.6, p.z + 6);
  }
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/05-near-ship.png` });
report.interactHint = await page.evaluate(() => document.getElementById('interact-hint')?.textContent);

// 开背包看合成
await page.evaluate(() => {
  const g = window.game; if (!g) return;
  g.input.pressedSet.add('KeyI'); g.input.pressedAge.set('KeyI', g.input.age);
  g.accumulator += 0.1; g.loop();
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/06-backpack.png` });
report.craftList = await page.evaluate(() => Array.from(document.querySelectorAll('#craft-list .craft-btn')).map((b) => b.textContent.trim()));
await page.evaluate(() => {
  const g = window.game; if (!g) return;
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.accumulator += 0.1; g.loop();
});

// 修船面板
await page.evaluate(() => {
  const g = window.game; if (!g) return;
  g.input.pressedSet.add('KeyE'); g.input.pressedAge.set('KeyE', g.input.age);
  g.accumulator += 0.1; g.loop();
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/07-repair.png` });
report.repairItems = await page.evaluate(() => Array.from(document.querySelectorAll('#repair-list > *')).map((e) => e.textContent.trim()));
await page.evaluate(() => {
  const g = window.game; if (!g) return;
  g.input.pressedSet.add('KeyB'); g.input.pressedAge.set('KeyB', g.input.age);
  g.accumulator += 0.1; g.loop();
});

// 夜晚画面（快进时间）
await page.evaluate(() => {
  const g = window.game; if (!g) return;
  g.world.time = 0.78; // 接近夜晚
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/08-night.png` });
report.night = await page.evaluate(() => {
  const g = window.game;
  return { time: g?.world?.time, isNight: g?.world?.isNight?.(), sun: g?.sky?.sunIntensity };
});

// 白天恢复 + 挖一块石头（核心循环手感）
await page.evaluate(() => { const g = window.game; if (g) g.world.time = 0.3; });
await page.evaluate(() => {
  const g = window.game; if (!g) return;
  // 面向地面下方挖
  g.input.mouseDownSet.add(0); g.input.mousePressedSet.add(0); g.input.mousePressedAge.set(0, g.input.age);
});
await page.waitForTimeout(1500);
await page.evaluate(() => { const g = window.game; if (g) g.input.mouseDownSet.delete(0); });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/09-mining.png` });
report.afterMining = await page.evaluate(() => {
  const g = window.game;
  return {
    inv: g.inventory.slots.map((s) => (s ? `${s.name}x${s.count}` : '')).filter(Boolean).slice(0, 12),
    popups: Array.from(document.querySelectorAll('#popups > *')).map((e) => e.textContent.trim()).slice(-5),
  };
});

report.errors = errors;
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
