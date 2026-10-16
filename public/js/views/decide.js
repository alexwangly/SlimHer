import { html, raw, esc, fmtKg, SLOTS, MOODS, slotOf, weightedPick, qs, qsa } from '../utils.js';
import { state, foods, profile } from '../state.js';
import { api } from '../api.js';
import { toastOk, toastErr, openSheet, withLoading, burstFrom, confetti, confirmDialog } from '../ui.js';

function D() {
  if (!state.__decide) {
    state.__decide = { slot: 'lunch', moods: [], avoid: '', budget: '', result: null, mode: 'wheel' };
  }
  return state.__decide;
}

export async function render(root, ctx) {
  const d = D();
  const pool = foods().filter((f) => f.slots.includes(d.slot));

  root.innerHTML = html`
    <div class="view">
      <!-- 条件 -->
      <div class="card card--hero">
        <div class="card__title">
          🎡 今天吃什么呀
          <span class="hint">别纠结啦，交给运气和 AI</span>
        </div>

        <div class="field">
          <label class="field__label">哪一餐</label>
          <div class="chips" data-slot>
            ${raw(
              SLOTS.map(
                (s) =>
                  `<button class="chip ${s.key === d.slot ? 'is-on' : ''}" data-s="${s.key}">${s.emoji} ${s.name}</button>`,
              ).join(''),
            )}
          </div>
        </div>

        <div class="field">
          <label class="field__label">现在什么状态（可多选）</label>
          <div class="chips" data-moods>
            ${raw(
              MOODS.map(
                (m) =>
                  `<button class="chip chip--soft ${d.moods.includes(m.key) ? 'is-on' : ''}" data-m="${m.key}">${m.emoji} ${m.label}</button>`,
              ).join(''),
            )}
          </div>
        </div>

        <div class="field">
          <label class="field__label">不想吃 / 不能吃（可选）</label>
          <input class="input" data-avoid placeholder="比如：今天不想再吃鸡蛋了" value="${d.avoid}" maxlength="40" />
        </div>

        <div class="field">
          <label class="field__label">这一餐的热量预算（可选）</label>
          <input class="input" data-budget type="number" inputmode="numeric" placeholder="比如 500" value="${d.budget}" />
        </div>

        <div class="row" style="gap:10px">
          <button class="btn btn--plain grow" data-mode="wheel">🎡 转盘</button>
          <button class="btn btn--plain grow" data-mode="slot">🎰 老虎机</button>
          <button class="btn btn--primary grow" data-mode="ai">🤖 问 AI</button>
        </div>
        <div class="tiny muted center mt-8">候选 ${pool.length} 种 · 可以在下面自己加爱吃的</div>
      </div>

      <!-- 舞台 -->
      <div class="card" data-stage></div>

      <!-- 食物库 -->
      <div class="card">
        <div class="card__title">
          🧺 我的食物库
          <span class="hint">${foods().length} 种</span>
        </div>
        <div class="chips">
          ${raw(
            pool
              .slice(0, 24)
              .map(
                (f) =>
                  `<span class="chip">${esc(f.name)}${f.kcal ? `<span class="tiny muted"> ${f.kcal}k</span>` : ''}</span>`,
              )
              .join('') || '<span class="tiny muted">这一餐还没有候选，加几个吧～</span>',
          )}
        </div>
        <button class="btn btn--ghost btn--sm btn--block mt-12" data-manage>✏️ 管理食物库</button>
      </div>
    </div>
  `;

  /* ---- 条件绑定 ---- */
  qs('[data-slot]', root).onclick = (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    d.slot = b.dataset.s;
    d.result = null;
    ctx.rerender();
  };

  qs('[data-moods]', root).onclick = (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    const k = b.dataset.m;
    d.moods = d.moods.includes(k) ? d.moods.filter((x) => x !== k) : [...d.moods, k];
    b.classList.toggle('is-on');
  };

  const avoid = qs('[data-avoid]', root);
  avoid.oninput = () => (d.avoid = avoid.value);

  const budget = qs('[data-budget]', root);
  budget.oninput = () => (d.budget = budget.value);

  root.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.mode;
      if (mode === 'wheel') spinWheel(btn.closest('.card').parentElement, btn);
      else if (mode === 'slot') spinSlot(root, btn);
      else askAi(root, btn);
    };
  });

  const manage = qs('[data-manage]', root);
  manage.onclick = () => openLibrary(ctx);

  /* ---- 已有结果就画出来 ---- */
  const stage = qs('[data-stage]', root);
  if (d.result) {
    stage.innerHTML = resultBlock(d.result, d.slot);
    wireResult(stage, d, ctx);
    confetti({ count: 40, originY: 0.3 });
  } else {
    stage.innerHTML = html`
      <div class="empty">
        <span class="empty__mascot">🤔</span>
        <div class="empty__text">还没决定吃什么</div>
        <div class="empty__sub">选好上面的条件，然后点转盘、老虎机，或者直接问 AI</div>
      </div>
    `;
  }

  /* ---------------- 转盘 ---------------- */

  async function spinWheel(_stage, btn) {
    const list = pickPool(d.slot, 10);
    if (list.length < 2) {
      toastErr('候选太少啦，先去食物库加几个吧～');
      return;
    }
    const stage = qs('[data-stage]', root);
    stage.innerHTML = wheelHtml(list);
    const wheel = qs('.wheel', stage);

    const seg = 360 / list.length;
    const winnerIndex = Math.floor(Math.random() * list.length);
    const winner = list[winnerIndex];
    const turns = 5 + Math.floor(Math.random() * 2);
    const target = 360 * turns - (winnerIndex * seg + seg / 2);

    // 先重置到 0
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    void wheel.offsetWidth;
    wheel.style.transition = 'transform 4.6s cubic-bezier(0.17, 0.72, 0.12, 1)';
    wheel.classList.add('is-spinning');
    requestAnimationFrame(() => {
      wheel.style.transform = `rotate(${target}deg)`;
    });

    btn.disabled = true;
    await new Promise((r) => setTimeout(r, 4750));
    wheel.classList.remove('is-spinning');
    btn.disabled = false;

    d.result = { type: 'random', name: winner.name, kcal: winner.kcal, tag: winner.tag };
    showResultWin(stage, d.result, d.slot, ctx, wheel);
  }

  function wheelHtml(list) {
    const seg = 360 / list.length;
    const colors = ['#ffd0dd', '#ffe6c9', '#d8f3e6', '#dcd2ff', '#ffe9a8', '#cfdfff', '#ffd9e8', '#e2f6d8'];
    const stops = list
      .map((_, i) => `${colors[i % colors.length]} ${(i * seg).toFixed(2)}deg ${((i + 1) * seg).toFixed(2)}deg`)
      .join(', ');
    const R = 96;
    const labels = list
      .map((f, i) => {
        const a = i * seg + seg / 2;
        return `<span class="wheel__label" style="transform:translate(-50%,-50%) rotate(${a.toFixed(2)}deg) translateY(-${R}px)">${esc(
          f.name.length > 7 ? f.name.slice(0, 7) : f.name,
        )}</span>`;
      })
      .join('');
    return html`
      <div class="wheel-stage">
        <div class="wheel-pointer">🔻</div>
        <div class="wheel" style="background:conic-gradient(${raw(stops)})">
          ${raw(labels)}
          <div class="wheel__hub">🍽️</div>
        </div>
      </div>
      <div class="center tiny muted mt-8">转呀转呀，看看今天是什么～</div>
    `;
  }

  /* ---------------- 老虎机 ---------------- */

  async function spinSlot(rootEl, btn) {
    const list = pickPool(d.slot, 10);
    if (list.length < 2) {
      toastErr('候选太少啦，先去食物库加几个吧～');
      return;
    }
    const stage = qs('[data-stage]', rootEl);
    const winner = list[Math.floor(Math.random() * list.length)];

    const cycles = 5;
    const reels = [];
    for (let c = 0; c < cycles; c++) reels.push(...shuffle(list));
    const lastCycle = reels.slice((cycles - 1) * list.length);
    const winIdx = Math.max(0, lastCycle.findIndex((f) => f.id === winner.id));
    const targetIndex = (cycles - 1) * list.length + winIdx;

    stage.innerHTML = html`
      <div class="center bold mb-8" style="font-size:15px">🎰 今天吃……</div>
      <div class="slot" data-slot-box>
        <div class="slot__reel" data-reel>
          ${raw(reels.map((f) => `<div class="slot__item">${esc(f.name)}</div>`).join(''))}
        </div>
      </div>
    `;
    const reel = qs('[data-reel]', stage);
    const box = qs('[data-slot-box]', stage);
    const itemH = 74;

    function spin(dur = 3300) {
      const start = performance.now();
      const ease = (t) => 1 - Math.pow(1 - t, 4);
      function frame(now) {
        const t = Math.min(1, (now - start) / dur);
        reel.style.transform = `translateY(${-targetIndex * itemH * ease(t)}px)`;
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    btn.disabled = true;
    spin();
    await new Promise((r) => setTimeout(r, 3450));
    btn.disabled = false;
    box.classList.add('is-win');
    confetti({ count: 70, originY: 0.42, spread: 0.8 });

    d.result = { type: 'random', name: winner.name, kcal: winner.kcal, tag: winner.tag };
    setTimeout(() => showResultWin(stage, d.result, d.slot, ctx), 500);
  }

  /* ---------------- 问 AI ---------------- */

  async function askAi(rootEl, btn) {
    if (!state.ai.enabled || !state.ai.configured) {
      toastErr('AI 还没配好，去「我的 → AI 小助手」填一下网关～');
      return;
    }
    const stage = qs('[data-stage]', rootEl);
    stage.innerHTML = html`
      <div class="thinking">
        <div class="spinner spinner--pink"></div>
        <span>小助手正在替你纠结中</span>
        <span class="thinking__dots"><span></span><span></span><span></span></span>
      </div>
      <div class="tiny muted center mt-12">正在翻菜谱、算热量、想你会不会开心…</div>
    `;
    const restore = withLoading(btn, 'AI 想想');
    try {
      const { decision } = await api.decide({
        slot: d.slot,
        moods: d.moods,
        avoid: d.avoid,
        budgetKcal: Number(d.budget) || undefined,
      });
      d.result = { type: 'ai', ...decision };
      stage.innerHTML = resultBlock(d.result, d.slot);
      wireResult(stage, d, ctx);
      confetti({ count: 60, originY: 0.34 });
      burstFrom(btn, ['🤖', '💖', '✨'], 10);
    } catch (err) {
      stage.innerHTML = html`
        <div class="empty">
          <span class="empty__mascot">🥺</span>
          <div class="empty__text">AI 没回答上来</div>
          <div class="empty__sub">${err.message}</div>
        </div>
      `;
      toastErr(err.message);
    } finally {
      restore();
    }
  }

  /* ---------------- 转盘出结果 ---------------- */

  function showResultWin(stage, result, slotKey, ctxRef, wheelEl) {
    const box = document.createElement('div');
    box.className = 'mt-16';
    box.innerHTML = html`
      <div class="pick-card is-badge-in center">
        <div class="tiny muted">今天就吃</div>
        <div class="pick-card__name" style="justify-content:center;font-size:22px;margin-top:4px">
          ${result.name}
        </div>
        ${result.kcal ? raw(html`<div class="tiny muted mt-8">约 ${result.kcal} kcal</div>`) : ''}
        <div class="row mt-16" style="gap:10px">
          <button class="btn btn--plain grow" data-again>🔄 再抽一次</button>
          <button class="btn btn--primary grow" data-accept>✅ 就吃这个</button>
        </div>
      </div>
    `;
    stage.appendChild(box);
    stage.querySelector('[data-again]').onclick = () => spinWheel(stage, document.createElement('button'));
    wireAccept(stage, result, slotKey, ctxRef);
  }

  function wireResult(stage, dd, slotKey) {
    wireAccept(stage, dd.result, slotKey, ctx);
    stage.querySelectorAll('[data-again]').forEach((b) => {
      b.onclick = () => {
        const wasAi = dd.result?.type === 'ai';
        dd.result = null;
        if (wasAi) askAi(root, b);
        else spinWheel(stage, b);
      };
    });
  }

  function wireAccept(stage, result, slotKey, ctxRef) {
    stage.querySelectorAll('[data-accept]').forEach((btn) => {
      btn.onclick = async () => {
        const restore = withLoading(btn, '记下来');
        try {
          const idx = Number(btn.dataset.pick || 0);
          const pick = result.picks?.[idx] || result.picks?.[0];
          const name = result.name || pick?.name || '今天吃的';
          const kcal = result.kcal ?? pick?.kcal;
          await api.addMeal({
            date: state.today,
            slot: slotKey,
            text: kcal ? `${name}（约 ${kcal} kcal）` : name,
          });
          await ctxRef.refresh();
          toastOk(`好耶，${name} 记下啦～`);
          confetti({ count: 80 });
        } catch (err) {
          toastErr(err.message);
        } finally {
          restore();
        }
      };
    });
  }
}

/* ---------------- 结果渲染 ---------------- */

function resultBlock(result, slotKey) {
  if (result.type === 'random') {
    return html`
      <div class="pick-card is-badge-in center">
        <div class="tiny muted">转盘选中了</div>
        <div class="pick-card__name" style="justify-content:center;font-size:22px;margin-top:4px">${result.name}</div>
        ${result.kcal ? raw(html`<div class="tiny muted mt-8">约 ${result.kcal} kcal</div>`) : ''}
        <div class="row mt-16" style="gap:10px">
          <button class="btn btn--plain grow" data-again>🔄 再抽一次</button>
          <button class="btn btn--primary grow" data-accept>✅ 就吃这个</button>
        </div>
      </div>
    `;
  }

  if (!result.picks?.length) {
    return html`
      <div class="empty">
        <span class="empty__mascot">🤖</span>
        <div class="empty__text">AI 没给出建议</div>
        <div class="empty__sub">换个条件再问问看～</div>
      </div>
    `;
  }

  return html`
    <div class="card__title">🤖 小助手帮你选好了</div>
    <div class="stagger">
      ${raw(
        result.picks
          .map(
            (p, i) => html`
              <div class="pick-card" style="margin-bottom:10px">
                <div class="pick-card__name">
                  <span>${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>${p.name}
                  ${p.kcal ? raw(`<span class="badge" style="margin-left:auto">${p.kcal} kcal</span>`) : ''}
                </div>
                ${p.reason ? raw(html`<div class="pick-card__reason">${p.reason}</div>`) : ''}
                ${p.tip ? raw(html`<div class="pick-card__tip">💡 ${p.tip}</div>`) : ''}
                <button class="btn btn--ghost btn--sm btn--block mt-8" data-accept data-pick="${i}">
                  ✅ 就吃这个
                </button>
              </div>
            `,
          )
          .join(''),
      )}
    </div>
    ${result.combo ? raw(html`<div class="analysis__swap">🍽️ ${result.combo}</div>`) : ''}
    ${result.avoidToday ? raw(html`<div class="tiny muted mt-8">🚫 ${result.avoidToday}</div>`) : ''}
    ${result.cheer ? raw(html`<div class="analysis__cheer">${result.cheer}</div>`) : ''}
  `;
}

/* ---------------- 工具 ---------------- */

function pickPool(slotKey, n) {
  const pool = foods().filter((f) => f.slots.includes(slotKey));
  if (pool.length <= n) return shuffle(pool);
  // 权重抽样，不放回
  const out = [];
  const bag = [...pool];
  while (out.length < n && bag.length) {
    const pick = weightedPick(bag);
    out.push(pick);
    bag.splice(bag.indexOf(pick), 1);
  }
  return out;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------- 食物库管理 ---------------- */

function openLibrary(ctx) {
  const listHtml = () => {
    const list = foods();
    if (!list.length) {
      return '<div class="empty"><span class="empty__mascot">🧺</span><div class="empty__text">食物库是空的</div></div>';
    }
    return list
      .map(
        (f) => html`
          <div class="list-item">
            <div class="list-item__body">
              <div class="list-item__title">${f.name}</div>
              <div class="list-item__meta">
                <span>${f.kcal ? `约 ${f.kcal} kcal` : '热量未填'}</span>
                ${f.tag ? raw(`<span class="badge">${esc(f.tag)}</span>`) : ''}
                <span>${(f.slots || []).map((s) => slotOf(s).name).join('/')}</span>
              </div>
            </div>
            <button class="btn btn--icon btn--plain" data-rm="${f.id}">🗑️</button>
          </div>
        `,
      )
      .join('');
  };

  const content = html`
    <div class="row" style="gap:8px">
      <input class="input grow" data-new-name placeholder="食物名字，比如：番茄牛腩" maxlength="20" />
      <input class="input" data-new-kcal type="number" placeholder="kcal" style="width:90px" />
    </div>
    <button class="btn btn--primary btn--sm btn--block mt-8" data-add-food>＋ 加进食物库</button>
    <div class="divider"></div>
    <div data-lib-list>${raw(listHtml())}</div>
  `;

  openSheet({
    title: '管理食物库',
    emoji: '🧺',
    content,
    onMount(sheetEl) {
      const listBox = qs('[data-lib-list]', sheetEl);

      const refreshList = () => {
        listBox.innerHTML = listHtml();
        bindRemove();
      };

      const bindRemove = () => {
        listBox.querySelectorAll('[data-rm]').forEach((b) => {
          b.onclick = async () => {
            const okDel = await confirmDialog({ title: '删掉这个食物？', okText: '删掉', danger: true });
            if (!okDel) return;
            try {
              await api.removeFood(b.dataset.rm);
              await ctx.refresh();
              await ctx.rerender();
              refreshList();
              toastOk('删掉啦');
            } catch (err) {
              toastErr(err.message);
            }
          };
        });
      };
      bindRemove();

      qs('[data-add-food]', sheetEl).onclick = async () => {
        const nameEl = qs('[data-new-name]', sheetEl);
        const name = nameEl.value.trim();
        const kcal = Number(qs('[data-new-kcal]', sheetEl).value) || 0;
        if (!name) return toastErr('先写个名字吧～');
        try {
          await api.addFood({ name, kcal, slots: D().slot ? [D().slot] : ['lunch', 'dinner'] });
          await ctx.refresh();
          await ctx.rerender();
          refreshList();
          nameEl.value = '';
          qs('[data-new-kcal]', sheetEl).value = '';
          toastOk('加好啦！');
        } catch (err) {
          toastErr(err.message);
        }
      };
    },
  });
}
