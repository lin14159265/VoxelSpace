// 玩家：第一人称控制 + AABB 体素碰撞 + 挖掘/放置 + 生存属性
import * as THREE from 'three';
import {
  GRAVITY, WALK_SPEED, SNEAK_SPEED, FLY_SPEED, JUMP_VEL,
  PLAYER_HALF_W, PLAYER_HEIGHT, EYE, REACH, KEY,
  HAZARD_REGEN, OXY_DRAIN, OXY_REGEN, environmentDrain, clamp,
} from '../core/constants.js';
import { B, def, isPlant, isSolid } from '../world/blocks.js';
import { ITEMS } from '../systems/inventory.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3(8.5, 40, 8.5);
    this.vel = new THREE.Vector3();
    this.active = true; // 驾驶飞船时冻结玩家
    this.yaw = -Math.PI / 2; // 面向 +x 方向的飞船残骸
    this.pitch = -0.12;
    this.onGround = false;
    this.flyMode = !!game.creative; // 创造模式默认自由飞行（生存模式无免费飞行）
    this.prevVelY = 0;
    // 移动手感：疾跑 FOV 冲击、跳跃缓冲与土狼时间（落地后短暂宽限起跳）
    this.sprintK = 0;
    this.jumpBuffer = 0;
    this.coyoteTimer = 0;
    this.baseFov = (game.settings && game.settings.fov) || 75;

    // 生存属性
    this.shield = 100;
    this.shieldMax = 100 + 50 * ((game.shipUpgrades && game.shipUpgrades.shield) || 0); // 空间站护盾扩容
    this.health = 100;
    this.life = 100;
    this.hazard = 100;

    // 挖掘
    this.mineTarget = null;
    this.mineProgress = 0;
    this.mineFrac = 0;
    this.mineSoundTimer = 0;
    this.target = null; // 当前射线目标（含植物）
    this.underground = false;
    this.feetInWater = false;
    this.headInWater = false;
    this.oxyWarned = false;
    this.hazardWarned = false;
    this.waterWarned = false;
    this.fireCd = 0;
    this.recoil = 0; // 激光枪后坐

    // 移动
    this.walkDist = 0;
    this.bobPhase = 0;

    // 目标高亮框
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x7ff0ff, transparent: true, opacity: 0.75 })
    );
    this.highlight.visible = false;
    game.scene.add(this.highlight);
    this.miningMode = 0; // 0=单格；1=3×3 区域（需 MkII）
    this.buildPlacementGhost();

    this.cam = game.camera;
    // 每帧复用的射线/眼睛缓存：避免 updateTarget 持续分配 Vector3
    this._eye = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    // 相机挂入场景图：第一人称激光枪作为相机子物体才能渲染
    if (!this.cam.parent) game.scene.add(this.cam);
    this.buildGun();
    this.hurtTimer = 0;
  }

  // ---- 第一人称激光枪视模型（主角的"手"） ----
  buildGun() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x8fa0ac });
    const dark = new THREE.MeshLambertMaterial({ color: 0x39424a });
    const glow = new THREE.MeshBasicMaterial({ color: 0x7ff0ff });
    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    // 枪身（朝 -z 为枪口）
    box(0.11, 0.10, 0.34, mat, 0, 0.02, -0.18);
    box(0.09, 0.09, 0.26, dark, 0, 0.02, -0.44);   // 枪管
    box(0.05, 0.05, 0.05, glow, 0, 0.02, -0.58);   // 枪口能量核心
    box(0.06, 0.16, 0.08, dark, 0, -0.10, -0.12);  // 握把
    box(0.13, 0.05, 0.09, mat, 0, 0.085, -0.14);   // 顶部瞄具
    box(0.07, 0.06, 0.10, glow, 0.05, 0.0, -0.02); // 侧边能量电池（辉光）
    this.gun = g;
    this.gun.visible = false;
    this.gunBase = new THREE.Vector3(0.36, -0.30, -0.58);
    this.gun.position.copy(this.gunBase);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.02, -0.62);
    g.add(this.muzzle);
    this.cam.add(g);
  }

  // 建造预放置虚影：手持可放置方块且瞄准表面时显示，绿色=可放、红色=不可放。
  // 建造手感从“盲放失败才知道”升级为“放之前就看见结果”。
  buildPlacementGhost() {
    const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7dffb0, transparent: true, opacity: 0.32, depthWrite: false,
    });
    this.placeGhost = new THREE.Mesh(geo, mat);
    this.placeGhost.visible = false;
    this.game.scene.add(this.placeGhost);
  }

  updatePlacementGhost() {
    const g = this.game;
    const sel = g.inventory.getSelected();
    const item = sel && ITEMS[sel.itemId];
    const t = this.target;
    if (!item || item.block === undefined || !t || this.mineTarget) {
      this.placeGhost.visible = false;
      return;
    }
    const px = t.x + t.nx, py = t.y + t.ny, pz = t.z + t.nz;
    const existing = g.world.getBlock(px, py, pz);
    const hw = PLAYER_HALF_W;
    const overlaps = px + 1 > this.pos.x - hw && px < this.pos.x + hw
      && py + 1 > this.pos.y && py < this.pos.y + PLAYER_HEIGHT
      && pz + 1 > this.pos.z - hw && pz < this.pos.z + hw;
    const valid = (existing === 0 || existing === B.WATER) && !overlaps;
    this.placeGhost.visible = true;
    this.placeGhost.position.set(px + 0.5, py + 0.5, pz + 0.5);
    this.placeGhost.material.color.setHex(valid ? 0x7dffb0 : 0xff6b5e);
    this.placeGhost.material.opacity = valid ? 0.32 : 0.5;
  }

  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
  }

  // 是否持有多功能工具
  get hasTool() {
    return this.toolTier > 0;
  }

  // 采矿工具等级：0=徒手 / 1=多功能工具 / 2=采矿光束 MkII
  get toolTier() {
    const g = this.game;
    if (!g.inventory) return 0;
    if (g.inventory.countOf('mining_beam_mk2') > 0) return 2;
    if (g.inventory.countOf('multitool') > 0) return 1;
    return 0;
  }

  get miningMultiplier() { return this.toolTier >= 2 ? 5.2 : (this.toolTier === 1 ? 3.2 : 1); }

  // 立即把相机摆到玩家视角（离船时使用）
  updateCamera() {
    this.cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.cam.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
  }

  respawn(p) {
    this.pos.set(p.x, p.y, p.z);
    this.vel.set(0, 0, 0);
    this.mineTarget = null;
    this.mineProgress = 0;
    if (this.beam) this.beam.visible = false;
  }

  // ---- 碰撞 ----
  collides(px, py, pz) {
    const w = this.game.world;
    const minX = Math.floor(px - PLAYER_HALF_W), maxX = Math.floor(px + PLAYER_HALF_W);
    const minY = Math.floor(py), maxY = Math.floor(py + PLAYER_HEIGHT);
    const minZ = Math.floor(pz - PLAYER_HALF_W), maxZ = Math.floor(pz + PLAYER_HALF_W);
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++) {
          if (isSolid(w.getBlock(x, y, z))) return true;
        }
    return false;
  }

  moveAxis(dt) {
    const w = this.game.world;
    const axes = ['x', 'y', 'z'];
    for (const axis of axes) {
      const prev = this.pos[axis];
      this.pos[axis] += this.vel[axis] * dt;
      if (this.collides(this.pos.x, this.pos.y, this.pos.z)) {
        // 细分回退
        this.pos[axis] = prev;
        let lo = 0, hi = this.vel[axis] * dt;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          this.pos[axis] = prev + mid;
          if (this.collides(this.pos.x, this.pos.y, this.pos.z)) {
            hi = mid;
            this.pos[axis] = prev + mid - (this.vel[axis] > 0 ? 0.001 : -0.001);
          } else lo = mid;
        }
        this.pos[axis] = prev + lo;
        if (axis === 'y') {
          if (this.vel.y < 0) this.onGround = true;
          this.vel.y = 0;
        }
        this.vel[axis] = 0;
      }
    }
  }

  // ---- 主更新 ----
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const input = g.input;
    const sens = g.settings ? g.settings.sens : 1;

    // 创造模式：始终自由飞行
    if (g.creative && !this.flyMode) this.flyMode = true;

    // 视角（灵敏度倍率生效）
    const md = input.takeMouseDelta();
    this.yaw -= md.x * 0.0021 * sens;
    this.pitch = clamp(this.pitch - md.y * 0.0021 * sens, -1.55, 1.55);
    this.cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // 飞行模式：创造模式始终可飞；生存模式没有免费飞行（保留按键响应但拒绝开启）。
    // 第一性原理：生存游戏的移动限制本身就是玩法——免费飞行会把
    // 地形、危险、夜间生物与探索收益全部短路。
    if (input.pressed(KEY.FLY)) {
      input.consume(KEY.FLY);
      if (g.creative) {
        this.flyMode = true;
        g.ui.toast('创造模式中始终可飞行');
      } else {
        g.audio.play('deny');
        g.ui.toast('生存模式没有免费飞行 · 修复飞船才能离开地面', true);
      }
    }

    // 手电筒（F 键）
    if (input.pressed(KEY.LIGHT)) {
      input.consume(KEY.LIGHT);
      g.flashlightOn = !g.flashlightOn;
      g.audio.play('click');
      g.ui.toast(g.flashlightOn ? '手电筒已开启' : '手电筒已关闭');
    }

    // 采矿模式切换（R 键）：MkII 才解锁 3×3 区域开采；徒手/MkI 给明确成长提示
    if (input.pressed(KEY.MINING_MODE)) {
      input.consume(KEY.MINING_MODE);
      if (this.toolTier < 2) {
        g.audio.play('deny');
        g.ui.toast('需要 采矿光束 MkII 才能使用区域开采（R）', true);
      } else {
        this.miningMode = this.miningMode === 0 ? 1 : 0;
        g.audio.play('select');
        g.ui.toast(this.miningMode === 1 ? '采矿光束：区域开采 3×3' : '采矿光束：单格精采');
      }
    }

    // 意图方向
    let fwd = 0, strafe = 0;
    if (input.isDown(KEY.FORWARD)) fwd += 1;
    if (input.isDown(KEY.BACK)) fwd -= 1;
    if (input.isDown(KEY.RIGHT)) strafe += 1;
    if (input.isDown(KEY.LEFT)) strafe -= 1;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = (-sin * fwd + cos * strafe);
    const wishZ = (-cos * fwd - sin * strafe);
    const len = Math.hypot(wishX, wishZ);
    const sneak = input.isDown(KEY.SNEAK) && !this.flyMode;
    // Ctrl 疾跑：前进时速度 ×1.45；与潜行互斥。无耐力条——移动爽感优先于写实管理。
    const sprint = !this.flyMode && !sneak && fwd > 0 && input.isDown(KEY.SPRINT);
    // 浅水/深水：腿部入水减速，创造/飞行不受影响
    this.feetInWater = !this.flyMode && g.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.25), Math.floor(this.pos.z)) === B.WATER;
    this.headInWater = !this.flyMode && g.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + EYE), Math.floor(this.pos.z)) === B.WATER;
    const waterK = this.feetInWater ? 0.55 : 1;
    const speed = this.flyMode ? FLY_SPEED * (g.creative ? 1.5 : 1) : (sneak ? SNEAK_SPEED : (sprint ? WALK_SPEED * 1.45 : WALK_SPEED)) * waterK;
    const k = 1 - Math.exp(-14 * dt);
    if (len > 0) {
      this.vel.x += ((wishX / len) * speed - this.vel.x) * k;
      this.vel.z += ((wishZ / len) * speed - this.vel.z) * k;
    } else {
      this.vel.x *= Math.exp(-12 * dt);
      this.vel.z *= Math.exp(-12 * dt);
    }

    // 疾跑 FOV 冲击：轻微拉宽视野，停下平滑恢复
    const hSpeedNow = Math.hypot(this.vel.x, this.vel.z);
    this.sprintK += (((sprint && hSpeedNow > WALK_SPEED * 1.15) ? 1 : 0) - this.sprintK) * (1 - Math.exp(-9 * dt));
    this.baseFov = (g.settings && g.settings.fov) || 75;
    const fovTarget = this.baseFov * (1 + this.sprintK * 0.065);
    if (Math.abs(g.camera.fov - fovTarget) > 0.02) {
      g.camera.fov += (fovTarget - g.camera.fov) * (1 - Math.exp(-10 * dt));
      g.camera.updateProjectionMatrix();
    }

    // 跳跃缓冲：起跳键在落地前 0.12s 内按下也会在触地瞬间起跳；
    // 土狼时间：离开平台边缘后 0.09s 内仍可起跳（经典平台手感，大幅减少"按了没跳"）。
    const jumpPressed = input.pressed(KEY.JUMP);
    if (jumpPressed) {
      input.consume(KEY.JUMP);
      this.jumpBuffer = 0.12;
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyoteTimer = this.onGround ? 0.09 : Math.max(0, this.coyoteTimer - dt);

    this.prevVelY = this.vel.y;
    if (this.flyMode) {
      // 飞行：空格上升，Shift/Ctrl 下降
      const up = input.isDown(KEY.JUMP) ? 1 : 0;
      const down = (input.isDown(KEY.SNEAK) || input.isDown(KEY.SPRINT)) ? -1 : 0;
      this.vel.y += ((up + down) * FLY_SPEED * 0.8 * (g.creative ? 1.5 : 1) - this.vel.y) * k;
      this.onGround = false;
    } else {
      // 行星重力差异化：低重力世界（火星/水星/月球）更飘，巨行星更沉
      this.vel.y -= (g.gravity || GRAVITY) * dt;
    }

    this.moveAxis(dt);

    // 在碰撞解算之后起跳：既能吃到刚落地帧，又不会在腾空瞬间误判
    if (!this.flyMode && this.jumpBuffer > 0 && (this.onGround || this.coyoteTimer > 0)) {
      this.vel.y = (g.jumpVel || JUMP_VEL);
      this.onGround = false;
      this.coyoteTimer = 0;
      this.jumpBuffer = 0;
      g.audio.play('jump');
    }

    // 坠落伤害（按动能阈值换算：低重力世界阈值更低；创造/飞行免疫）
    const fallV = (g.fallHurtVel !== undefined) ? g.fallHurtVel : -17;
    if (this.onGround && this.prevVelY < fallV && !this.flyMode && !g.creative) {
      this.damage((-this.prevVelY - (-fallV)) * 4.2);
      g.ui.shake();
    }

    // 脚步声 + 头部晃动
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hSpeed > 1.2) {
      this.walkDist += hSpeed * dt;
      this.bobPhase += hSpeed * dt * 1.75;
      if (this.walkDist > 2.4) {
        this.walkDist = 0;
        const below = g.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.4), Math.floor(this.pos.z));
        const snd = def(below).sound || 'dirt';
        g.audio.play('footstep', { surface: snd });
      }
    }
    const bobY = this.onGround && !this.flyMode ? Math.sin(this.bobPhase) * 0.045 * clamp(hSpeed / WALK_SPEED, 0, 1) : 0;
    this.cam.position.set(
      this.pos.x + Math.cos(this.bobPhase * 0.5) * 0.008,
      this.pos.y + EYE + bobY,
      this.pos.z
    );

    // 激光枪视模型：呼吸摆动 + 后坐衰减
    this.recoil = Math.max(0, this.recoil - dt * 0.55);
    if (this.gun.visible) {
      this.gun.position.set(
        this.gunBase.x + Math.sin(this.bobPhase * 0.6) * 0.008,
        this.gunBase.y + Math.sin(this.bobPhase * 1.2) * 0.012,
        this.gunBase.z + this.recoil
      );
      this.gun.rotation.set(Math.sin(this.bobPhase * 0.6) * 0.015, 0, -this.recoil * 0.9);
    }

    // 射线目标
    this.updateTarget();

    // 挖掘 / 放置
    this.updateMining(dt);

    // 开火（Q，能量光束；能量线圈模块提升伤害与射速）
    this.fireCd -= dt;
    if (input.pressed(KEY.FIRE) && this.fireCd <= 0 && !g.flight.piloting) {
      input.consume(KEY.FIRE);
      this.fireCd = g.combat.fireCooldown;
      this.recoil = g.combat.hasCoil ? 0.16 : 0.12;
      g.combat.fire();
    }

    // 生存属性
    this.updateVitals(dt);

    // 高亮框：挖掘进度越高，框越收紧且从青色烧向橙红——不靠 UI 也知道“快碎了”
    if (this.target) {
      this.highlight.visible = true;
      this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
      const f = this.mineFrac || 0;
      this.highlight.scale.setScalar(1 - f * 0.12);
      this.highlight.material.color.setRGB(0.5 + f * 0.5, 1 - f * 0.55, 1 - f * 0.65);
    } else {
      this.highlight.visible = false;
      this.highlight.scale.setScalar(1);
      this.highlight.material.color.setHex(0x7ff0ff);
    }

    // 交互（飞船等由 Game 处理）
    if (input.pressed(KEY.INTERACT)) {
      input.consume(KEY.INTERACT);
      g.onInteract();
    }
  }

  updateTarget() {
    const g = this.game;
    this._eye.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.cam.getWorldDirection(this._dir);
    // raycast 只会命中固体或植物方块
    this.target = g.world.raycast(this._eye.x, this._eye.y, this._eye.z, this._dir.x, this._dir.y, this._dir.z, REACH);
    this.updatePlacementGhost();
  }

  updateMining(dt) {
    const g = this.game;
    const input = g.input;
    const t = this.target;

    // 中键：选取方块（消耗事件，避免固定步长循环内重复触发）
    if (input.mousePressed(1) && t) {
      input.consumeMouse(1);
      const itemId = Object.keys(ITEMS).find((id) => ITEMS[id].block === t.id);
      if (itemId) {
        const idx = g.inventory.findInHotbar(itemId);
        if (idx >= 0) {
          g.inventory.select(idx);
          g.audio.play('select');
        }
      }
    }

    // 左键挖掘（激光枪持续射击；创造模式秒破）
    if (input.mouseDown(0) && t && this.mineTarget === null) {
      this.mineTarget = { ...t };
      this.mineProgress = 0;
      this.mineSoundTimer = 0;
    }
    if ((!input.mouseDown(0) || !t) && this.mineTarget) {
      this.mineTarget = null;
      this.mineProgress = 0;
      this.mineFrac = 0;
      g.ui.setCrosshair(t ? 'target' : 'idle', 0);
    }
    if (this.mineTarget) {
      // 目标变化则重置
      if (t && (t.x !== this.mineTarget.x || t.y !== this.mineTarget.y || t.z !== this.mineTarget.z)) {
        this.mineTarget = { ...t };
        this.mineProgress = 0;
      }
      if (!t) { this.mineTarget = null; this.mineProgress = 0; this.mineFrac = 0; }
    }
    if (this.mineTarget) {
      // 工具等级决定速度；MkII 区域模式按命中块数量加收“充能时间”，
      // 9 块一起开采很快，但不会变成无成本清场。
      const area = this.areaMiningTargets(this.mineTarget);
      const areaK = area.length > 1 ? Math.min(3.4, 1.2 + area.length * 0.28) : 1;
      const hardness = g.creative ? 0.04 : def(this.mineTarget.id).hardness / this.miningMultiplier * areaK;
      this.mineProgress += dt;
      this.mineSoundTimer += dt;
      if (this.mineSoundTimer > 0.22) {
        this.mineSoundTimer = 0;
        this.recoil = 0.05;
        g.audio.play('dig');
      }
      const frac = Math.min(1, this.mineProgress / hardness);
      this.mineFrac = frac;
      g.ui.setCrosshair('mining', frac);
      if (this.mineProgress >= hardness) {
        if (area.length > 1) this.breakArea(area);
        else this.breakBlock(this.mineTarget);
        this.mineTarget = null;
        this.mineProgress = 0;
        this.mineFrac = 0;
      }
    } else {
      this.mineFrac = 0;
    }
    this.updateBeam(dt);

    // 右键放置：消耗事件 → 单击只放一个（历史 bug：单次右键连续放置多个）
    if (input.mousePressed(2) && t) {
      input.consumeMouse(2);
      this.placeBlock(t);
    }
  }

  // 采矿光束（从激光枪口发射）
  initBeam() {
    if (this.beam) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.beam = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x7ff0ff, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.game.scene.add(this.beam);
    this.tmpV = new THREE.Vector3();
  }

  updateBeam(dt) {
    const g = this.game;
    this.initBeam();
    const active = !!this.mineTarget; // 主角的"手"就是激光枪：任何挖掘都发射光束
    this.beam.visible = active;
    if (!active) return;
    const t = this.mineTarget;
    // 光束起点 = 枪口世界坐标
    this.muzzle.getWorldPosition(this.tmpV);
    const target = new THREE.Vector3(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    // 轻微抖动模拟光束能量
    const jitter = 0.06;
    const jx = (Math.random() - 0.5) * jitter;
    const jy = (Math.random() - 0.5) * jitter;
    const jz = (Math.random() - 0.5) * jitter;
    const pos = this.beam.geometry.attributes.position;
    pos.setXYZ(0, this.tmpV.x, this.tmpV.y, this.tmpV.z);
    pos.setXYZ(1, target.x + jx, target.y + jy, target.z + jz);
    pos.needsUpdate = true;
    this.beam.material.opacity = 0.55 + Math.random() * 0.35;
  }

  // MkII 区域开采：以瞄准面法线为轴，取 3×3 同平面可破坏方块。
  // 顶/底面 → 水平 3×3；侧面 → 竖直 3×3。既直觉又避免误挖身后的方块。
  areaMiningTargets(t) {
    if (!t || this.toolTier < 2 || this.miningMode !== 1) return t ? [t] : [];
    const { x, y, z, nx, ny, nz } = t;
    const out = [];
    const push = (bx, by, bz) => {
      if (by < 0 || by >= 64) return;
      const id = this.game.world.getBlock(bx, by, bz);
      if (id !== 0 && (isSolid(id) || isPlant(id))) out.push({ x: bx, y: by, z: bz, id });
    };
    if (ny !== 0) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) push(x + dx, y, z + dz);
    } else if (nx !== 0) {
      for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) push(x, y + dy, z + dz);
    } else {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) push(x + dx, y + dy, z);
    }
    return out.length ? out : [t];
  }

  // 区域破坏：一次结算所有掉落，popup 按物品聚合，避免 9 条弹窗刷屏。
  breakArea(targets) {
    const g = this.game;
    if (!targets.length) return;
    const gains = new Map();
    let broken = 0;
    for (const t of targets) {
      const d = g.world.breakBlock(t.x, t.y, t.z);
      if (!d) continue;
      broken++;
      if (g.milestones) g.milestones.bump('mine', 1);
      if (g.onMissionEvent) g.onMissionEvent('mine', {});
      g.particles.spawnBurst(t.x + 0.5, t.y + 0.5, t.z + 0.5, 0xffc26a, {
        count: 7, speed: 2.8, up: 2.0, life: 0.5, size: 0.09,
      });
      if (d.drop) {
        g.quests.onMine(t.id, d.drop.item, d.drop.count);
        gains.set(d.drop.item, (gains.get(d.drop.item) || 0) + d.drop.count);
      }
    }
    if (!broken) return;
    const d0 = def(targets[0].id);
    g.audio.play('break', { surface: d0.sound || 'stone' });
    for (const [itemId, count] of gains) {
      const added = g.inventory.addItem(itemId, count);
      if (added > 0) {
        const item = ITEMS[itemId];
        g.ui.popup(item.name, added, itemId);
        g.audio.play('popup');
        this.notePickup(itemId);
      }
    }
    if (gains.size > 0) {
      g.ui.flashSlot(g.inventory.selected);
      g.ui.renderHotbar(g.inventory.hotbar(), g.inventory.selected);
    }
  }

  breakBlock(t) {
    const g = this.game;
    const d = def(t.id);
    g.world.breakBlock(t.x, t.y, t.z);
    g.audio.play('break', { surface: d.sound || 'stone' });
    if (g.milestones) g.milestones.bump('mine', 1); // 任何方块被挖开都计数（含无掉落方块）
    if (g.onMissionEvent) g.onMissionEvent('mine', {});
    const color = 0x9aa4ad;
    g.particles.spawnBurst(t.x + 0.5, t.y + 0.5, t.z + 0.5, color, {
      count: d.sound === 'plant' ? 10 : 18,
      speed: d.sound === 'plant' ? 2.4 : 3.4,
      up: 2.0, life: 0.6, size: 0.1,
    });
    if (d.drop) {
      const added = g.inventory.addItem(d.drop.item, d.drop.count);
      if (added > 0) {
        const item = ITEMS[d.drop.item];
        g.ui.popup(item.name, added, d.drop.item);
        g.ui.flashSlot(g.inventory.selected);
        g.audio.play('popup');
        g.ui.renderHotbar(g.inventory.hotbar(), g.inventory.selected);
        this.notePickup(d.drop.item);
      }
      g.quests.onMine(t.id, d.drop.item, d.drop.count);
    }
  }

  // 首次拾取的用途提示（钠/氧/护盾电池——避免"采了/合了不知道干嘛"）
  notePickup(itemId) {
    const g = this.game;
    if (itemId === 'sodium' && !g.hintedSodium) {
      g.hintedSodium = true;
      g.ui.toast('钠：危险防护耗尽时自动补充 +50', false);
    } else if (itemId === 'oxygen' && !g.hintedOxygen) {
      g.hintedOxygen = true;
      g.ui.toast('氧：洞穴中生命维持耗尽时自动补充 +60', false);
    }
  }

  placeBlock(t) {
    const g = this.game;
    const sel = g.inventory.getSelected();
    if (!sel) return false;
    const item = ITEMS[sel.itemId];
    if (!item || item.block === undefined) return false;
    const px = t.x + t.nx, py = t.y + t.ny, pz = t.z + t.nz;
    const existing = g.world.getBlock(px, py, pz);
    if (isSolid(existing) || isPlant(existing)) return false;
    // 不与玩家碰撞盒重叠
    const hw = PLAYER_HALF_W;
    const overlaps =
      px + 1 > this.pos.x - hw && px < this.pos.x + hw &&
      py + 1 > this.pos.y && py < this.pos.y + PLAYER_HEIGHT &&
      pz + 1 > this.pos.z - hw && pz < this.pos.z + hw;
    if (overlaps) return false;
    // 创造模式：不消耗材料（背包已备齐）
    if (!g.creative && !g.inventory.removeItem(sel.itemId, 1)) return false;
    g.world.placeBlock(px, py, pz, item.block);
    g.audio.play('place');
    g.quests.onPlace(item.block);
    if (g.milestones) g.milestones.bump('place', 1);
    g.particles.spawnBurst(px + 0.5, py + 0.5, pz + 0.5, 0xbfd4dd, {
      count: 8, speed: 1.6, up: 1.2, life: 0.4, size: 0.07,
    });
    g.ui.renderHotbar(g.inventory.hotbar(), g.inventory.selected);
    return true;
  }

  updateVitals(dt) {
    const g = this.game;
    // 创造模式：不惧冷热、氧气无限、生命无限
    if (g.creative) {
      this.shield = this.shieldMax; this.health = 100; this.life = 100; this.hazard = 100;
      this.underground = false;
      this.oxyWarned = false;
      return;
    }
    const night = g.sky.nightFactor;
    // 危险防护：行星环境危险（剧毒/高温/严寒/辐射/夜间低温）× 风暴倍率
    const stormK = g.weather ? g.weather.stormK : 1;
    const drain = environmentDrain(g.planetHazard, night, stormK);
    if (drain > 0) {
      this.hazard = Math.max(0, this.hazard - drain * dt);
      if (this.hazard <= 0) {
        this.hurtTimer -= dt;
        if (this.hurtTimer <= 0) {
          this.hurtTimer = 1.2;
          this.damage(2.5);
          g.audio.play('hurt');
        }
      } else if (this.hazard < 25 && !this.hazardWarned) {
        this.hazardWarned = true;
        g.ui.toast('危险防护不足 · 采集钠花可自动补充', true);
        g.audio.play('warn');
      }
    } else {
      this.hazard = Math.min(100, this.hazard + HAZARD_REGEN * dt);
      if (this.hazard > 40) this.hazardWarned = false;
    }
    // 洞穴氧气 + 深水窒息：头没入水中的湖泊更深，危险也更大
    const underground = !this.flyMode && g.world.isUnderground(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.underground = underground;
    this.headInWater = !this.flyMode && g.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + EYE), Math.floor(this.pos.z)) === B.WATER;
    if (this.headInWater) {
      this.life = Math.max(0, this.life - OXY_DRAIN * 1.8 * dt);
      if (this.life <= 0) {
        this.hurtTimer -= dt;
        if (this.hurtTimer <= 0) {
          this.hurtTimer = 0.9;
          this.damage(3.5);
          g.audio.play('hurt');
        }
      } else if (this.life < 25 && !this.waterWarned) {
        this.waterWarned = true;
        g.ui.toast('深水缺氧！尽快上浮', true);
        g.audio.play('warn');
      }
    } else if (underground) {
      this.life = Math.max(0, this.life - OXY_DRAIN * dt);
      if (this.life <= 0) {
        this.hurtTimer -= dt;
        if (this.hurtTimer <= 0) {
          this.hurtTimer = 1.0;
          this.damage(3);
          g.audio.play('hurt');
        }
      } else if (this.life < 25 && !this.oxyWarned) {
        this.oxyWarned = true;
        g.ui.toast('氧气不足！尽快返回地表', true);
        g.audio.play('warn');
      }
    } else {
      this.life = Math.min(100, this.life + OXY_REGEN * dt);
      if (this.life > 40) { this.oxyWarned = false; this.waterWarned = false; }
    }
    if (this.hazard > 55 && this.health < 100) this.health = Math.min(100, this.health + 1.1 * dt);
    this.shield = Math.min(this.shieldMax, this.shield + 1.5 * dt);

    // 资源补给（NMS 循环）：钠自动补充危险防护、氧自动补充生命维持。
    // 此前钠/氧是"死资源"（采了没任何用途）——现在探索采集的植物能直接
    // 转化为对环境/洞穴消耗的续航，形成"采集→补给→更深入探索"的正反馈。
    const inv = g.inventory;
    if (this.hazard < 15 && inv.countOf('sodium') > 0) {
      inv.removeItem('sodium', 1);
      this.hazard = Math.min(100, this.hazard + 50);
      this.hazardWarned = false;
      g.audio.play('popup');
      g.ui.toast('消耗 钠 ×1 · 危险防护 +50');
      g.ui.renderHotbar(inv.hotbar(), inv.selected);
    }
    if (this.life < 15 && inv.countOf('oxygen') > 0) {
      inv.removeItem('oxygen', 1);
      this.life = Math.min(100, this.life + 60);
      this.oxyWarned = false;
      g.audio.play('popup');
      g.ui.toast('消耗 氧 ×1 · 生命维持 +60');
      g.ui.renderHotbar(inv.hotbar(), inv.selected);
    }
    // 护盾电池：战斗中护盾跌破 30% 自动补充（合成线从"任务专用"走向"生存装备"）
    if (this.shield < 30 && inv.countOf('shield_cell') > 0) {
      inv.removeItem('shield_cell', 1);
      this.shield = Math.min(this.shieldMax, this.shield + 60);
      g.audio.play('popup');
      g.ui.toast('消耗 护盾电池 ×1 · 护盾 +60');
      g.ui.renderHotbar(inv.hotbar(), inv.selected);
    }
  }

  damage(amount) {
    if (this.game.creative) return; // 创造模式免疫伤害
    const absorbed = Math.min(this.shield, amount * 0.5);
    this.shield -= absorbed;
    this.health -= (amount - absorbed);
    this.game.ui.hurtFlash();
    if (this.health <= 0) {
      this.health = 100;
      this.shield = this.shieldMax;
      // 基地重生：有基地终端时优先回到家里，而不是每次被扔回坠机点
      const g = this.game;
      const base = g.currentBase ? g.currentBase() : null;
      if (base && g.world.getBlock(base.x, base.y, base.z) === B.BASE_UNIT) {
        this.respawn({ x: base.x + 0.5, y: base.y + 1.2, z: base.z + 0.5 });
        g.ui.toast('生命信号中断 · 已从基地终端重生', true);
      } else {
        const sp = g.world.spawnPoint();
        this.respawn(sp);
        g.ui.toast('生命信号中断 · 紧急生命维持已激活', true);
      }
    }
  }
}
