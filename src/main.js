// 入口：解析种子/存档 → 创建游戏
import { Game } from './core/game.js';
import { hasSave, loadSaveData } from './systems/save.js';

const params = new URLSearchParams(location.search);
let seed = params.get('seed');
let saveData = null;
if (!seed || !/^\d{1,9}$/.test(seed)) {
  // 无显式种子：优先读取存档继续
  if (hasSave()) {
    saveData = loadSaveData();
    if (saveData) seed = saveData.seed;
  }
  if (!seed) {
    seed = String(Math.floor(Math.random() * 1e9));
  }
  // 保持 URL 可分享
  const url = new URL(location.href);
  url.searchParams.set('seed', seed);
  history.replaceState(null, '', url);
}

window.addEventListener('error', (e) => {
  console.error('[VOXELSPACE]', e.message, e.filename, e.lineno);
});

const game = new Game(seed, saveData);
window.game = game; // 调试入口
game.init();
