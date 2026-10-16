/* 复用小零件 */

import { html, raw, esc, LEVEL_INFO } from './utils.js';

/** 环形健康分 */
export function scoreRing(score, caption = '健康分', size = 118) {
  const pct = Math.max(0, Math.min(100, Number(score) || 0));
  const r = 44;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return html`
    <div class="ring${size < 90 ? ' ring--sm' : ''}" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 110 110">
        <circle class="ring__track" cx="55" cy="55" r="${r}"></circle>
        <circle
          class="ring__fill"
          cx="55"
          cy="55"
          r="${r}"
          stroke-dasharray="${c.toFixed(1)}"
          stroke-dashoffset="${c.toFixed(1)}"
          data-ring-fill
          data-offset="${offset.toFixed(1)}"
        ></circle>
      </svg>
      <div class="ring__center">
        <div>
          <div class="ring__pct" data-ring-pct data-to="${pct}">0</div>
          <div class="ring__cap">${caption}</div>
        </div>
      </div>
    </div>
  `;
}

/** 让页面上的环动起来 */
export function animateRings(root) {
  // 关了动画偏好的人直接看最终值，别让数字和环从 0 爬上来
  const reduce =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduce) {
    root.querySelectorAll('[data-ring-fill]').forEach((el) => {
      el.style.strokeDashoffset = el.dataset.offset;
    });
    root.querySelectorAll('[data-ring-pct]').forEach((el) => {
      el.textContent = Math.round(Number(el.dataset.to) || 0);
    });
    return;
  }

  root.querySelectorAll('[data-ring-fill]').forEach((el) => {
    requestAnimationFrame(() => {
      el.style.strokeDashoffset = el.dataset.offset;
    });
  });
  root.querySelectorAll('[data-ring-pct]').forEach((el) => {
    const to = Number(el.dataset.to) || 0;
    const start = performance.now();
    const dur = 1000;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** AI 分析结果块 */
export function analysisBlock(a) {
  if (!a) return raw('');
  const lv = LEVEL_INFO[a.level] || LEVEL_INFO.good;
  return raw(html`
    <div class="analysis mt-12">
      <div class="analysis__head">
        ${raw(scoreRing(a.score, '健康分', 96))}
        <div class="grow">
          <div class="row row--wrap" style="gap:6px">
            <span class="badge badge--${lv.cls}">${lv.emoji} ${lv.label}</span>
            ${a.kcal ? raw(`<span class="badge">约 ${a.kcal} kcal</span>`) : ''}
            ${a.protein ? raw(`<span class="badge">蛋白 ${a.protein}g</span>`) : ''}
          </div>
          <div class="bold mt-8" style="font-size:14px;line-height:1.5">${a.summary || ''}</div>
        </div>
      </div>

      ${a.pros?.length
        ? raw(html`
            <ul class="analysis__list">
              ${raw(a.pros.map((t) => `<li><span>💚</span><span>${esc(t)}</span></li>`).join(''))}
            </ul>
          `)
        : ''}
      ${a.cons?.length
        ? raw(html`
            <ul class="analysis__list">
              ${raw(a.cons.map((t) => `<li><span>⚠️</span><span>${esc(t)}</span></li>`).join(''))}
            </ul>
          `)
        : ''}
      ${a.advice?.length
        ? raw(html`
            <ul class="analysis__list">
              ${raw(a.advice.map((t) => `<li><span>💡</span><span>${esc(t)}</span></li>`).join(''))}
            </ul>
          `)
        : ''}
      ${a.swap?.from && a.swap?.to
        ? raw(html`
            <div class="analysis__swap">
              🔄 把「${a.swap.from}」换成「${a.swap.to}」会更好哦
            </div>
          `)
        : ''}
      ${a.encourage ? raw(html`<div class="analysis__cheer">${a.encourage}</div>`) : ''}
    </div>
  `);
}

/** AI 没配好时的提示条 */
export function aiHint(state) {
  if (state.ai?.enabled && state.ai?.configured) return raw('');
  return raw(html`
    <div class="badge badge--meh" style="font-size:11.5px">
      ${state.ai?.enabled ? 'AI 网关还没填完整' : 'AI 小助手还没打开'}
    </div>
    <div class="tiny muted mt-8">
      去「我的 → AI 小助手」里填上网关地址、密钥和模型名，就能让它帮你分析吃的啦～
    </div>
  `);
}

/** 空状态 */
export function emptyState({ emoji = '🌸', text = '', sub = '', action = null } = {}) {
  return raw(html`
    <div class="empty">
      <span class="empty__mascot">${emoji}</span>
      <div class="empty__text">${text}</div>
      ${sub ? raw(html`<div class="empty__sub">${sub}</div>`) : ''}
      ${action ? raw(html`<button class="btn btn--primary btn--sm mt-12" data-act="${action.act}">${action.label}</button>`) : ''}
    </div>
  `);
}
