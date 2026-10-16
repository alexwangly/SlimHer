/* 每日打卡：喝水 / 心情 / 便便 / 运动 / 睡眠 + 经期 + 月历 */

import { state, reload } from '../state.js';
import { api } from '../api.js';
import {
  toastOk,
  toastErr,
  openSheet,
  confirmDialog,
  burstFrom,
  withLoading,
  confetti,
  shake,
} from '../ui.js';
import { qs, html, raw, dateStr, todayStr, parseDay, weekday, clamp } from '../utils.js';
import { periodInfo, periodStageText } from '../period.js';

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const MOOD_LIST = [
  { key: 'great', emoji: '🤩', label: '超棒' },
  { key: 'happy', emoji: '😊', label: '开心' },
  { key: 'ok', emoji: '🙂', label: '还行' },
  { key: 'tired', emoji: '😪', label: '有点累' },
  { key: 'low', emoji: '🥺', label: '低落' },
  { key: 'angry', emoji: '😤', label: '烦躁' },
];

const POOP_LIST = [
  { key: 'ok', emoji: '😌', label: '正常' },
  { key: 'hard', emoji: '😣', label: '有点难' },
  { key: 'no', emoji: '🙈', label: '没有' },
];

const EXERCISES = ['快走', '跳绳', '跑步', '瑜伽', '游泳', '力量', '骑车', '跳操'];

const WATER_STEPS = [200, 300, 500];

const CUP_GOAL = 1500;
const SLEEP_GOAL = 7.5;

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const emptyCheckin = () => ({ water: 0, mood: '', poop: '', sleep: null, exercise: [], note: '' });

function checkinOf(date) {
  const saved = state.db?.checkins?.[date];
  const c = { ...emptyCheckin(), ...(saved || {}) };
  c.exercise = Array.isArray(c.exercise)
    ? c.exercise.map((e) => (typeof e === 'string' ? { name: e, minutes: 0 } : e)).filter((e) => e && e.name)
    : [];
  return c;
}

const hasAnyCheckin = (c) => c.water > 0 || !!c.mood || !!c.poop || c.sleep != null || c.exercise.length > 0;

const exerciseMinutes = (c) => c.exercise.reduce((s, e) => s + (Number(e.minutes) || 0), 0);

const moodOf = (key) => MOOD_LIST.find((m) => m.key === key);

/** 存一下打卡，成功后就地更新本地缓存，避免整页重渲染打断动画 */
async function saveCheckin(date, patch) {
  try {
    const res = await api.saveCheckin(date, patch);
    if (!state.db.checkins) state.db.checkins = {};
    state.db.checkins[date] = res.checkin;
    return res.checkin;
  } catch (err) {
    toastErr(err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 月历                                                                */
/* ------------------------------------------------------------------ */

/** 某天有哪些痕迹 */
function dayMarks(date) {
  const hasW = (state.db?.weights || []).some((w) => dateStr(new Date(w.at)) === date);
  const hasM = (state.db?.meals || []).some((m) => m.date === date);
  const hasC = hasAnyCheckin(checkinOf(date));
  const isP = (state.db?.periods || []).some((p) => date >= p.start && date <= (p.end || p.start));
  return { hasW, hasM, hasC, isP };
}

/** 渲染一个月历；cursor 是这个月里的任意一天 */
function calendarHtml(cursor, selected) {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // 周一当一周第一天
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayStr();

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<button class="cal__cell is-empty" disabled></button>');

  let recorded = 0;
  let checked = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const mk = dayMarks(date);
    if (mk.hasW || mk.hasM) recorded++;
    if (mk.hasC) checked++;

    const cls = [
      'cal__cell',
      mk.hasW || mk.hasM || mk.hasC ? 'has-any' : '',
      date === today ? 'is-today' : '',
      date > today ? 'is-future' : '',
      mk.isP ? 'is-period' : '',
      date === selected ? 'is-selected' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const dots = [
      mk.hasW ? '<i style="background:#f2688f"></i>' : '',
      mk.hasM ? '<i style="background:#ffcfa8"></i>' : '',
      mk.hasC ? '<i style="background:#5fc79c"></i>' : '',
    ].join('');

    // 注意：这里 push 的是 html`` 返回的字符串，不能包 raw()，
    // 否则 cells.join('') 会把 {__raw} 对象拼成 [object Object]
    cells.push(
      html`
        <button class="${cls}" data-cal-day="${date}" style="animation-delay:${(d * 11) % 220}ms">
          <span class="cal__cell__num">${d}</span>
          <span class="cal__cell__dots">${raw(dots || '<i style="opacity:0"></i>')}</span>
          ${mk.isP ? raw('<span class="cal__cell__flower">🌸</span>') : ''}
        </button>
      `,
    );
  }

  // 记录率的分母只算"已经过去的日子"。
  // 拿整月当天数会把还没到的日子算成漏记，月初看起来像在偷懒。
  const now = parseDay(today);
  const sameMonth = y === now.getFullYear() && m === now.getMonth();
  const elapsed = sameMonth ? Math.min(daysInMonth, now.getDate()) : daysInMonth;
  const rate = elapsed ? Math.round((recorded / elapsed) * 100) : 0;

  return html`
    <div class="cal">
      <div class="cal__head">
        <button class="cal__nav" data-cal-prev aria-label="上个月">‹</button>
        <div class="cal__title">${y} 年 ${m + 1} 月</div>
        <button class="cal__nav" data-cal-next aria-label="下个月">›</button>
      </div>
      <div class="cal__week">
        ${raw(['一', '二', '三', '四', '五', '六', '日'].map((w) => html`<span>${w}</span>`).join(''))}
      </div>
      <div class="cal__grid">${raw(cells.join(''))}</div>
      <div class="cal-legend">
        <span><i style="background:#f2688f"></i>体重</span>
        <span><i style="background:#ffcfa8"></i>饮食</span>
        <span><i style="background:#5fc79c"></i>打卡</span>
        <span><i style="background:#ffd0e2"></i>经期</span>
      </div>
      <div class="tiny muted mt-12">
        ${sameMonth ? `这个月已过 ${elapsed} 天，` : ''}记了 <b>${recorded}</b> 天，打卡 <b>${checked}</b> 天${
          elapsed ? ` · 记录率 ${rate}%` : ''
        }
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* 经期卡片                                                            */
/* ------------------------------------------------------------------ */

function cycleCardHtml(info, periods) {
  const ongoing = info.ongoing ? periods.find((p) => p.start === info.lastStart && !p.end) : null;
  const day = info.dayOfCycle || 0;
  const pct = info.cycleLength ? clamp(day / info.cycleLength, 0, 1) : 0;
  const r = 40;
  const c = 2 * Math.PI * r;

  return html`
    <div class="card">
      <div class="card__title">
        🌸 经期
        <span class="grow"></span>
        <span class="tiny muted">
          ${info.hasData ? (info.estimated ? '周期是估算的' : `${info.cycleLength} 天周期`) : '记一次就能开始推算'}
        </span>
      </div>

      ${info.hasData
        ? raw(html`
            <div class="row" style="gap:16px;align-items:center">
              <div class="cycle-ring">
                <svg viewBox="0 0 100 100" style="transform:rotate(-90deg)">
                  <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--berry-mist)" stroke-width="9"></circle>
                  <circle
                    cx="50"
                    cy="50"
                    r="${r}"
                    fill="none"
                    stroke="var(--strawberry)"
                    stroke-width="9"
                    stroke-linecap="round"
                    stroke-dasharray="${c.toFixed(1)}"
                    stroke-dashoffset="${(c * (1 - pct)).toFixed(1)}"
                  ></circle>
                </svg>
                <div class="cycle-ring__inner">
                  <div class="cycle-ring__day">${info.ongoing ? info.ongoingDay : day > 0 ? day : '—'}</div>
                  <div class="cycle-ring__cap">${info.ongoing ? '经期第几天' : '周期第几天'}</div>
                </div>
              </div>
              <div class="grow">
                <div class="bold" style="font-size:15px">${periodStageText(info)}</div>
                <div class="tiny muted mt-8" style="line-height:1.7">
                  上次开始：${info.lastStart.slice(5).replace('-', ' 月 ')} 日
                  ${info.nextStart
                    ? raw(
                        html`<br />下次预计：${info.nextStart.slice(5).replace('-', ' 月 ')} 日${
                          info.daysToNext != null ? `（还有 ${info.daysToNext} 天）` : ''
                        }`,
                      )
                    : ''}
                  ${info.bleedLength ? raw(html`<br />平均经期：${info.bleedLength} 天`) : ''}
                </div>
              </div>
            </div>
          `)
        : raw(html`
            <div class="tiny muted" style="line-height:1.75">
              记下经期开始的日子，之后就能帮你推算周期、提前提醒「这几天体重上涨是正常的」。
            </div>
          `)}

      <div class="row row--wrap mt-16" style="gap:8px">
        ${ongoing
          ? raw(html`
              <button class="btn btn--primary btn--sm" data-period-end>今天结束了</button>
              <button class="btn btn--plain btn--sm" data-period-del="${ongoing.id}">删掉这次</button>
            `)
          : raw(html`<button class="btn btn--primary btn--sm" data-period-start>🩸 今天来经期了</button>`)}
        <button class="btn btn--ghost btn--sm" data-period-manual>手动记一个日期</button>
      </div>

      ${periods.length > 1
        ? raw(html`
            <div class="tiny muted mt-12">
              历史：${periods
                .slice(-5)
                .reverse()
                .map(
                  (p) =>
                    `${p.start.slice(5).replace('-', '/')}${
                      p.end ? `–${p.end.slice(5).replace('-', '/')}` : '（进行中）'
                    }`,
                )
                .join(' · ')}
            </div>
          `)
        : ''}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

export async function render(root, ctx) {
  const today = todayStr();
  let calCursor = state.__calCursor ? new Date(state.__calCursor) : parseDay(today);
  let selected = state.__calSelected || today;

  let ci = checkinOf(today);
  let info = periodInfo(state.db);
  let periods = state.db?.periods || [];

  function completion() {
    const items = [
      { ok: ci.water >= CUP_GOAL, emoji: '💧', label: '喝水' },
      { ok: !!ci.mood, emoji: '😊', label: '心情' },
      { ok: !!ci.poop, emoji: '💩', label: '便便' },
      { ok: exerciseMinutes(ci) > 0, emoji: '🏃', label: '运动' },
      { ok: ci.sleep != null, emoji: '😴', label: '睡眠' },
      { ok: !!ci.note, emoji: '📝', label: '随手记' },
    ];
    const done = items.filter((i) => i.ok).length;
    return { items, done, total: items.length, pct: Math.round((done / items.length) * 100) };
  }

  function ringHtml(pct, center, size) {
    const r = 40;
    const c = 2 * Math.PI * r;
    return html`
      <div class="ring ring--sm" style="width:${size}px;height:${size}px">
        <svg viewBox="0 0 100 100" style="transform:rotate(-90deg)">
          <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--berry-mist)" stroke-width="9"></circle>
          <circle
            cx="50"
            cy="50"
            r="${r}"
            fill="none"
            stroke="url(#ringGrad)"
            stroke-width="9"
            stroke-linecap="round"
            stroke-dasharray="${c.toFixed(1)}"
            stroke-dashoffset="${(c * (1 - clamp(pct / 100, 0, 1))).toFixed(1)}"
          ></circle>
        </svg>
        <div class="ring__center">
          <div>
            <div class="ring__pct" style="font-size:17px">${pct}%</div>
            <div class="ring__cap">${center}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderPage() {
    const st = state.stats || {};
    const comp = completion();
    const waterPct = clamp(ci.water / CUP_GOAL, 0, 1);
    const waterFull = ci.water >= CUP_GOAL;
    const exMin = exerciseMinutes(ci);
    const waterHint =
      ci.water >= CUP_GOAL
        ? '今天的水够啦，很棒 💚'
        : ci.water === 0
          ? '还没喝水哦，先来一杯'
          : `还差 ${CUP_GOAL - ci.water} ml 就达标了`;

    root.innerHTML = html`
      <div class="view">
        <div class="card">
          <div class="card__title">
            ✅ 今日打卡
            <span class="grow"></span>
            <span class="tiny muted" data-comp-count>${comp.done}/${comp.total} 完成</span>
          </div>
          <div class="row" style="gap:14px;align-items:center">
            <span data-comp-ring>${raw(ringHtml(comp.pct, `${comp.done}/${comp.total}`, 84))}</span>
            <div class="grow">
              <div class="bold" style="font-size:15px" data-comp-label>
                ${comp.pct === 100
                  ? '今天全都打卡啦，好乖 🎉'
                  : comp.pct >= 50
                    ? '已经过半了，继续～'
                    : '今天想先记哪一样？'}
              </div>
              <div class="row row--wrap mt-8" style="gap:6px">
                ${raw(
                  comp.items
                    .map(
                      (i) =>
                        html`<span class="chip chip--soft${i.ok ? ' is-on' : ''}" style="pointer-events:none;font-size:11.5px">
                          ${i.emoji} ${i.label}
                        </span>`,
                    )
                    .join(''),
                )}
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="check-section">
            <div class="check-section__head">
              💧 喝水
              <span class="grow"></span>
              ${st.waterStreak > 1 ? raw(html`<span class="tiny muted">连续达标 ${st.waterStreak} 天</span>`) : ''}
            </div>
            <div class="row" style="gap:16px;align-items:center">
              <div class="cup${waterFull ? ' is-full' : ''}" data-cup style="--pct:${waterPct.toFixed(3)}">
                <div class="cup__fill"><span class="cup__wave"></span></div>
                <div class="cup__text">
                  <span data-water-num>${ci.water}</span>
                  <small>/ ${CUP_GOAL} ml</small>
                </div>
              </div>
              <div class="grow">
                <div class="bold" style="font-size:13.5px" data-water-hint>${waterHint}</div>
                <div
                  class="water-bar${waterFull ? ' is-full' : ''} mt-8"
                  data-water-bar
                  style="--pct:${waterPct.toFixed(3)}"
                >
                  <div class="water-bar__fill"></div>
                </div>
                <div class="water-btns mt-12">
                  ${raw(
                    WATER_STEPS.map(
                      (s) => html`<button class="btn btn--ghost btn--sm" data-water-add="${s}">+${s}</button>`,
                    ).join(''),
                  )}
                  <button class="btn btn--plain btn--sm" data-water-add="-200" ${ci.water <= 0 ? 'disabled' : ''}>
                    −200
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="check-section">
            <div class="check-section__head">😊 今天心情</div>
            <div class="chips">
              ${raw(
                MOOD_LIST.map(
                  (m) =>
                    html`<button class="chip${ci.mood === m.key ? ' is-on' : ''}" data-mood="${m.key}">
                      ${m.emoji} ${m.label}
                    </button>`,
                ).join(''),
              )}
            </div>
          </div>

          <div class="check-section">
            <div class="check-section__head">
              💩 便便
              <span class="grow"></span>
              <span class="tiny muted">通畅也是减脂顺利的信号</span>
            </div>
            <div class="chips">
              ${raw(
                POOP_LIST.map(
                  (p) =>
                    html`<button class="chip${ci.poop === p.key ? ' is-on' : ''}" data-poop="${p.key}">
                      ${p.emoji} ${p.label}
                    </button>`,
                ).join(''),
              )}
            </div>
          </div>

          <div class="check-section">
            <div class="check-section__head">
              🏃 运动
              <span class="grow"></span>
              ${exMin ? raw(html`<span class="tiny muted">今天 ${exMin} 分钟</span>`) : ''}
            </div>
            <div class="chips">
              ${raw(
                EXERCISES.map(
                  (name) =>
                    html`<button
                      class="chip${ci.exercise.some((e) => e.name === name) ? ' is-on' : ''}"
                      data-ex="${name}"
                    >
                      ${name}
                    </button>`,
                ).join(''),
              )}
            </div>
            ${ci.exercise.length
              ? raw(html`
                  <div class="row row--wrap mt-12" style="gap:8px">
                    ${raw(
                      ci.exercise
                        .map(
                          (e) => html`
                            <span class="period-day">
                              ${e.name}
                              <b>${e.minutes || 0}′</b>
                              <button
                                class="cal__nav"
                                style="width:22px;height:22px;font-size:12px"
                                data-ex-minus="${e.name}"
                              >
                                −
                              </button>
                              <button
                                class="cal__nav"
                                style="width:22px;height:22px;font-size:12px"
                                data-ex-plus="${e.name}"
                              >
                                +
                              </button>
                            </span>
                          `,
                        )
                        .join(''),
                    )}
                  </div>
                  <div class="tiny muted mt-8">右边的 + − 是每次 10 分钟</div>
                `)
              : raw(html`<div class="tiny muted mt-8">点一项加上，默认 30 分钟</div>`)}
          </div>

          <div class="check-section">
            <div class="check-section__head">
              😴 睡眠
              <span class="grow"></span>
              <span class="tiny muted">建议 7–8 小时</span>
            </div>
            <div class="row" style="gap:10px;align-items:center">
              <div class="mini-num">
                <button data-sleep-minus>−</button>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="24"
                  data-sleep
                  value="${ci.sleep ?? ''}"
                  placeholder="—"
                />
                <button data-sleep-plus>+</button>
              </div>
              <span class="tiny muted">小时</span>
              <div class="grow"></div>
              ${ci.sleep != null && ci.sleep < 6.5
                ? raw(html`<span class="badge badge--meh">睡少了容易饿哦</span>`)
                : ci.sleep != null && ci.sleep >= SLEEP_GOAL
                  ? raw(html`<span class="badge badge--great">睡得不错 💚</span>`)
                  : ''}
            </div>
          </div>

          <div class="check-section">
            <div class="check-section__head">📝 随手记</div>
            <textarea class="input" rows="2" data-note placeholder="今天有什么想说的？比如：下午特别想吃甜的…">${ci.note || ''}</textarea>
            <button class="btn btn--primary btn--block mt-12" data-save-note>保存这句话</button>
          </div>
        </div>

        ${raw(cycleCardHtml(info, periods))}

        <div class="card">
          <div class="card__title">
            📅 这个月
            <span class="grow"></span>
            <span class="tiny muted">点某天看那天的记录</span>
          </div>
          ${raw(calendarHtml(calCursor, selected))}
        </div>
      </div>
    `;

    wire();
  }

  /* ---- 交互 ---- */

  function syncTop() {
    const comp = completion();
    const ringHost = qs('[data-comp-ring]', root);
    if (ringHost) ringHost.innerHTML = ringHtml(comp.pct, `${comp.done}/${comp.total}`, 84);
    const label = qs('[data-comp-label]', root);
    if (label) {
      label.textContent =
        comp.pct === 100
          ? '今天全都打卡啦，好乖 🎉'
          : comp.pct >= 50
            ? '已经过半了，继续～'
            : '今天想先记哪一样？';
    }
    const count = qs('[data-comp-count]', root);
    if (count) count.textContent = `${comp.done}/${comp.total} 完成`;
  }

  function wire() {
    /* 喝水 */
    root.querySelectorAll('[data-water-add]').forEach((b) => {
      b.onclick = async () => {
        const step = Number(b.dataset.waterAdd);
        const before = ci.water;
        const next = Math.max(0, before + step);
        if (next === before) return;
        ci = { ...ci, water: next };
        await saveCheckin(today, { water: next });

        // 就地更新，不整页重绘，动画才连得上
        const cup = qs('[data-cup]', root);
        const bar = qs('[data-water-bar]', root);
        const numEl = qs('[data-water-num]', root);
        const hint = qs('[data-water-hint]', root);
        const pct = clamp(next / CUP_GOAL, 0, 1);
        if (cup) {
          cup.style.setProperty('--pct', pct.toFixed(3));
          cup.classList.toggle('is-full', next >= CUP_GOAL);
          cup.classList.remove('is-pouring');
          void cup.offsetWidth;
          cup.classList.add('is-pouring');
        }
        if (bar) {
          bar.style.setProperty('--pct', pct.toFixed(3));
          bar.classList.toggle('is-full', next >= CUP_GOAL);
        }
        if (numEl) numEl.textContent = next;
        if (hint) {
          hint.textContent =
            next >= CUP_GOAL
              ? '今天的水够啦，很棒 💚'
              : next === 0
                ? '还没喝水哦，先来一杯'
                : `还差 ${CUP_GOAL - next} ml 就达标了`;
        }
        if (step > 0) burstFrom(b, ['💧', '🫧', '💙'], 7);
        if (before < CUP_GOAL && next >= CUP_GOAL) {
          confetti({ count: 70, originY: 0.4 });
          toastOk('喝水达标啦 💧');
        }
        if (state.stats) {
          state.stats.waterToday = next;
          state.stats.waterDone = next >= CUP_GOAL;
        }
        syncTop();
      };
    });

    /* 心情 */
    root.querySelectorAll('[data-mood]').forEach((b) => {
      b.onclick = async () => {
        const key = b.dataset.mood;
        const next = ci.mood === key ? '' : key;
        ci = { ...ci, mood: next };
        await saveCheckin(today, { mood: next });
        renderPage();
        if (next) {
          const again = qs(`[data-mood="${next}"]`, root);
          if (again) {
            again.classList.add('is-jelly');
            burstFrom(again, [moodOf(next)?.emoji || '💗', '✨'], 6);
          }
        }
      };
    });

    /* 便便 */
    root.querySelectorAll('[data-poop]').forEach((b) => {
      b.onclick = async () => {
        const key = b.dataset.poop;
        const next = ci.poop === key ? '' : key;
        ci = { ...ci, poop: next };
        await saveCheckin(today, { poop: next });
        renderPage();
        if (next) {
          const again = qs(`[data-poop="${next}"]`, root);
          if (again) again.classList.add('is-jelly');
        }
      };
    });

    /* 运动 */
    root.querySelectorAll('[data-ex]').forEach((b) => {
      b.onclick = async () => {
        const name = b.dataset.ex;
        const has = ci.exercise.some((e) => e.name === name);
        const list = has ? ci.exercise.filter((e) => e.name !== name) : [...ci.exercise, { name, minutes: 30 }];
        ci = { ...ci, exercise: list };
        await saveCheckin(today, { exercise: list });
        renderPage();
        if (!has) {
          const again = qs(`[data-ex="${name}"]`, root);
          if (again) {
            again.classList.add('is-jelly');
            burstFrom(again, ['🏃', '💪', '🔥'], 6);
          }
        }
      };
    });

    root.querySelectorAll('[data-ex-plus], [data-ex-minus]').forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const name = b.dataset.exPlus || b.dataset.exMinus;
        const delta = b.dataset.exPlus ? 10 : -10;
        const list = ci.exercise
          .map((x) => (x.name === name ? { ...x, minutes: Math.max(0, (x.minutes || 0) + delta) } : x))
          .filter((x) => !(x.name === name && x.minutes <= 0));
        ci = { ...ci, exercise: list };
        await saveCheckin(today, { exercise: list });
        renderPage();
      };
    });

    /* 睡眠 */
    const sleepInput = qs('[data-sleep]', root);
    const nudge = async (d) => {
      const cur = ci.sleep == null ? 7 : Number(ci.sleep);
      const next = clamp(Math.round((cur + d) * 2) / 2, 0, 24);
      ci = { ...ci, sleep: next };
      await saveCheckin(today, { sleep: next });
      renderPage();
    };
    qs('[data-sleep-plus]', root).onclick = () => nudge(0.5);
    qs('[data-sleep-minus]', root).onclick = () => nudge(-0.5);
    sleepInput.onchange = async () => {
      const v = sleepInput.value === '' ? null : clamp(Number(sleepInput.value), 0, 24);
      ci = { ...ci, sleep: v };
      await saveCheckin(today, { sleep: v });
      renderPage();
    };

    /* 随手记 */
    qs('[data-save-note]', root).onclick = async (e) => {
      const ta = qs('[data-note]', root);
      const text = ta.value.trim();
      if (!text) {
        shake(ta);
        toastErr('先写点什么吧～');
        return;
      }
      const restore = withLoading(e.currentTarget, '保存中');
      ci = { ...ci, note: text };
      await saveCheckin(today, { note: text });
      restore();
      toastOk('记下来啦 📝');
      renderPage();
    };

    /* 月历翻页 */
    qs('[data-cal-prev]', root).onclick = () => {
      calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
      state.__calCursor = calCursor.toISOString();
      renderPage();
    };
    qs('[data-cal-next]', root).onclick = () => {
      calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
      state.__calCursor = calCursor.toISOString();
      renderPage();
    };

    /* 点某天 */
    root.querySelectorAll('[data-cal-day]').forEach((b) => {
      b.onclick = () => {
        selected = b.dataset.calDay;
        state.__calSelected = selected;
        openDaySheet(selected);
      };
    });

    /* 经期 */
    const startBtn = qs('[data-period-start]', root);
    if (startBtn) {
      startBtn.onclick = async (e) => {
        const restore = withLoading(e.currentTarget, '记录中');
        try {
          await api.addPeriod({ start: today });
          await reload();
          info = periodInfo(state.db);
          periods = state.db?.periods || [];
          restore();
          confetti({ count: 60, originY: 0.45 });
          toastOk('记下了，之后会帮你提醒 🌸');
          renderPage();
        } catch (err) {
          restore();
          toastErr(err.message);
        }
      };
    }

    const endBtn = qs('[data-period-end]', root);
    if (endBtn) {
      endBtn.onclick = async (e) => {
        const cur = periods.find((p) => p.start === info.lastStart && !p.end);
        if (!cur) return;
        const restore = withLoading(e.currentTarget, '记录中');
        try {
          await api.updatePeriod(cur.id, { end: today });
          await reload();
          info = periodInfo(state.db);
          periods = state.db?.periods || [];
          restore();
          toastOk('这次经期记完啦～');
          renderPage();
        } catch (err) {
          restore();
          toastErr(err.message);
        }
      };
    }

    const delBtn = qs('[data-period-del]', root);
    if (delBtn) {
      delBtn.onclick = async () => {
        const goAhead = await confirmDialog({
          title: '删掉这次经期记录？',
          desc: '删掉之后推算会用上一次的数据',
          okText: '删掉',
          danger: true,
        });
        if (!goAhead) return;
        await api.deletePeriod(delBtn.dataset.periodDel);
        await reload();
        info = periodInfo(state.db);
        periods = state.db?.periods || [];
        toastOk('删掉啦');
        renderPage();
      };
    }

    qs('[data-period-manual]', root).onclick = () => openPeriodSheet();
  }

  /* ---- 某一天的详情抽屉 ---- */

  function openDaySheet(date) {
    const dayCheckin = checkinOf(date);
    const ws = (state.db?.weights || []).filter((w) => dateStr(new Date(w.at)) === date);
    const ms = (state.db?.meals || []).filter((m) => m.date === date);
    const totalKcal = ms.reduce((s, m) => s + (m.analysis?.kcal || 0), 0);
    const d = parseDay(date);
    const label = `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${weekday(date)}`;
    const none = raw('<span class="muted" style="font-weight:600">没记</span>');

    openSheet({
      title: label,
      emoji: date === today ? '🌟' : '📅',
      content: html`
        <div class="kv-list">
          <div class="kv">
            <span class="kv__k">⚖️ 体重</span>
            <span class="kv__v">${ws.length ? raw(ws.map((w) => `${w.kg}kg`).join(' / ')) : none}</span>
          </div>
          <div class="kv">
            <span class="kv__k">🍚 饮食</span>
            <span class="kv__v">
              ${ms.length ? raw(`${ms.length} 顿${totalKcal ? ` · 约 ${totalKcal} kcal` : ''}`) : none}
            </span>
          </div>
          <div class="kv">
            <span class="kv__k">💧 喝水</span>
            <span class="kv__v">${dayCheckin.water ? `${dayCheckin.water} ml` : none}</span>
          </div>
          <div class="kv">
            <span class="kv__k">😊 心情</span>
            <span class="kv__v">
              ${dayCheckin.mood ? `${moodOf(dayCheckin.mood)?.emoji || ''} ${moodOf(dayCheckin.mood)?.label || ''}` : none}
            </span>
          </div>
          <div class="kv">
            <span class="kv__k">🏃 运动</span>
            <span class="kv__v">
              ${dayCheckin.exercise.length
                ? raw(dayCheckin.exercise.map((e) => `${e.name} ${e.minutes || 0}′`).join(' · '))
                : none}
            </span>
          </div>
          <div class="kv">
            <span class="kv__k">😴 睡眠</span>
            <span class="kv__v">${dayCheckin.sleep != null ? `${dayCheckin.sleep} 小时` : none}</span>
          </div>
        </div>

        ${dayCheckin.note
          ? raw(
              html`<div class="bloat-tip mt-16">
                <span class="bloat-tip__emoji">📝</span><span>${dayCheckin.note}</span>
              </div>`,
            )
          : ''}
        ${ms.length
          ? raw(html`
              <div class="tiny muted mt-16">那天吃了</div>
              <div class="mt-8">
                ${raw(
                  ms
                    .map(
                      (m) => html`
                        <div class="list-item" style="animation:none">
                          <div class="list-item__icon">${m.analysis ? '🍽️' : '📝'}</div>
                          <div class="grow">
                            <div class="bold tiny">${m.text || '（只记了照片）'}</div>
                            <div class="tiny muted">${m.analysis ? `健康分 ${m.analysis.score}` : '还没分析'}</div>
                          </div>
                        </div>
                      `,
                    )
                    .join(''),
                )}
              </div>
            `)
          : ''}

        <div class="sheet__actions mt-16">
          <button class="btn btn--ghost" data-day-go="food">去补记饮食</button>
          <button class="btn btn--primary" data-day-go="weight">去记体重</button>
        </div>
      `,
      onMount(box, closeFn) {
        box.querySelectorAll('[data-day-go]').forEach((b) => {
          b.onclick = () => {
            closeFn();
            if (b.dataset.dayGo === 'food') state.__foodDate = date;
            if (b.dataset.dayGo === 'weight') state.__weightDate = date;
            import('../router.js').then(({ go }) => go(b.dataset.dayGo));
          };
        });
      },
    });
  }

  /* ---- 手动记经期 ---- */

  function openPeriodSheet() {
    openSheet({
      title: '手动记一次经期',
      emoji: '🌸',
      content: html`
        <div class="field">
          <label class="field__label">开始日期</label>
          <input class="input" type="date" data-p-start value="${today}" max="${today}" />
        </div>
        <div class="field mt-12">
          <label class="field__label">结束日期（还不知道就留空）</label>
          <input class="input" type="date" data-p-end max="${today}" />
        </div>
        <div class="sheet__actions mt-16">
          <button class="btn btn--plain" data-p-cancel>取消</button>
          <button class="btn btn--primary" data-p-save>保存</button>
        </div>
      `,
      onMount(box, closeFn) {
        qs('[data-p-cancel]', box).onclick = closeFn;
        qs('[data-p-save]', box).onclick = async (e) => {
          const start = qs('[data-p-start]', box).value;
          const end = qs('[data-p-end]', box).value || null;
          if (!start) {
            shake(qs('[data-p-start]', box));
            toastErr('选一个开始日期吧');
            return;
          }
          const restore = withLoading(e.currentTarget, '保存中');
          try {
            await api.addPeriod({ start, end });
            await reload();
            info = periodInfo(state.db);
            periods = state.db?.periods || [];
            restore();
            closeFn();
            toastOk('记好啦 🌸');
            renderPage();
          } catch (err) {
            restore();
            toastErr(err.message);
          }
        };
      },
    });
  }

  renderPage();

  // 打开就发现今天什么都没记，轻轻提一句（每次进页面只说一次）
  if (!hasAnyCheckin(ci) && !state.__checkinHinted) {
    state.__checkinHinted = true;
    setTimeout(() => toastOk('今天还什么都没记哦，随手点两下就好 📅', 3000), 800);
  }
  void ctx;
}
