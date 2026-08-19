// 空间站任务板：探索悬赏 / 送货 / 猎杀 / 采矿四类可重复任务（纯数据 + 纯逻辑）。
export const MISSION_TEMPLATES = [
  { id: 'visit_mars', kind: 'visit', target: 'planet:solar.mars', need: 1, reward: 120,
    label: '探索悬赏：火星', desc: '飞抵并降落在火星' },
  { id: 'visit_luna', kind: 'visit', target: 'moon:solar.earth.luna', need: 1, reward: 150,
    label: '探索悬赏：月球', desc: '降落在地球的卫星——月球' },
  { id: 'deliver_ferrite', kind: 'deliver', item: 'ferrite_dust', need: 20, reward: 90,
    label: '物资补给：铁氧体', desc: '向空间站交付 20 铁氧体粉尘' },
  { id: 'deliver_gold', kind: 'deliver', item: 'gold_ore', need: 5, reward: 140,
    label: '贵金属订单：金矿', desc: '向空间站交付 5 金矿石' },
  { id: 'hunt_brute', kind: 'kill', mob: 'brute', need: 3, reward: 110,
    label: '猎杀悬赏：夜行兽', desc: '在任意行星夜间消灭 3 只夜行兽' },
  { id: 'mine_blocks', kind: 'mine', need: 40, reward: 80,
    label: '矿区采掘：40 方块', desc: '累计挖掘 40 个任意方块' },
];

export const MISSION_COOLDOWN = 60; // 完成后 60 秒才能接下一单

export function createMission(template) {
  return {
    id: template.id,
    kind: template.kind,
    target: template.target || null,
    mob: template.mob || null,
    item: template.item || null,
    need: template.need,
    reward: template.reward,
    label: template.label,
    desc: template.desc,
    progress: 0,
  };
}

// 任务推进：visit=到达目标天体 / kill=击杀指定生物 / mine=任意挖掘。
// 返回是否发生了进度变化。
export function missionEvent(m, event, payload = {}) {
  if (!m) return false;
  let hit = false;
  if (event === 'visit' && m.kind === 'visit') hit = String(payload.target || '') === m.target;
  else if (event === 'kill' && m.kind === 'kill') hit = !payload.burn && String(payload.mob || '') === m.mob;
  else if (event === 'mine' && m.kind === 'mine') hit = true;
  if (!hit) return false;
  m.progress = Math.min(m.need, m.progress + 1);
  return true;
}

export function missionReady(m) {
  return !!m && m.progress >= m.need;
}

export function missionProgressText(m) {
  if (!m) return '';
  return m.kind === 'deliver' ? '等待交付' : `${m.progress}/${m.need}`;
}

// 任务板提供 3 个不同的悬赏（简单确定性轮换；种子在接单后推进）
export function missionOffers(seed) {
  const n = MISSION_TEMPLATES.length;
  const base = ((seed % n) + n) % n;
  const ids = new Set();
  const out = [];
  for (let i = 0; out.length < 3; i++) {
    const t = MISSION_TEMPLATES[(base + i) % n];
    if (ids.has(t.id)) continue;
    ids.add(t.id);
    out.push(t);
  }
  return out;
}
