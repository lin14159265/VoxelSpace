// 物品注册表 + 背包（9 快捷栏 + 27 背包格，支持堆叠）
import { TILE } from '../world/tiles.js';
import { B } from '../world/blocks.js';
import { MAX_STACK } from '../core/constants.js';

export const ITEMS = {
  dirt:          { id: 'dirt', name: '泥土', tile: TILE.DIRT, stack: 64, block: B.DIRT },
  stone:         { id: 'stone', name: '岩石', tile: TILE.STONE, stack: 64, block: B.STONE },
  sand:          { id: 'sand', name: '沙地', tile: TILE.SAND, stack: 64, block: B.SAND },
  red_sand:      { id: 'red_sand', name: '红色沙地', tile: TILE.RED_SAND, stack: 64, block: B.RED_SAND },
  snow:          { id: 'snow', name: '雪层', tile: TILE.SNOW, stack: 64, block: B.SNOW },
  stone_brick:   { id: 'stone_brick', name: '石砖', tile: TILE.STONE_BRICK, stack: 64, block: B.STONE_BRICK },
  log:           { id: 'log', name: '异星原木', tile: TILE.LOG_SIDE, stack: 64, block: B.LOG },
  leaves:        { id: 'leaves', name: '异星树叶', tile: TILE.LEAVES, stack: 64, block: B.LEAVES },
  planks:        { id: 'planks', name: '木制板材', tile: TILE.PLANKS, stack: 64, block: B.PLANKS },
  ferrite_dust:  { id: 'ferrite_dust', name: '铁氧体粉尘', tile: TILE.FERRITE_DUST, stack: MAX_STACK },
  copper_ore:    { id: 'copper_ore', name: '铜矿石', tile: TILE.COPPER_ORE, stack: 64, block: B.COPPER_ORE },
  gold_ore:      { id: 'gold_ore', name: '金矿石', tile: TILE.GOLD_ORE, stack: 64, block: B.GOLD_ORE },
  carbon:        { id: 'carbon', name: '碳', tile: TILE.CARBON, stack: MAX_STACK },
  di_hydrogen:   { id: 'di_hydrogen', name: '二氢', tile: TILE.DIHYDROGEN, stack: MAX_STACK },
  sodium:        { id: 'sodium', name: '钠', tile: TILE.SODIUM, stack: MAX_STACK },
  oxygen:        { id: 'oxygen', name: '氧', tile: TILE.OXYGEN, stack: MAX_STACK },
  hull:          { id: 'hull', name: '飞船外壳板', tile: TILE.HULL, stack: 64, block: B.HULL },
  hull_dark:     { id: 'hull_dark', name: '烧蚀外壳板', tile: TILE.HULL_DARK, stack: 64, block: B.HULL_DARK },
  glass:         { id: 'glass', name: '强化玻璃', tile: TILE.GLASS, stack: 64, block: B.GLASS },
  // 制作产物
  metal_plating: { id: 'metal_plating', name: '金属镀层', tile: TILE.METAL_PLATING, stack: 64 },
  di_hydrogen_jelly: { id: 'di_hydrogen_jelly', name: '二氢凝胶', tile: TILE.DIHYDROGEN_JELLY, stack: 64 },
  launch_fuel:   { id: 'launch_fuel', name: '飞船发射燃料', tile: TILE.LAUNCH_FUEL, stack: 64 },
  hermetic_seal: { id: 'hermetic_seal', name: '密封胶', tile: TILE.HERMETIC_SEAL, stack: 64 },
  shield_cell:   { id: 'shield_cell', name: '护盾电池', tile: TILE.SHIELD_CELL, stack: 64 },
  // 工具
  multitool:     { id: 'multitool', name: '多功能工具', tile: TILE.MULTITOOL, stack: 1, tool: true, miningTier: 1 },
  mining_beam_mk2: { id: 'mining_beam_mk2', name: '采矿光束 MkII', tile: TILE.MINING_BEAM_MK2, stack: 1, tool: true, miningTier: 2 },
  energy_coil:    { id: 'energy_coil', name: '能量线圈', tile: TILE.ENERGY_COIL, stack: 1, tool: true, weaponMod: true },
  base_unit:      { id: 'base_unit', name: '基地终端', tile: TILE.BASE_UNIT, stack: 1, block: B.BASE_UNIT },
  storage_crate:  { id: 'storage_crate', name: '储物箱', tile: TILE.STORAGE, stack: 1, block: B.STORAGE },
  // 货币
  credits:       { id: 'credits', name: '信用点', tile: TILE.CREDITS, stack: MAX_STACK },
};

export const HOTBAR_SIZE = 9;
export const PACK_SIZE = 27;
export const TOTAL_SLOTS = HOTBAR_SIZE + PACK_SIZE;

export class Inventory {
  constructor() {
    this.slots = new Array(TOTAL_SLOTS).fill(null); // { itemId, count }
    this.selected = 0;
  }

  countOf(itemId) {
    let n = 0;
    for (const s of this.slots) if (s && s.itemId === itemId) n += s.count;
    return n;
  }

  // 返回实际加入数量
  addItem(itemId, count) {
    const item = ITEMS[itemId];
    if (!item) return 0;
    let remaining = count;
    let added = 0;
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.itemId === itemId && s.count < item.stack) {
        const take = Math.min(item.stack - s.count, remaining);
        s.count += take; remaining -= take; added += take;
      }
    }
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(item.stack, remaining);
        this.slots[i] = { itemId, count: take };
        remaining -= take; added += take;
      }
    }
    return added;
  }

  removeItem(itemId, count) {
    let remaining = count;
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.itemId === itemId) {
        const take = Math.min(s.count, remaining);
        s.count -= take; remaining -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return remaining === 0;
  }

  // 容量预检：count 个单位能否全部放入（既有堆叠 + 空格）。
  // 合成/购买/交付必须先 canAdd 再扣材料——否则背包满时材料/信用点被吞、
  // 产物凭空消失（历史 bug 类：先扣后加，加不进就丢）。
  canAdd(itemId, count) {
    const item = ITEMS[itemId];
    if (!item) return false;
    let remaining = count;
    for (const s of this.slots) {
      if (s && s.itemId === itemId) remaining -= Math.min(item.stack - s.count, remaining);
      if (remaining <= 0) return true;
    }
    for (const s of this.slots) {
      if (!s) remaining -= Math.min(item.stack, remaining);
      if (remaining <= 0) return true;
    }
    return remaining <= 0;
  }

  getSelected() { return this.slots[this.selected]; }
  select(i) { if (i >= 0 && i < HOTBAR_SIZE) this.selected = i; }
  cycle(delta) { this.selected = (this.selected + delta + HOTBAR_SIZE) % HOTBAR_SIZE; }
  hotbar() { return this.slots.slice(0, HOTBAR_SIZE); }

  // 整理背包（只整理 27 格背包区，不动快捷栏，避免选中项漂移）：
  // 有物品在前、空位在后，按物品中文名排序（纯逻辑，可测试）
  sortPack() {
    const pack = this.slots.slice(HOTBAR_SIZE);
    const filled = pack.filter(Boolean).sort((a, b) => {
      const na = (ITEMS[a.itemId] ? ITEMS[a.itemId].name : a.itemId);
      const nb = (ITEMS[b.itemId] ? ITEMS[b.itemId].name : b.itemId);
      return na.localeCompare(nb, 'zh');
    });
    for (let i = 0; i < pack.length; i++) {
      this.slots[HOTBAR_SIZE + i] = filled[i] || null;
    }
    return true;
  }

  // 寻找持有指定物品的快捷栏格
  findInHotbar(itemId) {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.slots[i] && this.slots[i].itemId === itemId) return i;
    }
    return -1;
  }
}
