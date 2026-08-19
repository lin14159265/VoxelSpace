// 方块粒子系统：InstancedMesh 池 + 每实例颜色/速度/寿命
import * as THREE from 'three';

const MAX = 640;

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    let map = null;
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = 4; cv.height = 4;
      const ctx = cv.getContext('2d');
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          const k = 200 + Math.random() * 55;
          ctx.fillStyle = `rgb(${k},${k},${k})`;
          ctx.fillRect(x, y, 1, 1);
        }
      map = new THREE.CanvasTexture(cv);
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestFilter;
    }
    this.mat = new THREE.MeshLambertMaterial({ map, vertexColors: true });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 实例颜色缓冲区常驻复用；不要在每次 spawnBurst 置 null（会整块重新分配并触发 GC）
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);

    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.gravity = new Float32Array(MAX);
    this.active = new Uint8Array(MAX);
    this.colors = new Float32Array(MAX * 3);
    this.cursor = 0;
    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
  }

  spawnBurst(cx, cy, cz, color, opts = {}) {
    const {
      count = 16, speed = 3.2, up = 2.2, spread = 1,
      life = 0.7, size = 0.11, gravity = 9, jitter = 0.2,
    } = opts;
    for (let i = 0; i < count; i++) {
      if (this.cursor >= MAX) this.cursor = 0;
      const k = this.cursor++;
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI * 2;
      const sp = speed * (0.5 + Math.random());
      this.pos[k * 3] = cx + (Math.random() - 0.5) * jitter;
      this.pos[k * 3 + 1] = cy + (Math.random() - 0.5) * jitter;
      this.pos[k * 3 + 2] = cz + (Math.random() - 0.5) * jitter;
      this.vel[k * 3] = Math.sin(a) * Math.cos(b) * sp * spread + (Math.random() - 0.5);
      this.vel[k * 3 + 1] = Math.sin(b) * sp + up * (0.4 + Math.random() * 0.6);
      this.vel[k * 3 + 2] = Math.cos(a) * Math.cos(b) * sp * spread + (Math.random() - 0.5);
      const lf = life * (0.6 + Math.random() * 0.8);
      this.life[k] = lf;
      this.maxLife[k] = lf;
      this.size[k] = size * (0.6 + Math.random() * 0.9);
      this.gravity[k] = gravity;
      this.active[k] = 1;
      this.tmpColor.set(color);
      this.tmpColor.offsetHSL((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.1);
      this.colors[k * 3] = this.tmpColor.r;
      this.colors[k * 3 + 1] = this.tmpColor.g;
      this.colors[k * 3 + 2] = this.tmpColor.b;
    }
  }

  update(dt) {
    let count = 0;
    for (let i = 0; i < MAX; i++) {
      if (!this.active[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.active[i] = 0;
        continue;
      }
      this.vel[i * 3 + 1] -= this.gravity[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const s = this.size[i] * Math.max(0.05, this.life[i] / this.maxLife[i]);
      this.dummy.position.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.dummy.scale.setScalar(s);
      this.dummy.rotation.set(this.life[i] * 7, this.life[i] * 5, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count, this.dummy.matrix);
      this.mesh.setColorAt(count, this.tmpColor.setRGB(
        this.colors[i * 3], this.colors[i * 3 + 1], this.colors[i * 3 + 2]));
      count++;
    }
    this.mesh.count = count;
    if (count > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
