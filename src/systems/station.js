// 空间站：交易价格 / 收购订单 / 飞船升级（纯数据 + 纯逻辑，可测试）
// 卖出价：玩家把资源卖给空间站，获得信用点
export const STATION_SELL = {
  ferrite_dust: 3, copper_ore: 5, gold_ore: 10, carbon: 2,
  di_hydrogen: 2, sodium: 2, oxygen: 2,
  stone: 1, sand: 1, red_sand: 1, snow: 1, dirt: 1,
  log: 2, leaves: 1, planks: 3, hull: 6, hull_dark: 4, glass: 5, stone_brick: 2,
  base_unit: 40, storage_crate: 30,
};
// 买入价：玩家用信用点购买
export const STATION_BUY = {
  metal_plating: 18, hermetic_seal: 12, launch_fuel: 25,
  glass: 10, hull: 8, ferrite_dust: 5, carbon: 4, stone_brick: 6,
  mining_beam_mk2: 800,
  energy_coil: 450,
  base_unit: 160,
  storage_crate: 90,
  di_hydrogen: 4, sodium: 4, oxygen: 4, multitool: 120,
};
// 收购订单（任务中心）：交付指定数量 → 一次性奖励（比散卖更划算）
// 可重复订单冷却（秒）：交完一单后需间隔此时间才能再交同单。
export const ORDER_COOLDOWN = 45;

export const STATION_ORDERS = [
  { id: 'order1', label: '铁氧体供应', item: 'ferrite_dust', need: 15, reward: 60 },
  { id: 'order2', label: '贵金属回收', item: 'gold_ore', need: 5, reward: 75 },
  { id: 'order3', label: '燃料补给', item: 'launch_fuel', need: 2, reward: 70 },
];
// 飞船升级（船坞购买；engine 每级 +10 最大速度，shield 每级 +50 护盾上限，
// bigship 解锁跨星系跃迁与脉冲提速）
// 第 47 轮经济节奏：探索/里程碑奖励信用点后，飞船线价格下调到
// 主线奖励 + 少量交易即可负担；把"刷矿卖钱"降级为可选项而非必经之路。
export const SHIP_UPGRADES = [
  { id: 'engine1', label: '引擎升级 Lv1', cost: 150, engine: 1, desc: '最大速度 +10' },
  { id: 'engine2', label: '引擎升级 Lv2', cost: 350, engine: 2, desc: '最大速度 +20' },
  { id: 'shield1', label: '护盾扩容 Lv1', cost: 100, shield: 1, desc: '护盾上限 +50' },
  { id: 'shield2', label: '护盾扩容 Lv2', cost: 250, shield: 2, desc: '护盾上限 +100' },
  { id: 'bigship', label: '大型殖民船 · 曙光号', cost: 800, bigship: true,
    desc: '解锁比邻星跃迁 · 脉冲提速', prereq: '需引擎 Lv2 + 护盾 Lv1' },
];

export function sellPriceOf(itemId) { return STATION_SELL[itemId] || 0; }
export function buyPriceOf(itemId) { return STATION_BUY[itemId] || 0; }

// 出售：返回获得信用点（0 = 无货/不可售/信用点放不下）
export function stationSell(inventory, itemId, count) {
  const price = sellPriceOf(itemId);
  if (!price) return 0;
  const have = inventory.countOf(itemId);
  const n = Math.max(0, Math.min(count, have));
  if (n <= 0) return 0;
  const credits = price * n;
  if (!inventory.canAdd('credits', credits)) return 0; // 容量预检：货不能白卖
  inventory.removeItem(itemId, n);
  inventory.addItem('credits', credits);
  return credits;
}

// 购买：返回是否成功（信用点不足 / 背包放不下都不成交，不退冤枉钱）
export function stationBuy(inventory, itemId, count) {
  const price = buyPriceOf(itemId);
  if (!price) return false;
  const cost = price * count;
  if (inventory.countOf('credits') < cost) return false;
  if (!inventory.canAdd(itemId, count)) return false;
  inventory.removeItem('credits', cost);
  inventory.addItem(itemId, count);
  return true;
}

// 订单交付：材料足够且奖励放得下则扣除并发放奖励
export function stationDeliver(inventory, order) {
  if (!order || inventory.countOf(order.item) < order.need) return false;
  if (!inventory.canAdd('credits', order.reward)) return false;
  inventory.removeItem(order.item, order.need);
  inventory.addItem('credits', order.reward);
  return true;
}

// 飞船升级：检查当前等级与信用点
export function upgradeInfo(upgrades, level) {
  const target = SHIP_UPGRADES.find((u) => u.engine === level + 1 || u.shield === level + 1);
  return target || null;
}

export function stationUpgrade(inventory, upgrades, upgradeId) {
  const def = SHIP_UPGRADES.find((u) => u.id === upgradeId);
  if (!def) return { ok: false, reason: 'unknown' };
  // 必须逐级购买（engine1→engine2 / shield1→shield2）；大船需前置升级
  if (def.engine && def.engine !== (upgrades.engine || 0) + 1) return { ok: false, reason: 'order' };
  if (def.shield && def.shield !== (upgrades.shield || 0) + 1) return { ok: false, reason: 'order' };
  if (def.bigship && ((upgrades.engine || 0) < 2 || (upgrades.shield || 0) < 1)) {
    return { ok: false, reason: 'need' };
  }
  if (inventory.countOf('credits') < def.cost) return { ok: false, reason: 'poor' };
  inventory.removeItem('credits', def.cost);
  if (def.engine) upgrades.engine = def.engine;
  if (def.shield) upgrades.shield = def.shield;
  if (def.bigship) upgrades.bigship = 1;
  return { ok: true };
}
