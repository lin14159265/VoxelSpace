// 任务引导系统：还原 NMS 前期流程（坠毁 → 采集 → 工具 → 庇护所 → 修复 → 起飞 → 星际）
export const STEP_DEFS = [
  { id: 'checkShip', title: '检查坠毁的飞船', need: 1, detail: '接近飞船残骸并按 E 检查' },
  { id: 'gather', title: '采集基础资源', need: 15, detail: '挖掘岩石、植物以收集资源' },
  { id: 'craftTool', title: '制作多功能工具', need: 1, detail: '在背包中用金属镀层+碳合成（Tab）' },
  { id: 'shelter', title: '建造简易庇护所', need: 12, detail: '放置 12 个方块搭建庇护所（右键）' },
  { id: 'dihy', title: '收集二氢晶体 ×3', need: 3, detail: '挖掘发光的蓝色晶体（二氢）' },
  { id: 'ferrite', title: '收集铁氧体粉尘 ×4', need: 4, detail: '挖掘锈红色的铁氧体矿脉' },
  { id: 'craftPlating', title: '制作金属镀层 ×2', need: 2, detail: '按 Tab 打开背包，用铁氧体粉尘合成金属镀层' },
  { id: 'repairPulse', title: '修复脉冲引擎', need: 1, detail: '靠近飞船按 E，用金属镀层+密封胶修复' },
  { id: 'repairGlass', title: '更换座舱玻璃', need: 1, detail: '靠近飞船按 E，用强化玻璃+金属镀层修复驾驶舱' },
  { id: 'fuelLaunch', title: '为发射推进器补充燃料', need: 1, detail: '合成发射燃料，在飞船面板中注入推进器' },
  { id: 'launch', title: '起飞离开这颗星球', need: 1, detail: '登上飞船，点燃引擎' },
  { id: 'space', title: '飞入太空 · 探索星系', need: 1, detail: '持续爬升，穿越大气层' },
  { id: 'explore', title: '探索另一颗星球', need: 1, detail: '打开星图 [M] 选择目标行星，跃迁并降落' },
  { id: 'stationVisit', title: '造访地球轨道空间站', need: 1, detail: '太空接近空间站后按 E 停靠' },
  { id: 'proximaSignal', title: '与站长了解深空信号', need: 1, detail: '在空间站人员页与站长对话' },
  { id: 'bigShip', title: '购买大型殖民船', need: 1, detail: '船坞购买曙光号（需引擎Lv2+护盾Lv1+1500信用点）' },
  { id: 'reachProxima', title: '跃迁至比邻星系', need: 1, detail: '星图设定比邻星系跃迁点，飞往并穿越' },
];

export class Quests {
  constructor(game) {
    this.game = game;
    this.data = {
      checkShip: 0, gather: 0, craftTool: 0, shelter: 0, dihy: 0, ferrite: 0,
      craftPlating: 0, repairPulse: 0, repairGlass: 0, fuelLaunch: 0, launch: 0, space: 0, explore: 0,
      stationVisit: 0, proximaSignal: 0, bigShip: 0, reachProxima: 0,
    };
    this.completedIds = new Set();
    this.currentIndex = 0;
  }

  stepDef(id) { return STEP_DEFS.find((s) => s.id === id); }
  get currentStep() { return STEP_DEFS[this.currentIndex]; }
  get allDone() { return this.currentIndex >= STEP_DEFS.length - 1 && this.completedIds.has(STEP_DEFS[STEP_DEFS.length - 1].id); }

  onMine(blockId, dropItem, dropCount) {
    if (this.currentStep.id === 'gather') {
      this.data.gather = Math.min(this.currentStep.need, this.data.gather + 1);
      this.checkCurrent();
    }
    if (this.currentStep.id === 'dihy' && dropItem === 'di_hydrogen') {
      this.data.dihy = Math.min(this.currentStep.need, this.data.dihy + dropCount);
      this.checkCurrent();
    }
    if (this.currentStep.id === 'ferrite' && dropItem === 'ferrite_dust') {
      this.data.ferrite = Math.min(this.currentStep.need, this.data.ferrite + dropCount);
      this.checkCurrent();
    }
    this.render();
  }

  onInteractShip() {
    if (this.currentStep.id === 'checkShip') {
      this.data.checkShip = 1;
      this.completeCurrent();
    }
  }

  onCraft(itemId, count) {
    if (this.currentStep.id === 'craftTool' && itemId === 'multitool') {
      this.data.craftTool = Math.min(this.currentStep.need, this.data.craftTool + count);
      this.checkCurrent();
      this.render();
    }
    if (this.currentStep.id === 'craftPlating' && itemId === 'metal_plating') {
      this.data.craftPlating = Math.min(this.currentStep.need, this.data.craftPlating + count);
      this.checkCurrent();
      this.render();
    }
  }

  // 放置方块（庇护所步骤）
  onPlace(blockId) {
    if (this.currentStep.id === 'shelter') {
      this.data.shelter = Math.min(this.currentStep.need, this.data.shelter + 1);
      this.checkCurrent();
      this.render();
    }
  }

  // 飞船修复通知：component = 'pulse' | 'glass' | 'thruster'
  onShipRepair(component) {
    if (this.currentStep.id === 'repairPulse' && component === 'pulse') {
      this.data.repairPulse = 1;
      this.completeCurrent();
    } else if (this.currentStep.id === 'repairGlass' && component === 'glass') {
      this.data.repairGlass = 1;
      this.completeCurrent();
    } else if (this.currentStep.id === 'fuelLaunch' && component === 'thruster') {
      this.data.fuelLaunch = 1;
      this.completeCurrent();
    }
  }

  // 起飞通知（飞船离地）
  onLaunch() {
    if (this.currentStep.id === 'launch') {
      this.data.launch = 1;
      this.completeCurrent();
    }
  }

  // 进入太空
  onEnterSpace() {
    if (this.currentStep.id === 'space') {
      this.data.space = 1;
      this.completeCurrent();
    }
  }

  // 降落在新行星
  onPlanetLand() {
    if (this.currentStep.id === 'explore') {
      this.data.explore = 1;
      this.completeCurrent();
    }
  }

  // 停靠空间站
  onStationDock() {
    if (this.currentStep.id === 'stationVisit') {
      this.data.stationVisit = 1;
      this.completeCurrent();
    }
  }

  // 与 NPC 对话（站长线）
  onNpcTalk(npcId) {
    if (this.currentStep.id === 'proximaSignal' && npcId === 'kaela') {
      this.data.proximaSignal = 1;
      this.completeCurrent();
    }
  }

  // 购买大型殖民船
  onBigShip() {
    if (this.currentStep.id === 'bigShip') {
      this.data.bigShip = 1;
      this.completeCurrent();
    }
  }

  // 到达比邻星系（多星系大任务终点）
  onReachProxima(target) {
    if (target !== 'proxima') return;
    if (this.currentStep.id === 'reachProxima') {
      this.data.reachProxima = 1;
      this.completeCurrent();
    }
    const g = this.game;
    if (this.allDone && !g.journeyShown) {
      g.journeyShown = true;
      setTimeout(() => g.showJourney(), 1800);
    }
  }

  checkCurrent() {
    if (this.data[this.currentStep.id] >= this.currentStep.need) this.completeCurrent();
  }

  // 跳过已完成的步骤（飞船状态同步可能提前标记后续维修步骤）
  skipCompleted() {
    let guard = 0;
    while (guard++ < STEP_DEFS.length && this.currentIndex < STEP_DEFS.length - 1
      && this.completedIds.has(STEP_DEFS[this.currentIndex].id)) {
      this.currentIndex++;
    }
  }

  // 任务与飞船真实修复状态自动同步：
  // 乱序修复 / 创造模式一次性修完时，任务列表与顶部目标即时反映真实状态，
  // 而不是死守固定顺序。
  syncShip(ship) {
    if (!ship) return;
    const map = { repairPulse: 'pulseOk', repairGlass: 'glassOk', fuelLaunch: 'thrusterOk' };
    // 1) 组件已修复 → 对应任务标记完成（列表立即显示 ✔，无论当前步骤在哪）
    for (const stepId of Object.keys(map)) {
      if (ship[map[stepId]]) {
        this.data[stepId] = 1;
        this.completedIds.add(stepId);
      }
    }
    // 2) 若当前步骤恰好是已修复的维修步骤 → 顺序推进（带任务完成提示）
    let guard = 0;
    while (guard++ < 4 && this.currentStep && map[this.currentStep.id] && this.completedIds.has(this.currentStep.id)) {
      this.completeCurrent();
    }
    // 3) 渲染任务列表（标记变更即时可见）
    this.render();
  }

  completeCurrent() {
    this.completedIds.add(this.currentStep.id);
    const g = this.game;
    g.audio.play('quest');
    g.ui.toast(`任务完成：${this.currentStep.title}`);
    this.currentIndex = Math.min(STEP_DEFS.length - 1, this.currentIndex + 1);
    this.skipCompleted();
    this.render();
  }

  // 当前任务对应的合成配方（用于背包内高亮置顶，降低新手搜索成本）
  requiredRecipeId() {
    const map = {
      craftTool: 'multitool',
      craftPlating: 'metal_plating',
      repairPulse: 'hermetic_seal',
      repairGlass: 'glass',
      fuelLaunch: 'launch_fuel',
    };
    return map[this.currentStep ? this.currentStep.id : ''] || null;
  }

  getObjective() {
    const s = this.currentStep;
    const val = this.data[s.id] || 0;
    let progress = '';
    if (s.need > 1) progress = `${Math.min(val, s.need)} / ${s.need}`;
    else if (val > 0) progress = '已完成';
    return { title: s.title, detail: s.detail, progress };
  }

  // 任务面板"渐进显示"视图（纯逻辑，可测试）：
  // 新玩家不应在出生第一分钟看到全部 17 步（剧透终局"跃迁至比邻星系"+面板过长遮挡视野）。
  // 只展示：已完成数量、当前步骤（带进度）、接下来 2 个未完成步骤、其余折叠为一行计数。
  missionView() {
    const total = STEP_DEFS.length;
    let doneCount = 0;
    for (const s of STEP_DEFS) if (this.completedIds.has(s.id)) doneCount++;

    const current = STEP_DEFS[this.currentIndex];
    const curVal = this.data[current.id] || 0;
    const currentStep = {
      title: current.title,
      status: 'current',
      progress: current.need > 1 ? `${Math.min(curVal, current.need)}/${current.need}` : (curVal > 0 ? '已完成' : ''),
    };

    const upcoming = [];
    for (let i = this.currentIndex + 1; i < STEP_DEFS.length; i++) {
      if (this.completedIds.has(STEP_DEFS[i].id)) continue; // 已提前完成的不再列出
      upcoming.push({ title: STEP_DEFS[i].title, status: 'locked', progress: '' });
      if (upcoming.length >= 2) break;
    }
    const remaining = Math.max(0, total - doneCount - 1 - upcoming.length);
    return { total, doneCount, current: currentStep, upcoming, remaining };
  }

  render() {
    const g = this.game;
    g.ui.setMissions(this.missionView());
    const obj = this.getObjective();
    g.ui.setObjective(`◈ ${obj.title}`, obj.progress ? `${obj.detail} · ${obj.progress}` : obj.detail);
  }
}
