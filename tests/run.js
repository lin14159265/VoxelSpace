// Node 冒烟测试：验证纯逻辑模块（噪声/区块/网格化/射线/背包/任务）
// 运行：node tests/run.js
import { Simplex2, Simplex3, fbm2, fbm3, hash2, hashSeed, mulberry32 } from '../src/world/noise.js';
import { CHUNK, HEIGHT } from '../src/core/constants.js';
import { B, BLOCKS, def, isSolid, isPlant } from '../src/world/blocks.js';
import { World } from '../src/world/world.js';
import { Chunk, WorldGen } from '../src/world/chunk.js';
import { buildChunkGeometry, pickTileVariant } from '../src/world/mesher.js';
import { Inventory, ITEMS } from '../src/systems/inventory.js';
import { Quests, STEP_DEFS } from '../src/systems/quests.js';
import { TILE, ROTATIONS, TILE_COUNT } from '../src/world/tiles.js';
import { tileUVs } from '../src/world/textures.js';

let passed = 0, failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error('  ✗ FAIL:', msg); }
}
function section(name) { console.log('▶ ' + name); }

// ---------- 噪声 ----------
section('noise');
{
  const n2 = new Simplex2(123);
  const n2b = new Simplex2(123);
  const n2c = new Simplex2(124);
  let min = 1, max = -1;
  for (let i = 0; i < 500; i++) {
    const v = n2.noise(i * 0.13, i * 0.07);
    min = Math.min(min, v); max = Math.max(max, v);
    assert(Math.abs(v - n2b.noise(i * 0.13, i * 0.07)) < 1e-12, 'simplex2 确定性');
  }
  assert(min >= -1.1 && max <= 1.1, `simplex2 值域 [-1,1]（实际 ${min.toFixed(2)}..${max.toFixed(2)}）`);
  let diff = 0;
  for (let i = 0; i < 100; i++) diff += Math.abs(n2.noise(i, i) - n2c.noise(i, i));
  assert(diff > 0.1, '不同种子产生不同噪声');

  const n3 = new Simplex3(777);
  let min3 = 1, max3 = -1;
  for (let i = 0; i < 300; i++) {
    const v = n3.noise(i * 0.21, i * 0.11, i * 0.05);
    min3 = Math.min(min3, v); max3 = Math.max(max3, v);
  }
  assert(min3 >= -1.1 && max3 <= 1.1, 'simplex3 值域 [-1,1]');
  const f = fbm2(n2, 3.3, 7.7, 4);
  assert(f >= -1.1 && f <= 1.1, 'fbm2 值域');
  const f3 = fbm3(n3, 1, 2, 3, 3);
  assert(f3 >= -1.1 && f3 <= 1.1, 'fbm3 值域');
  const h1 = hash2(5, -7, 3), h2 = hash2(5, -7, 3), h3 = hash2(6, -7, 3);
  assert(h1 === h2 && h1 >= 0 && h1 < 1, 'hash2 确定性');
  assert(h1 !== h3, 'hash2 坐标敏感');
  assert(mulberry32(9)() >= 0 && mulberry32(9)() < 1, 'mulberry32 值域');
  assert(hashSeed('abc') === hashSeed('abc') && hashSeed('abc') !== hashSeed('abd'), 'hashSeed');
}

// ---------- 方块注册表 ----------
section('blocks');
{
  const ids = Object.values(B);
  const usedTiles = new Set();
  for (const id of ids) {
    if (id === B.AIR) continue;
    const d = def(id);
    assert(d.tiles.top >= 0 && d.tiles.top < TILE_COUNT, `方块 ${d.name} top 瓦片有效`);
    if (d.variants) {
      for (const [k, pool] of Object.entries(d.variants)) {
        assert(pool.length >= 2, `方块 ${d.name} 变体池 ${k} 至少 2 项`);
        for (const tile of pool) assert(tile >= 0 && tile < TILE_COUNT, `方块 ${d.name} 变体瓦片有效`);
      }
    }
    assert(d.hardness > 0 || d.opacity === 'water', `方块 ${d.name} 硬度>0（液体豁免）`);
    if (isSolid(id)) {
      assert(d.drop && d.drop.item, `方块 ${d.name} 有掉落`);
    }
  }
  for (const [i, r] of ROTATIONS.entries()) {
    // 每个旋转应是 4 个角 UV 坐标对 (0,0)/(1,0)/(1,1)/(0,1) 的排列
    const pairs = new Set();
    for (let c = 0; c < 4; c++) pairs.add(`${r[c * 2]},${r[c * 2 + 1]}`);
    assert(pairs.size === 4 && pairs.has('0,0') && pairs.has('1,0') && pairs.has('1,1') && pairs.has('0,1'),
      `旋转 ${i} 为角 UV 排列`);
  }
  const uv = tileUVs(0);
  assert(uv.every((v) => v >= 0 && v <= 1), 'tileUVs 值域');
  const uv2 = tileUVs(TILE_COUNT - 1);
  assert(uv2[2] <= 1 && uv2[3] <= 1, '最后瓦片 UV 不越界');
}

// ---------- 世界生成 ----------
section('world generation');
const world = new World('test-seed-42');
{
  const sp = world.spawnPoint();
  assert(sp.y > 3 && sp.y < HEIGHT - 2, `出生点高度合理 (${sp.y.toFixed(1)})`);
  const h = world.surfaceHeight(sp.x, sp.z);
  assert(h >= 3 && h <= HEIGHT - 12, `地表高度在范围内 (${h})`);
  world.ensureArea(Math.floor(sp.x / CHUNK), Math.floor(sp.z / CHUNK), 2);
  world.carveCrash();

  // 区块数据一致性
  const c = world.getChunk(0, 0, false) || world.getChunk(1, 1, false);
  assert(c && c.generated, '区块已生成');
  let solidCount = 0, airCount = 0;
  for (let x = 0; x < CHUNK; x++)
    for (let z = 0; z < CHUNK; z++)
      for (let y = 0; y < HEIGHT; y++) {
        const id = c.get(x, y, z);
        assert(id >= 0 && id < Object.keys(BLOCKS).length, '方块 id 有效');
        if (id === B.AIR) airCount++; else solidCount++;
      }
  assert(solidCount > 3000, `区块含足够实体方块 (${solidCount})`);
  assert(airCount > 2000, `区块含空气 (${airCount})`);

  // 两个独立生成的相同区块应一致（确定性；避开坠毁点雕刻区）
  world.getChunk(3, 3, true);
  const w2 = new World('test-seed-42');
  w2.ensureArea(3, 3, 0);
  const c2 = w2.getChunk(3, 3, false);
  const c1 = world.getChunk(3, 3, false);
  let same = true;
  for (let i = 0; i < c1.data.length; i++) if (c1.data[i] !== c2.data[i]) { same = false; break; }
  assert(same, '相同种子跨实例确定性');

  // 崩毁点：弹坑内应存在焦土
  let scorch = 0;
  for (let x = world.crashX - world.crashR; x <= world.crashX + world.crashR; x++)
    for (let z = world.crashZ - world.crashR; z <= world.crashZ + world.crashR; z++)
      for (let y = world.surfaceHeight(x, z) - 3; y <= world.surfaceHeight(x, z) + 1; y++)
        if (world.getBlock(x, y, z) === B.SCORCHED) scorch++;
  assert(scorch > 5, `坠毁点有焦土 (${scorch})`);

  // 水体生成：草地行星低洼处出现湖泊；非草地行星同位置保持干燥
  const waterGen = new WorldGen('water-seed');
  let lake = null;
  for (let x = -1000; x <= 1000 && !lake; x += 4) {
    for (let z = -1000; z <= 1000 && !lake; z += 4) {
      const h = waterGen.heightAt(x, z);
      if (h < waterGen.terrain.waterLevel) { lake = { x, z, h }; break; }
    }
  }
  assert(!!lake, '测试种子存在湖泊洼地');
  const waterChunk = new Chunk(Math.floor(lake.x / CHUNK), Math.floor(lake.z / CHUNK));
  waterChunk.generate(waterGen);
  let waterBlocks = 0;
  for (const v of waterChunk.data) if (v === B.WATER) waterBlocks++;
  assert(waterBlocks > 0, `草地洼地生成水体（${waterBlocks} 块）`);
  // 水体完整性：所有低于水面的列，h+1..waterLevel 必须仍为水；
  // 植物/树木阶段不得回头覆盖湖水（P0-1 回归）。
  let waterColumns = 0, waterColumnErrors = 0;
  for (let lx = 0; lx < CHUNK; lx++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      const wx = waterChunk.cx * CHUNK + lx;
      const wz = waterChunk.cz * CHUNK + lz;
      const h = waterGen.heightAt(wx, wz);
      if (h >= waterGen.terrain.waterLevel) continue;
      waterColumns++;
      for (let y = h + 1; y <= waterGen.terrain.waterLevel; y++) {
        if (waterChunk.get(lx, y, lz) !== B.WATER) waterColumnErrors++;
      }
    }
  }
  assert(waterColumns > 0, `含湖区块存在水面列（${waterColumns} 列）`);
  assert(waterColumnErrors === 0, `水面列完整保留水体（${waterColumns} 列，覆盖错误 ${waterColumnErrors} 处）`);
  const dryGen = new WorldGen('water-seed', { surface: 'mars', waterLevel: 14 });
  const dryChunk = new Chunk(waterChunk.cx, waterChunk.cz);
  dryChunk.generate(dryGen);
  let dryWater = 0;
  for (const v of dryChunk.data) if (v === B.WATER) dryWater++;
  assert(dryWater === 0, '非草地行星同位置不生成水');
}

// ---------- 网格化 ----------
section('mesher');
{
  const c = world.getChunk(0, 0, false) || world.getChunk(1, 1, false);
  const result = buildChunkGeometry(world, c);
  assert(result.opaque.pos.length > 0, '不透明几何非空');
  assert(result.opaque.pos.length > 8000,
    `地表网格规模合理（${Math.round(result.opaque.pos.length / 3)} 顶点），空气不应被剔除`);
  const p = result.opaque.pos;
  assert(p.length % 3 === 0, '顶点数为 3 的倍数');
  let finite = true;
  for (const v of p) if (!Number.isFinite(v)) { finite = false; break; }
  assert(finite, '顶点坐标均为有限值');
  const n = result.opaque.norm;
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
    assert(Math.abs(len - 1) < 1e-4, '法线为单位向量');
  }
  const uv = result.opaque.uv;
  for (const v of uv) assert(v >= 0 && v <= 1, 'UV 在 [0,1]');
  const col = result.opaque.col;
  for (const v of col) assert(v > 0 && v <= 1.0001, '顶点色亮度有效');
  // 材质变体：选择确定、落在变体池内，且大片地形会实际用到多个变体
  const grassDef = def(B.GRASS);
  const stoneDef = def(B.STONE);
  assert(grassDef.variants.top.includes(pickTileVariant(grassDef, 2, 10, 20, 30)), '草地顶面变体来自池内');
  assert(pickTileVariant(grassDef, 2, 10, 20, 30) === pickTileVariant(grassDef, 2, 10, 20, 30), '变体选择确定性');
  const used = new Set();
  for (let x = 0; x < 64; x++) used.add(pickTileVariant(stoneDef, 2, x, 20, 30));
  assert(used.size >= 2, `岩石顶面在 64 个位置至少使用 2 个变体（实际 ${used.size}）`);
  // 水体网格：结果含独立 fluid 缓冲，且所有 UV/法线/索引拓扑与实体面同规
  const fluidGeo = (() => {
    const g = new WorldGen('water-seed');
    let lake = null;
    for (let x = -1000; x <= 1000 && !lake; x += 4) for (let z = -1000; z <= 1000 && !lake; z += 4) {
      const h = g.heightAt(x, z);
      if (h < g.terrain.waterLevel) { lake = { x, z }; break; }
    }
    const fake = new World('water-seed');
    fake.ensureArea(Math.floor(lake.x / CHUNK), Math.floor(lake.z / CHUNK), 1);
    const wc = fake.getChunk(Math.floor(lake.x / CHUNK), Math.floor(lake.z / CHUNK), false);
    return buildChunkGeometry(fake, wc).fluid;
  })();
  assert(fluidGeo && fluidGeo.pos.length > 0, '水体几何非空');
  assert(fluidGeo.pos.length % 3 === 0, '水体顶点数为 3 的倍数');
  const fluidUvOk = fluidGeo.uv.every((v) => v >= 0 && v <= 1);
  assert(fluidUvOk, '水体 UV 全部在 [0,1]');
  let fluidNormOk = true;
  for (let i = 0; i < fluidGeo.norm.length; i += 3) {
    const len = Math.hypot(fluidGeo.norm[i], fluidGeo.norm[i + 1], fluidGeo.norm[i + 2]);
    if (Math.abs(len - 1) >= 1e-4) { fluidNormOk = false; break; }
  }
  assert(fluidNormOk, '水体法线均为单位向量');
  // 顶点数应合理（每个方块 ≤24 顶点，面剔除后远小于上限）
  assert(p.length / 3 <= 24 * CHUNK * CHUNK * HEIGHT, '顶点数不超过上限');

  // ---- 拓扑审计：防止"非索引四边形"类渲染灾难（跨面三角形/拉伸尖刺） ----
  // 历史 bug：非索引几何每 4 顶点一组发射四边形，导致第 2 个三角形横跨两个不相干的面。
  // 合法体素网格三角形最大边长 = 植物对角面 √3；任何更长边都说明三角形跨面拉伸。
  const MAX_EDGE = Math.sqrt(3) + 1e-4;
  const audit = (buf, label) => {
    assert(Array.isArray(buf.idx) && buf.idx.length > 0, `${label} 存在索引缓冲`);
    const vcount = buf.pos.length / 3;
    assert(buf.idx.length === vcount / 4 * 6,
      `${label} 索引数 = 顶点数/4×6（实际 ${buf.idx.length}，期望 ${vcount / 4 * 6}）`);
    let quadBad = 0, edgeBad = 0, degenBad = 0;
    for (let i = 0; i < buf.idx.length; i += 3) {
      const a = buf.idx[i], b = buf.idx[i + 1], c2 = buf.idx[i + 2];
      if (a < 0 || b < 0 || c2 < 0 || a >= vcount || b >= vcount || c2 >= vcount) {
        quadBad++; continue;
      }
      // 三角形 3 个索引必须落在同一个 4 顶点四边形窗口内
      if ((a >> 2) !== (b >> 2) || (b >> 2) !== (c2 >> 2)) { quadBad++; continue; }
      const ax = a * 3, bx = b * 3, cx = c2 * 3;
      const e1 = Math.hypot(buf.pos[ax] - buf.pos[bx], buf.pos[ax + 1] - buf.pos[bx + 1], buf.pos[ax + 2] - buf.pos[bx + 2]);
      const e2 = Math.hypot(buf.pos[ax] - buf.pos[cx], buf.pos[ax + 1] - buf.pos[cx + 1], buf.pos[ax + 2] - buf.pos[cx + 2]);
      const e3 = Math.hypot(buf.pos[bx] - buf.pos[cx], buf.pos[bx + 1] - buf.pos[cx + 1], buf.pos[bx + 2] - buf.pos[cx + 2]);
      if (Math.max(e1, e2, e3) > MAX_EDGE) edgeBad++;
      if (Math.min(e1, e2, e3) < 1e-6) degenBad++;
    }
    assert(quadBad === 0, `${label} 无跨四边形三角形 (${quadBad})`);
    assert(edgeBad === 0, `${label} 无超长边三角形 (${edgeBad})`);
    assert(degenBad === 0, `${label} 无退化三角形 (${degenBad})`);
  };
  audit(result.opaque, 'opaque');
  audit(result.cutout, 'cutout');
}

// ---------- 草方块侧面 UV 朝向（历史 bug：绿草条带随机出现在侧边/底部） ----------
section('grass side-face UV orientation');
{
  // 单方块世界：仅 (0,1,0) 一个草方块，四周与顶底均为空气
  const fakeWorld = {
    getBlock: (x, y, z) => (x === 0 && y === 1 && z === 0 ? B.GRASS : B.AIR),
  };
  const solo = new Chunk(0, 0);
  solo.set(0, 1, 0, B.GRASS);
  const result = buildChunkGeometry(fakeWorld, solo);
  const P = result.opaque.pos, N = result.opaque.norm, UV = result.opaque.uv;
  // 6 个面都应生成（顶/底/4 侧）→ 24 顶点
  assert(P.length / 3 === 24, `单草方块生成 6 面共 24 顶点（实际 ${P.length / 3}）`);
  // 侧瓦片现在有变体，不变量改为：每个侧面四边形内，高顶点共享同一 v、低顶点共享另一 v
  let sideQuads = 0, bad = 0;
  for (let q = 0; q < P.length / 3; q += 4) {
    const nx = N[q * 3], nz = N[q * 3 + 2];
    if (nx === 0 && nz === 0) continue; // 跳过顶/底面
    sideQuads++;
    // 侧面不变量：世界 y 高的顶点必须取瓦片顶部 v（绿草条带永远在方块顶部）
    let maxY = -Infinity, minY = Infinity;
    for (let k = 0; k < 4; k++) {
      const y = P[(q + k) * 3 + 1];
      if (y > maxY) maxY = y;
      if (y < minY) minY = y;
    }
    const topVs = new Set(), bottomVs = new Set();
    for (let k = 0; k < 4; k++) {
      const y = P[(q + k) * 3 + 1];
      const v = UV[(q + k) * 2 + 1];
      if (y === maxY) topVs.add(v);
      if (y === minY) bottomVs.add(v);
    }
    if (topVs.size !== 1 || bottomVs.size !== 1 || topVs.values().next().value === bottomVs.values().next().value) bad++;
  }
  assert(sideQuads === 4, `草方块 4 个侧面均生成（实际 ${sideQuads}）`);
  assert(bad === 0, `草方块侧面纹理竖直朝向全部正确（异常 ${bad}）`);
}

// ---------- DDA 射线 ----------
section('raycast');
{
  // 找一个已知固体方块：出生点正下方
  const sp = world.spawnPoint();
  const bx = Math.floor(sp.x), bz = Math.floor(sp.z);
  let by = Math.floor(sp.y) - 2;
  while (by > 0 && !isSolid(world.getBlock(bx, by, bz))) by--;
  assert(by > 0, '出生点下方存在固体方块');
  // 从上方垂直向下打
  const hit = world.raycast(bx + 0.5, by + 5, bz + 0.5, 0, -1, 0, 10);
  assert(hit && hit.x === bx && hit.z === bz && hit.y === by, `垂直射线命中 (${hit && hit.x},${hit && hit.y},${hit && hit.z}) 期望 (${bx},${by},${bz})`);
  assert(hit.ny === 1, '顶面法线朝上');
  // 斜向射线也有命中
  const hit2 = world.raycast(bx + 0.5, by + 5, bz + 0.5, 0.3, -0.8, 0.2, 12);
  assert(hit2 !== null, '斜向射线命中');
  // 向上打空气不应命中固体（可能命中植物，用高空气判定）
  const hit3 = world.raycast(bx + 0.5, by + 1, bz + 0.5, 0, 1, 0, 5);
  assert(hit3 === null || hit3.y > by + 1, '向上射线不命中下方方块');
  // 植物可命中：在出生点旁边放置植物测试
  world.placeBlock(bx + 2, by + 2, bz + 2, B.SODIUM);
  const hit4 = world.raycast(bx + 2 + 0.5, by + 2 + 3, bz + 2 + 0.5, 0, -1, 0, 8);
  assert(hit4 && hit4.id === B.SODIUM, '射线可命中植物');
}

// ---------- 背包 ----------
section('inventory');
{
  const inv = new Inventory();
  const added = inv.addItem('dirt', 100);
  assert(added === 100, '加入 100 泥土');
  assert(inv.countOf('dirt') === 100, '数量统计正确');
  assert(inv.addItem('stone', 5) === 5, '加入石头');
  inv.select(3);
  assert(inv.selected === 3, '选择槽位');
  inv.cycle(-1);
  assert(inv.selected === 2, '滚轮切换');
  const usedSlots = inv.slots.filter(Boolean).length;
  assert(usedSlots === 3, `堆叠占用槽位 (${usedSlots})`);
  assert(inv.removeItem('dirt', 64) === true, '移除 64 泥土');
  assert(inv.countOf('dirt') === 36, '剩余 36 泥土');
  assert(inv.removeItem('dirt', 100) === false, '移除超量失败');
  assert(inv.countOf('dirt') === 0, '失败移除不破坏数据');
  assert(ITEMS.ferrite_dust.stack === 999, '资源类堆叠上限 999');
  // 放置映射
  assert(ITEMS.dirt.block === B.DIRT && ITEMS.hull.block === B.HULL, '物品→方块映射');
  const idx = inv.findInHotbar('stone');
  assert(idx === -1 || inv.hotbar()[idx].itemId === 'stone', '热键栏查找');
}

// ---------- 任务 ----------
section('quests');
{
  const game = {
    audio: { play() {} },
    ui: { toast() {}, setMissions() {}, setObjective() {} },
    showJourney() {},
  };
  const q = new Quests(game);
  assert(q.currentStep.id === 'checkShip', '初始任务：检查飞船');
  q.onInteractShip();
  assert(q.currentStep.id === 'gather', '检查飞船后进入采集');
  for (let i = 0; i < 15; i++) q.onMine(B.STONE, 'stone', 1);
  assert(q.currentStep.id === 'craftTool', '采集 15 次后进入制作工具');
  for (let i = 0; i < 10; i++) q.onMine(B.DIRT, 'dirt', 1);
  assert(q.currentStep.id === 'craftTool', '无关挖掘不推进工具步骤');
  q.onCraft('metal_plating', 1);
  assert(q.currentStep.id === 'craftTool', '无关合成不推进');
  q.onCraft('multitool', 1);
  assert(q.currentStep.id === 'shelter', '制作工具后进入庇护所');
  for (let i = 0; i < 12; i++) q.onPlace(B.PLANKS);
  assert(q.currentStep.id === 'dihy', '放置 12 方块后进入二氢');
  q.onMine(B.DIHYDROGEN, 'di_hydrogen', 2);
  q.onMine(B.DIHYDROGEN, 'di_hydrogen', 2);
  assert(q.currentStep.id === 'ferrite', '二氢达标进入铁氧体');
  q.onMine(B.FERROCK, 'ferrite_dust', 1);
  q.onMine(B.FERROCK, 'ferrite_dust', 3);
  assert(q.currentStep.id === 'craftPlating', '铁氧体达标进入制作');
  assert(STEP_DEFS.length === 17, '任务链共 17 步');
}

section('quests mission view (渐进显示)');
{
  const game = {
    audio: { play() {} },
    ui: { toast() {}, setMissions() {}, setObjective() {} },
    showJourney() {},
  };
  const q = new Quests(game);
  // 开局：0 完成、当前=检查飞船、仅显示接下来 2 步、其余折叠（不剧透终局）
  let v = q.missionView();
  assert(v.total === 17 && v.doneCount === 0, '开局总步数/完成数');
  assert(v.current.title === '检查坠毁的飞船' && v.current.status === 'current', '当前步骤');
  assert(v.upcoming.length === 2, '仅展示接下来 2 步');
  assert(v.upcoming[0].title === '采集基础资源' && v.upcoming[1].title === '制作多功能工具', '后续 2 步内容');
  assert(v.remaining === 14, '其余 14 步折叠为计数');
  assert(!JSON.stringify(v).includes('跃迁至比邻星系'), '终局目标不在开局面板中（反剧透）');
  // 推进到第 4 步：完成 3 项，折叠行与完成行正确
  q.onInteractShip();
  for (let i = 0; i < 15; i++) q.onMine(B.STONE, 'stone', 1);
  q.onCraft('multitool', 1);
  v = q.missionView();
  assert(v.doneCount === 3, '推进后完成数 3');
  assert(v.current.title === '建造简易庇护所', '当前=庇护所');
  assert(v.upcoming[0].title === '收集二氢晶体 ×3', '后续第 1 步');
  assert(v.remaining === 11, '折叠计数随进度递减');
  // 提前完成后续维修步骤（乱序修复）：不进 upcoming、计入 doneCount
  q.syncShip({ pulseOk: true, glassOk: true, thrusterOk: true });
  v = q.missionView();
  const upcomingTitles = v.upcoming.map((u) => u.title);
  assert(!upcomingTitles.some((t) => t.includes('脉冲引擎') || t.includes('座舱玻璃')), '已提前完成的步骤不再预告');
  assert(v.doneCount >= 5, '乱序完成计入完成数');
  // 终局：完成数 = 总数、无折叠
  for (const s of STEP_DEFS) q.completedIds.add(s.id);
  q.currentIndex = STEP_DEFS.length - 1;
  v = q.missionView();
  assert(v.doneCount === 17 && v.remaining === 0 && v.upcoming.length === 0, '终局视图无折叠');
}

// ---------- 合成 ----------
section('crafting');
{
  const { RECIPES, canCraft, missingOf, craft } = await import('../src/systems/crafting.js');
  const { SHIP_REPAIR_COSTS } = await import('../src/entities/ship.js');
  assert(RECIPES.length >= 6, '配方表非空');
  for (const r of RECIPES) {
    assert(r.out && r.out.item && r.out.count > 0, `配方 ${r.id} 产物有效`);
    for (const itemId of Object.keys(r.in)) {
      assert(r.in[itemId] > 0, `配方 ${r.id} 材料数量有效`);
      assert(ITEMS[itemId], `配方 ${r.id} 材料 ${itemId} 已注册`);
    }
    assert(ITEMS[r.out.item], `配方 ${r.id} 产物 ${r.out.item} 已注册`);
  }
  const inv = new Inventory();
  const plating = RECIPES.find((r) => r.id === 'metal_plating');
  assert(canCraft(inv, plating) === false, '无材料不可合成');
  assert(missingOf(inv, plating).length === 1, '缺口列表');
  assert(craft(inv, plating) === false, '合成失败不产出');
  inv.addItem('ferrite_dust', 3);
  assert(canCraft(inv, plating) === false, '材料不足仍不可合成');
  inv.addItem('ferrite_dust', 1);
  assert(canCraft(inv, plating) === true, '材料齐可合成');
  assert(craft(inv, plating) === true, '合成成功');
  assert(inv.countOf('metal_plating') === 1 && inv.countOf('ferrite_dust') === 0, '材料扣减与产物正确');
  // 二氢凝胶 → 发射燃料 链
  inv.addItem('di_hydrogen', 10);
  const jelly = RECIPES.find((r) => r.id === 'di_hydrogen_jelly');
  assert(craft(inv, jelly) === true, '合成二氢凝胶');
  const fuel = RECIPES.find((r) => r.id === 'launch_fuel');
  assert(canCraft(inv, fuel) === true, '可合成发射燃料（凝胶+镀层）');
  assert(craft(inv, fuel) === true, '合成发射燃料');
  assert(inv.countOf('launch_fuel') === 1, '发射燃料产出');
  // 修复材料表
  assert(SHIP_REPAIR_COSTS.pulse.items.metal_plating === 1, '脉冲引擎需金属镀层');
  assert(SHIP_REPAIR_COSTS.pulse.items.hermetic_seal === 1, '脉冲引擎需密封胶');
  assert(SHIP_REPAIR_COSTS.glass.items.glass === 2, '座舱玻璃需强化玻璃×2');
  assert(SHIP_REPAIR_COSTS.glass.items.metal_plating === 1, '座舱玻璃需金属镀层');
  assert(SHIP_REPAIR_COSTS.thruster.items.launch_fuel === 1, '推进器需发射燃料');
}

section('inventory capacity & no-loss guards');
{
  const { RECIPES, craft, canCraft } = await import('../src/systems/crafting.js');
  const { stationSell, stationBuy, stationDeliver } = await import('../src/systems/station.js');
  // canAdd 容量预检
  const inv = new Inventory();
  assert(inv.canAdd('stone', 64 * 36) === true, '空背包可装 36 组');
  assert(inv.canAdd('stone', 64 * 36 + 1) === false, '超出总容量不可装');
  assert(inv.canAdd('ghost_item', 1) === false, '未注册物品不可装');
  inv.addItem('stone', 60);
  assert(inv.canAdd('stone', 5) === true, '既有堆叠补 4 + 新格 1');
  assert(inv.canAdd('stone', 4 + 64 * 35 + 1) === false, '混合容量上限正确');
  // 满背包合成：材料不被吞
  const inv2 = new Inventory();
  inv2.addItem('ferrite_dust', 8);
  for (let i = 0; i < 36; i++) inv2.addItem('stone', 64); // 塞满
  inv2.addItem('ferrite_dust', 0); // 保证铁氧体仍在
  const plating = RECIPES.find((r) => r.id === 'metal_plating');
  assert(canCraft(inv2, plating) === true, '材料够');
  assert(craft(inv2, plating) === false, '满背包合成被拒绝');
  assert(inv2.countOf('ferrite_dust') === 8, '拒绝后材料原封不动');
  // 满背包购买：信用点不被吞
  const inv3 = new Inventory();
  inv3.addItem('credits', 100);
  for (let i = 0; i < 36; i++) inv3.addItem('stone', 64);
  assert(stationBuy(inv3, 'carbon', 2) === false, '满背包购买被拒绝');
  assert(inv3.countOf('credits') === 100, '拒绝后信用点原封不动');
  assert(inv3.countOf('carbon') === 0, '未收到货物');
  // 第 45 轮：建材与工具升级配方
  const brick = RECIPES.find((r) => r.id === 'stone_brick');
  assert(brick && brick.in.stone === 4 && brick.out.item === 'stone_brick' && brick.out.count === 4, '石砖配方（4 石 → 4 砖）');
  const invBrick = new Inventory();
  invBrick.addItem('stone', 4);
  assert(craft(invBrick, brick) === true && invBrick.countOf('stone_brick') === 4, '石砖可合成');
  const mk2 = RECIPES.find((r) => r.id === 'mining_beam_mk2');
  assert(mk2 && mk2.in.multitool === 1 && mk2.in.copper_ore === 4 && mk2.in.gold_ore === 2 && mk2.in.glass === 1, '采矿光束 MkII 配方');
  const invMk2 = new Inventory();
  invMk2.addItem('multitool', 1); invMk2.addItem('copper_ore', 4); invMk2.addItem('gold_ore', 2); invMk2.addItem('glass', 1);
  assert(craft(invMk2, mk2) === true && invMk2.countOf('mining_beam_mk2') === 1 && invMk2.countOf('multitool') === 0, 'MkII 合成消耗 MkI');
  assert(ITEMS.mining_beam_mk2 && ITEMS.mining_beam_mk2.miningTier === 2, 'MkII 工具等级注册');
  const coil = RECIPES.find((r) => r.id === 'energy_coil');
  assert(coil && coil.in.copper_ore === 3 && coil.in.carbon === 4 && coil.in.gold_ore === 1, '能量线圈配方');
  const invCoil = new Inventory();
  invCoil.addItem('copper_ore', 3); invCoil.addItem('carbon', 4); invCoil.addItem('gold_ore', 1);
  assert(craft(invCoil, coil) === true && invCoil.countOf('energy_coil') === 1, '能量线圈可合成');
  assert(ITEMS.energy_coil && ITEMS.energy_coil.weaponMod === true, '能量线圈武器模块注册');
  const baseRecipe = RECIPES.find((r) => r.id === 'base_unit');
  assert(baseRecipe && baseRecipe.out.item === 'base_unit' && baseRecipe.in.metal_plating === 2 && baseRecipe.in.glass === 1, '基地终端配方');
  const crateRecipe = RECIPES.find((r) => r.id === 'storage_crate');
  assert(crateRecipe && crateRecipe.out.item === 'storage_crate' && crateRecipe.in.planks === 4 && crateRecipe.in.metal_plating === 1, '储物箱配方');
  const invBase = new Inventory(); invBase.addItem('metal_plating', 2); invBase.addItem('glass', 1); invBase.addItem('carbon', 4);
  assert(craft(invBase, baseRecipe) === true && invBase.countOf('base_unit') === 1, '基地终端可合成');
  const invCrate = new Inventory(); invCrate.addItem('planks', 4); invCrate.addItem('metal_plating', 1);
  assert(craft(invCrate, crateRecipe) === true && invCrate.countOf('storage_crate') === 1, '储物箱可合成');
  // 护盾电池配方（生存装备线）
  const cell = RECIPES.find((r) => r.id === 'shield_cell');
  assert(cell && cell.in.sodium === 3 && cell.in.ferrite_dust === 2 && cell.out.count === 1, '护盾电池配方');
  assert(ITEMS.shield_cell && ITEMS.shield_cell.stack === 64, '护盾电池物品注册');
  const invCell = new Inventory();
  invCell.addItem('sodium', 3);
  invCell.addItem('ferrite_dust', 2);
  assert(craft(invCell, cell) === true && invCell.countOf('shield_cell') === 1, '护盾电池可合成');
  assert(invCell.countOf('sodium') === 0 && invCell.countOf('ferrite_dust') === 0, '护盾电池材料扣减');
  // 满背包护盾电池合成被拒（容量预检覆盖新配方）
  const invCell2 = new Inventory();
  invCell2.addItem('sodium', 3);
  invCell2.addItem('ferrite_dust', 2);
  for (let i = 0; i < 36; i++) invCell2.addItem('stone', 64);
  assert(craft(invCell2, cell) === false && invCell2.countOf('sodium') === 3, '满背包护盾电池合成被拒');
  // 全满背包（36 格全满、无信用点堆叠）→ 出售/交付被拒绝，货与材料保留
  const inv4 = new Inventory();
  inv4.addItem('stone', 10);
  for (let i = 0; i < 35; i++) inv4.addItem('dirt', 64);
  inv4.addItem('sand', 64);
  assert(stationSell(inv4, 'stone', 10) === 0, '满背包出售返回 0');
  assert(inv4.countOf('stone') === 10, '出售失败货物保留');
  // 订单交付：奖励放不下 → 材料保留
  const inv5 = new Inventory();
  inv5.addItem('ferrite_dust', 20);
  for (let i = 0; i < 35; i++) inv5.addItem('dirt', 64);
  inv5.addItem('sand', 64);
  assert(stationDeliver(inv5, { id: 'o1', item: 'ferrite_dust', need: 15, reward: 60 }) === false, '满背包订单被拒绝');
  assert(inv5.countOf('ferrite_dust') === 20, '订单材料保留');
}

// ---------- 储物箱（基地仓储纯逻辑） ----------
section('storage');
{
  const { createCrate, crateCanAdd, crateAdd, crateTake, collectCrates, restoreCrates, CRATE_SIZE } = await import('../src/systems/storage.js');
  const c = createCrate('c:1', 1, 2, 3);
  assert(c.slots.length === CRATE_SIZE && CRATE_SIZE === 12, '储物箱 12 格');
  assert(crateCanAdd(c, 'stone', 1) === true, '空箱可存');
  assert(crateAdd(c, 'stone', 10) === 10 && c.slots.some((s) => s && s.itemId === 'stone' && s.count === 10), '存入 10 石头');
  assert(crateAdd(c, 'stone', 60) === 60, '石头可跨格堆叠（64 满格 + 新格）');
  assert(crateTake(c, c.slots.findIndex((s) => s && s.itemId === 'stone'), 20) === 20, '取出 20');
  assert(crateAdd(c, 'carbon', 999) === 999, '999 碳占两格（999 上限只一格? 碳 stack 999，一格装满）');
  const data = collectCrates([c]);
  assert(data[0].slots.length === 12 && data[0].slots.some((s) => s && s.itemId === 'carbon'), '储物箱序列化');
  const restored = restoreCrates(data);
  assert(restored[0].x === 1 && restored[0].slots.some((s) => s && s.itemId === 'carbon'), '储物箱恢复');
  assert(restoreCrates(undefined).length === 0, '老存档无储物箱字段兼容');
}

// ---------- 空间站任务板（纯逻辑） ----------
section('station mission board');
{
  const { MISSION_TEMPLATES, MISSION_COOLDOWN, createMission, missionEvent, missionReady, missionProgressText, missionOffers } = await import('../src/systems/missions.js');
  assert(MISSION_TEMPLATES.length === 6 && MISSION_COOLDOWN === 60, '任务板 6 模板 + 60s 冷却');
  const visit = createMission(MISSION_TEMPLATES.find((t) => t.id === 'visit_mars'));
  assert(missionEvent(visit, 'visit', { target: 'planet:solar.venus' }) === false && visit.progress === 0, '访问错误目标不推进');
  assert(missionEvent(visit, 'visit', { target: 'planet:solar.mars' }) === true && missionReady(visit), '访问火星完成悬赏');
  const hunt = createMission(MISSION_TEMPLATES.find((t) => t.id === 'hunt_brute'));
  assert(missionEvent(hunt, 'kill', { mob: 'swarmling' }) === false, '猎杀错误生物不推进');
  assert(missionEvent(hunt, 'kill', { mob: 'brute', burn: true }) === false && hunt.progress === 0, '白昼自燃死亡不计入猎杀悬赏');
  for (let i = 0; i < 3; i++) missionEvent(hunt, 'kill', { mob: 'brute', burn: false });
  assert(missionReady(hunt) && hunt.progress === 3, '猎杀 3 只夜行兽完成');
  const mine = createMission(MISSION_TEMPLATES.find((t) => t.id === 'mine_blocks'));
  for (let i = 0; i < 40; i++) missionEvent(mine, 'mine', {});
  assert(missionReady(mine), '采矿 40 方块完成');
  const offers = missionOffers(2);
  assert(offers.length === 3 && new Set(offers.map((o) => o.id)).size === 3, '任务板一次提供 3 个不同悬赏');
  assert(missionProgressText(visit) === '1/1', '访问任务进度文本');
}

// ---------- 任务（制作/修复阶段） ----------
section('quests crafting & repair');
{
  const game = {
    audio: { play() {} },
    ui: { toast() {}, setMissions() {}, setObjective() {} },
    showJourney() {},
  };
  const q = new Quests(game);
  // 快速推进到第 7 步（检查飞船→采集→工具→庇护所→二氢→铁氧体）
  q.onInteractShip();
  assert(q.requiredRecipeId() === null, '检查飞船步骤不强制配方');
  for (let i = 0; i < 15; i++) q.onMine(B.STONE, 'stone', 1);
  assert(q.requiredRecipeId() === 'multitool', '制作工具步骤高亮多功能工具');
  q.onCraft('multitool', 1);
  for (let i = 0; i < 12; i++) q.onPlace(B.PLANKS);
  q.onMine(B.DIHYDROGEN, 'di_hydrogen', 2);
  q.onMine(B.DIHYDROGEN, 'di_hydrogen', 2);
  q.onMine(B.FERROCK, 'ferrite_dust', 1);
  q.onMine(B.FERROCK, 'ferrite_dust', 3);
  assert(q.currentStep.id === 'craftPlating', '进入制作金属镀层');
  assert(q.requiredRecipeId() === 'metal_plating', '制作镀层步骤高亮金属镀层');
  q.onCraft('glass', 1);
  assert(q.currentStep.id === 'craftPlating', '无关合成不推进');
  q.onCraft('metal_plating', 1);
  assert(q.currentStep.id === 'craftPlating', '镀层 ×1 未达标');
  q.onCraft('metal_plating', 1);
  assert(q.currentStep.id === 'repairPulse', '镀层 ×2 进入修复脉冲引擎');
  assert(q.requiredRecipeId() === 'hermetic_seal', '修复脉冲步骤高亮密封胶');
  q.onShipRepair('thruster');
  assert(q.currentStep.id === 'repairPulse', '修复推进器不推进当前步');
  q.onShipRepair('pulse');
  assert(q.currentStep.id === 'repairGlass', '修复脉冲引擎进入更换座舱玻璃');
  assert(q.requiredRecipeId() === 'glass', '修复玻璃步骤高亮强化玻璃');
  q.onShipRepair('thruster');
  assert(q.currentStep.id === 'repairGlass', '修复推进器不推进当前步');
  q.onShipRepair('glass');
  assert(q.currentStep.id === 'fuelLaunch', '更换玻璃后进入补充燃料');
  assert(q.requiredRecipeId() === 'launch_fuel', '补充燃料步骤高亮发射燃料');
  q.onShipRepair('thruster');
  assert(q.currentStep.id === 'launch', '补充燃料进入起飞步骤');
  assert(q.getObjective().title === '起飞离开这颗星球', '起飞目标文案');
  q.onLaunch();
  assert(q.currentStep.id === 'space', '起飞进入太空步骤');
  q.onEnterSpace();
  assert(q.currentStep.id === 'explore', '进入太空后进入探索步骤');
  q.onPlanetLand();
  assert(q.currentStep.id === 'stationVisit', '探索后进入造访空间站');
  q.onStationDock();
  assert(q.currentStep.id === 'proximaSignal', '停靠后进入站长对话');
  q.onNpcTalk('vero');
  assert(q.currentStep.id === 'proximaSignal', '与商人对话不推进站长线');
  q.onNpcTalk('kaela');
  assert(q.currentStep.id === 'bigShip', '站长对话后进入购买大船');
  q.onBigShip();
  assert(q.currentStep.id === 'reachProxima', '购船后进入比邻星跃迁');
  q.onReachProxima('solar');
  assert(q.currentStep.id === 'reachProxima', '返回太阳系不完成终点任务');
  q.onReachProxima('proxima');
  assert(q.currentStep.id === 'reachProxima', '最后一步完成后停留在末步');
  assert(q.allDone === true, '全部任务完成标记');
  assert(STEP_DEFS.length === 17, '任务链共 17 步');
}

// ---------- 太阳系生成 ----------
section('galaxy');
{
  const { generateGalaxy, planetNameOf, PLANET_TYPES, SOLAR_SYSTEM } = await import('../src/space/system.js');
  const gal = generateGalaxy('test-seed-42');
  assert(gal.length === 8, '太阳系共 8 颗行星');
  const g2 = generateGalaxy('test-seed-42');
  assert(JSON.stringify(gal) === JSON.stringify(g2), '星系确定性');
  const g3 = generateGalaxy('other-seed');
  assert(JSON.stringify(gal) !== JSON.stringify(g3), '不同种子不同星系');
  const names = gal.map((p) => p.name);
  assert(names[0] === '地球', `母星是地球 (${names[0]})`);
  assert(names.join(',') === SOLAR_SYSTEM.map((s) => s.name).join(','), '行星名为太阳系真实行星');
  for (const p of gal) {
    assert(PLANET_TYPES.some((t) => t.type === p.type), `行星类型有效 (${p.type})`);
    assert(p.radius > 0 && p.radius < 200, '行星半径合理');
    assert(Number.isFinite(p.gx) && Number.isFinite(p.gz), '行星坐标有效');
    assert(p.palette.grassHue >= -90 && p.palette.grassHue <= 120, '草色相范围');
    assert(typeof p.surface === 'string' && p.terrain && typeof p.terrain.base === 'number', `行星地形参数有效 (${p.name})`);
  }
  // 行星差异化：轨道/半径/地形参数互不相同
  const orbits = new Set(gal.map((p) => p.orbit ?? 0));
  const surfaces = new Set(gal.map((p) => p.surface));
  assert(surfaces.size >= 5, `表面类型差异化（${surfaces.size} 种）`);
  assert(planetNameOf('abc') !== planetNameOf('abd'), '行星命名随种子变化');
  // 母星种子 = 游戏种子
  assert(gal[0].seed === 'test-seed-42', '母星种子与游戏种子一致');
  // 土星有环，地球无环
  const saturn = gal.find((p) => p.name === '土星');
  assert(saturn && saturn.ring === true, '土星带环');
  assert(gal[0].ring === false, '地球无环');
  // 比邻星系
  const { generateProximaGalaxy, PROXIMA_SYSTEM } = await import('../src/space/system.js');
  const prox = generateProximaGalaxy('test-seed-42');
  assert(prox.length === 3, '比邻星系共 3 颗行星');
  assert(prox[0].name === '比邻星 b', '比邻星系母星');
  assert(prox[0].seed === 'test-seed-42:proxima', '比邻星系母星种子确定性');
  const prox2 = generateProximaGalaxy('test-seed-42');
  assert(JSON.stringify(prox) === JSON.stringify(prox2), '比邻星系确定性');
  assert(prox.some((p) => p.ring === true), '比邻星 d 带环');
  assert(PROXIMA_SYSTEM.every((d) => d.hazard && d.weather && d.terrain), '比邻星配置完整');
}

// ---------- 统一宇宙数据模型（真实轨道 / 层级 / 投影 / 导航） ----------
section('celestial universe');
{
  const {
    AU, SOLAR_SYSTEM, PROXIMA_SYSTEM, bodyById, bodiesOfSystem, childrenOf, systemLevelNodes,
    systemMeta, logProject, systemOrbitRange, orbitPos, visualRadius, worldOffset, formatDistance,
    STAR_SYSTEMS, homeBodyId, moonSeedOf,
  } = await import('../src/space/celestial.js');

  // 1. 真实轨道顺序与比例：水星→金星→地球→火星→木星→土星→天王星→海王星
  const byName = Object.fromEntries(SOLAR_SYSTEM.map((p) => [p.name, p]));
  const ordered = ['水星', '金星', '地球', '火星', '木星', '土星', '天王星', '海王星'];
  for (let i = 1; i < ordered.length; i++) {
    assert(byName[ordered[i - 1]].aAU < byName[ordered[i]].aAU, `${ordered[i - 1]} 轨道在 ${ordered[i]} 内侧`);
  }
  const ratio = (a, b) => byName[a].aAU / byName[b].aAU;
  assert(Math.abs(ratio('木星', '地球') - 5.2026) < 0.01, '木星距太阳 ≈ 5.20 AU');
  assert(Math.abs(ratio('海王星', '地球') - 30.1104) < 0.01, '海王星距太阳 ≈ 30.11 AU');
  assert(Math.abs(ratio('水星', '地球') - 0.3871) < 0.001, '水星轨道 0.387 AU');
  assert(Math.abs(ratio('土星', '木星') - 9.5549 / 5.2026) < 0.01, '土星/木星轨道比保持真实');
  // 行星物理参数真实：木星最大、地球自转≈24h、土星带环
  assert(byName['木星'].radiusKm > byName['土星'].radiusKm && byName['土星'].radiusKm > byName['地球'].radiusKm, '行星半径量级真实');
  assert(byName['地球'].dayHours === 24 && byName['火星'].dayHours > 24 && byName['火星'].dayHours < 25, '地球/火星自转周期真实');
  assert(byName['金星'].dayHours < 0, '金星逆向自转');
  assert(byName['木星'].gravityG > 20 && byName['地球'].gravityG > 9 && byName['水星'].gravityG < 4, '表面重力真实量级');

  // 2. 统一节点：恒星/行星/卫星/小行星带/空间站/跃迁门都是同一注册表
  const star = bodyById('star:solar');
  const earth = bodyById('planet:solar.earth');
  const moon = bodyById('moon:solar.earth.luna');
  const belt = bodyById('belt:solar.main');
  const station = bodyById('station:solar.earth');
  const gate = bodyById('gateway:solar.proxima');
  assert(star && star.kind === 'star' && earth && earth.kind === 'planet', '恒星/行星记录可解析');
  assert(moon && moon.parentId === 'planet:solar.earth', '月球挂在统一行星父节点下');
  assert(moon.landable === true && moon.surface === 'moon' && moon.gravityG === 1.62, '月球是首个可登陆卫星');
  assert(moon.terrain && moon.terrain.trees === 0 && moon.ores && moon.hazard && moon.palette, '月球世界配置完整');
  assert(moonSeedOf('123', 'moon:solar.earth.luna') === moonSeedOf('123', 'moon:solar.earth.luna')
    && moonSeedOf('123', 'moon:solar.earth.luna') !== moonSeedOf('124', 'moon:solar.earth.luna'), '月球世界种子确定性派生');
  assert(belt && belt.aAU > byName['火星'].aAU && belt.aAU < byName['木星'].aAU, '主小行星带位于火星与木星之间');
  assert(station && station.dockable && !station.landable, '空间站是可停靠节点');
  assert(gate && gate.gateway && gate.targetSystem === 'proxima', '跃迁门指向比邻星系');
  assert(bodiesOfSystem('solar').length >= 8 + 1 + 1 + 1 + 1 + 1, '太阳系注册表含恒星/行星/带/站/门/月球');
  assert(bodiesOfSystem('proxima').length >= 3 + 1 + 1, '比邻星系注册表含恒星/行星/跃迁门');

  // 3. 系统级星图层级：太阳→行星(真实顺序)→小行星带→空间站→跃迁门
  const sysNodes = systemLevelNodes('solar');
  const navs = sysNodes.map((n) => n.navId);
  assert(navs[0] === 'star:solar', '系统图第一节点是太阳');
  assert(navs.indexOf('planet:solar.mercury') < navs.indexOf('planet:solar.venus')
    && navs.indexOf('planet:solar.venus') < navs.indexOf('planet:solar.earth'), '系统图按真实轨道排序');
  const marsI = navs.indexOf('planet:solar.mars');
  const jupI = navs.indexOf('planet:solar.jupiter');
  assert(navs.indexOf('belt:solar.main') > marsI && navs.indexOf('belt:solar.main') < jupI, '小行星带插在火星与木星之间');
  assert(navs.includes('station:solar.earth') && navs.includes('gateway:solar.proxima'), '系统图含空间站与跃迁门');

  // 4. 行星系统层级：地球→月球+空间站；木星→四颗伽利略卫星；土星→6 颗主要卫星
  const earthKids = childrenOf('solar', 'planet:solar.earth').map((k) => k.navId);
  assert(earthKids.includes('moon:solar.earth.luna') && earthKids.includes('station:solar.earth'), '地球系统含月球与空间站');
  const jupKids = childrenOf('solar', 'planet:solar.jupiter');
  assert(jupKids.length >= 4 && jupKids.every((k) => k.kind === 'moon'), '木星系统含 4 颗伽利略卫星');
  assert(jupKids.every((k) => k.landable && k.surface && k.terrain && k.palette), '伽利略卫星全部可登陆且世界配置完整');
  const titan = bodyById('moon:solar.saturn.titan');
  const triton = bodyById('moon:solar.neptune.triton');
  assert(titan.landable && titan.atmoDensity > 1.4 && triton.landable && triton.dayHours < 0, '土卫六（浓密大气）/海卫一（逆行）可登陆');
  const landableCount = bodiesOfSystem('solar').filter((b) => b.kind === 'moon' && b.landable).length;
  assert(landableCount >= 7, `太阳系至少 7 颗可登陆卫星（${landableCount}）`);
  const uranusKids = childrenOf('solar', 'planet:solar.uranus');
  assert(uranusKids.length === 5 && uranusKids.every((k) => k.landable && k.terrain && k.palette), '天王星五卫星全部可登陆');
  assert(landableCount >= 12, `含天王星后至少 12 颗可登陆卫星（${landableCount}）`);
  const satKids = childrenOf('solar', 'planet:solar.saturn');
  assert(satKids.length >= 6, `土星系统含主要卫星（${satKids.length}）`);
  const satOrder = satKids.map((k) => k.aAU);
  assert(satOrder.every((v, i) => i === 0 || v > satOrder[i - 1]), '卫星按真实轨道半径排序');
  assert(childrenOf('proxima', 'planet:proxima.b').length === 0, '无卫星行星不产生空层级');

  // 5. 恒星级星图：太阳系与比邻星两个恒星节点 + 真实距离
  assert(STAR_SYSTEMS.length === 3, '恒星级星图共三个恒星节点（太阳系/比邻星/天狼星）');
  assert(systemMeta('proxima').distanceLy > 4.2 && systemMeta('proxima').distanceLy < 4.3, '比邻星距离 4.2465 光年');
  assert(systemMeta('sirius').distanceLy === 8.6 && homeBodyId('sirius') === 'planet:sirius.b', '天狼星距离 8.6 光年且母星正确');
  const siriusB = bodyById('planet:sirius.b');
  const siriusC = bodyById('planet:sirius.c');
  assert(siriusB && siriusC && siriusB.landable && siriusC.landable, '天狼星系两颗推测行星可登陆');
  assert(bodyById('star:sirius') && bodyById('gateway:solar.sirius') && bodyById('gateway:sirius.solar'), '天狼星与双向跃迁门入册');
  const siriusNodes = systemLevelNodes('sirius');
  assert(siriusNodes[0].navId === 'star:sirius' && siriusNodes.some((n) => n.kind === 'gateway'), '天狼星系系统图含恒星/行星/门');
  assert(homeBodyId('solar') === 'planet:solar.earth' && homeBodyId('proxima') === 'planet:proxima.b', '各星系母星正确');

  // 6. 旅程尺度：1 AU = 1000 单位；行星世界坐标保留真实比例
  assert(orbitPos(byName['地球']).x * orbitPos(byName['地球']).x
    + orbitPos(byName['地球']).z * orbitPos(byName['地球']).z
    >= (AU - 0.001) ** 2 && orbitPos(byName['地球']).x ** 2 + orbitPos(byName['地球']).z ** 2 <= (AU + 0.001) ** 2,
    '地球世界轨道半径 = 1 AU = 1000 单位');
  const nepPos = orbitPos(byName['海王星']);
  assert(Math.abs(Math.hypot(nepPos.x, nepPos.z) - 30110.4) < 1, '海王星世界轨道 ≈ 30.11 AU');
  const sunOff = worldOffset(bodyById('star:solar'), byName['地球']);
  assert(Math.abs(Math.hypot(sunOff.x, sunOff.z) - AU) < 1, '从地球看太阳的导航偏移 = 1 AU');
  // 不同卫星必须落在不同轨道（按兄弟顺序自动分配，而非全部重叠）
  const moonA = worldOffset(bodyById('moon:solar.jupiter.io'), byName['地球']);
  const moonB = worldOffset(bodyById('moon:solar.jupiter.europa'), byName['地球']);
  assert(Math.hypot(moonA.x - moonB.x, moonA.z - moonB.z) > 10, '木卫一/木卫二世界轨道互不重叠');

  // 7. 星图对数投影：近行星可读、外行星不出界、单调保序
  const range = systemOrbitRange('solar');
  const rMerc = logProject(byName['水星'].aAU, range.min, range.max, 30, 190);
  const rVenus = logProject(byName['金星'].aAU, range.min, range.max, 30, 190);
  const rNep = logProject(byName['海王星'].aAU, range.min, range.max, 30, 190);
  assert(rMerc >= 30 && rMerc < rVenus && rVenus < rNep, '投影保持轨道顺序');
  assert(rNep <= 190 && rNep >= 185, `海王星投影贴近外缘（${rNep.toFixed(1)}）`);
  assert(Math.abs(logProject(range.min, range.min, range.max, 30, 190) - 30) < 1e-6
    && Math.abs(logProject(range.max, range.min, range.max, 30, 190) - 190) < 1e-6, '投影端点精确');

  // 8. 视觉半径：木星 > 土星 > 地球 > 月球（立方根压缩保留次序）
  assert(visualRadius(byName['木星']) > visualRadius(byName['土星'])
    && visualRadius(byName['土星']) > visualRadius(byName['地球'])
    && visualRadius(byName['地球']) > visualRadius(moon), '视觉半径次序真实');

  // 9. 距离格式化：行星用 AU、卫星用真实公里
  assert(formatDistance(1000) === '1.00 AU', '1 AU 格式化');
  assert(formatDistance(30110).startsWith('30.1'), '海王星距离格式化');
  const moonKm = formatDistance(moon.aAU * AU);
  assert(moonKm.includes('384') && moonKm.includes('km'), `月球距离格式化（${moonKm}）`);

  // 10. 比邻星系同样具备真实轨道参数
  assert(PROXIMA_SYSTEM.every((d) => d.aAU > 0 && d.radiusKm > 0 && d.gravityG > 0), '比邻星系真实参数完整');

  // 11. 行星本质差异化：真实参数 → 可玩参数（纯函数）
  const { gravityFactor, dayLengthSeconds, sunScaleFor, sunDiscParams, atmoDensityOf, starColorOf, airDragFactor, reentryStrengthOf, reentryDurationOf } = await import('../src/space/celestial.js');
  assert(Math.abs(gravityFactor(byName['地球']) - 1) < 1e-9, '地球重力系数 = 1');
  assert(Math.abs(gravityFactor(byName['水星']) - 3.7 / 9.81) < 0.01, '水星重力系数 ≈ 0.377');
  assert(gravityFactor(byName['木星']) === 2.0, '木星重力夹到可玩上限 2.0');
  assert(gravityFactor(moon) < 0.2, `月球重力系数 ≈ 0.165（${gravityFactor(moon).toFixed(3)}）`);
  assert(dayLengthSeconds(byName['地球']) === 480, '地球昼夜周期保持 480 秒');
  const dJup = dayLengthSeconds(byName['木星']);
  assert(dJup < 360 && dJup > 240, `木星昼夜明显更快（${dJup}）`);
  assert(dayLengthSeconds(byName['水星']) === 1200, '水星超长昼夜被压缩到可玩上限');
  const sMerc = sunScaleFor(byName['水星']);
  const sEarth = sunScaleFor(byName['地球']);
  const sNep = sunScaleFor(byName['海王星']);
  assert(sMerc > sEarth && sEarth > sNep && sNep < 0.25, `太阳视大小随距离递减（${sMerc.toFixed(2)} / ${sEarth.toFixed(2)} / ${sNep.toFixed(2)}）`);
  const disc = sunDiscParams(byName['地球']);
  assert(Math.abs(disc.scale - 1) < 1e-9 && Math.abs(disc.sharp - 220) < 1e-9 && Math.abs(disc.soft - 8) < 1e-9, '地球太阳圆盘参数保持原默认');
  assert(sunDiscParams(byName['海王星']).sharp > sunDiscParams(byName['水星']).sharp, '远处太阳圆盘更小更锐');
  assert(Math.abs(atmoDensityOf(byName['金星']) - 2.3) < 1e-9 && atmoDensityOf(byName['水星']) < 0.3, '大气密度真实差异');
  assert(atmoDensityOf({ gravityG: 9.81 }) === 1, '大气密度缺省 = 地球');
  assert(Math.abs(airDragFactor(byName['地球']) - 1) < 1e-9, '地球大气阻力系数 = 1');
  assert(airDragFactor(byName['金星']) > 1.7 && airDragFactor(moon) === 0.15, '金星浓密大气阻力大 / 月球真空滑翔');
  assert(reentryStrengthOf(byName['金星']) === 1 && reentryStrengthOf(byName['地球']) > 0.5
    && reentryStrengthOf(moon) === 0 && reentryDurationOf(moon) === 0, '再入热障强度随大气密度 / 月球无热障');
  assert(reentryDurationOf(byName['金星']) > reentryDurationOf(byName['地球'])
    && reentryDurationOf(byName['地球']) > reentryDurationOf(byName['火星'])
    && reentryDurationOf(byName['火星']) > 0, '再入热障持续时长：金星 > 地球 > 火星');
  assert(starColorOf('solar') !== starColorOf('proxima'), '太阳系/比邻星恒星光色不同');
}

{
  const { WorldGen, DEFAULT_TERRAIN } = await import('../src/world/chunk.js');
  const { B } = await import('../src/world/blocks.js');
  const earth = new WorldGen('s1', { ...DEFAULT_TERRAIN, surface: 'grass' });
  const mars = new WorldGen('s1', { base: 22, amp: 0.45, mounts: 2.2, caves: 1.0, trees: 0, surface: 'mars' });
  const ice = new WorldGen('s1', { base: 20, amp: 0.55, mounts: 1.8, caves: 1.1, trees: 0, surface: 'ice' });
  // 火星低地红沙
  let redSand = 0, snow = 0, grass = 0;
  for (let x = -50; x <= 50; x += 3) {
    for (let z = -50; z <= 50; z += 3) {
      const h = mars.heightAt(x, z);
      if (mars.surfaceBlock(x, z, h) === B.RED_SAND) redSand++;
      const hi = ice.heightAt(x, z);
      if (ice.surfaceBlock(x, z, hi) === B.SNOW) snow++;
      const he = earth.heightAt(x, z);
      if (earth.surfaceBlock(x, z, he) === B.GRASS) grass++;
    }
  }
  assert(redSand > 300, `火星地表以红沙为主（${redSand}）`);
  assert(snow > 300, `冰巨星地表以雪为主（${snow}）`);
  assert(grass > 200, `地球地表以草地为主（${grass}）`);
  // 月球：全岩石地表 + 环形山高度起伏（不同 x/z 处高度有明显洼陷差异）
  const moonGen = new WorldGen('s1', { base: 18, amp: 0.75, mounts: 1.5, caves: 1.3, trees: 0, surface: 'moon' });
  let moonRock = 0, moonTotal = 0, minH = 99, maxH = -99;
  for (let x = -100; x <= 100; x += 4) {
    for (let z = -100; z <= 100; z += 4) {
      const h = moonGen.heightAt(x, z);
      if (moonGen.surfaceBlock(x, z, h) === B.STONE) moonRock++;
      moonTotal++;
      minH = Math.min(minH, h); maxH = Math.max(maxH, h);
    }
  }
  assert(moonRock === moonTotal, `月面全部为岩石（${moonRock}/${moonTotal}）`);
  assert(maxH - minH >= 8, `月面环形山起伏明显（高差 ${maxH - minH}）`);
  // 地下结构差异化：热行星熔岩囊 / 冰世界晶洞 / 地球无特殊地下结构
  const magmaGen = new WorldGen('s1', { base: 24, amp: 0.6, mounts: 1.9, caves: 1.4, trees: 0, surface: 'barren', underground: 'magma' });
  const magmaChunk = new Chunk(0, 0); magmaChunk.generate(magmaGen);
  const crystalGen = new WorldGen('s1', { base: 20, amp: 0.55, mounts: 1.8, caves: 1.1, trees: 0, surface: 'ice' });
  const crystalChunk = new Chunk(0, 0); crystalChunk.generate(crystalGen);
  const earthGen = new WorldGen('s1', { ...DEFAULT_TERRAIN, surface: 'grass' });
  const earthChunk = new Chunk(0, 0); earthChunk.generate(earthGen);
  let magma = 0, crystals = 0, earthMagma = 0;
  for (let y = 2; y < 30; y++) for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    if (magmaChunk.get(x, y, z) === B.MAGMA) magma++;
    if (crystalChunk.get(x, y, z) === B.DIHYDROGEN) crystals++;
    if (earthChunk.get(x, y, z) === B.MAGMA) earthMagma++;
  }
  assert(magma > 8, `热行星地壳含熔岩囊（${magma} 块）`);
  assert(crystals > 3, `冰世界洞穴含二氢晶簇（${crystals} 块）`);
  assert(earthMagma === 0, '地球地下无熔岩囊');
  // 地形参数确实接入生成：同种子不同参数 → 地形大范围不同；默认参数向后兼容
  const sample = (gen) => {
    const a = [];
    for (let x = -64; x <= 64; x += 4) for (let z = -64; z <= 64; z += 4) a.push(gen.heightAt(x, z));
    return a;
  };
  const a1 = sample(new WorldGen('s1', { base: 22, amp: 0.3, mounts: 0.5, surface: 'mars' }));
  const a2 = sample(new WorldGen('s1', { base: 22, amp: 0.8, mounts: 0.5, surface: 'mars' }));
  const a3 = sample(new WorldGen('s1', { base: 22, amp: 0.3, mounts: 2.6, surface: 'mars' }));
  const diffCount = (x, y) => x.reduce((n, v, i) => n + (v !== y[i] ? 1 : 0), 0);
  assert(diffCount(a1, a2) > a1.length * 0.5, `amp 参数接入生成（${diffCount(a1, a2)}/${a1.length} 处不同）`);
  assert(diffCount(a1, a3) > a1.length * 0.5, `mounts 参数接入生成（${diffCount(a1, a3)}/${a1.length} 处不同）`);
  const def = sample(new WorldGen('s1'));
  const explicit = sample(new WorldGen('s1', { ...DEFAULT_TERRAIN }));
  assert(JSON.stringify(def) === JSON.stringify(explicit), '默认参数=显式默认值（旧种子地形不变）');
}

// ---------- 存档 ----------
section('save');
{
  const { collectSaveData, applySaveData, validateSaveData, importSaveText } = await import('../src/systems/save.js');
  const fake = {
    seed: '777',
    space: { current: 3, galaxyId: 'solar', visitedSolar: new Set([0, 3]), visitedProxima: new Set([0]), targetId: 5 },
    sky: { timeSec: 123.4 },
    planetName: '行星 Test-001 · 未知星系',
    player: {
      pos: { x: 1.5, y: 2.5, z: 3.5 }, yaw: 0.5, pitch: -0.2,
      health: 88, shield: 77, life: 66, hazard: 55,
    },
    inventory: { slots: [null, { itemId: 'stone', count: 9 }], selected: 1 },
    ship: { pulseOk: true, glassOk: false, thrusterOk: false },
    shipUpgrades: { engine: 1, shield: 1 },
    flight: { shield: 80, shieldMax: 150, hull: 66, hullMax: 100 },
    stationOrderCd: { order1: 12, order2: 0 },
    baseWorlds: { '777|solar|3|': { x: 4, y: 20, z: 5 } },
    mission: { id: 'mine_blocks', kind: 'mine', need: 40, reward: 80, label: '矿区采掘：40 方块', desc: '累计挖掘 40 个任意方块', progress: 12 },
    missionCd: 7, missionSeed: 3, baseRestCd: 91,
    crateWorlds: { '777|solar|3|': [{ id: 'crate:4:20:5', x: 4, y: 20, z: 5, slots: [null, { itemId: 'stone', count: 8 }] }] },
    quests: { data: { gather: 5 }, completedIds: new Set(['checkShip']), currentIndex: 2 },
  };
  const d = collectSaveData(fake);
  assert(d.version === 1 && d.seed === '777', '存档元数据');
  assert(d.planetId === 3 && d.targetId === 5, '存档星球状态');
  assert(d.bodyId === null && d.visitedMoons.length === 0, '旧存档兼容：无卫星字段');
  assert(d.galaxyId === 'solar' && d.visitedProxima.length === 1, '存档星系状态');
  assert(d.player.health === 88 && d.player.x === 1.5, '存档玩家状态');
  assert(d.inventory.slots[1].count === 9, '存档背包');
  assert(d.ship.pulseOk === true && d.ship.thrusterOk === false, '存档飞船状态');
  assert(d.ship.glassOk === false, '存档座舱玻璃状态');
  assert(d.shipUpgrades.engine === 1 && d.shipUpgrades.shield === 1, '存档飞船升级');
  assert(d.shipVitals.shield === 80 && d.shipVitals.hull === 66, '存档舰船护盾/船体');
  assert(d.stationOrderCd.order1 === 12, '存档订单冷却');
  assert(d.bases['777|solar|3|'].x === 4, '存档基地');
  assert(d.mission.progress === 12 && d.missionCd === 7 && d.missionSeed === 3, '存档任务板悬赏');
  assert(d.baseRestCd === 91, '存档基地休息冷却');
  assert(d.crates['777|solar|3|'][0].slots[1].count === 8, '存档储物箱');
  assert(d.quests.completed.includes('checkShip'), '存档任务');
  // 恢复
  const fake2 = {
    player: { pos: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, yaw: 0, pitch: 0, health: 100, shield: 100, life: 100, hazard: 100, updateCamera() {} },
    inventory: { slots: [], selected: 0, hotbar() { return this.slots.slice(0, 9); } },
    ship: { repair(k) { this['rep_' + k] = true; return true; } },
    shipUpgrades: { engine: 0, shield: 0 },
    flight: { shield: 100, shieldMax: 100, hull: 100, hullMax: 100 },
    quests: { data: {}, completedIds: new Set(), currentIndex: 0, render() {}, syncShip() {} },
    space: { current: 0, galaxies: { solar: [], proxima: [] }, galaxyId: 'solar', visited: new Set([0]), targetId: -1 },
    sky: { timeSec: 0 },
    ui: { setPlanetInfo() {}, renderHotbar() {} },
  };
  applySaveData(fake2, d);
  assert(fake2.player.pos.x === 1.5 && fake2.player.health === 88, '恢复玩家');
  assert(fake2.inventory.slots[1].count === 9 && fake2.inventory.selected === 1, '恢复背包');
  assert(fake2.ship.rep_pulse === true && fake2.ship.rep_thruster !== true, '恢复飞船（只修复脉冲）');
  assert(fake2.ship.rep_glass !== true, '恢复飞船（座舱玻璃保持损坏）');
  assert(fake2.shipUpgrades.engine === 1 && fake2.shipUpgrades.shield === 1, '恢复飞船升级');
  assert(fake2.flight.shield === 80 && fake2.flight.hull === 66, '恢复舰船护盾/船体');
  assert(fake2.stationOrderCd.order1 === 12, '恢复订单冷却');
  assert(fake2.baseWorlds['777|solar|3|'] && fake2.baseWorlds['777|solar|3|'].x === 4, '恢复基地');
  assert(fake2.mission && fake2.mission.progress === 12 && fake2.missionCd === 7 && fake2.missionSeed === 3, '恢复任务板悬赏');
  assert(fake2.baseRestCd === 91, '恢复基地休息冷却');
  const oldNoRest = { ...d }; delete oldNoRest.baseRestCd;
  const fakeOldRest = { ...fake2 };
  applySaveData(fakeOldRest, oldNoRest);
  assert(fakeOldRest.baseRestCd === 0, '老存档（无基地休息冷却字段）兼容');
  assert(fake2.crateWorlds['777|solar|3|'] && fake2.crateWorlds['777|solar|3|'][0].slots[1].count === 8, '恢复储物箱');
  assert(fake2.quests.completedIds.has('checkShip') && fake2.quests.currentIndex === 2, '恢复任务');
  assert(fake2.space.current === 3 && fake2.space.targetId === 5, '恢复星系状态');
  assert(fake2.sky.timeSec === 123.4, '恢复时间');
  // 异常点收集状态存档往返 + 老存档兼容（无 anomalies 字段 → 空集）
  assert(Array.isArray(d.anomalies) && d.anomalies.length === 0, '空异常状态正常序列化');
  assert(fake2.collectedAnomalies instanceof Set && fake2.collectedAnomalies.size === 0, '恢复异常状态为空集');
  const old = { ...d }; delete old.anomalies;
  const fake3 = { ...fake2, collectedAnomalies: undefined, anomalies: { setCollected() {} } };
  applySaveData(fake3, old);
  assert(fake3.collectedAnomalies instanceof Set && fake3.collectedAnomalies.size === 0, '老存档（无 anomalies 字段）兼容');
  // 存档导出/导入校验（纯逻辑）
  assert(validateSaveData(d) === true, '合法存档结构校验通过');
  assert(validateSaveData({ version: 1, seed: 'abc' }) === false, '非数字种子被拒');
  assert(validateSaveData({ version: 2, seed: '123' }) === false, '未知版本被拒');
  assert(validateSaveData(null) === false && validateSaveData({}) === false, '空存档被拒');
  assert(importSaveText('this is definitely not a json file').ok === false && importSaveText('this is definitely not a json file').reason === 'parse', '非法 JSON 导入被拒');
  assert(importSaveText(JSON.stringify({ version: 1, seed: 'abc' })).ok === false && importSaveText(JSON.stringify({ version: 1, seed: 'abc' })).reason === 'invalid', '结构非法导入被拒');
  assert(importSaveText('').ok === false && importSaveText(null).ok === false, '空文本导入被拒');
  // 多功能工具配方
  const { RECIPES } = await import('../src/systems/crafting.js');
  assert(RECIPES.some((r) => r.id === 'multitool'), '多功能工具配方存在');
  assert(ITEMS.multitool && ITEMS.multitool.tool === true, '多功能工具物品注册');
}

// ---------- 里程碑 ----------
section('milestones');
{
  const { Milestones, MILESTONES } = await import('../src/systems/milestones.js');
  const earned = [];
  const game = { audio: { play() {} }, ui: { toast(t) { earned.push(t); } } };
  const ms = new Milestones(game);
  assert(ms.total === 23 && ms.earnedCount === 0, '初始无里程碑');
  ms.bump('mine', 1);
  assert(ms.earned.has('first_mine') && earned.length === 1 && earned[0].includes('第一次挖掘'), '首次挖掘里程碑');
  // 里程碑奖励：带背包的游戏会直接收到信用点，并推进 merchant 统计
  const rewardGame = {
    inventory: new Inventory(),
    audio: { play() {} },
    ui: { toast() {}, renderHotbar() {} },
  };
  const msReward = new Milestones(rewardGame);
  msReward.bump('launch', 1); // first_flight = +100 信用点
  assert(rewardGame.inventory.countOf('credits') === 140 && msReward.data.creditsEarned === 140, '里程碑奖励信用点并入账统计（含 merchant 连锁奖励）');
  assert(msReward.earned.has('merchant'), '奖励信用点可推进太空商人里程碑');
  assert(rewardGame.inventory.countOf('credits') === 140, 'merchant 里程碑自身奖励也入账（100+40）');
  // P1-2 回归：信用点满/背包无空位时奖励进入 pending，空出格子后 flush 补发，并随存档往返
  const fullInv = new Inventory();
  for (let i = 0; i < fullInv.slots.length; i++) fullInv.slots[i] = { itemId: 'stone', count: 64 };
  fullInv.slots[0] = { itemId: 'credits', count: 999 }; // 仍无空位且信用点堆满
  const pendingToasts = [];
  const pendingGame = {
    inventory: fullInv,
    audio: { play() {} },
    ui: { toast(t) { pendingToasts.push(t); }, renderHotbar() {} },
  };
  const msPending = new Milestones(pendingGame);
  msPending.earned.add('merchant'); // 隔离本用例：避免补发时连锁触发 merchant 奖励
  msPending.bump('space', 1); // astronaut = +150，此时放不下
  assert(msPending.earned.has('astronaut') && msPending.pending.includes('astronaut'), '背包满时里程碑点亮且奖励进入 pending');
  assert(fullInv.countOf('credits') === 999, '暂缓期间信用点未入账');
  assert(pendingToasts.some((t) => t.includes('有空位时自动补发')), '暂缓文案告知自动补发');
  const pendingSave = msPending.collect();
  assert(pendingSave.pending && pendingSave.pending.includes('astronaut'), 'pending 奖励写入存档');
  const msPendingRestore = new Milestones(pendingGame);
  msPendingRestore.apply(pendingSave);
  assert(msPendingRestore.pending.includes('astronaut') && msPendingRestore.earned.has('astronaut'), 'pending 奖励随存档恢复');
  fullInv.slots[1] = null;
  const flushed = msPending.flushPendingRewards();
  assert(flushed === 150 && fullInv.countOf('credits') === 1149 && msPending.pending.length === 0, '空出格子后自动补发暂缓奖励');
  assert(pendingToasts.some((t) => t.includes('里程碑奖励补发')), '补发时有明确 toast');
  ms.bump('mine', 1);
  assert(earned.length === 1, '里程碑不重复触发');
  ms.bump('mine', 98);
  assert(ms.earned.has('miner_100') && ms.earnedCount === 2, '累计 100 挖掘');
  ms.bump('nope', 1);
  assert(!('nope' in ms.data), '未知统计不记录');
  const d = ms.collect();
  const ms2 = new Milestones(game);
  ms2.apply(d);
  assert(ms2.earnedCount === 2 && ms2.data.mine === 100, '里程碑存档恢复');
  ms2.apply(undefined);
  assert(ms2.earnedCount === 2, 'undefined 存档不动');
  const ms3 = new Milestones(game);
  ms3.apply(undefined);
  assert(ms3.earnedCount === 0 && ms3.data.mine === 0, '老存档兼容（无 milestones 字段）');
  const ms4 = new Milestones(game);
  ms4.bump('kill', 10);
  assert(ms4.earned.has('first_kill') && ms4.earned.has('hunter_10'), '一次达标点亮多档');
  ms4.bump('beltHarvest', 5);
  assert(ms4.earned.has('belt_miner') && ms4.earnedCount === 3, '小行星矿工里程碑（开采 5 次）');
  ms4.bump('toolTier2', 1);
  assert(ms4.earned.has('mining_expert') && ms4.earnedCount === 4, '矿脉切割者里程碑（获得 MkII）');
  ms4.bump('weaponMod', 1);
  assert(ms4.earned.has('weapon_smith') && ms4.earnedCount === 5, '能量武器匠里程碑（安装能量线圈）');
  ms4.bump('base', 1);
  assert(ms4.earned.has('home_owner') && ms4.earnedCount === 6, '安家落户里程碑（建立基地终端）');
  ms4.bump('pirateKill', 1);
  assert(ms4.earned.has('space_ace') && ms4.earnedCount === 7, '深空王牌里程碑（击落海盗）');
  // 全成就达成：最终提示
  const toasts2 = [];
  const game2 = { audio: { play() {} }, ui: { toast(t) { toasts2.push(t); } } };
  const ms5 = new Milestones(game2);
  for (const m of MILESTONES) ms5.earned.add(m.id);
  ms5.earn(MILESTONES[MILESTONES.length - 1]);
  assert(ms5.allEarned === true && toasts2.length === 1 && toasts2[0].includes('全成就达成'), '全成就最终提示');
  assert(MILESTONES.every((m) => m.id && m.name && m.stat), '里程碑定义完整');
}

// ---------- 设置 ----------
section('settings');
{
  const { normalizeSettings, DEFAULT_SETTINGS } = await import('../src/core/settings.js');
  const d = normalizeSettings(null);
  assert(d.fov === 75 && d.renderDist === 6 && d.graphics === 'high' && d.sens === 1 && d.creative === false, '默认设置');
  const s = normalizeSettings({ fov: 100, renderDist: 4, graphics: 'low', sens: 1.5, creative: true, junk: 1 });
  assert(s.fov === 100 && s.renderDist === 4 && s.graphics === 'low' && s.sens === 1.5 && s.creative === true, '合法设置归一化');
  assert(!('junk' in s), '未知字段被丢弃');
  const bad = normalizeSettings({ fov: 999, renderDist: 0, graphics: 'ultra', sens: 99 });
  assert(bad.fov === DEFAULT_SETTINGS.fov && bad.renderDist === DEFAULT_SETTINGS.renderDist
    && bad.graphics === DEFAULT_SETTINGS.graphics && bad.sens === DEFAULT_SETTINGS.sens, '非法值回落默认');
  // 音量设置（音乐/音效分轨）
  const vol = normalizeSettings({ musicVol: 0.35, sfxVol: 0.9 });
  assert(vol.musicVol === 0.35 && vol.sfxVol === 0.9, '音量合法值');
  assert(normalizeSettings(null).musicVol === 0.6 && normalizeSettings(null).sfxVol === 0.8, '默认音量');
  assert(normalizeSettings({ musicVol: 5, sfxVol: -1 }).musicVol === 0.6 && normalizeSettings({ musicVol: 5, sfxVol: -1 }).sfxVol === 0.8, '非法音量回落默认');
  const oldCfg = normalizeSettings({ fov: 90 }); // 旧配置无音量字段 → 默认填充
  assert(oldCfg.musicVol === 0.6 && oldCfg.sfxVol === 0.8, '旧配置兼容（音量字段默认填充）');
}

// ---------- 背包整理 ----------
section('inventory sort');
{
  const inv = new Inventory();
  inv.addItem('stone', 10);
  inv.addItem('carbon', 3);
  inv.addItem('sodium', 2);
  inv.addItem('ferrite_dust', 4);
  // 让背包区有物品与空位交错
  inv.slots[9] = { itemId: 'stone', count: 10 };
  inv.slots[10] = null;
  inv.slots[11] = { itemId: 'carbon', count: 3 };
  inv.slots[12] = { itemId: 'sodium', count: 2 };
  inv.slots[13] = null;
  inv.slots[14] = { itemId: 'ferrite_dust', count: 4 };
  const hotbarBefore = inv.hotbar().map((s) => (s ? s.itemId : null));
  inv.select(0);
  inv.sortPack();
  const packIds = inv.slots.slice(9).filter(Boolean).map((s) => s.itemId);
  const names = packIds.map((id) => ITEMS[id].name);
  assert(JSON.stringify(hotbarBefore) === JSON.stringify(inv.hotbar().map((s) => (s ? s.itemId : null))), '整理不动快捷栏');
  assert(inv.selected === 0, '选中格不变');
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'zh'));
  assert(JSON.stringify(names) === JSON.stringify(sorted), '背包区按名称排序');
  const firstNull = inv.slots.slice(9).findIndex((s) => s === null);
  const hasItemAfterNull = inv.slots.slice(9 + firstNull).some((s) => s !== null);
  assert(firstNull >= 4 && !hasItemAfterNull, '空位全部沉底');
  const total = inv.countOf('stone') + inv.countOf('carbon') + inv.countOf('sodium') + inv.countOf('ferrite_dust');
  assert(total === 38, '整理后数量不变（快捷栏 19 + 背包区 19）');
}

// ---------- 任务与飞船真实状态同步 ----------
section('quests ship sync');
{
  const game = {
    audio: { play() {} },
    ui: { toast() {}, setMissions() {}, setObjective() {} },
    showJourney() {},
  };
  // 乱序修复：任务还在 gather，飞船已全部修好 → 维修步骤标记完成，独立步骤不被打乱
  const q = new Quests(game);
  const ship = {
    pulseOk: false, glassOk: false, thrusterOk: false,
    get allRepaired() { return this.pulseOk && this.glassOk && this.thrusterOk; },
  };
  q.onInteractShip();
  assert(q.currentStep.id === 'gather', '初始推进到采集');
  q.syncShip(ship);
  assert(q.currentStep.id === 'gather', '未修复时不同步推进');
  ship.pulseOk = true; ship.glassOk = true; ship.thrusterOk = true;
  q.syncShip(ship);
  assert(q.data.repairPulse === 1 && q.data.repairGlass === 1 && q.data.fuelLaunch === 1, '全修好→维修任务数据完成');
  assert(q.completedIds.has('repairPulse') && q.completedIds.has('repairGlass') && q.completedIds.has('fuelLaunch'),
    '维修步骤在任务列表中标记完成');
  assert(q.currentStep.id === 'gather', '当前独立步骤（采集）不被跳过');
  // 顺流程推进：到维修阶段自动跳过已完成的维修步骤
  for (let i = 0; i < 15; i++) q.onMine(B.STONE, 'stone', 1);
  q.onCraft('multitool', 1);
  for (let i = 0; i < 12; i++) q.onPlace(B.PLANKS);
  q.onMine(B.DIHYDROGEN, 'di_hydrogen', 2);
  q.onMine(B.DIHYDROGEN, 'di_hydrogen', 2);
  q.onMine(B.FERROCK, 'ferrite_dust', 1);
  q.onMine(B.FERROCK, 'ferrite_dust', 3);
  q.onCraft('metal_plating', 1);
  q.onCraft('metal_plating', 1);
  assert(q.currentStep.id === 'launch', '维修步骤完成后直接同步到起飞');

  // 停在 repairPulse 且飞船已全修好 → 同步推进到起飞
  const q2 = new Quests(game);
  q2.currentIndex = STEP_DEFS.findIndex((s) => s.id === 'repairPulse');
  q2.syncShip({ pulseOk: true, glassOk: true, thrusterOk: true, allRepaired: true });
  assert(q2.currentStep.id === 'launch', '停在维修步骤时全修好→同步到起飞');

  // 部分修复：只修脉冲 → 推进到更换座舱玻璃
  const q3 = new Quests(game);
  q3.currentIndex = STEP_DEFS.findIndex((s) => s.id === 'repairPulse');
  q3.syncShip({ pulseOk: true, glassOk: false, thrusterOk: false, allRepaired: false });
  assert(q3.currentStep.id === 'repairGlass', '部分修复→只推进对应步骤');
}

// ---------- 行星环境危险与资源差异化 ----------
section('planet environment & resources');
{
  const { environmentDrain } = await import('../src/core/constants.js');
  assert(environmentDrain(null, 0.5) === 0, '无危险配置不消耗');
  assert(environmentDrain({ kind: 'none', drain: 5, when: 'always' }, 0.5) === 0, 'none 不消耗');
  const toxic = { kind: 'toxic', drain: 2, when: 'always' };
  assert(environmentDrain(toxic, 0.2) === 2 && environmentDrain(toxic, 0.9) === 2, '剧毒全天消耗');
  const hot = { kind: 'hot', drain: 2.6, when: 'day' };
  assert(environmentDrain(hot, 0.1) === 2.6 && environmentDrain(hot, 0.9) === 0, '高温仅白天消耗');
  const cold = { kind: 'cold', drain: 1.2, when: 'night' };
  assert(environmentDrain(cold, 0.9) === 1.2 && environmentDrain(cold, 0.2) === 0, '严寒仅夜晚消耗');
  assert(environmentDrain(toxic, 0.5, 2.5) === 5, '风暴倍率放大消耗');
  assert(environmentDrain(toxic, 0.5, 0) === 0, '风暴倍率 0 不消耗');

  // 资源倍率：火星铁氧体富集、金星金矿富集、海王星二氢晶体富集
  const { WorldGen, Chunk } = await import('../src/world/chunk.js');
  const { B } = await import('../src/world/blocks.js');
  const countBlock = (profile, id) => {
    const gen = new WorldGen('ore-test-seed', profile);
    let n = 0;
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const c = new Chunk(cx, cz);
        c.generate(gen);
        for (const v of c.data) if (v === id) n++;
      }
    }
    return n;
  };
  const earthOres = { surface: 'grass', ores: { coal: 1, ferrock: 1, copper: 1, gold: 1 } };
  const marsOres = { surface: 'mars', ores: { coal: 0.8, ferrock: 2.6, copper: 1.8, gold: 0.9 } };
  const earthFerrock = countBlock(earthOres, B.FERROCK);
  const marsFerrock = countBlock(marsOres, B.FERROCK);
  assert(marsFerrock > earthFerrock * 1.8, `火星铁氧体富集（火星 ${marsFerrock} vs 地球 ${earthFerrock}）`);
  const venusOres = { surface: 'toxic', ores: { coal: 1.2, ferrock: 1.2, copper: 1.6, gold: 2.2 } };
  const earthGold = countBlock(earthOres, B.GOLD_ORE);
  const venusGold = countBlock(venusOres, B.GOLD_ORE);
  assert(venusGold > earthGold * 1.5, `金星金矿富集（金星 ${venusGold} vs 地球 ${earthGold}）`);
  const iceProfile = { surface: 'ice', plants: { sodium: 1, oxygen: 2.5, dihydrogen: 3, carbon: 1 } };
  const earthPlants = { surface: 'grass', plants: { sodium: 1, oxygen: 1, dihydrogen: 1, carbon: 1 } };
  const earthDihy = countBlock(earthPlants, B.DIHYDROGEN);
  const iceDihy = countBlock(iceProfile, B.DIHYDROGEN);
  assert(iceDihy > earthDihy * 1.8, `冰巨星二氢晶体富集（冰星 ${iceDihy} vs 地球 ${earthDihy}）`);
}

// ---------- 空间站经济 ----------
section('station economy');
{
  const { STATION_SELL, STATION_BUY, STATION_ORDERS, ORDER_COOLDOWN, SHIP_UPGRADES, stationSell, stationBuy, stationDeliver, stationUpgrade, sellPriceOf, buyPriceOf } = await import('../src/systems/station.js');
  // 价格表注册完整性：所有键必须是已注册物品（历史 bug：coal_carbon 幽灵条目在交易 UI 中裸显 ID）
  for (const key of Object.keys(STATION_SELL)) assert(ITEMS[key], `出售表条目 ${key} 已注册`);
  for (const key of Object.keys(STATION_BUY)) assert(ITEMS[key], `购买表条目 ${key} 已注册`);
  for (const o of STATION_ORDERS) assert(ITEMS[o.item], `订单条目 ${o.item} 已注册`);
  const inv = new Inventory();
  // 出售
  inv.addItem('ferrite_dust', 10);
  const got = stationSell(inv, 'ferrite_dust', 4);
  assert(got === 12 && inv.countOf('ferrite_dust') === 6, `出售 4 铁氧体得 12 信用点（实际 ${got}）`);
  assert(inv.countOf('credits') === 12, '信用点入账');
  inv.addItem('stone', 5);
  assert(stationSell(inv, 'stone', 1) === 1 && inv.countOf('credits') === 13, '低价值资源可售');
  // 购买
  assert(stationBuy(inv, 'metal_plating', 1) === false, '信用点不足购买失败');
  inv.addItem('credits', 100);
  assert(stationBuy(inv, 'metal_plating', 2) === true && inv.countOf('metal_plating') === 2, '购买成功并扣款');
  // 订单：纯函数交付 + 冷却常量（冷却状态由 Game 层管理）
  assert(ORDER_COOLDOWN === 45, '订单冷却 45 秒');
  const order = STATION_ORDERS[0];
  inv.addItem('ferrite_dust', 15);
  const before = inv.countOf('credits');
  assert(stationDeliver(inv, order) === true, '订单交付成功');
  assert(inv.countOf('credits') === before + order.reward && inv.countOf('ferrite_dust') === 21 - 15, '订单扣料发奖');
  assert(stationDeliver(inv, order) === false, '材料不足交付失败');
  // 第 47 轮经济节奏：主线必需飞船升级合计 1400（引擎1+2、护盾1、大船）
  const required = SHIP_UPGRADES.filter((u) => ['engine1','engine2','shield1','bigship'].includes(u.id))
    .reduce((n, u) => n + u.cost, 0);
  assert(required === 1400, `大船线节奏重平衡为 1400（实际 ${required}）`);
  // 升级
  const upgrades = { engine: 0, shield: 0 };
  inv.addItem('credits', 1000);
  assert(stationUpgrade(inv, upgrades, 'engine1').ok === true && upgrades.engine === 1, '引擎升级 Lv1');
  assert(stationUpgrade(inv, upgrades, 'engine1').ok === false, '重复购买被拒绝');
  assert(stationUpgrade(inv, upgrades, 'shield2').ok === false, '跳级购买被拒绝（需先 Lv1）');
  assert(stationUpgrade(inv, upgrades, 'shield1').ok === true && upgrades.shield === 1, '护盾升级 Lv1');
  // 大船：需前置升级
  assert(stationUpgrade(inv, upgrades, 'bigship').ok === false && stationUpgrade(inv, upgrades, 'bigship').reason === 'need',
    '大船需要引擎 Lv2 前置');
  upgrades.engine = 2;
  inv.addItem('credits', 1000);
  assert(stationUpgrade(inv, upgrades, 'bigship').ok === true && upgrades.bigship === 1, '前置满足后购买大船');
  // 数据完整性
  for (const [id, price] of Object.entries(STATION_BUY)) {
    assert(ITEMS[id] !== undefined && price > 0, `买入表物品已注册 (${id})`);
  }
  assert(sellPriceOf('gold_ore') === 10 && buyPriceOf('launch_fuel') === 25, '价格表');
}

// ---------- NPC 与世界观数据 ----------
section('npcs & lore');
{
  const { STATION_NPCS, CRASH_LOGS, logById, npcById, getNpcLines } = await import('../src/systems/npcs.js');
  assert(STATION_NPCS.length === 3, '空间站共 3 名 NPC');
  const ids = new Set();
  for (const n of STATION_NPCS) {
    assert(n.id && n.name && n.role && n.lines.length >= 3, `NPC 数据完整 (${n.name})`);
    ids.add(n.id);
    for (const line of n.lines) assert(line.length > 8, `NPC 对话非空 (${n.name})`);
  }
  assert(ids.size === 3, 'NPC id 唯一');
  // 状态感知对话：台词随进度追加
  const kaela = npcById('kaela'), tessa = npcById('tessa'), vero = npcById('vero');
  assert(getNpcLines(kaela, {}).length === kaela.lines.length, '无进度时无追加台词');
  assert(getNpcLines(kaela, { bigship: true }).some((l) => l.includes('曙光号已经出坞')), '买大船后站长台词更新');
  assert(getNpcLines(kaela, { reachedProxima: true }).some((l) => l.includes('你回来了')), '到过比邻星后站长台词更新');
  assert(getNpcLines(kaela, { bigship: true, reachedProxima: true }).some((l) => l.includes('你回来了')), '双条件时以比邻星台词优先');
  assert(getNpcLines(tessa, { bigship: true }).some((l) => l.includes('曙光号交给你了')), '买大船后技师台词更新（不再说"蓝图封存"）');
  assert(getNpcLines(tessa, { engine: 2 }).some((l) => l.includes('引擎已经升满')), '引擎满级技师台词');
  assert(getNpcLines(vero, { bigship: true }).some((l) => l.includes('跨星系运货')), '买大船后商人台词更新');
  assert(CRASH_LOGS.length === 3, '坠机点共 3 篇日志');
  const logIds = new Set();
  for (const l of CRASH_LOGS) {
    assert(l.id && l.title && l.text.length > 20, `日志内容完整 (${l.title})`);
    logIds.add(l.id);
  }
  assert(logIds.size === 3, '日志 id 唯一');
  assert(logById('log2').title.includes('船长'), '日志查询');
  assert(npcById('tessa') && npcById('nobody') === null, 'NPC 查询');
}

console.log('');
console.log(`结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
