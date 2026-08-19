// 资源扫描：C 键脉冲（扩张圆环 + 音效）并高亮周围资源点（矿脉/植物）
import * as THREE from 'three';
import { B } from '../world/blocks.js';
import { clamp } from '../core/constants.js';

const SCAN_RADIUS = 36;
const COOLDOWN = 5;
const MARKER_LIFE = 7;
const MAX_MARKERS = 42;

// 可被扫描高亮的资源方块
const RESOURCE_IDS = new Set([
  B.FERROCK, B.COPPER_ORE, B.GOLD_ORE, B.COAL_ORE,
  B.DIHYDROGEN, B.SODIUM, B.OXYGEN, B.CARBON,
]);

function diamondTexture(color) {
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 32;
  const ctx = cv.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(16, 2); ctx.lineTo(30, 16); ctx.lineTo(16, 30); ctx.lineTo(2, 16);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Scanning {
  constructor(game) {
    this.game = game;
    this.cooldown = 0;
    this.rings = [];   // { mesh, mat, t, life }
    this.markers = []; // { sprite, t, life }
    this.markerTex = diamondTexture('#4fe8ff');
    this.shipTex = diamondTexture('#ffb84d'); // 飞船标记（琥珀色）
    this.anomalyTex = diamondTexture('#ff7ad8'); // 异常点标记（品红色）
  }

  trigger() {
    const g = this.game;
    if (this.cooldown > 0) return;
    this.cooldown = COOLDOWN;
    g.audio.play('scan');

    // 球形脉冲波（从玩家位置向外扩张，穿过空气）
    const geo = new THREE.SphereGeometry(1, 32, 18);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7ff0ff, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.set(g.player.pos.x, g.player.pos.y + 1.5, g.player.pos.z);
    g.scene.add(ring);
    this.rings.push({ mesh: ring, mat, t: 0, life: 1.3 });

    // 资源检测
    const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
    const found = [];
    for (const chunk of g.world.chunks.values()) {
      const x0 = chunk.cx * 16, z0 = chunk.cz * 16;
      for (let lx = 0; lx < 16; lx++) {
        for (let lz = 0; lz < 16; lz++) {
          const wx = x0 + lx, wz = z0 + lz;
          const dx = wx - px, dz = wz - pz;
          if (dx * dx + dz * dz > SCAN_RADIUS * SCAN_RADIUS) continue;
          for (let y = 1; y < 64; y++) {
            const id = chunk.get(lx, y, lz);
            if (RESOURCE_IDS.has(id)) {
              found.push({ x: wx, y, z: wz });
              if (found.length >= MAX_MARKERS * 2) break;
            }
          }
        }
      }
      if (found.length >= MAX_MARKERS * 2) break;
    }
    // 距离排序，取最近的一批
    found.sort((a, b) => {
      const da = (a.x - px) ** 2 + (a.z - pz) ** 2;
      const db = (b.x - px) ** 2 + (b.z - pz) ** 2;
      return da - db;
    });
    const shown = found.slice(0, MAX_MARKERS);
    for (const f of shown) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.markerTex, transparent: true, opacity: 0,
        depthWrite: false, depthTest: false, // 穿透地形显示（NMS 风格）
      }));
      const scale = 1.3 + Math.random() * 0.4;
      sp.scale.set(scale, scale, 1);
      sp.position.set(f.x + 0.5, f.y + 1.0, f.z + 0.5);
      g.scene.add(sp);
      this.markers.push({ sprite: sp, t: 0, life: MARKER_LIFE });
    }

    // 异常点信号（品红色标记）：古代遗迹/无人机残骸/补给箱——探索奖励
    let anomalyCount = 0;
    if (g.anomalies) {
      const foundA = g.anomalies.markForScan(SCAN_RADIUS, g.player.pos.x, g.player.pos.z);
      anomalyCount = foundA.length;
      for (const an of foundA) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.anomalyTex, transparent: true, opacity: 0,
          depthWrite: false, depthTest: false,
        }));
        sp.scale.set(1.9, 1.9, 1);
        sp.position.set(an.pos.x, an.pos.y + 2.2, an.pos.z);
        g.scene.add(sp);
        this.markers.push({ sprite: sp, t: 0, life: MARKER_LIFE });
      }
    }

    // 飞船残骸方位指引：琥珀色大标记（长留存 24s）
    let shipInfo = '';
    if (g.ship && g.flight && !g.flight.launched) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.shipTex, transparent: true, opacity: 0,
        depthWrite: false, depthTest: false,
      }));
      sp.scale.set(2.6, 2.6, 1);
      sp.position.set(g.ship.worldPos.x, g.ship.worldPos.y + 3.2, g.ship.worldPos.z);
      g.scene.add(sp);
      this.markers.push({ sprite: sp, t: 0, life: 24 });
      // 方位文案
      const p = g.player.pos, s = g.ship.worldPos;
      const dx = s.x - p.x, dz = s.z - p.z;
      const dist = Math.round(Math.hypot(dx, dz));
      const deg = Math.atan2(dx, dz) * 180 / Math.PI; // 0=+z(北) 90=+x(东)
      const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
      const dirName = DIRS[Math.round(((deg + 360) % 360) / 45) % 8];
      shipInfo = ` · 飞船残骸位于${dirName}方约 ${dist} 米（琥珀色标记）`;
    }
    g.ui.toast(`扫描完成 · 发现 ${shown.length} 处资源点${anomalyCount > 0 ? ` · 异常信号 ×${anomalyCount}` : ''}${shipInfo}`);
  }

  update(dt) {
    const g = this.game;
    this.cooldown = Math.max(0, this.cooldown - dt);
    // 脉冲波
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      r.mesh.scale.setScalar(1 + k * 40);
      r.mat.opacity = 0.85 * (1 - k);
      if (k >= 1) {
        g.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mat.dispose();
        this.rings.splice(i, 1);
      }
    }
    // 资源标记（渐入 → 保持 → 淡出）
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      const k = m.t / m.life;
      let op = 1;
      if (m.t < 0.4) op = m.t / 0.4;
      else if (k > 0.75) op = (1 - k) / 0.25;
      m.sprite.material.opacity = clamp(op, 0, 1) * 0.95;
      m.sprite.position.y += Math.sin(m.t * 2.2) * 0.0015; // 轻微浮动
      if (m.t >= m.life) {
        g.scene.remove(m.sprite);
        m.sprite.material.dispose();
        this.markers.splice(i, 1);
      }
    }
  }
}
