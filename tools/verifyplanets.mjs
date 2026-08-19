// 本轮验证：行星本质差异化——重力/昼夜长度/太阳视大小/大气密度接入 + 行星贴图 + 太阳日冕视觉
// 运行：node tools/verifyplanets.mjs [seed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SEED = process.argv[2] || '20240815';
const outDir = 'shots-planets';
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
const check = (name, ok, detail) => { R[name] = { ok: !!ok, detail }; console.log(`${ok ? '  ✓' : '  ✗'} ${name}`, detail ?? ''); };
const allOk = () => Object.values(R).filter((v) => v && typeof v === 'object' && 'ok' in v).every((v) => v.ok);

await ev(() => {
  const g = window.game;
  g.startPlaying();
  g.input.locked = true;
  g.setPaused(false);
});

// 1. 地球基准：重力/昼夜/太阳视大小/大气保持原有手感
R.earth = await ev(() => {
  const g = window.game;
  return {
    gravity: g.gravity, dayLength: g.sky.dayLength, retrograde: g.sky.retrograde,
    sunScale: g.sky.sunScale, atmo: g.sky.atmoDensity, fallV: g.fallHurtVel,
  };
});
check('earth.baseProfile', Math.abs(R.earth.gravity - 26) < 0.01 && R.earth.dayLength === 480
  && R.earth.retrograde === false && Math.abs(R.earth.sunScale - 1) < 0.01 && R.earth.atmo === 1,
  JSON.stringify(R.earth));

// 2. 火星：低重力 + 太阳更小 + 大气稀薄（视野更远）
R.mars = await ev(() => {
  const g = window.game;
  const np = g.space.galaxy.find((p) => p.name === '火星');
  g.applyNewWorld(np.seed, np.palette, { terrain: np.terrain, surface: np.surface, ores: np.ores, plants: np.plants, hazard: np.hazard, weather: np.weather, body: np, planetName: `${np.name} · 太阳系` });
  g.player.respawn(g.world.spawnPoint());
  g.sky.update(0.016, g.player.pos); // 跑一帧，让雾距等渲染参数生效
  return { gravity: g.gravity, dayLength: g.sky.dayLength, sunScale: g.sky.sunScale, atmo: g.sky.atmoDensity, fogFar: g.scene.fog.far, planet: g.planetName };
});
check('mars.lowGravity', R.mars.gravity < 26 * 0.4 && R.mars.gravity > 26 * 0.35, `g=${R.mars.gravity.toFixed(2)}`);
check('mars.smallerSun', R.mars.sunScale < 0.85 && R.mars.sunScale > 0.7, `sunScale=${R.mars.sunScale.toFixed(3)}`);
check('mars.thinAtmo', R.mars.atmo < 0.6 && R.mars.fogFar > 180, `atmo=${R.mars.atmo} fogFar=${R.mars.fogFar.toFixed(0)}`);

// 3. 木星：重力夹到 2g、昼夜更快、太阳更小
R.jupiter = await ev(() => {
  const g = window.game;
  const np = g.space.galaxy.find((p) => p.name === '木星');
  g.applyNewWorld(np.seed, np.palette, { terrain: np.terrain, surface: np.surface, ores: np.ores, plants: np.plants, hazard: np.hazard, weather: np.weather, body: np, planetName: `${np.name} · 太阳系` });
  g.player.respawn(g.world.spawnPoint());
  return { gravity: g.gravity, dayLength: g.sky.dayLength, sunScale: g.sky.sunScale, atmo: g.sky.atmoDensity };
});
check('jupiter.heavyGravity', Math.abs(R.jupiter.gravity - 52) < 0.01, `g=${R.jupiter.gravity.toFixed(2)}`);
check('jupiter.fastDay', R.jupiter.dayLength < 360 && R.jupiter.dayLength > 240, `day=${R.jupiter.dayLength}`);
check('jupiter.smallSun', R.jupiter.sunScale < 0.5, `sunScale=${R.jupiter.sunScale.toFixed(3)}`);

// 4. 金星：逆行自转 + 极浓大气 + 超长昼夜压缩
R.venus = await ev(() => {
  const g = window.game;
  const np = g.space.galaxy.find((p) => p.name === '金星');
  g.applyNewWorld(np.seed, np.palette, { terrain: np.terrain, surface: np.surface, ores: np.ores, plants: np.plants, hazard: np.hazard, weather: np.weather, body: np, planetName: `${np.name} · 太阳系` });
  g.player.respawn(g.world.spawnPoint());
  g.sky.update(0.016, g.player.pos);
  return { dayLength: g.sky.dayLength, retrograde: g.sky.retrograde, atmo: g.sky.atmoDensity, fogFar: g.scene.fog.far };
});
check('venus.retrograde', R.venus.retrograde === true && R.venus.dayLength === 1200, JSON.stringify(R.venus));
check('venus.denseAtmo', R.venus.atmo > 2.2 && R.venus.fogFar < 190, `atmo=${R.venus.atmo} fogFar=${R.venus.fogFar.toFixed(0)}`);

// 5. 行星贴图像素探针：进入太空后读贴图数据
R.textures = await ev(() => {
  const g = window.game;
  // 回地球进入太空，构建全部邻居行星贴图
  const home = g.space.galaxy[0];
  g.applyNewWorld(home.seed, home.palette, { terrain: home.terrain, surface: home.surface, ores: home.ores, plants: home.plants, hazard: home.hazard, weather: home.weather, body: home, planetName: '地球 · 太阳系' });
  g.flight.piloting = true;
  g.flight.pos.set(8.5, g.world.getGroundY(8.5, 8.5) + 260, 8.5);
  g.flight.speed = 0; g.flight.vertVel = 0;
  g.space.enterSpace();
  const probe = (mesh, pred) => {
    if (!mesh || !mesh.material || !mesh.material.map) return 0;
    const cv = mesh.material.map.image;
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (pred(d[i], d[i + 1], d[i + 2])) n++;
    return n;
  };
  const probeHome = (pred) => probe(g.space.homePlanet, pred);
  const probeNeighbor = (name, pred) => {
    const m = g.space.neighborMeshes.find((mm) => mm.np.name === name);
    return m ? probe(m.group.children[0], pred) : 0;
  };
  return {
    earthBlue: probeHome((r, gg, b) => b > r + 20 && b > 60),
    earthGreen: probeHome((r, gg, b) => gg > r + 15 && gg > b + 10),
    marsRed: probeNeighbor('火星', (r, gg, b) => r > 140 && r > gg + 50),
    jupiterSpot: probeNeighbor('木星', (r, gg, b) => r > 150 && r > gg + 50 && gg > b),
    saturnBand: probeNeighbor('土星', (r, gg, b) => Math.abs(gg - r) < 30 && r > 160),
  };
});
check('texture.earthOceanAndLand', R.textures.earthBlue > 50000 && R.textures.earthGreen > 8000, JSON.stringify(R.textures));
check('texture.marsRed', R.textures.marsRed > 60000, `${R.textures.marsRed}`);
check('texture.jupiterSpot', R.textures.jupiterSpot > 100, `${R.textures.jupiterSpot}`);
check('texture.saturnBands', R.textures.saturnBand > 90000, `${R.textures.saturnBand}`);

// 6. 太阳日冕 + 真实方向光照
R.sun = await ev(() => {
  const g = window.game;
  g.space.update(0.5);
  const sun = g.space.sunMarker;
  return {
    corona: !!(sun && sun.userData.coronaMat),
    coronaUniform: sun ? sun.userData.coronaMat.uniforms.uTime.value : 0,
    lightOn: g.space.spaceSunLight && g.space.spaceSunLight.intensity > 0.4,
    lightPos: g.space.spaceSunLight ? { x: g.space.spaceSunLight.position.x, z: g.space.spaceSunLight.position.z } : null,
  };
});
check('sun.coronaAndLight', R.sun.corona && R.sun.coronaUniform > 0.4 && R.sun.lightOn, JSON.stringify(R.sun));

// 太阳特写截图（相机对准固定太阳节点；先刷新太空天空避免残留大气蓝）
await ev(() => {
  const g = window.game;
  g.running = false;
  g.ui.setHudVisible(false); // 纯场景截图
  document.getElementById('toasts').style.display = 'none';
  document.getElementById('interact-hint').classList.add('hidden');
  g.sky.update(0.016, g.flight.pos);
  const sun = g.space.sunMarker;
  if (sun && sun.userData.label) sun.userData.label.visible = false;
  for (const m of g.space.neighborMeshes) m.label.visible = false;
  const cam = g.camera;
  cam.position.set(sun.position.x - 420, sun.position.y + 160, sun.position.z - 420);
  cam.lookAt(sun.position.x, sun.position.y, sun.position.z);
  g.renderer.render(g.scene, g.camera);
});
R.sunShot = await ev(() => {
  const g = window.game;
  const gl = g.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const px = (x, y) => {
    const i = (y * w + x) * 4;
    return [buf[i], buf[i + 1], buf[i + 2]];
  };
  const corners = [px(10, 10), px(10, h - 10), px(w - 10, 10), px(w - 10, h - 10)];
  const avg = corners.map((c) => (c[0] + c[1] + c[2]) / 3);
  let bright = 0;
  for (let i = 0; i < buf.length; i += 40) if (buf[i] + buf[i + 1] + buf[i + 2] > 540) bright++;
  return { corners, avg, brightSamples: bright };
});
check('sunshot.darkSpaceBackground', R.sunShot.avg.every((v) => v < 40), `cornerAvg=${R.sunShot.avg.map((v) => v.toFixed(0)).join('/')}`);
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${outDir}/sun-closeup.png` });

// 太空行星纹理截图（回地球俯瞰；对准球心并隐藏三维护标签）
await ev(() => {
  const g = window.game;
  g.running = false;
  g.ui.setHudVisible(false);
  document.getElementById('toasts').style.display = 'none';
  document.getElementById('interact-hint').classList.add('hidden');
  g.sky.update(0.016, g.flight.pos);
  const gY = g.space.enteredAt.groundY;
  g.space.planetGroup.position.set(8.5, gY - 246, 8.5);
  if (g.space.sunMarker && g.space.sunMarker.userData.label) g.space.sunMarker.userData.label.visible = false;
  for (const m of g.space.neighborMeshes) m.label.visible = false;
  const cam = g.camera;
  cam.position.set(8.5, gY + 120, 8.5 + 480);
  cam.lookAt(8.5, gY - 360, 8.5);
  g.renderer.render(g.scene, g.camera);
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${outDir}/earth-from-space.png` });
await ev(() => { const g = window.game; g.ui.setHudVisible(true); document.getElementById('toasts').style.display = ''; g.running = true; });

console.log('RESULTS:', JSON.stringify(R, null, 2));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
const pass = allOk() && errors.length === 0;
console.log(pass ? 'CHECKS: all passed' : 'CHECKS: FAILED');
await browser.close();
process.exitCode = pass ? 0 : 1;
