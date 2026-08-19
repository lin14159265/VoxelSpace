// 方块注册表（纯数据）
import { TILE } from './tiles.js';

export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG: 5,
  LEAVES: 6,
  PLANKS: 7,
  FERROCK: 8,
  COPPER_ORE: 9,
  GOLD_ORE: 10,
  COAL_ORE: 11,
  DIHYDROGEN: 12,
  SODIUM: 13,
  OXYGEN: 14,
  CARBON: 15,
  HULL: 16,
  HULL_DARK: 17,
  GLASS: 18,
  SCORCHED: 19,
  RED_SAND: 20,
  SNOW: 21,
  MAGMA: 22,
  STONE_BRICK: 23,
  BASE_UNIT: 24,
  STORAGE: 25,
  WATER: 26,
};

// sound: 挖掘/踩踏音色分类
export const BLOCKS = {
  [B.AIR]: { id: 0, name: '空气', solid: false, plant: false, transparent: true, opacity: 'transparent', hardness: 0, drop: null },

  [B.GRASS]: { id: 1, name: '外星草方块', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.GRASS_TOP, side: TILE.GRASS_SIDE, bottom: TILE.DIRT },
    variants: { top: [TILE.GRASS_TOP, TILE.GRASS_TOP_V2, TILE.GRASS_TOP_V3], side: [TILE.GRASS_SIDE, TILE.GRASS_SIDE_V2], bottom: [TILE.DIRT, TILE.DIRT_V2, TILE.DIRT_V3] },
    hardness: 0.5, drop: { item: 'dirt', count: 1 }, sound: 'dirt' },

  [B.DIRT]: { id: 2, name: '泥土', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.DIRT, side: TILE.DIRT, bottom: TILE.DIRT },
    variants: { all: [TILE.DIRT, TILE.DIRT_V2, TILE.DIRT_V3] },
    hardness: 0.5, drop: { item: 'dirt', count: 1 }, sound: 'dirt' },

  [B.STONE]: { id: 3, name: '岩石', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.STONE, side: TILE.STONE, bottom: TILE.STONE },
    variants: { all: [TILE.STONE, TILE.STONE_V2, TILE.STONE_V3] },
    hardness: 1.1, drop: { item: 'stone', count: 1 }, sound: 'stone' },

  [B.SAND]: { id: 4, name: '沙地', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.SAND, side: TILE.SAND, bottom: TILE.SAND },
    variants: { all: [TILE.SAND, TILE.SAND_V2, TILE.SAND_V3] },
    hardness: 0.45, drop: { item: 'sand', count: 1 }, sound: 'sand' },

  [B.LOG]: { id: 5, name: '异星树干', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.LOG_TOP, side: TILE.LOG_SIDE, bottom: TILE.LOG_TOP },
    hardness: 0.9, drop: { item: 'log', count: 1 }, sound: 'wood' },

  [B.LEAVES]: { id: 6, name: '异星树叶', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.LEAVES, side: TILE.LEAVES, bottom: TILE.LEAVES },
    variants: { all: [TILE.LEAVES, TILE.LEAVES_V2] },
    hardness: 0.15, drop: { item: 'leaves', count: 1 }, sound: 'leaf' },

  [B.PLANKS]: { id: 7, name: '木制板材', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.PLANKS, side: TILE.PLANKS, bottom: TILE.PLANKS },
    hardness: 0.9, drop: { item: 'planks', count: 1 }, sound: 'wood' },

  [B.FERROCK]: { id: 8, name: '铁氧体矿脉', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.FERROCK, side: TILE.FERROCK, bottom: TILE.FERROCK },
    hardness: 1.6, drop: { item: 'ferrite_dust', count: 1 }, sound: 'stone' },

  [B.COPPER_ORE]: { id: 9, name: '铜矿脉', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.COPPER_ORE, side: TILE.COPPER_ORE, bottom: TILE.COPPER_ORE },
    hardness: 1.7, drop: { item: 'copper_ore', count: 1 }, sound: 'stone' },

  [B.GOLD_ORE]: { id: 10, name: '金矿脉', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.GOLD_ORE, side: TILE.GOLD_ORE, bottom: TILE.GOLD_ORE },
    hardness: 1.7, drop: { item: 'gold_ore', count: 1 }, sound: 'stone' },

  [B.COAL_ORE]: { id: 11, name: '碳矿脉', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.COAL_ORE, side: TILE.COAL_ORE, bottom: TILE.COAL_ORE },
    hardness: 1.5, drop: { item: 'carbon', count: 2 }, sound: 'stone' },

  [B.DIHYDROGEN]: { id: 12, name: '二氢晶体', solid: false, plant: true, transparent: true, opacity: 'cutout',
    tiles: { top: TILE.DIHYDROGEN, side: TILE.DIHYDROGEN, bottom: TILE.DIHYDROGEN },
    hardness: 0.25, drop: { item: 'di_hydrogen', count: 2 }, sound: 'plant' },

  [B.SODIUM]: { id: 13, name: '钠花', solid: false, plant: true, transparent: true, opacity: 'cutout',
    tiles: { top: TILE.SODIUM, side: TILE.SODIUM, bottom: TILE.SODIUM },
    hardness: 0.25, drop: { item: 'sodium', count: 2 }, sound: 'plant' },

  [B.OXYGEN]: { id: 14, name: '氧草', solid: false, plant: true, transparent: true, opacity: 'cutout',
    tiles: { top: TILE.OXYGEN, side: TILE.OXYGEN, bottom: TILE.OXYGEN },
    hardness: 0.25, drop: { item: 'oxygen', count: 2 }, sound: 'plant' },

  [B.CARBON]: { id: 15, name: '碳晶簇', solid: false, plant: true, transparent: true, opacity: 'cutout',
    tiles: { top: TILE.CARBON, side: TILE.CARBON, bottom: TILE.CARBON },
    hardness: 0.25, drop: { item: 'carbon', count: 2 }, sound: 'plant' },

  [B.HULL]: { id: 16, name: '飞船外壳', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.HULL, side: TILE.HULL, bottom: TILE.HULL },
    hardness: 2.2, drop: { item: 'hull', count: 1 }, sound: 'metal' },

  [B.HULL_DARK]: { id: 17, name: '烧蚀外壳', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.HULL_DARK, side: TILE.HULL_DARK, bottom: TILE.HULL_DARK },
    hardness: 2.2, drop: { item: 'hull_dark', count: 1 }, sound: 'metal' },

  [B.GLASS]: { id: 18, name: '强化玻璃', solid: true, plant: false, transparent: true, opacity: 'cutout',
    tiles: { top: TILE.GLASS, side: TILE.GLASS, bottom: TILE.GLASS },
    hardness: 0.3, drop: { item: 'glass', count: 1 }, sound: 'glass' },

  [B.SCORCHED]: { id: 19, name: '焦土', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.SCORCHED, side: TILE.SCORCHED, bottom: TILE.SCORCHED },
    hardness: 0.6, drop: { item: 'dirt', count: 1 }, sound: 'dirt' },

  [B.RED_SAND]: { id: 20, name: '红色沙地', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.RED_SAND, side: TILE.RED_SAND, bottom: TILE.RED_SAND },
    variants: { all: [TILE.RED_SAND, TILE.RED_SAND_V2] },
    hardness: 0.45, drop: { item: 'red_sand', count: 1 }, sound: 'sand' },

  [B.SNOW]: { id: 21, name: '雪层', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.SNOW, side: TILE.SNOW, bottom: TILE.STONE },
    variants: { top: [TILE.SNOW, TILE.SNOW_V2], side: [TILE.SNOW, TILE.SNOW_V2] },
    hardness: 0.4, drop: { item: 'snow', count: 1 }, sound: 'dirt' },

  [B.MAGMA]: { id: 22, name: '地热熔岩', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.MAGMA, side: TILE.MAGMA, bottom: TILE.MAGMA },
    hardness: 2.6, drop: { item: 'stone', count: 1 }, sound: 'stone' },

  [B.STONE_BRICK]: { id: 23, name: '石砖', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.STONE_BRICK, side: TILE.STONE_BRICK, bottom: TILE.STONE_BRICK },
    hardness: 1.2, drop: { item: 'stone_brick', count: 1 }, sound: 'stone' },

  [B.BASE_UNIT]: { id: 24, name: '基地终端', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.BASE_UNIT, side: TILE.BASE_UNIT, bottom: TILE.BASE_UNIT },
    hardness: 1.4, drop: { item: 'base_unit', count: 1 }, sound: 'metal' },

  [B.STORAGE]: { id: 25, name: '储物箱', solid: true, plant: false, transparent: false, opacity: 'opaque',
    tiles: { top: TILE.STORAGE, side: TILE.STORAGE, bottom: TILE.STORAGE },
    hardness: 1.1, drop: { item: 'storage_crate', count: 1 }, sound: 'wood' },

  [B.WATER]: { id: 26, name: '水', solid: false, plant: false, transparent: true, opacity: 'water',
    tiles: { top: TILE.WATER, side: TILE.WATER, bottom: TILE.WATER },
    hardness: 0, drop: null, sound: 'water' },
};

export function def(id) { return BLOCKS[id] || BLOCKS[B.AIR]; }
export function isSolid(id) { return BLOCKS[id] ? BLOCKS[id].solid : false; }
export function isOpaque(id) { return BLOCKS[id] ? BLOCKS[id].opacity === 'opaque' : true; }
export function isPlant(id) { return BLOCKS[id] ? BLOCKS[id].plant : false; }
export function isCutout(id) { return BLOCKS[id] ? BLOCKS[id].opacity === 'cutout' : false; }

// 可放置方块列表（快捷栏/背包中可右键放置）
export const PLACEABLE = new Set([
  B.GRASS, B.DIRT, B.STONE, B.SAND, B.LOG, B.LEAVES, B.PLANKS,
  B.FERROCK, B.COPPER_ORE, B.GOLD_ORE, B.COAL_ORE, B.HULL, B.HULL_DARK, B.GLASS, B.SCORCHED,
  B.RED_SAND, B.SNOW, B.STONE_BRICK, B.BASE_UNIT, B.STORAGE,
]);
