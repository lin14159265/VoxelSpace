// 世界管理：区块加载/卸载、方块读写、DDA 射线、坠毁点、网格化队列
import * as THREE from 'three';
import { CHUNK, HEIGHT, RENDER_DIST, MESH_BUDGET } from '../core/constants.js';
import { B, def, isSolid, isPlant } from './blocks.js';
import { WorldGen, Chunk } from './chunk.js';
import { buildChunkGeometry, toMeshes } from './mesher.js';
import { hash2 } from './noise.js';

export class World {
  constructor(seed, profile = null) {
    this.seed = seed;
    this.gen = new WorldGen(seed, profile);
    this.chunks = new Map();
    this.dirty = new Set();       // 高优先级：新区块自身 / 玩家编辑导致的边界重网格
    this.edgeRefresh = new Set(); // 低优先级：新区块出现后，相邻旧区块的边界面刷新
    this.remeshBudget = MESH_BUDGET; // 由 Game 根据帧耗时自适应（1..6）
    this._dirtyList = [];         // 复用数组，避免每帧 [...dirty] 产生 GC
    this.scene = null;
    this.materials = null;
    this.renderDist = RENDER_DIST; // 可由设置动态调整
    this.events = { onBlockBroken: null, onBlockPlaced: null };
    // 坠毁点：出生点前方找最低洼处，保证“坠落在谷底”的构图
    this.crashR = 9;
    let bestX = 26, bestZ = 8, bestH = Infinity;
    for (let x = 14; x <= 58; x += 4) {
      for (let z = -10; z <= 26; z += 4) {
        const h = this.gen.heightAt(x, z);
        if (h < bestH) { bestH = h; bestX = x; bestZ = z; }
      }
    }
    this.crashX = bestX;
    this.crashZ = bestZ;
  }

  setScene(scene) { this.scene = scene; }
  setMaterials(materials) { this.materials = materials; }

  key(cx, cz) { return cx * 4096 + cz; }

  getChunk(cx, cz, create = true) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c && create) {
      c = new Chunk(cx, cz);
      c.generate(this.gen);
      this.chunks.set(k, c);
      this.dirty.add(c);
      // 相邻旧区块的边界面需要刷新，但优先级低于新区块自身。
      // 高速移动/飞行时每秒可能新增数十区块：全部立即入 dirty 会形成网格化积压。
      // 不透明面的旧边界几何会被背面剔除，因此延后刷新不会产生可见错误；
      // 水体/玻璃等双面面片在预算宽裕后由 edgeRefresh 补刷。
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = this.chunks.get(this.key(cx + dx, cz + dz));
        if (n && (n.meshOpaque || n.meshCutout || n.meshFluid)) this.edgeRefresh.add(n);
      }
    }
    return c;
  }

  ensureColumn(cx, cz) { this.getChunk(cx, cz, true); }
  ensureArea(cx0, cz0, r) {
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++)
        this.getChunk(cx0 + dx, cz0 + dz, true);
  }

  // 方块查询：y<0 视为基岩，未加载列视为空气（加载由玩家半径保证）
  getBlock(x, y, z) {
    if (y < 0) return B.STONE;
    if (y >= HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(this.key(cx, cz));
    if (!c) return B.AIR;
    return c.get(x - cx * CHUNK, y, z - cz * CHUNK);
  }

  surfaceHeight(x, z) { return this.gen.heightAt(Math.floor(x), Math.floor(z)); }

  // 实际地表高度（考虑弹坑等雕刻）：返回首个固体方块上方 y
  getGroundY(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    let y = this.gen.heightAt(ix, iz);
    while (y > 0 && this.getBlock(ix, y, iz) === B.AIR) y--;
    return y + 1;
  }

  // 是否处于地下洞穴（头顶有覆盖层且深度超过阈值）
  // minDepth：距地表至少此深度才算洞穴（树冠/浅棚不算）
  isUnderground(x, y, z, minDepth = 3) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const surface = this.gen.heightAt(ix, iz);
    if (y > surface - minDepth) return false;
    // 头顶 10 格内统计实体非树叶方块
    let solid = 0;
    const iy = Math.floor(y);
    for (let dy = 2; dy <= 11; dy++) {
      const id = this.getBlock(ix, iy + dy, iz);
      if (id !== B.AIR && id !== B.LEAVES) solid++;
    }
    return solid >= 4;
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.getChunk(cx, cz, true);
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    c.set(lx, y, lz, id);
    this.markDirty(c, lx, lz);
    return true;
  }

  breakBlock(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id === B.AIR) return null;
    this.setBlock(x, y, z, B.AIR);
    const d = def(id);
    if (this.events.onBlockBroken) this.events.onBlockBroken(x, y, z, id);
    return d;
  }

  placeBlock(x, y, z, id) {
    const ok = this.setBlock(x, y, z, id);
    if (ok && this.events.onBlockPlaced) this.events.onBlockPlaced(x, y, z, id);
    return ok;
  }

  markDirty(c, lx, lz) {
    this.dirty.add(c);
    const n1 = this.getChunk(c.cx - 1, c.cz, false), n2 = this.getChunk(c.cx + 1, c.cz, false);
    const n3 = this.getChunk(c.cx, c.cz - 1, false), n4 = this.getChunk(c.cx, c.cz + 1, false);
    if (lx === 0 && n1) this.dirty.add(n1);
    if (lx === CHUNK - 1 && n2) this.dirty.add(n2);
    if (lz === 0 && n3) this.dirty.add(n3);
    if (lz === CHUNK - 1 && n4) this.dirty.add(n4);
  }

  // 网格化（每帧限预算，优先离玩家近的脏区块）；返回本次网格化的数量。
  // 顺序：先高优先级 dirty（新区块/编辑），再用剩余预算处理 edgeRefresh（旧区块边界）。
  remeshQueue(px, pz, budgetOverride = 0) {
    if (!this.scene || !this.materials) return 0;
    let budget = budgetOverride || this.remeshBudget || MESH_BUDGET;
    let meshed = 0;

    const collectAndSort = (set) => {
      const list = this._dirtyList;
      list.length = 0;
      for (const c of set) list.push(c);
      if (list.length > budget) {
        list.sort((a, b) => {
          const da = (a.cx * CHUNK + 8 - px) ** 2 + (a.cz * CHUNK + 8 - pz) ** 2;
          const db = (b.cx * CHUNK + 8 - px) ** 2 + (b.cz * CHUNK + 8 - pz) ** 2;
          return da - db;
        });
      }
      return list;
    };

    const meshChunk = (c) => {
      this.dirty.delete(c);
      this.edgeRefresh.delete(c);
      // 邻居必须已生成，保证边界面剔除正确；缺失则留待邻居出现后再网格化
      const hasNeighbors =
        this.chunks.has(this.key(c.cx + 1, c.cz)) &&
        this.chunks.has(this.key(c.cx - 1, c.cz)) &&
        this.chunks.has(this.key(c.cx, c.cz + 1)) &&
        this.chunks.has(this.key(c.cx, c.cz - 1));
      if (!hasNeighbors) {
        this.dirty.add(c); // 统一回到高优先级：邻居生成后必须尽快重网格
        return false;
      }
      const result = buildChunkGeometry(this, c);
      const meshes = toMeshes(result, this.materials);
      this.disposeChunkMeshes(c);
      let opaque = null, cutout = null, fluid = null;
      for (const m of meshes) {
        // 几何顶点已是世界坐标，无需位移
        m.position.set(0, 0, 0);
        if (this.meshesHidden) m.visible = false;
        this.scene.add(m);
        if (m.material === this.materials[0]) opaque = m;
        else if (m.material === this.materials[1]) cutout = m;
        else fluid = m;
      }
      c.meshOpaque = opaque;
      c.meshCutout = cutout;
      c.meshFluid = fluid;
      return true;
    };

    for (const c of collectAndSort(this.dirty)) {
      if (budget <= 0) break;
      if (meshChunk(c)) { meshed++; budget--; }
    }
    if (budget > 0) {
      for (const c of collectAndSort(this.edgeRefresh)) {
        if (budget <= 0) break;
        if (meshChunk(c)) { meshed++; budget--; }
      }
    }
    return meshed;
  }

  disposeChunkMeshes(c) {
    if (c.meshOpaque) { this.scene.remove(c.meshOpaque); c.meshOpaque.geometry.dispose(); c.meshOpaque = null; }
    if (c.meshCutout) { this.scene.remove(c.meshCutout); c.meshCutout.geometry.dispose(); c.meshCutout = null; }
    if (c.meshFluid) { this.scene.remove(c.meshFluid); c.meshFluid.geometry.dispose(); c.meshFluid = null; }
  }

  // 太空模式隐藏/显示全部地表网格（新网格化也遵循）
  setMeshesVisible(v) {
    this.meshesHidden = !v;
    for (const c of this.chunks.values()) {
      if (c.meshOpaque) c.meshOpaque.visible = v;
      if (c.meshCutout) c.meshCutout.visible = v;
      if (c.meshFluid) c.meshFluid.visible = v;
    }
  }

  update(px, pz) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    // 多加载一圈，保证可见半径内的区块都有完整邻居可网格化
    const LOAD = (this.renderDist || RENDER_DIST) + 1;
    for (let dx = -LOAD; dx <= LOAD; dx++)
      for (let dz = -LOAD; dz <= LOAD; dz++)
        this.getChunk(pcx + dx, pcz + dz, true);
    // 卸载过远区块
    const far = LOAD + 3;
    for (const [k, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) > far || Math.abs(c.cz - pcz) > far) {
        this.disposeChunkMeshes(c);
        this.dirty.delete(c);
        this.edgeRefresh.delete(c);
        this.chunks.delete(k);
      }
    }
    this.remeshQueue(px, pz);
  }

  // ---- DDA 体素射线 ----
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) * tDeltaX) : Infinity;
    let tMaxY = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) * tDeltaY) : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ) : Infinity;
    let nx = 0, ny = 0, nz = 0;
    let t = 0;
    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (isSolid(id) || isPlant(id)) return { x, y, z, nx, ny, nz, id, dist: t };
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
      if (y < 0) return null;
    }
    return null;
  }

  // ---- 坠毁点：弹坑 + 焦土带 + 残骸，清除植被 ----
  carveCrash() {
    const cx = this.crashX, cz = this.crashZ, r = this.crashR;
    this.ensureArea(Math.floor(cx / CHUNK), Math.floor(cz / CHUNK), Math.ceil((r + 8) / CHUNK) + 1);
    for (let x = cx - r - 7; x <= cx + r + 7; x++) {
      for (let z = cz - r - 7; z <= cz + r + 7; z++) {
        const h = this.gen.heightAt(x, z);
        const d = Math.hypot(x - cx, z - cz);
        // 清除植被/树木
        for (let y = h + 1; y <= h + 10; y++) {
          const id = this.getBlock(x, y, z);
          if (isPlant(id) || id === B.LOG || id === B.LEAVES) this.setBlock(x, y, z, B.AIR);
        }
        if (d < r + 5 && d >= r - 1) {
          if (hash2(x, z, 44) < 0.55 && this.getBlock(x, h, z) !== B.STONE) {
            this.setBlock(x, h, z, B.SCORCHED);
          }
        }
        if (d < r) {
          const depth = Math.max(0, Math.floor((1 - d / r) * 2.2));
          for (let y = h; y > h - depth; y--) this.setBlock(x, y, z, B.AIR);
          const ny = h - depth;
          if (ny >= 1 && this.getBlock(x, ny, z) !== B.AIR) {
            this.setBlock(x, ny, z, B.SCORCHED);
            if (hash2(x, z, 77) < 0.03) this.setBlock(x, ny + 1, z, B.HULL_DARK);
          }
          // 填平弹坑下方意外连通的洞穴，避免黑洞
          for (let y = ny - 1; y >= Math.max(1, ny - 7); y--) {
            if (this.getBlock(x, y, z) === B.AIR) this.setBlock(x, y, z, B.STONE);
          }
        }
        // 尾部烧蚀拖痕（船头朝西，船尾朝东 +x）
        const tail = Math.abs(z - cz) < 3 && x > cx + r && x < cx + r + 7;
        if (tail && this.getBlock(x, h, z) !== B.AIR && this.getBlock(x, h, z) !== B.STONE) {
          this.setBlock(x, h, z, B.SCORCHED);
        }
      }
    }
    // 出生点 → 坠毁点的"视线走廊"：清除大树等遮挡。
    // 历史问题：出生点正前方长着大树 + 船体陷在坑里 → 新玩家第一眼完全看不到
    // 任务目标"飞船残骸"，只能靠文字指引（视觉审查确认）。
    const distToSeg = (x, z) => {
      const dx = cx - 8, dz = cz - 8;
      const len2 = dx * dx + dz * dz || 1;
      let t = ((x - 8) * dx + (z - 8) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = 8 + t * dx, pz = 8 + t * dz;
      return Math.hypot(x - px, z - pz);
    };
    for (let x = 4; x <= cx + 3; x++) {
      for (let z = cz - 8; z <= cz + 8; z++) {
        const inLane = distToSeg(x, z) < 4.5;
        const nearSpawn = Math.hypot(x - 8, z - 8) <= 6;
        if (!inLane && !nearSpawn) continue;
        const h = this.gen.heightAt(x, z);
        for (let y = h + 1; y <= h + 10; y++) {
          const id = this.getBlock(x, y, z);
          if (isPlant(id) || id === B.LOG || id === B.LEAVES) this.setBlock(x, y, z, B.AIR);
        }
      }
    }
  }

  // 残骸堆：把坠毁飞船垫高到弹坑边缘之上。
  // 弹坑中心下挖 ~3 格、飞船全高仅 ~3.5 格——按坑底直接放置时船体整个陷在
  // 坑里，从出生点只能看到弹坑边缘的焦土墙，任务目标"飞船"完全不可见
  // （视觉审查发现的第一眼问题）。此方法在坑底堆一层残骸（金属板/焦土/石块），
  // 船体落在堆上后机翼与机身明显高出坑沿，远处即可辨认。
  buildWreckMound(cx, cz) {
    const base = this.getGroundY(cx, cz) + 1;
    for (let x = cx - 4; x <= cx + 4; x++) {
      for (let z = cz - 4; z <= cz + 4; z++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d > 4.4) continue;
        const h = hash2(x, z, 913);
        if (d > 3.6 && h < 0.5) continue; // 边缘打洞：堆积感而非整块平板
        let id = B.HULL_DARK;
        if (h < 0.25) id = B.SCORCHED;
        else if (h < 0.35) id = B.HULL;
        else if (h < 0.42) id = B.STONE;
        this.setBlock(x, base, z, id);
        // 第二层：托起机身主体
        if (d < 3.8 && h > 0.3) {
          this.setBlock(x, base + 1, z, h < 0.42 ? B.HULL_DARK : (h < 0.5 ? B.HULL : B.SCORCHED));
        }
        // 第三层：船底落点（中心较密）
        if (d < 3.2 && h > 0.42) {
          this.setBlock(x, base + 2, z, h < 0.55 ? B.HULL_DARK : B.SCORCHED);
        }
      }
    }
  }

  // 出生点：坠毁点旁边，面向飞船
  spawnPoint() {
    const h = this.gen.heightAt(Math.floor(8), Math.floor(8));
    return { x: 8.5, y: h + 2.2, z: 8.5 };
  }

  crashGroundY() {
    const h = this.gen.heightAt(this.crashX, this.crashZ);
    const depth = Math.floor((1 - 0 / this.crashR) * 3.2);
    return h - depth;
  }
}
