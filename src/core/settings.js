// 设置：视野 FOV / 渲染距离 / 画面质量 / 鼠标灵敏度 / 创造模式（localStorage 持久化）
const SETTINGS_KEY = 'voxelspace-settings-v1';

export const DEFAULT_SETTINGS = {
  fov: 75,          // 视野角度（度）
  renderDist: 6,    // 区块加载半径
  graphics: 'high', // low | medium | high
  sens: 1.0,        // 鼠标灵敏度倍率
  creative: false,  // 创造模式
  musicVol: 0.6,    // 背景音乐音量 0..1
  sfxVol: 0.8,      // 音效音量 0..1
};

// 纯数据规范化（可测试）：非法值回落默认
export function normalizeSettings(raw) {
  const d = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return d;
  if (typeof raw.fov === 'number' && raw.fov >= 45 && raw.fov <= 130) d.fov = Math.round(raw.fov);
  if (typeof raw.renderDist === 'number' && raw.renderDist >= 3 && raw.renderDist <= 12) d.renderDist = Math.round(raw.renderDist);
  if (raw.graphics === 'low' || raw.graphics === 'medium' || raw.graphics === 'high') d.graphics = raw.graphics;
  if (typeof raw.sens === 'number' && raw.sens >= 0.1 && raw.sens <= 4) d.sens = Math.round(raw.sens * 100) / 100;
  if (typeof raw.creative === 'boolean') d.creative = raw.creative;
  if (typeof raw.musicVol === 'number' && raw.musicVol >= 0 && raw.musicVol <= 1) d.musicVol = Math.round(raw.musicVol * 100) / 100;
  if (typeof raw.sfxVol === 'number' && raw.sfxVol >= 0 && raw.sfxVol <= 1) d.sfxVol = Math.round(raw.sfxVol * 100) / 100;
  return d;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(s)));
    return true;
  } catch { return false; }
}
