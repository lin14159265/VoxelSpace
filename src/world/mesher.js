// 区块网格化：剔除隐藏面 + 顶点 AO + 面光照烘焙进顶点色 + 植物十字面
// 纯几何构建（THREE.BufferGeometry），可在 Node 中测试。
import * as THREE from 'three';
import { CHUNK, HEIGHT } from '../core/constants.js';
import { B, def as blockDef, isSolid, isOpaque, isPlant } from './blocks.js';
import { TILE, ROTATIONS } from './tiles.js';
import { tileUVs } from './textures.js';
import { hash2 } from './noise.js';

// 6 个面：顶点（相对方块原点，逆时针朝外）、法线、光照系数
const FACES = [
  { // +X
    dir: [1, 0, 0], shade: 0.8,
    verts: [[1, 1, 0], [1, 1, 1], [1, 0, 1], [1, 0, 0]],
  },
  { // -X
    dir: [-1, 0, 0], shade: 0.8,
    verts: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  },
  { // +Y
    dir: [0, 1, 0], shade: 1.0,
    verts: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  },
  { // -Y
    dir: [0, -1, 0], shade: 0.68,
    verts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  },
  { // +Z
    dir: [0, 0, 1], shade: 0.74,
    verts: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  },
  { // -Z
    dir: [0, 0, -1], shade: 0.74,
    verts: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  },
];

// AO 亮度等级（柔和化，避免纯黑阴影面）
const AO_LEVEL = [1.0, 0.88, 0.78, 0.68];

// 每面 4 角对应的两条切向偏移（用于 AO 采样）
const TANGENTS = {
  // 面索引 → [u, w]（u,w 为面内两个切向轴）
  0: [[0, 1, 0], [0, 0, 1]],  // +X
  1: [[0, 1, 0], [0, 0, 1]],  // -X
  2: [[1, 0, 0], [0, 0, 1]],  // +Y
  3: [[1, 0, 0], [0, 0, 1]],  // -Y
  4: [[1, 0, 0], [0, 1, 0]],  // +Z
  5: [[1, 0, 0], [0, 1, 0]],  // -Z
};

export function buildChunkGeometry(world, chunk) {
  // 每个四边形 4 顶点 + 6 索引（非索引几何会把相邻四边形的顶点拼成跨面三角形！）
  const opaque = { pos: [], norm: [], uv: [], col: [], idx: [] };
  const cutout = { pos: [], norm: [], uv: [], col: [], idx: [] };
  const fluid = { pos: [], norm: [], uv: [], col: [], idx: [] };
  const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
  const blockIdAt = (x, y, z) => world.getBlock(x, y, z);
  const uv = [0, 0, 0, 0];

  // 本地快速查询：区块内直读数组，跨界才走 world
  const blockAt = (lx, ly, lz) => {
    if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK) return blockIdAt(x0 + lx, ly, z0 + lz);
    return chunk.get(lx, ly, lz);
  };
  const solidAt = (lx, ly, lz) => {
    if (ly < 0) return true;
    if (ly >= HEIGHT) return false;
    return isSolid(blockAt(lx, ly, lz));
  };

  for (let lx = 0; lx < CHUNK; lx++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let y = 0; y < HEIGHT; y++) {
        const id = chunk.get(lx, y, lz);
        if (id === B.AIR) continue;
        const wx = x0 + lx, wz = z0 + lz;

        if (id === B.WATER) {
          pushWater(fluid, lx, y, lz, blockAt, wx, wz, uv);
          continue;
        }

        if (isPlant(id)) {
          pushPlant(cutout, wx, y, wz, id, uv);
          continue;
        }

        const def = blockDef(id);
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nb = blockAt(lx + face.dir[0], y + face.dir[1], lz + face.dir[2]);
          // 邻居遮挡：不透明方块互相剔除；玻璃/植物不遮挡
          if (isOpaque(id) && isOpaque(nb) && !isPlant(nb)) continue;

          const [u, w] = TANGENTS[f];
          // 光照与 AO
          const brightness = new Array(4);
          for (let c = 0; c < 4; c++) {
            const [vx, vy, vz] = face.verts[c];
            const s1 = solidAt(lx + vx + face.dir[0] + u[0], y + vy + face.dir[1] + u[1], lz + vz + face.dir[2] + u[2]);
            const s2 = solidAt(lx + vx + face.dir[0] + w[0], y + vy + face.dir[1] + w[1], lz + vz + face.dir[2] + w[2]);
            const sc = solidAt(lx + vx + face.dir[0] + u[0] + w[0], y + vy + face.dir[1] + u[1] + w[1], lz + vz + face.dir[2] + u[2] + w[2]);
            let occ = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (sc ? 1 : 0);
            if (s1 && s2) occ = 3;
            brightness[c] = face.shade * AO_LEVEL[occ];
          }

          // 纹理选择 + 材质变体：同种方块按世界位置在变体池中确定性选择
          const tile = pickTileVariant(def, f, wx, y, wz);
          const isCutout = def.opacity === 'cutout';
          const target = isCutout ? cutout : opaque;
          const nrm = face.dir;
          // 逐面微差：同一材质不再整面同亮度，大面积地表/岩壁有自然的块状明暗
          const faceVar = 0.93 + hash2(wx + f * 61, y * 3 + wz * 57 + f * 131, 17) * 0.07;
          tileUVs(tile, uv);
          // 注意 tileUVs 约定：[u0, vTop, u1, vBottom]（图集第 0 行在画布顶部，对应 v 较大）
          const u0 = uv[0], vTop = uv[1], u1 = uv[2], vBottom = uv[3];

          // 侧面纹理必须保持"竖直"：世界 y 高的顶点永远取瓦片顶部 v，仅允许水平镜像。
          // 历史 bug：4 向随机旋转（90°/180°/270°）会把草皮条带/树干纹路
          // 翻到侧面或底部——草方块顶部绿草约 1/5 会随机出现在侧边/底部。
          const isSide = f !== 2 && f !== 3;
          const mirror = isSide ? (hash2(wx, y + wz * 57 + f * 131, 1) < 0.5 ? 1 : 0) : 0;

          for (let c = 0; c < 4; c++) {
            const [vx, vy, vz] = face.verts[c];
            target.pos.push(wx + vx, y + vy, wz + vz);
            target.norm.push(nrm[0], nrm[1], nrm[2]);
            if (isSide) {
              // 角 0/3 取 u0、角 1/2 取 u1；镜像时互换；v 严格跟随世界 y（顶角 vTop/底角 vBottom）
              const base = (c === 0 || c === 3) ? 0 : 1;
              const uu = ((base ^ mirror) ? u1 : u0);
              const vv = vy === 1 ? vTop : vBottom;
              target.uv.push(uu, vv);
            } else {
              // 顶/底面纹理各向同性，允许 4 向随机旋转增加变化
              const r = ROTATIONS[hash2(wx, y + wz * 57 + f * 131, 3) * 4 | 0];
              const uu = r[c * 2];
              const vv = r[c * 2 + 1];
              target.uv.push(u0 + uu * (u1 - u0), vTop + vv * (vBottom - vTop));
            }
            target.col.push(brightness[c] * faceVar, brightness[c] * faceVar, brightness[c] * faceVar);
          }
          // 四边形 → 2 个三角形（保持 CCW 朝向）
          const b = target.pos.length / 3 - 4;
          target.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
      }
    }
  }
  return { opaque, cutout, fluid };
}

// 水体：只渲染暴露在空气/植物旁的表面；与水相邻的面互相剔除。
// 顶点色沿用方向光照，保留湖面明暗；材质层负责透明。
function pushWater(buf, lx, y, lz, blockAt, wx, wz, uv) {
  tileUVs(TILE.WATER, uv);
  const u0 = uv[0], v0 = uv[1], u1 = uv[2], v1 = uv[3];
  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    const nb = blockAt(lx + face.dir[0], y + face.dir[1], lz + face.dir[2]);
    if (nb === B.WATER) continue;
    if (isOpaque(nb) && !isPlant(nb)) continue;
    for (let c = 0; c < 4; c++) {
      const [vx, vy, vz] = face.verts[c];
      buf.pos.push(wx + vx, y + vy, wz + vz);
      buf.norm.push(face.dir[0], face.dir[1], face.dir[2]);
      const uu = (c === 1 || c === 2) ? u1 : u0;
      const vv = (c === 2 || c === 3) ? v1 : v0;
      buf.uv.push(uu, vv);
      const li = face.shade * (f === 2 ? 0.96 : 0.82);
      buf.col.push(li, li, li);
    }
    const b = buf.pos.length / 3 - 4;
    buf.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}

// 植物十字面（两个对角平面 × 双面）
function pushPlant(buf, wx, y, wz, id, uv) {
  const def = blockDef(id);
  const tile = def.tiles.top;
  tileUVs(tile, uv);
  const u0 = uv[0], v0 = uv[1], u1 = uv[2], v1 = uv[3];
  const n = Math.SQRT1_2;
  const quads = [
    // 对角平面 1
    [[-0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [-0.5, 1, 0.5]],
    // 对角平面 2
    [[-0.5, 0, -0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, -0.5]],
  ];
  for (const q of quads) {
    const plantVar = 0.96 + hash2(wx, wz, 43) * 0.04;
    for (const [qx, qy, qz] of q) {
      buf.pos.push(wx + qx, y + qy, wz + qz);
      buf.norm.push(0, 1, 0);
      buf.col.push(plantVar, plantVar, plantVar);
    }
    buf.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    // 四边形 → 2 个三角形
    const b = buf.pos.length / 3 - 4;
    buf.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}

function toGeometry(buf) {
  if (buf.pos.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.norm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
  // Uint32 索引：区块面数可能超过 65535 顶点（WebGL2 原生支持，WebGL1 走 OES 扩展）
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buf.idx), 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

// 为指定面选择瓦片：基础瓦片 + 可选的 variants.{top|side|bottom|all}。
// 用世界坐标哈希选择，保证同一方块在重网格化/换设备后纹理一致。
export function pickTileVariant(def, face, wx, y, wz) {
  const key = face === 2 ? 'top' : (face === 3 ? 'bottom' : 'side');
  const pool = def.variants ? (def.variants[key] || def.variants.all) : null;
  if (!pool || pool.length <= 1) return key === 'top' ? def.tiles.top : (key === 'bottom' ? def.tiles.bottom : def.tiles.side);
  const idx = Math.floor(hash2(wx + face * 61, y * 3 + wz * 57, 1009 + pool.length * 31) * pool.length) % pool.length;
  return pool[idx];
}

export function toMeshes(result, materials) {
  const geos = [toGeometry(result.opaque), toGeometry(result.cutout), toGeometry(result.fluid)];
  const meshes = [];
  for (let i = 0; i < 3; i++) {
    if (!geos[i]) continue;
    const mesh = new THREE.Mesh(geos[i], materials[i]);
    mesh.frustumCulled = true;
    meshes.push(mesh);
  }
  return meshes;
}
