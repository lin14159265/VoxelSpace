// 储物箱：12 格基地仓库（纯逻辑，可测试）。
// 与玩家背包同一套堆叠规则：相同物品先合并，空格继续放，装不下返回实际装入数。
import { ITEMS } from './inventory.js';

export const CRATE_SIZE = 12;

export function createCrate(id = '', x = 0, y = 0, z = 0) {
  return { id, x, y, z, slots: new Array(CRATE_SIZE).fill(null) };
}

export function crateCanAdd(crate, itemId, count) {
  const item = ITEMS[itemId];
  if (!item) return false;
  let remaining = count;
  for (const s of crate.slots) {
    if (s && s.itemId === itemId) remaining -= Math.min(item.stack - s.count, remaining);
    if (remaining <= 0) return true;
  }
  for (const s of crate.slots) {
    if (!s) remaining -= Math.min(item.stack, remaining);
    if (remaining <= 0) return true;
  }
  return remaining <= 0;
}

export function crateAdd(crate, itemId, count) {
  const item = ITEMS[itemId];
  if (!item) return 0;
  let remaining = count;
  let added = 0;
  for (const s of crate.slots) {
    if (s && s.itemId === itemId && s.count < item.stack) {
      const take = Math.min(item.stack - s.count, remaining);
      s.count += take; remaining -= take; added += take;
    }
  }
  for (let i = 0; i < crate.slots.length && remaining > 0; i++) {
    if (!crate.slots[i]) {
      const take = Math.min(item.stack, remaining);
      crate.slots[i] = { itemId, count: take };
      remaining -= take; added += take;
    }
  }
  return added;
}

// 从箱子指定格取走 count；若数量归零则清空格。
export function crateTake(crate, slotIndex, count = Infinity) {
  const s = crate.slots[slotIndex];
  if (!s || slotIndex < 0 || slotIndex >= crate.slots.length) return 0;
  const take = Math.min(s.count, count);
  s.count -= take;
  if (s.count <= 0) crate.slots[slotIndex] = null;
  return take;
}

// 序列化：只保存非空格。
export function collectCrates(crates) {
  return (crates || []).map((c) => ({ ...c, slots: c.slots.map((s) => (s ? { itemId: s.itemId, count: s.count } : null)) }));
}

export function restoreCrates(list) {
  return (list || []).map((c) => ({
    id: c.id || '',
    x: c.x || 0, y: c.y || 0, z: c.z || 0,
    slots: Array.from({ length: CRATE_SIZE }, (_, i) => {
      const s = c.slots && c.slots[i];
      return s && ITEMS[s.itemId] ? { itemId: s.itemId, count: Math.max(1, Math.floor(s.count || 1)) } : null;
    }),
  }));
}
