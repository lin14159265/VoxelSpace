// 区块数据与程序化生成（确定性：与生成顺序无关）
import { CHUNK, HEIGHT } from '../core/constants.js';
import { B } from './blocks.js';
import { hash2, hashSeed, Simplex2, Simplex3, fbm2, fbm3, ridged } from './noise.js';

// 默认地形（地球风：经典 MC 生存开局）
export const DEFAULT_TERRAIN = {
  surface: 'grass',       // grass|mars|barren|toxic|jupiter|ice
  base: 26,               // 基准地表高度
  amp: 1.0,               // 丘陵起伏幅度
  mounts: 1.0,            // 山脉强度
  caves: 1.0,             // 洞穴密度（>1 更多洞）
  trees: 1.0,             // 树木密度（0 = 无树）
  waterLevel: 14,         // 草地行星的湖泊水面高度（其他地表自动无水）
};
// 默认资源分布（各行星可乘倍数覆盖：>1 富集 <1 贫瘠）
export const DEFAULT_ORES = { coal: 1, ferrock: 1, copper: 1, gold: 1 };
export const DEFAULT_PLANTS = { sodium: 1, oxygen: 1, dihydrogen: 1, carbon: 1 };

export class WorldGen {
  constructor(seed, profile = null) {
    this.seed = seed;
    const p = profile || {};
    this.terrain = { ...DEFAULT_TERRAIN, ...p };
    // 冰世界地下结构默认启用晶洞（无大气/巨行星冰壳）
    if (!this.terrain.underground && this.terrain.surface === 'ice') this.terrain.underground = 'crystal';
    this.ores = { ...DEFAULT_ORES, ...(p.ores || {}) };
    this.plants = { ...DEFAULT_PLANTS, ...(p.plants || {}) };
    const s = hashSeed('voxelspace:' + seed);
    this.heightN = new Simplex2(s);
    this.heightN2 = new Simplex2(s ^ 0x9e3779b9);
    this.biomeN = new Simplex2(s ^ 0x85ebca6b);
    this.ridgeN = new Simplex2(s ^ 0xc2b2ae35);
    this.craterN = new Simplex2(s ^ 0x1b873593);
    this.caveN = new Simplex3(s ^ 0x27d4eb2f);
    this.oreN = new Simplex3(s ^ 0x165667b1);
    this.oreN2 = new Simplex3(s ^ 0x45d9f3b3);
  }

  // 地表高度（世界坐标 y）——按行星地形参数差异化
  heightAt(x, z) {
    const t = this.terrain;
    const base =
      fbm2(this.heightN, x / 150, z / 150, 4) * 22 * t.amp +
      fbm2(this.heightN2, x / 55, z / 55, 3) * 7 * t.amp;
    const mountains = ridged(this.ridgeN, x / 320, z / 320) * 30 * t.mounts;
    const mask = fbm2(this.biomeN, x / 380 + 100, z / 380 + 100, 2) * 0.5 + 0.5;
    let h = t.base + base + mountains * Math.pow(Math.max(0, mask - 0.25), 1.6);
    // 月球/荒芜卫星：低频洼陷构成环形山剪影（与无植被地表形成月面感）
    if (this.terrain.surface === 'moon') {
      const c = this.craterN.noise(x / 70 + 31, z / 70 - 17);
      h -= Math.pow(Math.max(0, c), 2.1) * 7;
    }
    return Math.max(3, Math.min(HEIGHT - 12, Math.round(h)));
  }

  biomeAt(x, z) {
    const t = fbm2(this.biomeN, x / 240, z / 240, 2) * 0.5 + 0.5;      // 温度
    const h = fbm2(this.biomeN, x / 190 + 999, z / 190 + 999, 2) * 0.5 + 0.5; // 湿度
    return { temp: t, humid: h };
  }

  // 地表方块：按行星表面类型差异化（地球=草地+沙漠海滩；火星=红沙；冰巨星=雪…）
  surfaceBlock(x, z, y) {
    const surface = this.terrain.surface;
    const { temp } = this.biomeAt(x, z);
    switch (surface) {
      case 'moon':
        // 月球：灰色月尘（无大气、无植被；环形山由高度场与洞穴噪声塑造）
        return B.STONE;
      case 'mars':
        // 红色荒漠：低地红沙，高地裸岩
        return y > 46 ? B.STONE : B.RED_SAND;
      case 'barren':
        // 水星：荒岩+沙地斑块
        return temp < 0.22 ? B.SAND : B.STONE;
      case 'ice':
        // 天王星/海王星：雪盖，山峰裸岩
        return y > 46 ? B.STONE : B.SNOW;
      case 'toxic':
        // 金星：剧毒绿原（色相由 palette 着色），少沙
        return temp < 0.18 ? B.SAND : B.GRASS;
      case 'jupiter':
        // 木星/土星：橙黄气态层（草地色相偏橙）+ 沙带
        return temp < 0.3 ? B.SAND : B.GRASS;
      default:
        // 地球：经典草地 + 荒漠/海滩
        if (temp < 0.26) return B.SAND;
        if (y > 46 && temp > 0.55) return B.STONE; // 高海拔裸岩
        return B.GRASS;
    }
  }
}

const IDX = (x, y, z) => y * CHUNK * CHUNK + z * CHUNK + x;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.data = new Uint8Array(CHUNK * HEIGHT * CHUNK); // 0 = 空气
    this.meshOpaque = null;
    this.meshCutout = null;
    this.meshFluid = null;
    this.dirty = false;
    this.generated = false;
  }
  get(x, y, z) { return this.data[IDX(x, y, z)]; }
  set(x, y, z, id) { this.data[IDX(x, y, z)] = id; }

  generate(gen) {
    const x0 = this.cx * CHUNK, z0 = this.cz * CHUNK;
    const heightCache = new Int16Array(CHUNK * CHUNK);
    // 1) 地形
    for (let lx = 0; lx < CHUNK; lx++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        const wx = x0 + lx, wz = z0 + lz;
        const h = gen.heightAt(wx, wz);
        heightCache[lz * CHUNK + lx] = h;
        const surf = gen.surfaceBlock(wx, wz, h);
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = B.STONE;
          else if (y === h) id = surf;
          else if (y >= h - 3 && surf !== B.STONE) {
            if (surf === B.SNOW) id = B.STONE;                     // 雪下冻土
            else if (surf === B.SAND || surf === B.RED_SAND) id = surf; // 沙下仍沙
            else id = B.DIRT;
          } else id = B.STONE;
          this.set(lx, y, lz, id);
        }
        // 1b) 草地行星的湖泊：低于水面的洼地灌水到 waterLevel（确定性、只影响低地）
        const waterLevel = gen.terrain.waterLevel || 0;
        if (waterLevel > 0 && gen.terrain.surface === 'grass' && h < waterLevel) {
          for (let y = h + 1; y <= waterLevel; y++) this.set(lx, y, lz, B.WATER);
        }
      }
    }
    // 2) 洞穴（3D 噪声，不打通地表）
    for (let lx = 0; lx < CHUNK; lx++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        const wx = x0 + lx, wz = z0 + lz;
        const h = heightCache[lz * CHUNK + lx];
        // 洞穴阈值随行星地形参数（caves）变化
        const caveTh = 0.655 - gen.terrain.caves * 0.075;
        for (let y = 2; y < h - 3; y++) {
          const n = fbm3(gen.caveN, wx * 0.052, y * 0.075, wz * 0.052, 3);
          if (n > caveTh) this.set(lx, y, lz, B.AIR);
        }
      }
    }
    // 2.5) 地下结构差异化：
    //   magma   → 热行星（水星/金星/木卫一/天狼星 b）地壳浅层熔岩囊
    //   crystal → 冰世界洞穴地面二氢晶簇（surface='ice' 自动启用）
    const underground = gen.terrain.underground || (gen.terrain.surface === 'ice' ? 'crystal' : null);
    if (underground === 'magma') {
      for (let lx = 0; lx < CHUNK; lx++) {
        for (let lz = 0; lz < CHUNK; lz++) {
          const wx = x0 + lx, wz = z0 + lz;
          const h = heightCache[lz * CHUNK + lx];
          const magmaBase = Math.max(3, Math.floor(h * 0.16));
          for (let y = magmaBase; y <= magmaBase + 6; y++) {
            if (y >= h - 2) break;
            if (hash2(wx, wz, 707 + y * 31) < 0.09 && hash2(wx, wz, 811 + y * 17) < 0.55) {
              if (this.get(lx, y, lz) === B.STONE) this.set(lx, y, lz, B.MAGMA);
              if (this.get(lx, y + 1, lz) === B.STONE && hash2(wx, wz, 919 + y) < 0.5) this.set(lx, y + 1, lz, B.MAGMA);
            }
          }
        }
      }
    } else if (underground === 'crystal') {
      for (let lx = 0; lx < CHUNK; lx++) {
        for (let lz = 0; lz < CHUNK; lz++) {
          const wx = x0 + lx, wz = z0 + lz;
          const h = heightCache[lz * CHUNK + lx];
          for (let y = 3; y < h - 2; y++) {
            if (this.get(lx, y, lz) !== B.AIR) continue;
            if (this.get(lx, y - 1, lz) !== B.STONE) continue;
            if (hash2(wx, wz, 1009 + y * 29) < 0.06) this.set(lx, y, lz, B.DIHYDROGEN);
          }
        }
      }
    }
    // 3) 矿脉（含量随行星资源参数：阈值随倍率放宽/收紧，倍率 1 与原行为一致）
    const oreTh = (base, mult) => base + (1 - (mult || 1)) * 0.25;
    const ores = gen.ores;
    for (let lx = 0; lx < CHUNK; lx++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        const wx = x0 + lx, wz = z0 + lz;
        const h = heightCache[lz * CHUNK + lx];
        for (let y = 1; y < h; y++) {
          if (this.get(lx, y, lz) !== B.STONE) continue;
          const n1 = gen.oreN.noise(wx * 0.085, y * 0.085, wz * 0.085);
          const n2 = gen.oreN2.noise(wx * 0.075, y * 0.075, wz * 0.075);
          let id = B.STONE;
          if (y < 40 && n1 > oreTh(0.63, ores.coal)) id = B.COAL_ORE;
          if (y < 34 && n2 > oreTh(0.66, ores.ferrock)) id = B.FERROCK;
          if (y < 26 && n1 < -oreTh(0.66, ores.copper)) id = B.COPPER_ORE;
          if (y < 16 && n2 < -oreTh(0.7, ores.gold)) id = B.GOLD_ORE;
          this.set(lx, y, lz, id);
        }
      }
    }
    // 4) 地表植物（独立概率 × 行星资源倍率；草地/沙地/雪原/红沙上均可生长）
    // 注意：草地湖泊水面以下的列必须跳过，植物不能把已灌好的水方块覆盖掉。
    const plantRolls = [
      { id: B.SODIUM, p: 0.028, key: 'sodium', h: 31 },
      { id: B.OXYGEN, p: 0.024, key: 'oxygen', h: 57 },
      { id: B.DIHYDROGEN, p: 0.016, key: 'dihydrogen', h: 83 },
      { id: B.CARBON, p: 0.014, key: 'carbon', h: 109 },
    ];
    const pw = gen.plants;
    const grassWaterLevel = gen.terrain.surface === 'grass' ? (gen.terrain.waterLevel || 0) : 0;
    for (let lx = 0; lx < CHUNK; lx++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        const wx = x0 + lx, wz = z0 + lz;
        const h = heightCache[lz * CHUNK + lx];
        if (h <= 0 || h >= HEIGHT - 1) continue;
        if (grassWaterLevel > 0 && h < grassWaterLevel) continue; // 水面以下不长草/花
        const surfId = this.get(lx, h, lz);
        if (surfId === B.GRASS || surfId === B.SAND || surfId === B.SNOW || surfId === B.RED_SAND) {
          for (const def of plantRolls) {
            const mult = Math.min(3, pw[def.key] || 1);
            if (hash2(wx, wz, def.h) < def.p * mult) {
              this.set(lx, h + 1, lz, def.id);
              break;
            }
          }
        }
      }
    }
    // 5) 树木（基座落在扩展范围内 → 跨区块一致；密度随行星参数，0=无树）
    const { temp, humid } = gen.biomeAt(x0 + CHUNK / 2, z0 + CHUNK / 2);
    const treeFactor = gen.terrain.trees;
    if (treeFactor > 0.01) {
      const treeDensity = (temp > 0.32 ? (humid > 0.5 ? 0.012 : 0.005) : 0.0015) * treeFactor;
      const R = 4;
      for (let bx = x0 - R; bx < x0 + CHUNK + R; bx++) {
        for (let bz = z0 - R; bz < z0 + CHUNK + R; bz++) {
          if (hash2(bx, bz, 13) >= treeDensity) continue;
          const h = gen.heightAt(bx, bz);
          if (h <= 2 || h >= HEIGHT - 8) continue;
          if (grassWaterLevel > 0 && h < grassWaterLevel) continue; // 湖底/浅湖不长树，避免树干树冠覆盖水体
          const surf = gen.surfaceBlock(bx, bz, h);
          if (surf === B.SAND && hash2(bx, bz, 91) < 0.5) continue; // 荒漠少有树
          const th = 3 + Math.floor(hash2(bx, bz, 47) * 3);
          this.stampTree(bx, bz, h, th);
        }
      }
    }
    // 6) 行星地标植被（地表差异化——此前无树行星只有平地和低矮植物，地面剪影雷同）：
    // 冰巨星=二氢晶体塔（呼应"二氢富集"设定，可整塔采集；2×1 双柱 + 品红碳晶顶，
    // 单格十字晶体在蓝雪背景下几乎不可见——视觉审查实测）、荒漠/荒原=岩石柱（火星铁氧体帽）、
    // 气态巨星=碳晶簇（呼应"碳×2"设定，2×1 双柱）
    let spire = null;
    const surfType = gen.terrain.surface;
    if (surfType === 'ice') spire = { block: B.DIHYDROGEN, p: 0.014, minH: 2, maxH: 4, wide: true, cap: B.CARBON, capP: 0.5 };
    else if (surfType === 'mars' || surfType === 'barren') spire = { block: B.STONE, p: 0.009, minH: 2, maxH: 3, cap: B.FERROCK, capP: 0.35 };
    else if (surfType === 'jupiter') spire = { block: B.CARBON, p: 0.010, minH: 2, maxH: 3, wide: true };
    if (spire) {
      const R2 = 4;
      for (let bx = x0 - R2; bx < x0 + CHUNK + R2; bx++) {
        for (let bz = z0 - R2; bz < z0 + CHUNK + R2; bz++) {
          if (hash2(bx, bz, 211) >= spire.p) continue;
          const h = gen.heightAt(bx, bz);
          if (h <= 2 || h >= HEIGHT - 8) continue;
          if (gen.surfaceBlock(bx, bz, h) === B.STONE) continue; // 只立在本星地表色块上
          const th = spire.minH + Math.floor(hash2(bx, bz, 313) * (spire.maxH - spire.minH + 1));
          for (let dy = 1; dy <= th; dy++) {
            this.setLocal(bx, h + dy, bz, spire.block);
            if (spire.wide) this.setLocal(bx + 1, h + dy, bz, spire.block);
          }
          if (spire.cap) {
            if (hash2(bx, bz, 401) < spire.capP) this.setLocal(bx, h + th + 1, bz, spire.cap);
            if (spire.wide && hash2(bx, bz, 523) < spire.capP * 0.7) this.setLocal(bx + 1, h + th + 1, bz, spire.cap);
          }
        }
      }
    }
    this.generated = true;
  }

  stampTree(bx, bz, h, th) {
    // 树干
    for (let dy = 1; dy <= th; dy++) this.setLocal(bx, h + dy, bz, B.LOG);
    const top = h + th;
    // 树冠（两层球）
    for (let dy = -1; dy <= 2; dy++) {
      const r = dy <= 0 ? 2 : (dy === 1 ? 2 : 1);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
          if (dy === 2 && Math.abs(dx) + Math.abs(dz) > 2) continue;
          this.setLocal(bx + dx, top + dy, bz + dz, B.LEAVES);
        }
      }
    }
  }

  setLocal(wx, y, wz, id) {
    const lx = wx - this.cx * CHUNK, lz = wz - this.cz * CHUNK;
    if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
    this.set(lx, y, lz, id);
  }
}
