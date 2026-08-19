// 程序化音效引擎：全部声音由 WebAudio 实时合成（原创、零外部素材）。
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.muted = false;
    this.ambient = null; // { windGain, nightGain, windLfoGain }
    this._chirpTimer = null;
    this._night = false;
    this.musicRequested = null; // 手势前请求的音乐模式
    this.musicMode = null;
    this.musicOn = false;
    this.musicTimer = null;
    this.musicNodes = null;
    this.musicScale = null;
    this.nextNoteTime = 0;
  }

  // 必须在用户手势后调用
  ensureStarted() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6 * (this.sfxVol !== undefined ? this.sfxVol : 0.8);
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 8;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    // 音乐独立总线（与音效分离，可单独调音量）
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVol !== undefined ? this.musicVol : 0.6;
    this.musicBus.connect(this.master);
    // 白噪声缓冲
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbient();
    if (this.musicRequested) this.startMusic(this.musicRequested);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6 * (this.sfxVol !== undefined ? this.sfxVol : 0.8);
  }

  // 音量控制（设置面板）：音乐走独立总线，音效走 master；ctx 未建立时先记数值
  setMusicVolume(v) {
    this.musicVol = v;
    if (this.musicBus) this.musicBus.gain.value = v;
  }
  setSfxVolume(v) {
    this.sfxVol = v;
    if (this.master && !this.muted) this.master.gain.value = 0.6 * v;
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  // ---- 基础合成原语 ----
  noiseBurst({ dur = 0.1, type = 'lowpass', freq = 800, q = 1, gain = 0.2, attack = 0.005, rate = 1 }) {
    if (!this.ctx) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.15, gain = 0.15, attack = 0.005, curve = 'linear' }) {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== null) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
      else osc.frequency.linearRampToValueAtTime(freqEnd, t + dur);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  // ---- 音效 ----
  play(name, opts = {}) {
    if (!this.ctx) return;
    const r = () => 0.85 + Math.random() * 0.3;
    switch (name) {
      case 'footstep': {
        const freq = { dirt: 480, stone: 900, sand: 320, wood: 620, metal: 1500, leaf: 260, grass: 430 }[opts.surface || 'dirt'] || 500;
        this.noiseBurst({ dur: 0.09, freq: freq * r(), gain: 0.16, rate: r() });
        break;
      }
      case 'dig':
        this.noiseBurst({ dur: 0.06, type: 'bandpass', freq: 1000 * r(), q: 2, gain: 0.22 });
        break;
      case 'break': {
        const s = opts.surface || 'stone';
        if (s === 'wood') { this.noiseBurst({ dur: 0.16, freq: 520, gain: 0.3, rate: 0.9 }); this.noiseBurst({ dur: 0.1, type: 'bandpass', freq: 900, gain: 0.2 }); }
        else if (s === 'metal') { this.noiseBurst({ dur: 0.22, freq: 2000, gain: 0.26 }); this.tone({ type: 'square', freq: 160, freqEnd: 70, dur: 0.18, gain: 0.12 }); }
        else if (s === 'glass') { this.noiseBurst({ dur: 0.3, type: 'highpass', freq: 3000, gain: 0.3 }); this.noiseBurst({ dur: 0.15, type: 'bandpass', freq: 5200, gain: 0.25 }); }
        else if (s === 'plant') { this.noiseBurst({ dur: 0.12, type: 'highpass', freq: 1600, gain: 0.2 }); this.tone({ type: 'sine', freq: 500, freqEnd: 900, dur: 0.1, gain: 0.08 }); }
        else { this.noiseBurst({ dur: 0.16, freq: 260, gain: 0.32 }); this.tone({ type: 'sine', freq: 95, freqEnd: 45, dur: 0.16, gain: 0.16 }); }
        break;
      }
      case 'place':
        this.noiseBurst({ dur: 0.05, type: 'highpass', freq: 2000, gain: 0.14 });
        this.tone({ type: 'square', freq: 2600, freqEnd: 1400, dur: 0.05, gain: 0.05 });
        break;
      case 'click':
        this.tone({ type: 'square', freq: 820, freqEnd: 520, dur: 0.05, gain: 0.09 });
        break;
      case 'hover':
        this.tone({ type: 'sine', freq: 1350, dur: 0.035, gain: 0.035 });
        break;
      case 'popup':
        this.tone({ type: 'sine', freq: 640, dur: 0.07, gain: 0.07 });
        this.tone({ type: 'sine', freq: 960, dur: 0.1, gain: 0.07 });
        break;
      case 'select':
        this.tone({ type: 'square', freq: 500, freqEnd: 700, dur: 0.05, gain: 0.06 });
        break;
      case 'scan':
        this.tone({ type: 'sine', freq: 260, freqEnd: 1500, dur: 0.45, gain: 0.12, curve: 'exp' });
        this.noiseBurst({ dur: 0.45, type: 'bandpass', freq: 1200, q: 6, gain: 0.05 });
        break;
      case 'quest':
        this.tone({ type: 'sine', freq: 880, dur: 0.12, gain: 0.09 });
        this.tone({ type: 'sine', freq: 1318, dur: 0.22, gain: 0.09 });
        break;
      case 'warn':
        this.tone({ type: 'square', freq: 200, dur: 0.16, gain: 0.1 });
        this.tone({ type: 'square', freq: 160, dur: 0.16, gain: 0.1 });
        break;
      case 'land':
        this.noiseBurst({ dur: 0.14, freq: 220, gain: 0.3 });
        this.tone({ type: 'sine', freq: 80, freqEnd: 40, dur: 0.14, gain: 0.2 });
        break;
      case 'jump':
        this.noiseBurst({ dur: 0.05, type: 'bandpass', freq: 700, gain: 0.07 });
        break;
      case 'hurt':
        this.tone({ type: 'sawtooth', freq: 180, freqEnd: 90, dur: 0.2, gain: 0.14 });
        break;
      case 'explode':
        this.noiseBurst({ dur: 0.7, freq: 300, gain: 0.5 });
        this.noiseBurst({ dur: 0.4, type: 'highpass', freq: 900, gain: 0.3 });
        this.tone({ type: 'sine', freq: 70, freqEnd: 30, dur: 0.6, gain: 0.3 });
        break;
      case 'craft': {
        this.noiseBurst({ dur: 0.12, type: 'bandpass', freq: 1400, q: 3, gain: 0.16 });
        this.tone({ type: 'square', freq: 520, freqEnd: 780, dur: 0.09, gain: 0.07 });
        this.tone({ type: 'sine', freq: 1040, dur: 0.14, gain: 0.08 });
        this.noiseBurst({ dur: 0.25, type: 'highpass', freq: 3200, gain: 0.06 });
        break;
      }
      case 'repair': {
        this.noiseBurst({ dur: 0.09, type: 'bandpass', freq: 2200, q: 2, gain: 0.2 });
        this.tone({ type: 'square', freq: 240, freqEnd: 180, dur: 0.08, gain: 0.1 });
        this.noiseBurst({ dur: 0.12, type: 'bandpass', freq: 1800, q: 2, gain: 0.16 });
        this.tone({ type: 'triangle', freq: 660, freqEnd: 880, dur: 0.22, gain: 0.08 });
        break;
      }
      case 'deny':
        this.tone({ type: 'square', freq: 180, freqEnd: 120, dur: 0.14, gain: 0.08 });
        break;
      case 'takeoff':
        this.noiseBurst({ dur: 0.7, type: 'lowpass', freq: 700, gain: 0.3 });
        this.noiseBurst({ dur: 0.4, type: 'highpass', freq: 1500, gain: 0.2 });
        this.tone({ type: 'sawtooth', freq: 70, freqEnd: 140, dur: 0.7, gain: 0.18 });
        break;
      case 'landing':
        this.noiseBurst({ dur: 0.3, freq: 240, gain: 0.28 });
        this.tone({ type: 'sine', freq: 90, freqEnd: 40, dur: 0.25, gain: 0.2 });
        break;
      case 'enterShip':
        this.tone({ type: 'sine', freq: 300, freqEnd: 640, dur: 0.25, gain: 0.09 });
        this.noiseBurst({ dur: 0.2, type: 'bandpass', freq: 900, gain: 0.08 });
        break;
      case 'exitShip':
        this.tone({ type: 'sine', freq: 640, freqEnd: 300, dur: 0.25, gain: 0.09 });
        break;
      case 'warp':
        this.tone({ type: 'sine', freq: 200, freqEnd: 1800, dur: 0.9, gain: 0.16, curve: 'exp' });
        this.noiseBurst({ dur: 0.9, type: 'bandpass', freq: 1600, q: 2, gain: 0.1 });
        this.tone({ type: 'sawtooth', freq: 60, freqEnd: 220, dur: 0.9, gain: 0.1 });
        break;
      case 'spaceEnter':
        this.tone({ type: 'sine', freq: 320, freqEnd: 90, dur: 1.2, gain: 0.12 });
        this.noiseBurst({ dur: 1.0, type: 'highpass', freq: 900, gain: 0.06 });
        break;
      case 'blaster':
        this.tone({ type: 'sawtooth', freq: 950, freqEnd: 240, dur: 0.14, gain: 0.12 });
        this.noiseBurst({ dur: 0.1, type: 'highpass', freq: 2600, gain: 0.08 });
        break;
      case 'mobHurt':
        this.tone({ type: 'sawtooth', freq: 420, freqEnd: 180, dur: 0.22, gain: 0.1 });
        break;
      case 'mobAttack':
        this.tone({ type: 'sawtooth', freq: 130, freqEnd: 70, dur: 0.3, gain: 0.14 });
        this.noiseBurst({ dur: 0.18, freq: 300, gain: 0.1 });
        break;
      case 'mobDie':
        this.tone({ type: 'sawtooth', freq: 320, freqEnd: 60, dur: 0.5, gain: 0.1 });
        this.noiseBurst({ dur: 0.3, freq: 180, gain: 0.14 });
        break;
      case 'mobSpawn':
        this.tone({ type: 'sine', freq: 180, freqEnd: 90, dur: 0.4, gain: 0.05 });
        break;
      case 'uiOpen':
        this.tone({ type: 'sine', freq: 420, freqEnd: 720, dur: 0.12, gain: 0.07 });
        break;
      case 'uiClose':
        this.tone({ type: 'sine', freq: 720, freqEnd: 420, dur: 0.12, gain: 0.07 });
        break;
    }
  }

  // ---- 环境音 ----
  startAmbient() {
    if (!this.ctx || this.ambient) return;
    // 风声：循环噪声 → 低通 → 缓慢起伏增益
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const windGain = this.ctx.createGain();
    windGain.gain.value = 0;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain); lfoGain.connect(windGain.gain);
    src.connect(lp); lp.connect(windGain); windGain.connect(this.master);
    src.start(); lfo.start();

    // 夜间层（低沉嗡鸣 + 虫鸣，由 nightGain 控制）
    const nightSrc = this.ctx.createBufferSource();
    nightSrc.buffer = this.noiseBuf;
    nightSrc.loop = true;
    nightSrc.playbackRate.value = 0.5;
    const nlp = this.ctx.createBiquadFilter();
    nlp.type = 'bandpass';
    nlp.frequency.value = 900;
    nlp.Q.value = 0.6;
    const nightGain = this.ctx.createGain();
    nightGain.gain.value = 0;
    nightSrc.connect(nlp); nlp.connect(nightGain); nightGain.connect(this.master);
    nightSrc.start();

    this.ambient = { windGain, nightGain, lfoGain };
    this._chirpTimer = setInterval(() => {
      if (this._night && this.ctx) this._chirp();
    }, 2600);
  }

  _chirp() {
    if (Math.random() < 0.45) return;
    const base = 600 + Math.random() * 700;
    this.tone({ type: 'sine', freq: base, freqEnd: base * 1.5, dur: 0.25, gain: 0.02 });
    if (Math.random() < 0.4) this.tone({ type: 'sine', freq: base * 1.4, freqEnd: base, dur: 0.3, gain: 0.015 });
  }

  // windLevel / nightLevel ∈ [0,1]，每帧调用做平滑
  setAmbient(windLevel, nightLevel) {
    if (!this.ambient) return;
    const t = this.now();
    this.ambient.windGain.gain.setTargetAtTime(0.05 + windLevel * 0.13, t, 0.5);
    this.ambient.lfoGain.gain.setTargetAtTime(0.012 + windLevel * 0.03, t, 0.5);
    this.ambient.nightGain.gain.setTargetAtTime(nightLevel * 0.05, t, 0.8);
    this._night = nightLevel > 0.4;
  }

  // ---- 洞穴环境：风声压低 + 滴水 ----
  setCaveMode(v) {
    if (this._cave === v) return;
    this._cave = v;
    if (!this.ambient) return;
    const t = this.now();
    this.ambient.windGain.gain.setTargetAtTime(v ? 0.02 : 0.12, t, 0.8);
    if (v && !this._dripTimer) {
      this._dripTimer = setInterval(() => {
        if (this._cave && this.ctx && Math.random() < 0.75) {
          // 滴水：短促高频双音 + 轻微延迟回响
          const f = 1400 + Math.random() * 900;
          this.tone({ type: 'sine', freq: f, freqEnd: f * 0.7, dur: 0.06, gain: 0.05 });
          this.tone({ type: 'sine', freq: f * 1.4, freqEnd: f, dur: 0.08, gain: 0.03 });
        }
      }, 1800);
    }
  }

  // ---- 飞船引擎循环声 ----
  startEngine() {
    if (!this.ctx || this.engine) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 52;
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 26;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    noise.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(lp); osc2.connect(lp); noise.connect(lp);
    lp.connect(gain); gain.connect(this.master);
    osc.start(); osc2.start(); noise.start();
    this.engine = { gain, lp, osc, osc2 };
  }

  // throttle ∈ [0,1]
  setEngine(throttle) {
    if (!this.engine) return;
    const t = this.now();
    const k = Math.max(0, Math.min(1, throttle));
    this.engine.gain.gain.setTargetAtTime(k * 0.22, t, 0.12);
    this.engine.lp.frequency.setTargetAtTime(240 + k * 900, t, 0.15);
    this.engine.osc.frequency.setTargetAtTime(50 + k * 34, t, 0.2);
  }

  stopEngine() {
    if (!this.engine) return;
    const t = this.now();
    this.engine.gain.gain.setTargetAtTime(0, t, 0.25);
    const e = this.engine;
    setTimeout(() => {
      try { e.osc.stop(); e.osc2.stop(); } catch { /* 已停止 */ }
    }, 800);
    this.engine = null;
  }

  // ---- 背景音乐（程序化氛围乐：持续低音垫 + 稀疏琶音） ----
  // 浏览器自动播放策略：AudioContext 首次建立必须在用户手势之后，
  // 故 setMusicMode 先记录请求，ensureStarted()（手势触发）后真正开播。
  setMusicMode(mode) {
    this.musicRequested = mode;
    if (this.ctx) this.startMusic(mode);
  }

  startMusic(mode) {
    if (!this.ctx || (this.musicOn && this.musicMode === mode)) return;
    this.stopMusic();
    this.musicMode = mode;
    this.musicOn = true;
    this.musicNodes = [];
    // 低音垫：三个失谐振荡器 → 共享低通（慢速 LFO 开合）→ 低音量
    const root = mode === 'menu' ? 55 : 65.41; // A1 / C2
    const padGain = this.ctx.createGain();
    padGain.gain.value = 0.05;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 0.7;
    for (const [det, type] of [[0, 'sawtooth'], [3.5, 'sawtooth'], [7, 'triangle']]) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = root + det * 0.5;
      osc.connect(lp);
      osc.start();
      this.musicNodes.push(osc);
    }
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.06;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 150;
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
    lfo.start();
    lp.connect(padGain); padGain.connect(this.musicBus || this.master);
    this.musicNodes.push(lfo, lp, padGain);
    // 琶音调度器：以 AudioContext 时间前瞻排音符（lookahead 0.8s）
    this.musicScale = mode === 'menu' ? [220, 261.63, 329.63, 392, 440] : [130.81, 164.81, 196, 246.94, 261.63, 329.63];
    this.nextNoteTime = this.ctx.currentTime + 0.3;
    this.scheduleMusic();
  }

  scheduleMusic() {
    if (!this.musicOn || !this.ctx) return;
    while (this.nextNoteTime < this.ctx.currentTime + 0.9) {
      if (Math.random() < 0.72) {
        const f = this.musicScale[Math.floor(Math.random() * this.musicScale.length)];
        this.musicNote(f, this.nextNoteTime);
      }
      this.nextNoteTime += 1.1 + Math.random() * 1.1;
    }
    this.musicTimer = setTimeout(() => this.scheduleMusic(), 350);
  }

  musicNote(f, t) {
    if (!this.ctx) return;
    for (const [mult, type, gain, dur] of [[1, 'sine', 0.035, 2.3], [2, 'triangle', 0.012, 2.0]]) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * mult;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      osc.connect(g); g.connect(this.musicBus || this.master);
      osc.start(t); osc.stop(t + dur + 0.05);
    }
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer) { clearTimeout(this.musicTimer); this.musicTimer = null; }
    if (this.musicNodes) {
      for (const n of this.musicNodes) {
        try { n.stop(); } catch { /* 无 stop（增益/滤波节点） */ }
        try { n.disconnect(); } catch { /* 已断开 */ }
      }
      this.musicNodes = null;
    }
    this.musicMode = null;
  }
}
