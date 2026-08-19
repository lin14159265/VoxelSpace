// HUD / 菜单 / 弹窗 DOM 层
export class UI {
  constructor() {
    this.el = (id) => document.getElementById(id);
    this.loading = this.el('loading');
    this.loadingFill = this.el('loading-fill');
    this.loadingText = this.el('loading-text');
    this.menu = this.el('menu');
    this.paused = this.el('paused');
    this.hud = this.el('hud');
    this.crosshair = this.el('crosshair');
    this.mineProgress = this.el('mine-progress');
    this.toolMode = this.el('tool-mode');
    this.tooltip = this.el('tooltip');
    this.hotbarEl = this.el('hotbar');
    this.missionList = this.el('mission-list');
    this.missionsTitle = document.querySelector('#missions .panel-title');
    this.introFade = this.el('intro-fade');
    this.milestonesPanel = this.el('milestones-panel');
    this.milestonesList = this.el('milestones-list');
    this.objectiveText = this.el('objective-text');
    this.objectiveProgress = this.el('objective-progress');
    this.activeMission = this.el('active-mission');
    this.planetName = this.el('planet-name');
    this.planetTime = this.el('planet-time');
    this.planetPos = this.el('planet-pos');
    this.planetRegion = this.el('planet-region');
    this.popups = this.el('popups');
    this.toasts = this.el('toasts');
    this.interactHint = this.el('interact-hint');
    this.bars = {
      shield: this.el('bar-shield'),
      health: this.el('bar-health'),
      life: this.el('bar-life'),
      hazard: this.el('bar-hazard'),
    };
    this.flightHud = this.el('flight-hud');
    this.fhSpeed = this.el('fh-speed');
    this.fhUnit = this.el('fh-unit');
    this.fhAlt = this.el('fh-alt');
    this.fhThrottle = this.el('fh-throttle-fill');
    this.shipShieldBar = this.el('bar-ship-shield');
    this.shipHullBar = this.el('bar-ship-hull');
    this.shipShieldText = this.el('ship-shield-text');
    this.shipHullText = this.el('ship-hull-text');
    this.btnStart = this.el('btn-start');
    this.btnResume = this.el('btn-resume');
    this.btnContinue = this.el('btn-continue');
    this.btnNew = this.el('btn-new');
    this.btnLoad = this.el('btn-load');
    this.btnSave = this.el('btn-save');
    this.btnMilestones = this.el('btn-milestones');
    this.btnSort = this.el('btn-sort');
    this.btnExport = this.el('btn-export');
    this.btnImport = this.el('btn-import');
    this.saveFileInput = this.el('save-file-input');
    this.pauseStats = this.el('pause-stats');
    this.btnSettings = this.el('btn-settings');
    this.btnMenu = this.el('btn-menu');
    this.btnSettingsMenu = this.el('btn-settings-menu');
    this.btnQuit = this.el('btn-quit');
    this.btnExitBack = this.el('btn-exit-back');
    this.exitScreen = this.el('exit-screen');
    this.settingsPanel = this.el('settings-panel');
    this.shipCompassEl = this.el('ship-compass');
    this.shipCompassArrow = this.el('ship-compass-arrow');
    this.shipCompassDist = this.el('ship-compass-dist');
    this.surfaceCompassEl = this.el('surface-compass');
    this.surfaceCompassArrow = this.el('surface-compass-arrow');
    this.surfaceCompassLabel = this.el('surface-compass-label');
    this.surfaceCompassDist = this.el('surface-compass-dist');
    this.modeBadge = this.el('mode-badge');
    this.envBadge = this.el('env-badge');
    this.weatherOverlay = this.el('weather-overlay');
    this.reentryOverlay = this.el('reentry-overlay');
    this.invPanel = this.el('inventory-panel');
    this.invGrid = this.el('inv-grid');
    this.craftList = this.el('craft-list');
    this.repairPanel = this.el('repair-panel');
    this.repairList = this.el('repair-list');
    this.repairSub = this.el('repair-sub');
    this.storagePanel = this.el('storage-panel');
    this.storageBody = this.el('storage-body');
    this.storageTitle = this.el('storage-title');
    this.onStorageAction = null; // (action, index) => Game 处理存取
    this.starmapPanel = this.el('starmap-panel');
    this.starmapList = this.el('starmap-list');
    this.starmapCanvas = this.el('starmap-canvas');
    this.starmapInfo = this.el('starmap-info');
    this.starmapInfoTitle = this.el('starmap-info-title');
    this.starmapInfoFacts = this.el('starmap-info-facts');
    this.starmapInfoActions = this.el('starmap-info-actions');
    this.starmapBackBtn = this.el('btn-starmap-back');
    this.starmapLevelLabel = this.el('starmap-level-label');
    this.starmapCrumbStellar = this.el('starmap-crumb-stellar');
    this.starmapCrumbSystem = this.el('starmap-crumb-system');
    this.starmapCrumbPlanet = this.el('starmap-crumb-planet');
    this.starmapCrumbSurface = this.el('starmap-crumb-surface');
    this.starmapSep1 = this.el('starmap-sep1');
    this.starmapSep2 = this.el('starmap-sep2');
    this.starmapSep3 = this.el('starmap-sep3');
    this.starmapListTitle = this.el('starmap-list-title');
    this.starmapHint = this.el('starmap-hint');
    this.onStarMapSelect = null;   // (id) => 在轨道图/列表中选择节点
    this.onStarMapAction = null;   // (action, id) => 详情面板按钮（target/enter）
    this.starmapViewNodes = [];
    this.starmapBackBtn.addEventListener('click', () => {
      if (this.onStarMapAction) this.onStarMapAction('back', null);
    });
    this.starmapCanvas.addEventListener('click', (e) => {
      const r = this.starmapCanvas.getBoundingClientRect();
      const x = (e.clientX - r.left) * (this.starmapCanvas.width / Math.max(1, r.width));
      const y = (e.clientY - r.top) * (this.starmapCanvas.height / Math.max(1, r.height));
      let best = null, bestD = Infinity;
      for (const n of this.starmapViewNodes) {
        const d = Math.hypot(n.x - x, n.y - y);
        if (d <= Math.max(n.r || 8, 12) && d < bestD) { best = n; bestD = d; }
      }
      if (best && this.onStarMapSelect) this.onStarMapSelect(best.id);
    });
    this.stationPanel = this.el('station-panel');
    this.stationCreditsEl = this.el('station-credits');
    this.stationTabs = this.el('station-tabs');
    this.stationBody = this.el('station-body');
    this.stationTab = 'trade';
    this.onStationAction = null;
    this.onStationTab = null;
    this.onNpcClick = null;
    this.onStorageAction = null;
    this.btnStorageTakeAll = this.el('btn-storage-take-all');
    this.btnStorageStoreAll = this.el('btn-storage-store-all');
    this.btnStorageTakeAll.addEventListener('click', () => {
      if (this.onStorageAction) this.onStorageAction('takeAll', -1);
    });
    this.btnStorageStoreAll.addEventListener('click', () => {
      if (this.onStorageAction) this.onStorageAction('storeAll', -1);
    });
    for (const b of [this.btnStorageTakeAll, this.btnStorageStoreAll]) {
      b.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
    }
    this.logPanel = this.el('log-panel');
    this.logList = this.el('log-list');
    this.logText = this.el('log-text');
    this.npcLineIdx = {}; // npcId → 当前对话行
    for (const b of this.stationTabs.querySelectorAll('button')) {
      b.addEventListener('click', () => {
        this.stationTab = b.dataset.tab;
        if (this.onStationTab) this.onStationTab(this.stationTab);
      });
      b.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
    }
    this.warpFlashEl = this.el('warp-flash');
    this.journeyPanel = this.el('journey-panel');
    this.journeyStats = this.el('journey-stats');
    this.btnJourney = this.el('btn-journey');
    this.compassEl = this.el('compass');
    this.compassArrow = this.el('compass-arrow');
    this.compassLabel = this.el('compass-label');
    this.compassDist = this.el('compass-dist');
    this.compassEta = this.el('compass-eta');
    this.iconCache = new Map(); // itemId → dataURL
    this.itemIcons = null;      // itemId → tile index
    this.tileCanvases = null;   // tile index → canvas
  }

  setLoading(pct, text) {
    this.loadingFill.style.width = Math.round(pct) + '%';
    if (text) this.loadingText.textContent = text;
  }
  showLoading(v) { this.loading.classList.toggle('hidden', !v); }

  showMenu(v) {
    this.menu.classList.toggle('hidden', !v);
    if (v) this.hud.classList.add('hidden');
  }
  showPaused(v) { this.paused.classList.toggle('hidden', !v); }
  setHudVisible(v) { this.hud.classList.toggle('hidden', !v); }
  setSeed(seed) { this.el('menu-seed').textContent = seed; }

  // ---- 飞行 HUD ----
  setFlightHud(v) {
    this.flightHud.classList.toggle('hidden', !v);
    const frame = this.el('cockpit-frame');
    if (frame) {
      frame.classList.toggle('hidden', !v);
      if (v && !frame.querySelector('.cf-center')) {
        const c = document.createElement('div');
        c.className = 'cf-center';
        frame.appendChild(c);
      }
    }
  }
  setFlightHudValues({ speed, alt, throttle, onGround, shield = 100, shieldMax = 100, hull = 100, hullMax = 100, speedUnit = 'km/h' }) {
    this.fhSpeed.textContent = speed;
    if (this.fhUnit) this.fhUnit.textContent = speedUnit;
    this.fhAlt.textContent = alt;
    this.fhThrottle.style.width = Math.max(0, Math.min(100, throttle)) + '%';
    this.shipShieldBar.style.width = Math.max(0, Math.min(100, shield / shieldMax * 100)) + '%';
    this.shipHullBar.style.width = Math.max(0, Math.min(100, hull / hullMax * 100)) + '%';
    this.shipShieldText.textContent = Math.max(0, Math.round(shield));
    this.shipHullText.textContent = Math.max(0, Math.round(hull));
  }

  onStart(cb) {
    this.btnStart.addEventListener('click', cb);
    this.btnStart.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }
  onContinue(cb) {
    this.btnContinue.addEventListener('click', cb);
    this.btnContinue.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }
  onNew(cb) {
    this.btnNew.addEventListener('click', cb);
    this.btnNew.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }
  // 有存档 → 继续/新游戏/读取存档；无存档 → 单一开始按钮。设置/退出始终显示。
  setupMenu(hasSave) {
    this.btnContinue.classList.toggle('hidden', !hasSave);
    this.btnNew.classList.toggle('hidden', !hasSave);
    this.btnLoad.classList.toggle('hidden', !hasSave);
    this.btnExport.classList.toggle('hidden', !hasSave);
    this.btnStart.classList.toggle('hidden', hasSave);
  }
  onResume(cb) { this.btnResume.addEventListener('click', cb); }
  onSave(cb) {
    this.btnSave.addEventListener('click', cb);
    this.btnSave.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }
  onSettingsOpen(cb) {
    for (const b of [this.btnSettings, this.btnSettingsMenu]) {
      b.addEventListener('click', cb);
      b.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
    }
  }
  onMenuExit(cb) {
    this.btnMenu.addEventListener('click', cb);
    this.btnMenu.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }
  onLoad(cb) {
    this.btnLoad.addEventListener('click', cb);
    this.btnLoad.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }
  onQuit(cb) {
    this.btnQuit.addEventListener('click', cb);
    this.btnQuit.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }
  onExitBack(cb) {
    this.btnExitBack.addEventListener('click', cb);
    this.btnExitBack.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }

  showExit(v) { this.exitScreen.classList.toggle('hidden', !v); }

  // ---- 设置面板 ----
  showSettings(v) { this.settingsPanel.classList.toggle('hidden', !v); }
  settingsVisible() { return !this.settingsPanel.classList.contains('hidden'); }
  initSettingsPanel(values, onChange) {
    this.settingsValues = values;
    this.settingsOnChange = onChange;
    const hover = (el) => el.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
    const bindRange = (id, key, fmt, scale = 1) => {
      const input = this.el(id);
      const label = this.el(id + '-val');
      input.value = values[key] * scale;
      label.textContent = fmt(values[key]);
      input.addEventListener('input', () => {
        const v = Number(input.value) / scale;
        values[key] = v;
        label.textContent = fmt(v);
        onChange(key, v);
      });
      hover(input);
    };
    bindRange('set-fov', 'fov', (v) => v + '°');
    bindRange('set-renderdist', 'renderDist', (v) => v + ' 区块');
    bindRange('set-sens', 'sens', (v) => Math.round(v * 100) + '%', 100);
    bindRange('set-musicvol', 'musicVol', (v) => Math.round(v * 100) + '%', 100);
    bindRange('set-sfxvol', 'sfxVol', (v) => Math.round(v * 100) + '%', 100);
    const sel = this.el('set-graphics');
    sel.value = values.graphics;
    sel.addEventListener('change', () => {
      values.graphics = sel.value;
      onChange('graphics', sel.value);
    });
    hover(sel);
    const modeBtn = this.el('set-mode');
    modeBtn.addEventListener('click', () => {
      values.creative = !values.creative;
      this.refreshModeButton();
      onChange('creative', values.creative);
    });
    hover(modeBtn);
    this.refreshModeButton();
  }
  refreshModeButton() {
    const v = this.settingsValues ? !!this.settingsValues.creative : false;
    this.el('set-mode').textContent = v ? '切换到生存模式' : '切换到创造模式';
    this.el('set-mode-val').textContent = v ? '创造' : '生存';
  }
  setModeBadge(text) { this.modeBadge.textContent = text; }

  // 游戏中锁定创造模式开关：主菜单可选择模式；进入游戏后切换会成为
  // 一键上帝模式，短路生存压力、探索收益与成长反馈。
  setCreativeLocked(locked) {
    const btn = this.el('set-mode');
    if (btn) {
      btn.disabled = !!locked;
      btn.title = locked ? '游戏进行中不可切换模式；请返回主菜单选择' : '';
    }
  }

  // ---- 环境危险徽章 ----
  setEnvBadge(text) {
    if (text) {
      this.envBadge.textContent = '⚠ ' + text;
      this.envBadge.classList.remove('hidden');
    } else {
      this.envBadge.classList.add('hidden');
    }
  }

  // ---- 天气滤镜（沙暴/暴雪屏幕覆盖） ----
  setWeather(kind, intensity) {
    const el = this.weatherOverlay;
    if (!el) return;
    if (this._weatherKind === kind && Math.abs((this._weatherIntensity || 0) - intensity) < 0.02) return;
    this._weatherKind = kind;
    this._weatherIntensity = intensity;
    el.classList.toggle('snow', kind === 'snow');
    el.classList.toggle('dust', kind === 'dust');
    el.style.opacity = kind === 'none' || intensity <= 0.02 ? '0' : String(Math.min(1, intensity * 0.8));
  }

  // ---- 大气再入热障滤镜（等离子体灼热橙红边缘） ----
  setReentry(k) {
    const el = this.reentryOverlay;
    if (!el) return;
    const on = k > 0.02;
    el.classList.toggle('active', on);
    el.style.opacity = on ? String(Math.min(1, k)) : '0';
  }

  // ---- 飞船方位罗盘（HUD 常驻指引） ----
  setShipCompass(angle, dist) {
    if (angle === null || dist === null) {
      if (!this._shipCompassHidden) {
        this._shipCompassHidden = true;
        this.shipCompassEl.classList.add('hidden');
      }
      return;
    }
    const deg = Math.round(angle * 180 / Math.PI);
    const meters = Math.round(dist);
    if (!this._shipCompassHidden && this._shipCompassDeg === deg && this._shipCompassDist === meters) return;
    this._shipCompassHidden = false;
    this._shipCompassDeg = deg;
    this._shipCompassDist = meters;
    this.shipCompassEl.classList.remove('hidden');
    this.shipCompassArrow.style.transform = `rotate(${deg}deg)`;
    this.shipCompassDist.textContent = meters + ' m';
  }

  // ---- 地表导航罗盘（步行航点：飞船/日志/异常点） ----
  setSurfaceCompass(angle, dist, label) {
    if (angle === null || dist === null) {
      if (!this._surfaceCompassHidden) {
        this._surfaceCompassHidden = true;
        this.surfaceCompassEl.classList.add('hidden');
      }
      return;
    }
    const deg = Math.round(angle * 180 / Math.PI);
    const meters = Math.round(dist);
    const text = label || '地表目标';
    if (!this._surfaceCompassHidden && this._surfaceCompassDeg === deg && this._surfaceCompassDist === meters && this._surfaceCompassLabel === text) return;
    this._surfaceCompassHidden = false;
    this._surfaceCompassDeg = deg;
    this._surfaceCompassDist = meters;
    this._surfaceCompassLabel = text;
    this.surfaceCompassEl.classList.remove('hidden');
    this.surfaceCompassArrow.style.transform = `rotate(${deg}deg)`;
    this.surfaceCompassLabel.textContent = text;
    this.surfaceCompassDist.textContent = meters + ' m';
  }

  // ---- 准星 ----
  setCrosshair(state, progress = 0) {
    this.crosshair.classList.toggle('targeting', state === 'target');
    this.crosshair.classList.toggle('mining', state === 'mining');
    const deg = Math.min(1, progress) * 360;
    this.mineProgress.style.background =
      `conic-gradient(var(--cyan) ${deg}deg, rgba(127,240,255,0.08) ${deg}deg)`;
  }
  setTooltip(text) {
    if (text) { this.tooltip.textContent = text; this.tooltip.classList.add('show'); }
    else this.tooltip.classList.remove('show');
  }

  // 准星下方常驻采矿工具档位（徒手/MkI/MkII·单格/区域）
  setToolMode(text) {
    if (!text) { this.toolMode.classList.add('hidden'); return; }
    this.toolMode.textContent = text;
    this.toolMode.classList.remove('hidden');
  }

  // 命中标记：能量弹命中敌人时四道短斜线向外弹一下
  hitmarker() {
    const el = this.el('hitmarker');
    if (!el) return;
    el.classList.remove('show');
    void el.offsetWidth; // 重启动画
    el.classList.add('show');
    clearTimeout(this._hitmarkerTimer);
    this._hitmarkerTimer = setTimeout(() => el.classList.remove('show'), 130);
  }

  // ---- 快捷栏 ----
  setItemIconMap(itemIcons, tileCanvases) {
    this.itemIcons = itemIcons;       // { itemId: tileIndex }
    this.tileCanvases = tileCanvases; // Map(tileIndex → canvas)
  }
  itemIconURL(itemId) {
    if (this.iconCache.has(itemId)) return this.iconCache.get(itemId);
    let url = '';
    if (this.itemIcons && this.tileCanvases) {
      const tile = this.itemIcons[itemId];
      if (tile !== undefined && this.tileCanvases.has(tile)) {
        url = this.tileCanvases.get(tile).toDataURL();
      }
    }
    this.iconCache.set(itemId, url);
    return url;
  }
  renderHotbar(slots, selected) {
    // slots: [{ itemId, count }] × 9
    let html = '';
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const sel = i === selected ? ' selected' : '';
      const key = i === 8 ? '0' : String(i + 1);
      if (s && s.itemId && s.count > 0) {
        const url = this.itemIconURL(s.itemId);
        html += `<div class="hb-slot${sel}" data-i="${i}"><span class="hb-key">${key}</span>${url ? `<img src="${url}" alt="">` : ''}<span class="hb-count">${s.count}</span></div>`;
      } else {
        html += `<div class="hb-slot${sel}" data-i="${i}"><span class="hb-key">${key}</span></div>`;
      }
    }
    this.hotbarEl.innerHTML = html;
    for (const el of this.hotbarEl.querySelectorAll('.hb-slot')) {
      el.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
    }
  }
  flashSlot(i) {
    const el = this.hotbarEl.querySelector(`.hb-slot[data-i="${i}"]`);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  // ---- 任务 ----
  // view: missionView() 输出（渐进显示：完成数 / 当前 / 后续 2 步 / 折叠计数）
  setMissions(view) {
    const lines = [];
    if (view.doneCount > 0) {
      lines.push(`<div class="mission-item done"><span class="mi-icon">✔</span><span>已完成 ${view.doneCount} 项</span></div>`);
    }
    const c = view.current;
    const cprog = c.progress ? `<span class="mi-count">${c.progress}</span>` : '';
    lines.push(`<div class="mission-item current"><span class="mi-icon">▶</span><span>${c.title}</span>${cprog}</div>`);
    for (const u of view.upcoming) {
      lines.push(`<div class="mission-item locked"><span class="mi-icon">🔒</span><span>${u.title}</span></div>`);
    }
    if (view.remaining > 0) {
      lines.push(`<div class="mission-item locked"><span class="mi-icon">…</span><span>后续目标 ×${view.remaining}</span></div>`);
    }
    this.missionList.innerHTML = lines.join('');
    if (this.missionsTitle) this.missionsTitle.textContent = `任务 // MISSIONS · ${view.doneCount}/${view.total}`;
  }
  setObjective(text, progressText = '') {
    this.objectiveText.textContent = text;
    this.objectiveProgress.textContent = progressText;
  }
  setActiveMission(text) {
    if (!text) { this.activeMission.classList.add('hidden'); return; }
    this.activeMission.textContent = '悬赏 · ' + text;
    this.activeMission.classList.remove('hidden');
  }
  setPlanetInfo({ name, time, pos }) {
    if (name !== undefined) this.planetName.textContent = name;
    if (time !== undefined) this.planetTime.textContent = `当地时间 ${time}`;
    if (pos !== undefined) this.planetPos.textContent = `坐标 ${pos}`;
  }

  // 当前所在星域 / 天体（宇宙导航的“我在哪里”）
  setRegion(text) {
    if (!text) { this.planetRegion.classList.add('hidden'); return; }
    this.planetRegion.classList.remove('hidden');
    this.planetRegion.textContent = text;
  }

  // ---- 状态条 ----
  setBars({ shield, health, life, hazard }) {
    const set = (k, v) => { if (v !== undefined) this.bars[k].style.width = Math.max(0, Math.min(100, v)) + '%'; };
    set('shield', shield); set('health', health); set('life', life); set('hazard', hazard);
  }

  // ---- 弹窗/消息 ----
  popup(itemName, count, itemId) {
    const el = document.createElement('div');
    el.className = 'popup';
    const url = this.itemIconURL(itemId);
    el.innerHTML = `${url ? `<img src="${url}" alt="">` : ''}<span>${itemName}</span><span class="pop-count">+${count}</span>`;
    this.popups.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }
  toast(text, warn = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (warn ? ' warn' : '');
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
  setInteractHint(text) {
    if (text) { this.interactHint.innerHTML = text; this.interactHint.classList.remove('hidden'); }
    else this.interactHint.classList.add('hidden');
  }

  // ---- 旅程完成 ----
  showJourney(v, stats) {
    this.journeyPanel.classList.toggle('hidden', !v);
    if (v && stats) {
      this.journeyStats.innerHTML =
        `已探索行星 <span>${stats.visited}</span> 颗 · 任务完成 <span>${stats.done}</span>/<span>${stats.total}</span><br/>` +
        `当前位于 <span>${stats.planet}</span>`;
    }
  }
  journeyVisible() { return !this.journeyPanel.classList.contains('hidden'); }
  // ---- 里程碑 ----
  showMilestones(v) { this.milestonesPanel.classList.toggle('hidden', !v); }
  milestonesVisible() { return !this.milestonesPanel.classList.contains('hidden'); }
  renderMilestones(defs, earned) {
    this.el('milestones-count').textContent = `${earned.size}/${defs.length}`;
    let html = '';
    for (const m of defs) {
      const on = earned.has(m.id);
      html += `<div class="milestone-item ${on ? 'earned' : 'locked'}">
        <span class="mi-icon">${on ? '★' : '🔒'}</span>
        <div class="mi-body"><div class="mi-name">${m.name}</div><div class="mi-desc">${m.desc}</div></div>
      </div>`;
    }
    this.milestonesList.innerHTML = html;
  }
  onMilestones(cb) {
    this.btnMilestones.addEventListener('click', cb);
    this.btnMilestones.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }
  onSort(cb) {
    this.btnSort.addEventListener('click', cb);
    this.btnSort.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }
  onExport(cb) {
    this.btnExport.addEventListener('click', cb);
    this.btnExport.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }
  onImport(cb) {
    this.btnImport.addEventListener('click', () => this.saveFileInput.click());
    this.btnImport.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
    this.saveFileInput.addEventListener('change', () => {
      const f = this.saveFileInput.files && this.saveFileInput.files[0];
      this.saveFileInput.value = '';
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => cb(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => cb(null);
      reader.readAsText(f);
    });
  }
  // 暂停菜单旅程概览：探索行星 / 信用点 / 里程碑 / 任务进度
  setPauseStats({ planets, credits, milestones, quests }) {
    this.pauseStats.innerHTML =
      `探索行星 <span>${planets}</span> 颗 · 信用点 <span>${credits}</span> · ` +
      `里程碑 <span>${milestones}</span> · 任务 <span>${quests}</span>`;
  }
  onJourneyClose(cb) {
    this.btnJourney.addEventListener('click', cb);
    this.btnJourney.addEventListener('mouseenter', () => window.__audioHover && window.__audioHover());
  }

  // ---- 反馈 ----
  shake() {
    document.body.classList.remove('shake');
    void document.body.offsetWidth;
    document.body.classList.add('shake');
  }
  hurtFlash() {
    document.body.classList.remove('hurt');
    void document.body.offsetWidth;
    document.body.classList.add('hurt');
  }

  // ---- 星图 ----
  showStarMap(v) { this.starmapPanel.classList.toggle('hidden', !v); }
  starMapVisible() { return !this.starmapPanel.classList.contains('hidden'); }

  // 多层级星图主视图：view 由 Game（结合 celestial 数据）构建。
  // nodes 使用画布坐标；UI 只负责绘制与命中检测，不做宇宙数据解释。
  renderStarMapView(view) {
    this.starmapViewNodes = view.nodes || [];
    // 面包屑：恒星级 → 恒星系统 → 行星系统 → 地表导航
    this.starmapCrumbStellar.textContent = '恒星级';
    this.starmapCrumbSystem.textContent = view.systemName || '恒星系统';
    const planetCrumb = view.planetName || null;
    this.starmapSep2.classList.toggle('hidden', !planetCrumb);
    this.starmapCrumbPlanet.classList.toggle('hidden', !planetCrumb);
    if (planetCrumb) this.starmapCrumbPlanet.textContent = planetCrumb;
    const surfaceCrumb = view.surfaceName || null;
    this.starmapSep3.classList.toggle('hidden', !surfaceCrumb);
    this.starmapCrumbSurface.classList.toggle('hidden', !surfaceCrumb);
    if (surfaceCrumb) this.starmapCrumbSurface.textContent = surfaceCrumb;
    this.starmapLevelLabel.textContent = view.levelLabel || view.title || '';
    this.starmapBackBtn.disabled = view.level === 'stellar';
    this.starmapListTitle.textContent = view.listTitle || '星域目标列表';
    this.starmapHint.textContent = view.hint || '[B] 关闭 · 点击轨道图节点选择 · 设定目标后跟随罗盘脉冲';

    // 详情面板
    const info = view.info || null;
    if (info) {
      this.starmapInfoTitle.textContent = info.title || '';
      this.starmapInfoFacts.innerHTML = (info.lines || []).map((l) =>
        `<span class="si-line${l.note ? ' si-note' : ''}">${l.text}</span>`).join('');
      this.starmapInfoActions.innerHTML = '';
      for (const act of info.actions || []) {
        const b = document.createElement('button');
        b.className = 'craft-btn' + (act.disabled ? ' disabled' : '');
        b.textContent = act.label;
        b.dataset.action = act.action;
        b.dataset.id = act.id || '';
        if (act.disabled) b.disabled = true;
        b.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
        b.addEventListener('click', () => {
          if (this.onStarMapAction) this.onStarMapAction(act.action, act.id || null);
        });
        this.starmapInfoActions.appendChild(b);
      }
    } else {
      this.starmapInfoTitle.textContent = '选择天体查看详情';
      this.starmapInfoFacts.innerHTML = '<span class="si-line">点击星图上的节点，或从下方列表选择。</span>';
      this.starmapInfoActions.innerHTML = '';
    }
    this.drawStarMap(view);
  }

  drawStarMap(view) {
    const cv = this.starmapCanvas;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = view.bg || '#04070f';
    ctx.fillRect(0, 0, W, H);

    // 远方恒星背景（确定性伪随机，营造真正星图感）
    let s = view.seed || 1;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const starCount = view.level === 'stellar' ? 220 : 150;
    for (let i = 0; i < starCount; i++) {
      const x = rnd() * W, y = rnd() * H;
      const a = 0.12 + rnd() * 0.5;
      const r = rnd() * 1.6 + 0.3;
      ctx.fillStyle = `rgba(190,215,255,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    if (view.level === 'stellar') {
      // 银河带：斜向带状星点，增强“恒星地图”感
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-0.5);
      const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, W * 0.62);
      grad.addColorStop(0, 'rgba(90,110,170,0.20)');
      grad.addColorStop(0.55, 'rgba(60,70,130,0.08)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(-W, -H, W * 2, H * 2);
      ctx.restore();
    }

    // 连线（如太阳 ↔ 比邻星的星际航线）
    for (const l of view.links || []) {
      ctx.strokeStyle = l.color || 'rgba(127,240,255,0.25)';
      ctx.lineWidth = l.width || 1;
      ctx.setLineDash(l.dash || []);
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
      ctx.setLineDash([]);
    }

    // 轨道环
    for (const o of view.orbits || []) {
      ctx.strokeStyle = o.color || 'rgba(127,240,255,0.16)';
      ctx.lineWidth = o.width || 1;
      ctx.setLineDash(o.dashed ? [3, 5] : []);
      ctx.beginPath(); ctx.arc(o.cx ?? W / 2, o.cy ?? H / 2, o.r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      if (o.label) {
        ctx.fillStyle = 'rgba(170,200,230,0.45)';
        ctx.font = '10px Consolas, monospace';
        ctx.fillText(o.label, (o.cx ?? W / 2) + o.r + 3, (o.cy ?? H / 2) - 3);
      }
    }

    // 天体节点
    for (const n of view.nodes || []) {
      const x = n.x, y = n.y, r = n.r || 7;
      const col = n.color || 0x7ff0ff;
      const css = `rgb(${(col >> 16) & 255},${(col >> 8) & 255},${col & 255})`;
      if (n.kind === 'star') {
        const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 3.2);
        glow.addColorStop(0, 'rgba(255,240,200,0.95)');
        glow.addColorStop(0.3, 'rgba(255,210,130,0.55)');
        glow.addColorStop(1, 'rgba(255,160,60,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = css;
      } else if (n.kind === 'station' || n.kind === 'gateway') {
        ctx.fillStyle = css;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(Math.PI / 4);
        ctx.fillRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
        ctx.restore();
      } else {
        ctx.fillStyle = css;
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (n.selected) {
        ctx.strokeStyle = 'rgba(127,240,255,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke();
      }
      if (n.current) {
        ctx.strokeStyle = '#eaffff';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2); ctx.stroke();
      }
      if (n.target) {
        ctx.strokeStyle = '#ffb84d';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, r + 9, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (n.label !== undefined && n.label !== null) {
        ctx.font = (n.kind === 'star' ? 'bold 13px' : '12px') + ' "Microsoft YaHei", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillText(n.label, x + 1, y - r - 8 + 1);
        ctx.fillStyle = n.target ? '#ffd27a' : 'rgba(225,242,255,0.95)';
        ctx.fillText(n.label, x, y - r - 8);
      }
    }
  }

  // 旧版列表式星图（兼容既有工具脚本与键盘流；保留数字 data-id）
  renderStarMap(planets, currentId, targetId, visited, extras = {}) {
    const { hasStation = false, gateways = [], extraRows = [] } = extras;
    let html = '';
    for (const p of planets) {
      const isCur = p.id === currentId;
      const isTarget = p.id === targetId || (p.navId && p.navId === targetId);
      const was = visited.has(p.id);
      const status = isCur ? '当前位置' : (was ? '已探索' : '未探索');
      const [r, g, b] = [(p.palette.surface[0] >> 16) & 255, (p.palette.surface[0] >> 8) & 255, p.palette.surface[0] & 255];
      const cls = 'starmap-row' + (isCur ? ' current' : '') + (isTarget ? ' target' : '');
      html += `<div class="${cls}" data-id="${p.id}">
        <div class="starmap-dot" style="background: rgb(${r},${g},${b});"></div>
        <div class="starmap-info">
          <div class="starmap-name">${p.name}</div>
          <div class="starmap-meta">${p.type} · ${status} · ${Number(p.aAU).toFixed(3)} AU</div>
        </div>
        ${isCur ? '<div class="craft-btn disabled">当前</div>'
          : `<button class="craft-btn" data-id="${p.id}">${isTarget ? '已设目标' : '设定目标'}</button>`}
      </div>`;
    }
    // 空间站条目（仅地球轨道可停靠）
    if (hasStation) {
      const isTarget = targetId === 100 || targetId === 'station:solar.earth';
      html += `<div class="starmap-row${isTarget ? ' target' : ''}" data-id="100">
        <div class="starmap-dot" style="background: rgb(127,240,255);"></div>
        <div class="starmap-info">
          <div class="starmap-name">地球轨道空间站</div>
          <div class="starmap-meta">人造设施 · 交易 / 任务 / 船坞</div>
        </div>
        <button class="craft-btn" data-id="100">${isTarget ? '已设目标' : '设定目标'}</button>
      </div>`;
    }
    // 跃迁门条目（跨星系）
    for (const gw of gateways) {
      const isTarget = targetId === gw.id || targetId === gw.navId;
      html += `<div class="starmap-row${isTarget ? ' target' : ''}" data-id="${gw.id}">
        <div class="starmap-dot" style="background: rgb(47,184,216);"></div>
        <div class="starmap-info">
          <div class="starmap-name">${gw.name}</div>
          <div class="starmap-meta">${gw.meta}</div>
        </div>
        ${gw.locked ? '<div class="craft-btn disabled">需大型飞船</div>'
          : `<button class="craft-btn" data-id="${gw.id}">${isTarget ? '已设目标' : '设定目标'}</button>`}
      </div>`;
    }
    // 统一模型新增节点（太阳 / 小行星带 / 卫星等）
    for (const row of extraRows) {
      const isTarget = targetId === row.id || targetId === row.navId;
      html += `<div class="starmap-row${isTarget ? ' target' : ''}" data-id="${row.id}">
        <div class="starmap-dot" style="background: rgb(${(row.color >> 16) & 255},${(row.color >> 8) & 255},${row.color & 255});"></div>
        <div class="starmap-info">
          <div class="starmap-name">${row.name}</div>
          <div class="starmap-meta">${row.meta}</div>
        </div>
        ${row.locked ? '<div class="craft-btn disabled">需大型飞船</div>'
          : `<button class="craft-btn" data-id="${row.id}">${isTarget ? '已设目标' : '设定目标'}</button>`}
      </div>`;
    }
    this.starmapList.innerHTML = html;
    for (const btn of this.starmapList.querySelectorAll('.craft-btn:not(.disabled)')) {
      btn.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
      btn.addEventListener('click', () => {
        if (this.onSelectTarget) this.onSelectTarget(btn.dataset.id);
      });
    }
  }

  // ---- 空间站面板 ----
  showStation(v) { this.stationPanel.classList.toggle('hidden', !v); }
  stationVisible() { return !this.stationPanel.classList.contains('hidden'); }

  renderStation({ tab, credits, inventory, sellTable, buyTable, orders, upgrades, owned, npcs, mission, missionCd, missionOffers, missionProgressText, creative = false }) {
    this.stationTab = tab;
    this.stationCreditsEl.textContent = credits;
    for (const b of this.stationTabs.querySelectorAll('button')) {
      b.classList.toggle('active', b.dataset.tab === tab);
    }
    const itemNames = (this.craftCtx && this.craftCtx.itemNames) || {};
    const nameOf = (id) => itemNames[id] || id;
    const icon = (id) => {
      const url = this.itemIconURL(id);
      return url ? `<img src="${url}" alt="">` : '';
    };
    const btn = (action, id, label, disabled = false) =>
      `<button class="craft-btn${disabled ? ' disabled' : ''}" data-action="${action}" data-id="${id}"${disabled ? ' disabled' : ''}>${label}</button>`;
    let html = '';
    if (tab === 'crew') {
      html += '<div class="station-section-label">站台人员</div>';
      for (const npc of npcs || []) {
        const last = npc.name.replace(/[^A-Za-z\u4e00-\u9fa5]/g, '').slice(-1) || '?';
        html += `<div class="station-row npc-row" data-npc="${npc.id}">
          <div class="npc-avatar" style="background:${npc.color};color:#04121a;">${last}</div>
          <div class="station-info"><div class="station-name">${npc.name}</div>
          <div class="station-meta">${npc.role}</div></div>
          <div class="station-btns"><button class="craft-btn" data-npc="${npc.id}">对话</button></div>
        </div>`;
      }
    } else if (tab === 'trade') {
      html += '<div class="station-section-label">出售资源（换信用点）</div>';
      for (const [id, price] of Object.entries(sellTable)) {
        const have = inventory.countOf(id);
        html += `<div class="station-row">${icon(id)}
          <div class="station-info"><div class="station-name">${nameOf(id)}</div>
          <div class="station-meta">持有 ${have} · 单价 ${price}</div></div>
          <div class="station-btns">${btn('sell1', id, '×1', have < 1)}${btn('sellAll', id, '全部', have < 1)}</div>
        </div>`;
      }
      html += '<div class="station-section-label">购买物资</div>';
      for (const [id, price] of Object.entries(buyTable)) {
        html += `<div class="station-row">${icon(id)}
          <div class="station-info"><div class="station-name">${nameOf(id)}</div>
          <div class="station-meta">单价 ${price} 信用点</div></div>
          <div class="station-btns">${btn('buy1', id, '购买')}</div>
        </div>`;
      }
    } else if (tab === 'orders') {
      html += '<div class="station-section-label">收购订单（可重复提交 · 每单 45 秒冷却）</div>';
      for (const o of orders) {
        const have = inventory.countOf(o.item);
        const cd = Math.max(0, o.cd || 0);
        const label = cd > 0 ? `冷却 ${Math.ceil(cd)}s` : '交付';
        const disabled = have < o.need || cd > 0;
        html += `<div class="station-row">${icon(o.item)}
          <div class="station-info"><div class="station-name">${o.label}</div>
          <div class="station-meta">交付 ${nameOf(o.item)} ${Math.min(have, o.need)}/${o.need} → ${o.reward} 信用点${cd > 0 ? ` · 冷却 ${Math.ceil(cd)}s` : ''}</div></div>
          <div class="station-btns">${btn('order', o.id, label, disabled)}</div>
        </div>`;
      }
    } else if (tab === 'missions') {
      html += '<div class="station-section-label">任务板（探索悬赏 / 送货 / 猎杀 / 采矿）</div>';
      if (creative) {
        html += '<div class="station-row"><div class="station-info"><div class="station-name">任务板不可用</div>';
        html += '<div class="station-meta">创造模式没有生存挑战，悬赏进度已冻结</div></div></div>';
        if (mission) {
          html += `<div class="station-row">
            <div class="station-info"><div class="station-name">进行中：${mission.label}</div>
            <div class="station-meta">${mission.desc} · ${missionProgressText || ''} · 赏金 ${mission.reward}</div></div>
            <div class="station-btns">${btn('mission_abandon', mission.id, '放弃', false)}</div>
          </div>`;
        }
      } else if (mission) {
        const prog = missionProgressText || '';
        html += `<div class="station-row">
          <div class="station-info"><div class="station-name">进行中：${mission.label}</div>
          <div class="station-meta">${mission.desc} · ${prog} · 赏金 ${mission.reward}</div></div>
          <div class="station-btns">${mission.kind === 'deliver' ? btn('mission_deliver', mission.id, '交付', false) : ''}${btn('mission_abandon', mission.id, '放弃', false)}</div>
        </div>`;
      } else {
        const cd = Math.max(0, missionCd || 0);
        for (const o of missionOffers || []) {
          const disabled = cd > 0;
          html += `<div class="station-row">
            <div class="station-info"><div class="station-name">${o.label}</div>
            <div class="station-meta">${o.desc} → ${o.reward} 信用点</div></div>
            <div class="station-btns">${btn('mission_accept', o.id, cd > 0 ? `冷却 ${Math.ceil(cd)}s` : '接受', disabled)}</div>
          </div>`;
        }
      }
    } else {
      html += '<div class="station-section-label">飞船船坞（升级永久生效）</div>';
      for (const u of upgrades) {
        const ownedUp = (u.engine && owned.engine >= u.engine)
          || (u.shield && owned.shield >= u.shield)
          || (u.bigship && owned.bigship);
        const poor = credits < u.cost;
        const need = !ownedUp && u.prereq && ((owned.engine || 0) < 2 || (owned.shield || 0) < 1);
        html += `<div class="station-row">
          <div class="station-info"><div class="station-name">${u.label}</div>
          <div class="station-meta">${u.desc}${u.prereq ? ' · ' + u.prereq : ''} · ${u.cost} 信用点${ownedUp ? ' · 已拥有' : ''}</div></div>
          <div class="station-btns">${btn('upgrade', u.id, ownedUp ? '已拥有' : '购买', ownedUp || poor || need)}</div>
        </div>`;
      }
    }
    this.stationBody.innerHTML = html;
    if (tab === 'crew') this.stationNpcs = npcs || [];
    for (const el of this.stationBody.querySelectorAll('.craft-btn:not(.disabled)')) {
      el.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
      el.addEventListener('click', () => {
        if (this.onStationAction) this.onStationAction(el.dataset.action, el.dataset.id, 1);
      });
    }
    // NPC：点击进入对话
    for (const el of this.stationBody.querySelectorAll('[data-npc]')) {
      el.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
      el.addEventListener('click', () => {
        if (this.onNpcClick) this.onNpcClick(el.dataset.npc);
        this.openNpcDialogue(el.dataset.npc);
      });
    }
  }

  // NPC 对话（空间站人员页；下一句循环 / 返回列表）
  openNpcDialogue(npcId) {
    const npc = (this.stationNpcs || []).find((n) => n.id === npcId);
    if (!npc) return;
    const idx = this.npcLineIdx[npcId] || 0;
    const line = npc.lines[idx % npc.lines.length];
    this.stationBody.innerHTML = `
      <div class="station-section-label">${npc.name} · ${npc.role}</div>
      <div class="npc-dialogue">${line}</div>
      <div class="station-btns npc-btns">
        <button class="craft-btn" data-npc-line="${npcId}">下一句</button>
        <button class="craft-btn" data-npc-back="1">返回</button>
      </div>`;
    const lineBtn = this.stationBody.querySelector('[data-npc-line]');
    lineBtn.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
    lineBtn.addEventListener('click', () => {
      this.npcLineIdx[npcId] = ((this.npcLineIdx[npcId] || 0) + 1) % npc.lines.length;
      this.openNpcDialogue(npcId);
      if (window.__audioHover) window.__audioHover();
    });
    const backBtn = this.stationBody.querySelector('[data-npc-back]');
    backBtn.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
    backBtn.addEventListener('click', () => {
      if (this.onStationTab) this.onStationTab('crew');
    });
  }

  // ---- 数据日志面板 ----
  showLog(v) { this.logPanel.classList.toggle('hidden', !v); }
  logVisible() { return !this.logPanel.classList.contains('hidden'); }

  renderLog(currentId, logs, collected) {
    let listHtml = '';
    for (const l of logs) {
      const got = collected.has(l.id);
      const cls = 'log-item' + (l.id === currentId ? ' current' : '') + (got ? ' got' : '');
      listHtml += `<div class="${cls}" data-log="${l.id}">${got ? '📄 ' + l.title : '❔ 未读取的日志'}</div>`;
    }
    this.logList.innerHTML = listHtml;
    const log = logs.find((l) => l.id === currentId);
    this.logText.innerHTML = log ? log.text.replace(/\n/g, '<br/>') : '';
    for (const el of this.logList.querySelectorAll('.log-item.got')) {
      el.addEventListener('click', () => {
        if (this.onLogSelect) this.onLogSelect(el.dataset.log);
      });
    }
  }

  // ---- 罗盘与跃迁闪屏 ----
  // distText: 已格式化的距离文本；etaText: 预计抵达时间（脉冲速度）
  setCompass(angle, distText, label = null, etaText = null) {
    if (angle === null || distText === null) {
      this.compassEl.classList.add('hidden');
      return;
    }
    this.compassEl.classList.remove('hidden');
    this.compassArrow.style.transform = `rotate(${(angle * 180 / Math.PI).toFixed(0)}deg)`;
    this.compassLabel.textContent = label || '目标';
    this.compassDist.textContent = typeof distText === 'string' ? distText : distText + ' u';
    this.compassEta.textContent = etaText ? `预计 ${etaText}` : '';
  }
  warpFlash(v) {
    this.warpFlashEl.classList.remove('hidden');
    void this.warpFlashEl.offsetWidth; // 重启动画
    if (v) {
      this.warpFlashEl.classList.remove('hidden');
    } else {
      // 动画结束后隐藏
      setTimeout(() => this.warpFlashEl.classList.add('hidden'), 1100);
    }
  }

  // ---- 背包面板 ----
  showBackpack(v) { this.invPanel.classList.toggle('hidden', !v); }
  backpackVisible() { return !this.invPanel.classList.contains('hidden'); }

  // 合成辅助函数与物品名（由 Game 注入，避免全局）
  setCraftContext(ctx) { this.craftCtx = ctx; }

  renderInventory(slots, selected) {
    let html = '';
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const isHotbar = i < 9;
      const cls = 'inv-slot' + (isHotbar ? ' hotbar' : '') + (isHotbar && i === selected ? ' selected' : '');
      const key = isHotbar ? `<span class="inv-key">${i === 8 ? '0' : i + 1}</span>` : '';
      if (s && s.itemId && s.count > 0) {
        const url = this.itemIconURL(s.itemId);
        html += `<div class="${cls}" data-i="${i}">${key}${url ? `<img src="${url}" alt="">` : ''}<span class="inv-count">${s.count}</span></div>`;
      } else {
        html += `<div class="${cls}" data-i="${i}">${key}</div>`;
      }
    }
    this.invGrid.innerHTML = html;
    for (const el of this.invGrid.querySelectorAll('.inv-slot')) {
      el.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
      el.addEventListener('click', () => {
        if (this.onSlotClick) this.onSlotClick(Number(el.dataset.i));
      });
    }
  }

  renderCrafting(recipes, inventory, focusId = null) {
    const { canCraft, missingOf, itemNames } = this.craftCtx;
    // 任务配方优先置顶：新玩家打开背包第一眼就看到"现在该合成什么"，
    // 而不是在 9 个配方里寻找当前目标。
    const ordered = focusId
      ? [...recipes].sort((a, b) => (a.id === focusId ? -1 : 0) - (b.id === focusId ? -1 : 0))
      : recipes;
    let html = '';
    for (const r of ordered) {
      const ok = canCraft(inventory, r);
      const missing = missingOf(inventory, r);
      const url = this.itemIconURL(r.out.item);
      let costHtml = '';
      for (const itemId of Object.keys(r.in)) {
        const need = r.in[itemId];
        const have = inventory.countOf(itemId);
        const lack = missing.some((m) => m.item === itemId);
        const name = itemNames[itemId] || itemId;
        costHtml += `<span class="${lack ? 'lack' : 'ok'}">${name} ${Math.min(have, need)}/${need}</span> `;
      }
      const focus = r.id === focusId;
      html += `<div class="craft-item${focus ? ' quest-focus' : ''}" data-recipe="${r.id}">
        ${url ? `<img src="${url}" alt="">` : ''}
        <div class="craft-info">
          <div class="craft-name">${focus ? '◈ ' : ''}${r.name}${focus ? ' <span class="craft-quest-badge">当前任务</span>' : ''}</div>
          <div class="craft-cost">${costHtml}</div>
        </div>
        <button class="craft-btn${ok ? '' : ' disabled'}" data-recipe="${r.id}">合成</button>
      </div>`;
    }
    this.craftList.innerHTML = html;
    for (const el of this.craftList.querySelectorAll('.craft-item')) {
      el.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
    }
    for (const btn of this.craftList.querySelectorAll('.craft-btn')) {
      if (btn.classList.contains('disabled')) continue;
      btn.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
      btn.addEventListener('click', () => {
        if (this.onCraftClick) this.onCraftClick(btn.dataset.recipe);
      });
    }
  }

  // ---- 维修面板 ----
  showRepair(v) { this.repairPanel.classList.toggle('hidden', !v); }
  repairVisible() { return !this.repairPanel.classList.contains('hidden'); }

  // ---- 储物箱面板 ----
  showStorage(v) { this.storagePanel.classList.toggle('hidden', !v); }
  storageVisible() { return !this.storagePanel.classList.contains('hidden'); }

  renderStorage(crate, inventory) {
    const nameOf = (id) => (this.craftCtx && this.craftCtx.itemNames && this.craftCtx.itemNames[id]) || id;
    const icon = (id) => {
      const url = this.itemIconURL(id);
      return url ? `<img src="${url}" alt="">` : '';
    };
    let html = '';
    for (let i = 0; i < crate.slots.length; i++) {
      const s = crate.slots[i];
      if (s && s.itemId && s.count > 0) {
        html += `<div class="storage-row">${icon(s.itemId)}
          <div class="storage-info"><div class="storage-name">${nameOf(s.itemId)}</div>
          <div class="storage-meta">${s.count}</div></div>
          <button class="craft-btn" data-action="take" data-i="${i}">取出</button>
        </div>`;
      } else {
        html += `<div class="storage-row empty"><div class="storage-info"><div class="storage-name">空位</div></div></div>`;
      }
    }
    this.storageTitle.textContent = `储物箱 // STORAGE · ${crate.slots.filter((s) => s && s.count).length}/12`;
    this.storageBody.innerHTML = html;
    for (const el of this.storageBody.querySelectorAll('.craft-btn')) {
      el.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
      el.addEventListener('click', () => {
        if (this.onStorageAction) this.onStorageAction(el.dataset.action, Number(el.dataset.i));
      });
    }
  }

  renderRepair(components, costs, inventory) {
    const { itemNames } = this.craftCtx;
    // components: [{ key, label, desc, ok, items: {itemId: count} }]
    let html = '';
    let allOk = true;
    for (const c of components) {
      const ok = c.ok;
      if (!ok) allOk = false;
      const itemRows = Object.entries(c.items).map(([itemId, count]) => {
        const have = inventory.countOf(itemId);
        const enough = have >= count;
        const name = itemNames[itemId] || itemId;
        return `<div class="repair-cost"><span class="${enough ? 'ok' : 'lack'}">${name} ${Math.min(have, count)}/${count}</span></div>`;
      }).join('');
      html += `<div class="repair-item">
        <div class="repair-status${ok ? ' ok' : ' repair-pulse'}"></div>
        <div class="repair-info">
          <div class="repair-name">${c.label}</div>
          <div class="repair-desc">${ok ? '状态正常' : c.desc}</div>
          ${ok ? '' : itemRows}
        </div>
        ${ok ? '<div class="repair-cost"><span class="ok">✔ 已修复</span></div>'
          : `<button class="craft-btn${c.canAfford ? '' : ' disabled'}" data-repair="${c.key}">修复</button>`}
      </div>`;
    }
    this.repairList.innerHTML = html;
    this.repairSub.textContent = allOk
      ? '所有系统已就绪 · 飞船可以起飞了'
      : '脉冲引擎 / 座舱玻璃 / 发射推进器受损 · 收集材料完成修复';
    for (const btn of this.repairList.querySelectorAll('.craft-btn')) {
      if (btn.classList.contains('disabled')) continue;
      btn.addEventListener('mouseenter', () => { if (window.__audioHover) window.__audioHover(); });
      btn.addEventListener('click', () => {
        if (this.onRepairClick) this.onRepairClick(btn.dataset.repair);
      });
    }
  }
}
