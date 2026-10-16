import {
  html,
  raw,
  fmtKg,
  fmt,
  dayLabel,
  timeLabel,
  toLocalInput,
  todayStr,
  dateStr,
  esc,
  WEIGHT_TAGS,
  qs,
} from '../utils.js';
import { state, latestWeight, daysFromWeights } from '../state.js';
import { api } from '../api.js';
import { drawWeightChart } from '../chart.js';
import { toastOk, toastErr, celebrate, burstFrom, withLoading, confirmDialog, popNumber, shake } from '../ui.js';

const RANGES = [
  { key: 7, label: '7 天' },
  { key: 30, label: '30 天' },
  { key: 90, label: '90 天' },
  { key: 0, label: '全部' },
];

/**
 * 从月历点"去记体重"跳过来时，默认时间落到那一天，
 * 不然补记昨天的体重还得手动改日期。
 */
function prefillAt() {
  const want = state.__weightDate;
  state.__weightDate = null;
  if (!want || want === todayStr()) return toLocalInput();
  // 用当天中午，避免落在时区边界上
  return toLocalInput(`${want}T12:00:00`);
}

export async function render(root, ctx) {
  const last = latestWeight();
  const st = state.stats || {};
  const todayEntries = daysFromWeights().find((d) => d.date === todayStr());
  let tags = [];
  let range = state.__weightRange ?? 30;

  root.innerHTML = html`
    <div class="view">
      <div class="card card--hero" data-record-card>
        <div class="card__title">
          ⚖️ 记一笔体重
          <span class="hint">${todayEntries ? `今天已记 ${todayEntries.entries.length} 次` : '今天还没记'}</span>
        </div>

        <div class="stepper">
          <button class="stepper__btn" data-step="-0.1">−</button>
          <div class="weigh-input">
            <input
              class="weigh-input__field"
              data-kg
              type="number"
              step="0.1"
              inputmode="decimal"
              placeholder="--"
              value="${last ? last.kg : ''}"
            />
            <span class="weigh-input__unit">kg</span>
          </div>
          <button class="stepper__btn" data-step="0.1">＋</button>
        </div>

        ${last
          ? raw(
              html`<div class="center tiny muted" data-diff>
                上次 ${fmtKg(last.kg)}kg · ${dayLabel(dateStr(new Date(last.at)))} ${timeLabel(last.at)}
              </div>`,
            )
          : ''}

        <div class="field mt-16">
          <label class="field__label">什么时候</label>
          <input class="input" type="datetime-local" data-at value="${prefillAt()}" />
        </div>

        <div class="field">
          <label class="field__label">状态标签（可以多选）</label>
          <div class="chips" data-tags>
            ${raw(
              WEIGHT_TAGS.map(
                (t) => html`<button class="chip chip--soft" data-tag="${t}">${t}</button>`,
              ).join(''),
            )}
          </div>
        </div>

        <div class="field">
          <label class="field__label">想说的话（可以不写）</label>
          <input class="input" data-note placeholder="比如：昨晚没忍住吃了宵夜…" maxlength="60" />
        </div>

        <button class="btn btn--primary btn--block btn--lg" data-save>💾 记下来</button>

        ${Number(st.recordCount) > 0
          ? raw(html`
              <div class="stat-grid mt-16">
                <div class="stat">
                  <div class="stat__value">${fmtKg(st.latestKg)}<small>kg</small></div>
                  <div class="stat__label">最新</div>
                </div>
                <div class="stat">
                  <div class="stat__value">${fmtKg(st.lowest)}<small>kg</small></div>
                  <div class="stat__label">最低记录</div>
                </div>
                <div class="stat">
                  <div class="stat__value" style="color:${st.trend7 < 0 ? 'var(--mint-deep)' : 'var(--cocoa-soft)'}">
                    ${st.trend7 == null ? '--' : (st.trend7 > 0 ? '+' : '') + fmt(st.trend7)}
                  </div>
                  <div class="stat__label">近 7 天变化</div>
                </div>
              </div>
            `)
          : ''}
      </div>

      <div class="card">
        <div class="card__title">
          📉 体重曲线
          <span class="hint">
            <span class="segmented" data-range>
              ${raw(
                RANGES.map(
                  (r) => html`<button data-r="${r.key}" class="${r.key === range ? 'is-on' : ''}">${r.label}</button>`,
                ).join(''),
              )}
            </span>
          </span>
        </div>
        <div class="chart-wrap">
          <canvas data-chart></canvas>
          <div class="chart-tip" data-tip></div>
        </div>
        <div class="chart-legend">
          <span><i style="background:#f2688f"></i>实际</span>
          <span><i style="background:#cbb8ff"></i>7 日均线</span>
          ${st.targetWeight != null
            ? raw('<span data-goal-legend><i style="background:#5fc79c"></i>目标</span>')
            : ''}
        </div>
      </div>

      <div class="card">
        <div class="card__title">📒 全部记录<span class="hint">${st.recordCount || 0} 笔</span></div>
        <div data-list></div>
      </div>
    </div>
  `;

  const kgInput = qs('[data-kg]', root);
  const saveBtn = qs('[data-save]', root);

  /* ---- 步进 ---- */
  root.querySelectorAll('[data-step]').forEach((btn) => {
    btn.onclick = () => {
      const cur = Number(kgInput.value) || (last ? last.kg : 55);
      const next = +(cur + Number(btn.dataset.step)).toFixed(1);
      kgInput.value = next;
      popNumber(kgInput);
      updateDiff();
    };
  });

  kgInput.addEventListener('input', updateDiff);
  kgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
  });

  function updateDiff() {
    const box = qs('[data-diff]', root);
    const v = Number(kgInput.value);
    if (!box || !last || !Number.isFinite(v)) return;
    const d = +(v - last.kg).toFixed(2);
    const tone = d < 0 ? 'var(--mint-deep)' : d > 0 ? 'var(--danger)' : 'var(--cocoa-faint)';
    box.innerHTML = html`上次 ${fmtKg(last.kg)}kg，这次
      <b style="color:${raw(tone)}">${d > 0 ? '+' : ''}${d.toFixed(1)}kg</b>`;
  }

  /* ---- 标签 ---- */
  qs('[data-tags]', root).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tag]');
    if (!btn) return;
    const t = btn.dataset.tag;
    if (tags.includes(t)) {
      tags = tags.filter((x) => x !== t);
      btn.classList.remove('is-on');
    } else {
      tags = [...tags, t];
      btn.classList.add('is-on');
    }
  });

  /* ---- 保存 ---- */
  saveBtn.onclick = async () => {
    const kg = Number(kgInput.value);
    if (!Number.isFinite(kg) || kg <= 20 || kg > 400) {
      toastErr('体重数字看起来不太对哦～');
      shake(kgInput);
      kgInput.focus();
      return;
    }
    const restore = withLoading(saveBtn, '记下来');
    try {
      const res = await api.addWeight({
        kg,
        at: new Date(qs('[data-at]', root).value).toISOString(),
        note: qs('[data-note]', root).value.trim(),
        tags,
      });
      await ctx.refresh();

      const milestone = (res.celebrations || []).find((c) => c.type === 'milestone');
      const first = (res.celebrations || []).find((c) => c.type === 'first');
      const lowest = (res.celebrations || []).find((c) => c.type === 'lowest');

      if (first) {
        await celebrate({
          emoji: '🌱',
          title: '起点记下啦！',
          desc: '从今天开始，我们一起慢慢变好呀～',
          button: '好耶，开始！',
        });
      } else if (milestone) {
        await celebrate({
          emoji: '🏆',
          title: `又瘦了 ${milestone.lost} 公斤！`,
          desc: `已经减到 ${fmtKg(milestone.kg)}kg 啦，你真的好棒！`,
          button: '继续加油 💪',
          confettiCount: 170,
        });
      } else if (lowest) {
        toastOk('历史新低！你也太厉害了吧 ✨');
        burstFrom(saveBtn, ['💖', '⭐', '✨', '🎀'], 14);
      } else {
        toastOk('记好啦，明天见～');
        burstFrom(saveBtn, ['💗', '🌸'], 8);
      }
    } catch (err) {
      toastErr(err.message);
    } finally {
      restore();
    }
  };

  /* ---- 图表 ---- */
  const canvas = qs('[data-chart]', root);
  const tip = qs('[data-tip]', root);
  const goalLegend = qs('[data-goal-legend]', root);

  function paint(data) {
    drawWeightChart(canvas, {
      series: data.stats.series,
      movingAvg: data.stats.movingAvg,
      goal: state.db?.profile?.targetWeight ?? null,
      tipEl: tip,
    });
    if (goalLegend) {
      const mode = canvas.dataset.goalVisible;
      // 目标线跑到图外时就不摆图例了，图上已经用箭头标了方向
      goalLegend.style.display = mode === 'yes' ? '' : 'none';
    }
  }

  const chartData = await api.stats(range);
  paint(chartData);
  state.__weightRange = range;

  qs('[data-range]', root).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    range = Number(b.dataset.r);
    state.__weightRange = range;
    qs('[data-range]', root)
      .querySelectorAll('button')
      .forEach((x) => x.classList.toggle('is-on', x === b));
    const d = await api.stats(range);
    paint(d);
    renderList(d.stats.series);
  });

  /* ---- 列表 ---- */
  renderList(chartData.stats.series);

  function renderList(series) {
    const holder = qs('[data-list]', root);
    const allowed = new Set((series || []).map((s) => s.date));
    const groups = daysFromWeights().filter((g) => (range === 0 ? true : allowed.has(g.date)));

    if (!groups.length) {
      holder.innerHTML = html`
        <div class="empty">
          <span class="empty__mascot">📒</span>
          <div class="empty__text">这个时间段还没有记录</div>
        </div>
      `;
      return;
    }

    holder.innerHTML = groups
      .map(
        (g) => html`
          <div class="day-group">
            <div class="day-group__head">
              ${dayLabel(g.date)}
              ${g.entries.length > 1
                ? raw(`<span class="day-group__badge">${g.entries.length} 次</span>`)
                : ''}
            </div>
            ${raw(
              g.entries
                .map((w, i) => {
                  const prevE = i > 0 ? g.entries[i - 1] : null;
                  const d = prevE ? +(w.kg - prevE.kg).toFixed(2) : null;
                  return html`
                    <div class="list-item">
                      <div class="list-item__icon" style="background:transparent;font-size:15px">${timeLabel(w.at)}</div>
                      <div class="list-item__body">
                        <div class="list-item__title">
                          ${fmtKg(w.kg)}<span class="tiny muted">kg</span>
                          ${d != null
                            ? raw(
                                `<span class="tiny ${d < 0 ? 'down' : d > 0 ? 'up' : 'muted'}" style="margin-left:6px">
                                   ${d > 0 ? '+' : ''}${d.toFixed(1)}
                                 </span>`,
                              )
                            : ''}
                        </div>
                        <div class="list-item__meta">
                          ${w.tags?.length
                            ? raw(w.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join(''))
                            : ''}
                          ${w.note ? raw(`<span>${esc(w.note)}</span>`) : ''}
                        </div>
                      </div>
                      <button class="btn btn--icon btn--plain" data-del="${w.id}" title="删除">🗑️</button>
                    </div>
                  `;
                })
                .join(''),
            )}
          </div>
        `,
      )
      .join('');

    holder.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async () => {
        const okDel = await confirmDialog({
          title: '要删掉这条记录吗？',
          desc: '删掉之后就找不回来了哦',
          okText: '删掉',
          danger: true,
        });
        if (!okDel) return;
        try {
          await api.removeWeight(btn.dataset.del);
          await ctx.refresh();
          toastOk('删掉啦');
        } catch (err) {
          toastErr(err.message);
        }
      };
    });
  }

  updateDiff();
}
