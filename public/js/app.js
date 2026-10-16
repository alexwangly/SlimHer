/* 应用入口：启动、登录、外壳、路由 */

import { state, reload } from './state.js';
import { api, setUnauthorizedHandler, ApiError } from './api.js';
import { NAV_ROUTES, ROUTES, routeMeta, setRouter, currentRoute, go, routeParams } from './router.js';
import { toastErr, toastOk, celebrate, celebrateBatch } from './ui.js';
import { qs, html, raw, esc, greeting } from './utils.js';

import * as homeView from './views/home.js';
import * as weightView from './views/weight.js';
import * as foodView from './views/food.js';
import * as decideView from './views/decide.js';
import * as checkinView from './views/checkin.js';
import * as meView from './views/me.js';
import * as reportView from './views/report.js';

const VIEWS = {
  home: homeView,
  weight: weightView,
  food: foodView,
  decide: decideView,
  checkin: checkinView,
  me: meView,
  report: reportView,
};

const appEl = qs('#app');
const bootEl = qs('#boot');

/* ------------------------------------------------------------------ */
/* 背景飘浮的小东西                                                     */
/* ------------------------------------------------------------------ */

function makeBubbles() {
  const host = qs('#bubbles');
  if (!host) return;
  const emojis = ['🍓', '🌸', '💗', '✨', '🎀', '🫧', '🍑', '🌷', '⭐', '🧁'];
  const n = window.innerWidth < 600 ? 10 : 16;
  host.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.textContent = emojis[(Math.random() * emojis.length) | 0];
    s.style.left = Math.random() * 100 + '%';
    s.style.fontSize = 12 + Math.random() * 16 + 'px';
    s.style.animationDuration = 16 + Math.random() * 18 + 's';
    s.style.animationDelay = -Math.random() * 30 + 's';
    s.style.opacity = '0';
    host.appendChild(s);
  }
}

/* ------------------------------------------------------------------ */
/* 登录                                                                */
/* ------------------------------------------------------------------ */

function showLogin(message = '') {
  appEl.innerHTML = html`
    <div class="main" style="padding-top:60px">
      <div class="view">
        <div class="card card--hero center">
          <div style="font-size:56px;line-height:1;animation:sway 3s var(--ease-in-out) infinite">🔒</div>
          <div class="bold mt-12" style="font-size:19px">小米的小日记本</div>
          <div class="tiny muted mt-8">${message || '输入口令才能进去哦～'}</div>
          <div class="field mt-16" style="text-align:left">
            <input class="input" type="password" data-pass placeholder="口令" autocomplete="current-password" />
          </div>
          <button class="btn btn--primary btn--block btn--lg" data-login>进去看看 🍓</button>
        </div>
      </div>
    </div>
  `;
  const input = qs('[data-pass]', appEl);
  const btn = qs('[data-login]', appEl);
  input.focus();
  const submit = async () => {
    if (!input.value) return;
    btn.disabled = true;
    try {
      await api.login(input.value);
      toastOk('欢迎回来～');
      await start();
    } catch (err) {
      toastErr(err.message);
      input.value = '';
      input.focus();
      input.classList.remove('is-shake');
      void input.offsetWidth;
      input.classList.add('is-shake');
    } finally {
      btn.disabled = false;
    }
  };
  btn.onclick = submit;
  input.onkeydown = (e) => e.key === 'Enter' && submit();
}

/* ------------------------------------------------------------------ */
/* 外壳                                                                */
/* ------------------------------------------------------------------ */

function mountShell() {
  const p = state.db?.profile || {};
  appEl.innerHTML = html`
    <header class="topbar">
      <div class="topbar__title">
        <span class="emoji" data-top-emoji>🍓</span>
        <span data-top-title>小米减肥日记</span>
      </div>
      <div class="topbar__spacer"></div>
      <div class="topbar__sub" data-top-sub></div>
      <button class="topbar__avatar" data-avatar-btn title="我的">${p.avatar || '🐱'}</button>
    </header>
    <main class="main" id="view"></main>
    <nav class="bottom-nav" id="nav">
      ${raw(
        NAV_ROUTES.map(
          (r) => html`
            <button class="nav-item" data-nav="${r.key}">
              <span class="nav-item__icon">${r.icon}</span>
              <span>${r.label}</span>
            </button>
          `,
        ).join(''),
      )}
    </nav>
  `;

  qs('#nav', appEl).addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (b) go(b.dataset.nav);
  });
  qs('[data-avatar-btn]', appEl).onclick = () => go('me');
}

/* ------------------------------------------------------------------ */
/* 成就解锁庆祝                                                        */
/* ------------------------------------------------------------------ */

let celebrating = false;

async function celebrateAchievements() {
  if (celebrating) return;
  let data;
  try {
    data = await api.achievements();
  } catch {
    return; // 成就算不出来不该影响正常使用
  }
  const newly = data?.newly || [];
  if (!newly.length) return;

  celebrating = true;
  try {
    // 一次解锁好几个就打包弹一次，只解锁一两个才逐个弹
    if (newly.length >= 3) {
      await celebrateBatch(newly);
    } else {
      for (const a of newly) {
        await celebrate({ emoji: a.emoji, title: `解锁成就：${a.name}`, desc: a.desc, button: '收下啦 🎀' });
      }
    }
    await api.achievementsSeen(newly.map((a) => a.key)).catch(() => {});
    state.__achCount = data.unlockedCount;
    // 我的页面正开着的话，勋章墙要跟着亮起来
    if (state.route === 'me') renderRoute('me');
  } finally {
    celebrating = false;
  }
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

const ctx = {
  async refresh() {
    await reload();
    await renderRoute(state.route);
    celebrateAchievements();
  },
  async rerender() {
    await renderRoute(state.route);
  },
};

let rendering = false;

async function renderRoute(route) {
  if (rendering) return;
  rendering = true;
  try {
    state.route = route;
    const meta = routeMeta(route);

    // 顶栏
    qs('[data-top-title]', appEl).textContent = route === 'home' ? '小米减肥日记' : meta.label;
    qs('[data-top-emoji]', appEl).textContent = route === 'home' ? '🍓' : meta.icon;
    const avatarBtn = qs('[data-avatar-btn]', appEl);
    if (avatarBtn) {
      avatarBtn.textContent = state.db?.profile?.avatar || '🐱';
      avatarBtn.classList.toggle('is-active', route === 'me');
    }
    const st = state.stats || {};
    qs('[data-top-sub]', appEl).innerHTML = st.streak ? `🔥 连续 ${st.streak} 天` : '';

    // 导航高亮
    appEl.querySelectorAll('[data-nav]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.nav === route);
    });

    const viewHost = qs('#view', appEl);
    // 出场动画
    const old = viewHost.firstElementChild;
    if (old) old.classList.add('is-leaving');
    await new Promise((r) => setTimeout(r, old ? 90 : 0));

    viewHost.innerHTML = '';
    const mod = VIEWS[route] || VIEWS.home;
    await mod.render(viewHost, ctx);
    window.scrollTo({ top: 0, behavior: 'auto' });
  } catch (err) {
    console.error(err);
    const viewHost = qs('#view', appEl);
    if (viewHost) {
      viewHost.innerHTML = html`
        <div class="view">
          <div class="card center">
            <div style="font-size:44px">🥺</div>
            <div class="bold mt-8">这一页出问题了</div>
            <div class="tiny muted mt-8">${err.message}</div>
            <button class="btn btn--primary btn--sm mt-16" onclick="location.reload()">刷新一下</button>
          </div>
        </div>
      `;
    }
    toastErr(err.message);
  } finally {
    rendering = false;
  }
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function start() {
  try {
    await reload();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      showLogin();
      return;
    }
    bootEl.classList.add('is-gone');
    appEl.innerHTML = html`
      <div class="main" style="padding-top:60px">
        <div class="card center">
          <div style="font-size:46px">🥺</div>
          <div class="bold mt-8">连不上后端</div>
          <div class="tiny muted mt-8">${err.message}</div>
          <div class="tiny muted mt-8">确认一下 <code>node server/index.mjs</code> 有没有在跑</div>
        </div>
      </div>
    `;
    return;
  }

  makeBubbles();
  mountShell();
  state.route = currentRoute();
  await renderRoute(state.route);
  bootEl.classList.add('is-gone');
  setTimeout(() => bootEl.remove(), 400);
  // 启动时看一眼有没有需要庆祝的新成就
  setTimeout(celebrateAchievements, 900);
}

setUnauthorizedHandler(() => {
  showLogin('登录状态过期啦，再输一次口令～');
});

setRouter((route, params) => {
  const target = route || currentRoute();
  if (params && Object.keys(params).length) {
    location.hash = `#/${target}?${new URLSearchParams(params)}`;
    return;
  }
  renderRoute(target);
});

window.addEventListener('hashchange', () => {
  const r = currentRoute();
  if (r !== state.route) renderRoute(r);
});

window.addEventListener('resize', () => {
  const c = document.querySelector('canvas[data-chart]');
  if (c && c.__miRedraw) c.__miRedraw();
});

start();
