import {
  html,
  raw,
  esc,
  fmtKg,
  dayLabel,
  todayStr,
  shiftDay,
  timeLabel,
  SLOTS,
  slotOf,
  LEVEL_INFO,
  qs,
} from '../utils.js';
import { state, mealsOn, foods } from '../state.js';
import { api } from '../api.js';
import {
  toastOk,
  toastErr,
  openSheet,
  withLoading,
  burstFrom,
  confirmDialog,
  celebrate,
  countUp,
  shake,
} from '../ui.js';
import { analysisBlock, scoreRing, animateRings, emptyState } from '../components.js';

export async function render(root, ctx) {
  const date = state.__foodDate || todayStr();
  const dayMeals = mealsOn(date);

  const analyzed = dayMeals.filter((m) => m.analysis);
  const totalKcal = analyzed.reduce((s, m) => s + (m.analysis.kcal || 0), 0);
  const avgScore = analyzed.length
    ? Math.round(analyzed.reduce((s, m) => s + m.analysis.score, 0) / analyzed.length)
    : null;

  root.innerHTML = html`
    <div class="view">
      <!-- 日期切换 -->
      <div class="card card--flat">
        <div class="row">
          <button class="btn btn--icon btn--plain" data-day="-1">‹</button>
          <div class="grow center">
            <div class="bold" style="font-size:16px">${dayLabel(date)}</div>
            <div class="tiny muted">${date}${date === todayStr() ? ' · 就是今天' : ''}</div>
          </div>
          <button class="btn btn--icon btn--plain" data-day="1" ${date >= todayStr() ? 'disabled' : ''}>›</button>
        </div>
        ${date !== todayStr()
          ? raw(html`<button class="btn btn--ghost btn--sm btn--block mt-12" data-today>回到今天</button>`)
          : ''}
      </div>

      <!-- 今日汇总 -->
      <div class="card card--tint">
        <div class="row" style="gap:14px">
          ${avgScore != null
            ? raw(scoreRing(avgScore, '今日平均', 104))
            : raw(html`
                <div class="ring" style="width:104px;height:104px">
                  <svg viewBox="0 0 110 110">
                    <circle class="ring__track" cx="55" cy="55" r="44"></circle>
                  </svg>
                  <div class="ring__center"><div><div class="ring__pct">--</div><div class="ring__cap">还没有分</div></div></div>
                </div>
              `)}
          <div class="grow">
            <div class="stat-grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px">
              <div class="stat">
                <div class="stat__value">${totalKcal}<small>kcal</small></div>
                <div class="stat__label">估算摄入</div>
              </div>
              <div class="stat">
                <div class="stat__value">${dayMeals.length}<small>顿</small></div>
                <div class="stat__label">记录餐次</div>
              </div>
            </div>
            <button
              class="btn btn--primary btn--sm btn--block mt-12"
              data-analyze-day
              ${!dayMeals.some((m) => !m.analysis) ? 'disabled' : ''}
            >
              ${dayMeals.some((m) => !m.analysis) ? '🤖 让 AI 点评今天' : '✅ 今天都分析过啦'}
            </button>
          </div>
        </div>
        ${!state.ai.enabled || !state.ai.configured
          ? raw(html`<div class="tiny muted mt-12 center">
              AI 还没配好，去「我的 → AI 小助手」填一下网关就能用啦～
            </div>`)
          : ''}
      </div>

      <!-- 各餐次 -->
      ${raw(
        SLOTS.map((slot) => {
          const list = dayMeals.filter((m) => m.slot === slot.key);
          const slotKcal = list.reduce((s, m) => s + (m.analysis?.kcal || 0), 0);
          return html`
            <div class="card">
              <div class="card__title">
                <span>${slot.emoji}</span>${slot.name}
                <span class="hint">${slotKcal ? `约 ${slotKcal} kcal` : list.length ? `${list.length} 条` : ''}</span>
              </div>
              ${list.length
                ? raw(list.map((m) => mealBlock(m)).join(''))
                : raw(html`<div class="tiny muted center" style="padding:6px 0 10px">还没有记录～</div>`)}
              <button class="btn btn--ghost btn--sm btn--block mt-8" data-add="${slot.key}">
                ＋ 添加${slot.name}
              </button>
            </div>
          `;
        }).join(''),
      )}
    </div>
  `;

  animateRings(root);

  /* ---- 日期切换 ---- */
  root.querySelectorAll('[data-day]').forEach((btn) => {
    btn.onclick = () => {
      state.__foodDate = shiftDay(date, Number(btn.dataset.day));
      ctx.rerender();
    };
  });
  const todayBtn = qs('[data-today]', root);
  if (todayBtn) {
    todayBtn.onclick = () => {
      state.__foodDate = todayStr();
      ctx.rerender();
    };
  }

  /* ---- 添加 ---- */
  root.querySelectorAll('[data-add]').forEach((btn) => {
    btn.onclick = (e) => openAddSheet(btn.dataset.add, date, ctx, e.currentTarget);
  });

  /* ---- 单条分析 ---- */
  root.querySelectorAll('[data-analyze]').forEach((btn) => {
    btn.onclick = async () => {
      const restore = withLoading(btn, 'AI 看看');
      try {
        await api.analyzeMeal(btn.dataset.analyze);
        await ctx.refresh();
        toastOk('分析好啦～');
      } catch (err) {
        toastErr(err.message);
      } finally {
        restore();
      }
    };
  });

  /* ---- 删除 ---- */
  root.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      const ok = await confirmDialog({ title: '删掉这条记录？', okText: '删掉', danger: true });
      if (!ok) return;
      try {
        await api.removeMeal(btn.dataset.del);
        await ctx.refresh();
        toastOk('删掉啦');
      } catch (err) {
        toastErr(err.message);
      }
    };
  });

  /* ---- 一天批量分析 ---- */
  const dayBtn = qs('[data-analyze-day]', root);
  if (dayBtn) {
    dayBtn.onclick = async () => {
      const restore = withLoading(dayBtn, 'AI 正在看');
      try {
        const res = await api.analyzeDay(date);
        await ctx.refresh();
        const errs = res.errors || [];
        if (errs.length) toastErr(`有 ${errs.length} 顿没分析成功：${errs[0].error}`);
        else {
          const scores = (res.analyzed || []).map((a) => a.analysis.score);
          const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
          if (avg != null && avg >= 80) {
            await celebrate({ emoji: '🌟', title: `今天平均 ${avg} 分！`, desc: '吃得这么认真，减脂肯定不会亏待你～', button: '继续保持 💪' });
          } else {
            toastOk('今天的饮食分析好啦～');
          }
        }
      } catch (err) {
        toastErr(err.message);
      } finally {
        restore();
      }
    };
  }
}

/* ---------------- 单条餐食 ---------------- */

function mealBlock(m) {
  const lv = m.analysis ? LEVEL_INFO[m.analysis.level] || LEVEL_INFO.good : null;
  return html`
    <div class="meal-block" style="margin-bottom:12px">
      <div class="list-item" style="background:var(--cream)">
        <div class="list-item__body">
          <div class="list-item__title" style="white-space:normal">${m.text || m.photoNote || '（没写内容）'}</div>
          <div class="list-item__meta">
            <span>${timeLabel(m.at)}</span>
            ${lv ? raw(`<span class="badge badge--${lv.cls}">${lv.emoji} ${m.analysis.score} 分</span>`) : ''}
            ${m.analysis?.kcal ? raw(`<span>约 ${m.analysis.kcal} kcal</span>`) : ''}
            ${m.photoNote && m.text ? raw(`<span>📷 ${esc(m.photoNote)}</span>`) : ''}
          </div>
        </div>
        <button class="btn btn--icon btn--plain" data-del="${m.id}" title="删除">🗑️</button>
      </div>

      ${m.analysis
        ? analysisBlock(m.analysis)
        : raw(html`
            <button class="btn btn--ghost btn--sm btn--block mt-8" data-analyze="${m.id}">
              🤖 让 AI 看看这顿健不健康
            </button>
          `)}
    </div>
  `;
}

/* ---------------- 添加面板 ---------------- */

function openAddSheet(slotKey, date, ctx, anchorEl) {
  const slot = slotOf(slotKey);
  const lib = foods().filter((f) => f.slots.includes(slotKey)).slice(0, 14);

  const content = html`
    <div class="field">
      <label class="field__label">吃了什么呀</label>
      <textarea class="textarea" data-text placeholder="比如：一碗燕麦粥 + 一个水煮蛋 + 半杯无糖豆浆"></textarea>
    </div>

    ${lib.length
      ? raw(html`
          <div class="field">
            <label class="field__label">点一下就加进去</label>
            <div class="chips" data-quick>
              ${raw(
                lib
                  .map((f) => `<button class="chip" data-f="${esc(f.name)}">${esc(f.name)}</button>`)
                  .join(''),
              )}
            </div>
          </div>
        `)
      : ''}

    <div class="field">
      <label class="field__label">照片里还有什么（可选）</label>
      <input class="input" data-photo placeholder="比如：还配了一小碟咸菜" maxlength="60" />
    </div>

    <div class="row" style="gap:10px;margin-top:16px">
      <button class="btn btn--plain grow" data-save-only>只记下来</button>
      <button class="btn btn--primary grow" data-save-ai>🤖 记下并分析</button>
    </div>
    <div class="tiny muted center mt-8">AI 分析需要几秒钟，稍等一下下～</div>
  `;

  openSheet({
    title: `记一顿${slot.name}`,
    emoji: slot.emoji,
    content,
    onMount(sheet, close) {
      const textarea = qs('[data-text]', sheet);
      const photo = qs('[data-photo]', sheet);
      textarea.focus();

      const quick = qs('[data-quick]', sheet);
      if (quick) {
        quick.onclick = (e) => {
          const b = e.target.closest('[data-f]');
          if (!b) return;
          const name = b.dataset.f;
          textarea.value = textarea.value.trim() ? `${textarea.value.trim()} + ${name}` : name;
          b.classList.add('is-on');
          textarea.focus();
        };
      }

      const save = async (btn, analyze) => {
        const text = textarea.value.trim();
        const photoNote = photo.value.trim();
        if (!text && !photoNote) {
          toastErr('先写点吃了什么吧～');
          shake(textarea);
          textarea.focus();
          return;
        }
        const restore = withLoading(btn, analyze ? 'AI 看看' : '保存');
        try {
          const { meal } = await api.addMeal({ date, slot: slotKey, text, photoNote });
          if (analyze) {
            try {
              await api.analyzeMeal(meal.id);
            } catch (err) {
              toastErr('记录好啦，但分析失败：' + err.message);
              close();
              await ctx.refresh();
              return;
            }
          }
          close();
          await ctx.refresh();
          if (analyze) {
            toastOk('记下啦，分析结果在下面～');
            burstFrom(anchorEl || document.body, ['🍽️', '💚', '✨'], 10);
          } else {
            toastOk('记好啦！');
            burstFrom(anchorEl || document.body, ['🍚', '💗'], 8);
          }
        } catch (err) {
          toastErr(err.message);
        } finally {
          restore();
        }
      };

      qs('[data-save-only]', sheet).onclick = (e) => save(e.currentTarget, false);
      qs('[data-save-ai]', sheet).onclick = (e) => save(e.currentTarget, true);

      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) qs('[data-save-ai]', sheet).click();
      });
    },
  });
}
