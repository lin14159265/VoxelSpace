// 存档系统：localStorage 序列化/恢复（纯数据逻辑，可测试）
import { collectCrates, restoreCrates } from './storage.js';

const SAVE_KEY = 'voxelspace-save-v1';

export function hasSave() {
  try { return localStorage.getItem(SAVE_KEY) !== null; } catch { return false; }
}

export function loadSaveData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.version !== 1) return null;
    return d;
  } catch { return null; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* 忽略 */ }
}

// 收集存档数据（纯数据，不含 live 对象）
export function collectSaveData(game) {
  return {
    version: 1,
    seed: game.seed,
    planetId: game.space ? game.space.current : 0,
    galaxyId: game.space ? (game.space.galaxyId || 'solar') : 'solar',
    bodyId: game.space ? (game.space.bodyId || null) : null,
    visitedMoons: game.space ? [...(game.space.visitedMoons || [])] : [],
    visited: game.space ? [...game.space.visitedSolar] : [0],
    visitedProxima: game.space ? [...game.space.visitedProxima] : [],
    visitedSirius: game.space ? [...(game.space.visitedSirius || [])] : [],
    targetId: game.space ? game.space.targetId : -1,
    timeSec: game.sky ? game.sky.timeSec : 0,
    planetName: game.planetName,
    player: game.player ? {
      x: game.player.pos.x, y: game.player.pos.y, z: game.player.pos.z,
      yaw: game.player.yaw, pitch: game.player.pitch,
      health: game.player.health, shield: game.player.shield,
      life: game.player.life, hazard: game.player.hazard,
    } : null,
    inventory: game.inventory ? {
      slots: game.inventory.slots.map((s) => (s ? { itemId: s.itemId, count: s.count } : null)),
      selected: game.inventory.selected,
    } : null,
    ship: game.ship ? { pulseOk: game.ship.pulseOk, glassOk: game.ship.glassOk, thrusterOk: game.ship.thrusterOk } : null,
    shipUpgrades: game.shipUpgrades ? { ...game.shipUpgrades } : null,
    shipVitals: game.flight ? {
      shield: game.flight.shield, shieldMax: game.flight.shieldMax,
      hull: game.flight.hull, hullMax: game.flight.hullMax,
    } : null,
    flight: game.flight ? {
      piloting: game.flight.piloting,
      x: game.flight.pos ? game.flight.pos.x : 0,
      y: game.flight.pos ? game.flight.pos.y : 0,
      z: game.flight.pos ? game.flight.pos.z : 0,
      vx: game.flight.vel ? game.flight.vel.x : 0,
      vy: game.flight.vel ? game.flight.vel.y : 0,
      vz: game.flight.vel ? game.flight.vel.z : 0,
      yaw: game.flight.yaw, pitch: game.flight.pitch, roll: game.flight.roll,
      spaceMode: game.flight.spaceMode,
      spaceActive: !!(game.space && game.space.active),
      cameraMode: game.flight.cameraMode,
      universePos: game.flight.universePos ? { ...game.flight.universePos } : null,
      universeVel: game.flight.universeVel ? { ...game.flight.universeVel } : null,
    } : null,
    stationOrderCd: game.stationOrderCd ? { ...game.stationOrderCd } : {},
    mission: game.mission ? { ...game.mission } : null,
    missionCd: game.missionCd || 0,
    missionSeed: game.missionSeed || 0,
    baseRestCd: game.baseRestCd || 0,
    bases: game.baseWorlds ? { ...game.baseWorlds } : {},
    crates: game.crateWorlds ? Object.fromEntries(Object.entries(game.crateWorlds).map(([k, v]) => [k, collectCrates(v)])) : {},
    logs: game.collectedLogs ? [...game.collectedLogs] : [],
    anomalies: game.collectedAnomalies ? [...game.collectedAnomalies] : [],
    discoveredSurface: game.discoveredSurface ? [...game.discoveredSurface] : [],
    milestones: game.milestones ? game.milestones.collect() : null,
    quests: game.quests ? {
      data: { ...game.quests.data },
      completed: [...game.quests.completedIds],
      currentIndex: game.quests.currentIndex,
    } : null,
  };
}

export function saveGame(game) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(collectSaveData(game)));
    return true;
  } catch { return false; }
}

// ---- 存档导出/导入（备份与分享；导入后整页重载读取） ----
export function validateSaveData(d) {
  return !!(d && typeof d === 'object' && d.version === 1 && typeof d.seed === 'string' && /^\d{1,9}$/.test(d.seed));
}

export function exportSaveText() {
  try { return localStorage.getItem(SAVE_KEY); } catch { return null; }
}

// 导入存档文本：校验结构后写入 localStorage；返回 { ok, reason }
export function importSaveText(text) {
  if (typeof text !== 'string' || text.length < 10 || text.length > 200000) return { ok: false, reason: 'invalid' };
  try {
    const d = JSON.parse(text);
    if (!validateSaveData(d)) return { ok: false, reason: 'invalid' };
    localStorage.setItem(SAVE_KEY, JSON.stringify(d));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'parse' };
  }
}

// 恢复存档到游戏（假定 world 已按 seed 生成）
export function applySaveData(game, d) {  const g = game;
  if (d.player && g.player) {
    g.player.pos.set(d.player.x, d.player.y, d.player.z);
    g.player.yaw = d.player.yaw;
    g.player.pitch = d.player.pitch;
    g.player.health = d.player.health;
    g.player.shield = d.player.shield;
    g.player.life = d.player.life;
    g.player.hazard = d.player.hazard;
    g.player.updateCamera();
  }
  if (d.inventory && g.inventory) {
    g.inventory.slots = d.inventory.slots.map((s) => (s ? { itemId: s.itemId, count: s.count } : null));
    g.inventory.selected = d.inventory.selected;
  }
  if (d.ship && g.ship) {
    if (d.ship.pulseOk) g.ship.repair('pulse');
    if (d.ship.glassOk) g.ship.repair('glass');
    if (d.ship.thrusterOk) g.ship.repair('thruster');
  }
  if (d.shipUpgrades && g.shipUpgrades !== undefined) {
    g.shipUpgrades = { engine: 0, shield: 0, ...d.shipUpgrades };
  }
  if (d.shipVitals && g.flight) {
    g.flight.shield = Math.min(d.shipVitals.shieldMax || 100, Math.max(0, d.shipVitals.shield ?? 100));
    g.flight.shieldMax = d.shipVitals.shieldMax || 100;
    g.flight.hull = Math.min(d.shipVitals.hullMax || 100, Math.max(0, d.shipVitals.hull ?? 100));
    g.flight.hullMax = d.shipVitals.hullMax || 100;
  }
  if (d.flight && g.flight) {
    const f = g.flight;
    f.piloting = !!d.flight.piloting;
    if (f.pos && f.pos.set) f.pos.set(d.flight.x ?? 0, d.flight.y ?? 0, d.flight.z ?? 0);
    if (f.vel && f.vel.set) f.vel.set(d.flight.vx ?? 0, d.flight.vy ?? 0, d.flight.vz ?? 0);
    f.yaw = Number.isFinite(d.flight.yaw) ? d.flight.yaw : f.yaw;
    f.pitch = Number.isFinite(d.flight.pitch) ? d.flight.pitch : f.pitch;
    f.roll = Number.isFinite(d.flight.roll) ? d.flight.roll : f.roll;
    f.cameraMode = d.flight.cameraMode || 'cockpit';
    if (typeof f.setSpaceMode === 'function') f.setSpaceMode(!!d.flight.spaceMode);
    if (d.flight.universePos) f.universePos = { ...d.flight.universePos };
    if (d.flight.universeVel) f.universeVel = { ...d.flight.universeVel };
    g._pendingFlightRestore = d.flight;
  }
  g.stationOrderCd = { ...(d.stationOrderCd || {}) }; // 旧存档无此字段 → 空冷却
  g.mission = d.mission ? { ...d.mission } : null;
  g.missionCd = d.missionCd || 0;
  g.missionSeed = d.missionSeed || 0;
  g.baseRestCd = Number.isFinite(Number(d.baseRestCd)) ? Math.max(0, Number(d.baseRestCd) || 0) : 0; // 旧存档无此字段 → 0
  g.baseWorlds = { ...(d.bases || {}) }; // 基地按世界保存
  g.crateWorlds = Object.fromEntries(Object.entries(d.crates || {}).map(([k, v]) => [k, restoreCrates(v)]));
  if (d.logs && g.collectedLogs !== undefined) {
    g.collectedLogs = new Set(d.logs);
    if (g.logs) g.logs.setCollected(g.collectedLogs);
  }
  g.discoveredSurface = new Set(d.discoveredSurface || []);
  // 异常点收集状态（旧存档无此字段 → 空集，兼容）
  g.collectedAnomalies = new Set(d.anomalies || []);
  if (g.anomalies) g.anomalies.setCollected(g.collectedAnomalies);
  // 里程碑（旧存档无此字段 → 保持初始空进度，兼容）
  if (g.milestones) g.milestones.apply(d.milestones || null);
  if (d.quests && g.quests) {
    g.quests.data = { ...d.quests.data };
    g.quests.completedIds = new Set(d.quests.completed);
    g.quests.currentIndex = d.quests.currentIndex;
    g.quests.render();
  }
  if (g.space) {
    g.space.galaxyId = d.galaxyId || 'solar';
    g.space.galaxy = g.space.galaxies[g.space.galaxyId] || g.space.galaxies.solar;
    g.space.current = d.planetId || 0;
    g.space.bodyId = d.bodyId || null;   // 旧存档无此字段 → 行星表面
    g.space.visitedMoons = new Set(d.visitedMoons || []);
    g.space.visitedSolar = new Set(d.visited && d.visited.length ? d.visited : [0]);
    g.space.visitedProxima = new Set(d.visitedProxima || []);
    g.space.visitedSirius = new Set(d.visitedSirius || []);
    g.space.visitedMap = { solar: g.space.visitedSolar, proxima: g.space.visitedProxima, sirius: g.space.visitedSirius };
    g.space.visited = g.space.visitedMap[g.space.galaxyId] || g.space.visitedSolar;
    g.space.targetId = d.targetId !== undefined ? d.targetId : -1;
    if (typeof g.space.syncLegacyBody === 'function') g.space.syncLegacyBody();
  }
  if (g.sky && d.timeSec !== undefined) g.sky.timeSec = d.timeSec;
  if (d.planetName) {
    g.planetName = d.planetName;
    g.ui.setPlanetInfo({ name: d.planetName });
  }
  // 任务与飞船真实修复状态同步（读档后立即校正）
  if (g.quests && g.ship) g.quests.syncShip(g.ship);
  g.ui.renderHotbar(g.inventory.hotbar(), g.inventory.selected);
  if (typeof g.syncBaseForCurrentWorld === 'function') g.syncBaseForCurrentWorld();
}
