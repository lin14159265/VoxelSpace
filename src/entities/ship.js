// 坠毁的飞船：体素风格拼接模型 + 损坏细节（原创外观，参考 NMS 坠机场景氛围）
import * as THREE from 'three';
import { TILE } from '../world/tiles.js';
import { tileUVs } from '../world/textures.js';

function tileTexture(atlas, tile) {
  const [u0, v0, u1, v1] = tileUVs(tile);
  const t = atlas.clone();
  t.needsUpdate = true;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  // 瓦片在 v 轴占据 [v1, v0]（v1 < v0），映射整面 UV 到该区间
  t.repeat.set(Math.abs(u1 - u0), Math.abs(v0 - v1));
  t.offset.set(u0, v1);
  return t;
}

// 修复所需材料（NMS 风格：脉冲引擎要金属镀层+密封胶；座舱玻璃碎裂；推进器要发射燃料）
export const SHIP_REPAIR_COSTS = {
  pulse: { label: '脉冲引擎', desc: '受损 · 推进力丢失', items: { metal_plating: 1, hermetic_seal: 1 } },
  glass: { label: '座舱玻璃', desc: '碎裂 · 驾驶舱无法增压', items: { glass: 2, metal_plating: 1 } },
  thruster: { label: '发射推进器', desc: '燃油耗尽 · 无法起飞', items: { launch_fuel: 1 } },
};

export class CrashedShip {
  constructor(scene, atlas) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'crashed-ship';
    // 修复状态：false = 损坏
    this.pulseOk = false;
    this.glassOk = false;
    this.thrusterOk = false;

    const hullMat = new THREE.MeshLambertMaterial({ map: tileTexture(atlas, TILE.HULL) });
    const darkMat = new THREE.MeshLambertMaterial({ map: tileTexture(atlas, TILE.HULL_DARK) });
    this.glassMat = new THREE.MeshLambertMaterial({
      color: 0x9fe8f5, transparent: true, opacity: 0.55, emissive: 0x1a3a44, emissiveIntensity: 0.6,
    });
    // 碎裂座舱玻璃：深色熏黑（修复后换回透亮玻璃）
    this.glassBrokenMat = new THREE.MeshLambertMaterial({
      color: 0x242d36, transparent: true, opacity: 0.92, emissive: 0x0a0e12, emissiveIntensity: 0.4,
    });
    const metalMat = new THREE.MeshLambertMaterial({ color: 0x3a4048 });
    this.engineGlowMat = new THREE.MeshBasicMaterial({ color: 0x142028 });
    this.wingGlowMat = new THREE.MeshBasicMaterial({ color: 0x1a2a30 });

    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      this.group.add(m);
      return m;
    };

    // 机身（机头朝 -z，玩家从 +z 方向看到机头）——整体结构完整保留
    box(3.2, 1.9, 7.5, hullMat, 0, 1.05, 0);
    box(2.4, 1.4, 2.2, hullMat, 0, 1.25, -3.6);   // 机头段
    box(1.4, 1.0, 1.4, hullMat, 0, 1.35, -5.0);   // 鼻锥
    // 座舱（玻璃碎裂 → 深色熏黑，修复后透亮）
    this.cockpitMesh = box(1.9, 0.95, 2.2, this.glassBrokenMat, 0, 2.15, -1.2);
    box(0.4, 0.4, 2.2, darkMat, 0, 2.05, -1.2);   // 舱框
    // 双翼
    box(6.4, 0.28, 2.6, darkMat, 0, 1.0, 0.8);
    box(1.2, 0.4, 1.2, metalMat, -2.8, 0.92, 1.0); // 翼尖引擎
    box(1.2, 0.4, 1.2, metalMat, 2.8, 0.92, 1.0);
    box(0.5, 0.24, 0.5, this.wingGlowMat, -2.8, 0.8, 1.55);
    box(0.5, 0.24, 0.5, this.wingGlowMat, 2.8, 0.8, 1.55);
    // 尾翼
    box(0.3, 1.5, 1.4, darkMat, 0, 2.1, 3.2);
    // 主引擎（表面烧蚀 → 可修复）
    box(1.1, 1.1, 1.6, metalMat, -0.9, 1.05, 3.6);
    box(1.1, 1.1, 1.6, metalMat, 0.9, 1.05, 3.6);
    box(0.8, 0.8, 0.3, this.engineGlowMat, -0.9, 1.05, 4.35);
    box(0.8, 0.8, 0.3, this.engineGlowMat, 0.9, 1.05, 4.35);
    // 起落架（折断）
    box(0.24, 0.9, 1.6, metalMat, -1.2, -0.55, -0.8);
    box(0.24, 0.6, 1.6, metalMat, 1.2, -0.4, -0.8);
    // 损伤：烧蚀补丁 + 剥落
    box(1.4, 1.5, 2.6, darkMat, 0.9, 1.15, 1.6);
    box(0.9, 0.5, 1.8, darkMat, -1.1, 1.9, 2.2);
    box(0.7, 0.7, 0.9, darkMat, 0.4, 0.7, -3.9);
    // 残骸碎片：散落的船体板/管线（整体结构保留 + 局部损伤观感）
    const debris = [
      { w: 1.1, h: 0.18, d: 0.7, x: 2.9, y: 0.12, z: -1.6, ry: 0.4 },
      { w: 0.8, h: 0.14, d: 0.5, x: -3.2, y: 0.1, z: 0.9, ry: -0.3 },
      { w: 0.6, h: 0.5, d: 0.5, x: 3.6, y: 0.28, z: 1.8, ry: 0.9 },
      { w: 0.7, h: 0.12, d: 0.6, x: 1.8, y: 0.08, z: 4.4, ry: 0.15 },
    ];
    for (const d of debris) {
      const m = box(d.w, d.h, d.d, darkMat, d.x, d.y, d.z);
      m.rotation.y = d.ry;
    }
    // 冒烟点
    this.smokePos = new THREE.Vector3(0, 1.4, 3.9);

    this.group.rotation.y = Math.PI / 2 + 0.12; // 船头朝 -x（面向出生点方向）
    this.group.rotation.z = -0.13;  // 机翼明显侧倾（坠毁姿态）
    this.group.rotation.x = -0.09;  // 机头栽进地里（坠毁姿态，但整体保持可见）
    scene.add(this.group);
  }

  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
    this.pos = this.group.position;
  }

  // 世界坐标（用于交互判定）
  get worldPos() { return this.group.position; }

  // 修复组件；返回是否发生修复
  repair(component) {
    if (component === 'pulse') {
      if (this.pulseOk) return false;
      this.pulseOk = true;
      this.engineGlowMat.color.set(0x4fe8ff);
      this.wingGlowMat.color.set(0x2fb8d8);
      this.addEngineLight();
      return true;
    }
    if (component === 'glass') {
      if (this.glassOk) return false;
      this.glassOk = true;
      if (this.cockpitMesh) this.cockpitMesh.material = this.glassMat;
      return true;
    }
    if (component === 'thruster') {
      if (this.thrusterOk) return false;
      this.thrusterOk = true;
      this.engineGlowMat.color.set(0xffb84d);
      this.addEngineLight();
      return true;
    }
    return false;
  }

  addEngineLight() {
    if (this.engineLight) return;
    this.engineLight = new THREE.PointLight(0x6fd4ff, 0, 14);
    this.engineLight.position.set(0, 1.2, 4.4);
    this.group.add(this.engineLight);
    this.engineLight.intensity = 1.2;
  }

  get allRepaired() { return this.pulseOk && this.glassOk && this.thrusterOk; }

  // 引擎辉光强度（驾驶时随油门变化）
  setEngineGlow(k) {
    const base = this.thrusterOk ? 0xffb84d : 0x4fe8ff;
    const c = new THREE.Color(base).multiplyScalar(0.3 + k * 0.7);
    this.engineGlowMat.color.copy(c);
    if (this.engineLight) this.engineLight.intensity = 0.6 + k * 2.2;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }
}
