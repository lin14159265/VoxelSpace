// 纹理图集瓦片索引（纯数据，供 blocks.js 与 textures.js 共用）
export const TILE = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG_SIDE: 5,
  LOG_TOP: 6,
  PLANKS: 7,
  LEAVES: 8,
  FERROCK: 9,
  COPPER_ORE: 10,
  GOLD_ORE: 11,
  COAL_ORE: 12,
  DIHYDROGEN: 13,
  SODIUM: 14,
  OXYGEN: 15,
  CARBON: 16,
  HULL: 17,
  HULL_DARK: 18,
  GLASS: 19,
  SCORCHED: 20,
  FERRITE_DUST: 21,
  METAL_PLATING: 22,
  DIHYDROGEN_JELLY: 23,
  LAUNCH_FUEL: 24,
  HERMETIC_SEAL: 25,
  MULTITOOL: 26,
  RED_SAND: 27,   // 火星红沙
  SNOW: 28,       // 冰巨星雪盖
  CREDITS: 29,    // 信用点（空间站货币）
  SHIELD_CELL: 30, // 护盾电池（合成消耗品：护盾 <30% 自动补充）
  MAGMA: 31,       // 地热熔岩（热行星地下结构）
  STONE_BRICK: 32,  // 石砖（建造向建材）
  MINING_BEAM_MK2: 33, // 采矿光束 MkII（工具升级）
  ENERGY_COIL: 34,     // 能量线圈（战斗模块）
  BASE_UNIT: 35,       // 基地终端（重生点/休息/安全区）
  STORAGE: 36,         // 储物箱（基地储物）
  WATER: 37,           // 水体（透明液体）
  // 材质变体：同种方块按世界位置选择不同瓦片，打破大面积重复感
  GRASS_TOP_V2: 38, GRASS_TOP_V3: 39, GRASS_SIDE_V2: 40,
  DIRT_V2: 41, DIRT_V3: 42,
  STONE_V2: 43, STONE_V3: 44,
  SAND_V2: 45, SAND_V3: 46,
  RED_SAND_V2: 47, SNOW_V2: 48, LEAVES_V2: 49,
};
export const TILE_COUNT = 50;
export const TILE_SIZE = 16;
export const TILES_PER_ROW = 16;
export const ATLAS_ROWS = Math.ceil(TILE_COUNT / TILES_PER_ROW);

// 方块侧边纹理随机旋转（4 个方向），提升观感
export const ROTATIONS = [
  [0, 0, 1, 0, 1, 1, 0, 1],       // 0°
  [1, 0, 1, 1, 0, 1, 0, 0],       // 90°
  [1, 1, 0, 1, 0, 0, 1, 0],       // 180°
  [0, 1, 0, 0, 1, 0, 1, 1],       // 270°
];
