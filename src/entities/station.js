// 空间站：体素风轨道站 3D 模型（核心舱 + 环形居住舱 + 太阳能板 + 对接天线 + 信标）
import * as THREE from 'three';
import { STATION_OFFSET } from '../space/celestial.js';

// 兼容旧导入路径（system.js 等）——偏移量统一定义在宇宙数据模型中
export { STATION_OFFSET };
export const STATION_DOCK_DIST = 55;

export function buildStationMesh() {
  const group = new THREE.Group();
  const hull = new THREE.MeshLambertMaterial({ color: 0x9aa4ad });
  const dark = new THREE.MeshLambertMaterial({ color: 0x5a666e });
  const panelMat = new THREE.MeshLambertMaterial({ color: 0x2a4a6a, emissive: 0x0a1a2a, emissiveIntensity: 0.5 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x7ff0ff });
  const amber = new THREE.MeshBasicMaterial({ color: 0xffb84d });

  const box = (w, h, d, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  // 中央核心舱
  box(5, 5, 5, hull, 0, 0, 0);
  box(6.4, 1.2, 6.4, dark, 0, 0, 0);
  // 环形居住舱（水平环）
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9.5, 1.1, 10, 40), dark);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  // 连接辐条
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    box(8.6, 0.5, 0.5, hull, Math.cos(a) * 4.8, 0, Math.sin(a) * 4.8);
  }
  // 太阳能板 ×4（十字布局）
  for (const [px, pz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    box(2.4, 0.15, 9, panelMat, px * 12.5, 0.6, pz * 6);
    box(0.3, 0.3, 4.5, dark, px * 12.5, 0.2, pz * 6);
  }
  // 对接天线 + 信标灯
  box(0.4, 5, 0.4, dark, 0, 4, 0);
  box(0.8, 0.8, 0.8, glow, 0, 6.6, 0);
  box(0.5, 0.5, 0.5, amber, 0, -5.4, 0);
  box(0.5, 0.5, 0.5, amber, 6.4, 0, 0);
  group.rotation.z = 0.15; // 略倾斜更具姿态
  return group;
}
