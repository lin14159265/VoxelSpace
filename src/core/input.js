// 输入管理：键盘/鼠标/滚轮/指针锁定
import { KEY } from './constants.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressedSet = new Set();
    this.pressedAge = new Map();      // code → 到达帧号（过期自动清除）
    this.mouseDownSet = new Set();
    this.mousePressedSet = new Set();
    this.mousePressedAge = new Map(); // button → 到达帧号
    this.age = 0;
    this.mouseDX = 0; this.mouseDY = 0;
    this.wheelDelta = 0;
    this.locked = false;
    this.lockGrace = 0;      // 重新锁定后丢弃的前几个移动事件（浏览器可能报告一次光标跳变）
    this.droppedJumps = 0;   // 被夹紧/丢弃的异常大增量计数（调试用）
    this.onLockChange = null;
    this.onGesture = null;   // 任何用户手势（按键/点击）回调——用于重锁兜底

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Tab/Space 的默认滚动/聚焦行为；Escape 的默认动作包括退出浏览器全屏——
      // 页面能收到 Esc 的场合（面板打开/暂停/未锁状态）必须拦截，
      // 否则"按 Esc 关面板"会顺手把浏览器全屏也退掉（历史 bug：Esc 泄漏到浏览器）
      if (e.code === 'Tab' || e.code === 'Space' || e.code === 'Escape') e.preventDefault();
      this.down.add(e.code);
      this.pressedSet.add(e.code);
      this.pressedAge.set(e.code, this.age);
      if (this.onGesture) this.onGesture('key', e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    canvas.addEventListener('mousedown', (e) => {
      this.mouseDownSet.add(e.button);
      this.mousePressedSet.add(e.button);
      this.mousePressedAge.set(e.button, this.age);
      if (this.onGesture) this.onGesture('mouse', e.button);
    });
    window.addEventListener('mouseup', (e) => this.mouseDownSet.delete(e.button));

    canvas.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // 重新锁定后的前几帧：浏览器可能报告一次"光标位置跳变"的超大增量
      if (this.lockGrace > 0) { this.lockGrace--; return; }
      // 单事件增量夹紧：合法甩动 < ~450px/事件；超出的异常跳变按上限截断，
      // 防止视角偶发 180° 瞬转（历史 bug：无界输入增量）
      const CLAMP = 450;
      let mx = e.movementX, my = e.movementY;
      if (mx > CLAMP) mx = CLAMP; else if (mx < -CLAMP) mx = -CLAMP;
      if (my > CLAMP) my = CLAMP; else if (my < -CLAMP) my = -CLAMP;
      if (Math.abs(mx) >= CLAMP || Math.abs(my) >= CLAMP) this.droppedJumps++;
      this.mouseDX += mx;
      this.mouseDY += my;
    });

    canvas.addEventListener('wheel', (e) => {
      if (this.locked) this.wheelDelta += Math.sign(e.deltaY);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.lockGrace = 2; // 忽略重锁后的前 2 个移动事件
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      if (this.onLockChange) this.onLockChange(false);
    });
  }

  requestLock() {
    // 自动化/无头环境（Playwright 等会置 navigator.webdriver=true）：
    // Chromium 在 Windows 上实现 pointer lock 时会用 SetCursorPos 移动
    // 系统鼠标（锁定时移到窗口中心、解锁时移回原位置），无头测试会因此
    // 抢走用户真实鼠标。测试脚本已经直接设置 input.locked=true，无需真实锁。
    if (navigator.webdriver === true) return;
    // 页面不可见/失焦时不请求：后台标签页即使拿到锁也无法正常游戏，
    // 还会与用户正在使用的窗口争抢系统光标。
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    try {
      const r = this.canvas.requestPointerLock();
      // 非用户手势/浏览器冷却时会拒绝；静默捕获，由 onGesture 手势兜底重锁
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* 指针锁不可用（如无头环境） */ }
  }
  exitLock() { if (this.locked) document.exitPointerLock(); }

  isDown(code) { return this.down.has(code); }
  pressed(code) { return this.pressedSet.has(code); }
  mouseDown(btn) { return this.mouseDownSet.has(btn); }
  mousePressed(btn) { return this.mousePressedSet.has(btn); }

  // 边沿触发事件在固定步长循环（每帧最多 6 步）中会被重复读取；
  // 消费语义保证"按一次只生效一次"（历史 bug：单次右键连续放置多个方块）
  consume(code) { this.pressedSet.delete(code); this.pressedAge.delete(code); }
  consumeMouse(btn) { this.mousePressedSet.delete(btn); this.mousePressedAge.delete(btn); }

  takeMouseDelta() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    // 帧级兜底夹紧（多事件累积的异常总量）
    const cap = 600;
    if (Math.abs(d.x) > cap) d.x = Math.sign(d.x) * cap;
    if (Math.abs(d.y) > cap) d.y = Math.sign(d.y) * cap;
    return d;
  }
  takeWheel() { const w = this.wheelDelta; this.wheelDelta = 0; return w; }

  // 面板转换时清空"边沿事件"：陈旧按键（如开修理面板期间的 E）存活最多 2 帧，
  // 若不清理，面板关闭并重锁指针后会被游戏循环读到 → 误触重开面板/连放方块。
  // 不清理 down/mouseDownSet：保持按住 W 行走等持续输入的连续性。
  clearTransients() {
    this.pressedSet.clear();
    this.pressedAge.clear();
    this.mousePressedSet.clear();
    this.mousePressedAge.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  // 帧尾：只清除"已过期"的边沿事件。高刷新率显示器上单帧可能没有固定步长
  // （rawDt < 1/60 → steps=0），此时按下的事件必须存活到下一帧，否则会被整帧
  // 清空而丢失（历史 bug 类：边沿输入在 0 步帧被丢弃 → 按键偶发失灵）。
  // 事件最多存活 2 帧：既保证 0 步帧不丢输入，也保证菜单态下的陈旧按键自动过期。
  endFrame() {
    this.age++;
    for (const [code, a] of this.pressedAge) {
      if (this.age - a > 1) { this.pressedAge.delete(code); this.pressedSet.delete(code); }
    }
    for (const [btn, a] of this.mousePressedAge) {
      if (this.age - a > 1) { this.mousePressedAge.delete(btn); this.mousePressedSet.delete(btn); }
    }
  }
}
