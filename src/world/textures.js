// 程序化像素纹理：所有方块纹理在运行时用 Canvas 逐像素绘制（原创素材）。
// 浏览器模块：依赖 document；Node 测试环境不会调用本模块的绘制函数。
import * as THREE from 'three';
import { TILE, TILE_COUNT, TILE_SIZE, TILES_PER_ROW, ATLAS_ROWS } from './tiles.js';

// 确定性随机（每个瓦片固定种子 → 纹理稳定）
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(c) {
  return [ (c >> 16) & 255, (c >> 8) & 255, c & 255 ];
}
function rgb(r, g, b) { return (r << 16) | (g << 8) | b; }
function shade(color, k) {
  let [r, g, b] = hex(color);
  r = Math.max(0, Math.min(255, Math.round(r * k)));
  g = Math.max(0, Math.min(255, Math.round(g * k)));
  b = Math.max(0, Math.min(255, Math.round(b * k)));
  return rgb(r, g, b);
}

function tileCanvas(painter) {
  const cv = document.createElement('canvas');
  cv.width = TILE_SIZE; cv.height = TILE_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  const px = (x, y, color, alpha = 255) => {
    const i = (y * TILE_SIZE + x) * 4;
    const [r, g, b] = hex(color);
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = alpha;
  };
  const get = (x, y) => {
    const i = (y * TILE_SIZE + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
  };
  painter({ px, get, cv, ctx, img, rng: makeRng(2026 + Math.floor(Math.random() * 1e9)) });
  ctx.putImageData(img, 0, 0);
  return cv;
}

// 通用：基础色 + 亮度抖动
function base({ px, rng }, color, jitter = 0.07) {
  for (let y = 0; y < TILE_SIZE; y++)
    for (let x = 0; x < TILE_SIZE; x++)
      px(x, y, shade(color, 1 - jitter + rng() * jitter * 2));
}

// 通用：随机深色斑块
function patches({ px, rng }, color, count, size, alpha = 255) {
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(rng() * TILE_SIZE);
    const cy = Math.floor(rng() * TILE_SIZE);
    for (let dy = -size; dy <= size; dy++)
      for (let dx = -size; dx <= size; dx++) {
        if (dx * dx + dy * dy > size * size) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= TILE_SIZE || y >= TILE_SIZE) continue;
        if (rng() < 0.65) px(x, y, color, alpha);
      }
  }
}

// 边缘明暗（顶亮底暗的伪立体感）。
// 历史 bug：直接用 rgb(r*topK, ...) 不夹紧——接近纯白的像素（如雪地 0xf6fbfd）
// 乘以 >1 系数后溢出 24 位打包，把颜色串到相邻通道，产生红黄黑杂色像素条带。
function edgeShade({ px, get }, topK = 1.12, bottomK = 0.8) {
  for (let x = 0; x < TILE_SIZE; x++) {
    for (let y = 0; y < 4; y++) {
      const [r, g, b, a] = get(x, y);
      px(x, y, shade(rgb(r, g, b), topK), a);
    }
    for (let y = TILE_SIZE - 3; y < TILE_SIZE; y++) {
      const [r, g, b, a] = get(x, y);
      px(x, y, shade(rgb(r, g, b), bottomK), a);
    }
  }
}

const PAINTERS = {
  [TILE.GRASS_TOP](t) {
    base(t, 0x3fae6a, 0.1);
    for (let i = 0; i < 90; i++) {
      t.px(Math.floor(t.rng() * TILE_SIZE), Math.floor(t.rng() * TILE_SIZE), shade(0x3fae6a, 0.85 + t.rng() * 0.3));
    }
    patches(t, 0x2c854e, 5, 1);
    edgeShade(t);
  },
  [TILE.GRASS_SIDE](t) {
    base(t, 0x7a5230, 0.12);
    patches(t, 0x5f3d22, 8, 1);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, shade(0x3fae6a, 0.9 + t.rng() * 0.2));
    // 草须垂落
    for (let x = 0; x < TILE_SIZE; x++) {
      if (t.rng() < 0.4) {
        const len = 1 + Math.floor(t.rng() * 3);
        for (let d = 0; d < len; d++) if (4 + d < TILE_SIZE) t.px(x, 4 + d, shade(0x3fae6a, 0.75 + t.rng() * 0.2));
      }
    }
  },
  [TILE.DIRT](t) { base(t, 0x7a5230, 0.1); patches(t, 0x5f3d22, 10, 1); patches(t, 0x8d6139, 6, 1); edgeShade(t); },
  [TILE.STONE](t) {
    base(t, 0x8b8f96, 0.08);
    patches(t, 0x757a82, 9, 1);
    patches(t, 0xa0a5ad, 6, 1);
    // 裂纹
    let x = Math.floor(t.rng() * 8), y = Math.floor(t.rng() * TILE_SIZE);
    for (let i = 0; i < 10; i++) {
      if (x < TILE_SIZE && y < TILE_SIZE && y >= 0) t.px(x, y, 0x5d616a);
      x += t.rng() < 0.5 ? 1 : 0; y += Math.floor(t.rng() * 3) - 1;
    }
    edgeShade(t);
  },
  [TILE.SAND](t) { base(t, 0xdbc27a, 0.08); patches(t, 0xc4a95f, 8, 1); patches(t, 0xe9d492, 6, 1); edgeShade(t); },
  [TILE.LOG_SIDE](t) {
    base(t, 0x5e3a2a, 0.08);
    for (let x = 0; x < TILE_SIZE; x++) {
      const c = x % 4 === 0 ? 0x45291e : shade(0x5e3a2a, 0.9 + t.rng() * 0.2);
      for (let y = 0; y < TILE_SIZE; y++) t.px(x, y, c);
    }
  },
  [TILE.LOG_TOP](t) {
    base(t, 0x8a5a35, 0.08);
    for (let r = 7; r >= 1; r--) {
      const c = r % 2 === 0 ? 0x6e4527 : 0x9c6b42;
      for (let y = 0; y < TILE_SIZE; y++)
        for (let x = 0; x < TILE_SIZE; x++) {
          const dx = x - 7.5, dy = y - 7.5;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d <= r) t.px(x, y, shade(c, 1 - (r - d) * 0.03));
        }
    }
  },
  [TILE.PLANKS](t) {
    base(t, 0x9c6b42, 0.07);
    for (let y = 0; y < TILE_SIZE; y++) {
      if (y % 4 === 3) for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x5e3a2a);
      else {
        for (let x = 0; x < TILE_SIZE; x++) if (t.rng() < 0.06) t.px(x, y, 0x7c5230);
      }
    }
  },
  [TILE.LEAVES](t) {
    base(t, 0x2f7a54, 0.14);
    patches(t, 0x245c40, 10, 2);
    patches(t, 0x4a9e6e, 8, 1);
    for (let i = 0; i < 26; i++) t.px(Math.floor(t.rng() * 16), Math.floor(t.rng() * 16), shade(0x2f7a54, 0.7 + t.rng() * 0.5));
  },
  [TILE.FERROCK](t) { ore(t, 0x9a4a2a, 0xcf6a3a, 6); },
  [TILE.COPPER_ORE](t) { ore(t, 0x2e8f7a, 0x54c9ae, 6); },
  [TILE.GOLD_ORE](t) { ore(t, 0xc79a1e, 0xf5d256, 5); },
  [TILE.COAL_ORE](t) { ore(t, 0x2a2a30, 0x45454e, 7); },
  [TILE.DIHYDROGEN](t) { crystal(t, 0x3f9bff, 0x9fd8ff, 0x1d5fb8); },
  [TILE.SODIUM](t) { plantGlow(t, 0xffcf4d, 0xfff3b0); },
  [TILE.OXYGEN](t) { plantGlow(t, 0xff5a5a, 0xffb0b0); },
  [TILE.CARBON](t) { crystal(t, 0xb0506a, 0xffc2cf, 0x7a2f42); },
  [TILE.HULL](t) {
    base(t, 0x9aa4ad, 0.05);
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) {
        if (x % 4 === 3 || y % 4 === 3) t.px(x, y, 0x6f7a84);
      }
    for (const [rx, ry] of [[2, 2], [10, 6], [6, 14], [14, 10]]) t.px(rx, ry, 0x4a535c);
    patches(t, 0xb8c2ca, 4, 1);
    edgeShade(t, 1.06, 0.85);
  },
  [TILE.HULL_DARK](t) {
    base(t, 0x6b757e, 0.06);
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) if (x % 4 === 3 || y % 4 === 3) t.px(x, y, 0x4a545c);
    patches(t, 0x262c32, 9, 2); // 烧蚀焦痕
    patches(t, 0x8a4a26, 3, 1); // 锈迹
    edgeShade(t, 1.05, 0.82);
  },
  [TILE.GLASS](t) {
    // 图标可读性修复：旧版主体 alpha=46 在深色图标底上几乎不可见。
    // 加宽不透明边框 + 提高主体透明度到 150 + 高光斜纹，保持"玻璃"感的同时清晰可辨。
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) {
        const border = x < 2 || y < 2 || x > 13 || y > 13;
        const innerFrame = !border && (x === 2 || y === 2 || x === 13 || y === 13);
        if (border) t.px(x, y, 0x8fc6d6, 255);
        else if (innerFrame) t.px(x, y, 0xbfe2ec, 220);
        else if (x < 5 && y < 12) t.px(x, y, 0xf4fcff, 210); // 高光斜纹
        else t.px(x, y, 0xa8d8e6, 150);
      }
    for (const [rx, ry] of [[4, 5], [6, 9]]) t.px(rx, ry, 0xffffff, 255); // 反光点
  },
  [TILE.SCORCHED](t) {
    base(t, 0x3d2e26, 0.12);
    patches(t, 0x251813, 10, 2);
    for (let i = 0; i < 12; i++) t.px(Math.floor(t.rng() * 16), Math.floor(t.rng() * 16), 0xd8722a); // 余烬
    patches(t, 0x8a4a22, 3, 1); // 闷烧
  },
  [TILE.MAGMA](t) {
    base(t, 0x2a1410, 0.08);
    patches(t, 0x1c0b08, 9, 2);
    // 熔岩裂纹（亮橙 → 亮黄核心）
    for (let i = 0; i < 14; i++) {
      let x = Math.floor(t.rng() * 16), y = Math.floor(t.rng() * 16);
      const len = 2 + Math.floor(t.rng() * 5);
      for (let j = 0; j < len; j++) {
        const hot = t.rng();
        t.px(x, y, hot < 0.25 ? 0xffe08a : hot < 0.7 ? 0xff9a3a : 0xff5a20, 255);
        x = Math.max(0, Math.min(15, x + (t.rng() < 0.5 ? 1 : -1)));
        y = Math.max(0, Math.min(15, y + Math.floor(t.rng() * 3) - 1));
      }
    }
    edgeShade(t, 1.06, 0.78);
  },
  [TILE.FERRITE_DUST](t) {
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x14181e, 0); // 透明背景
    // 粉末堆
    const cx = 8, cy = 10;
    for (let y = 3; y < 16; y++)
      for (let x = 2; x < 15; x++) {
        const dx = (x - cx) / 6.5, dy = (y - cy) / 5.5;
        if (dx * dx + dy * dy <= 1) {
          const k = 0.75 + t.rng() * 0.45;
          t.px(x, y, shade(0xb05028, k), 255);
        }
      }
    for (let i = 0; i < 10; i++) t.px(3 + Math.floor(t.rng() * 10), 4 + Math.floor(t.rng() * 6), shade(0xd8783a, 0.9 + t.rng() * 0.2));
  },
  [TILE.METAL_PLATING](t) {
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x14181e, 0);
    // 金属板（圆角矩形）
    for (let y = 3; y < 13; y++)
      for (let x = 2; x < 14; x++) {
        const corner = (x < 4 && y < 5) || (x > 11 && y < 5) || (x < 4 && y > 10) || (x > 11 && y > 10);
        if (corner) continue;
        const edge = x < 3 || x > 12 || y < 4 || y > 11;
        t.px(x, y, edge ? 0x5a666e : shade(0x9aa8b2, 0.9 + t.rng() * 0.15), 255);
      }
    for (let y = 3; y < 13; y++) t.px(2, y, 0x5a666e, 255);
    for (const [rx, ry] of [[4, 5], [8, 5], [11, 5], [4, 11], [8, 11], [11, 11]]) t.px(rx, ry, 0x39424a, 255);
    for (let x = 3; x < 13; x++) if (t.rng() < 0.3) t.px(x, 8, 0xcfdbe4, 90); // 高光
  },
  [TILE.DIHYDROGEN_JELLY](t) {
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x14181e, 0);
    // 蓝色凝胶团
    for (let y = 4; y < 14; y++)
      for (let x = 3; x < 13; x++) {
        const dx = (x - 8) / 5.5, dy = (y - 9) / 5;
        if (dx * dx + dy * dy <= 1) {
          const k = 0.8 + t.rng() * 0.3;
          t.px(x, y, shade(t.rng() < 0.3 ? 0x6fc4ff : 0x2f7fd8, k), 230);
        }
      }
    for (const [gx, gy] of [[6, 6], [9, 5], [7, 11]]) t.px(gx, gy, 0xd8f2ff, 200); // 高光
  },
  [TILE.LAUNCH_FUEL](t) {
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x14181e, 0);
    // 燃料罐
    for (let y = 3; y < 13; y++)
      for (let x = 4; x < 12; x++) {
        if ((y === 3 || y === 12) && (x < 5 || x > 10)) continue;
        const edge = x === 4 || x === 11;
        t.px(x, y, edge ? 0x8a949e : shade(0xcfd8e0, 0.88 + t.rng() * 0.2), 255);
      }
    // 顶部喷口 + 燃料指示窗
    for (let x = 6; x < 10; x++) t.px(x, 2, 0x5a666e, 255);
    for (let y = 6; y < 10; y++)
      for (let x = 6; x < 10; x++) t.px(x, y, t.rng() < 0.5 ? 0xff8c3a : 0xffb84d, 255); // 橙色燃料
    t.px(4, 12, 0x5a666e, 255); t.px(11, 12, 0x5a666e, 255);
  },
  [TILE.HERMETIC_SEAL](t) {
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x14181e, 0);
    // 密封胶环（圆环）
    for (let y = 3; y < 13; y++)
      for (let x = 3; x < 13; x++) {
        const dx = (x - 8) / 5, dy = (y - 8) / 5;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0.55 && d < 1.0) t.px(x, y, shade(0x5c8fa8, 0.85 + t.rng() * 0.25), 255);
      }
    // 中心封盖
    for (let y = 6; y < 10; y++)
      for (let x = 6; x < 10; x++) t.px(x, y, 0x9fc6d8, 255);
    t.px(8, 8, 0x2a4a5c, 255);
  },
  [TILE.MULTITOOL](t) {
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x14181e, 0);
    // 科幻多功能工具（斜置枪形）
    for (let y = 4; y < 12; y++)
      for (let x = 3; x < 13; x++) {
        if (y < 8 && x > 8 + (8 - y)) continue; // 斜切枪口
        const edge = x === 3 || y === 11 || (x === 12 && y > 7);
        t.px(x, y, edge ? 0x3a4a55 : shade(0x7f8f9a, 0.88 + t.rng() * 0.2), 255);
      }
    // 握把
    for (let y = 9; y < 14; y++)
      for (let x = 5; x < 8; x++) t.px(x, y, 0x4a5a66, 255);
    // 能量核心与枪口
    for (let y = 5; y < 8; y++)
      for (let x = 6; x < 9; x++) t.px(x, y, t.rng() < 0.4 ? 0x7ff0ff : 0x2fb8d8, 255);
    t.px(9, 7, 0x7ff0ff, 255); t.px(9, 8, 0x7ff0ff, 255);
    t.px(11, 8, 0xcfefff, 255); // 枪口高光
  },
  [TILE.RED_SAND](t) {
    base(t, 0xb05535, 0.08);
    patches(t, 0x8a3d22, 8, 1);
    patches(t, 0xd07a50, 6, 1);
    edgeShade(t);
  },
  [TILE.SNOW](t) {
    base(t, 0xe8f2f8, 0.06);
    patches(t, 0xcfe4ee, 6, 1);
    patches(t, 0xf6fbfd, 5, 1);
    edgeShade(t, 1.05, 0.92);
  },
  [TILE.CREDITS](t) {
    // 信用点（科幻货币徽章）
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x14181e, 0);
    for (let y = 3; y < 13; y++)
      for (let x = 3; x < 13; x++) {
        const dx = x - 8, dy = y - 8;
        if (dx * dx + dy * dy > 25) continue;
        const edge = dx * dx + dy * dy > 17;
        t.px(x, y, edge ? 0x8a6a1a : 0xd8a83a, 255);
      }
    for (let y = 6; y < 10; y++)
      for (let x = 6; x < 10; x++) t.px(x, y, 0xffd86a, 255);
    t.px(8, 5, 0xfff0a8, 255); t.px(5, 8, 0xfff0a8, 255); t.px(11, 8, 0xfff0a8, 255); t.px(8, 11, 0xfff0a8, 255);
  },
  [TILE.SHIELD_CELL](t) {
    // 护盾电池：蓝色能量罐 + 护盾徽记
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x14181e, 0);
    // 罐体
    for (let y = 3; y < 14; y++)
      for (let x = 4; x < 12; x++) {
        if (y === 3 && (x < 5 || x > 10)) continue;
        const edge = x === 4 || x === 11 || y === 13;
        t.px(x, y, edge ? 0x2a4a5e : shade(0x3f6f8f, 0.9 + t.rng() * 0.2), 255);
      }
    // 能量窗口（发光蓝）
    for (let y = 6; y < 11; y++)
      for (let x = 6; x < 10; x++) t.px(x, y, t.rng() < 0.35 ? 0x7ff0ff : 0x2fb8d8, 255);
    t.px(7, 8, 0xcfefff, 255); t.px(9, 8, 0xcfefff, 255);
    // 顶部电极
    t.px(7, 2, 0x9fc6d8, 255); t.px(8, 2, 0x9fc6d8, 255); t.px(8, 1, 0xcfefff, 255);
  },
  [TILE.STONE_BRICK](t) {
    // 石砖：规整砌缝 + 石材质感，给建造玩法第一块“真正像建材”的方块
    base(t, 0x9aa0a6, 0.07);
    patches(t, 0x83898f, 7, 1);
    patches(t, 0xb0b6bc, 5, 1);
    for (let y = 0; y < TILE_SIZE; y++) {
      if (y % 4 === 3) {
        for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x555b62, 255);
      } else {
        for (let x = 0; x < TILE_SIZE; x++) if (t.rng() < 0.05) t.px(x, y, 0x6f757b, 255);
      }
    }
    // 错缝竖缝：每两行砖一组，竖缝位置交错
    for (let row = 0; row < 4; row++) {
      const y = row * 4 + 1;
      const off = row % 2 === 0 ? 4 : 8;
      for (let x = off; x < TILE_SIZE; x += 8) {
        for (let dy = -1; dy <= 2; dy++) t.px(x, y + dy, 0x555b62, 255);
      }
    }
    edgeShade(t, 1.05, 0.84);
  },
  [TILE.MINING_BEAM_MK2](t) {
    // 采矿光束 MkII 图标：MkI 枪身 + 橙色重型枪管与双能量核心
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x14181e, 0);
    for (let y = 4; y < 12; y++)
      for (let x = 3; x < 13; x++) {
        if (y < 8 && x > 8 + (8 - y)) continue;
        const edge = x === 3 || y === 11 || (x === 12 && y > 7);
        t.px(x, y, edge ? 0x3a4a55 : shade(0x7f8f9a, 0.88 + t.rng() * 0.2), 255);
      }
    for (let y = 5; y < 10; y++) t.px(12, y, 0xff9a3a, 255);
    for (let y = 5; y < 8; y++)
      for (let x = 6; x < 9; x++) t.px(x, y, t.rng() < 0.4 ? 0xffc26a : 0xff8c3a, 255);
    t.px(9, 7, 0xffe08a, 255); t.px(9, 8, 0xffe08a, 255);
    for (let y = 9; y < 14; y++)
      for (let x = 5; x < 8; x++) t.px(x, y, 0x4a5a66, 255);
    t.px(11, 8, 0xffffff, 255);
  },
  [TILE.ENERGY_COIL](t) {
    // 能量线圈：铜色环状线圈 + 中心橙色能量核心（Q 键武器模块）
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0x14181e, 0);
    for (let y = 4; y < 12; y++) {
      for (let x = 3; x < 13; x++) {
        const dx = x - 8, dy = y - 8;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 4.6 || d < 2.8) continue;
        const edge = d > 4.1 || d < 3.3;
        t.px(x, y, edge ? 0x8a5a2a : shade(0xc8802e, 0.9 + t.rng() * 0.25), 255);
      }
    }
    for (let y = 6; y < 10; y++)
      for (let x = 6; x < 10; x++) {
        t.px(x, y, t.rng() < 0.35 ? 0xffffff : 0xff9a3a, 255);
      }
    t.px(8, 4, 0xffe08a, 255); t.px(8, 11, 0xffe08a, 255);
  },
  [TILE.BASE_UNIT](t) {
    // 基地终端：深色设备面 + 青色状态屏 + 琥珀警示条
    base(t, 0x2a3a48, 0.08);
    patches(t, 0x1f2c38, 5, 1);
    patches(t, 0x3a4d5e, 4, 1);
    for (let y = 2; y < 7; y++)
      for (let x = 3; x < 13; x++) t.px(x, y, t.rng() < 0.25 ? 0x7ff0ff : 0x1a2a36, 255);
    for (let y = 8; y < 12; y++)
      for (let x = 4; x < 12; x++) t.px(x, y, t.rng() < 0.3 ? 0xffc24d : 0x8a5a2a, 255);
    edgeShade(t, 1.08, 0.82);
  },
  [TILE.STORAGE](t) {
    // 储物箱：板材底 + 金属边条 + 中央锁扣
    base(t, 0x9c6b42, 0.08);
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const edge = x < 2 || x > 13 || y < 2 || y > 13;
        if (edge) t.px(x, y, 0x6f7a84, 255);
        else if (x === 2 || x === 13 || y === 2 || y === 13) t.px(x, y, 0x4a535c, 255);
        else if (t.rng() < 0.08) t.px(x, y, 0x7c5230, 255);
      }
    }
    for (let y = 7; y < 10; y++) for (let x = 7; x < 10; x++) t.px(x, y, 0xcfd8e0, 255);
    t.px(8, 8, 0x2a4a5c, 255);
  },
  [TILE.WATER](t) {
    // 水体：半透明蓝色 + 横向波痕；alpha 让水色能透出湖底
    for (let y = 0; y < TILE_SIZE; y++)
      for (let x = 0; x < TILE_SIZE; x++) {
        const wave = Math.sin((x * 3 + y * 5) * 0.7) * 0.5 + Math.sin((x - y) * 1.7) * 0.5;
        const k = 0.82 + wave * 0.12;
        t.px(x, y, shade(0x2f7fd8, k), 155 + Math.floor(wave * 18));
      }
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(t.rng() * TILE_SIZE);
      const y = 2 + Math.floor(t.rng() * (TILE_SIZE - 4));
      for (let dx = 0; dx < 4; dx++) {
        const px0 = (x + dx) % TILE_SIZE;
        t.px(px0, y, 0xbfe8ff, 205);
      }
    }
  },
  // ---- 材质变体：同结构、不同色相/斑块，打破大面积同亮度重复 ----
  [TILE.GRASS_TOP_V2](t) {
    base(t, 0x4fae5a, 0.1);
    for (let i = 0; i < 90; i++) t.px(Math.floor(t.rng() * TILE_SIZE), Math.floor(t.rng() * TILE_SIZE), shade(0x4fae5a, 0.8 + t.rng() * 0.4));
    patches(t, 0x3f8a3e, 6, 1);
    edgeShade(t);
  },
  [TILE.GRASS_TOP_V3](t) {
    base(t, 0x2f9a6a, 0.11);
    for (let i = 0; i < 95; i++) t.px(Math.floor(t.rng() * TILE_SIZE), Math.floor(t.rng() * TILE_SIZE), shade(0x2f9a6a, 0.78 + t.rng() * 0.42));
    patches(t, 0x1f7a4e, 7, 2);
    edgeShade(t);
  },
  [TILE.GRASS_SIDE_V2](t) {
    base(t, 0x6f4a30, 0.12);
    patches(t, 0x57391f, 9, 1);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, shade(0x4fae5a, 0.86 + t.rng() * 0.24));
    for (let x = 0; x < TILE_SIZE; x++) {
      if (t.rng() < 0.38) {
        const len = 1 + Math.floor(t.rng() * 3);
        for (let d = 0; d < len; d++) if (4 + d < TILE_SIZE) t.px(x, 4 + d, shade(0x4fae5a, 0.7 + t.rng() * 0.25));
      }
    }
  },
  [TILE.DIRT_V2](t) { base(t, 0x6f4a30, 0.1); patches(t, 0x57391f, 11, 1); patches(t, 0x825a34, 7, 1); edgeShade(t); },
  [TILE.DIRT_V3](t) { base(t, 0x8a5a3a, 0.09); patches(t, 0x6f452a, 9, 1); patches(t, 0xa06a45, 5, 1); edgeShade(t); },
  [TILE.STONE_V2](t) {
    base(t, 0x7f8b99, 0.07);
    patches(t, 0x687480, 9, 1);
    patches(t, 0x98a5b2, 6, 1);
    for (let i = 0; i < 8; i++) {
      let x = Math.floor(t.rng() * 8), y = Math.floor(t.rng() * TILE_SIZE);
      for (let j = 0; j < 12; j++) {
        if (x < TILE_SIZE && y < TILE_SIZE && y >= 0) t.px(x, y, 0x4d5863);
        x += t.rng() < 0.5 ? 1 : 0; y += Math.floor(t.rng() * 3) - 1;
      }
    }
    edgeShade(t);
  },
  [TILE.STONE_V3](t) {
    base(t, 0x8f8a7a, 0.08);
    patches(t, 0x787362, 8, 1);
    patches(t, 0xa49d89, 5, 1);
    patches(t, 0x6b7565, 4, 2);
    edgeShade(t);
  },
  [TILE.SAND_V2](t) { base(t, 0xe2c87a, 0.07); patches(t, 0xcdb265, 8, 1); patches(t, 0xf0da98, 6, 1); edgeShade(t); },
  [TILE.SAND_V3](t) { base(t, 0xc9b266, 0.09); patches(t, 0xae9750, 9, 1); patches(t, 0xdfc87d, 5, 1); edgeShade(t); },
  [TILE.RED_SAND_V2](t) {
    base(t, 0x9a4528, 0.08);
    patches(t, 0x7a3219, 9, 1);
    patches(t, 0xc06a40, 6, 1);
    edgeShade(t);
  },
  [TILE.SNOW_V2](t) {
    base(t, 0xdcebf8, 0.06);
    patches(t, 0xc2d8ee, 7, 1);
    patches(t, 0xeef7fd, 5, 1);
    edgeShade(t, 1.05, 0.9);
  },
  [TILE.LEAVES_V2](t) {
    base(t, 0x4f8a3a, 0.14);
    patches(t, 0x3f6e2e, 10, 2);
    patches(t, 0x6aaa54, 8, 1);
    for (let i = 0; i < 26; i++) t.px(Math.floor(t.rng() * TILE_SIZE), Math.floor(t.rng() * TILE_SIZE), shade(0x4f8a3a, 0.66 + t.rng() * 0.5));
  },
};

// 矿石：岩石底 + 彩色矿簇
function ore(t, clusterColor, bright, clusters) {
  base(t, 0x8b8f96, 0.08);
  patches(t, 0x757a82, 6, 1);
  for (let i = 0; i < clusters; i++) {
    const cx = 2 + Math.floor(t.rng() * 12), cy = 2 + Math.floor(t.rng() * 12);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (t.rng() < 0.8) {
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && y >= 0 && x < 16 && y < 16) t.px(x, y, t.rng() < 0.5 ? clusterColor : bright);
        }
      }
  }
  edgeShade(t);
}

// 晶体（透明背景 + 晶簇，如二氢/碳晶）
function crystal(t, dark, bright, edge) {
  for (let y = 0; y < TILE_SIZE; y++)
    for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0, 0);
  const spikes = [[4, 13, 6, 3], [9, 14, 7, 4], [12, 12, 4, 3], [6, 11, 4, 2]];
  for (const [sx, sy, w, h] of spikes) {
    for (let y = 0; y < h; y++) {
      const half = Math.max(1, Math.round((w / 2) * (1 - y / h)));
      for (let x = -half; x <= half; x++) {
        const px0 = sx + x, py0 = sy - y;
        if (px0 < 0 || py0 < 0 || px0 >= 16 || py0 >= 16) continue;
        const k = 1 - y / h;
        const c = Math.abs(x) === half ? edge : (t.rng() < 0.25 ? dark : bright);
        t.px(px0, py0, shade(c, 0.6 + k * 0.55), 255);
      }
    }
  }
}

// 发光植物（钠花/氧草）：十字叶片 + 发光核心
function plantGlow(t, color, bright) {
  for (let y = 0; y < TILE_SIZE; y++)
    for (let x = 0; x < TILE_SIZE; x++) t.px(x, y, 0, 0);
  // 茎
  for (let y = 8; y < 15; y++) t.px(7, y, shade(color, 0.7), 255);
  // 花头
  for (let y = 3; y < 9; y++) {
    const half = Math.max(1, Math.round(3 * Math.sin(((y - 3) / 6) * Math.PI)));
    for (let x = -half; x <= half; x++) {
      const px0 = 7 + x;
      if (px0 >= 0 && px0 < 16) t.px(px0, y, x === 0 ? bright : color, 255);
    }
  }
  // 光晕
  for (const [gx, gy] of [[7, 5], [5, 6], [9, 6], [7, 8]]) t.px(gx, gy, bright, 120);
}

export function createBlockTextures(palette = null) {
  // palette: { grassHue } —— 不同星球植被色相
  const grassHue = palette && palette.grassHue !== undefined ? palette.grassHue : 0;
  const hueTiles = new Set([TILE.GRASS_TOP, TILE.GRASS_SIDE, TILE.LEAVES]);
  const atlasCv = document.createElement('canvas');
  atlasCv.width = TILES_PER_ROW * TILE_SIZE;
  atlasCv.height = ATLAS_ROWS * TILE_SIZE;
  const actx = atlasCv.getContext('2d');
  const icons = new Map();
  for (let i = 0; i < TILE_COUNT; i++) {
    const painter = PAINTERS[i];
    const cv = painter ? tileCanvas(painter) : tileCanvas((t) => base(t, 0xff00ff, 0));
    const tx = (i % TILES_PER_ROW) * TILE_SIZE;
    const ty = Math.floor(i / TILES_PER_ROW) * TILE_SIZE;
    actx.filter = hueTiles.has(i) ? `hue-rotate(${grassHue}deg)` : 'none';
    actx.drawImage(cv, tx, ty);
    actx.filter = 'none';
    icons.set(i, cv);
  }
  const atlas = new THREE.CanvasTexture(atlasCv);
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = THREE.SRGBColorSpace;
  return { atlas, icons };
}

// 图集内某瓦片的 UV 范围（含半像素内缩，避免 NEAREST 采样在瓦片边缘
// 漂移到相邻瓦片/空白区——雪块等纯色方块边缘会出现红黄黑杂色像素）
export function tileUVs(index, out = null) {
  const o = out || [0, 0, 0, 0];
  const cols = TILES_PER_ROW, rows = ATLAS_ROWS;
  const tx = (index % cols) / cols;
  const ty = 1 - (Math.floor(index / cols) + 1) / rows;
  const tw = 1 / cols, th = 1 / rows;
  const ex = 0.5 / (cols * TILE_SIZE), ey = 0.5 / (rows * TILE_SIZE);
  o[0] = tx + ex; o[1] = ty + th - ey; o[2] = tx + tw - ex; o[3] = ty + ey;
  return o; // [u0, vTop, u1, vBottom]
}
