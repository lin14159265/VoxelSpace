// 天空：渐变穹顶着色器 + 星空 + 日月 + 昼夜光照/雾效联动
import * as THREE from 'three';
import { DAY_LENGTH, clamp, lerp, smoothstep } from '../core/constants.js';

const DOME_R = 480;

// 热路径复用的颜色常量：sky.update 每帧执行，避免反复 new THREE.Color 造成 GC 尖峰
const C_DEFAULT_TOP = new THREE.Color(0x3d8fd4);
const C_DEFAULT_HORIZON = new THREE.Color(0xcfe8f0);
const C_SPACE_TOP = new THREE.Color(0x020309);
const C_SPACE_HORIZON = new THREE.Color(0x04070f);
const C_NIGHT_TOP = new THREE.Color(0x050a18);
const C_NIGHT_HORIZON = new THREE.Color(0x0b1830);
const C_DUSK_TOP = new THREE.Color(0x2c3e6e);
const C_DUSK_HORIZON = new THREE.Color(0xff9a4d);
const C_SUN_DUSK = new THREE.Color(0xff7a2a);
const C_SUN_DUSK_LIGHT = new THREE.Color(0xff8c3a);
const C_AMB_DAY_SKY = new THREE.Color(0.7, 0.85, 1);
const C_AMB_NIGHT_SKY = new THREE.Color(0.15, 0.2, 0.35);
const C_AMB_DAY_GROUND = new THREE.Color(0.5, 0.5, 0.45);
const C_AMB_NIGHT_GROUND = new THREE.Color(0.05, 0.06, 0.08);

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.timeSec = DAY_LENGTH * 0.25; // 06:00 日出开始
    this.spaceMode = false;
    this.palette = null; // { top, horizon }（行星大气色板）
    // 行星差异化参数（由 Game.applyBodyProfile 注入）
    this.dayLength = DAY_LENGTH;
    this.retrograde = false;      // 金星/天王星逆行自转：太阳西升东落
    this.sunScale = 1;
    this.sunTint = new THREE.Color(0xfff2c0);
    // Universe V2：世界帧太阳/月球方向与本地天顶（来自宇宙状态）
    this.worldSunDir = null;
    this.worldMoonDir = null;
    this.worldUpDir = null;
    this.altitudeM = 0;
    this.atmoDensity = 1;         // 1=地球：控制雾距与星空可见度
    this.airless = false;         // 月球等无大气天体

    // 穹顶
    this.uniforms = {
      topColor: { value: new THREE.Color(0x4a9bd8) },
      horizonColor: { value: new THREE.Color(0xcfe8f0) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color(0xfff2d0) },
      sunSharp: { value: 220.0 },  // 太阳圆盘锐度（越小盘面越大）
      sunSoft: { value: 8.0 },
      upDir: { value: new THREE.Vector3(0, 1, 0) },
      moonDir: { value: new THREE.Vector3(0, -1, 0) },
      moonSharp: { value: 221.0 },
      moonSoft: { value: 14.0 },
      moonColor: { value: new THREE.Color(0xcdd8f0) },
    };
    const domeGeo = new THREE.SphereGeometry(DOME_R, 32, 18);
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.uniforms,
      vertexShader: `
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 horizonColor;
        uniform vec3 sunDir; uniform vec3 sunColor;
        uniform float sunSharp; uniform float sunSoft;
        #include <logdepthbuf_pars_fragment>
        uniform vec3 upDir; uniform vec3 moonDir; uniform float moonSharp; uniform float moonSoft; uniform vec3 moonColor;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          vec3 up = normalize(upDir);
          float h = clamp(dot(dir, up), -0.2, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(max(h, 0.0), 0.62));
          float sunAmt = max(dot(dir, normalize(sunDir)), 0.0);
          col += sunColor * (pow(sunAmt, sunSharp) * 0.9 + pow(sunAmt, sunSoft) * 0.22);
          float moonAmt = max(dot(dir, normalize(moonDir)), 0.0);
          col += moonColor * (pow(moonAmt, moonSharp) * 0.22 + pow(moonAmt, moonSoft) * 0.06);
          gl_FragColor = vec4(col, 1.0);
          #include <logdepthbuf_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(domeGeo, domeMat);
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // 星空
    const starCount = 2600;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const y = Math.random() * 0.95 + 0.02;
      const r = Math.sqrt(1 - y * y);
      starPos[i * 3] = Math.cos(a) * r * DOME_R * 0.96;
      starPos[i * 3 + 1] = y * DOME_R * 0.96;
      starPos[i * 3 + 2] = Math.sin(a) * r * DOME_R * 0.96;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 1.7, sizeAttenuation: false, color: 0xd6ecff,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // 云层（低多边形云精灵，大气层内可见）
    this.clouds = [];
    const cloudTex = () => {
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 64;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = 'rgba(255,255,255,0)';
      ctx.fillRect(0, 0, 128, 64);
      const blobs = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < blobs; i++) {
        const x = 30 + Math.random() * 68;
        const y = 28 + Math.random() * 16;
        const r = 12 + Math.random() * 14;
        const grd = ctx.createRadialGradient(x, y, 2, x, y, r);
        grd.addColorStop(0, 'rgba(255,255,255,0.85)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      const tex = new THREE.CanvasTexture(cv);
      return tex;
    };
    for (let i = 0; i < 24; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTex(), transparent: true, opacity: 0.34,
        depthWrite: false, fog: false,
      }));
      sp.scale.set(70 + Math.random() * 90, (70 + Math.random() * 90) * 0.5, 1);
      sp.position.set(
        (Math.random() - 0.5) * 520,
        78 + Math.random() * 20,
        (Math.random() - 0.5) * 520,
      );
      sp.userData = { drift: 1.5 + Math.random() * 2.5, baseY: 78 + Math.random() * 20 };
      this.clouds.push(sp);
      scene.add(sp);
    }

    // 太阳 / 月亮精灵
    const sunCv = (r, g, b, glow) => {
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 64;
      const ctx = cv.getContext('2d');
      const grd = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
      grd.addColorStop(0, `rgba(${r},${g},${b},1)`);
      grd.addColorStop(0.35, `rgba(${r},${g},${b},0.9)`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    };
    this.sun = this.makeSprite(sunCv(255, 240, 200, 1), 90);
    this.moon = this.makeSprite(sunCv(190, 210, 255, 1), 46);

    // 光照
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a4a55, 0.6);
    scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.3);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70;
    sc.near = 10; sc.far = 300;
    this.sunLight.shadow.bias = -0.0006;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);
    // 北向补光：模拟天空漫反射，柔和背阴面
    this.fillLight = new THREE.DirectionalLight(0xbfd8ff, 0.28);
    scene.add(this.fillLight);
    scene.add(this.fillLight.target);
    // 月光：夜晚可见度
    this.moonLight = new THREE.DirectionalLight(0x9db8e8, 0);
    scene.add(this.moonLight);
    scene.add(this.moonLight.target);

    // 雾（动态颜色）
    scene.fog = new THREE.Fog(0xcfe8f0, 30, 170);

    // 颜色缓存
    this.cTop = new THREE.Color();
    this.cHorizon = new THREE.Color();
    this.cSun = new THREE.Color();
    this.cAmbSky = new THREE.Color();
    this.cAmbGround = new THREE.Color();
    this.cFog = new THREE.Color();
    // 每帧复用：太阳方向、光照偏移
    this._sunDirCalc = new THREE.Vector3();
    this._tmpV = new THREE.Vector3();
  }

  makeSprite(map, scale) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map, transparent: true, depthWrite: false, fog: false,
    }));
    sp.scale.setScalar(scale);
    this.scene.add(sp);
    return sp;
  }

  // 太阳方向（倾斜轨道）
  sunDirection(angle) {
    return this._sunDirCalc.set(
      Math.cos(angle),
      Math.sin(angle),
      Math.sin(angle) * 0.32,
    ).normalize();
  }

  get dayFactor() { return this._dayFactor; }
  get nightFactor() { return 1 - this._dayFactor; }
  get sunAlt() { return this._sunAlt; }
  get sunDirV() { return this._sunDir; }

  // 行星大气色板（不同星球的天空颜色）
  setPalette(palette) {
    if (!palette) { this.palette = null; return; }
    this.palette = {
      top: new THREE.Color(palette.skyTop !== undefined ? palette.skyTop : 0x3d8fd4),
      horizon: new THREE.Color(palette.skyHorizon !== undefined ? palette.skyHorizon : 0xcfe8f0),
    };
  }

  // ---- 行星本质差异化参数（Game 在切换世界时注入） ----
  setDayLength(seconds, retrograde = false) {
    this.dayLength = Math.max(60, seconds || DAY_LENGTH);
    this.retrograde = !!retrograde;
  }
  setSunAppearance(scale, sharp, soft) {
    this.sunScale = scale;
    this.uniforms.sunSharp.value = sharp;
    this.uniforms.sunSoft.value = soft;
  }
  setSunTint(hex) {
    this.sunTint.setHex(hex);
  }
  setAtmosphere(k) {
    this.atmoDensity = Math.max(0.2, Math.min(2.5, k || 1));
    this.airless = this.atmoDensity < 0.3; // 无大气天体：黑天 + 昼间星空
    this.applyBackgroundMode();
  }

  // 洞穴暗化系数 k∈[0,1]：压低日光/环境光并收缩雾距
  caveDim(k) {
    this._caveK = k;
  }

  // 太空 / 无大气天体：场景背景保持黑色；返回有大气行星时恢复原背景
  applyBackgroundMode() {
    const wantSpace = this.spaceMode || this.airless;
    if (wantSpace) {
      if (!this._surfaceBackground && this.scene.background instanceof THREE.Color) {
        this._surfaceBackground = this.scene.background.clone();
      }
      this.scene.background = new THREE.Color(0x020309);
    } else if (this._surfaceBackground) {
      this.scene.background.copy(this._surfaceBackground);
      this._surfaceBackground = null;
    }
  }

  setWorldSun(dir) { this.worldSunDir = dir ? dir.clone() : null; }
  setWorldMoon(dir) { this.worldMoonDir = dir ? dir.clone() : null; }
  setWorldUp(up) { this.worldUpDir = up ? up.clone() : null; }

  // 太空模式：黑天、星亮、强阳光、薄雾
  setSpaceMode(v) {
    this.spaceMode = v;
    if (v) {
      this._dayFactor = 1;
      this.stars.material.opacity = 1;
      this.moon.material.opacity = 0;
      this.scene.fog.near = 1e7;
      this.scene.fog.far = 1e13;
    }
    this.applyBackgroundMode();
  }

  update(dt, playerPos) {
    // 行星差异化昼夜：快自转巨行星昼夜更快；逆行自转太阳西升东落
    this.timeSec = (this.timeSec + (this.retrograde ? -1 : 1) * dt) % this.dayLength;
    if (this.timeSec < 0) this.timeSec += this.dayLength;
    const t01 = this.timeSec / this.dayLength;
    const angle = t01 * Math.PI * 2;
    const legacySunDir = this.sunDirection(angle);
    const sunDir = this.worldSunDir || legacySunDir;
    const upDir = this.worldUpDir || new THREE.Vector3(0, 1, 0);
    const moonDir = this.worldMoonDir || legacySunDir.clone().negate();
    this._sunDir = sunDir;
    this._sunAlt = clamp(sunDir.dot(upDir), -1, 1);

    let dayFactor = smoothstep(-0.06, 0.2, this._sunAlt);
    let dusk = Math.exp(-Math.pow((this._sunAlt - 0.04) / 0.16, 2));
    if (this.spaceMode) {
      dayFactor = 1;
      dusk = 0;
    }
    this._dayFactor = dayFactor;
    const night = 1 - dayFactor;

    // 天空颜色（支持行星色板；无大气天体 → 恒定黑天，但地面光照仍随昼夜）
    const spaceK = (this.spaceMode || this.airless) ? 1 : 0;
    const palTop = this.palette ? this.palette.top : C_DEFAULT_TOP;
    const palHor = this.palette ? this.palette.horizon : C_DEFAULT_HORIZON;
    this.cTop.copy(palTop).lerp(C_SPACE_TOP, spaceK).lerp(C_NIGHT_TOP, this.airless ? 0 : night)
      .lerp(C_DUSK_TOP, this.airless ? 0 : dusk * 0.5);
    this.cHorizon.copy(palHor).lerp(C_SPACE_HORIZON, spaceK).lerp(C_NIGHT_HORIZON, this.airless ? 0 : night)
      .lerp(C_DUSK_HORIZON, this.airless ? 0 : dusk * 0.6);
    this.cSun.copy(this.sunTint).lerp(C_SUN_DUSK, dusk);

    this.uniforms.topColor.value.copy(this.cTop);
    this.uniforms.horizonColor.value.copy(this.cHorizon);
    this.uniforms.sunDir.value.copy(sunDir);
    if (this.spaceMode) this.uniforms.sunColor.value.setRGB(0, 0, 0);
    else this.uniforms.sunColor.value.copy(this.cSun);
    this.uniforms.upDir.value.copy(upDir);
    this.uniforms.moonDir.value.copy(moonDir);
    // 太空模式里月球是真实 3D 天体，关闭天空球中的背景月盘，避免双月。
    this.uniforms.moonColor.value.setRGB(this.spaceMode ? 0 : 0.8, this.spaceMode ? 0 : 0.85, this.spaceMode ? 0 : 0.94);

    // 星空 / 日月（大气稀薄世界星空更亮；无大气天体昼间也可见星空）
    if (!this.spaceMode) {
      if (this.airless) {
        this.stars.material.opacity = 0.9 * (0.35 + 0.65 * dayFactor);
      } else {
        const starK = Math.max(0.3, Math.min(1.3, 1.5 - this.atmoDensity * 0.5));
        this.stars.material.opacity = night * 0.95 * starK;
      }
    }
    this.stars.position.copy(playerPos);
    this.sun.scale.setScalar(90 * this.sunScale);
    this.sun.position.copy(playerPos).addScaledVector(sunDir, DOME_R * 0.9);
    this.moon.position.copy(playerPos).addScaledVector(sunDir, -DOME_R * 0.9);
    if (this.worldSunDir) {
      this.sun.material.opacity = 0;
      this.moon.material.opacity = 0;
    } else {
      this.sun.material.opacity = clamp(this._sunAlt * 3 + 0.4, 0, 1) * (0.75 + 0.25 * dayFactor) + (this.spaceMode ? 0.25 : 0);
      if (!this.spaceMode) this.moon.material.opacity = clamp(-this._sunAlt * 3 + 0.4, 0, 1) * 0.85;
    }
    this.dome.position.copy(playerPos);

    // 云层：随玩家漂移，太空中淡出
    const cloudOpacity = this.spaceMode ? 0 : 0.34 * (0.55 + 0.45 * dayFactor);
    for (const c of this.clouds) {
      c.material.opacity = cloudOpacity;
      c.position.x += c.userData.drift * dt;
      c.position.y = playerPos.y + c.userData.baseY;
      // 环绕玩家
      const dx = c.position.x - playerPos.x;
      const dz = c.position.z - playerPos.z;
      const lim = 260;
      if (Math.abs(dx) > lim) c.position.x -= Math.sign(dx) * lim * 2;
      if (Math.abs(dz) > lim) c.position.z -= Math.sign(dz) * lim * 2;
    }

    // 光照
    let sunIntensity = this.spaceMode ? 2.4
      : lerp(0.08, 1.25, dayFactor) * (0.75 + 0.25 * (1 - dusk));
    let fillI = this.spaceMode ? 0.12 : lerp(0.06, 0.3, dayFactor);
    let hemiI = this.spaceMode ? 0.16 : lerp(0.38, 0.82, dayFactor);
    // 洞穴暗化（k 平滑后生效）
    const k = this._caveK || 0;
    if (k > 0.01) {
      sunIntensity *= 1 - 0.88 * k;
      fillI *= 1 - 0.85 * k;
      hemiI *= 1 - 0.68 * k;
    }
    this.sunLight.intensity = sunIntensity;
    this.cSun.copy(this.sunTint).lerp(C_SUN_DUSK_LIGHT, dusk * 0.8);
    this.sunLight.color.copy(this.cSun);
    this.sunLight.position.copy(playerPos).addScaledVector(sunDir, 90);
    this.sunLight.target.position.copy(playerPos);
    this.fillLight.position.copy(playerPos).add(upDir.clone().multiplyScalar(30));
    this.fillLight.target.position.copy(playerPos);
    this.fillLight.intensity = fillI;
    this.moonLight.position.copy(playerPos).addScaledVector(moonDir, -80);
    this.moonLight.target.position.copy(playerPos);
    this.moonLight.intensity = this.spaceMode ? 0.1 : lerp(0.24, 0, dayFactor);
    this.hemi.intensity = hemiI;
    this.cAmbSky.copy(C_AMB_DAY_SKY).lerp(C_AMB_NIGHT_SKY, night);
    this.cAmbGround.copy(C_AMB_DAY_GROUND).lerp(C_AMB_NIGHT_GROUND, night);
    this.hemi.color.copy(this.cAmbSky);
    this.hemi.groundColor.copy(this.cAmbGround);

    // 雾（行星大气密度：金星浓雾压缩视野，火星/荒岩世界视野通透，无大气天体近乎无雾）
    if (!this.spaceMode) {
      const fogScale = this.airless ? 2.6 : 1 / (0.6 + 0.4 * this.atmoDensity);
      this.cFog.copy(this.cHorizon);
      this.scene.fog.color.copy(this.cFog);
      const baseNear = (lerp(26, 60, night) + dusk * 8) * (1 - 0.5 * k) * fogScale;
      const baseFar = lerp(150, 240, night) * (1 - 0.42 * k) * fogScale;
      const alt = Math.max(0, this.altitudeM || 0);
      this.scene.fog.near = Math.min(baseNear + alt * 0.5, alt * 0.9);
      this.scene.fog.far = Math.max(baseFar, alt * 3 + 1000);
    } else {
      this.scene.fog.color.copy(this.cHorizon);
    }
  }

  // 游戏时钟文本
  clockText() {
    const hours = (this.timeSec / this.dayLength * 24 + 6) % 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
