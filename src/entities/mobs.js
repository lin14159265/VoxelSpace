// 异星生物：夜间出没的敌对生物（追击/攻击/白天燃烧）。
// 三种类型（行星差异化）：夜行兽（均衡）/ 群居异虫（快、脆、成队）/ 岩甲爬兽（慢、厚、重击）。
import * as THREE from 'three';
import { isSolid } from '../world/blocks.js';

export const MOB_KINDS = {
  brute: {
    name: '夜行兽', hp: 30, dmg: 14, attackCd: 1.0, reach: 2.4, windup: 0.30,
    speed: 3.1, speedExtra: 1.2, speedDiv: 10, size: 1.0,
    color: 0x5a2a40, drop: { item: 'carbon', count: 2, name: '碳' },
    burnDrop: { item: 'sodium', count: 1, name: '钠' },
  },
  swarmling: {
    name: '群居异虫', hp: 10, dmg: 6, attackCd: 0.8, reach: 2.2, windup: 0.22,
    speed: 4.6, speedExtra: 1.4, speedDiv: 8, size: 0.62,
    color: 0x8a3a20, drop: { item: 'carbon', count: 1, name: '碳' },
    burnDrop: { item: 'sodium', count: 1, name: '钠' },
  },
  crawler: {
    name: '岩甲爬兽', hp: 60, dmg: 18, attackCd: 1.4, reach: 2.6, windup: 0.50,
    speed: 2.2, speedExtra: 0.8, speedDiv: 14, size: 1.25,
    color: 0x2a4a3a, drop: { item: 'copper_ore', count: 1, name: '铜矿石' },
    burnDrop: { item: 'sodium', count: 2, name: '钠' },
  },
};

export class Mob {
  constructor(game, x, y, z, kind = 'brute') {
    this.game = game;
    this.kindId = kind;
    this.kind = MOB_KINDS[kind] || MOB_KINDS.brute;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.health = this.kind.hp;
    this.maxHealth = this.kind.hp;
    this.attackCd = 0;
    this.attackWindup = 0; // 攻击前摇：给玩家闪避/还击的可读窗口
    this.stagger = 0;      // 受击硬直：命中会短暂打断追击与起手
    this.hitFlash = 0;
    this.walkPhase = 0;
    this.alive = true;
    this.deathTimer = 0;

    const s = this.kind.size;
    this.group = new THREE.Group();
    this.bodyMat = new THREE.MeshLambertMaterial({ color: this.kind.color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.95 * s, 0.7 * s, 0.5 * s), this.bodyMat);
    body.position.y = 0.75 * s;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6 * s, 0.55 * s, 0.5 * s), this.bodyMat);
    head.position.y = 1.4 * s;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff8c3a });
    this.eyeMat = eyeMat;
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.14 * s, 0.06), eyeMat);
    eyeL.position.set(-0.14 * s, 1.42 * s, -0.26 * s);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.14 * s, 0.06), eyeMat);
    eyeR.position.set(0.14 * s, 1.42 * s, -0.26 * s);
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 0.45 * s, 0.2 * s), this.bodyMat);
    this.legL.position.set(-0.24 * s, 0.22 * s, 0);
    this.legR = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 0.45 * s, 0.2 * s), this.bodyMat);
    this.legR.position.set(0.24 * s, 0.22 * s, 0);
    this.group.add(body, head, eyeL, eyeR, this.legL, this.legR);
    this.group.position.copy(this.pos);
    game.scene.add(this.group);

    // 头顶血条：受击后出现，实时缩放；基础材质 + 朝向相机（始终可读）
    this.hpGroup = new THREE.Group();
    const bgGeo = new THREE.BoxGeometry(0.92 * s, 0.09, 0.02);
    const fillGeo = new THREE.BoxGeometry(0.8 * s, 0.05, 0.03);
    this.hpBg = new THREE.Mesh(bgGeo, new THREE.MeshBasicMaterial({
      color: 0x050a10, transparent: true, opacity: 0.62, depthTest: false,
    }));
    this.hpFill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
      color: 0x7dff9a, transparent: true, opacity: 0.95, depthTest: false,
    }));
    this.hpGroup.add(this.hpBg, this.hpFill);
    this.hpGroup.visible = false;
    game.scene.add(this.hpGroup);
  }

  // 世界坐标（身体中心，脚在 pos.y）
  get feetY() { return this.pos.y; }

  solidAt(x, y, z) {
    return isSolid(this.game.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  // 攻击视线检查：从怪物头部到玩家身体的 1/3、1/2、2/3 采样点无实心方块
  hasLineOfSight(player) {
    const s = this.kind.size;
    const sx = this.pos.x, sy = this.pos.y + 0.9 * s, sz = this.pos.z;
    const ex = player.pos.x, ey = player.pos.y + 1.2, ez = player.pos.z;
    for (const t of [0.34, 0.5, 0.66]) {
      const x = sx + (ex - sx) * t;
      const y = sy + (ey - sy) * t;
      const z = sz + (ez - sz) * t;
      if (this.solidAt(x, y, z)) return false;
    }
    return true;
  }

  update(dt) {
    const g = this.game;
    if (!this.alive) {
      // 死亡动画
      this.deathTimer += dt;
      const s = Math.max(0.01, 1 - this.deathTimer / 0.4);
      this.group.scale.set(s, s * (1 - this.deathTimer), s);
      this.group.position.y = this.pos.y - this.deathTimer * 0.4;
      return this.deathTimer >= 0.4;
    }
    const player = g.player;

    // 白天燃烧（暴露于地表且非洞穴）
    const day = g.sky.dayFactor > 0.55;
    const under = g.world.isUnderground(this.pos.x, this.pos.y + 0.8, this.pos.z, 2);
    if (day && !under) {
      this.health -= 9 * dt;
      if (Math.random() < 0.3) {
        g.particles.spawnBurst(this.pos.x, this.pos.y + 0.8, this.pos.z, 0xff8c3a, {
          count: 1, speed: 1.2, up: 1.6, life: 0.4, size: 0.1, jitter: 0.4,
        });
      }
      if (this.health <= 0) return this.die(true);
    }

    // 追击
    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const piloting = g.flight && g.flight.piloting;
    if (dist < 18 && !piloting && player.active) {
      this.yaw = Math.atan2(dx, dz);
      const kd = this.kind;
      const dy = Math.abs(player.pos.y - this.pos.y);
      const wasWinding = this.attackWindup > 0;

      // 计时器：受击硬直优先打断攻击前摇；前摇结束后结算攻击
      if (this.stagger > 0) {
        this.stagger = Math.max(0, this.stagger - dt);
      } else if (wasWinding) {
        this.attackWindup = Math.max(0, this.attackWindup - dt);
        if (this.attackWindup <= 0) this.finishAttack(player, dx, dz, dist, dy);
      } else {
        this.attackCd = Math.max(0, this.attackCd - dt);
      }

      // 攻击起手：距离/高低/视线全满足才进入前摇；前摇期间移速下降到 38%
      const canStart = this.stagger <= 0 && !wasWinding && this.attackWindup <= 0
        && this.attackCd <= 0 && dist < kd.reach + 0.35 && dy < 2.5 && this.hasLineOfSight(player);
      if (canStart) {
        this.attackWindup = kd.windup || 0.28;
        this.eyeMat.color.setHex(0xff2a1a);
        if (g.audio.play) g.audio.play('warn');
      }
      if (this.attackWindup <= 0 && this.eyeMat.color.getHex() === 0xff2a1a) {
        this.eyeMat.color.setHex(0xff8c3a);
      }

      // 硬直/前摇都降低移速，形成“命中即打断”的来回；夜间压迫感仍按类型保持
      const moveK = this.stagger > 0 ? 0.12 : (this.attackWindup > 0 ? 0.38 : 1);
      const sp = (kd.speed + Math.min(kd.speedExtra, dist / kd.speedDiv)) * moveK;
      this.vel.x += ((dx / dist) * sp - this.vel.x) * (1 - Math.exp(-6 * dt));
      this.vel.z += ((dz / dist) * sp - this.vel.z) * (1 - Math.exp(-6 * dt));
      this.walkPhase += dt * 9 * moveK;
    } else {
      this.vel.x *= Math.exp(-5 * dt);
      this.vel.z *= Math.exp(-5 * dt);
      this.stagger = Math.max(0, this.stagger - dt);
      this.attackWindup = Math.max(0, this.attackWindup - dt);
      this.attackCd = Math.max(0, this.attackCd - dt);
      if (this.attackWindup <= 0) this.eyeMat.color.setHex(0xff8c3a);
    }

    // 重力 + 地面
    this.vel.y -= 26 * dt;
    this.pos.y += this.vel.y * dt;
    // 水平移动：分轴碰撞检测，不再直接穿墙/穿树（历史问题：怪物穿过庇护所墙体）
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    if (!this.solidAt(nx, this.pos.y + 0.3, this.pos.z) && !this.solidAt(nx, this.pos.y + 1.1, this.pos.z)) {
      this.pos.x = nx;
    } else this.vel.x = 0;
    if (!this.solidAt(this.pos.x, this.pos.y + 0.3, nz) && !this.solidAt(this.pos.x, this.pos.y + 1.1, nz)) {
      this.pos.z = nz;
    } else this.vel.z = 0;
    const groundY = g.world.getGroundY(this.pos.x, this.pos.z);
    if (this.pos.y < groundY) {
      this.pos.y = groundY;
      this.vel.y = 0;
    }
    // 方块碰撞：向上脱困
    if (this.solidAt(this.pos.x, this.pos.y + 0.5, this.pos.z)) {
      let y = Math.floor(this.pos.y);
      while (y < this.pos.y + 6 && this.solidAt(this.pos.x, y, this.pos.z)) y++;
      this.pos.y = y + 0.2;
      this.vel.y = 0;
    }

    // 受击闪烁
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      this.bodyMat.emissive.setScalar(this.hitFlash > 0 ? 0.55 : 0);
    }

    // 变换
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.yaw;
    const swing = Math.sin(this.walkPhase) * 0.55 * Math.min(1, Math.hypot(this.vel.x, this.vel.z));
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.updateHpBar();
    return false;
  }

  // 攻击结算：前摇结束再次校验距离/高低/视线——玩家退开或绕到墙后则挥空，
  // 攻击后摇缩短（奖励闪避），命中则伤害 + 击退 + 屏幕震动。
  finishAttack(player, dx, dz, dist, dy) {
    const g = this.game;
    const kd = this.kind;
    this.eyeMat.color.setHex(0xff8c3a);
    const stillValid = dist < kd.reach + 0.6 && dy < 2.8 && this.hasLineOfSight(player);
    if (stillValid) {
      player.damage(kd.dmg);
      if (dist > 0.01) {
        this.vel.x += (dx / dist) * 5;
        this.vel.z += (dz / dist) * 5;
      }
      g.audio.play('mobAttack');
      g.ui.shake();
      this.attackCd = kd.attackCd;
    } else {
      this.attackCd = kd.attackCd * 0.45; // 挥空惩罚：玩家成功闪避后获得反击窗口
    }
  }

  updateHpBar() {
    const g = this.game;
    if (!this.hpGroup) return;
    if (!this.alive || this.health >= this.maxHealth) {
      this.hpGroup.visible = false;
      return;
    }
    const s = this.kind.size;
    this.hpGroup.visible = true;
    this.hpGroup.position.set(this.pos.x, this.pos.y + 2.02 * s, this.pos.z);
    if (g.camera) this.hpGroup.quaternion.copy(g.camera.quaternion);
    const k = Math.max(0, Math.min(1, this.health / this.maxHealth));
    this.hpFill.scale.x = k;
    this.hpFill.position.x = -(0.8 * s * (1 - k)) / 2;
    this.hpFill.material.color.setHex(k > 0.55 ? 0x7dff9a : (k > 0.25 ? 0xffc24d : 0xff5b4d));
  }

  hit(dmg, dir) {
    if (!this.alive) return;
    this.health -= dmg;
    this.hitFlash = 0.12;
    this.stagger = 0.18;       // 受击硬直：打断追击与前摇
    this.attackWindup = 0;
    this.eyeMat.color.setHex(0xff8c3a);
    this.vel.x += dir.x * 4;
    this.vel.z += dir.z * 4;
    this.game.audio.play('mobHurt');
    this.game.particles.spawnBurst(this.pos.x, this.pos.y + 0.9, this.pos.z, 0x8a3a5a, {
      count: 6, speed: 2.5, up: 1.5, life: 0.4, size: 0.09,
    });
    this.updateHpBar();
    if (this.health <= 0) this.die(false);
  }

  die(burn) {
    if (!this.alive) return false;
    this.alive = false;
    this.deathTimer = 0;
    const g = this.game;
    g.audio.play('mobDie');
    g.particles.spawnBurst(this.pos.x, this.pos.y + 0.8, this.pos.z, burn ? 0xff9a3a : 0x6a2a4a, {
      count: burn ? 22 : 16, speed: 3, up: 2.2, life: 0.7, size: 0.13,
    });
    // 掉落
    const drop = burn ? this.kind.burnDrop : this.kind.drop;
    const added = g.inventory.addItem(drop.item, drop.count);
    if (added > 0) {
      g.ui.popup(drop.name, added, drop.item);
      g.ui.renderHotbar(g.inventory.hotbar(), g.inventory.selected);
    }
    if (g.milestones) g.milestones.bump('kill', 1);
    // 任务板猎杀悬赏只统计玩家在夜间实际击杀；白天自燃死亡不推进悬赏。
    if (!burn && g.onMissionEvent) g.onMissionEvent('kill', { mob: this.kindId, burn: false });
    return false; // 死亡动画继续渲染，由 manager 在结束后清理
  }

  dispose() {
    this.game.scene.remove(this.group);
    if (this.hpGroup) {
      this.game.scene.remove(this.hpGroup);
      this.hpBg.geometry.dispose(); this.hpBg.material.dispose();
      this.hpFill.geometry.dispose(); this.hpFill.material.dispose();
      this.hpGroup = null;
    }
    this.bodyMat.dispose();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== this.bodyMat) o.material.dispose();
    });
  }
}

export class MobManager {
  constructor(game) {
    this.game = game;
    this.mobs = [];
    this.spawnTimer = 10;
  }

  // 行星决定夜间生物构成（世界差异化）：
  // 荒芜/荒漠（火星/水星/比邻 b）→ 群居异虫+岩甲爬兽；繁茂（地球/金星）→ 夜行兽+群居异虫；
  // 冰巨星/气态 → 岩甲爬兽+夜行兽。
  kindPool() {
    const g = this.game;
    const surface = (g.space && g.space.galaxy[g.space.current] && g.space.galaxy[g.space.current].surface) || 'lush';
    if (surface === 'barren' || surface === 'desert') return ['swarmling', 'swarmling', 'crawler'];
    if (surface === 'ice' || surface === 'gas') return ['crawler', 'brute', 'crawler'];
    return ['brute', 'brute', 'swarmling'];
  }

  spawnOne() {
    const g = this.game;
    const p = g.player.pos;
    // 基地安全区：终端半径 28m 内不刷怪（安家的核心收益之一）
    const base = g.currentBase ? g.currentBase() : null;
    let x = 0, z = 0, y = 1;
    let ok = false;
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * 10;
      x = p.x + Math.cos(angle) * dist;
      z = p.z + Math.sin(angle) * dist;
      if (base && Math.hypot(x - (base.x + 0.5), z - (base.z + 0.5)) < 28) continue;
      y = g.world.getGroundY(x, z);
      if (y <= 1) continue;
      ok = true;
      break;
    }
    if (!ok) return;
    const pool = this.kindPool();
    const kind = pool[Math.floor(Math.random() * pool.length)];
    this.mobs.push(new Mob(g, x, y, z, kind));
    // 群居异虫成队出现（2-3 只）
    if (kind === 'swarmling' && this.mobs.length < 6) {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n && this.mobs.length < 6; i++) {
        // 群居个体同样避开基地安全区，不能从队形漂移里漏进家
        let sx = x, sz = z;
        for (let j = 0; j < 6; j++) {
          const tx = x + (Math.random() - 0.5) * 4;
          const tz = z + (Math.random() - 0.5) * 4;
          if (base && Math.hypot(tx - (base.x + 0.5), tz - (base.z + 0.5)) < 28) continue;
          sx = tx; sz = tz;
          break;
        }
        this.mobs.push(new Mob(g, sx, y, sz, 'swarmling'));
      }
    }
    g.audio.play('mobSpawn');
  }

  update(dt) {
    const g = this.game;
    const night = g.sky.nightFactor > 0.6;
    const piloting = g.flight && g.flight.piloting;
    const questStage = g.quests.currentIndex >= 3; // 庇护所阶段后开始出现
    if (night && !piloting && questStage && this.mobs.length < 8) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 5 + Math.random() * 7;
        this.spawnOne();
      }
    }
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const done = this.mobs[i].update(dt);
      if (done) {
        this.mobs[i].dispose();
        this.mobs.splice(i, 1);
      }
    }
  }

  clear() {
    for (const m of this.mobs) m.dispose();
    this.mobs = [];
  }
}
