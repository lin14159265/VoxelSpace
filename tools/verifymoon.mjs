// 本轮验证：月球成为首个可登陆卫星——星图导航 → 月面世界 → 低重力/无大气 → 里程碑 → 存档重载
// 运行：node tools/verifymoon.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-moon';
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
// 从 WebGL 渲染缓冲直接导出 PNG（避免页面截图合成器的画布清空问题）
async function saveGLShot(path) {
  const dataUrl = await page.evaluate(() => {
    const g = window.game;
    g.renderer.render(g.scene, g.camera); // 同步重绘后立即读取，避免合成器清空
    const gl = g.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = (y * w + x) * 4;
        const dst = ((h - 1 - y) * w + x) * 4; // 垂直翻转
        img.data[dst] = buf[src]; img.data[dst + 1] = buf[src + 1];
        img.data[dst + 2] = buf[src + 2]; img.data[dst + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  });
  fs.writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
}
const check = (name, ok, detail) => { R[name] = { ok: !!ok, detail }; console.log(`${ok ? '  ✓' : '  ✗'} ${name}`, detail ?? ''); };
const allOk = () => Object.values(R).filter((v) => v && typeof v === 'object' && 'ok' in v).every((v) => v.ok);

await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.input.locked = true;
  g.setPaused(false);
});
await sleep(300);

// 1. 星图：地球系统含月球，可设定目标
R.starMapMoon = await ev(() => {
  const g = window.game;
  g.openStarMap();
  g.starMapAction('enter', 'planet:solar.earth'); // 进入地月系统图
  g.starMapSelectNode('moon:solar.earth.luna');
  const infoText = document.getElementById('starmap-info').textContent;
  g.starMapAction('target', 'moon:solar.earth.luna');
  return { targetId: g.space.targetId, infoLandable: infoText.includes('可跃迁降落'), mapLevel: g.starMapState.level };
});
check('map.earthMoonSystem', R.starMapMoon.mapLevel === 'planet' && R.starMapMoon.infoLandable, JSON.stringify(R.starMapMoon));
check('nav.moonTargetSet', R.starMapMoon.targetId === 'moon:solar.earth.luna', `${R.starMapMoon.targetId}`);

// 2. 进入地球太空 → 月球实体/罗盘
R.moonMarker = await ev(() => {
  const g = window.game;
  g.closeStarMap();
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  g.space.update(0.016);
  const comp = g.space.compass();
  const m = g.space.moonMeshes.find((mm) => mm.np.navId === 'moon:solar.earth.luna');
  return { moonMesh: !!m, label: comp && comp.label, dist: comp && comp.dist, moons: g.space.moonMeshes.length };
});
check('space.moonMarker', R.moonMarker.moonMesh && R.moonMarker.moons === 1, JSON.stringify(R.moonMarker));
check('nav.moonCompass', R.moonMarker.label === '月球' && R.moonMarker.dist > 100, `${R.moonMarker.label} ${R.moonMarker.dist}`);

// 月面截图（纯场景：隐藏 HUD/标签）
await ev(() => {
  const g = window.game;
  g.running = false;
  g.ui.setHudVisible(false);
  document.getElementById('toasts').style.display = 'none';
  g.sky.update(0.016, g.flight.pos);
  const m = g.space.moonMeshes[0];
  const cam = g.camera;
  cam.position.set(m.group.position.x - 200, m.group.position.y + 60, m.group.position.z - 200);
  cam.lookAt(m.group.position.x, m.group.position.y, m.group.position.z);
  g.renderer.render(g.scene, g.camera);
});
await sleep(300);
await page.screenshot({ path: `${outDir}/moon-from-space.png` });
await saveGLShot(`${outDir}/moon-from-space-gl.png`);
await ev(() => { const g = window.game; g.ui.setHudVisible(true); g.running = true; });

// 3. 飞向月球 → 自动跃迁 → 月面世界
R.warpMoon = await ev(() => {
  const g = window.game;
  const m = g.space.moonMeshes.find((mm) => mm.np.navId === 'moon:solar.earth.luna');
  g.flight.pos.x = g.space.enteredAt.x + m.np.dx;
  g.flight.pos.z = g.space.enteredAt.z + m.np.dz;
  let guard = 0;
  while (!g.space.warping && guard++ < 90) g.space.update(1 / 60);
  guard = 0;
  while (g.space.warping && guard++ < 300) g.space.update(1 / 60);
  return { bodyId: g.space.bodyId, warping: g.space.warping, active: g.space.active };
});
check('warp.moonBodyActive', R.warpMoon.bodyId === 'moon:solar.earth.luna' && !R.warpMoon.warping && R.warpMoon.active, JSON.stringify(R.warpMoon));

// 4. 下降到月面 → 里程碑 + 低重力 + 无大气
R.landMoon = await ev(() => {
  const g = window.game;
  const gy = g.world.getGroundY(g.flight.pos.x, g.flight.pos.z);
  g.flight.pos.y = gy + 8;
  let guard = 0;
  while (g.space.active && guard++ < 300) g.space.update(1 / 60);
  return {
    active: g.space.active, bodyId: g.space.bodyId,
    surface: g.world.gen.terrain.surface, planetName: g.planetName,
    gravity: g.gravity, dayLength: g.sky.dayLength, airless: g.sky.airless,
    moonWalker: g.milestones.earned.has('moonwalker'),
    visitedMoons: [...g.space.visitedMoons],
    region: g.regionLabel(),
  };
});
check('land.moonWorld', R.landMoon.active === false && R.landMoon.bodyId === 'moon:solar.earth.luna'
  && R.landMoon.surface === 'moon' && String(R.landMoon.planetName).includes('月球'), JSON.stringify(R.landMoon));
check('land.lowGravity', Math.abs(R.landMoon.gravity - 26 * 0.165) < 0.1, `g=${R.landMoon.gravity.toFixed(3)}`);
check('land.airlessSky', R.landMoon.airless === true && R.landMoon.dayLength === 1200, `airless=${R.landMoon.airless} day=${R.landMoon.dayLength}`);
check('land.milestoneMoonWalker', R.landMoon.moonWalker === true && R.landMoon.visitedMoons.includes('moon:solar.earth.luna'), JSON.stringify(R.landMoon));
check('land.regionLabel', String(R.landMoon.region).includes('月球'), R.landMoon.region);

// 5. 月面白昼星空 + 低重力跳跃
R.moonFeel = await ev(() => {
  const g = window.game;
  g.flight.piloting = false;
  g.player.active = true;
  g.player.pos.set(g.world.spawnPoint().x, g.world.spawnPoint().y, g.world.spawnPoint().z);
  g.player.vel.set(0, 0, 0);
  g.player.updateCamera();
  // 白天：无大气天体仍可见星空
  g.sky.timeSec = g.sky.dayLength * 0.25; // 早上
  g.sky.update(0.016, g.player.pos);
  const starOp = g.sky.stars.material.opacity;
  // 低重力下落：0.5 秒垂直速度只减少 g*0.5 ≈ 2.15（地球会减少 13）
  g.player.flyMode = false;
  g.player.vel.y = g.jumpVel;
  g.player.update(1 / 60);
  const v0 = g.player.vel.y;
  for (let i = 0; i < 29; i++) g.player.update(1 / 60);
  const v1 = g.player.vel.y;
  return { starOp, v0, v1, drop: v0 - v1, underground: g.player.underground };
});
check('moon.daytimeStars', R.moonFeel.starOp > 0.5, `starOpacity=${R.moonFeel.starOp.toFixed(3)}`);
check('moon.lowGravityFall', Math.abs(R.moonFeel.drop - R.landMoon.gravity * 0.5) < 0.5, `drop=${R.moonFeel.drop.toFixed(2)}`);
// 纯场景月面截图：暂停循环 → 隐藏 HUD/toast/提示 → 仰望星空与环形山
await ev(() => {
  const g = window.game;
  g.running = false;
  g.ui.setHudVisible(false);
  document.getElementById('toasts').style.display = 'none';
  document.getElementById('interact-hint').classList.add('hidden');
  g.player.pitch = -0.18;
  g.player.yaw = -Math.PI / 2;
  g.player.updateCamera();
  g.sky.update(0.016, g.player.pos);
  g.renderer.render(g.scene, g.camera);
});
await sleep(300);
await page.screenshot({ path: `${outDir}/moon-surface.png` });
await saveGLShot(`${outDir}/moon-surface-gl.png`);
R.moonShotDiag = await ev(() => {
  const g = window.game;
  const gl = g.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const px = (x, y) => { const i = (y * w + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
  return {
    airless: g.sky.airless, spaceMode: g.sky.spaceMode, atmo: g.sky.atmoDensity,
    fogFar: g.scene.fog.far,
    fogColor: '#' + g.scene.fog.color.getHexString(),
    horizon: '#' + g.sky.uniforms.horizonColor.value.getHexString(),
    top: '#' + g.sky.uniforms.topColor.value.getHexString(),
    stars: g.sky.stars.material.opacity,
    pxCorner: px(10, 10), pxUpper: px(Math.floor(w * 0.2), Math.floor(h * 0.2)),
    pxCenter: px(Math.floor(w / 2), Math.floor(h / 2)),
  };
});
await ev(() => { const g = window.game; g.ui.setHudVisible(true); g.running = true; });

// 6. 存档 → 无种子 URL 重载 → 月面世界恢复
R.saveMoon = await ev(() => {
  const g = window.game;
  saveGame = window.saveGame || null;
  g.running = true;
  window.game.space.targetId = -1;
  // 直接调用模块函数不可见，触发自动保存路径：将 running 置 true 后手动保存
  return { hasSave: true };
});
R.saveMoon.saved = await ev(() => {
  const g = window.game;
  g.running = true;
  g.autoSaveTimer = 999; // 下一帧自动保存
  g.loop();
  return { bodyId: g.space.bodyId };
});
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.player, null, { timeout: 60000 });
R.reloadMoon = await ev(() => {
  const g = window.game;
  return {
    bodyId: g.space.bodyId, surface: g.world.gen.terrain.surface,
    planetName: g.planetName, gravity: g.gravity, airless: g.sky.airless,
    visitedMoons: [...g.space.visitedMoons], moonWalker: g.milestones.earned.has('moonwalker'),
  };
});
check('save.reloadMoonWorld', R.reloadMoon.bodyId === 'moon:solar.earth.luna' && R.reloadMoon.surface === 'moon'
  && String(R.reloadMoon.planetName).includes('月球') && Math.abs(R.reloadMoon.gravity - 26 * 0.165) < 0.1,
  JSON.stringify(R.reloadMoon));
check('save.reloadMoonProgress', R.reloadMoon.visitedMoons.includes('moon:solar.earth.luna') && R.reloadMoon.moonWalker === true, JSON.stringify(R.reloadMoon));

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const pass = allOk() && errors.length === 0;
console.log(pass ? 'CHECKS: all passed' : 'CHECKS: FAILED');
await browser.close();
process.exitCode = pass ? 0 : 1;
