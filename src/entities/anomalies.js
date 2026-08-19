// 异常点系统：确定性散布在行星地表的探索目标（古代石碑遗迹 / 坠毁无人机残骸 / 补给箱）。
// 服务探索-奖励循环：地表不再是"只有矿和树"——扫描（C）会把未收集的异常点标成品红色信号，
// 靠近按 E 调查获得一次性奖励（稀有矿/信用点/补给资源），收集状态随存档保存（按星球隔离）。
import * as THREE from 'three';
import { hash2, hashSeed } from '../world/noise.js';
import { ITEMS } from '../systems/inventory.js';

export const ANOMALY_TYPES = {
  ruin: { name: '古代石碑遗迹', loot: [['gold_ore', 2], ['copper_ore', 3], ['credits', 45]], desc: '失落文明的低鸣石碑' },
  drone: { name: '坠毁无人机残骸', loot: [['metal_plating', 1], ['sodium', 3], ['oxygen', 2]], desc: '侦察无人机 · 货舱完好' },
  cache: { name: '应急补给箱', loot: [['carbon', 6], ['ferrite_dust', 4], ['di_hydrogen', 3]], desc: '坠机时弹出的补给箱' },
};

const GRID = 26;        // 候选格间距（块）
const HALF = 7;         // 出生点周围 ±7 格（±182 块）
const HASH_CHANCE = 0.085; // 每格 ~8.5% 有异常 → 每星球约 45 个，散布在 364×364 区域

export class Anomalies {
  constructor(game, world) {
    this.game = game;
    this.world = world;
    this.list = []; // { id, type, name, desc, group, glow, pos, collected }
    this.generate();
  }

  // 确定性生成（同种子/同星球 → 同布局；跨星球重建时用星球自己的种子）
  generate() {
    const g = this.game;
    const planetId = g.space ? g.space.current : 0;
    const galaxyId = g.space ? (g.space.galaxyId || 'solar') : 'solar';
    this.planetKey = `${galaxyId}:${planetId}`;
    // 世界种子混入哈希：不同种子 → 不同布局（此前漏了种子，所有种子布局相同）
    this.seedMix = hashSeed(String(this.world.seed)) % 1000003;
    let i = 0;
    for (let gx = -HALF; gx <= HALF; gx++) {
      for (let gz = -HALF; gz <= HALF; gz++) {
        const h = hash2(gx * 131 + planetId * 9973 + 17 + this.seedMix, gz * 977 + 59 + (this.seedMix % 61), 555);
        if (h > HASH_CHANCE) continue;
        const h2 = hash2(gx * 733 + planetId * 3137 + (this.seedMix % 313), gz * 199 + (this.seedMix % 83), 444);
        // 行星口味差异：偶数星球多无人机，奇数星球多补给箱（遗迹两处皆有）
        const typeRoll = h2 + (planetId % 2 === 0 ? 0.12 : 0);
        const type = typeRoll < 0.42 ? 'ruin' : (typeRoll < 0.72 ? 'drone' : 'cache');
        const x = gx * GRID + (h2 * 11) % 12;
        const z = gz * GRID + (h * 17) % 13;
        if (Math.hypot(x - this.world.crashX, z - this.world.crashZ) < 26) continue; // 不干扰开场叙事
        // 用生成器高度而非区块数据：异常点分布在未生成区块里时 getGroundY 读不到真实地表
        const gy = this.world.gen.heightAt(x, z);
        if (gy <= 1) continue;
        const id = `${this.planetKey}:${i++}`;
        const an = this.build(id, type, x, gy, z);
        if (an) this.list.push(an);
      }
    }
  }

  build(id, type, x, gy, z) {
    const g = this.game;
    const def = ANOMALY_TYPES[type];
    const group = new THREE.Group();
    const box = (w, h, d, mat, bx, by, bz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(bx, by, bz);
      group.add(m);
      return m;
    };
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x6a6f78 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
    const metalMat = new THREE.MeshLambertMaterial({ color: 0x8a98a2 });
    const glowMat = new THREE.MeshBasicMaterial({ color: type === 'ruin' ? 0xffc46a : (type === 'drone' ? 0x4fe8ff : 0x7aff9a) });
    if (type === 'ruin') {
      // 石柱遗迹：两根残柱 + 斜靠石板 + 发光核心
      box(0.7, 2.2, 0.7, stoneMat, -0.8, 1.1, 0);
      box(0.7, 1.4, 0.7, stoneMat, 0.8, 0.7, 0.2);
      const slab = box(1.6, 0.22, 0.9, darkMat, 0.1, 1.5, -0.1);
      slab.rotation.z = 0.24;
      const core = box(0.34, 0.34, 0.34, glowMat, -0.8, 2.55, 0);
      core.userData.glow = true;
      group.userData.glowMesh = core;
    } else if (type === 'drone') {
      // 无人机残骸：机身 + 折翼 + 尾桨光点
      box(1.4, 0.5, 0.7, metalMat, 0, 0.45, 0);
      const wing = box(1.9, 0.12, 0.5, darkMat, 0, 0.62, 0);
      wing.rotation.z = 0.18;
      box(0.5, 0.14, 0.3, darkMat, 0.7, 0.35, 0.3).rotation.z = -0.5;
      const core = box(0.28, 0.28, 0.28, glowMat, -0.2, 0.78, 0);
      core.userData.glow = true;
      group.userData.glowMesh = core;
    } else {
      // 补给箱：箱体 + 发光封条
      box(1.0, 0.7, 0.8, darkMat, 0, 0.35, 0);
      box(0.9, 0.12, 0.12, glowMat, 0, 0.5, 0.41);
      const core = box(0.9, 0.12, 0.12, glowMat, 0, 0.5, -0.41);
      core.userData.glow = true;
      group.userData.glowMesh = core;
    }
    group.position.set(x + 0.5, gy, z + 0.5);
    group.userData.anomalyId = id;
    group.userData.type = type;
    group.userData.baseY = gy;
    group.userData.phase = (hash2(x, z, 91)) * 6.28;
    g.scene.add(group);
    return {
      id, type, name: def.name, desc: def.desc, loot: def.loot,
      group, glowMat,
      pos: new THREE.Vector3(x + 0.5, gy, z + 0.5),
      collected: false,
    };
  }

  // 存档恢复：按 id 标记已收集（跨星球 id 隔离，天然正确）
  setCollected(collected) {
    for (const an of this.list) {
      if (collected.has(an.id)) {
        an.collected = true;
        if (an.group.userData.glowMesh) an.group.userData.glowMesh.material.color.set(0x39424a);
        an.glowMat.color.set(0x39424a);
      }
    }
  }

  // 最近未收集异常（水平距离；与日志同款判定）
  nearest(px, py, pz) {
    let best = null, bestD = Infinity;
    for (const an of this.list) {
      if (an.collected) continue;
      const d = Math.hypot(an.pos.x - px, an.pos.z - pz);
      if (d < bestD) { bestD = d; best = an; }
    }
    return best ? { an: best, dist: bestD } : { an: null, dist: Infinity };
  }

  // E 调查：容量预检 → 发放奖励 → 标记已收集
  interact(an) {
    const g = this.game;
    if (an.collected) return false;
    const inv = g.inventory;
    for (const [item, count] of an.loot) {
      if (!inv.canAdd(item, count)) {
        g.ui.toast('背包已满，无法收取调查奖励', true);
        g.audio.play('deny');
        return false;
      }
    }
    an.collected = true;
    for (const [item, count] of an.loot) {
      inv.addItem(item, count);
      g.ui.popup(ITEMS[item] ? ITEMS[item].name : item, count, item);
    }
    g.ui.renderHotbar(inv.hotbar(), inv.selected);
    if (an.group.userData.glowMesh) an.group.userData.glowMesh.material.color.set(0x39424a);
    an.glowMat.color.set(0x39424a);
    g.audio.play('quest');
    g.particles.spawnBurst(an.pos.x, an.pos.y + 1, an.pos.z, 0xffd27a, {
      count: 20, speed: 2.8, up: 2.0, life: 0.7, size: 0.11,
    });
    g.ui.toast(`调查完成：${an.name} · ${an.desc}`, false);
    g.collectedAnomalies.add(an.id);
    if (g.milestones) g.milestones.bump('anomalies', 1);
    return true;
  }

  update(dt) {
    const t = performance.now() / 1000;
    for (const an of this.list) {
      const gr = an.group;
      const glow = gr.userData.glowMesh;
      if (glow) {
        const k = 0.75 + Math.sin(t * 2.4 + gr.userData.phase) * 0.25;
        glow.scale.setScalar(an.collected ? 1 : k);
      }
      gr.rotation.y += dt * (an.type === 'cache' ? 0 : 0.15);
      gr.position.y = gr.userData.baseY + (an.type === 'cache' ? 0 : Math.sin(t * 1.3 + gr.userData.phase) * 0.06);
    }
  }

  // 扫描（C）标记：未收集异常 → 品红色菱形
  markForScan(radius, px, pz) {
    const found = [];
    for (const an of this.list) {
      if (an.collected) continue;
      const dx = an.pos.x - px, dz = an.pos.z - pz;
      if (dx * dx + dz * dz <= radius * radius) found.push(an);
    }
    return found;
  }

  dispose() {
    for (const an of this.list) {
      this.game.scene.remove(an.group);
      an.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.list = [];
  }
}
