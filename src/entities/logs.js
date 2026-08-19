// 坠机点数据日志：青色悬浮全息立方 + 垂直信标光柱（世界观收集品），靠近按 E 读取
import * as THREE from 'three';
import { CRASH_LOGS } from '../systems/npcs.js';

export class CrashLogs {
  constructor(scene, world) {
    this.scene = scene;
    this.items = [];
    // 三个日志位点（相对坠毁点的固定偏移，散布在焦土区周围）
    const spots = [
      { x: 7, z: -4 }, { x: -6, z: 5 }, { x: 9, z: 6 },
    ];
    CRASH_LOGS.forEach((log, i) => {
      const spot = spots[i];
      const g = new THREE.Group();
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.34, 0.34),
        new THREE.MeshBasicMaterial({ color: 0x7ff0ff }),
      );
      // 内芯（更亮，模拟全息核心）
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.15, 0.15),
        new THREE.MeshBasicMaterial({ color: 0xeaffff }),
      );
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.035, 6, 20),
        new THREE.MeshBasicMaterial({ color: 0x7ff0ff, transparent: true, opacity: 0.85 }),
      );
      ring.rotation.x = Math.PI / 2;
      // 垂直信标光柱：从远处即可定位日志点，并强化"科技遗物"观感
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 2.2, 6, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x7ff0ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      beam.position.y = 1.1;
      g.add(box);
      g.add(core);
      g.add(ring);
      g.add(beam);
      const x = world.crashX + spot.x;
      const z = world.crashZ + spot.z;
      const y = world.getGroundY(x, z) + 0.6;
      g.position.set(x, y, z);
      g.userData = { logId: log.id, baseY: y, phase: i * 2.1 };
      scene.add(g);
      this.items.push({ group: g, box, core, ring, beam, id: log.id });
    });
  }

  // 已收集：立方体变暗、光环淡出、信标光柱熄灭（可再次靠近，但不再提示）
  setCollected(collected) {
    for (const it of this.items) {
      const on = collected.has(it.id);
      it.box.material.color.set(on ? 0x46565e : 0x7ff0ff);
      it.core.material.color.set(on ? 0x2a3338 : 0xeaffff);
      it.ring.material.opacity = on ? 0.25 : 0.85;
      it.beam.visible = !on;
    }
  }

  // 最近未读日志（按水平距离）
  nearestUnread(px, py, pz, collected) {
    let bestId = null, bestD = Infinity;
    for (const it of this.items) {
      if (collected.has(it.id)) continue;
      const d = Math.hypot(it.group.position.x - px, it.group.position.z - pz);
      if (d < bestD) { bestD = d; bestId = it.id; }
    }
    return { id: bestId, dist: bestD };
  }

  update(dt) {
    const t = performance.now() / 1000;
    for (const it of this.items) {
      const g = it.group;
      g.rotation.y += dt * 0.9;
      g.position.y = g.userData.baseY + Math.sin(t * 1.6 + g.userData.phase) * 0.12;
      // 内芯呼吸脉冲
      const k = 0.85 + Math.sin(t * 3 + g.userData.phase) * 0.15;
      it.core.scale.setScalar(k);
    }
  }

  dispose() {
    for (const it of this.items) {
      this.scene.remove(it.group);
      for (const mesh of [it.box, it.core, it.ring, it.beam]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
    this.items = [];
  }
}
