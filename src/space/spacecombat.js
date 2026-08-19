// 太空威胁与舰载战斗：小行星带微陨石 + 海盗拦截机。
// 小行星带采矿从此有风险节奏：护盾先挡、船体归零紧急返航；
// Q 键在驾驶中发射舰载能量弹，击落海盗获得信用点赏金。
import * as THREE from 'three';

const PIRATE_HP = 30;
const PIRATE_SPEED = 26;
const PIRATE_FIRE_RANGE = 85;
const PIRATE_FIRE_CD = 2.1;
const SHIP_BOLT_SPEED = 95;
const SHIP_BOLT_DAMAGE = 25;

export class SpaceCombat {
  constructor(game) {
    this.game = game;
    this.units = [];       // 海盗拦截机
    this.shipBolts = [];   // 玩家舰载弹
    this.enemyBolts = [];  // 海盗弹
    this.spawnTimer = 6;
    this.meteorTimer = 2.5;
  }

  get flight() { return this.game.flight; }
  get space() { return this.game.space; }
  get scene() { return this.game.scene; }

  clear() {
    for (const u of this.units) this.disposeUnit(u);
    for (const b of [...this.shipBolts, ...this.enemyBolts]) this.disposeBolt(b);
    this.units = [];
    this.shipBolts = [];
    this.enemyBolts = [];
  }

  spawnPirate() {
    const g = this.game;
    const p = this.flight.pos;
    const a = Math.random() * Math.PI * 2;
    const r = 75 + Math.random() * 45;
    const x = p.x + Math.cos(a) * r;
    const y = p.y + (Math.random() - 0.5) * 30;
    const z = p.z + Math.sin(a) * r;
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8a2a30 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a262e });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
    const box = (w, h, d, mat, bx, by, bz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(bx, by, bz);
      group.add(m);
      return m;
    };
    box(2.6, 0.55, 1.1, bodyMat, 0, 0, 0);
    box(0.8, 0.5, 2.2, dark, 0, 0, 0);
    box(0.35, 0.35, 0.35, eyeMat, 0, 0.12, -1.2);
    group.position.set(x, y, z);
    this.scene.add(group);
    this.units.push({
      pos: new THREE.Vector3(x, y, z),
      hp: PIRATE_HP,
      maxHp: PIRATE_HP,
      fireCd: 1 + Math.random(),
      flash: 0,
      phase: Math.random() * 6.28,
      group,
      bodyMat,
      eyeMat,
    });
    g.audio.play('mobSpawn');
  }

  fireShipBolt() {
    const g = this.game;
    if (!this.flight.piloting || !this.space.active) return;
    const dir = this.flight.forwardUniverse ? this.flight.forwardUniverse() : this.flight.forward();
    const geo = new THREE.SphereGeometry(0.16, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x7ff0ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(this.flight.pos).addScaledVector(dir, 2.8);
    this.scene.add(mesh);
    this.shipBolts.push({ pos: mesh.position.clone(), dir: dir.clone(), life: 2.4, mesh });
    g.audio.play('blaster');
  }

  update(dt) {
    const g = this.game;
    if (!this.flight.piloting || !this.space.active) return;
    if (this.space.warping) return;
    this.flight.impactCd = Math.max(0, (this.flight.impactCd || 0) - dt);

    // 1) 小行星带微陨石：有节奏的随机撞击，不是无成本矿场
    if (g.beltNear) {
      this.meteorTimer -= dt;
      if (this.meteorTimer <= 0) {
        this.meteorTimer = 2.0 + Math.random() * 2.4;
        const p = this.flight.pos;
        g.particles.spawnBurst(p.x, p.y + (Math.random() - 0.5) * 2, p.z, 0xffb84d, {
          count: 14, speed: 5, up: 0.4, life: 0.7, size: 0.14, gravity: 0, spread: 2.4, jitter: 2.2,
        });
        if (this.flight.takeShipDamage(6 + Math.floor(Math.random() * 8))) return; // 已触发紧急返航：clear() 已替换数组，必须立即退出本帧
        if (Math.random() < 0.5) g.ui.toast('微陨石撞击 · 护盾正在吸收', true);
      }
    }

    // 2) 海盗刷新：只在小行星带附近出没，保持 2 架上限
    if (g.beltNear && this.units.length < 2) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 9 + Math.random() * 7;
        this.spawnPirate();
        g.ui.toast('海盗拦截机逼近 · Q 键开火还击', true);
      }
    } else {
      this.spawnTimer = Math.max(1, this.spawnTimer);
    }

    // 3) 海盗单位
    const shipPos = this.flight.pos;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const dx = shipPos.x - u.pos.x;
      const dy = shipPos.y - u.pos.y;
      const dz = shipPos.z - u.pos.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      // 保持在 40m 外射击，不贴脸
      const targetDist = 40;
      const move = PIRATE_SPEED * dt;
      if (dist > targetDist + 5) {
        u.pos.x += dx / dist * move;
        u.pos.y += dy / dist * move * 0.6;
        u.pos.z += dz / dist * move;
      } else if (dist < targetDist - 5) {
        u.pos.x -= dx / dist * move * 0.6;
        u.pos.y -= dy / dist * move * 0.3;
        u.pos.z -= dz / dist * move;
      }
      u.pos.x += Math.sin(g.frame * 0.02 + u.phase) * dt * 4;
      u.pos.z += Math.cos(g.frame * 0.017 + u.phase) * dt * 4;
      u.group.position.copy(u.pos);
      u.group.lookAt(shipPos.x, shipPos.y, shipPos.z);
      // 开火
      u.fireCd -= dt;
      if (dist < PIRATE_FIRE_RANGE && u.fireCd <= 0) {
        u.fireCd = PIRATE_FIRE_CD + Math.random() * 0.8;
        const dir = new THREE.Vector3(dx / dist, dy / dist, dz / dist);
        this.spawnEnemyBolt(u, dir);
      }
      // 受击闪烁
      if (u.flash > 0) {
        u.flash -= dt;
        u.bodyMat.emissive.setScalar(u.flash > 0 ? 0.6 : 0);
      }
      if (u.hp <= 0) {
        this.destroyPirate(i);
      }
    }

    // 4) 玩家舰载弹
    for (let i = this.shipBolts.length - 1; i >= 0; i--) {
      const b = this.shipBolts[i];
      b.life -= dt;
      let dead = b.life <= 0;
      // 高速弹丸先检当前点、再移动、再检终点，避免单帧穿透
      if (!dead) dead = this.hitUnitWithBolt(b);
      b.pos.addScaledVector(b.dir, SHIP_BOLT_SPEED * dt);
      b.mesh.position.copy(b.pos);
      if (!dead) dead = this.hitUnitWithBolt(b);
      if (dead) { this.disposeBolt(b); this.shipBolts.splice(i, 1); }
    }
    // 舰炮击毁立即结算（不等下一帧单位循环）
    for (let j = this.units.length - 1; j >= 0; j--) {
      if (this.units[j].hp <= 0) this.destroyPirate(j);
    }

    // 5) 海盗弹
    for (let i = this.enemyBolts.length - 1; i >= 0; i--) {
      const b = this.enemyBolts[i];
      b.life -= dt;
      b.pos.addScaledVector(b.dir, 34 * dt);
      b.mesh.position.copy(b.pos);
      let dead = b.life <= 0;
      if (!dead) {
        const d2 = (shipPos.x - b.pos.x) ** 2 + (shipPos.y - b.pos.y) ** 2 + (shipPos.z - b.pos.z) ** 2;
        if (d2 < 16 && this.flight.impactCd <= 0) {
          if (this.flight.takeShipDamage(10 + Math.floor(Math.random() * 7))) return; // 紧急返航已调用 clear()，立即退出本帧
          dead = true;
        }
      }
      if (dead) { this.disposeBolt(b); this.enemyBolts.splice(i, 1); }
    }

    // 6) 安全空域护盾/船体回复
    this.flight.regenShipShield(dt, !g.beltNear && this.units.length === 0);
  }

  // 舰炮命中检测：返回 true 表示弹丸已命中并被销毁
  hitUnitWithBolt(b) {
    const g = this.game;
    for (let j = this.units.length - 1; j >= 0; j--) {
      const u = this.units[j];
      const d2 = (u.pos.x - b.pos.x) ** 2 + (u.pos.y - b.pos.y) ** 2 + (u.pos.z - b.pos.z) ** 2;
      if (d2 < 6.25) {
        u.hp -= SHIP_BOLT_DAMAGE;
        u.flash = 0.12;
        g.particles.spawnBurst(b.pos.x, b.pos.y, b.pos.z, 0xffc24d, { count: 10, speed: 4, up: 0, life: 0.45, size: 0.12, gravity: 0 });
        return true;
      }
    }
    return false;
  }

  spawnEnemyBolt(u, dir) {
    const g = this.game;
    const geo = new THREE.SphereGeometry(0.14, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(u.pos);
    this.scene.add(mesh);
    this.enemyBolts.push({ pos: mesh.position.clone(), dir, life: 3.0, mesh });
    g.audio.play('blaster');
  }

  destroyPirate(index) {
    const g = this.game;
    const u = this.units[index];
    g.particles.spawnBurst(u.pos.x, u.pos.y, u.pos.z, 0xff7a2a, { count: 26, speed: 5, up: 0.4, life: 0.8, size: 0.16, gravity: 0, spread: 2.6 });
    this.disposeUnit(u);
    this.units.splice(index, 1);
    g.audio.play('mobDie');
    const reward = 60 + Math.floor(Math.random() * 40);
    const canReceive = g.inventory.canAdd('credits', reward);
    const added = canReceive ? g.inventory.addItem('credits', reward) : 0;
    if (added > 0) {
      g.ui.popup('海盗赏金', added, 'credits');
      g.ui.renderHotbar(g.inventory.hotbar(), g.inventory.selected);
    }
    if (g.milestones) {
      g.milestones.bump('creditsEarned', added);
      g.milestones.bump('pirateKill', 1);
    }
    g.ui.toast(added > 0
      ? `海盗拦截机击毁 · 赏金 +${added} 信用点`
      : '海盗拦截机击毁 · 背包已满，赏金无法接收');
  }

  disposeUnit(u) {
    this.scene.remove(u.group);
    u.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  disposeBolt(b) {
    this.scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    b.mesh.material.dispose();
  }
}
