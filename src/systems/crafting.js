// 合成系统：配方定义与材料检查/合成（纯逻辑，可测试）
// 配方风格参考 NMS 前期：铁氧体→金属镀层、二氢→二氢凝胶→发射燃料等

export const RECIPES = [
  { id: 'planks', name: '木制板材 ×4', out: { item: 'planks', count: 4 }, in: { log: 1 } },
  { id: 'metal_plating', name: '金属镀层', out: { item: 'metal_plating', count: 1 }, in: { ferrite_dust: 4 } },
  { id: 'hermetic_seal', name: '密封胶', out: { item: 'hermetic_seal', count: 1 }, in: { carbon: 2, ferrite_dust: 2 } },
  { id: 'di_hydrogen_jelly', name: '二氢凝胶', out: { item: 'di_hydrogen_jelly', count: 1 }, in: { di_hydrogen: 5 } },
  { id: 'launch_fuel', name: '飞船发射燃料', out: { item: 'launch_fuel', count: 1 }, in: { di_hydrogen_jelly: 1, metal_plating: 1 } },
  { id: 'glass', name: '强化玻璃 ×2', out: { item: 'glass', count: 2 }, in: { sand: 2 } },
  { id: 'carbon_burn', name: '碳 ×4（烧制原木）', out: { item: 'carbon', count: 4 }, in: { log: 1 } },
  { id: 'multitool', name: '多功能工具', out: { item: 'multitool', count: 1 }, in: { metal_plating: 3, carbon: 4 } },
  { id: 'shield_cell', name: '护盾电池', out: { item: 'shield_cell', count: 1 }, in: { sodium: 3, ferrite_dust: 2 } },
  { id: 'stone_brick', name: '石砖 ×4', out: { item: 'stone_brick', count: 4 }, in: { stone: 4 } },
  { id: 'mining_beam_mk2', name: '采矿光束 MkII', out: { item: 'mining_beam_mk2', count: 1 }, in: { multitool: 1, copper_ore: 4, gold_ore: 2, glass: 1 } },
  { id: 'energy_coil', name: '能量线圈', out: { item: 'energy_coil', count: 1 }, in: { copper_ore: 3, carbon: 4, gold_ore: 1 } },
  { id: 'base_unit', name: '基地终端', out: { item: 'base_unit', count: 1 }, in: { metal_plating: 2, glass: 1, carbon: 4 } },
  { id: 'storage_crate', name: '储物箱', out: { item: 'storage_crate', count: 1 }, in: { planks: 4, metal_plating: 1 } },
];

export function recipeById(id) {
  return RECIPES.find((r) => r.id === id) || null;
}

// 材料是否足够
export function canCraft(inventory, recipe) {
  for (const itemId of Object.keys(recipe.in)) {
    if (inventory.countOf(itemId) < recipe.in[itemId]) return false;
  }
  return true;
}

// 材料缺口（用于 UI 红字提示）
export function missingOf(inventory, recipe) {
  const missing = [];
  for (const itemId of Object.keys(recipe.in)) {
    const need = recipe.in[itemId] - inventory.countOf(itemId);
    if (need > 0) missing.push({ item: itemId, need });
  }
  return missing;
}

// 执行合成；成功返回 true 并扣材料+给产物。
// 背包放不下产物时不合成（先容量预检再扣材料，防止满背包合成吞材料）
export function craft(inventory, recipe) {
  if (!canCraft(inventory, recipe)) return false;
  if (!inventory.canAdd(recipe.out.item, recipe.out.count)) return false;
  for (const itemId of Object.keys(recipe.in)) {
    inventory.removeItem(itemId, recipe.in[itemId]);
  }
  inventory.addItem(recipe.out.item, recipe.out.count);
  return true;
}
