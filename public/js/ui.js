/* 通用交互：吐司、抽屉、弹窗、撒花、数字滚动 */

import { html, qs, raw, esc } from './utils.js';

/* ---------------- Toast ---------------- */

let toastHost = null;

export function toast(message, type = 'info', ms = 2600) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    document.body.appendChild(toastHost);
  }
  const icons = { ok: '✅', err: '🥺', info: '💬' };
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  node.innerHTML = html`<span>${icons[type] || '💬'}</span><span>${message}</span>`;
  toastHost.appendChild(node);
  setTimeout(() => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 300);
  }, ms);
  return node;
}

export const toastOk = (m, ms) => toast(m, 'ok', ms);
export const toastErr = (m, ms) => toast(m, 'err', ms ?? 3400);
export const toastInfo = (m, ms) => toast(m, 'info', ms);

/* ---------------- 抽屉 ---------------- */

/** 从底部弹出面板。content 是 HTML 字符串，返回 { close, root } */
export function openSheet({ title = '', emoji = '', content = '', onMount } = {}) {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = html`
    <div class="sheet__handle"></div>
    ${title ? raw(html`<div class="sheet__title">${emoji ? raw(`<span>${esc(emoji)}</span>`) : ''}${title}</div>`) : ''}
    <div class="sheet__body">${raw(content)}</div>
  `;
  document.body.appendChild(mask);
  document.body.appendChild(sheet);
  document.body.style.overflow = 'hidden';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    mask.classList.add('is-closing');
    sheet.classList.add('is-closing');
    document.body.style.overflow = '';
    setTimeout(() => {
      mask.remove();
      sheet.remove();
    }, 280);
  };

  mask.addEventListener('click', close);
  if (onMount) onMount(sheet, close);
  return { close, root: sheet };
}

/* ---------------- 弹窗 ---------------- */

export function openModal({ content = '', onMount, closable = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  const box = document.createElement('div');
  box.className = 'modal__box';
  box.innerHTML = content;
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    box.classList.add('is-closing');
    document.body.style.overflow = '';
    setTimeout(() => wrap.remove(), 260);
  };

  if (closable) {
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) close();
    });
  }
  if (onMount) onMount(box, close);
  return { close, root: box };
}

export function confirmDialog({ title = '确定吗？', desc = '', okText = '确定', cancelText = '再想想', danger = false }) {
  return new Promise((resolve) => {
    const { close } = openModal({
      content: html`
        <div style="font-size:38px;line-height:1;margin-bottom:8px">${danger ? '🥺' : '🤔'}</div>
        <div style="font-size:17px;font-weight:800">${title}</div>
        ${desc ? raw(html`<div class="soft tiny mt-8">${desc}</div>`) : ''}
        <div class="sheet__actions" style="margin-top:18px">
          <button class="btn btn--plain" data-x="no">${cancelText}</button>
          <button class="btn ${danger ? 'btn--primary' : 'btn--primary'}" data-x="yes">${okText}</button>
        </div>
      `,
      onMount(box) {
        qs('[data-x="no"]', box).onclick = () => {
          close();
          resolve(false);
        };
        qs('[data-x="yes"]', box).onclick = () => {
          close();
          resolve(true);
        };
      },
    });
    setTimeout(() => {
      if (!document.body.contains(document.querySelector('.modal'))) resolve(false);
    }, 60000);
  });
}

/* ---------------- 撒花 ---------------- */

const CONFETTI_COLORS = ['#ff8fb1', '#ffb7c7', '#ffcfa8', '#ffe9a8', '#9fe0c4', '#cbb8ff', '#a9d8ff'];

let confettiCanvas = null;
let confettiCtx = null;
let confettiParticles = [];
let confettiRunning = false;

function ensureConfetti() {
  if (!confettiCanvas) {
    confettiCanvas = document.createElement('canvas');
    confettiCanvas.className = 'confetti-canvas';
    document.body.appendChild(confettiCanvas);
    confettiCtx = confettiCanvas.getContext('2d');
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      confettiCanvas.width = innerWidth * dpr;
      confettiCanvas.height = innerHeight * dpr;
      confettiCanvas.style.width = innerWidth + 'px';
      confettiCanvas.style.height = innerHeight + 'px';
      confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener('resize', resize);
  }
  return { canvas: confettiCanvas, ctx: confettiCtx };
}

/** 撒一把彩色纸片 */
export function confetti({ count = 120, originX = 0.5, originY = 0.42, spread = 1 } = {}) {
  const { ctx } = ensureConfetti();
  for (let i = 0; i < count; i++) {
    const angle = (-Math.PI / 2 + (Math.random() - 0.5) * 2.4 * spread);
    const speed = 5 + Math.random() * 11;
    confettiParticles.push({
      x: innerWidth * originX + (Math.random() - 0.5) * 60,
      y: innerHeight * originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 7,
      h: 5 + Math.random() * 8,
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.32,
      life: 1,
      shape: Math.random() < 0.28 ? 'circle' : 'rect',
    });
  }
  if (!confettiRunning) {
    confettiRunning = true;
    requestAnimationFrame(tickConfetti);
  }
}

function tickConfetti() {
  const { ctx } = ensureConfetti();
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  confettiParticles = confettiParticles.filter((p) => p.life > 0 && p.y < innerHeight + 60);
  for (const p of confettiParticles) {
    p.vy += 0.32;
    p.vx *= 0.992;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 0.0055;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
  }
  if (confettiParticles.length) {
    requestAnimationFrame(tickConfetti);
  } else {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    confettiRunning = false;
  }
}

/* ---------------- emoji 粒子 ---------------- */

/** 从一个坐标往外飞出一堆小 emoji */
export function emojiBurst(x, y, emojis = ['💖', '✨', '🌸', '⭐'], count = 12) {
  for (let i = 0; i < count; i++) {
    const node = document.createElement('span');
    node.className = 'emoji-burst';
    node.textContent = emojis[(Math.random() * emojis.length) | 0];
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 130;
    node.style.left = x + 'px';
    node.style.top = y + 'px';
    node.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    node.style.setProperty('--dy', `${Math.sin(angle) * dist - 60}px`);
    node.style.setProperty('--rot', `${(Math.random() - 0.5) * 220}deg`);
    node.style.animation = `heart-fly ${700 + Math.random() * 500}ms cubic-bezier(0.22,0.61,0.36,1) forwards`;
    node.style.fontSize = 14 + Math.random() * 14 + 'px';
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 1400);
  }
}

/** 从一个元素中心冒出 emoji */
export function burstFrom(el, emojis, count) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  emojiBurst(r.left + r.width / 2, r.top + r.height / 2, emojis, count);
}

/* ---------------- 庆祝弹窗 ---------------- */

export function celebrate({ emoji = '🎉', title = '太棒啦！', desc = '', button = '好耶', confettiCount = 130 } = {}) {
  confetti({ count: confettiCount });
  setTimeout(() => confetti({ count: 60, originX: 0.22, originY: 0.5, spread: 0.7 }), 260);
  setTimeout(() => confetti({ count: 60, originX: 0.78, originY: 0.5, spread: 0.7 }), 420);

  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'celebrate';
    wrap.innerHTML = html`
      <div class="celebrate__card">
        <span class="celebrate__emoji">${emoji}</span>
        <div class="celebrate__title">${title}</div>
        ${desc ? raw(html`<div class="celebrate__desc">${desc}</div>`) : ''}
        <button class="btn btn--primary btn--block mt-16" data-x="ok">${button}</button>
      </div>
    `;
    document.body.appendChild(wrap);
    const done = () => {
      wrap.remove();
      resolve(true);
    };
    qs('[data-x="ok"]', wrap).onclick = done;
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) done();
    });
    setTimeout(done, 9000);
  });
}

/* ---------------- 批量解锁成就 ---------------- */

/**
 * 一次解锁好几个成就时，用一个弹窗一起展示，
 * 免得连弹 12 次把页面刷爆。
 */
export function celebrateBatch(items = []) {
  confetti({ count: 140 });
  setTimeout(() => confetti({ count: 70, originX: 0.2, originY: 0.55, spread: 0.7 }), 280);
  setTimeout(() => confetti({ count: 70, originX: 0.8, originY: 0.55, spread: 0.7 }), 460);

  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'celebrate';
    wrap.innerHTML = html`
      <div class="celebrate__card">
        <span class="celebrate__emoji is-badge-in">🏅</span>
        <div class="celebrate__title">解锁了 ${items.length} 个新成就！</div>
        <div class="celebrate__desc">你做的每一件小事，都被记下来了</div>
        <div class="unlock-list">
          ${raw(
            items
              .map(
                (a, i) => html`
                  <div class="unlock-item" style="animation-delay:${120 + i * 70}ms">
                    <span class="unlock-item__emoji">${a.emoji}</span>
                    <div>
                      <div class="unlock-item__name">${a.name}</div>
                      <div class="unlock-item__desc">${a.desc}</div>
                    </div>
                  </div>
                `,
              )
              .join(''),
          )}
        </div>
        <button class="btn btn--primary btn--block mt-16" data-x="ok">全部收下 🎀</button>
      </div>
    `;
    document.body.appendChild(wrap);
    const done = () => {
      wrap.remove();
      resolve(true);
    };
    qs('[data-x="ok"]', wrap).onclick = done;
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) done();
    });
    setTimeout(done, 14000);
  });
}

/* ---------------- 数字滚动 ---------------- */

export function countUp(el, to, { from = 0, dur = 900, digits = 1 } = {}) {
  if (!el) return;
  const start = performance.now();
  const target = Number(to) || 0;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    const v = from + (target - from) * ease(t);
    el.textContent = digits === 0 ? Math.round(v) : v.toFixed(digits);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = digits === 0 ? String(Math.round(target)) : target.toFixed(digits);
  }
  requestAnimationFrame(frame);
}

/* ---------------- 元素反馈 ---------------- */

export function shake(el) {
  if (!el) return;
  el.classList.remove('is-shake');
  void el.offsetWidth;
  el.classList.add('is-shake');
  setTimeout(() => el.classList.remove('is-shake'), 500);
}

export function popNumber(el) {
  if (!el) return;
  el.classList.remove('is-number-pop');
  void el.offsetWidth;
  el.classList.add('is-number-pop');
}

/** 按钮变成 loading，返回恢复函数 */
export function withLoading(btn, text = '处理中') {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span><span>${esc(text)}</span>`;
  return () => {
    btn.innerHTML = original;
    btn.disabled = wasDisabled;
  };
}
