/* 周报 / 月报：把一段时间的记录汇成一张成绩单 */

import { state } from '../state.js';
import { api } from '../api.js';
import { toastOk, toastErr, withLoading, confetti, countUp } from '../ui.js';
import { qs, html, raw, fmt, fmtKg, dayShort } from '../utils.js';
import { drawWeightChart } from '../chart.js';
import { scoreRing, animateRings } from '../components.js';
import { periodStageText, bloatExplain } from '../period.js';

/* ------------------------------------------------------------------ */

const MOOD_INFO = {
  great: { emoji: '🎉', label: '超级棒' },
  good: { emoji: '😊', label: '挺好的' },
  steady: { emoji: '🙂', label: '稳稳的' },
  tough: { emoji: '🫂', label: '辛苦了' },
};

function changeText(v, { goodWhenDown = true } = {}) {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${fmt(v, 2)}`;
}

function changeClass(v, goodWhenDown = true) {
  if (v == null || Math.abs(v) < 0.005) return '';
  const isGood = goodWhenDown ? v < 0 : v > 0;
  return isGood ? 'is-down' : 'is-up';
}

/** 每天的健康分柱状图 */
function scoreBarsHtml(series) {
  if (!series.length) return raw('<div class="tiny muted">这一期还没有分析过的饮食</div>');
  return html`
    <div class="bar-chart">
      ${raw(
        series
          .map((p, i) => {
            const cls = ['bar-chart__col', p.score < 60 ? 'is-low' : p.score >= 85 ? 'is-high' : '']
              .filter(Boolean)
              .join(' ');
            return html`
              <div class="${cls}" title="${p.date} · ${p.score} 分">
                <span class="tiny" style="font-weight:800;color:var(--cocoa);opacity:.6">${p.score}</span>
                <div class="bar-chart__track">
                  <div class="bar-chart__bar" style="height:${Math.max(4, p.score)}%;animation-delay:${i * 45}ms"></div>
                </div>
                <div class="bar-chart__label">${dayShort(p.date)}</div>
              </div>
            `;
          })
          .join(''),
      )}
    </div>
  `;
}

/* ------------------------------------------------------------------ */

export async function render(root, ctx) {
  let period = state.__reportPeriod || 'week';
  let offset = state.__reportOffset || 0;
  let data = null;
  let summary = null;
  let loading = true;
  let error = '';

  async function load() {
    loading = true;
    error = '';
    try {
      data = await api.report(period, offset);
      // 换了周期就丢掉上一次的 AI 总结
      const key = `${period}:${offset}`;
      if (state.__reportSummaryKey !== key) summary = null;
    } catch (err) {
      error = err.message;
    }
    loading = false;
    paint();
  }

  function paint() {
    if (loading) {
      root.innerHTML = html`
        <div class="view">
          <div class="card center">
            <div class="thinking" style="font-size:34px">📊</div>
            <div class="tiny muted mt-8">正在算这一期的账…</div>
          </div>
        </div>
      `;
      return;
    }
    if (error) {
      root.innerHTML = html`
        <div class="view">
          <div class="card center">
            <div style="font-size:40px">🥺</div>
            <div class="bold mt-8">报表没算出来</div>
            <div class="tiny muted mt-8">${error}</div>
            <button class="btn btn--primary btn--sm mt-16" data-retry>再试一次</button>
          </div>
        </div>
      `;
      qs('[data-retry]', root).onclick = load;
      return;
    }

    const r = data.report;
    const info = data.period || {};
    const bloat = bloatExplain(info, r.weight.vsPrev ?? r.weight.change);
    const hasAny = r.weight.recordCount || r.meal.count || r.checkin.days;

    root.innerHTML = html`
      <div class="view">
        <!-- 周期切换 -->
        <div class="card">
          <div class="row" style="gap:8px">
            <div class="segmented grow" data-kind>
              <button class="${period === 'week' ? 'is-on' : ''}" data-k="week">本周</button>
              <button class="${period === 'month' ? 'is-on' : ''}" data-k="month">本月</button>
            </div>
          </div>
          <div class="cal__head mt-12" style="margin-bottom:0">
            <button class="cal__nav" data-prev aria-label="往前一期">‹</button>
            <div class="cal__title">
              ${r.label}
              <div class="tiny muted" style="font-weight:600;margin-top:2px">
                ${r.start.slice(5).replace('-', '/')} – ${r.end.slice(5).replace('-', '/')}
              </div>
            </div>
            <button class="cal__nav" data-next aria-label="往后一期" ${offset === 0 ? 'disabled' : ''}>›</button>
          </div>
        </div>

        ${!hasAny
          ? raw(html`
              <div class="card center">
                <div style="font-size:46px;animation:sway 3s var(--ease-in-out) infinite">🌱</div>
                <div class="bold mt-12">这一期还没有记录</div>
                <div class="tiny muted mt-8" style="line-height:1.7">
                  记录断了也没关系，回来就好。<br />今天记一笔，下一份报表就有内容啦～
                </div>
                <button class="btn btn--primary btn--sm mt-16" data-go-weight>去记一笔体重</button>
              </div>
            `)
          : raw(html`
              <!-- 主体重 -->
              <div class="card">
                <div class="card__title">
                  ⚖️ 体重
                  <span class="grow"></span>
                  <span class="tiny muted">记了 ${r.weight.recordedDays}/${r.totalDays} 天 · ${r.weight.recordCount} 笔</span>
                </div>
                <div class="row" style="gap:16px;align-items:flex-end">
                  <div>
                    <div class="tiny muted">这一期平均</div>
                    <div class="big-number" style="font-size:38px">
                      <span data-num="${r.weight.avg ?? 0}">${fmtKg(r.weight.avg)}</span><small>kg</small>
                    </div>
                  </div>
                  <div class="grow tiny" style="text-align:right">
                    <div class="${changeClass(r.weight.change)}">
                      期内变化 <b>${changeText(r.weight.change)} kg</b>
                    </div>
                    <div class="muted mt-8">
                      上期平均 ${r.weight.prevAvg != null ? `${fmtKg(r.weight.prevAvg)} kg` : '—'}
                      ${r.weight.vsPrev != null ? raw(`（${changeText(r.weight.vsPrev)}）`) : ''}
                    </div>
                  </div>
                </div>

                <div class="kv-list mt-16">
                  <div class="kv ${changeClass(r.weight.change)}">
                    <span class="kv__k">📉 期初 → 期末</span>
                    <span class="kv__v">
                      ${r.weight.first != null ? `${fmtKg(r.weight.first)} → ${fmtKg(r.weight.last)}` : '—'}
                      <small>${changeText(r.weight.change)}</small>
                    </span>
                  </div>
                  <div class="kv">
                    <span class="kv__k">🔻 最低 / 最高</span>
                    <span class="kv__v">
                      ${r.weight.min != null ? `${fmtKg(r.weight.min)} / ${fmtKg(r.weight.max)}` : '—'}
                    </span>
                  </div>
                </div>

                ${r.weight.series.length >= 2
                  ? raw(html`
                      <div class="chart-wrap mt-16">
                        <canvas data-chart height="150"></canvas>
                        <div class="chart-tip" data-tip></div>
                      </div>
                    `)
                  : ''}
              </div>

              <!-- 饮食 -->
              <div class="card">
                <div class="card__title">
                  🍚 饮食
                  <span class="grow"></span>
                  <span class="tiny muted">记了 ${r.meal.days} 天 · ${r.meal.count} 顿</span>
                </div>
                <div class="row" style="gap:14px;align-items:center">
                  ${r.meal.avgScore != null
                    ? raw(scoreRing(r.meal.avgScore, '平均健康分', 96))
                    : raw('<div class="tiny muted">这一期还没有分析过的饮食</div>')}
                  <div class="grow">
                    <div class="kv-list">
                      <div class="kv">
                        <span class="kv__k">🔥 日均热量</span>
                        <span class="kv__v">${r.meal.kcalPerDay || 0}<small>kcal</small></span>
                      </div>
                      <div class="kv">
                        <span class="kv__k">🍽️ 分析过</span>
                        <span class="kv__v">${r.meal.analyzed}<small>顿</small></span>
                      </div>
                    </div>
                  </div>
                </div>

                ${r.meal.scoreSeries.length
                  ? raw(html`<div class="mt-16">${raw(scoreBarsHtml(r.meal.scoreSeries))}</div>`)
                  : ''}

                ${r.meal.best || r.meal.worst
                  ? raw(html`
                      <div class="kv-list mt-12">
                        ${r.meal.best
                          ? raw(html`
                              <div class="kv">
                                <span class="kv__k">🌟 吃得最好的一顿</span>
                                <span class="kv__v" style="max-width:52%;text-align:right;white-space:normal">
                                  ${r.meal.best.text || '—'} <small>${r.meal.best.score} 分</small>
                                </span>
                              </div>
                            `)
                          : ''}
                        ${r.meal.worst && r.meal.worst.score < 70
                          ? raw(html`
                              <div class="kv is-up">
                                <span class="kv__k">😣 最该反省的一顿</span>
                                <span class="kv__v" style="max-width:52%;text-align:right;white-space:normal">
                                  ${r.meal.worst.text || '—'} <small>${r.meal.worst.score} 分</small>
                                </span>
                              </div>
                            `)
                          : ''}
                      </div>
                    `)
                  : ''}
              </div>

              <!-- 打卡 -->
              <div class="card">
                <div class="card__title">✅ 打卡</div>
                <div class="stat-grid">
                  <div class="stat">
                    <div class="stat__value">${r.checkin.days}<small>天</small></div>
                    <div class="stat__label">打了卡</div>
                  </div>
                  <div class="stat">
                    <div class="stat__value">${r.checkin.waterDaysDone}<small>天</small></div>
                    <div class="stat__label">喝水达标</div>
                  </div>
                  <div class="stat">
                    <div class="stat__value">${r.checkin.exerciseMinutes}<small>分</small></div>
                    <div class="stat__label">运动</div>
                  </div>
                </div>
                <div class="tiny muted mt-12" style="line-height:1.7">
                  平均每天喝水 <b>${r.checkin.waterAvg || 0} ml</b>
                  ${r.checkin.sleepAvg != null ? raw(` · 平均睡眠 <b>${r.checkin.sleepAvg} 小时</b>`) : ''}
                </div>
              </div>
            `)}

        ${bloat
          ? raw(html`
              <div class="card">
                <div class="bloat-tip">
                  <span class="bloat-tip__emoji">🌸</span>
                  <span>${bloat}</span>
                </div>
              </div>
            `)
          : ''}

        ${info.hasData
          ? raw(html`
              <div class="card">
                <div class="row" style="gap:12px;align-items:center">
                  <span style="font-size:26px;animation:bloom 3.6s var(--ease-in-out) infinite">🌸</span>
                  <div class="grow">
                    <div class="bold tiny">${periodStageText(info)}</div>
                    <div class="tiny muted mt-8">
                      周期按 ${info.cycleLength} 天算${info.estimated ? '（记录还不够多，是估的）' : ''}
                    </div>
                  </div>
                </div>
              </div>
            `)
          : ''}

        <!-- AI 总结 -->
        <div class="card">
          <div class="card__title">
            🤖 AI 总结
            <span class="grow"></span>
            ${summary ? raw(html`<span class="tiny muted">${summary.at ? new Date(summary.at).toLocaleDateString('zh-CN') : ''}</span>`) : ''}
          </div>

          ${summary
            ? raw(html`
                <div class="report-hero">
                  <div class="row" style="gap:12px;align-items:center">
                    <span style="font-size:38px;line-height:1">${summary.emoji}</span>
                    <div class="grow">
                      <div class="report-hero__headline">${summary.headline}</div>
                      <div class="tiny muted mt-8">
                        ${MOOD_INFO[summary.mood]?.emoji || ''} ${MOOD_INFO[summary.mood]?.label || ''}
                      </div>
                    </div>
                  </div>
                </div>

                ${summary.highlights.length
                  ? raw(html`
                      <div class="mt-16">
                        <div class="tiny muted">做得好的地方</div>
                        <ul class="analysis__list">
                          ${raw(summary.highlights.map((t) => `<li><span>💚</span><span>${t}</span></li>`).join(''))}
                        </ul>
                      </div>
                    `)
                  : ''}
                ${summary.watchout.length
                  ? raw(html`
                      <div class="mt-12">
                        <div class="tiny muted">可以留意一下</div>
                        <ul class="analysis__list">
                          ${raw(summary.watchout.map((t) => `<li><span>⚠️</span><span>${t}</span></li>`).join(''))}
                        </ul>
                      </div>
                    `)
                  : ''}
                ${summary.nextStep
                  ? raw(html`
                      <div class="analysis__swap mt-12">🎯 下一期只做一件事：${summary.nextStep}</div>
                    `)
                  : ''}
                ${summary.note
                  ? raw(html`<div class="analysis__cheer mt-12">${summary.note}</div>`)
                  : ''}

                <button class="btn btn--plain btn--block mt-12 btn--sm" data-ai-again>换一份总结</button>
              `)
            : raw(html`
                <div class="tiny muted" style="line-height:1.75">
                  ${
                    state.ai?.enabled && state.ai?.configured
                      ? '让 AI 读完这一期的数据，写一份具体到数字的小结，还会挑一件下一期最容易做到的小事。'
                      : 'AI 小助手还没配好，去「我的 → AI 小助手」填一下网关就能用啦～'
                  }
                </div>
                <button class="btn btn--primary btn--block mt-12" data-ai ${
                  hasAny ? '' : 'disabled'
                }>✨ 让 AI 写一份成绩单</button>
              `)}
        </div>
      </div>
    `;

    wire(r);
  }

  function wire(r) {
    /* 切周期 */
    root.querySelectorAll('[data-k]').forEach((b) => {
      b.onclick = () => {
        period = b.dataset.k;
        offset = 0;
        state.__reportPeriod = period;
        state.__reportOffset = 0;
        state.__reportSummaryKey = null;
        summary = null;
        load();
      };
    });

    /* 翻期 */
    qs('[data-prev]', root).onclick = () => {
      offset += 1;
      state.__reportOffset = offset;
      state.__reportSummaryKey = null;
      summary = null;
      load();
    };
    const nextBtn = qs('[data-next]', root);
    if (nextBtn && offset > 0) {
      nextBtn.onclick = () => {
        offset = Math.max(0, offset - 1);
        state.__reportOffset = offset;
        state.__reportSummaryKey = null;
        summary = null;
        load();
      };
    }

    const goWeight = qs('[data-go-weight]', root);
    if (goWeight) goWeight.onclick = () => import('../router.js').then(({ go }) => go('weight'));

    /* AI 总结 */
    const aiBtn = qs('[data-ai]', root) || qs('[data-ai-again]', root);
    if (aiBtn) {
      aiBtn.onclick = async (e) => {
        const restore = withLoading(e.currentTarget, 'AI 正在读你的记录');
        try {
          const res = await api.reportSummary(period, offset);
          summary = res.summary;
          state.__reportSummaryKey = `${period}:${offset}`;
          restore();
          paint();
          confetti({ count: 90, originY: 0.35 });
          toastOk('成绩单写好啦 ✨');
        } catch (err) {
          restore();
          toastErr(err.message);
        }
      };
    }

    /* 体重曲线 */
    const canvas = qs('[data-chart]', root);
    if (canvas && r.weight.series.length >= 2) {
      drawWeightChart(canvas, {
        series: r.weight.series.map((p) => ({ date: p.date, value: p.kg })),
        movingAvg: [],
        goal: state.db?.profile?.targetWeight ?? null,
        tipEl: qs('[data-tip]', root),
      });
    }

    /* 大数字滚动 */
    root.querySelectorAll('[data-num]').forEach((el) => {
      const to = Number(el.dataset.num) || 0;
      countUp(el, to, { from: Math.max(0, to - 2), dur: 800, digits: 1 });
    });

    /* 环填满（scoreRing 出来是 0，要靠这一步动画长上去） */
    animateRings(root);
  }

  await load();
  void ctx;
}
