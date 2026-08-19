// 游戏编排：渲染器、子系统装配、加载流程、主循环
import * as THREE from 'three';
import { RENDER_DIST, CHUNK, WALK_SPEED, KEY, EYE, smoothstep, GRAVITY, JUMP_VEL, BASE_REST_COOLDOWN } from './constants.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { World } from '../world/world.js';
import { createBlockTextures } from '../world/textures.js';
import { TILE } from '../world/tiles.js';
import { Inventory, ITEMS } from '../systems/inventory.js';
import { Quests } from '../systems/quests.js';
import { RECIPES, recipeById, canCraft, missingOf, craft } from '../systems/crafting.js';
import { Player } from '../entities/player.js';
import { Particles } from '../entities/particles.js';
import { Weather } from '../entities/weather.js';
import { CrashedShip, SHIP_REPAIR_COSTS } from '../entities/ship.js';
import { ShipFlight } from '../entities/shipflight.js';
import { SpaceSystem } from '../space/systemV2.js';
import { SpaceCombat } from '../space/spacecombat.js';
import {
  AU, KM_PER_UNIT, bodyById, bodyFacts, childrenOf, systemMeta, systemLevelNodes, GATEWAY_NODES,
  STAR_SYSTEMS, logProject, systemOrbitRange, formatDistance, homeBodyId, worldOffset,
  gravityFactor, dayLengthSeconds, sunDiscParams, atmoDensityOf, starColorOf, moonSeedOf,
} from '../space/celestial.js';
import { formatDistanceM, formatEta } from '../space/universe.js';
import { Scanning } from '../entities/scanning.js';
import { MobManager } from '../entities/mobs.js';
import { Combat } from '../entities/combat.js';
import { hasSave, clearSave, saveGame, applySaveData, exportSaveText, importSaveText } from '../systems/save.js';
import { loadSettings, saveSettings } from './settings.js';
import { STATION_SELL, STATION_BUY, STATION_ORDERS, ORDER_COOLDOWN, SHIP_UPGRADES, stationSell, stationBuy, stationDeliver, stationUpgrade, buyPriceOf } from '../systems/station.js';
import { CRASH_LOGS, STATION_NPCS, logById, getNpcLines } from '../systems/npcs.js';
import { CrashLogs } from '../entities/logs.js';
import { Anomalies } from '../entities/anomalies.js';
import { Milestones, MILESTONES } from '../systems/milestones.js';
import { createCrate, crateCanAdd, crateAdd, crateTake, collectCrates, restoreCrates } from '../systems/storage.js';
import { MISSION_TEMPLATES, MISSION_COOLDOWN, createMission, missionEvent, missionReady, missionProgressText, missionOffers } from '../systems/missions.js';
import { Sky } from '../render/sky.js';
import { B, def as blockDef } from '../world/blocks.js';

export class Game {
  constructor(seed, saveData = null) {
    this.seed = seed;
    this.saveData = saveData;
    this.running = false;
    this.paused = false;
    this.inMenu = false; // 背包/维修面板打开时抑制暂停界面
    this.accumulator = 0;
    this.fixedDt = 1 / 60;
    this.smokeTimer = 0;
    this.smokeV = new THREE.Vector3();  // 坠机烟柱坐标复用，避免定时器路径反复分配
    this.smokeV2 = new THREE.Vector3();
    this.frame = 0;

    // 设置（localStorage 持久化）
    this.settings = loadSettings();
    this.creative = !!this.settings.creative;
    this.flashlightOn = false;
    this.wantLock = false;   // 指针锁请求失败 → 等待下一个用户手势重锁
    this.stuckTimer = 0;
    this.stuckHintShown = false;
    this.relockGrace = 0;         // 最近一次重锁请求时刻：缓冲期内 Esc 只重试锁、不弹暂停
    this.relockRetryTimer = null; // 重锁失败后的自动重试定时器
    this.relockRetries = 0;       // 自动重试次数上限（用户手势重试不受限）
    this.stationNear = false;  // 太空模式接近空间站
    this.gatewayNear = false;  // 太空模式接近跃迁门
    this.beltNear = false;     // 太空模式进入主小行星带资源区
    this.beltHarvestCd = 0;    // 小行星开采冷却
    this.beltCharges = 0;      // 本次进入太空的矿点剩余次数
    this.docked = false;       // 已停靠空间站
    this.stationOrderCd = {};  // 空间站可重复订单冷却（秒）
    this.mission = null;        // 任务板当前悬赏
    this.missionCd = 0;         // 悬赏完成后接单冷却
    this.missionSeed = 0;       // 任务板提供轮换种子
    this.baseRestCd = 0;        // 基地终端夜间休息冷却（秒）
    this.shipUpgrades = { engine: 0, shield: 0 }; // 飞船升级（空间站船坞）
    this.collectedLogs = new Set(); // 已读取的数据日志（世界观收集品）
    this.collectedAnomalies = new Set(); // 已调查的异常点（遗迹/无人机/补给箱，按星球 id 隔离）
    this.discoveredSurface = new Set(); // 已发现的地表航点（探索迷雾：未发现的异常点不出现在地表图）
    this.baseWorlds = {};    // 基地终端按世界隔离：worldKey → { x, y, z }
    this.crateWorlds = {};   // 储物箱按世界隔离：worldKey → crate[]
    this.activeCrate = null; // 当前打开的储物箱
    this.baseBeacon = null;  // 基地信标光（当前世界）
    this.logs = null;
    this.anomalies = null;
    this.nearLog = null;
    this.hintedSodium = false; // 首次拾取钠/氧的用途提示（存活资源补给）
    this.hintedOxygen = false;
    this.hintedShield = false; // 首次合成护盾电池的用途提示
    this.intro = { active: false, t: 0, dur: 5.5 }; // 新游戏开场俯瞰镜头
    this.nightWarned = false; // 首次入夜提示（夜寒/生物/钠补给）

    // 自适应性能：动态分辨率 + 网格化预算（保证帧率优先）
    this.renderScale = 1;        // 当前渲染分辨率倍率（0.6..1，低帧时自动下调）
    this.frameMsAvg = 16;        // 帧耗时滑动均值
    this.adaptiveTimer = 0.5;    // 画质调整间隔

    // 渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.clock = new THREE.Clock();
    this.applyGraphics();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const placeholder = document.getElementById('gl');
    placeholder.replaceWith(this.renderer.domElement);
    this.renderer.domElement.id = 'gl';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x4a9bd8);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.08, 900);

    // 太空系统先行（世界生成需要母星/存档星球的地形参数）
    this.space = new SpaceSystem(this);
    const savedGalaxyId = this.saveData ? (this.saveData.galaxyId || 'solar') : 'solar';
    const spawnGalaxy = this.space.galaxies[savedGalaxyId] || this.space.galaxies.solar;
    const spawnPlanetId = this.saveData ? (this.saveData.planetId || 0) : 0;
    const spawnPlanet = spawnGalaxy[spawnPlanetId] || spawnGalaxy[0];

    this.input = new Input(this.renderer.domElement);
    this.audio = new AudioEngine();
    // 音量设置先记录在引擎上（AudioContext 首次手势后才建立，建立时取用）
    this.audio.setMusicVolume(this.settings.musicVol);
    this.audio.setSfxVolume(this.settings.sfxVol);
    this.ui = new UI();
    this.inventory = new Inventory();
    this.world = new World(seed, { ...spawnPlanet.terrain, surface: spawnPlanet.surface, ores: spawnPlanet.ores, plants: spawnPlanet.plants, underground: spawnPlanet.underground || null });
    this.world.renderDist = this.settings.renderDist;
    this.planetHazard = spawnPlanet.hazard; // 行星环境危险（剧毒/高温/严寒/辐射）
    this.quests = new Quests(this);
    this.milestones = new Milestones(this); // 里程碑（成就）：游玩正反馈脉冲
    this.sky = null;
    this.particles = null;
    this.player = null;
    this.ship = null;
    this.planetName = (this.saveData && this.saveData.planetName) || this.makePlanetName();
    // 多层级星图状态：恒星级 → 恒星系统 → 行星系统 → 地表导航
    this.starMapState = { level: 'system', viewSystemId: 'solar', focusId: null, selectedId: null };
    this.surfaceTarget = null; // 步行地表航点 { id, name, x, z }
    // 行星本质差异化：真实天文参数 → 可玩参数（重力/昼夜/太阳视大小/大气）
    this.bodyProfile = spawnPlanet;
    this.applyBodyProfile(spawnPlanet);

    window.addEventListener('resize', () => this.onResize());
    this.bindInput();
  }

  // ---- 画面质量：像素比 + 阴影（低/中/高） ----
  // resetAdaptive=false 供动态分辨率内部调用：保留当前 renderScale。
  applyGraphics(resetAdaptive = true) {
    if (resetAdaptive) this.renderScale = 1;
    const g = this.settings.graphics;
    const ratio = g === 'low' ? 1 : g === 'medium' ? 1.25 : 1.75;
    const capped = Math.min(window.devicePixelRatio || 1, ratio);
    const adaptiveFloor = 0.6;
    const scale = Math.max(adaptiveFloor, Math.min(1, this.renderScale || 1));
    this.renderer.setPixelRatio(Math.max(0.5, capped * scale));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const shadows = g !== 'low';
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      // 光照材质着色器需按阴影开关重编译
      if (this.opaqueMat) this.opaqueMat.needsUpdate = true;
      if (this.cutoutMat) this.cutoutMat.needsUpdate = true;
    }
    if (shadows && this.sky && this.sky.sunLight) {
      const size = g === 'medium' ? 1024 : 2048;
      this.sky.sunLight.shadow.mapSize.set(size, size);
    }
  }

  makePlanetName() {
    // 母星固定为地球
    return '地球 · 太阳系';
  }

  // 行星本质差异化：把统一模型里的真实参数接入物理与天空
  // （重力 / 昼夜长度与方向 / 太阳视大小 / 恒星颜色 / 大气密度）
  applyBodyProfile(def) {
    if (!def) return;
    this.bodyProfile = def;
    this.gravity = GRAVITY * gravityFactor(def);
    this.jumpVel = JUMP_VEL;
    // 坠落伤害阈值按动能换算：低重力世界阈值更低，高重力世界更早受伤
    this.fallHurtVel = -Math.sqrt(2 * this.gravity * 6.2);
    this.bodyDayLength = dayLengthSeconds(def);
    this.bodyRetrograde = !!def.dayHours && def.dayHours < 0;
    if (this.sky) {
      // 卫星的太阳视大小按母行星轨道计算（月球天空中的太阳 ≈ 地球大小）
      const sunDef = def.sunAU !== undefined ? { ...def, aAU: def.sunAU } : def;
      const sun = sunDiscParams(sunDef);
      this.sky.setDayLength(this.bodyDayLength, this.bodyRetrograde);
      this.sky.setSunAppearance(sun.scale, sun.sharp, sun.soft);
      this.sky.setSunTint(starColorOf(this.space ? this.space.galaxyId : 'solar'));
      this.sky.setAtmosphere(atmoDensityOf(def));
    }
  }

  // 环境徽章文案：普通/夜间危险不常驻显示，剧毒/高温/严寒/辐射才显示
  hazardBadgeText(hazard) {
    if (!hazard || hazard.kind === 'none' || hazard.kind === 'mild') return null;
    return hazard.label || hazard.kind;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  startPlaying(showIntro = false) {
    this.audio.ensureStarted();
    this.audio.setMusicMode('game');
    this.audio.play('uiOpen');
    this.ui.showMenu(false);
    this.ui.showExit(false);
    this.ui.showSettings(false);
    this.ui.setHudVisible(true);
    this.inMenu = false; // 从主菜单进入时清掉面板状态，防止 active 判定卡死
    this.wantLock = false;
    // 清掉菜单期间残留的边沿按键：否则出生点会立刻误触 E/Tab 弹面板（历史 bug 类）
    this.input.clearTransients();
    this.input.requestLock();
    this.running = true;
    // 新游戏开场俯瞰镜头（继续存档时跳过——玩家已熟悉流程，镜头反而拖沓）
    if (showIntro) this.beginIntro();
  }

  // ---- 开场镜头：从高空俯瞰坠机点 → 掠过残骸 → 落到玩家眼睛 ----
  beginIntro() {
    const it = this.intro;
    if (!this.ship || !this.player) return;
    const sp = this.ship.worldPos;
    const eye = new THREE.Vector3(this.player.pos.x, this.player.pos.y + EYE, this.player.pos.z);
    it.a = new THREE.Vector3(sp.x + 16, sp.y + 15, sp.z + 20);
    it.b = new THREE.Vector3(sp.x + 8, sp.y + 6.5, sp.z + 9);
    it.c = new THREE.Vector3(sp.x + 3.5, sp.y + 2.8, sp.z + 4.5);
    it.eye = eye.clone();
    it.ship = new THREE.Vector3(sp.x, sp.y + 1.2, sp.z);
    const dx = sp.x - eye.x, dy = sp.y + 1.2 - eye.y, dz = sp.z - eye.z;
    it.shipYaw = Math.atan2(-dx, -dz);
    it.shipPitch = Math.atan2(dy, Math.hypot(dx, dz));
    it.t = 0;
    it.active = true;
    this.ui.hud.classList.add('hidden');
    this.ui.introFade.style.opacity = '1';
    this.input.clearTransients();
  }

  updateIntro(dt) {
    const it = this.intro;
    if (!it.active) return;
    it.t += dt;
    const k = Math.min(1, it.t / it.dur);
    const cam = this.camera;
    const p = it.tmp || (it.tmp = new THREE.Vector3());
    if (k < 0.4) {
      p.lerpVectors(it.a, it.b, smoothstep(0, 0.4, k));
      cam.position.copy(p);
      cam.lookAt(it.ship);
    } else if (k < 0.78) {
      p.lerpVectors(it.b, it.c, smoothstep(0.4, 0.78, k));
      cam.position.copy(p);
      cam.lookAt(it.ship);
    } else {
      // 末段：滑入玩家眼睛，视角从"看飞船"平滑转向出生朝向
      const s = smoothstep(0.78, 1, k);
      p.lerpVectors(it.c, it.eye, s);
      cam.position.copy(p);
      let dy = it.shipYaw - this.player.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const yaw = it.shipYaw - dy * s;
      const pitch = it.shipPitch + (this.player.pitch - it.shipPitch) * s;
      cam.rotation.set(pitch, yaw, 0, 'YXZ');
    }
    this.ui.introFade.style.opacity = String(1 - smoothstep(0, 0.12, k));
    if (k >= 1) this.endIntro();
  }

  endIntro() {
    const it = this.intro;
    if (!it.active) return;
    it.active = false;
    this.ui.introFade.style.opacity = '0';
    if (this.player) this.player.updateCamera();
    this.ui.hud.classList.remove('hidden');
    this.input.clearTransients();
    this.audio.play('popup');
    this.ui.toast('意识恢复 · 检查你的飞船残骸');
  }

  bindInput() {
    this.input.onLockChange = (locked) => {
      if (locked) {
        this.wantLock = false;
        this.relockGrace = 0;
        this.clearRelockRetry();
        // 面板开着时禁止指针锁定：exitLock 与 requestLock 竞态可能导致
        // "面板打开但指针已锁" → 第一次 Esc 被浏览器吞掉（只退锁不关面板）
        if (this.inMenu) {
          this.input.exitLock();
          return;
        }
        this.setPaused(false);
      } else if (this.running && !this.inMenu) {
        // 刚发起的重锁请求失败（浏览器冷却/拒绝）时不要弹暂停：
        // 交给 stuck-hint 提示 + onGesture 重试 + 定时自动重试，
        // 避免"关面板→暂停误弹/抖动"
        if (this.wantLock) {
          this.scheduleRelockRetry();
          return;
        }
        this.setPaused(true);
      }
    };
    // 用户手势兜底：指针锁请求被浏览器拒绝（非手势上下文/冷却）后，
    // 任何一次按键或点击都会重试锁定，防止"E 进面板 → Esc 后全键盘失灵"的卡死
    this.input.onGesture = () => {
      // 开场镜头：任意按键/点击跳过
      if (this.intro.active) { this.endIntro(); return; }
      if (!this.running) return;
      if (this.wantLock && !this.paused && !this.inMenu && !this.input.locked) {
        // 不提前清 wantLock：成功由 pointerlockchange 清除，失败保持待重试
        this.input.requestLock();
      } else if (this.paused && !this.inMenu) {
        this.resumeFromPause();
      }
    };
    // 新游戏：带开场俯瞰镜头；继续存档：直接进游戏（玩家已熟悉流程）
    this.ui.onStart(() => this.startPlaying(true));
    // 继续：当前世界已是存档世界，直接进入
    this.ui.onContinue(() => this.startPlaying(false));
    // 新游戏：清档后重载（生成新种子）
    this.ui.onNew(() => {
      clearSave();
      location.search = '';
    });
    // 读取存档：整页重载（main.js 自动从 localStorage 恢复）
    this.ui.onLoad(() => {
      if (hasSave()) { this.audio.play('uiOpen'); location.reload(); }
    });
    // 导出存档：下载 JSON 文件（备份/分享/报 bug 附存档）
    this.ui.onExport(() => {
      const text = exportSaveText();
      if (!text) { this.ui.toast('暂无存档可导出', true); return; }
      let seed = '';
      try { seed = JSON.parse(text).seed || ''; } catch { /* 忽略 */ }
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `voxelspace-save-${seed}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.ui.toast('存档已导出为 JSON 文件');
    });
    // 导入存档：选择文件 → 校验 → 写入 → 重载（文件读取为异步，由 ui 回调文本）
    this.ui.onImport((text) => {
      const r = importSaveText(text);
      if (r.ok) {
        this.ui.toast('存档导入成功 · 正在载入…');
        setTimeout(() => { location.search = ''; location.reload(); }, 800);
      } else {
        this.ui.toast('无效的存档文件', true);
      }
    });
    // 设置（主菜单/暂停菜单共用面板）
    this.ui.onSettingsOpen(() => this.openSettings());
    // 保存游戏
    this.ui.onSave(() => {
      saveGame(this);
      this.audio.play('craft');
      this.ui.toast('存档已保存');
    });
    // 里程碑面板（暂停菜单入口）
    this.ui.onMilestones(() => this.openMilestones());
    // 整理背包（只整理 27 格背包区，不动快捷栏）
    this.ui.onSort(() => {
      this.inventory.sortPack();
      this.audio.play('select');
      this.refreshInventoryUI();
    });
    // 退出到主菜单
    this.ui.onMenuExit(() => this.exitToMenu());
    // 退出游戏
    this.ui.onQuit(() => this.quitGame());
    this.ui.onExitBack(() => {
      this.ui.showExit(false);
      this.ui.showMenu(true);
      this.ui.setupMenu(hasSave());
      this.audio.play('uiClose');
    });
    this.ui.onResume(() => this.resumeFromPause());
    // 背包：点击槽位（快捷栏选中；背包格与快捷栏交换）
    this.ui.onSlotClick = (i) => {
      if (i < 9) {
        this.inventory.select(i);
        this.audio.play('select');
      } else {
        const a = this.inventory.slots[i];
        const b = this.inventory.slots[this.inventory.selected];
        this.inventory.slots[i] = b;
        this.inventory.slots[this.inventory.selected] = a;
        this.audio.play('click');
      }
      this.refreshInventoryUI();
    };
    this.ui.onCraftClick = (recipeId) => this.craftItem(recipeId);
    this.ui.onRepairClick = (key) => this.repairComponent(key);
    this.ui.onJourneyClose(() => this.closeJourney());
    this.ui.onSelectTarget = (id) => this.selectNavTarget(id);
    // 星图轨道画布：点击选择节点 → 详情面板
    this.ui.onStarMapSelect = (id) => this.starMapSelectNode(id);
    // 详情面板动作：设定目标 / 进入子星图 / 返回上级
    this.ui.onStarMapAction = (action, id) => this.starMapAction(action, id);
    // 空间站面板动作（交易/订单/升级）
    this.ui.onStationAction = (action, id, count) => this.handleStationAction(action, id, count);
    this.ui.onStorageAction = (action, index) => this.handleStorageAction(action, index);
    this.ui.onStationTab = (tab) => this.renderStationUI(tab);
    // NPC 对话 → 任务同步（站长线）
    this.ui.onNpcClick = (npcId) => this.quests.onNpcTalk(npcId);
    // 日志面板：点击已读日志重读
    this.ui.onLogSelect = (id) => this.ui.renderLog(id, CRASH_LOGS, this.collectedLogs);
    // UI 悬停音效
    window.__audioHover = () => this.audio.play('hover');
  }

  // ---- 指针锁与暂停 ----
  requestGameLock() {
    this.wantLock = true;
    // 记录重锁请求时刻：缓冲窗口内再按 Esc 视为"仍在退出面板"，只重试锁、
    // 不弹暂停（历史 bug：关面板后的第二下 Esc 把暂停菜单调了出来）
    this.relockGrace = performance.now();
    this.input.requestLock();
  }

  // 重锁失败（浏览器冷却/激活窗口过期）→ 定时自动重试：
  // 大多数"关面板后光标变自由"场景会在 ~1.3s 内自行恢复，无需用户再按一次键
  clearRelockRetry() {
    if (this.relockRetryTimer) { clearTimeout(this.relockRetryTimer); this.relockRetryTimer = null; }
    this.relockRetries = 0;
  }
  scheduleRelockRetry() {
    if (this.relockRetryTimer || this.relockRetries >= 2) return;
    this.relockRetries++;
    this.relockRetryTimer = setTimeout(() => {
      this.relockRetryTimer = null;
      if (this.wantLock && this.running && !this.paused && !this.inMenu && !this.input.locked) {
        this.input.requestLock();
      }
    }, 1350);
  }

  resumeFromPause() {
    if (!this.paused) return;
    this.paused = false;
    this.ui.showPaused(false);
    this.audio.play('uiOpen');
    // 清空暂停期间积累的输入，防止恢复瞬间误操作/连放方块
    this.input.down.clear();
    this.input.clearTransients();
    this.requestGameLock();
  }

  setPaused(v) {
    if (this.paused === v) return;
    if (v && this.inMenu) return; // 面板打开时抑制暂停界面
    this.paused = v;
    this.ui.showPaused(v);
    if (v) {
      this.audio.play('uiClose');
      // 旅程概览：让暂停界面回答"我玩到哪了"
      this.ui.setPauseStats({
        planets: this.space ? this.space.visitedSolar.size + this.space.visitedProxima.size + (this.space.visitedSirius ? this.space.visitedSirius.size : 0) : 1,
        credits: this.inventory.countOf('credits'),
        milestones: `${this.milestones.earnedCount}/${this.milestones.total}`,
        quests: `${this.quests.completedIds.size}/${this.quests.missionView().total}`,
      });
    }
  }

  // ---- 分阶段初始化（带加载进度） ----
  async init() {
    const ui = this.ui;
    this.debugTimings = {};
    let t0 = performance.now();
    const mark = (name) => {
      const now = performance.now();
      this.debugTimings[name] = Math.round(now - t0);
      t0 = now;
    };
    ui.showLoading(true);
    ui.showMenu(true);
    ui.setSeed(this.seed);
    ui.setLoading(4, '初始化渲染器…');
    await nextFrame();

    // 太空系统先行（存档需要读取行星色板；构造器中已建则复用）
    if (!this.space) this.space = new SpaceSystem(this);

    ui.setLoading(12, '生成像素纹理图集…');
    const savedGalaxy = this.saveData
      ? (this.space.galaxies[this.saveData.galaxyId || 'solar'] || this.space.galaxies.solar)
      : null;
    const savedPalette = savedGalaxy ? savedGalaxy[this.saveData.planetId || 0].palette : null;
    const { atlas, icons } = createBlockTextures(savedPalette);
    atlas.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.atlas = atlas;
    this.skyPalette = savedPalette;
    await nextFrame();

    ui.setLoading(20, '配置方块材质…');
    this.opaqueMat = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });
    this.cutoutMat = new THREE.MeshBasicMaterial({
      map: atlas, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide,
    });
    // 水体：透明 Lambert + 顶点光照，保留湖面明暗，alpha 来自瓦片
    this.fluidMat = new THREE.MeshLambertMaterial({
      map: atlas, vertexColors: true, transparent: true, opacity: 0.78,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.world.setScene(this.scene);
    this.world.setMaterials([this.opaqueMat, this.cutoutMat, this.fluidMat]);
    await nextFrame();

    ui.setLoading(28, '程序生成地形与坠毁点…');
    const sp = this.world.spawnPoint();
    const pcx = Math.floor(sp.x / CHUNK), pcz = Math.floor(sp.z / CHUNK);
    this.world.ensureArea(pcx, pcz, 2);
    this.world.carveCrash();
    mark('gen');
    await nextFrame();

    ui.setLoading(40, '构建初始区块网格…');
    await this.remeshAll(sp.x, sp.z, (pct) => ui.setLoading(40 + pct * 45, '构建初始区块网格…'));
    mark('mesh');

    ui.setLoading(88, '装配天空与光照…');
    this.sky = new Sky(this.scene);
    if (this.skyPalette) this.sky.setPalette(this.skyPalette);
    this.applyBodyProfile(this.bodyProfile); // 真实参数 → 重力/昼夜/太阳视大小/大气
    this.particles = new Particles(this.scene);
    this.weather = new Weather(this);
    const spawnPlanetId2 = this.saveData ? (this.saveData.planetId || 0) : 0;
    const spawnGalaxy2 = this.space.galaxies[this.saveData ? (this.saveData.galaxyId || 'solar') : 'solar'] || this.space.galaxies.solar;
    const spawnPlanet2 = spawnGalaxy2[spawnPlanetId2] || spawnGalaxy2[0];
    this.weather.setPlanet(spawnPlanet2.weather, this.hazardBadgeText(spawnPlanet2.hazard));
    this.applyGraphics(); // 画质设置需在光照创建后二次应用（阴影贴图尺寸）
    await nextFrame();

    ui.setLoading(93, '放置飞船残骸…');
    this.ship = new CrashedShip(this.scene, atlas);
    // 落在残骸堆之上：船体整体高出弹坑边缘，出生点第一眼即可看到任务目标
    // （历史 bug：按坑底放置 → 船体整体陷在坑里，远处只能看到焦土墙）
    const crashGy = this.world.getGroundY(this.world.crashX, this.world.crashZ);
    this.world.buildWreckMound(this.world.crashX, this.world.crashZ);
    this.ship.setPosition(
      this.world.crashX,
      crashGy + 4.05,
      this.world.crashZ
    );

    this.player = new Player(this);
    this.player.respawn(sp);
    // 出生视角对准坠毁点：坠毁点可能在出生点任意方位（最低洼处），
    // 固定朝向会导致新玩家第一眼背对飞船、只看到树（视觉审查发现）
    {
      const cdx = this.world.crashX - this.player.pos.x;
      const cdz = this.world.crashZ - this.player.pos.z;
      this.player.yaw = Math.atan2(-cdx, -cdz);
      this.player.pitch = -0.06;
      this.player.updateCamera();
    }
    this.flight = new ShipFlight(this);
    this.spaceCombat = new SpaceCombat(this);
    this.scanning = new Scanning(this);
    // 坠机点数据日志（世界观收集品）
    this.logs = new CrashLogs(this.scene, this.world);
    this.logs.setCollected(this.collectedLogs);
    // 行星地表异常点（古代遗迹/无人机残骸/补给箱——探索奖励）
    this.anomalies = new Anomalies(this, this.world);
    this.anomalies.setCollected(this.collectedAnomalies);
    // 头灯（洞穴照明 + F 键手电筒）
    this.headlamp = new THREE.PointLight(0xfff2d0, 0, 15, 1.8);
    this.scene.add(this.headlamp);
    // 基地信标：安家后提供可识别的蓝青光点（白天也可见）
    this.baseBeacon = new THREE.PointLight(0x4fe8ff, 1.5, 18, 1.6);
    this.baseBeacon.visible = false;
    this.scene.add(this.baseBeacon);
    this.caveFactor = 0;
    // 地热熔岩：动态火光 + 靠近灼伤（热行星地下风险）
    this.magmaLights = [];
    this.magmaScanTimer = 0;
    this.magmaBurnCd = 0;
    this.magmaWarned = false;
    // 战斗
    this.mobs = new MobManager(this);
    this.combat = new Combat(this);

    // 世界事件 → 任务与基地实体同步
    this.world.events.onBlockBroken = (x, y, z, id) => {
      if (id === B.BASE_UNIT) this.removeBaseAt(x, y, z);
      else if (id === B.STORAGE) this.removeCrateAt(x, y, z);
    };
    this.world.events.onBlockPlaced = (x, y, z, id) => {
      if (id === B.BASE_UNIT) this.registerBaseAt(x, y, z);
      else if (id === B.STORAGE) this.registerCrateAt(x, y, z);
    };

    // UI 装配
    const itemIconMap = {};
    const itemNames = {};
    for (const itemId of Object.keys(ITEMS)) {
      itemIconMap[itemId] = ITEMS[itemId].tile;
      itemNames[itemId] = ITEMS[itemId].name;
    }
    this.ui.setItemIconMap(itemIconMap, icons);
    // 合成按钮可用性 = 材料够 + 背包放得下（满背包时置灰而非点了才提示）
    const canCraftFit = (inv, r) => canCraft(inv, r) && inv.canAdd(r.out.item, r.out.count);
    this.ui.setCraftContext({ canCraft: canCraftFit, missingOf, itemNames });
    this.ui.renderHotbar(this.inventory.hotbar(), this.inventory.selected);
    this.quests.render();
    this.ui.setPlanetInfo({ name: this.planetName, time: this.sky.clockText(), pos: this.posText() });

    // 存档恢复 + 菜单按钮
    if (this.saveData) {
      applySaveData(this, this.saveData);
      this.saveData = null;
      // 工具等级从物品反推（跨存档迁移/商店购买后的旧档同步）
      if (this.inventory.countOf('mining_beam_mk2') > 0) this.milestones.bump('toolTier2', 1);
      if (this.inventory.countOf('energy_coil') > 0) this.milestones.bump('weaponMod', 1);
      // 卫星存档：重建月面世界（存档的 planetId 是母行星，bodyId 才是真正所在天体）
      if (this.space && this.space.bodyId) this.rebuildWorldForBody(this.space.bodyId);
      this.applyShipUpgrades();
      this.syncBaseForCurrentWorld();
      if (this.space && typeof this.space.restoreSpaceState === 'function' && this._pendingFlightRestore) {
        this.space.restoreSpaceState(this._pendingFlightRestore);
        this._pendingFlightRestore = null;
      }
      this.ui.toast('已读取存档 · 欢迎回来');
    } else {
      this.applyShipUpgrades();
    }
    // 设置面板 + 模式徽章
    this.ui.initSettingsPanel(this.settings, (key, value) => {
      if (key === 'fov') { this.camera.fov = value; this.camera.updateProjectionMatrix(); }
      if (key === 'renderDist') this.world.renderDist = value;
      if (key === 'graphics') this.applyGraphics();
      if (key === 'creative') this.setCreative(value);
      if (key === 'musicVol') this.audio.setMusicVolume(value);
      if (key === 'sfxVol') this.audio.setSfxVolume(value);
      saveSettings(this.settings);
    });
    this.ui.setModeBadge(this.creative ? '创造模式' : '生存模式');
    this.ui.setupMenu(hasSave());
    this.autoSaveTimer = 0;
    window.addEventListener('beforeunload', () => {
      if (this.running) saveGame(this);
    });

    ui.setLoading(100, '初始化完成');
    await nextFrame();
    ui.showLoading(false);
    // 主菜单氛围乐（AudioContext 需用户手势，首帧只记录请求）
    this.audio.setMusicMode('menu');

    this.renderer.setAnimationLoop(() => this.loop());
  }

  async remeshAll(px, pz, onProgress) {
    let guard = 0;
    let last = 1;
    while (this.world.dirty.size > 0 && last > 0 && guard < 2000) {
      last = this.world.remeshQueue(px, pz, 6);
      guard++;
      if (guard % 3 === 0) {
        await nextFrame();
        if (onProgress) onProgress(this.remeshProgress());
      }
    }
  }

  remeshProgress() {
    const total = this.world.chunks.size;
    const dirty = this.world.dirty.size + this.world.edgeRefresh.size;
    return total > 0 ? Math.max(0, 1 - dirty / total) : 0;
  }

  posText() {
    if (this.flight && this.flight.piloting && this.space && this.space.active && this.flight.universePos) {
      const star = this.space.universe.starOf(this.space.galaxyId);
      const p = this.flight.universePos;
      const d = star ? Math.hypot(p.x - star.posM.x, p.y - star.posM.y, p.z - star.posM.z) : 0;
      return `距${star ? star.name : '恒星'} ${formatDistanceM(d)} · 高度 ${formatDistanceM(this.flight.altitudeM())}`;
    }
    if (this.flight && this.flight.piloting) {
      const p = this.flight.pos;
      return `${Math.round(p.x)} / ${Math.round(p.y)} / ${Math.round(p.z)}`;
    }
    const p = this.player ? this.player.pos : { x: 0, y: 0, z: 0 };
    return `${Math.round(p.x)} / ${Math.round(p.y)} / ${Math.round(p.z)}`;
  }

  // 当前所在星域（宇宙导航的“我在哪里”）
  regionLabel() {
    if (!this.space) return null;
    const sys = systemMeta(this.space.galaxyId).name;
    const body = (this.space.currentBodyDef && this.space.currentBodyDef()) || this.space.galaxy[this.space.current];
    if (!body) return `星域 ${sys}`;
    if (this.flight && this.flight.piloting && this.space.active) {
      return `星域 ${sys} · ${body.name}轨道空间`;
    }
    if (this.flight && this.flight.piloting) {
      const airless = body.kind === 'moon' || (body.atmoDensity !== undefined && body.atmoDensity < 0.3);
      return `星域 ${sys} · ${body.name} · ${airless ? '低空' : '大气层内'}`;
    }
    return `星域 ${sys} · ${body.name}地表`;
  }

  // ---- 旅程完成面板 ----
  showJourney() {    this.audio.play('quest');
    this.openPanel(() => {
      this.ui.showJourney(true, {
        visited: this.space ? this.space.visitedSolar.size + this.space.visitedProxima.size + (this.space.visitedSirius ? this.space.visitedSirius.size : 0) : 1,
        done: this.quests.completedIds.size,
        total: 17,
        planet: this.planetName,
      });
    });
  }
  closeJourney() {
    this.audio.play('uiClose');
    this.closePanel(() => this.ui.showJourney(false));
  }

  // ---- 里程碑面板 ----
  openMilestones() {
    this.audio.play('uiOpen');
    this.openPanel(() => {
      this.ui.showMilestones(true);
      this.ui.renderMilestones(MILESTONES, this.milestones.earned);
    });
  }
  closeMilestones() {
    this.audio.play('uiClose');
    this.closePanel(() => this.ui.showMilestones(false));
  }

  // ---- 交互 ----
  onInteract() {
    if (!this.player) return;
    // 数据日志优先（靠近未读日志按 E 读取）
    if (this.logs) {
      const near = this.logs.nearestUnread(this.player.pos.x, this.player.pos.y, this.player.pos.z, this.collectedLogs);
      if (near.id && near.dist < 3.2) {
        this.openLogPanel(near.id);
        return;
      }
    }
    // 基地终端：休息/确认重生点；储物箱：打开基地仓库
    if (this.currentBase()) {
      const b = this.currentBase();
      if (Math.hypot(this.player.pos.x - (b.x + 0.5), this.player.pos.z - (b.z + 0.5)) < 3.2
        && Math.abs(this.player.pos.y - b.y) < 3.5) {
        this.restAtBase();
        return;
      }
    }
    const crate = this.findCrateNear(this.player.pos.x, this.player.pos.y, this.player.pos.z);
    if (crate) {
      this.openStorage(crate);
      return;
    }
    if (!this.ship || (this.flight && this.flight.piloting)) return;
    const sp = this.ship.worldPos;
    const pp = this.player.pos;
    const d = Math.hypot(sp.x - pp.x, sp.z - pp.z);
    if (d < 9) {
      // 已修复 → 登船
      if (this.ship.allRepaired && this.flight.canEnter()) {
        this.flight.enter();
        return;
      }
      if (this.quests.currentStep.id === 'checkShip') {
        this.quests.onInteractShip();
        this.audio.play('scan');
        this.ui.toast('已检查飞船残骸 · 结构完整但动力系统受损，需要修复');
      }
      this.openRepair();
      return;
    }
    // 异常点调查（遗迹/无人机/补给箱）——远离飞船时的探索奖励
    if (this.anomalies) {
      const { an, dist } = this.anomalies.nearest(this.player.pos.x, this.player.pos.y, this.player.pos.z);
      if (an && dist < 3.5) this.anomalies.interact(an);
    }
  }

  // ---- 创造模式 ----
  setCreative(v) {
    if (this.creative === v) return;
    this.creative = v;
    if (v) {
      // 材料管够：全物品各一整组
      for (const itemId of Object.keys(ITEMS)) {
        const it = ITEMS[itemId];
        this.inventory.addItem(itemId, it.stack || 64);
      }
      if (this.player) this.player.flyMode = true;
      this.ui.toast('已切换创造模式 · 自由飞行 · 无限资源 · 免疫伤害');
      this.audio.play('quest');
    } else {
      if (this.player) this.player.flyMode = false;
      this.ui.toast('已切换生存模式');
      this.audio.play('click');
    }
    this.ui.setModeBadge(v ? '创造模式' : '生存模式');
    this.ui.refreshModeButton();
    this.refreshInventoryUI();
  }

  // ---- 退出 ----
  exitToMenu() {
    if (this.flight && this.flight.piloting) {
      this.ui.toast('请先降落并离船', true);
      this.audio.play('deny');
      return;
    }
    if (this.running) saveGame(this);
    this.running = false;
    this.paused = false;
    this.inMenu = false;
    this.wantLock = false;
    this.relockGrace = 0;
    this.clearRelockRetry();
    this.input.exitLock();
    this.ui.showPaused(false);
    this.ui.showSettings(false);
    this.ui.setHudVisible(false);
    this.ui.setShipCompass(null);
    if (this.player) { this.player.gun.visible = false; this.player.highlight.visible = false; }
    this.ui.showMenu(true);
    this.ui.setupMenu(hasSave());
    this.audio.setMusicMode('menu');
    this.audio.play('uiClose');
  }

  quitGame() {
    if (this.flight && this.flight.piloting) {
      this.ui.toast('请先降落并离船', true);
      this.audio.play('deny');
      return;
    }
    if (this.running) saveGame(this);
    this.running = false;
    this.paused = false;
    this.inMenu = false;
    this.wantLock = false;
    this.relockGrace = 0;
    this.clearRelockRetry();
    this.input.exitLock();
    this.ui.showPaused(false);
    this.ui.showSettings(false);
    this.ui.setHudVisible(false);
    this.ui.setShipCompass(null);
    this.ui.showMenu(false);
    this.ui.showExit(true);
    if (this.player) this.player.gun.visible = false;
    this.audio.play('uiClose');
  }

  // ---- 地热熔岩：动态火光 + 靠近灼伤 ----
  clearMagmaLights() {
    for (const l of this.magmaLights) this.scene.remove(l.light);
    this.magmaLights = [];
  }

  // 每 ~0.5s 扫描玩家周围熔岩，维护最多 8 盏动态点光
  refreshMagmaLights() {
    if (!this.player || !this.world) return;
    const p = this.player.pos;
    const found = [];
    const R = 13;
    for (let dx = -R; dx <= R; dx += 2) {
      for (let dz = -R; dz <= R; dz += 2) {
        for (let dy = -9; dy <= 5; dy += 2) {
          const x = Math.floor(p.x) + dx, y = Math.floor(p.y + EYE) + dy, z = Math.floor(p.z) + dz;
          if (this.world.getBlock(x, y, z) === B.MAGMA) {
            found.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5 });
            if (found.length >= 16) break;
          }
        }
        if (found.length >= 16) break;
      }
      if (found.length >= 16) break;
    }
    for (const l of this.magmaLights) l.active = false;
    for (const pos of found) {
      let light = this.magmaLights.find((l) => l.active === false && Math.hypot(l.x - pos.x, l.y - pos.y, l.z - pos.z) < 3);
      if (!light && this.magmaLights.length < 8) {
        const pl = new THREE.PointLight(0xff7a20, 1.15, 11, 1.6);
        this.scene.add(pl);
        light = { light: pl, x: pos.x, y: pos.y, z: pos.z, active: false };
        this.magmaLights.push(light);
      }
      if (light) {
        light.x = pos.x; light.y = pos.y; light.z = pos.z; light.active = true;
        light.light.position.set(pos.x, pos.y, pos.z);
      }
    }
    for (const l of this.magmaLights) {
      l.light.visible = l.active;
      if (l.active) l.light.intensity = 1.05 + Math.sin(this.frame * 0.08 + l.x) * 0.15;
    }
  }

  updateMagmaHazard(dt) {
    if (!this.player || this.creative) return;
    this.magmaBurnCd = Math.max(0, this.magmaBurnCd - dt);
    const p = this.player.pos;
    let near = false;
    for (let dx = -2; dx <= 2 && !near; dx++) {
      for (let dy = -1; dy <= 3 && !near; dy++) {
        for (let dz = -2; dz <= 2 && !near; dz++) {
          if (this.world.getBlock(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz) === B.MAGMA) {
            near = true;
          }
        }
      }
    }
    if (near && this.magmaBurnCd <= 0) {
      this.magmaBurnCd = 1.0;
      if (!this.magmaWarned) {
        this.magmaWarned = true;
        this.ui.toast('地热熔岩灼伤！请保持距离或穿上危险防护', true);
      }
      this.player.damage(3);
      this.audio.play('hurt');
      this.ui.hurtFlash();
    }
  }

  // ---- 小行星带开采（太空资源节点） ----
  harvestBelt() {
    if (!this.beltNear || !this.flight || !this.flight.piloting || !this.space || !this.space.active) return;
    if (this.beltHarvestCd > 0) {
      this.audio.play('deny');
      this.ui.toast(`采矿光束冷却中 · ${Math.ceil(this.beltHarvestCd)} 秒`, true);
      return;
    }
    if (this.beltCharges <= 0) {
      this.audio.play('deny');
      this.ui.toast('该小行星带矿点已采空 · 重新进入太空刷新矿点', true);
      return;
    }
    const roll = Math.random();
    let itemId = 'ferrite_dust', count = 0;
    if (roll < 0.42) { itemId = 'ferrite_dust'; count = 6 + Math.floor(Math.random() * 6); }
    else if (roll < 0.68) { itemId = 'carbon'; count = 4 + Math.floor(Math.random() * 5); }
    else if (roll < 0.88) { itemId = 'copper_ore'; count = 2 + Math.floor(Math.random() * 3); }
    else { itemId = 'gold_ore'; count = 1 + Math.floor(Math.random() * 2); }
    if (!this.inventory.canAdd(itemId, count)) {
      this.audio.play('deny');
      this.ui.toast('背包已满，无法接收矿石', true);
      return;
    }
    this.beltCharges--;
    this.beltHarvestCd = 3.5;
    this.inventory.addItem(itemId, count);
    const item = ITEMS[itemId];
    this.audio.play('dig');
    this.audio.play('popup');
    this.particles.spawnBurst(this.flight.pos.x, this.flight.pos.y, this.flight.pos.z, 0xb8a88a, {
      count: 22, speed: 5, up: 1.4, spread: 2.2, life: 1.1, size: 0.16, gravity: 0, jitter: 2.2,
    });
    this.ui.popup(item ? item.name : itemId, count, itemId);
    this.ui.renderHotbar(this.inventory.hotbar(), this.inventory.selected);
    this.ui.toast(`小行星开采：${item ? item.name : itemId} ×${count} · 剩余矿点 ${this.beltCharges}`);
    if (this.milestones) this.milestones.bump('beltHarvest', 1);
  }

  // ---- 空间站任务板 ----
  currentMissionOffers() { return missionOffers(this.missionSeed); }

  acceptMission(templateId) {
    if (this.creative) { this.audio.play('deny'); this.ui.toast('创造模式下任务板不可用', true); return; }
    if (this.mission) { this.audio.play('deny'); this.ui.toast('已有进行中的悬赏 · 先完成或放弃', true); return; }
    if (this.missionCd > 0) { this.audio.play('deny'); this.ui.toast(`任务板冷却中 · ${Math.ceil(this.missionCd)} 秒`, true); return; }
    const t = MISSION_TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    this.mission = createMission(t);
    this.missionSeed = (this.missionSeed + 1) % 97;
    this.audio.play('quest');
    this.ui.toast(`已接受：${t.label} · ${t.desc}`);
    this.renderStationUI(this.ui.stationTab || 'missions');
  }

  abandonMission() {
    if (!this.mission) return;
    this.mission = null;
    this.missionCd = MISSION_COOLDOWN;
    this.audio.play('deny');
    this.ui.toast('已放弃悬赏 · 任务板进入冷却');
    this.renderStationUI(this.ui.stationTab || 'missions');
  }

  deliverMission() {
    const m = this.mission;
    if (!m || m.kind !== 'deliver') return;
    if (this.creative) { this.audio.play('deny'); this.ui.toast('创造模式下任务板不可用', true); return; }
    if (this.inventory.countOf(m.item) < m.need) {
      this.audio.play('deny');
      this.ui.toast(`材料不足 · 需要 ${m.need} 个`, true);
      return;
    }
    if (!this.inventory.canAdd('credits', m.reward)) {
      this.audio.play('deny');
      this.ui.toast('背包已满，无法接收赏金', true);
      return;
    }
    this.inventory.removeItem(m.item, m.need);
    this.completeMission();
  }

  completeMission() {
    const m = this.mission;
    if (!m) return;
    this.mission = null;
    this.missionCd = MISSION_COOLDOWN;
    this.inventory.addItem('credits', m.reward);
    if (this.milestones) this.milestones.bump('creditsEarned', m.reward);
    this.audio.play('quest');
    this.ui.toast(`悬赏完成：${m.label} · 赏金 +${m.reward} 信用点`);
    this.ui.renderHotbar(this.inventory.hotbar(), this.inventory.selected);
  }

  // 悬赏进度事件：任务板接单后，游戏内的探索/击杀/挖掘自动推进
  onMissionEvent(event, payload = {}) {
    if (this.creative) return; // 创造模式无生存挑战，任务板进度保持冻结
    if (!this.mission) return;
    const changed = missionEvent(this.mission, event, payload);
    if (!changed) return;
    if (missionReady(this.mission)) {
      if (this.mission.kind === 'deliver') {
        this.ui.toast(`悬赏材料齐了 · 回空间站任务板交付：${this.mission.label}`, false);
      } else {
        this.completeMission();
      }
    } else {
      this.ui.toast(`悬赏进度：${this.mission.label} · ${missionProgressText(this.mission)}`, false);
    }
  }

  // ---- 空间站 ----
  dockStation() {
    if (!this.stationNear || this.docked || !this.space || !this.space.active) return;
    this.docked = true;
    this.flight.speed = 0;
    this.flight.vertVel = 0;
    this.audio.play('uiOpen');
    this.openPanel(() => {
      this.ui.showStation(true);
      this.renderStationUI('trade');
    });
    this.quests.onStationDock();
    if (this.milestones) this.milestones.bump('dock', 1);
  }

  undockStation() {
    if (!this.docked) return;
    this.docked = false;
    this.ui.setInteractHint(null);
    this.audio.play('uiClose');
    this.closePanel(() => this.ui.showStation(false));
  }

  renderStationUI(tab) {
    this.ui.renderStation({
      tab,
      creative: this.creative,
      credits: this.inventory.countOf('credits'),
      inventory: this.inventory,
      sellTable: STATION_SELL,
      buyTable: STATION_BUY,
      orders: STATION_ORDERS.map((o) => ({ ...o, cd: this.stationOrderCd[o.id] || 0 })),
      mission: this.mission,
      missionCd: this.missionCd,
      missionOffers: this.currentMissionOffers(),
      missionProgressText: this.mission ? missionProgressText(this.mission) : '',
      upgrades: SHIP_UPGRADES,
      owned: this.shipUpgrades,
      // 状态感知对话：台词随游戏进度追加（买大船/到过比邻星/引擎升满）
      npcs: STATION_NPCS.map((n) => ({
        ...n,
        lines: getNpcLines(n, {
          bigship: !!(this.shipUpgrades && this.shipUpgrades.bigship),
          reachedProxima: !!(this.space && this.space.visitedProxima && this.space.visitedProxima.size > 0),
          engine: this.shipUpgrades ? this.shipUpgrades.engine : 0,
        }),
      })),
    });
  }

  handleStationAction(action, id, count) {
    const inv = this.inventory;
    if (action === 'sell1' || action === 'sellAll') {
      const n = action === 'sellAll' ? inv.countOf(id) : count;
      const got = stationSell(inv, id, n);
      if (got > 0) {
        this.audio.play('craft');
        if (this.milestones) this.milestones.bump('creditsEarned', got);
        this.ui.toast(`出售完成 · +${got} 信用点`);
      } else {
        this.audio.play('deny');
        if (inv.countOf('credits') >= 999 && !inv.canAdd('credits', 1)) this.ui.toast('背包已满，无法接收信用点', true);
      }
    } else if (action === 'buy1') {
      const item = ITEMS[id];
      if (stationBuy(inv, id, count)) {
        this.audio.play('craft');
        this.ui.toast(`购买完成 · ${item ? item.name : id}`);
        if (id === 'mining_beam_mk2' && this.milestones) this.milestones.bump('toolTier2', 1);
        if (id === 'energy_coil' && this.milestones) this.milestones.bump('weaponMod', 1);
      } else {
        this.audio.play('deny');
        this.ui.toast(inv.countOf('credits') < buyPriceOf(id) * count ? '信用点不足' : '背包已满，无法购买', true);
      }
    } else if (action === 'order') {
      const order = STATION_ORDERS.find((o) => o.id === id);
      const cd = this.stationOrderCd[order.id] || 0;
      if (cd > 0) {
        this.audio.play('deny');
        this.ui.toast(`订单冷却中 · ${Math.ceil(cd)} 秒后可再次提交`, true);
      } else if (stationDeliver(inv, order)) {
        this.stationOrderCd[order.id] = ORDER_COOLDOWN;
        this.audio.play('quest');
        if (this.milestones) this.milestones.bump('creditsEarned', order.reward);
        this.ui.toast(`订单完成：${order.label} · +${order.reward} 信用点 · ${ORDER_COOLDOWN} 秒后可再交`);
      } else {
        this.audio.play('deny');
        this.ui.toast(inv.countOf(order.item) < order.need ? '材料不足，无法交付' : '背包已满，无法接收奖励', true);
      }
    } else if (action === 'mission_accept') {
      this.acceptMission(id);
    } else if (action === 'mission_abandon') {
      this.abandonMission();
    } else if (action === 'mission_deliver') {
      this.deliverMission();
    } else if (action === 'upgrade') {
      const r = stationUpgrade(inv, this.shipUpgrades, id);
      if (r.ok) {
        this.applyShipUpgrades();
        this.audio.play('repair');
        this.ui.shake();
        const def = SHIP_UPGRADES.find((u) => u.id === id);
        this.ui.toast(def && def.bigship ? '大型殖民船 曙光号 已交付' : '飞船升级完成');
        this.quests.onBigShip();
      } else {
        this.audio.play('deny');
        this.ui.toast(r.reason === 'poor' ? '信用点不足' : (r.reason === 'need' ? '需先完成引擎 Lv2 与护盾 Lv1' : '该升级已拥有'), true);
      }
    }
    this.renderStationUI(this.ui.stationTab || 'trade');
  }

  applyShipUpgrades() {
    if (this.player) {
      this.player.shieldMax = 100 + 50 * (this.shipUpgrades.shield || 0);
      this.player.shield = Math.min(this.player.shield, this.player.shieldMax);
    }
    if (this.flight && this.flight.refreshShipVitals) this.flight.refreshShipVitals();
    // 大船：船体放大
    if (this.ship && this.ship.group) {
      this.ship.group.scale.setScalar(this.shipUpgrades.bigship ? 1.3 : 1);
    }
  }

  // ---- 面板管理（单一活跃面板状态机） ----
  // inMenu 从真实 DOM 可见性推导：任何全屏面板打开时抑制暂停与游戏循环，
  // 杜绝多个面板各自手写布尔导致的"关一个面板误恢复 active / 误弹暂停"。
  refreshInMenu() {
    this.inMenu = this.ui.backpackVisible() || this.ui.repairVisible()
      || this.ui.stationVisible() || this.ui.storageVisible() || this.ui.logVisible()
      || this.ui.starMapVisible() || this.ui.settingsVisible()
      || this.ui.journeyVisible() || this.ui.milestonesVisible();
    // 面板打开时把 toast 挪到屏幕最底部：默认位置(bottom:92px)正好落在
    // 居中面板的合成列表/按钮区上，会把"扫描完成"等提示叠在界面内容上。
    document.body.classList.toggle('panel-open', this.inMenu);
  }
  // 打开：先退锁（面板必须处于未锁指针状态，Esc 才能可靠送达）、
  // 作废打开瞬间的残留边沿按键，再显示面板，最后推导 inMenu（立即反映新面板）。
  openPanel(showFn) {
    this.input.exitLock();
    this.input.clearTransients();
    showFn();
    this.refreshInMenu();
  }
  // 关闭：隐藏面板 → 重新推导 inMenu → 作废面板打开期间积累的陈旧按键
  // （历史 bug：面板打开期间按的 E 存活 2 帧，关闭并重锁后被游戏循环读到 → 面板重开）
  // → 仅当游戏运行且未暂停且无其他面板时重锁指针。
  closePanel(hideFn) {
    hideFn();
    this.refreshInMenu();
    this.input.clearTransients();
    if (this.running && !this.paused && !this.inMenu) this.requestGameLock();
  }

  openBackpack() {
    this.audio.play('uiOpen');
    this.openPanel(() => {
      this.ui.showBackpack(true);
      this.refreshInventoryUI();
    });
  }
  closeBackpack() {
    this.audio.play('uiClose');
    this.closePanel(() => this.ui.showBackpack(false));
  }
  toggleBackpack() {
    if (this.ui.backpackVisible()) this.closeBackpack();
    else this.openBackpack();
  }

  openRepair() {
    this.audio.play('uiOpen');
    this.openPanel(() => {
      this.ui.showRepair(true);
      this.updateRepairUI();
    });
  }
  closeRepair() {
    this.audio.play('uiClose');
    this.closePanel(() => this.ui.showRepair(false));
  }

  // ---- 设置面板（主菜单 / 暂停菜单均可打开，覆盖在底层界面之上） ----
  openSettings() {
    this.audio.play('uiOpen');
    this.openPanel(() => {
      this.ui.showSettings(true);
      this.ui.setCreativeLocked(this.running);
    });
  }
  closeSettings() {
    this.audio.play('uiClose');
    // 从暂停菜单打开时 paused 仍为 true → closePanel 不重锁，返回暂停界面；
    // 从主菜单打开时 running=false → 不重锁，返回主菜单。
    this.closePanel(() => this.ui.showSettings(false));
  }

  // ---- 数据日志面板 ----
  openLogPanel(id) {
    const isNew = !this.collectedLogs.has(id);
    this.collectedLogs.add(id);
    if (this.logs) this.logs.setCollected(this.collectedLogs);
    if (isNew && this.milestones) this.milestones.bump('logs', 1);
    this.audio.play('uiOpen');
    this.openPanel(() => {
      this.ui.showLog(true);
      this.ui.renderLog(id, CRASH_LOGS, this.collectedLogs);
    });
  }
  closeLogPanel() {
    this.audio.play('uiClose');
    this.closePanel(() => this.ui.showLog(false));
    // 新玩家开场：坠机点旁按 E 会先读到数据日志（日志优先于修船提示）——
    // 关闭日志后若还没检查飞船，给一句指引，避免"任务说检查飞船、面板却是日志"的困惑。
    if (this.quests && this.quests.currentStep && this.quests.currentStep.id === 'checkShip') {
      this.ui.toast('数据已记录 · 继续任务：靠近飞船机身按 E 检查');
    }
  }

  // ---- 星图（恒星级 → 恒星系统 → 行星系统） ----
  openStarMap() {
    this.audio.play('uiOpen');
    // 默认打开当前星系系统图；恒星级可通过“上级星图”进入
    this.starMapState = {
      level: 'system',
      viewSystemId: this.space.galaxyId,
      focusId: null,
      selectedId: homeBodyId(this.space.galaxyId),
    };
    this.openPanel(() => {
      this.ui.showStarMap(true);
      this.renderStarMapPanel();
    });
  }
  closeStarMap() {
    this.audio.play('uiClose');
    this.closePanel(() => this.ui.showStarMap(false));
  }

  // ---- 地表导航层（星图第四级：步行航点） ----
  currentBodyNavId() {
    if (this.space.bodyId) return this.space.bodyId;
    const p = this.space.galaxy[this.space.current];
    return p ? p.navId : null;
  }

  surfaceWaypoints({ includeHidden = false } = {}) {
    const out = [];
    const px = this.player ? this.player.pos.x : 0;
    const pz = this.player ? this.player.pos.z : 0;
    if (this.ship && this.ship.worldPos && !(this.flight && this.flight.piloting)) {
      out.push({
        id: 'surface:ship', name: this.ship.allRepaired ? '飞船' : '飞船残骸',
        kind: 'ship', x: this.ship.worldPos.x, z: this.ship.worldPos.z,
        meta: this.ship.allRepaired ? '已修复 · 可登船' : '受损 · 待修复', collected: false,
      });
    }
    if (this.logs) {
      for (const it of this.logs.items) {
        out.push({
          id: `surface:log:${it.id}`, name: (logById(it.id) || {}).title || '数据日志',
          kind: 'log', x: it.group.position.x, z: it.group.position.z,
          meta: this.collectedLogs.has(it.id) ? '已读取 · 可重读' : '未读取', collected: false,
        });
      }
    }
    if (this.anomalies) {
      for (const an of this.anomalies.list) {
        const id = `surface:anomaly:${an.id}`;
        const d = Math.hypot(an.pos.x - px, an.pos.z - pz);
        // 探索迷雾：异常点只有靠近/扫描/已调查后才会出现在地表图上
        const visible = includeHidden || an.collected || this.discoveredSurface.has(id) || d <= 90;
        if (!visible) continue;
        out.push({
          id, name: an.name, kind: an.type,
          x: an.pos.x, z: an.pos.z,
          meta: an.collected ? '已调查' : (an.desc || '未调查'), collected: !!an.collected,
        });
      }
    }
    return out;
  }

  // 探索迷雾：把半径内的异常点标记为已发现；返回新发现数量
  discoverSurfaceAround(radius = 90, silent = false) {
    if (!this.anomalies || !this.player) return 0;
    let found = 0;
    for (const an of this.anomalies.list) {
      const id = `surface:anomaly:${an.id}`;
      if (this.discoveredSurface.has(id)) continue;
      const d = Math.hypot(an.pos.x - this.player.pos.x, an.pos.z - this.player.pos.z);
      if (d <= radius) {
        this.discoveredSurface.add(id);
        found++;
      }
    }
    if (found > 0 && !silent) {
      this.audio.play('popup');
      this.ui.toast(`地表航点已发现 ×${found} · 按 M 查看地表导航图`, false);
    }
    return found;
  }

  surfaceWaypointById(id) {
    return this.surfaceWaypoints().find((w) => w.id === id) || null;
  }

  openSurfaceMap() {
    if (this.flight && this.flight.piloting) return;
    this.audio.play('uiOpen');
    const bodyNavId = this.currentBodyNavId();
    this.starMapState = {
      level: 'surface',
      viewSystemId: this.space.galaxyId,
      focusId: bodyNavId,
      selectedId: 'surface:ship',
    };
    this.openPanel(() => {
      this.ui.showStarMap(true);
      this.renderStarMapPanel();
    });
  }

  setSurfaceTarget(id) {
    const wp = this.surfaceWaypointById(id);
    if (!wp) {
      this.audio.play('deny');
      this.ui.toast('未知地表航点', true);
      return;
    }
    if (wp.collected) {
      this.audio.play('deny');
      this.ui.toast('该航点已完成调查', true);
      return;
    }
    this.surfaceTarget = { id: wp.id, name: wp.name, x: wp.x, z: wp.z };
    this.audio.play('select');
    const d = this.player ? Math.hypot(wp.x - this.player.pos.x, wp.z - this.player.pos.z) : 0;
    this.ui.toast(`地表导航：${wp.name} · ${Math.round(d)} m · 跟随青色菱形罗盘`);
    this.closeStarMap();
  }

  clearSurfaceTarget() {
    this.surfaceTarget = null;
    this.ui.setSurfaceCompass(null, null);
  }

  // ---- 基地与储物：按世界隔离的持久实体 ----
  worldKey() {
    const galaxyId = this.space ? (this.space.galaxyId || 'solar') : 'solar';
    const planetId = this.space ? (this.space.current || 0) : 0;
    const bodyId = this.space ? (this.space.bodyId || '') : '';
    return `${this.seed}|${galaxyId}|${planetId}|${bodyId}`;
  }

  currentBase() {
    return this.baseWorlds[this.worldKey()] || null;
  }

  currentCrates() {
    const key = this.worldKey();
    if (!this.crateWorlds[key]) this.crateWorlds[key] = [];
    return this.crateWorlds[key];
  }

  // 切换世界/读档后恢复当前世界的基地信标与储物箱数据
  syncBaseForCurrentWorld() {
    if (this.baseBeacon) this.baseBeacon.visible = false;
    const base = this.currentBase();
    if (base && this.world) {
      // 存档只保存实体坐标；读档/换世界后把基地与储物箱方块重新放回世界
      this.world.setBlock(base.x, base.y, base.z, B.BASE_UNIT);
      if (this.baseBeacon) {
        this.baseBeacon.position.set(base.x + 0.5, base.y + 1.2, base.z + 0.5);
        this.baseBeacon.visible = true;
      }
    }
    for (const crate of this.currentCrates()) {
      if (this.world) this.world.setBlock(crate.x, crate.y, crate.z, B.STORAGE);
    }
    this.activeCrate = null;
  }

  registerBaseAt(x, y, z) {
    const key = this.worldKey();
    const old = this.baseWorlds[key];
    this.baseWorlds[key] = { x, y, z };
    if (old && this.baseBeacon) this.baseBeacon.visible = false;
    if (this.baseBeacon) {
      this.baseBeacon.position.set(x + 0.5, y + 1.2, z + 0.5);
      this.baseBeacon.visible = true;
    }
    if (this.milestones) this.milestones.bump('base', 1);
    this.ui.toast(old ? '基地终端已迁移 · 新位置已记录为重生点' : '基地已建立 · 死亡后在此重生 · 附近怪物不会刷新');
    this.audio.play('quest');
  }

  removeBaseAt(x, y, z) {
    const key = this.worldKey();
    const base = this.baseWorlds[key];
    if (!base || base.x !== x || base.y !== y || base.z !== z) return;
    delete this.baseWorlds[key];
    if (this.baseBeacon) this.baseBeacon.visible = false;
    this.ui.toast('基地终端已拆除 · 重生点回到坠机点', true);
    this.audio.play('break', { surface: 'metal' });
  }

  // 基地终端交互：白天确认重生点，夜晚休息到清晨（危险/生命/护盾回满）。
  // 夜间休息有 BASE_REST_COOLDOWN 冷却，避免按 E 无限跳过夜晚与夜怪压力。
  restAtBase() {
    const base = this.currentBase();
    if (!base) return false;
    const p = this.player.pos;
    if (Math.hypot(p.x - (base.x + 0.5), p.z - (base.z + 0.5)) > 3.2
      || Math.abs(p.y - base.y) > 3.5) return false;
    const sky = this.sky;
    const wasNight = sky && sky.nightFactor > 0.5;
    if (wasNight) {
      if (this.baseRestCd > 0) {
        this.audio.play('deny');
        this.ui.toast(`基地终端充能中 · ${Math.ceil(this.baseRestCd)} 秒后可再次休息`, true);
        return true;
      }
      sky.timeSec = sky.dayLength * 0.25; // 06:00
      sky.update(0, p);
      this.player.health = 100;
      this.player.shield = this.player.shieldMax;
      this.player.life = 100;
      this.player.hazard = 100;
      this.baseRestCd = BASE_REST_COOLDOWN;
      this.ui.toast('你在基地休息到清晨 · 状态已完全恢复');
      this.audio.play('quest');
    } else {
      this.ui.toast('基地终端 · 你的重生点已记录在这里');
      this.audio.play('select');
    }
    return true;
  }

  registerCrateAt(x, y, z) {
    const crates = this.currentCrates();
    if (crates.some((c) => c.x === x && c.y === y && c.z === z)) return;
    crates.push(createCrate(`crate:${x}:${y}:${z}`, x, y, z));
    this.ui.toast('储物箱已部署 · 靠近按 E 打开');
    this.audio.play('place');
  }

  removeCrateAt(x, y, z) {
    const crates = this.currentCrates();
    const idx = crates.findIndex((c) => c.x === x && c.y === y && c.z === z);
    if (idx < 0) return;
    if (this.activeCrate && this.activeCrate.x === x && this.activeCrate.y === y && this.activeCrate.z === z) {
      this.closeStorage();
    }
    crates.splice(idx, 1);
    this.ui.toast('储物箱已拆除', true);
    this.audio.play('break', { surface: 'wood' });
  }

  findCrateNear(px, py, pz, radius = 3.2) {
    for (const c of this.currentCrates()) {
      const dx = px - (c.x + 0.5), dy = py - (c.y + 0.5), dz = pz - (c.z + 0.5);
      if (Math.hypot(dx, dz) < radius && Math.abs(dy) < 3) return c;
    }
    return null;
  }

  openStorage(crate) {
    if (!crate) return;
    this.activeCrate = crate;
    this.audio.play('uiOpen');
    this.openPanel(() => {
      this.ui.showStorage(true);
      this.ui.renderStorage(crate, this.inventory);
    });
  }

  closeStorage() {
    if (!this.ui.storageVisible()) { this.activeCrate = null; return; }
    this.audio.play('uiClose');
    this.closePanel(() => this.ui.showStorage(false));
    this.activeCrate = null;
  }

  handleStorageAction(action, index) {
    const crate = this.activeCrate;
    const inv = this.inventory;
    if (!crate) return;
    if (action === 'take') {
      const s = crate.slots[index];
      if (!s) return;
      const count = s.count;
      if (!inv.canAdd(s.itemId, count)) {
        this.audio.play('deny');
        this.ui.toast('背包空间不足，无法取出', true);
        return;
      }
      crateTake(crate, index, count);
      inv.addItem(s.itemId, count);
      this.audio.play('select');
    } else if (action === 'takeAll') {
      let moved = 0;
      for (let i = crate.slots.length - 1; i >= 0; i--) {
        const s = crate.slots[i];
        if (!s) continue;
        const count = s.count;
        if (!inv.canAdd(s.itemId, count)) continue;
        crateTake(crate, i, count);
        inv.addItem(s.itemId, count);
        moved += count;
      }
      if (moved === 0) {
        this.audio.play('deny');
        this.ui.toast(crate.slots.every((s) => !s) ? '储物箱是空的' : '背包空间不足', true);
        return;
      }
      this.audio.play('select');
      this.ui.toast(`取出物品 ×${moved}`);
    } else if (action === 'storeAll') {
      let moved = 0;
      for (let i = 9; i < inv.slots.length; i++) {
        const s = inv.slots[i];
        if (!s) continue;
        const added = crateAdd(crate, s.itemId, s.count);
        if (added <= 0) continue;
        // 直接从来源格扣减，避免 removeItem 误删快捷栏里的同名物品
        s.count -= added;
        if (s.count <= 0) inv.slots[i] = null;
        moved += added;
      }
      if (moved === 0) {
        this.audio.play('deny');
        this.ui.toast('没有可存入的物品（只存入背包区，不动快捷栏）', true);
        return;
      }
      this.audio.play('place');
      this.ui.toast(`存入物品 ×${moved}`);
    }
    this.ui.renderStorage(crate, inv);
    this.ui.renderHotbar(inv.hotbar(), inv.selected);
  }

  renderStarMapPanel() {
    this.ui.renderStarMapView(this.buildStarMapView());
    // 旧版列表视图：作为键盘流/兼容层，内容必须跟随当前星图层级
    const st = this.starMapState;
    const hasBigShip = !!(this.shipUpgrades && this.shipUpgrades.bigship);
    const viewSystem = st.viewSystemId || this.space.galaxyId;
    const isCurrentSystem = viewSystem === this.space.galaxyId;
    const gateways = [];
    for (const node of Object.values(GATEWAY_NODES)) {
      if (node.systemId !== viewSystem) continue;
      const legacyId = node.navId === 'gateway:solar.proxima' ? 200 : (node.navId === 'gateway:proxima.solar' ? 201 : node.navId);
      gateways.push({
        id: legacyId, navId: node.navId, name: node.name, meta: node.meta, locked: !hasBigShip,
      });
    }
    const extraRows = [];
    const star = bodyById(`star:${viewSystem}`);
    if (star) {
      extraRows.push({
        id: star.navId, navId: star.navId, name: star.name, color: star.color,
        meta: `${star.starClass || '恒星'} · 不可降落 · 可导航`, locked: false,
      });
    }
    if (viewSystem === 'solar') {
      const belt = bodyById('belt:solar.main');
      if (belt) extraRows.push({
        id: belt.navId, navId: belt.navId, name: belt.name, color: belt.color,
        meta: '2.2–3.2 AU · 资源富集区 · 不可降落', locked: false,
      });
    }

    if (st.level === 'system') {
      const viewGalaxy = this.space.galaxies[viewSystem] || this.space.galaxy;
      const visited = this.space.visitedFor(viewSystem) || new Set();
      const currentId = isCurrentSystem ? this.space.current : 0;
      this.ui.renderStarMap(viewGalaxy, currentId, this.space.targetId, visited, {
        hasStation: viewSystem === 'solar' && currentId === 0,
        gateways,
        extraRows,
      });
    } else if (st.level === 'stellar') {
      this.ui.renderStarMap([], -1, this.space.targetId, new Set(), {
        hasStation: false, gateways: [],
        extraRows: STAR_SYSTEMS.map((meta) => {
          const s = bodyById(meta.starNavId);
          return {
            id: s.navId, navId: s.navId, name: meta.name, color: s.color,
            meta: `${meta.starName} · ${meta.starClass} · ${meta.planetCount} 颗行星${meta.distanceLy > 0 ? ` · ${meta.distanceLy} 光年` : ''}`, locked: false,
          };
        }),
      });
    } else if (st.level === 'planet') {
      const parent = bodyById(st.focusId);
      const kids = childrenOf(viewSystem, st.focusId);
      const rows = kids.map((k, i) => ({
        id: k.navId, navId: k.navId, name: k.name, color: k.color,
        meta: k.kind === 'station' ? '人造设施 · 交易 / 任务 / 船坞'
          : `天然卫星 · ${Number(k.aAU * 149597870.7).toLocaleString('en-US')} km · ${k.type || ''}`,
        locked: false,
      }));
      if (parent) rows.unshift({
        id: parent.navId, navId: parent.navId, name: parent.name, color: parent.color,
        meta: `${parent.type || ''} · 母行星`, locked: false,
      });
      this.ui.renderStarMap([], -1, this.space.targetId, new Set(), {
        hasStation: false, gateways: [], extraRows: rows,
      });
    } else if (st.level === 'surface') {
      const rows = this.surfaceWaypoints().map((w) => ({
        id: w.id, navId: w.id, name: w.name,
        color: w.kind === 'ship' ? 0xffb84d : w.kind === 'log' ? 0x7ff0ff : 0xff6ad5,
        meta: `${w.meta} · ${Math.round(Math.hypot(w.x - (this.player ? this.player.pos.x : 0), w.z - (this.player ? this.player.pos.z : 0)))} m`,
        locked: !!w.collected,
      }));
      this.ui.renderStarMap([], -1, this.surfaceTarget ? this.surfaceTarget.id : -1, new Set(), {
        hasStation: false, gateways: [], extraRows: rows,
      });
    }
  }

  // 目标是否与给定节点 id 一致（兼容数字 id 与字符串 navId）
  isNavTarget(id) {
    if (this.space.targetId === -1) return false;
    if (String(this.space.targetId) === String(id)) return true;
    const node = this.space.resolveTargetNode(this.space.targetId);
    return !!(node && node.navId === id);
  }

  // V2：返回真实米制距离（读取 Universe 状态，而不是独立重算）。
  mapDistanceUnits(node) {
    if (!node) return null;
    const body = this.space.universe.body(node.navId);
    if (!body) return null;
    const here = this.space.currentPositionM();
    return Math.hypot(body.posM.x - here.x, body.posM.y - here.y, body.posM.z - here.z);
  }

  buildStarMapView() {
    const st = this.starMapState;
    const W = 720, H = 430;
    const nodes = [];
    const orbits = [];
    const links = [];
    let info = null;
    let levelLabel = '';
    let listTitle = '';
    const currentPlanet = this.space.galaxy[this.space.current];
    const currentNavId = currentPlanet ? currentPlanet.navId : null;

    const selectedNode = st.selectedId ? bodyById(st.selectedId) : null;
    const nodeFlags = (id, node) => ({
      selected: st.selectedId === id,
      current: node.kind === 'planet' && node.navId === currentNavId,
      target: this.isNavTarget(id),
      hasChildren: childrenOf(st.viewSystemId, id).length > 0,
      locked: node.gateway && !(this.shipUpgrades && this.shipUpgrades.bigship),
      landable: !!node.landable,
      dockable: !!node.dockable,
    });

    if (st.level === 'stellar') {
      levelLabel = '恒星级星图 // 本星域恒星';
      listTitle = '恒星节点';
      const positions = [
        { x: 200, y: H / 2, r: 24 },
        { x: 500, y: H / 2 - 45, r: 13 },
        { x: 520, y: H / 2 + 52, r: 15 },
      ];
      STAR_SYSTEMS.forEach((meta, i) => {
        const star = bodyById(meta.starNavId);
        const pos = positions[i] || { x: 360, y: H / 2, r: 14 };
        nodes.push({
          id: star.navId, kind: 'star', name: star.name, color: star.color,
          x: pos.x, y: pos.y, r: pos.r, label: meta.name, ...nodeFlags(star.navId, star),
        });
      });
      const solar = positions[0], prox = positions[1], sir = positions[2];
      links.push({ x1: solar.x + solar.r, y1: solar.y, x2: prox.x - prox.r, y2: prox.y, color: 'rgba(127,240,255,0.3)', dash: [4, 6] });
      links.push({ x1: solar.x + solar.r, y1: solar.y, x2: sir.x - sir.r, y2: sir.y, color: 'rgba(127,240,255,0.3)', dash: [4, 6] });
      if (selectedNode) {
        const meta = systemMeta(selectedNode.systemId);
        info = {
          title: `${selectedNode.name} · ${meta.name}`,
          lines: bodyFacts(selectedNode).map((t) => ({ text: t })),
          actions: [{ action: 'enter', id: selectedNode.navId, label: '进入星系地图' }],
        };
        if (meta.distanceLy > 0) {
          info.lines.unshift({ text: `距太阳系：${meta.distanceLy} 光年`, note: true });
        }
      }
    } else if (st.level === 'system') {
      const sys = systemMeta(st.viewSystemId);
      levelLabel = `${sys.name} // 行星轨道图`;
      listTitle = `${sys.name}目标列表`;
      const cx = 260, cy = H / 2, outer = 190;
      const { min, max } = systemOrbitRange(st.viewSystemId);
      const ringNodes = systemLevelNodes(st.viewSystemId);
      const homeNav = homeBodyId(st.viewSystemId);
      for (const node of ringNodes) {
        let x, y, r;
        if (node.kind === 'star') {
          x = cx; y = cy; r = 22;
        } else if (node.kind === 'station') {
          const parent = bodyById(node.parentId);
          const pr = logProject(parent ? parent.aAU : 1, min, max, 34, outer);
          const ang = ((parent ? parent.angleDeg : 0) + 24) * Math.PI / 180;
          x = cx + Math.cos(ang) * (pr + 20); y = cy + Math.sin(ang) * (pr + 20); r = 7;
        } else if (node.kind === 'gateway') {
          x = cx + Math.cos(-0.8) * (outer + 22); y = cy + Math.sin(-0.8) * (outer + 22); r = 7;
        } else {
          const pr = logProject(node.aAU, min, max, 34, outer);
          const ang = (node.angleDeg || 0) * Math.PI / 180;
          x = cx + Math.cos(ang) * pr; y = cy + Math.sin(ang) * pr;
          r = node.kind === 'belt' ? 9 : 8;
        }
        nodes.push({
          id: node.navId, kind: node.kind, name: node.name, color: node.color,
          x, y, r, label: node.name, ...nodeFlags(node.navId, node),
        });
        if (node.kind === 'planet' || node.kind === 'belt') {
          orbits.push({
            r: logProject(node.aAU, min, max, 34, outer), cx, cy,
            color: node.kind === 'belt' ? 'rgba(180,160,140,0.30)' : 'rgba(127,240,255,0.13)',
            dashed: node.kind === 'belt',
            label: `${Number(node.aAU).toFixed(node.aAU < 1 ? 3 : 2)} AU`,
          });
        }
      }
      // V2：把玩家真实宇宙位置投影到系统图上（星图不再是脱离玩家的示意图）。
      if (st.viewSystemId === this.space.galaxyId) {
        const star = this.space.universe.starOf(st.viewSystemId);
        const here = this.space.currentPositionM();
        if (star && here) {
          const dx = here.x - star.posM.x, dz = here.z - star.posM.z;
          const distAU = Math.hypot(dx, dz) / (149597870700);
          const pr = logProject(distAU, min, max, 34, outer);
          const ang = Math.atan2(dz, dx);
          nodes.push({
            id: 'v2:player', kind: 'player', name: '你', color: 0xeaffff,
            x: cx + Math.cos(ang) * pr, y: cy + Math.sin(ang) * pr, r: 5, label: '你',
            selected: st.selectedId === 'v2:player', current: true, target: false,
          });
        }
      }
      if (selectedNode) {
        const dist = this.mapDistanceUnits(selectedNode);
        const lines = bodyFacts(selectedNode, { distance: dist ? dist / KM_PER_UNIT : null }).map((t) => ({ text: t }));
        const actions = [];
        const isCurrent = selectedNode.kind === 'planet' && selectedNode.navId === currentNavId;
        if (!isCurrent) {
          actions.push({
            action: 'target', id: selectedNode.navId,
            label: this.isNavTarget(selectedNode.navId) ? '已设为目标' : '设定目标',
            disabled: this.isNavTarget(selectedNode.navId) || selectedNode.gateway && !(this.shipUpgrades && this.shipUpgrades.bigship),
          });
        }
        if (childrenOf(st.viewSystemId, selectedNode.navId).length > 0) {
          actions.push({ action: 'enter', id: selectedNode.navId, label: '进入行星系统' });
        }
        info = { title: selectedNode.name, lines, actions };
      }
    } else if (st.level === 'planet') {
      const focus = bodyById(st.focusId);
      levelLabel = `${focus ? focus.name : ''}系统 // 卫星与轨道设施`;
      listTitle = `${focus ? focus.name : ''}系统目标`;
      const cx = 260, cy = H / 2;
      nodes.push({
        id: focus.navId, kind: focus.kind, name: focus.name, color: focus.color,
        x: cx, y: cy, r: 24, label: focus.name,
        selected: st.selectedId === focus.navId, current: focus.navId === currentNavId,
        target: this.isNavTarget(focus.navId), hasChildren: false, locked: false, landable: !!focus.landable, dockable: false,
      });
      const kids = childrenOf(st.viewSystemId, focus.navId);
      // V2：方向/轨道比例读取 Universe 真实位置（径向仍做可读性压缩）。
      const parentBody = this.space.universe.body(focus.navId);
      const kidBodies = kids.map((kid) => ({ kid, body: this.space.universe.body(kid.navId) })).filter((k) => k.body && parentBody);
      const maxOrbit = Math.max(1, ...kidBodies.map((k) => Math.hypot(k.body.posM.x - parentBody.posM.x, k.body.posM.z - parentBody.posM.z)));
      kidBodies.forEach(({ kid, body }) => {
        const dx = body.posM.x - parentBody.posM.x;
        const dz = body.posM.z - parentBody.posM.z;
        const orbitM = Math.hypot(dx, dz);
        const ang = Math.atan2(dz, dx);
        const rr = 40 + Math.pow(orbitM / maxOrbit, 0.5) * 120;
        nodes.push({
          id: kid.navId, kind: kid.kind, name: kid.name, color: kid.color,
          x: cx + Math.cos(ang) * rr, y: cy + Math.sin(ang) * rr, r: kid.kind === 'station' ? 7 : 6,
          label: kid.name, ...nodeFlags(kid.navId, kid),
        });
        orbits.push({ r: rr, cx, cy, color: 'rgba(127,240,255,0.12)', dashed: false, label: '' });
      });
      if (selectedNode) {
        const dist = this.mapDistanceUnits(selectedNode);
        const lines = bodyFacts(selectedNode, { distance: dist ? dist / KM_PER_UNIT : null }).map((t) => ({ text: t }));
        const actions = [];
        if (selectedNode.navId !== focus.navId) {
          actions.push({
            action: 'target', id: selectedNode.navId,
            label: this.isNavTarget(selectedNode.navId) ? '已设为目标' : '设定目标',
            disabled: this.isNavTarget(selectedNode.navId),
          });
        }
        // 当前天体可进入地表导航（星图第四级）
        if (focus.navId === currentNavId) {
          actions.push({ action: 'surface', id: focus.navId, label: '进入地表导航' });
        }
        info = { title: selectedNode.name, lines, actions };
      }
    } else if (st.level === 'surface') {
      const bodyNavId = st.focusId || this.currentBodyNavId();
      const bodyNode = bodyById(bodyNavId);
      const bodyName = bodyNode ? bodyNode.name : '当前天体';
      levelLabel = `${bodyName} // 地表导航`;
      const allAnomalies = this.anomalies ? this.anomalies.list.length : 0;
      const discoveredAnomalies = this.discoveredSurface.size;
      listTitle = `${bodyName}地表航点 · 已发现 ${Math.min(discoveredAnomalies, allAnomalies)}/${allAnomalies} 异常点`;
      const cx = 360, cy = H / 2, scale = 0.52; // 320 格半径 → 画布
      const px = this.player ? this.player.pos.x : 0;
      const pz = this.player ? this.player.pos.z : 0;
      nodes.push({
        id: 'surface:player', kind: 'player', name: '当前位置', color: 0xeaffff,
        x: cx, y: cy, r: 7, label: '你',
        selected: st.selectedId === 'surface:player', current: true, target: false,
      });
      for (const w of this.surfaceWaypoints()) {
        const dx = w.x - px, dz = w.z - pz;
        if (Math.hypot(dx, dz) > 340) continue;
        const color = w.kind === 'ship' ? 0xffb84d : w.kind === 'log' ? 0x7ff0ff : 0xff6ad5;
        nodes.push({
          id: w.id, kind: w.kind, name: w.name, color,
          x: cx + dx * scale, y: cy + dz * scale, r: 6, label: w.name,
          selected: st.selectedId === w.id,
          current: false,
          target: this.surfaceTarget && this.surfaceTarget.id === w.id,
        });
      }
      const selWp = this.surfaceWaypointById(st.selectedId);
      if (selWp) {
        const d = Math.hypot(selWp.x - px, selWp.z - pz);
        const lines = [
          { text: `类型：${selWp.kind === 'ship' ? '飞船' : selWp.kind === 'log' ? '数据日志' : '异常点'}` },
          { text: `状态：${selWp.meta}`, note: selWp.collected },
          { text: `距离：${Math.round(d)} m` },
        ];
        const actions = [];
        if (!selWp.collected) {
          const isTarget = this.surfaceTarget && this.surfaceTarget.id === selWp.id;
          actions.push({
            action: 'target', id: selWp.id,
            label: isTarget ? '已设为目标' : '设为地面目标',
            disabled: isTarget,
          });
        }
        if (this.surfaceTarget) {
          actions.push({ action: 'cleartarget', id: '', label: '清除地面目标' });
        }
        info = { title: selWp.name, lines, actions };
      } else if (st.selectedId === 'surface:player') {
        info = {
          title: '当前位置',
          lines: [
            { text: `天体：${bodyName}` },
            { text: `坐标：${Math.round(px)} / ${Math.round(pz)}` },
            { text: `异常点已发现：${Math.min(this.discoveredSurface.size, allAnomalies)} / ${allAnomalies} · 靠近或扫描可发现` },
          ],
          actions: this.surfaceTarget ? [{ action: 'cleartarget', id: '', label: '清除地面目标' }] : [],
        };
      }
    }

    const planetName = (st.level === 'planet' || st.level === 'surface') && st.focusId
      ? (bodyById(st.focusId) || {}).name : null;
    return {
      level: st.level,
      title: levelLabel,
      levelLabel,
      systemName: systemMeta(st.viewSystemId).name,
      planetName,
      surfaceName: st.level === 'surface' ? `${planetName || '当前天体'}地表` : null,
      listTitle,
      seed: (this.seed || 'voxel').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7),
      nodes,
      orbits,
      links,
      info,
      hint: st.level === 'stellar'
        ? '[B] 关闭 · 点击恒星查看信息 · 进入对应星系地图'
        : st.level === 'surface'
          ? '[B] 关闭 · 点击航点 → 设为地面目标 → 步行跟随青色菱形罗盘'
          : '[B] 关闭 · 点击节点选择天体 · 设定目标后跟随罗盘脉冲',
    };
  }

  starMapSelectNode(id) {
    if (!id) return;
    this.starMapState.selectedId = String(id);
    this.audio.play('select');
    this.renderStarMapPanel();
  }

  starMapAction(action, id) {
    const st = this.starMapState;
    if (action === 'back') {
      if (st.level === 'surface') {
        // 地表 → 行星系统图（月球返回其母行星系统）
        const bodyNav = this.currentBodyNavId();
        const bodyNode = bodyNav ? bodyById(bodyNav) : null;
        const parentId = bodyNode && bodyNode.kind === 'moon' ? bodyNode.parentId : bodyNav;
        st.level = 'planet';
        st.focusId = parentId;
        st.selectedId = parentId;
      } else if (st.level === 'planet') {
        st.level = 'system'; st.focusId = null; st.selectedId = homeBodyId(st.viewSystemId);
      } else if (st.level === 'system') {
        st.level = 'stellar'; st.selectedId = bodyById(`star:${this.space.galaxyId}`) ? `star:${this.space.galaxyId}` : null;
      } else {
        return;
      }
      this.audio.play('uiClose');
      this.renderStarMapPanel();
      return;
    }
    if (action === 'target') {
      if (st.level === 'surface') this.setSurfaceTarget(id);
      else this.selectNavTarget(id);
      return;
    }
    if (action === 'cleartarget') {
      this.clearSurfaceTarget();
      this.renderStarMapPanel();
      return;
    }
    if (action === 'surface') {
      this.openSurfaceMap();
      return;
    }
    if (action === 'enter') {
      const node = bodyById(String(id));
      if (!node) return;
      if (node.kind === 'star') {
        st.level = 'system';
        st.viewSystemId = node.systemId;
        st.focusId = null;
        st.selectedId = homeBodyId(node.systemId);
      } else if (node.kind === 'planet') {
        st.level = 'planet';
        st.focusId = node.navId;
        st.selectedId = childrenOf(st.viewSystemId, node.navId)[0]?.navId || node.navId;
      }
      this.audio.play('uiOpen');
      this.renderStarMapPanel();
    }
  }

  // 星图 / 列表统一的目标选择入口
  selectNavTarget(id) {
    if (id === null || id === undefined) return;
    const node = this.space.resolveTargetNode(id);
    if (!node) {
      this.audio.play('deny');
      this.ui.toast('未知天体目标', true);
      return;
    }
    if (node.gateway && !(this.shipUpgrades && this.shipUpgrades.bigship)) {
      this.audio.play('deny');
      this.ui.toast('跨星系跃迁需要大型殖民船 · 前往空间站船坞购买', true);
      return;
    }
    if (this.starMapState && this.starMapState.viewSystemId !== this.space.galaxyId) {
      this.audio.play('deny');
      this.ui.toast(`该天体位于${systemMeta(this.starMapState.viewSystemId).name} · 请先跃迁到该星系`, true);
      return;
    }
    if (node.kind === 'planet' && this.space.galaxy[this.space.current]
      && node.navId === this.space.galaxy[this.space.current].navId) {
      this.ui.toast('你已位于该天体');
      this.audio.play('click');
      this.renderStarMapPanel();
      return;
    }
    if (node.kind === 'moon' && this.space.bodyId === node.navId) {
      this.ui.toast(`你已位于${node.name}`);
      this.audio.play('click');
      this.renderStarMapPanel();
      return;
    }
    if (!this.space.setTarget(id)) {
      this.audio.play('deny');
      this.ui.toast('无法设定该目标', true);
      return;
    }
    this.audio.play('select');
    const info = this.space.targetInfo();
    const distText = info && info.distM !== null && info.distM !== undefined ? ` · 距离 ${formatDistanceM(info.distM)}` : '';
    const note = node.landable ? '' : (node.dockable ? ' · 可停靠' : ' · 抵达后可观察，当前不可降落');
    this.ui.toast(`导航目标：${info ? info.name : node.name}${distText}${note} · 跟随罗盘脉冲`);
    this.closeStarMap();
  }

  refreshInventoryUI() {
    this.ui.renderHotbar(this.inventory.hotbar(), this.inventory.selected);
    if (this.ui.backpackVisible()) {
      this.ui.renderInventory(this.inventory.slots, this.inventory.selected);
      this.ui.renderCrafting(RECIPES, this.inventory, this.quests.requiredRecipeId());
    }
  }

  updateRepairUI() {
    const costs = SHIP_REPAIR_COSTS;
    const components = [
      {
        key: 'pulse', label: costs.pulse.label, desc: costs.pulse.desc,
        ok: this.ship.pulseOk, items: costs.pulse.items,
        canAfford: this.hasItems(costs.pulse.items),
      },
      {
        key: 'glass', label: costs.glass.label, desc: costs.glass.desc,
        ok: this.ship.glassOk, items: costs.glass.items,
        canAfford: this.hasItems(costs.glass.items),
      },
      {
        key: 'thruster', label: costs.thruster.label, desc: costs.thruster.desc,
        ok: this.ship.thrusterOk, items: costs.thruster.items,
        canAfford: this.hasItems(costs.thruster.items),
      },
    ];
    this.ui.renderRepair(components, costs, this.inventory);
  }

  hasItems(items) {
    for (const itemId of Object.keys(items)) {
      if (this.inventory.countOf(itemId) < items[itemId]) return false;
    }
    return true;
  }

  craftItem(recipeId) {
    const recipe = recipeById(recipeId);
    if (!recipe) return;
    if (!craft(this.inventory, recipe)) {
      this.audio.play('deny');
      if (canCraft(this.inventory, recipe)) this.ui.toast('背包已满，无法合成', true);
      return;
    }
    this.audio.play('craft');
    const item = ITEMS[recipe.out.item];
    this.ui.popup(item.name, recipe.out.count, recipe.out.item);
    this.ui.flashSlot(this.inventory.selected);
    this.quests.onCraft(recipe.out.item, recipe.out.count);
    if (this.milestones) this.milestones.bump('craft', 1);
    if (recipe.out.item === 'mining_beam_mk2') this.milestones.bump('toolTier2', 1);
    if (recipe.out.item === 'energy_coil') this.milestones.bump('weaponMod', 1);
    // 首次合成的用途提示（护盾电池自动补给）
    if (recipe.out.item === 'shield_cell' && !this.hintedShield) {
      this.hintedShield = true;
      this.ui.toast('护盾电池：护盾低于 30% 时自动补充 +60', false);
    }
    this.refreshInventoryUI();
  }

  repairComponent(key) {
    const costs = SHIP_REPAIR_COSTS[key];
    if (!costs || !this.hasItems(costs.items)) {
      this.audio.play('deny');
      this.ui.toast('材料不足，无法修复', true);
      return;
    }
    const changed = this.ship.repair(key);
    if (!changed) return;
    for (const itemId of Object.keys(costs.items)) {
      this.inventory.removeItem(itemId, costs.items[itemId]);
    }
    this.audio.play('repair');
    this.ui.shake();
    this.ui.toast(`${costs.label}修复完成`);
    this.quests.onShipRepair(key);
    this.quests.syncShip(this.ship); // 任务立即与真实修复状态同步
    this.updateRepairUI();
    this.refreshInventoryUI();
    if (this.ship.allRepaired) {
      this.audio.play('quest');
      if (this.milestones) this.milestones.bump('shipRepaired', 1);
      this.ui.toast('飞船已完全修复 · 即将可以起飞');
    }
  }

  // ---- 主循环 ----
  loop() {
    const loopStart = performance.now();
    const rawDt = Math.min(0.1, this.clock ? this.clock.getDelta() : 0.016);
    this.frame++;

    // 里程碑暂缓奖励：背包一有空位就补发（每帧检查，开销可忽略）
    if (this.running && !this.paused && this.milestones) this.milestones.flushPendingRewards();

    // 空间站订单冷却（暂停时不走表；停靠/游玩中均计时）
    if (this.running && !this.paused) {
      for (const key of Object.keys(this.stationOrderCd)) {
        this.stationOrderCd[key] = Math.max(0, (this.stationOrderCd[key] || 0) - rawDt);
        if (this.stationOrderCd[key] <= 0) delete this.stationOrderCd[key];
      }
      this.missionCd = Math.max(0, this.missionCd - rawDt);
      this.baseRestCd = Math.max(0, this.baseRestCd - rawDt);
      // 停靠时每秒刷新订单按钮/信用点，冷却倒计时可见
      if (this.docked && this.frame % 60 === 0) {
        this.renderStationUI(this.ui.stationTab || 'trade');
      }
    }

    // 设置面板：B/Esc 关闭（主菜单/暂停/游戏中均可打开，覆盖在底层界面之上）
    if (this.ui.settingsVisible() && (this.input.pressed(KEY.CLOSE) || this.input.pressed(KEY.PAUSE))) {
      if (this.input.pressed(KEY.CLOSE)) this.input.consume(KEY.CLOSE);
      this.input.consume(KEY.PAUSE);
      this.closeSettings();
    } else if (this.ui.milestonesVisible() && (this.input.pressed(KEY.CLOSE) || this.input.pressed(KEY.PAUSE))) {
      // 里程碑面板从暂停菜单打开（paused=true，面板链被跳过）→ 与设置同级的顶层关闭
      if (this.input.pressed(KEY.CLOSE)) this.input.consume(KEY.CLOSE);
      this.input.consume(KEY.PAUSE);
      this.closeMilestones();
    } else if (this.running && !this.paused && !this.intro.active) {
      // 面板按键（面板打开时指针未锁定，需在 active 判定前处理）
      const piloting = this.flight && this.flight.piloting;
      const inSpace = piloting && this.space && this.space.active;
      const tab = this.input.pressed(KEY.TAB);
      const esc = this.input.pressed(KEY.PAUSE);
      const inv = this.input.pressed(KEY.INVENTORY);
      const mapKey = this.input.pressed(KEY.STARMAP);
      const closeKey = this.input.pressed(KEY.CLOSE); // B 键：面板主关闭键（Esc 保留为兜底）
      if (this.ui.backpackVisible() && (tab || inv || closeKey || esc)) {
        this.closeBackpack();
        if (tab) this.input.consume(KEY.TAB);
        if (inv) this.input.consume(KEY.INVENTORY);
        if (closeKey) this.input.consume(KEY.CLOSE);
        if (esc) this.input.consume(KEY.PAUSE);
      } else if (this.ui.repairVisible() && (closeKey || esc)) {
        this.closeRepair();
        if (closeKey) this.input.consume(KEY.CLOSE);
        this.input.consume(KEY.PAUSE);
      } else if (this.ui.stationVisible() && (closeKey || esc)) {
        this.undockStation();
        if (closeKey) this.input.consume(KEY.CLOSE);
        this.input.consume(KEY.PAUSE);
      } else if (this.ui.storageVisible() && (closeKey || esc)) {
        this.closeStorage();
        if (closeKey) this.input.consume(KEY.CLOSE);
        this.input.consume(KEY.PAUSE);
      } else if (this.ui.logVisible() && (closeKey || esc)) {
        this.closeLogPanel();
        if (closeKey) this.input.consume(KEY.CLOSE);
        this.input.consume(KEY.PAUSE);
      } else if (this.ui.starMapVisible() && (mapKey || closeKey || esc)) {
        this.closeStarMap();
        if (mapKey) this.input.consume(KEY.STARMAP);
        if (closeKey) this.input.consume(KEY.CLOSE);
        if (esc) this.input.consume(KEY.PAUSE);
      } else if (this.ui.journeyVisible() && (closeKey || esc)) {
        this.closeJourney();
        if (closeKey) this.input.consume(KEY.CLOSE);
        this.input.consume(KEY.PAUSE);
      } else if (this.ui.milestonesVisible() && (closeKey || esc)) {
        this.closeMilestones();
        if (closeKey) this.input.consume(KEY.CLOSE);
        this.input.consume(KEY.PAUSE);
      } else if (!piloting && (tab || inv)) {
        this.toggleBackpack();
        if (tab) this.input.consume(KEY.TAB);
        if (inv) this.input.consume(KEY.INVENTORY);
      } else if (mapKey) {
        // M 在太空打开三级星图；在行星/卫星地表打开地表导航层
        if (inSpace) this.openStarMap();
        else this.openSurfaceMap();
        this.input.consume(KEY.STARMAP);
      } else if (esc) {
        // 指针未锁状态下按 Esc：重锁缓冲窗口内吞掉（onGesture 已借本次手势重试锁），
        // 防止"刚关面板后的第二下 Esc 误弹暂停"；缓冲期之后正常打开暂停菜单
        this.input.consume(KEY.PAUSE);
        if (!this.wantLock || performance.now() - this.relockGrace >= 1500) {
          this.input.exitLock();
          this.setPaused(true);
        }
      }
      // 面板打开期间吞咽"面板开启键"：陈旧 E/Tab/I/M 在关闭并重锁后不得误触
      // （历史 bug：开修理面板期间按的 E 存活 2 帧 → 关闭后被读作互动 → 面板重开）
      if (this.inMenu) {
        this.input.consume(KEY.INTERACT);
        this.input.consume(KEY.TAB);
        this.input.consume(KEY.INVENTORY);
        this.input.consume(KEY.STARMAP);
      }
    } else if (this.running && this.paused && this.input.pressed(KEY.PAUSE)) {
      // 暂停界面按 Esc → 继续（onGesture 会在手势上下文重锁，此处兜底）
      this.input.consume(KEY.PAUSE);
      this.resumeFromPause();
    }

    // 指针锁异常丢失（浏览器拒绝/冷却）→ 提示点击继续；任意手势自动重锁。
    // 阈值 1.6s：留出"关面板→自动重试重锁"（~1.35s）的静默期，避免每次关面板都刷提示
    if (this.running && !this.paused && !this.inMenu && !this.input.locked) {
      this.stuckTimer += rawDt;
      if (this.stuckTimer > 1.6 && !this.stuckHintShown) {
        this.stuckHintShown = true;
        this.ui.toast('点击屏幕或按任意键继续游戏', true);
      }
    } else {
      this.stuckTimer = 0;
      this.stuckHintShown = false;
    }

    const active = this.running && !this.paused && !this.inMenu && this.input.locked;
    const pilotingNow = this.flight && this.flight.piloting;
    // 开场镜头中隐藏第一人称枪模（枪挂在相机上，会跟着俯瞰镜头乱飞）
    if (this.player) this.player.gun.visible = active && !pilotingNow && !this.intro.active;
    if (active) {
      // 自动存档（每 60 秒）
      this.autoSaveTimer = (this.autoSaveTimer || 0) + rawDt;
      if (this.autoSaveTimer > 60) {
        this.autoSaveTimer = 0;
        saveGame(this);
      }
      const piloting = this.flight && this.flight.piloting;
      if (piloting) {
        // ---- 飞船驾驶 ----
        const dt = rawDt;
        this.flight.update(dt);
        this.space.update(dt);
        if (this.space.active) {
          this.spaceCombat.update(dt);
          // Q：舰载能量弹（太空战斗；地面 Q 仍由 Player 处理）
          if (this.input.pressed(KEY.FIRE)) {
            this.input.consume(KEY.FIRE);
            this.spaceCombat.fireShipBolt();
          }
        }
        // 目标罗盘（名称 + 方向 + 真实距离 + 预计抵达时间）
        if (this.space.active && this.space.targetId !== -1) {
          const comp = this.space.compass();
          if (comp) {
            const speed = Math.max(1, this.flight ? this.flight.effectiveSpeed : 1);
            const eta = comp.distM / Math.max(1, speed);
            this.ui.setCompass(comp.angle, formatDistanceM(comp.distM), comp.label, formatEta(eta));
          } else {
            this.ui.setCompass(null, null);
          }
        } else {
          this.ui.setCompass(null, null);
        }
        this.world.update(this.flight.pos.x, this.flight.pos.z);
        this.particles.update(dt);
        if (!this.space.active) {
          const alt = this.flight.altitudeM();
          this.sky.altitudeM = alt;
          this.camera.far = Math.max(900, alt * 4 + 2000);
          this.camera.updateProjectionMatrix();
        }
        this.sky.update(dt, this.flight.pos);
        this.weather.update(dt, this.flight.pos); // 驾驶时风暴自动淡出
        const wind = this.space.active ? 0.1 : 0.3 + Math.min(1, this.flight.speed / 30) * 0.6;
        this.audio.setAmbient(wind, this.space.active ? 0.9 : this.sky.nightFactor);
        this.sky.caveDim(0);
        this.headlamp.intensity = 0;
        if (this.frame % 6 === 0) this.flight.updateHUD();
      } else {
        if (!this.intro.active) {
          this.accumulator += rawDt;
          let steps = 0;
          while (this.accumulator >= this.fixedDt && steps < 6) {
            this.player.update(this.fixedDt);
            this.accumulator -= this.fixedDt;
            steps++;
          }
          if (steps === 6) this.accumulator = 0;
        } else {
          this.accumulator = 0; // 开场镜头期间不累积物理步，结束时无跳帧
        }
        const dt = rawDt;

        this.world.update(this.player.pos.x, this.player.pos.z);
        if (this.space && typeof this.space.syncSurfaceSky === 'function') this.space.syncSurfaceSky();
        this.particles.update(dt);
        this.sky.update(dt, this.player.pos);
        this.weather.update(dt, this.player.pos);
        // 首次入夜生存提示：不是惩罚突然砸脸，而是提前给玩家一个可执行的对策
        if (!this.nightWarned && this.sky.nightFactor > 0.55 && !this.player.flyMode) {
          this.nightWarned = true;
          this.audio.play('warn');
          this.ui.toast('夜幕降临 · 危险防护持续下降：采集钠花补充，搭建庇护所可躲避生物', true);
        } else if (this.nightWarned && this.sky.nightFactor < 0.25) {
          this.nightWarned = false;
        }
        // 地热熔岩：伤害与火光
        this.updateMagmaHazard(dt);
        this.magmaScanTimer -= dt;
        if (this.magmaScanTimer <= 0) {
          this.magmaScanTimer = 0.5;
          this.refreshMagmaLights();
        }

        // 坠毁点余烟（脉冲引擎修复后停止）——远处即可定位飞船
        this.smokeTimer -= dt;
        if (this.smokeTimer <= 0 && !this.ship.pulseOk) {
          this.smokeTimer = 0.3;
          // 尾部 + 机身两处烟源：烟柱更密、从任何角度都可见
          for (const off of [[0, 1.4, 3.9], [0, 2.2, 0.6]]) {
            this.ship.group.localToWorld(this.smokeV.set(...off));
            this.particles.spawnBurst(this.smokeV.x, this.smokeV.y, this.smokeV.z, 0x8a8a8a, {
              count: 3, speed: 0.8, up: 1.9, spread: 0.5, life: 4.2, size: 0.5, gravity: -0.9, jitter: 0.4,
            });
          }
          if (Math.random() < 0.6) {
            this.ship.group.localToWorld(this.smokeV2.copy(this.ship.smokePos));
            this.particles.spawnBurst(this.smokeV2.x, this.smokeV2.y + 0.4, this.smokeV2.z, 0xff8c3a, {
              count: 1, speed: 0.4, up: 0.9, life: 0.9, size: 0.08, gravity: -1.0,
            });
          }
        }

        // 环境音（风暴加大风声）
        const wind = 0.35 + Math.min(1, Math.hypot(this.player.vel.x, this.player.vel.z) / WALK_SPEED) * 0.3
          + (this.player.flyMode ? 0.3 : 0) + this.weather.intensity * 0.5;
        this.audio.setAmbient(wind, this.sky.nightFactor);
        this.audio.setCaveMode(this.player.underground);

        // 数据日志全息动画
        if (this.logs) this.logs.update(dt);
        if (this.anomalies) this.anomalies.update(dt);

        // 洞穴暗化 + 头灯 / 手电筒（F 键）
        const caveTarget = this.player.underground ? 1 : 0;
        this.caveFactor += (caveTarget - this.caveFactor) * (1 - Math.exp(-2.5 * dt));
        this.sky.caveDim(this.caveFactor);
        this.headlamp.position.copy(this.camera.position);
        this.headlamp.intensity = this.flashlightOn ? 1.9 : this.caveFactor * 2.6;

        // 生物与武器
        this.mobs.update(dt);
        this.combat.update(dt);
      }

      // HUD 刷新（低频）
      if (this.frame % 12 === 0) {
        this.ui.setPlanetInfo({
          time: this.sky.clockText(),
          pos: this.posText(),
        });
        this.ui.setRegion(this.regionLabel());
        this.ui.setBars({
          shield: this.player.shield,
          health: this.player.health,
          life: this.player.life,
          hazard: this.player.hazard,
        });
        this.ui.setActiveMission(this.mission ? `${this.mission.label} · ${missionProgressText(this.mission)}` : null);
        if (!piloting) {
          // 采矿工具档位常驻提示（徒手/MkI/MkII 单格/区域）
          const tier = this.player.toolTier;
          this.ui.setToolMode(
            tier >= 2 ? (this.player.miningMode === 1 ? '采矿光束 MkII · 区域 3×3' : '采矿光束 MkII · 单格精采')
              : tier === 1 ? '多功能工具 · 单格开采'
              : '徒手开采'
          );
          // 准星提示（无目标挖掘时）
          if (this.player.target && !this.player.mineTarget) {
            const d = this.blockName(this.player.target.id);
            this.ui.setTooltip(d);
            this.ui.setCrosshair('target', 0);
          } else if (!this.player.mineTarget) {
            this.ui.setTooltip(null);
            this.ui.setCrosshair('idle', 0);
          }
          // 飞船互动提示：已修复 → 只提示登船（历史 bug：修好后仍提示"修复飞船"）
          const step = this.quests.currentStep.id;
          const nearShip = this.ship && Math.hypot(this.ship.worldPos.x - this.player.pos.x, this.ship.worldPos.z - this.player.pos.z) < 9;
          const shipSteps = step === 'checkShip' || step === 'repairPulse' || step === 'repairGlass' || step === 'fuelLaunch';
          const repaired = this.ship && this.ship.allRepaired;
          this.ui.setInteractHint(!this.intro.active && nearShip && (shipSteps || repaired)
            ? '按 <span class="key">E</span> ' + (repaired ? '登上飞船' : (step === 'checkShip' ? '检查飞船残骸' : '打开维修面板')) : null);
          // 数据日志提示（优先于飞船提示）
          if (this.logs && !this.intro.active) {
            const near = this.logs.nearestUnread(this.player.pos.x, this.player.pos.y, this.player.pos.z, this.collectedLogs);
            this.nearLog = near.id && near.dist < 3.2 ? near.id : null;
            if (this.nearLog) this.ui.setInteractHint('按 <span class="key">E</span> 读取数据日志');
          }
          // 基地/储物箱交互提示（日志与飞船提示优先）
          if (!this.nearLog && !nearShip && !this.intro.active) {
            const b = this.currentBase();
            const nearBase = b && Math.hypot(this.player.pos.x - (b.x + 0.5), this.player.pos.z - (b.z + 0.5)) < 3.2
              && Math.abs(this.player.pos.y - b.y) < 3.5;
            const nearCrate = this.findCrateNear(this.player.pos.x, this.player.pos.y, this.player.pos.z, 2.6);
            if (nearBase) this.ui.setInteractHint('按 <span class="key">E</span> 使用基地终端（休息/确认重生点）');
            else if (nearCrate) this.ui.setInteractHint('按 <span class="key">E</span> 打开储物箱');
          }
          // 异常点提示（遗迹/无人机/补给箱；日志/飞船/基地/储物提示优先）
          if (!this.nearLog && !nearShip && this.anomalies && !this.intro.active && !this.ui.interactHint.textContent.includes('基地') && !this.ui.interactHint.textContent.includes('储物')) {
            const { an, dist } = this.anomalies.nearest(this.player.pos.x, this.player.pos.y, this.player.pos.z);
            if (an && dist < 3.2) this.ui.setInteractHint('按 <span class="key">E</span> 调查 ' + an.name);
          }
        } else if (this.space.active && this.stationNear) {
          this.ui.setToolMode(null);
          // 太空停靠提示
          this.ui.setInteractHint('按 <span class="key">E</span> 停靠空间站');
        } else if (this.space.active && this.beltNear) {
          // 小行星带开采提示
          this.ui.setInteractHint(`按 <span class="key">E</span> 开采小行星带 · 剩余矿点 ${this.beltCharges}`);
        } else if (piloting) {
          this.ui.setToolMode(null);
          this.ui.setInteractHint(null);
        }
      }

      // 任务与飞船真实修复状态同步（乱序修复/创造模式一次性修完）
      if (this.frame % 12 === 0) this.quests.syncShip(this.ship);

      // 快捷键（驾驶中禁用；开场镜头中禁用）
      if (!piloting && !this.intro.active) {
        if (this.input.pressed(KEY.SCAN)) {
          this.input.consume(KEY.SCAN);
          this.scanning.trigger();
          this.discoverSurfaceAround(60, true); // 扫描会点亮附近异常点的地表航点
        }
        // 探索迷雾：靠近异常点时自动记录为已发现航点（低频）
        if (this.frame % 12 === 0) this.discoverSurfaceAround(90);
        this.handleSlotKeys();
      }
      if (!piloting && !this.intro.active) this.scanning.update(rawDt);
    }

    // 飞船方位罗盘：每帧平滑旋转（步行且距残骸 >9m 常驻指引，起飞后隐藏）
    if (active && !pilotingNow && this.ship && this.flight && !this.flight.launched) {
      const p = this.player.pos, s = this.ship.worldPos;
      const dx = s.x - p.x, dz = s.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 9) {
        const bearing = Math.atan2(dx, dz);
        const look = Math.atan2(-Math.sin(this.player.yaw), -Math.cos(this.player.yaw));
        this.ui.setShipCompass(bearing - look, dist);
      } else this.ui.setShipCompass(null);
    } else {
      this.ui.setShipCompass(null);
    }

    // 地表导航罗盘：步行时指向所选航点（飞船/日志/异常点），抵达自动完成
    if (active && !pilotingNow && this.surfaceTarget && this.player) {
      const p = this.player.pos;
      const dx = this.surfaceTarget.x - p.x, dz = this.surfaceTarget.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 3) {
        this.ui.toast(`已抵达：${this.surfaceTarget.name}`, false);
        this.audio.play('popup');
        this.clearSurfaceTarget();
      } else {
        const bearing = Math.atan2(dx, dz);
        const look = Math.atan2(-Math.sin(this.player.yaw), -Math.cos(this.player.yaw));
        this.ui.setSurfaceCompass(bearing - look, dist, this.surfaceTarget.name);
      }
    } else {
      this.ui.setSurfaceCompass(null, null);
    }

    // 地热火光只在步行时显示
    const showMagmaLights = active && !pilotingNow;
    for (const l of this.magmaLights) l.light.visible = l.active && showMagmaLights;

    // 开场镜头：覆盖相机（世界/天空/粒子照常运转，镜头飞行中世界是活的）
    if (this.intro.active) this.updateIntro(rawDt);

    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();

    // 自适应性能：帧率优先。GPU 压力大时降低渲染分辨率；帧余量充足时
    // 再逐步恢复分辨率并提高区块网格化预算，尽快消化脏区块队列。
    // rawDt 来自 requestAnimationFrame 的真实间隔（含合成/GPU 等待）；
    // loopStart 只覆盖 JS 执行耗时。取两者较大值才能识别“JS 快但渲染慢”的低帧场景。
    const loopMs = performance.now() - loopStart;
    const frameMs = Math.max(loopMs, rawDt * 1000);
    this.frameMsAvg += (frameMs - this.frameMsAvg) * 0.08;
    this.adaptiveTimer -= rawDt;
    if (this.adaptiveTimer <= 0) {
      this.adaptiveTimer = 0.5;
      const world = this.world;
      if (this.frameMsAvg > 38) {
        if (this.renderScale > 0.6) {
          this.renderScale = Math.max(0.6, this.renderScale - (this.frameMsAvg > 60 ? 0.2 : 0.1));
          this.applyGraphics(false);
        }
        if (world) world.remeshBudget = 1;
      } else {
        if (this.frameMsAvg < 15 && this.renderScale < 1) {
          this.renderScale = Math.min(1, this.renderScale + 0.05);
          this.applyGraphics(false);
        }
        if (world) {
          const budget = world.remeshBudget || 2;
          if (this.frameMsAvg < 8) world.remeshBudget = Math.min(6, budget + 1);
          else if (this.frameMsAvg > 20) world.remeshBudget = 1;
          else if (this.frameMsAvg > 14) world.remeshBudget = Math.max(1, budget - 1);
        }
      }
    }
  }

  blockName(id) {
    return blockDef(id).name;
  }

  handleSlotKeys() {
    const input = this.input;
    for (let i = 0; i < 9; i++) {
      const code = 'Digit' + ((i + 1) % 10);
      if (input.pressed(code)) {
        input.consume(code);
        this.inventory.select(i);
        this.audio.play('select');
        this.ui.renderHotbar(this.inventory.hotbar(), this.inventory.selected);
      }
    }
    const w = input.takeWheel();
    if (w !== 0) {
      this.inventory.cycle(w);
      this.audio.play('select');
      this.ui.renderHotbar(this.inventory.hotbar(), this.inventory.selected);
    }
  }

  // ---- 切换世界（跨星球跃迁 / 重新生成） ----
  // 卫星存档恢复：按统一模型重建月面世界（无坠机遗迹）
  rebuildWorldForBody(bodyNavId) {
    const node = bodyById(bodyNavId);
    if (!node || node.kind !== 'moon') return;
    const seed = moonSeedOf(this.seed, node.navId);
    this.applyNewWorld(seed, node.palette, {
      terrain: node.terrain,
      surface: node.surface || 'moon',
      ores: node.ores,
      plants: node.plants,
      hazard: node.hazard,
      weather: node.weather,
      body: node,
      planetName: `${node.name} · ${(this.space && this.space.galaxy[this.space.current] && this.space.galaxy[this.space.current].name) || '母星'}系统`,
      noCrashSite: true,
    });
    if (this.player) this.player.respawn(this.world.spawnPoint());
  }

  applyNewWorld(newSeed, palette, opts = {}) {
    this.seed = newSeed;
    this.surfaceTarget = null; // 旧世界地表航点失效
    this.ui.setSurfaceCompass(null, null);
    this.clearMagmaLights();
    // 清理旧世界与实体
    for (const [, c] of this.world.chunks) this.world.disposeChunkMeshes(c);
    if (opts.replaceShip && this.ship) this.ship.dispose(this.scene);
    if (opts.replaceShip && this.logs) this.logs.dispose();
    if (this.mobs) this.mobs.clear();
    if (this.combat) this.combat.clear();
    // 目标行星的地形/表面/资源参数（地形差异化）
    const profile = opts.terrain ? {
      ...opts.terrain, surface: opts.surface, ores: opts.ores, plants: opts.plants,
      underground: opts.underground || (opts.body && opts.body.underground) || null,
    } : null;
    this.world = new World(newSeed, profile);
    this.world.renderDist = this.settings.renderDist;
    if (this.spaceCombat) this.spaceCombat.clear();
    // 基地/储物箱实体监听：每个新世界都要重新绑定
    this.world.events.onBlockBroken = (x, y, z, id) => {
      if (id === B.BASE_UNIT) this.removeBaseAt(x, y, z);
      else if (id === B.STORAGE) this.removeCrateAt(x, y, z);
    };
    this.world.events.onBlockPlaced = (x, y, z, id) => {
      if (id === B.BASE_UNIT) this.registerBaseAt(x, y, z);
      else if (id === B.STORAGE) this.registerCrateAt(x, y, z);
    };
    this.planetHazard = opts.hazard || { kind: 'none', drain: 0, when: 'night', label: '' };
    // 行星物理差异化：切换世界后重力/昼夜/太阳视大小/大气立即生效
    this.applyBodyProfile(opts.body || (this.space && this.space.galaxy[this.space.current]) || null);
    if (this.weather) this.weather.setPlanet(opts.weather || { kind: 'none', freq: 0, dur: 0 }, this.hazardBadgeText(this.planetHazard));
    this.world.setScene(this.scene);
    this.world.setMaterials([this.opaqueMat, this.cutoutMat, this.fluidMat]);
    // 行星色板：重烘焙纹理（植被色相）并更新图标
    const { atlas, icons } = createBlockTextures(palette || null);
    atlas.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.atlas.dispose();
    this.atlas = atlas;
    this.opaqueMat.map = atlas; this.opaqueMat.needsUpdate = true;
    this.cutoutMat.map = atlas; this.cutoutMat.needsUpdate = true;
    this.fluidMat.map = atlas; this.fluidMat.needsUpdate = true;
    this.ui.iconCache.clear();
    this.ui.setItemIconMap(this.ui.itemIcons, icons);
    // 地形
    const sp = this.world.spawnPoint();
    const pcx = Math.floor(sp.x / CHUNK), pcz = Math.floor(sp.z / CHUNK);
    this.world.ensureArea(pcx, pcz, 2);
    if (!opts.noCrashSite) this.world.carveCrash(); // 卫星等无坠机遗迹的世界保留原始地表
    let guard = 0;
    let last = 1;
    while (this.world.dirty.size > 0 && last > 0 && guard < 2000) {
      last = this.world.remeshQueue(sp.x, sp.z, 6);
      guard++;
    }
    // 天空与星球信息
    this.sky.setPalette(palette || null);
    this.planetName = opts.planetName || this.makePlanetName();
    this.ui.setPlanetInfo({ name: this.planetName });
    // 环境危险提示
    if (this.planetHazard && this.planetHazard.kind !== 'none' && this.planetHazard.kind !== 'mild') {
      this.ui.toast(`环境警告：${this.planetHazard.label} · 危险防护将持续消耗`, true);
    }
    if (opts.replaceShip) {
      this.ship = new CrashedShip(this.scene, this.atlas);
      // 残骸堆垫高（与初始放置一致）：船体高出弹坑边缘、远处可见
      const crashGy = this.world.getGroundY(this.world.crashX, this.world.crashZ);
      this.world.buildWreckMound(this.world.crashX, this.world.crashZ);
      this.ship.setPosition(
        this.world.crashX,
        crashGy + 4.05,
        this.world.crashZ
      );
    }
    // 每个新世界重建探索实体：日志（有坠机遗迹的世界）与异常点（所有世界）
    if (this.logs) { this.logs.dispose(); this.logs = null; }
    if (this.anomalies) { this.anomalies.dispose(); this.anomalies = null; }
    if (!opts.noCrashSite) {
      this.logs = new CrashLogs(this.scene, this.world);
      this.logs.setCollected(this.collectedLogs);
    }
    this.anomalies = new Anomalies(this, this.world);
    this.anomalies.setCollected(this.collectedAnomalies);
    this.syncBaseForCurrentWorld();
  }

}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
