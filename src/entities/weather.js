// 天气系统：沙暴/暴雪——横扫粒子 + 屏幕滤镜 + 危险防护加速消耗（行星差异化）
export class Weather {
  constructor(game) {
    this.game = game;
    this.weather = { kind: 'none', freq: 0, dur: 0 };
    this.baseBadge = null;  // 行星环境危险标签（无风暴时显示）
    this.stormActive = false;
    this.stormLeft = 0;
    this.intensity = 0;   // 0..1 平滑强度
    this.timer = 15;      // 天气判定倒计时
    this.streakTimer = 0;
    this.lastBadge = '';
  }

  // 切换行星时设置该星天气配置与环境徽章
  setPlanet(weather, baseBadge = null) {
    this.weather = weather || { kind: 'none', freq: 0, dur: 0 };
    this.baseBadge = baseBadge;
    if (this.weather.kind === 'none') {
      this.stormActive = false;
      this.stormLeft = 0;
      this.timer = 15;
    }
  }

  // 危险防护倍率（风暴中 1 → 2.5）
  get stormK() { return 1 + this.intensity * 1.5; }
  get inStorm() { return this.stormActive && this.intensity > 0.15; }

  update(dt, playerPos) {
    const g = this.game;
    // 驾驶飞船时风暴淡出（太空中无地表天气）
    if (g.flight && g.flight.piloting) {
      this.intensity = Math.max(0, this.intensity - dt * 0.6);
      g.ui.setWeather('none', 0);
      this.setBadge(null);
      return;
    }
    if (!this.weather || this.weather.kind === 'none') {
      this.intensity = Math.max(0, this.intensity - dt * 0.5);
      g.ui.setWeather('none', 0);
      this.setBadge(null);
      return;
    }
    // 风暴随机循环：每 8~18 秒判定一次
    this.timer -= dt;
    if (!this.stormActive && this.timer <= 0) {
      this.timer = 8 + Math.random() * 10;
      if (Math.random() < this.weather.freq * 0.08) this.startStorm();
    }
    if (this.stormActive) {
      this.stormLeft -= dt;
      if (this.stormLeft <= 0) this.endStorm();
    }
    const target = this.stormActive ? 1 : 0;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-0.8 * dt));
    this.setBadge(this.inStorm ? (this.weather.kind === 'snow' ? '暴雪中' : '沙暴中') : this.baseBadge);

    // 横扫粒子（风沙/雪花）
    if (this.intensity > 0.15) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) {
        this.streakTimer = 0.07;
        const r = 16 + Math.random() * 14;
        const a = Math.random() * Math.PI * 2;
        const x = playerPos.x + Math.cos(a) * r;
        const z = playerPos.z + Math.sin(a) * r;
        const y = playerPos.y + 1 + Math.random() * 10;
        const isSnow = this.weather.kind === 'snow';
        g.particles.spawnBurst(x, y, z, isSnow ? 0xe8f2f8 : 0xd8a85a, {
          count: 2, speed: 7, up: 0, life: 0.5, size: isSnow ? 0.07 : 0.11,
          gravity: 0, spread: 0.2, jitter: 2.5,
        });
      }
    }
    g.ui.setWeather(this.weather.kind, this.intensity);
  }

  setBadge(text) {
    if (text === this.lastBadge) return;
    this.lastBadge = text;
    this.game.ui.setEnvBadge(text);
  }

  startStorm() {
    if (!this.weather || this.weather.kind === 'none') return;
    this.stormActive = true;
    this.stormLeft = (this.weather.dur || 40) * (0.7 + Math.random() * 0.6);
    const g = this.game;
    g.audio.play('warn');
    g.ui.toast(this.weather.kind === 'snow' ? '暴雪来袭 · 危险防护加速消耗' : '沙暴来袭 · 危险防护加速消耗', true);
  }

  endStorm() {
    this.stormActive = false;
    this.stormLeft = 0;
  }
}
