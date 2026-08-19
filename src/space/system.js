// 星系与太空系统：程序生成行星、太空场景渲染、大气层进出、跨星球跃迁
// 真实天文数据与统一天体模型见 celestial.js（纯数据部分可在 Node 中测试）。
import * as THREE from 'three';
import { hashSeed, mulberry32, Simplex2 } from '../world/noise.js';
import { clamp, lerp, smoothstep } from '../core/constants.js';
import { buildStationMesh, STATION_DOCK_DIST } from '../entities/station.js';
import {
  AU, SOLAR_SYSTEM, PROXIMA_SYSTEM, SIRIUS_SYSTEM, PLANET_TYPES, GATEWAY_OFFSETS, STATION_OFFSET,
  GATEWAY_NODES, bodyById, childrenOf, moonOffset, moonSeedOf, orbitPos, visualRadius, worldOffset, systemMeta,
} from './celestial.js';

// 兼容旧模块路径的再导出（测试与工具脚本引用）
export { SOLAR_SYSTEM, PROXIMA_SYSTEM, SIRIUS_SYSTEM, PLANET_TYPES, GATEWAY_OFFSETS, STATION_OFFSET } from './celestial.js';

export const SPACE_ALT = 170;        // 进入太空的高度阈值（相对地表）
export const EXIT_ALT = 130;         // 回落到大气层内
export const PULSE_SPEED = 420;      // 太空脉冲速度

// 跨星系跃迁门触发距离
export const GATEWAY_WARP_DIST = 150;

// 主小行星带：可开采距离
export const BELT_HARVEST_DIST = 170;

const SYLLABLES = ['Kan', 'Vex', 'Oru', 'Tali', 'Nex', 'Zeph', 'Aria', 'Xy', 'Del', 'Mur', 'Syl', 'Tha', 'Ion', 'Kor', 'Rin', 'Ola'];

export function planetNameOf(seed) {
  let h = hashSeed('planet:' + seed);
  const a = SYLLABLES[h % SYLLABLES.length];
  const b = SYLLABLES[(h >>> 5) % SYLLABLES.length]; // 无符号位移，避免负索引
  const num = String(h % 1000).padStart(3, '0');
  return `行星 ${a}${b}-${num}`;
}

// 由行星配置表生成星系（确定性；母星 index 0 使用传入种子）。
// 轨道采用真实半长轴（AU）与真实平黄经（J2000 近似），仅加入 ±3° 的种子扰动
// 保持每个存档略有差异；太阳系行星间的相对距离严格保留现实比例。
// 比邻星系等超紧凑系统：当真实轨道间距小于两个行星球体视觉直径时，
// 施加最小视觉间距（地图视觉尺度，避免球体重叠与误触跃迁；太阳系不触发）。
const MIN_PLANET_GAP = 150;

export function generateSystem(systemSeed, defs) {
  const rng = mulberry32(hashSeed('galaxy:' + systemSeed));
  const count = defs.length;
  // 先按真实半长轴排序，把过近轨道向后推开，再按原数组顺序生成
  const sorted = defs.map((def, i) => ({ def, i, aAU: def.aAU })).sort((a, b) => a.aAU - b.aAU);
  const adjusted = new Map();
  let prevOrbit = -Infinity;
  for (const item of sorted) {
    const raw = item.def.aAU * AU;
    const vr = visualRadius(item.def) * 2 + 40; // 球体视觉直径 + 跃迁缓冲
    const orbit = Math.max(raw, prevOrbit + Math.max(MIN_PLANET_GAP, vr));
    adjusted.set(item.i, orbit);
    prevOrbit = orbit;
  }
  const planets = [];
  for (let i = 0; i < count; i++) {
    const def = defs[i];
    const angleRad = (def.angleDeg + (rng() - 0.5) * 6) * Math.PI / 180;
    const orbit = adjusted.get(i);
    const pseed = i === 0 ? String(systemSeed) : String(hashSeed(systemSeed + ':p' + i));
    planets.push({
      id: i,
      navId: def.navId,
      seed: pseed,
      name: def.name,
      type: def.type,
      surface: def.surface,
      terrain: { ...def.terrain },
      ores: { ...def.ores },
      plants: { ...def.plants },
      hazard: { ...def.hazard },
      weather: { ...def.weather },
      palette: {
        grassHue: def.grassHue,
        skyTop: def.skyTop,
        skyHorizon: def.skyHorizon,
        surface: def.surfaceColors,
        atmos: def.atmos,
      },
      gx: Math.round(Math.cos(angleRad) * orbit),
      gz: Math.round(Math.sin(angleRad) * orbit),
      radius: Math.round(visualRadius(def)),
      radiusKm: def.radiusKm,
      orbit,
      aAU: def.aAU,
      angleDeg: def.angleDeg,
      gravityG: def.gravityG,
      dayHours: def.dayHours,
      tempC: def.tempC,
      atmoDensity: def.atmoDensity || 1,
      underground: def.underground || null,
      facts: def.facts || [],
      ring: !!def.ring,
    });
  }
  return planets;
}

// 生成太阳系（确定性，基于游戏种子）：8 颗行星，母星 = 地球（index 0）
export function generateGalaxy(gameSeed) {
  return generateSystem(gameSeed, SOLAR_SYSTEM);
}

// 生成比邻星系（母星 = 比邻星 b）
export function generateProximaGalaxy(gameSeed) {
  return generateSystem(gameSeed + ':proxima', PROXIMA_SYSTEM);
}

// 生成天狼星系（母星 = 天狼星 b 推测行星）
export function generateSiriusGalaxy(gameSeed) {
  return generateSystem(gameSeed + ':sirius', SIRIUS_SYSTEM);
}

// 行星表面程序纹理（按真实天体类型生成可辨认外观）
// 目标：地球大陆/海洋、火星红壤、木星大红斑与云带、土星柔和带、冰巨星、
// 荒岩陨坑、金星毒云——从太空一眼认出，同时保持体素游戏的低频手绘感。
export function planetTexture(palette, seed, def = {}) {
  const cv = document.createElement('canvas');
  cv.width = 768; cv.height = 384;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(768, 384);
  const n1 = new Simplex2(hashSeed('psurf1:' + seed));
  const n2 = new Simplex2(hashSeed('psurf2:' + seed));
  const n3 = new Simplex2(hashSeed('psurf3:' + seed));
  const [c1, c2] = palette.surface;
  const surface = def.surface || 'grass';
  const mixC = (a, b, t) => {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return [
      Math.round(ar + (br - ar) * t),
      Math.round(ag + (bg - ag) * t),
      Math.round(ab + (bb - ab) * t),
    ];
  };
  const noise = (sx, sy, sz) => {
    const v = n1.noise(sx * 1.7, sy * 1.7) * 0.6 + n2.noise(sz * 2.6, sy * 2.6 + sx * 1.3) * 0.4;
    return clamp(v, -1, 1) * 0.5 + 0.5;
  };
  const colorAt = (u, v, sx, sy, sz, lon, lat) => {
    let r, g, b;
    if (surface === 'grass') {
      // 地球：蓝色海洋 + 绿色/褐色大陆 + 极冠（低频阈值形成大陆轮廓 + 高频海岸扰动）
      const landBase = n1.noise(sx * 2.3, sy * 2.3) * 0.62 + n2.noise(sz * 2.1 + 7, sy * 2.1) * 0.38;
      const coast = n3.noise(sx * 6.7, sy * 6.7) * 0.05;
      const landT = clamp((landBase + coast + 0.06) * 1.35, 0, 1);
      const polar = Math.pow(Math.abs(sy), 5);
      if (polar > 0.52) {
        [r, g, b] = [238, 246, 255];
      } else if (landT < 0.42) {
        const depth = landT / 0.42;
        [r, g, b] = mixC(0x2f6aa8, 0x4f9ad8, depth);
      } else {
        const green = n3.noise(sx * 5.2, sy * 5.2) * 0.5 + 0.5;
        const dry = clamp((1 - Math.abs(lat / 1.2)) * 1.3, 0, 1);
        [r, g, b] = mixC(0x4f9a5a, 0x9a7a3a, dry * (0.35 + green * 0.3));
      }
      return [r, g, b];
    }
    if (surface === 'mars') {
      // 火星：红壤 + 深色高地斑块 + 白极冠
      const n = noise(sx, sy, sz);
      const high = n2.noise(sx * 3.4, sy * 3.4) * 0.5 + 0.5;
      [r, g, b] = mixC(0xb05535, 0x8a3a28, clamp(high * 0.9 - n * 0.35, 0, 1) * 0.55);
      const polar = Math.pow(Math.abs(sy), 6);
      if (polar > 0.62) [r, g, b] = [240, 244, 250];
      return [r, g, b];
    }
    if (surface === 'jupiter') {
      // 气态巨行星：横向云带 + 湍流；木星绘制大红斑，土星更柔
      const band = n1.noise(1, sy * 7.0) * 0.5 + 0.5;
      const turb = n2.noise(sx * 3.0 + band * 3, sy * 6.0) * 0.25;
      const t = clamp(band + turb * 0.5, 0, 1);
      [r, g, b] = mixC(c1, c2, t);
      const spot = def.name === '木星';
      if (spot) {
        const spotLat = Math.abs(lat - (-0.42));
        const spotLon = Math.abs(((lon + Math.PI * 0.35 + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (spotLat < 0.19 && spotLon < 0.16) {
          const core = 1 - Math.max(spotLat / 0.19, spotLon / 0.16);
          [r, g, b] = mixC([r, g, b], [0xd0482f], clamp(core * 1.65, 0, 1));
        }
      }
      return [r, g, b];
    }
    if (surface === 'ice') {
      // 冰巨星：青蓝渐变 + 细弱云带（海王星更深蓝）
      const band = n1.noise(1, sy * 4.2) * 0.5 + 0.5;
      const n = noise(sx, sy, sz) * 0.35;
      [r, g, b] = mixC(c1, c2, clamp(band * 0.55 + n * 0.45, 0, 1));
      return [r, g, b];
    }
    if (surface === 'barren') {
      // 荒岩世界：灰岩 + 陨坑暗斑（水星坑密，比邻星 b 略暖）
      const n = noise(sx, sy, sz);
      [r, g, b] = mixC(c1, c2, n);
      const d1 = Math.hypot(Math.abs(lon - 1.2), lat + 0.2);
      const d2 = Math.hypot(Math.abs(lon - 3.9), lat - 0.5);
      if (d1 < 0.14) [r, g, b] = mixC([r, g, b], [0x4a443e], 1 - d1 / 0.14);
      if (d2 < 0.1) [r, g, b] = mixC([r, g, b], [0x3e3a36], 1 - d2 / 0.1);
      return [r, g, b];
    }
    if (surface === 'moon') {
      // 月球：灰白月尘 + 暗色月海 + 密集环形山
      const n = noise(sx, sy, sz);
      [r, g, b] = mixC(c1, c2, n);
      const mare = n1.noise(sx * 2.8 + 13, sy * 2.8 - 7) * 0.5 + 0.5;
      if (mare < 0.32) [r, g, b] = mixC([r, g, b], [0x5c6066], (0.32 - mare) * 2.2);
      const cr = n3.noise(sx * 8.0, sz * 8.0 + sy * 4.0) * 0.5 + 0.5;
      if (cr > 0.62) [r, g, b] = mixC([r, g, b], [0x3e4046], (cr - 0.62) * 1.4);
      return [r, g, b];
    }
    // toxic（金星）：黄绿毒云旋涡
    const swirl = n1.noise(sx * 2.6 + n2.noise(sy * 3, sz * 2), sy * 2.6) * 0.5 + 0.5;
    [r, g, b] = mixC(c1, c2, swirl);
    return [r, g, b];
  };
  for (let y = 0; y < 384; y++) {
    for (let x = 0; x < 768; x++) {
      const u = x / 768, v = y / 384;
      const lon = u * Math.PI * 2 - Math.PI;
      const lat = (v - 0.5) * Math.PI;
      const sx = Math.cos(lat) * Math.cos(lon);
      const sy = Math.sin(lat);
      const sz = Math.cos(lat) * Math.sin(lon);
      const [r, g, b] = colorAt(u, v, sx, sy, sz, lon, lat);
      const i = (y * 768 + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 大气层辉光（fresnel rim）
export function atmosphereMaterial(colorHex) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { atmosColor: { value: new THREE.Color(colorHex) } },
    vertexShader: `
      #include <logdepthbuf_pars_vertex>
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 atmosColor; varying vec3 vNormal; varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.6);
        gl_FragColor = vec4(atmosColor, rim * 0.85);
        #include <logdepthbuf_fragment>
      }`,
  });
}

// 行星环（土星）：程序化环带纹理
export function planetRing(radius) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 8;
  const ctx = cv.getContext('2d');
  for (let x = 0; x < 256; x++) {
    const t = x / 255;
    const alpha = 0.15 + 0.5 * Math.abs(Math.sin(t * Math.PI * 6)) * (0.45 + 0.55 * Math.abs(Math.sin(t * 23)));
    const warm = Math.round(215 + Math.sin(t * 40) * 25);
    ctx.fillStyle = `rgba(${warm},${warm - 25},140,${alpha.toFixed(3)})`;
    ctx.fillRect(x, 0, 1, 8);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.RingGeometry(radius * 1.35, radius * 2.05, 64);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2 + 0.32; // 平放 + 微倾
  return mesh;
}

// 太阳视觉：白热光球 + 动态日冕 + 十字光芒——真正恒星应有的视觉冲击
export function sunVisual() {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(130, 32, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff8e8 }),
  );
  group.add(core);

  // 动态日冕（背面球壳 fresnel + 低频脉动）
  const coronaMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(0xffc060) },
      uTime: { value: 0 },
    },
    vertexShader: `
      #include <logdepthbuf_pars_vertex>
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor; uniform float uTime;
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
        float pulse = 0.82 + 0.18 * sin(uTime * 1.7) + 0.08 * sin(uTime * 5.3);
        gl_FragColor = vec4(uColor, rim * 1.35 * pulse);
        #include <logdepthbuf_fragment>
      }`,
  });
  const corona = new THREE.Mesh(new THREE.SphereGeometry(168, 48, 24), coronaMat);
  group.add(corona);
  group.userData.coronaMat = coronaMat;

  const flareTex = (horizontal) => {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');
    const grd = ctx.createRadialGradient(128, 128, 4, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,244,214,0.95)');
    grd.addColorStop(0.25, 'rgba(255,214,150,0.55)');
    grd.addColorStop(0.65, 'rgba(255,190,110,0.14)');
    grd.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);
    if (horizontal) {
      // 只保留水平条带：配合横向拉伸的 Sprite 形成镜头十字光芒
      ctx.clearRect(0, 0, 256, 70);
      ctx.clearRect(0, 186, 256, 70);
    }
    return new THREE.CanvasTexture(cv);
  };
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flareTex(false), transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glow.scale.setScalar(760);
  group.add(glow);
  const hFlare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flareTex(true), transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  hFlare.scale.set(1350, 90, 1);
  group.add(hFlare);
  const vFlare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flareTex(true), transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  vFlare.scale.set(90, 1350, 1);
  group.add(vFlare);
  return group;
}

// 太空节点标签精灵（太阳/小行星带等固定节点使用）
export function labelSprite(text, color = '#ffd27a', scaleX = 90, scaleY = 34) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const ctx = cv.getContext('2d');
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(127,240,255,0.9)';
  ctx.shadowBlur = 8;
  ctx.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false,
  }));
  label.scale.set(scaleX, scaleY, 1);
  return label;
}

// 带名称标签的真实位置太阳节点（世界坐标固定，不再只是跟随玩家的装饰球）
export function buildSunMarker(node) {
  const group = sunVisual();
  group.name = 'space-sun';
  const label = labelSprite(node.name, '#ffd27a', 110, 42);
  label.position.y = 220;
  group.add(label);
  group.userData.label = label;
  return group;
}

// 主小行星带视觉：中心岩块 + 散布小天体（体素箱体簇）
export function buildBeltMarker(node) {
  const group = new THREE.Group();
  group.name = 'space-belt';
  const rng = mulberry32(hashSeed('belt:' + node.navId));
  const mat = new THREE.MeshLambertMaterial({ color: 0x9a8a76 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x6a5f50 });
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = 34 + rng() * 150;
    const size = 2 + rng() * 7;
    const rock = new THREE.Mesh(new THREE.BoxGeometry(size, size * (0.5 + rng() * 0.8), size), i % 3 === 0 ? dark : mat);
    rock.position.set(Math.cos(a) * r, (rng() - 0.5) * 14, Math.sin(a) * r);
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    group.add(rock);
  }
  const core = new THREE.Mesh(new THREE.BoxGeometry(18, 12, 18), mat);
  core.rotation.set(0.4, 0.2, 0);
  group.add(core);
  const label = labelSprite(node.name, 'rgba(220,235,245,0.95)', 130, 46);
  label.position.y = 52;
  group.add(label);
  return group;
}

// 跃迁门视觉（跨星系）：旋转的青色巨环 + 内芯光晕
export function buildGatewayMesh(labelText) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(26, 1.4, 12, 48),
    new THREE.MeshBasicMaterial({ color: 0x7ff0ff }),
  );
  group.add(ring);
  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(18, 0.8, 10, 40),
    new THREE.MeshBasicMaterial({ color: 0x2fb8d8 }),
  );
  ring2.rotation.y = 0.4;
  group.add(ring2);
  // 内芯光晕
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  grd.addColorStop(0, 'rgba(127,240,255,0.9)');
  grd.addColorStop(0.5, 'rgba(47,184,216,0.35)');
  grd.addColorStop(1, 'rgba(47,184,216,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false,
  }));
  glow.scale.setScalar(110);
  group.add(glow);
  // 名称标签
  const lcv = document.createElement('canvas');
  lcv.width = 256; lcv.height = 96;
  const lctx = lcv.getContext('2d');
  lctx.textAlign = 'center';
  lctx.font = 'bold 22px "Segoe UI", "Microsoft YaHei", sans-serif';
  lctx.fillStyle = 'rgba(220,240,255,0.95)';
  lctx.shadowColor = 'rgba(127,240,255,0.9)';
  lctx.shadowBlur = 8;
  lctx.fillText(labelText, 128, 42);
  const tex = new THREE.CanvasTexture(lcv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false,
  }));
  label.scale.set(80, 30, 1);
  label.position.y = 40;
  group.add(label);
  return group;
}

export class SpaceSystem {
  constructor(game) {
    this.game = game;
    // 恒星系统注册表（数据驱动扩展：新增恒星系统只需在 celestial 加数据）
    this.galaxies = {
      solar: generateGalaxy(game.seed),
      proxima: generateProximaGalaxy(game.seed),
      sirius: generateSiriusGalaxy(game.seed),
    };
    this.galaxyId = 'solar';
    this.galaxy = this.galaxies.solar;
    this.current = 0;
    this.bodyId = null;            // 当前可登陆卫星的 navId（null = 在行星上）
    this.visitedMoons = new Set(); // 已登陆的卫星
    this.active = false;
    this.enteredAt = { x: 0, z: 0, groundY: 40 };
    this.visitedSolar = new Set([0]);
    this.visitedProxima = new Set();
    this.visitedSirius = new Set();
    this.visited = this.visitedSolar;
    this.visitedMap = { solar: this.visitedSolar, proxima: this.visitedProxima, sirius: this.visitedSirius };
    this.gatewayGroups = [];      // 当前星系的所有外向跃迁门实体
    this.moonMeshes = [];          // 当前母行星的可登陆卫星实体
    this.warpGrace = 0;            // 进入太空/切星系后的跃迁保护（防误触紧邻行星）
    this.targetId = -1;
    this.warping = false;
    this.warpTimer = 0;
    this.warpPlanet = null;
    this.planetGroup = new THREE.Group();
    this.planetGroup.name = 'space-planets';
    this.planetGroup.visible = false;
    game.scene.add(this.planetGroup);
    this.neighborMeshes = [];
    this.nebulaSprites = [];
    this.stationGroup = null;
    this.gatewayGroup = null;
    this.sunMarker = null;   // 真实位置太阳节点（世界坐标固定）
    this.beltMarker = null;  // 主小行星带节点（太阳系）
    this.spaceSunLight = null; // 从太阳方向照向飞船/行星的定向光
    this.nonLandableHint = null; // 不可降落目标抵达提示（每个目标只提示一次）
    this.gatewayWarnTimer = 0;
    this.tmpV = new THREE.Vector3();
  }

  get ship() { return this.game.ship; }
  get flight() { return this.game.flight; }
  get scene() { return this.game.scene; }

  altitude() {
    const f = this.flight;
    return f.pos.y - f.groundHeight();
  }

  // 相对当前行星的邻居坐标
  neighborOffsets() {
    const home = this.galaxy[this.current];
    return this.galaxy
      .filter((p) => p.id !== this.current)
      .map((p) => ({ ...p, dx: p.gx - home.gx, dz: p.gz - home.gz }));
  }

  // ---- 当前天体（行星或可登陆卫星） ----
  visitedFor(systemId) {
    return this.visitedMap[systemId] || this.visited;
  }
  currentPlanetDef() { return this.galaxy[this.current]; }
  currentBodyDef() {
    if (this.bodyId) return bodyById(this.bodyId);
    return this.galaxy[this.current];
  }
  // 当前天体的“世界渲染定义”：卫星补齐种子/半径/母星轨道参数
  bodyWorldDef(node) {
    if (!node) node = this.currentBodyDef();
    if (node.kind === 'moon') {
      const parent = this.currentPlanetDef();
      return {
        ...node,
        seed: moonSeedOf(this.game.seed, node.navId),
        radius: Math.round(visualRadius(node)),
        aAU: node.sunAU !== undefined ? node.sunAU : (parent ? parent.aAU : 1),
        angleDeg: parent ? parent.angleDeg : 0,
      };
    }
    return node;
  }
  // 当前母行星的可登陆卫星（月球等）
  landableMoons() {
    const parent = this.currentPlanetDef();
    if (!parent || !parent.navId) return [];
    return childrenOf(this.galaxyId, parent.navId).filter((k) => k.kind === 'moon' && k.landable);
  }
  // 卫星相对进入太空点的局部轨道偏移（同一卫星每次进入太空位置确定）
  moonLocalOffset(moonNode) {
    const moons = this.landableMoons();
    const idx = Math.max(0, moons.findIndex((m) => m.navId === moonNode.navId));
    const parent = bodyById(moonNode.parentId) || this.currentPlanetDef();
    return moonOffset(moonNode, parent, idx, moons.length || 1);
  }

  // 当前星系的外向跃迁门
  gatewayNp() {
    const node = this.gatewaysForCurrentSystem()[0] || bodyById('gateway:solar.proxima');
    return {
      gateway: true, id: node.navId === 'gateway:solar.proxima' ? 200 : (node.navId === 'gateway:proxima.solar' ? 201 : node.navId),
      navId: node.navId, name: systemMeta(node.targetSystem).name,
      target: node.targetSystem, label: node.name, offset: node.offset,
    };
  }
  gatewaysForCurrentSystem() {
    const out = [];
    for (const node of Object.values(GATEWAY_NODES)) {
      if (node.systemId === this.galaxyId) out.push(node);
    }
    return out;
  }

  gatewayWorldPos(out) {
    const np = this.gatewayNp();
    const off = np.offset || GATEWAY_OFFSETS[this.galaxyId] || GATEWAY_OFFSETS.solar;
    return out.set(
      this.enteredAt.x + off.x,
      this.enteredAt.groundY + off.y,
      this.enteredAt.z + off.z,
    );
  }

  // ---- 统一导航目标解析：兼容旧数字 id，也接受新字符串天体 id ----
  resolveTargetNode(id) {
    if (id === null || id === undefined || id === -1 || id === '-1') return null;
    const str = String(id);
    if (/^\d+$/.test(str)) {
      const n = Number(str);
      if (n === 100) return bodyById('station:solar.earth');
      if (n === 200) return bodyById('gateway:solar.proxima');
      if (n === 201) return bodyById('gateway:proxima.solar');
      if (n >= 0 && n < this.galaxy.length) {
        const p = this.galaxy[n];
        return bodyById(p.navId) || {
          navId: `planet:${this.galaxyId}.${n}`, kind: 'planet', name: p.name,
          type: p.type, surface: p.surface, landable: true, aAU: p.aAU, angleDeg: p.angleDeg,
          radiusKm: p.radiusKm, color: p.palette.surface[0],
        };
      }
      return null;
    }
    return bodyById(str);
  }

  targetNode() { return this.resolveTargetNode(this.targetId); }

  // 邻居行星 / 固定节点是否与当前目标一致（标签高亮用）
  targetMatchesNp(np) {
    if (this.targetId === -1 || np === null || np === undefined) return false;
    if (np.id === this.targetId || np.navId === this.targetId) return true;
    if (typeof this.targetId === 'number' || /^\d+$/.test(String(this.targetId))) {
      const node = this.resolveTargetNode(this.targetId);
      return !!(node && (node.navId === np.navId || node.name === np.name));
    }
    const node = this.targetNode();
    return !!(node && (node.navId === np.navId || node.name === np.name));
  }

  setTarget(id) {
    if (id === null || id === undefined || id === -1 || id === '-1') {
      this.targetId = -1;
      this.nonLandableHint = null;
      this.updateMarkers();
      return true;
    }
    const node = this.resolveTargetNode(id);
    if (!node) return false;
    if (node.gateway) {
      const hasBigShip = !!(this.game.shipUpgrades && this.game.shipUpgrades.bigship);
      if (!hasBigShip) return false;
    }
    if (node.kind === 'station' && (this.galaxyId !== 'solar' || this.bodyId)) return false;
    if (node.kind === 'moon' && this.bodyId === node.navId) return false; // 已在该卫星
    // 数字 id 保持原值（旧存档/工具兼容）；字符串 id 直接保存
    this.targetId = /^\d+$/.test(String(id)) ? Number(id) : String(id);
    this.nonLandableHint = null;
    this.updateMarkers();
    return true;
  }

  // 目标在世界旅程坐标中相对进入太空点的偏移（x/z）
  targetWorldOffset() {
    const node = this.targetNode();
    if (!node) return null;
    const home = this.galaxy[this.current];
    if (node.kind === 'station') return { x: STATION_OFFSET.x, z: STATION_OFFSET.z };
    if (node.kind === 'gateway') {
      const off = node.offset || GATEWAY_OFFSETS[this.galaxyId] || GATEWAY_OFFSETS.solar;
      return { x: off.x, z: off.z };
    }
    // 在卫星轨道上：母行星位于卫星局部轨道的反方向
    if (this.bodyId && node.kind === 'planet' && node.navId && home && node.navId === home.navId) {
      const local = this.moonLocalOffset(bodyById(this.bodyId));
      return { x: -local.x, z: -local.z };
    }
    if (node.kind === 'planet' && node.navId && home && home.navId) {
      // 优先用生成表内的确定性坐标（与太空标记完全一致）
      const targetPlanet = this.galaxy.find((p) => p.navId === node.navId);
      if (targetPlanet) return { x: targetPlanet.gx - home.gx, z: targetPlanet.gz - home.gz };
    }
    return worldOffset(node, home);
  }

  // 当前目标信息（HUD 导航 / 星图重定位）
  targetInfo() {
    const node = this.targetNode();
    if (!node) return null;
    const off = this.targetWorldOffset();
    const dist = off ? Math.hypot(off.x, off.z) : null;
    return {
      id: this.targetId,
      navId: node.navId || null,
      name: node.name,
      kind: node.kind,
      landable: !!node.landable,
      dockable: !!node.dockable,
      gateway: !!node.gateway,
      dist,
      systemId: this.galaxyId,
    };
  }

  // ---- 每帧更新（仅驾驶时由 Game 调用） ----
  update(dt) {
    const g = this.game;
    if (!this.flight.piloting) {
      if (this.active) this.forceExit();
      return;
    }
    const alt = this.altitude();
    if (!this.active) {
      if (alt > SPACE_ALT) this.enterSpace();
      return;
    }
    if (this.warpGrace > 0) this.warpGrace -= dt;
    if (this.warping) {
      this.warpTimer -= dt;
      if (this.warpTimer <= 0) this.finishWarp();
      return;
    }
    if (alt < EXIT_ALT) { this.exitSpace(); return; }

    // 行星球体跟随（水平方向）
    const p = this.planetGroup;
    p.position.set(this.flight.pos.x, this.enteredAt.groundY - 246, this.flight.pos.z);
    p.rotation.y += dt * 0.008;

    // 空间站：自转 + 停靠距离检测（仅地球轨道）
    if (this.stationGroup) {
      this.stationGroup.rotation.y += dt * 0.05;
      this.stationGroup.getWorldPosition(this.tmpV);
      const dx = this.tmpV.x - this.flight.pos.x;
      const dy = this.tmpV.y - this.flight.pos.y;
      const dz = this.tmpV.z - this.flight.pos.z;
      this.game.stationNear = Math.hypot(dx, dy, dz) < STATION_DOCK_DIST;
    } else {
      this.game.stationNear = false;
    }

    // 跃迁门：接近检测（需大型飞船才能跃迁，否则警告）；支持当前星系多个外向门
    this.game.gatewayNear = false;
    for (const gitem of this.gatewayGroups) {
      gitem.group.rotation.y += dt * 0.3;
      gitem.group.getWorldPosition(this.tmpV);
      const dx = this.tmpV.x - this.flight.pos.x;
      const dy = this.tmpV.y - this.flight.pos.y;
      const dz = this.tmpV.z - this.flight.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < GATEWAY_WARP_DIST) {
        this.game.gatewayNear = true;
        const hasBigShip = !!(this.game.shipUpgrades && this.game.shipUpgrades.bigship);
        if (hasBigShip) {
          this.beginWarp(gitem.np);
        } else {
          this.gatewayWarnTimer -= dt;
          if (this.gatewayWarnTimer <= 0) {
            this.gatewayWarnTimer = 5;
            g.ui.toast('跨星系跃迁需要大型殖民船 · 前往空间站船坞购买', true);
            g.audio.play('deny');
          }
        }
        break;
      }
    }

    // 太阳 / 小行星带固定节点：自转 + 日冕脉动 + 标签随距离缩放（真实世界坐标）
    if (this.sunMarker) {
      this.sunMarker.rotation.y += dt * 0.02;
      if (this.sunMarker.userData.coronaMat) {
        this.sunMarker.userData.coronaMat.uniforms.uTime.value += dt;
      }
      const sx = this.sunMarker.position.x - this.flight.pos.x;
      const sz = this.sunMarker.position.z - this.flight.pos.z;
      const d = Math.hypot(sx, sz);
      const s = Math.max(30, Math.min(220, d * 0.1));
      if (this.sunMarker.userData.label) {
        this.sunMarker.userData.label.scale.set(s, s * 0.38, 1);
      }
      // 太阳真实方向光照：星球明暗面与太阳位置一致
      if (this.spaceSunLight) {
        this.spaceSunLight.position.copy(this.sunMarker.position);
        this.spaceSunLight.target.position.copy(this.flight.pos);
        this.spaceSunLight.intensity = 0.55;
      }
    }
    if (this.beltMarker) {
      this.beltMarker.rotation.y += dt * 0.03;
      const dx = this.beltMarker.position.x - this.flight.pos.x;
      const dz = this.beltMarker.position.z - this.flight.pos.z;
      g.beltNear = Math.hypot(dx, dz) < BELT_HARVEST_DIST;
    } else {
      g.beltNear = false;
    }

    // 星云跟随玩家
    for (const [i, s] of this.nebulaSprites.entries()) {
      const a = i * 2.1 + 0.5;
      s.position.set(
        this.flight.pos.x + Math.cos(a) * 430,
        this.flight.pos.y + Math.sin(a * 0.7) * 160,
        this.flight.pos.z + Math.sin(a) * 430,
      );
    }

    // 邻居行星接近检测 + 标记随距离缩放
    if (!this.warping && this.warpGrace <= 0) {
      for (const m of this.neighborMeshes) {
        const np = m.np;
        const dx = np.dx - this.flight.pos.x + this.enteredAt.x;
        const dz = np.dz - this.flight.pos.z + this.enteredAt.z;
        const d = Math.hypot(dx, dz);
        // 名称标记大小随距离（约 6% 屏宽），行星本体按真实大小
        const s = d * 0.055;
        m.label.scale.set(s, s * 0.37, 1);
        if (d < np.radius + 45) {
          this.beginWarp(np);
          break;
        }
      }
    }

    // 可登陆卫星接近检测（月球等）：旋转 + 标签缩放 + 跃迁降落
    if (!this.warping && this.warpGrace <= 0) {
      for (const m of this.moonMeshes) {
        m.group.rotation.y += dt * 0.1;
        const dx = m.np.dx - this.flight.pos.x + this.enteredAt.x;
        const dz = m.np.dz - this.flight.pos.z + this.enteredAt.z;
        const d = Math.hypot(dx, dz);
        const s = Math.max(24, Math.min(160, d * 0.12));
        m.label.scale.set(s, s * 0.37, 1);
        if (d < m.r + 35) {
          this.beginWarp(m.np);
          break;
        }
      }
    }

    // 不可降落目标（恒星 / 小行星带 / 卫星）抵达提示：导航闭环但不误导玩家
    const tinfo = this.targetInfo();
    if (tinfo && !tinfo.landable && !tinfo.dockable && !tinfo.gateway && this.nonLandableHint !== String(this.targetId)) {
      const off = this.targetWorldOffset();
      if (off) {
        const wx = this.enteredAt.x + off.x;
        const wz = this.enteredAt.z + off.z;
        const d = Math.hypot(this.flight.pos.x - wx, this.flight.pos.z - wz);
        const near = tinfo.kind === 'star' ? 420 : tinfo.kind === 'belt' ? 120 : 60;
        if (d < near) {
          this.nonLandableHint = String(this.targetId);
          if (tinfo.kind === 'belt') {
            g.ui.toast('已抵达主小行星带 · 按 E 开采矿石（矿点有限）', true);
            g.audio.play('scan');
          } else {
            g.ui.toast(`已抵达 ${tinfo.name}附近 · 该天体当前不可降落（登陆能力扩建中）`, true);
            g.audio.play('warn');
          }
        }
      }
    }
  }

  // ---- 进入太空 ----
  enterSpace() {
    const g = this.game;
    this.active = true;
    this.enteredAt = {
      x: this.flight.pos.x,
      z: this.flight.pos.z,
      groundY: this.flight.groundHeight(),
    };
    this.flight.setSpaceMode(true);
    this.flight.clearReentry();
    g.audio.play('spaceEnter');
    g.audio.setAmbient(0.1, 1.0); // 太空低鸣
    // 隐藏地表网格
    g.world.setMeshesVisible(false);
    g.sky.setSpaceMode(true);
    this.buildVisuals();
    this.planetGroup.visible = true;
    for (const s of this.nebulaSprites) s.visible = true;
    if (this.sunMarker) this.sunMarker.visible = true;
    if (this.beltMarker) this.beltMarker.visible = true;
    for (const m of this.moonMeshes) m.group.visible = true;
    g.beltNear = false;
    g.beltCharges = 14; // 每次进入太空刷新小行星带矿点
    this.warpGrace = 1.2;
    this.updateMarkers();    g.quests.onEnterSpace();
    if (g.milestones) g.milestones.bump('space', 1);
    g.ui.toast('已进入太空 · 打开星图 [M] 选择目标行星');
  }

  // ---- 返回大气层 ----
  exitSpace() {
    const g = this.game;
    this.active = false;
    if (g.spaceCombat) g.spaceCombat.clear();
    this.flight.setSpaceMode(false);
    // 大气再入热障：稠密/稀薄/无大气由当前天体真实密度决定（行星差异化）
    this.flight.beginReentry();
    g.sky.setSpaceMode(false);
    g.world.setMeshesVisible(true);
    this.planetGroup.visible = false;
    if (this.stationGroup) this.stationGroup.visible = false;
    for (const gitem of this.gatewayGroups) gitem.group.visible = false;
    if (this.sunMarker) this.sunMarker.visible = false;
    if (this.beltMarker) this.beltMarker.visible = false;
    for (const m of this.moonMeshes) m.group.visible = false;
    for (const s of this.nebulaSprites) s.visible = false;
    for (const m of this.neighborMeshes) m.group.visible = false;
    g.stationNear = false;
    g.gatewayNear = false;
    g.beltNear = false;
    if (this.spaceSunLight) this.spaceSunLight.intensity = 0;
    g.audio.setAmbient(0.4, g.sky.nightFactor);
    // 任务与里程碑：首次降落在新行星 / 卫星
    if (this.bodyId) {
      const moon = bodyById(this.bodyId);
      if (g.milestones) g.milestones.bump('moons', 1);
      g.ui.toast(`已降落在${moon ? moon.name : '卫星'} · 无大气 · 低重力 · 星空全天可见`, false);
    } else if (this.current !== 0) {
      g.quests.onPlanetLand();
      if (g.milestones) g.milestones.bump('planets', 1);
      g.ui.toast(`已降落在 ${this.galaxy[this.current].name} · ${this.galaxy[this.current].type}行星`);
    }
    // 任务板探索悬赏：按当前实际落点结算
    if (g.onMissionEvent) {
      const landedTarget = this.bodyId || (this.galaxy[this.current] && this.galaxy[this.current].navId) || null;
      if (landedTarget) g.onMissionEvent('visit', { target: landedTarget });
    }
  }

  forceExit() {
    const g = this.game;
    this.active = false;
    if (g.spaceCombat) g.spaceCombat.clear();
    this.warping = false;
    this.flight.setSpaceMode(false);
    this.flight.clearReentry();
    g.sky.setSpaceMode(false);
    g.world.setMeshesVisible(true);
    this.planetGroup.visible = false;
    if (this.stationGroup) this.stationGroup.visible = false;
    for (const gitem of this.gatewayGroups) gitem.group.visible = false;
    if (this.sunMarker) this.sunMarker.visible = false;
    if (this.beltMarker) this.beltMarker.visible = false;
    for (const m of this.moonMeshes) m.group.visible = false;
    for (const s of this.nebulaSprites) s.visible = false;
    for (const m of this.neighborMeshes) m.group.visible = false;
    g.stationNear = false;
    g.gatewayNear = false;
    g.beltNear = false;
    if (this.spaceSunLight) this.spaceSunLight.intensity = 0;
  }

  // ---- 太空视觉 ----
  buildVisuals() {
    const g = this.game;
    // 先清理旧视觉（重复进出太空时避免母星/太阳/空间站叠加）
    for (const child of [...this.planetGroup.children]) {
      this.planetGroup.remove(child);
      child.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
    }
    if (this.stationGroup) {
      this.scene.remove(this.stationGroup);
      this.stationGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
      this.stationGroup = null;
    }
    for (const gitem of this.gatewayGroups) {
      this.scene.remove(gitem.group);
      gitem.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
    }
    this.gatewayGroups = [];
    this.gatewayGroup = null;
    for (const key of ['sunMarker', 'beltMarker']) {
      const marker = this[key];
      if (marker) {
        this.scene.remove(marker);
        marker.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
          }
        });
        this[key] = null;
      }
    }
    for (const m of this.moonMeshes) {
      this.scene.remove(m.group);
      m.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) { if (mat.map) mat.map.dispose(); mat.dispose(); }
        }
      });
    }
    this.moonMeshes = [];
    // 脚下母星（带微弱自发光，背光面可见）——在月球上显示月球
    const home = this.bodyWorldDef(this.currentBodyDef());
    const homeMat = new THREE.MeshLambertMaterial({ map: planetTexture(home.palette, home.seed, home) });
    const [sr, sg, sb] = [(home.palette.surface[0] >> 16) & 255, (home.palette.surface[0] >> 8) & 255, home.palette.surface[0] & 255];
    homeMat.emissive = new THREE.Color(sr / 255, sg / 255, sb / 255).multiplyScalar(0.32);
    this.homePlanet = new THREE.Mesh(
      new THREE.SphereGeometry(home.radius * 2.4, 48, 28),
      homeMat,
    );
    this.homePlanet.position.set(0, -home.radius * 2.4 - 4, 0);
    this.planetGroup.add(this.homePlanet);
    const atmos = new THREE.Mesh(
      new THREE.SphereGeometry(home.radius * 2.4 * 1.045, 48, 28),
      atmosphereMaterial(home.palette.atmos),
    );
    this.homePlanet.add(atmos);
    if (home.ring) this.homePlanet.add(planetRing(home.radius * 2.4));
    // 太阳：真实位置节点（相对当前行星的真实轨道偏移，世界坐标固定）
    const starNode = bodyById(`star:${this.galaxyId}`);
    if (starNode) {
      const off = worldOffset(starNode, home);
      this.sunMarker = buildSunMarker(starNode);
      this.sunMarker.position.set(
        this.enteredAt.x + off.x,
        this.enteredAt.groundY + 260,
        this.enteredAt.z + off.z,
      );
      this.scene.add(this.sunMarker);
      if (!this.spaceSunLight) {
        this.spaceSunLight = new THREE.DirectionalLight(0xfff2c0, 0.55);
        this.scene.add(this.spaceSunLight);
        this.scene.add(this.spaceSunLight.target);
      }
    }
    // 主小行星带节点（仅太阳系）
    const beltNode = bodyById('belt:solar.main');
    if (this.galaxyId === 'solar' && beltNode) {
      const off = worldOffset(beltNode, home);
      this.beltMarker = buildBeltMarker(beltNode);
      this.beltMarker.position.set(
        this.enteredAt.x + off.x,
        this.enteredAt.groundY + 140,
        this.enteredAt.z + off.z,
      );
      this.scene.add(this.beltMarker);
    }
    // 空间站：仅地球轨道。世界坐标 = 进入太空点 + 固定偏移（"静止轨道"，
    // 独立于随玩家移动的 planetGroup，否则永远无法接近停靠）
    if (this.current === 0 && !this.bodyId) {
      this.stationGroup = buildStationMesh();
      this.stationGroup.position.set(
        this.enteredAt.x + STATION_OFFSET.x,
        this.enteredAt.groundY + STATION_OFFSET.y,
        this.enteredAt.z + STATION_OFFSET.z,
      );
      this.scene.add(this.stationGroup);
      // 名称标记
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 96;
      const ctx = cv.getContext('2d');
      ctx.textAlign = 'center';
      ctx.font = 'bold 22px "Segoe UI", "Microsoft YaHei", sans-serif';
      const stationTarget = this.resolveTargetNode(this.targetId);
      ctx.fillStyle = (stationTarget && stationTarget.navId === 'station:solar.earth') ? '#ffd27a' : 'rgba(220,240,255,0.95)';
      ctx.shadowColor = 'rgba(127,240,255,0.9)';
      ctx.shadowBlur = 8;
      ctx.fillText('地球轨道空间站 · 人造设施', 128, 42);
      ctx.beginPath();
      ctx.moveTo(128, 52); ctx.lineTo(136, 60); ctx.lineTo(128, 68); ctx.lineTo(120, 60);
      ctx.closePath();
      ctx.fillStyle = '#7ff0ff';
      ctx.fill();
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, depthTest: false,
      }));
      label.scale.set(70, 26, 1);
      label.position.y = 16;
      this.stationGroup.add(label);
    }
    // 跃迁门（跨星系）：当前星系所有外向门，固定世界坐标
    for (const node of this.gatewaysForCurrentSystem()) {
      const group = buildGatewayMesh(node.name);
      const off = node.offset || GATEWAY_OFFSETS[this.galaxyId] || GATEWAY_OFFSETS.solar;
      group.position.set(
        this.enteredAt.x + off.x,
        this.enteredAt.groundY + off.y,
        this.enteredAt.z + off.z,
      );
      this.scene.add(group);
      const np = {
        gateway: true,
        id: node.navId === 'gateway:solar.proxima' ? 200 : (node.navId === 'gateway:proxima.solar' ? 201 : node.navId),
        navId: node.navId, name: systemMeta(node.targetSystem).name,
        target: node.targetSystem, label: node.name, offset: off,
      };
      this.gatewayGroups.push({ group, node, np });
      if (!this.gatewayGroup) this.gatewayGroup = group; // 兼容旧工具（主门）
    }

    // 可登陆卫星：真实位置轨道节点（月球等）——接近后自动跃迁降落
    if (!this.bodyId) {
      const moons = this.landableMoons();
      for (const moon of moons) {
        const local = this.moonLocalOffset(moon);
        const r = Math.max(14, visualRadius(moon) * 1.8);
        const group = new THREE.Group();
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(r, 32, 20),
          new THREE.MeshLambertMaterial({ map: planetTexture(moon.palette, moonSeedOf(this.game.seed, moon.navId), moon) }),
        );
        group.add(sphere);
        const label = labelSprite(moon.name, 'rgba(220,235,245,0.95)', 70, 26);
        label.position.y = r + 12;
        group.add(label);
        group.position.set(
          this.enteredAt.x + local.x,
          this.enteredAt.groundY + 120,
          this.enteredAt.z + local.z,
        );
        this.scene.add(group);
        this.moonMeshes.push({
          group, label, r,
          np: { ...moon, radius: r, dx: local.x, dz: local.z, kind: 'moon', type: moon.type || '卫星' },
        });
      }
    }

    // 星云
    if (this.nebulaSprites.length === 0) {
      const colors = [0x5a3a9a, 0x2a6a8a, 0x9a3a6a, 0x3a5a9a];
      for (let i = 0; i < 4; i++) {
        const cv = document.createElement('canvas');
        cv.width = 128; cv.height = 128;
        const ctx = cv.getContext('2d');
        const [r, gg, b] = [(colors[i] >> 16) & 255, (colors[i] >> 8) & 255, colors[i] & 255];
        const grd = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
        grd.addColorStop(0, `rgba(${r},${gg},${b},0.85)`);
        grd.addColorStop(0.4, `rgba(${r},${gg},${b},0.35)`);
        grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, 128, 128);
        const tex = new THREE.CanvasTexture(cv);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
        }));
        sp.scale.setScalar(420 + i * 90);
        this.scene.add(sp);
        this.nebulaSprites.push(sp);
      }
    }
  }

  updateMarkers() {
    // 邻居行星：可见球体 + 名称标记精灵
    for (const m of this.neighborMeshes) {
      this.scene.remove(m.group);
      m.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) { if (mat.map) mat.map.dispose(); mat.dispose(); }
        }
      });
    }
    this.neighborMeshes = [];
    const neighborList = this.neighborOffsets();
    // 在卫星轨道上：母行星是最近邻（位于卫星局部轨道的反方向），可飞回自动跃迁
    if (this.bodyId) {
      const parent = this.currentPlanetDef();
      const local = this.moonLocalOffset(bodyById(this.bodyId));
      neighborList.push({ ...parent, dx: -local.x, dz: -local.z, returnHome: true });
    }
    for (const np of neighborList) {
      const group = new THREE.Group();
      // 行星球体
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(np.radius, 24, 16),
        new THREE.MeshLambertMaterial({ map: planetTexture(np.palette, np.seed, np) }),
      );
      group.add(sphere);
      const atmos = new THREE.Mesh(
        new THREE.SphereGeometry(np.radius * 1.06, 24, 16),
        atmosphereMaterial(np.palette.atmos),
      );
      group.add(atmos);
      // 土星环
      if (np.ring) group.add(planetRing(np.radius));
      // 名称标记
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 96;
      const ctx = cv.getContext('2d');
      ctx.textAlign = 'center';
      ctx.font = 'bold 22px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = this.targetMatchesNp(np) ? '#ffd27a' : 'rgba(220,240,255,0.95)';
      ctx.shadowColor = 'rgba(127,240,255,0.9)';
      ctx.shadowBlur = 8;
      ctx.fillText(np.name + ' · ' + np.type, 128, 42);
      ctx.beginPath();
      ctx.moveTo(128, 52); ctx.lineTo(136, 60); ctx.lineTo(128, 68); ctx.lineTo(120, 60);
      ctx.closePath();
      ctx.fillStyle = np.id === this.targetId ? '#ffb84d' : '#7ff0ff';
      ctx.fill();
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, depthTest: false,
      }));
      label.scale.set(60, 22, 1);
      label.position.y = np.radius * 1.6;
      group.add(label);
      group.position.set(
        this.enteredAt.x + np.dx,
        this.flight.pos.y,
        this.enteredAt.z + np.dz,
      );
      this.scene.add(group);
      this.neighborMeshes.push({ group, label, np });
    }
  }

  // ---- 跃迁 ----
  beginWarp(np) {
    const g = this.game;
    this.warping = true;
    if (g.spaceCombat) g.spaceCombat.clear();
    this.warpPlanet = np;
    this.warpTimer = 1.0;
    g.audio.play('warp');
    g.ui.warpFlash(true);
    const kindText = np.kind === 'moon' ? '卫星' : '行星';
    g.ui.toast(np.gateway ? `穿越跃迁门前往 ${np.name}` : `跃迁至 ${np.name} · ${np.type}${kindText}`);
  }

  finishWarp() {
    const g = this.game;
    const np = this.warpPlanet;
    this.warpPlanet = null;
    this.warping = false;
    g.ui.warpFlash(false);
    // 跨星系跃迁：切换星系
    if (np && np.gateway) {
      this.switchGalaxy(np.target);
      return;
    }
    // 卫星跃迁：切换到月球等可登陆卫星世界
    if (np && np.kind === 'moon') {
      this.landOnMoon(np);
      return;
    }
    // 清理旧的太空视觉（母星球体等）
    for (const child of [...this.planetGroup.children]) {
      this.planetGroup.remove(child);
      child.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
    }
    for (const m of this.neighborMeshes) {
      this.scene.remove(m.group);
      m.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) { if (mat.map) mat.map.dispose(); mat.dispose(); }
        }
      });
    }
    this.neighborMeshes = [];
    // 切换到目标行星世界（带目标星的地形/表面参数与名称）
    this.current = np.id;
    this.bodyId = null;
    this.visited.add(np.id);
    g.applyNewWorld(np.seed, np.palette, {
      terrain: np.terrain,
      surface: np.surface,
      ores: np.ores,
      plants: np.plants,
      hazard: np.hazard,
      weather: np.weather,
      body: np,
      planetName: `${np.name} · ${systemMeta(this.galaxyId).name}`,
    });
    // 飞船出现在新行星高空，继续太空模式
    const groundY = g.world.getGroundY(8.5, 8.5);
    this.flight.pos.set(8.5, groundY + 300, 8.5);
    this.flight.speed = Math.min(this.flight.speed, 60);
    this.enteredAt = { x: this.flight.pos.x, z: this.flight.pos.z, groundY };
    this.buildVisuals();
    this.updateMarkers();
  }

  // ---- 卫星跃迁：切换到月球等可登陆卫星世界 ----
  landOnMoon(node) {
    const g = this.game;
    const parentNav = node.parentId;
    const parentIdx = this.galaxy.findIndex((p) => p.navId === parentNav);
    if (parentIdx >= 0) this.current = parentIdx;
    this.bodyId = node.navId;
    this.visitedMoons.add(node.navId);
    const seed = moonSeedOf(g.seed, node.navId);
    g.applyNewWorld(seed, node.palette, {
      terrain: node.terrain,
      surface: node.surface || 'moon',
      ores: node.ores,
      plants: node.plants,
      hazard: node.hazard,
      weather: node.weather,
      body: node,
      planetName: `${node.name} · ${this.galaxy[this.current].name}系统`,
      noCrashSite: true, // 卫星上没有坠毁残骸，保留原始月面
    });
    const groundY = g.world.getGroundY(8.5, 8.5);
    this.flight.pos.set(8.5, groundY + 300, 8.5);
    this.flight.speed = Math.min(this.flight.speed, 60);
    this.enteredAt = { x: this.flight.pos.x, z: this.flight.pos.z, groundY };
    this.buildVisuals();
    this.updateMarkers();
    g.ui.toast(`${node.name}轨道已抵达 · 重力仅地球 1/6 · 降落后无大气防护`, false);
  }

  // ---- 跨星系跃迁：切换星系数据与母星世界 ----
  switchGalaxy(target) {
    const g = this.game;
    this.galaxyId = target;
    this.galaxy = this.galaxies[target];
    this.current = 0;
    this.bodyId = null;
    this.visited = this.visitedFor(target);
    this.visited.add(0);
    this.targetId = -1;
    const np = this.galaxy[0];
    g.applyNewWorld(np.seed, np.palette, {
      terrain: np.terrain,
      surface: np.surface,
      ores: np.ores,
      plants: np.plants,
      hazard: np.hazard,
      weather: np.weather,
      body: np,
      planetName: `${np.name} · ${systemMeta(target).name}`,
    });
    const groundY = g.world.getGroundY(8.5, 8.5);
    this.flight.pos.set(8.5, groundY + 300, 8.5);
    this.flight.speed = Math.min(this.flight.speed, 60);
    this.enteredAt = { x: this.flight.pos.x, z: this.flight.pos.z, groundY };
    this.warpGrace = 1.2;
    this.buildVisuals();
    this.updateMarkers();
    g.audio.play('spaceEnter');
    g.ui.toast(target === 'solar' ? '已跃迁回太阳系' : `已跃迁至${systemMeta(target).name}`, true);
    g.quests.onReachProxima(target);
    if (g.milestones && target !== 'solar') g.milestones.bump('warp', 1);
  }

  // 罗盘方向（相对飞船朝向的角度与距离）；无目标返回 null。
  // 统一走 targetWorldOffset：星球 / 太阳 / 小行星带 / 卫星 / 空间站 / 跃迁门
  // 与星图选择、HUD 导航共享同一套世界坐标解析。
  compass() {
    const node = this.targetNode();
    if (!node) return null;
    const off = this.targetWorldOffset();
    if (!off) return null;
    // 空间站使用实际场景对象坐标（自转中的世界位置与偏移一致，这里直接取对象最稳）
    if (node.kind === 'station') {
      if (!this.stationGroup || this.galaxyId !== 'solar') return null;
      this.stationGroup.getWorldPosition(this.tmpV);
      const relX = this.tmpV.x - this.flight.pos.x;
      const relZ = this.tmpV.z - this.flight.pos.z;
      const dist = Math.hypot(relX, relZ);
      if (dist < 1) return null;
      const bearing = Math.atan2(relX, relZ);
      let rel = bearing - this.flight.yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      return { angle: rel, dist: Math.round(dist), label: node.name };
    }
    const wx = this.enteredAt.x + off.x;
    const wz = this.enteredAt.z + off.z;
    const relX = wx - this.flight.pos.x;
    const relZ = wz - this.flight.pos.z;
    const dist = Math.hypot(relX, relZ);
    if (dist < 1) return null;
    const bearing = Math.atan2(relX, relZ); // 世界角度
    const fwd = this.flight.yaw;            // 机头世界角度（yaw 定义 -sin/cos）
    let rel = bearing - fwd;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    return { angle: rel, dist: Math.round(dist), label: node.name };
  }
}
