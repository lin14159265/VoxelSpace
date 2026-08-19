// 能量武器：Q 键发射能量弹（命中生物/方块），附带弹道粒子
import * as THREE from 'three';
import { isSolid } from '../world/blocks.js';

const BOLT_SPEED = 44;
const BOLT_LIFE = 1.4;

export class Combat {
  constructor(game) {
    this.game = game;
    this.bolts = [];
  }

  // 能量线圈（武器模块）：伤害 +57%、射速 +33%、弹丸变橙
  get hasCoil() {
    return !!(this.game.inventory && this.game.inventory.countOf('energy_coil') > 0);
  }
  get damage() { return this.hasCoil ? 22 : 14; }
  get fireCooldown() { return this.hasCoil ? 0.24 : 0.32; }
  get boltColor() { return this.hasCoil ? 0xffb84d : 0x7ff0ff; }

  fire() {
    const g = this.game;
    const cam = g.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const geo = new THREE.SphereGeometry(0.12, 8, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: this.boltColor, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(cam.position).addScaledVector(dir, 0.8);
    g.scene.add(mesh);
    this.bolts.push({
      pos: mesh.position.clone(),
      dir: dir.clone(),
      life: BOLT_LIFE,
      mesh,
    });
    g.audio.play('blaster');
  }

  update(dt) {
    const g = this.game;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      b.pos.addScaledVector(b.dir, BOLT_SPEED * dt);
      b.mesh.position.copy(b.pos);
      // 尾迹粒子
      if (Math.random() < 0.6) {
        g.particles.spawnBurst(b.pos.x, b.pos.y, b.pos.z, 0x7ff0ff, {
          count: 1, speed: 0.4, up: 0.2, life: 0.2, size: 0.06, gravity: 0,
        });
      }
      let dead = b.life <= 0;
      if (!dead && g.mobs) {
        // 命中生物
        for (const mob of g.mobs.mobs) {
          if (!mob.alive) continue;
          const dx = mob.pos.x - b.pos.x;
          const dy = mob.pos.y + 0.8 - b.pos.y;
          const dz = mob.pos.z - b.pos.z;
          if (dx * dx + dy * dy + dz * dz < 1.1) {
            mob.hit(this.damage, b.dir);
            g.ui.hitmarker();
            g.particles.spawnBurst(b.pos.x, b.pos.y, b.pos.z, this.boltColor, {
              count: 8, speed: 3, up: 1.5, life: 0.35, size: 0.09,
            });
            dead = true;
            break;
          }
        }
      }
      if (!dead && isSolid(g.world.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y), Math.floor(b.pos.z)))) {
        g.particles.spawnBurst(b.pos.x, b.pos.y, b.pos.z, 0xffd27a, {
          count: 6, speed: 2.5, up: 1.5, life: 0.3, size: 0.08,
        });
        dead = true;
      }
      if (dead) {
        g.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.bolts.splice(i, 1);
      }
    }
  }

  clear() {
    const g = this.game;
    for (const b of this.bolts) {
      g.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
    this.bolts = [];
  }
}
