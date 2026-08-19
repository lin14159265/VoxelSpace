// 里程碑（成就）系统：游玩过程中的正反馈脉冲——纯数据 + 纯逻辑，可测试。
// 与现有系统咬合：挖掘/合成/击杀/起飞/太空/降落/停靠/跃迁/日志/异常点/信用点
// 都会推进对应统计，达标即弹出"★ 里程碑达成"提示；已达成随存档保存。
export const MILESTONES = [
  { id: 'first_mine', stat: 'mine', need: 1, name: '第一次挖掘', desc: '挖开第一块方块', reward: 5 },
  { id: 'miner_100', stat: 'mine', need: 100, name: '矿工', desc: '累计挖掘 100 个方块', reward: 40 },
  { id: 'builder_12', stat: 'place', need: 12, name: '小小建筑师', desc: '放置 12 个方块', reward: 20 },
  { id: 'first_craft', stat: 'craft', need: 1, name: '第一件造物', desc: '完成第一次合成', reward: 10 },
  { id: 'craftsman_10', stat: 'craft', need: 10, name: '熟练工匠', desc: '累计合成 10 次', reward: 30 },
  { id: 'first_kill', stat: 'kill', need: 1, name: '猎手', desc: '消灭第一只异星生物', reward: 30 },
  { id: 'hunter_10', stat: 'kill', need: 10, name: '生物清除者', desc: '累计消灭 10 只生物', reward: 100 },
  { id: 'loremaster', stat: 'logs', need: 3, name: '坠机档案', desc: '收集全部 3 篇数据日志', reward: 60 },
  { id: 'anomalist', stat: 'anomalies', need: 3, name: '遗迹调查员', desc: '调查 3 处异常点', reward: 60 },
  { id: 'merchant', stat: 'creditsEarned', need: 100, name: '太空商人', desc: '累计赚取 100 信用点', reward: 40 },
  { id: 'ship_repaired', stat: 'shipRepaired', need: 1, name: '机械师', desc: '完全修复飞船', reward: 100 },
  { id: 'first_flight', stat: 'launch', need: 1, name: '起飞', desc: '驾驶飞船升空', reward: 100 },
  { id: 'astronaut', stat: 'space', need: 1, name: '宇航员', desc: '突破大气层进入太空', reward: 150 },
  { id: 'wanderer', stat: 'planets', need: 2, name: '星际旅人', desc: '造访 2 颗行星', reward: 250 },
  { id: 'moonwalker', stat: 'moons', need: 1, name: '月面漫步', desc: '降落在天然卫星', reward: 200 },
  { id: 'moon_hopper', stat: 'moons', need: 3, name: '卫星巡游者', desc: '降落 3 颗天然卫星', reward: 350 },
  { id: 'belt_miner', stat: 'beltHarvest', need: 5, name: '小行星矿工', desc: '开采小行星带 5 次', reward: 150 },
  { id: 'dock', stat: 'dock', need: 1, name: '空间站访客', desc: '停靠轨道空间站', reward: 100 },
  { id: 'galaxy_hopper', stat: 'warp', need: 1, name: '星系跳跃者', desc: '跨星系跃迁', reward: 400 },
  { id: 'mining_expert', stat: 'toolTier2', need: 1, name: '矿脉切割者', desc: '获得采矿光束 MkII', reward: 80 },
  { id: 'weapon_smith', stat: 'weaponMod', need: 1, name: '能量武器匠', desc: '安装能量线圈', reward: 80 },
  { id: 'home_owner', stat: 'base', need: 1, name: '安家落户', desc: '建立基地终端', reward: 100 },
  { id: 'space_ace', stat: 'pirateKill', need: 1, name: '深空王牌', desc: '击落第一架海盗拦截机', reward: 120 },
];

export class Milestones {
  constructor(game) {
    this.game = game;
    this.data = {};
    this.earned = new Set();
    this.pending = [];   // 背包已满时暂缓的里程碑奖励 id（有空位后自动补发）
    for (const m of MILESTONES) this.data[m.stat] = this.data[m.stat] || 0;
  }

  bump(stat, n = 1) {
    if (!(stat in this.data)) return;
    this.data[stat] += n;
    for (const m of MILESTONES) {
      if (m.stat !== stat || this.earned.has(m.id)) continue;
      if (this.data[stat] >= m.need) this.earn(m);
    }
  }

  // 里程碑奖励：探索/成长直接发信用点——"探索赚钱"替代"纯刷矿卖钱"。
  // 背包放不下时进入 pending 队列，由 Game.loop 在有空格/可堆叠时自动补发。
  grantReward(m) {
    const g = this.game;
    const reward = m.reward || 0;
    if (!reward || !g.inventory) return '';
    if (g.inventory.canAdd('credits', reward)) {
      this.addRewardCredits(m, reward);
      g.ui.renderHotbar(g.inventory.hotbar(), g.inventory.selected);
      return ` · 奖励 +${reward} 信用点`;
    }
    if (!this.pending.includes(m.id)) this.pending.push(m.id);
    return ' · 背包已满，奖励将在有空位时自动补发';
  }

  // 真正入账：加信用点并推进 creditsEarned（可能连锁点亮"太空商人"）。
  addRewardCredits(m, reward) {
    const g = this.game;
    g.inventory.addItem('credits', reward);
    this.bump('creditsEarned', reward);
  }

  // 每帧由 Game.loop 调用：补发所有已可容纳的暂缓奖励。
  // 队列采用快照处理，连锁里程碑新产生的 pending 留到下一轮，避免在迭代中被覆盖丢失。
  flushPendingRewards() {
    const g = this.game;
    if (!g.inventory || !this.pending.length) return 0;
    const queue = this.pending;
    this.pending = [];
    const granted = [];
    let total = 0;
    for (const id of queue) {
      const m = MILESTONES.find((x) => x.id === id);
      if (!m || !m.reward) continue;
      if (!g.inventory.canAdd('credits', m.reward)) {
        this.pending.push(id);
        continue;
      }
      this.addRewardCredits(m, m.reward);
      total += m.reward;
      granted.push(m.name);
    }
    if (total > 0) {
      if (g.ui.renderHotbar) g.ui.renderHotbar(g.inventory.hotbar(), g.inventory.selected);
      if (g.ui.toast) g.ui.toast(`★ 里程碑奖励补发：${granted.join('、')} · +${total} 信用点`, false);
      if (g.audio && g.audio.play) g.audio.play('quest');
    }
    return total;
  }

  earn(m) {
    this.earned.add(m.id);
    const g = this.game;
    const rewardText = this.grantReward(m);
    if (this.earned.size === MILESTONES.length) {
      // 全成就达成：最终奖励时刻
      g.audio.play('quest');
      g.audio.play('warp');
      g.ui.toast('★ 全成就达成 · 星际大师', false);
    } else {
      g.audio.play('quest');
      g.ui.toast(`★ 里程碑达成：${m.name}${rewardText}`, false);
    }
  }

  get allEarned() { return this.earned.size === MILESTONES.length; }

  earnedList() { return MILESTONES.filter((m) => this.earned.has(m.id)); }
  get total() { return MILESTONES.length; }
  get earnedCount() { return this.earned.size; }

  // 存档
  collect() { return { data: { ...this.data }, earned: [...this.earned], pending: [...this.pending] }; }
  apply(d) {
    if (!d) return;
    for (const m of MILESTONES) this.data[m.stat] = d.data && d.data[m.stat] !== undefined ? d.data[m.stat] : (this.data[m.stat] || 0);
    this.earned = new Set(d.earned || []);
    // 旧存档无 pending 字段 → 空队列（已点亮但暂缓的奖励在旧档中本就无记录，兼容）
    this.pending = Array.isArray(d.pending)
      ? d.pending.filter((id) => MILESTONES.some((m) => m.id === id))
      : [];
  }
}
