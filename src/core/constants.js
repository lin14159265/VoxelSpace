// 全局常量与物理参数
export const CHUNK = 16;            // 区块边长（x/z）
export const HEIGHT = 64;           // 世界高度（y）
export const WATER_LEVEL = 0;       // 全局水位常量保留；实际水体高度由 terrain.waterLevel 控制

export const RENDER_DIST = 6;       // 区块加载半径（以玩家区块为中心）
export const MESH_BUDGET = 2;       // 每帧最大网格化区块数

export const GRAVITY = 26;
export const WALK_SPEED = 4.4;
export const SNEAK_SPEED = 1.8;
export const FLY_SPEED = 12;
export const JUMP_VEL = 8.4;
export const PLAYER_HALF_W = 0.3;   // 玩家碰撞盒半宽
export const PLAYER_HEIGHT = 1.8;
export const EYE = 1.62;
export const REACH = 5.0;           // 交互距离

export const DAY_LENGTH = 480;      // 一昼夜秒数（8 分钟）
export const BASE_REST_COOLDOWN = 240; // 基地夜间休息冷却（秒）

export const MAX_STACK = 999;

// 危险防护：白天不消耗，夜晚/沙暴时缓慢消耗
export const HAZARD_NIGHT_DRAIN = 2.2;   // 每秒（夜晚）
export const HAZARD_REGEN = 3.5;         // 白天每秒回复

// 行星环境危险（纯函数，可测试）：
// hazard: { kind, drain, when: 'night'|'day'|'always' }（null/none = 无危险）
// nightFactor: 0=白天 1=黑夜；stormK: 风暴倍率（默认 1）
export function environmentDrain(hazard, nightFactor, stormK = 1) {
  if (!hazard || hazard.kind === 'none' || hazard.drain <= 0) return 0;
  let active;
  if (hazard.when === 'always') active = true;
  else if (hazard.when === 'day') active = nightFactor < 0.45;
  else active = nightFactor > 0.55;
  return active ? hazard.drain * Math.max(0, stormK) : 0;
}

// 洞穴氧气
export const OXY_DRAIN = 2.2;            // 地下每秒消耗
export const OXY_REGEN = 7.0;            // 地表每秒回复

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// 按键
export const KEY = {
  FORWARD: 'KeyW', BACK: 'KeyS', LEFT: 'KeyA', RIGHT: 'KeyD',
  JUMP: 'Space', SNEAK: 'ShiftLeft', SPRINT: 'ControlLeft',
  FLY: 'KeyX', LIGHT: 'KeyF', INTERACT: 'KeyE',
  INVENTORY: 'KeyI', TAB: 'Tab', PAUSE: 'Escape',
  STARMAP: 'KeyM', SCAN: 'KeyC', FIRE: 'KeyQ',
  CAMERA: 'KeyV',
  MINING_MODE: 'KeyR', // 采矿光束模式切换（MkII 单格/3×3 区域）
  CLOSE: 'KeyB', // 面板关闭键（全局唯一、零冲突；Esc 专用于暂停菜单）
};
