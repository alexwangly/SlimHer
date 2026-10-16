import {
  html,
  raw,
  esc,
  fmtKg,
  fmt,
  greeting,
  dayLabel,
  todayStr,
  timeLabel,
  LEVEL_INFO,
  slotOf,
} from '../utils.js';
import { state, profile, latestWeight, previousWeight, mealsOn, daysFromWeights, cacheGet, cacheSet } from '../state.js';
import { mascotSvg, moodFor } from '../mascot.js';
import { api } from '../api.js';
import { toastErr, countUp, withLoading, burstFrom } from '../ui.js';
import { go } from '../router.js';
import { qs } from '../utils.js';
import { periodInfo, bloatExplain } from '../period.js';

const LOCAL_TIPS = [
  '今天也不用完美，只要比昨天多做对一点点～',
  '体重会骗人，但坚持不会。慢慢来呀 🌷',
  '喝水了吗？先干一杯，再谈减脂 🥤',
  '不饿就别吃，饿了就好好吃，别熬着 🍚',
  '秤上的数字只是数据，不是你的成绩单 💗',
  '睡够 7 小时，比少吃一顿更有用哦 😴',
  '今天的你，已经比放弃的你厉害多了 ✨',
];

export async function render(root) {
  const p = profile();
  const st = state.stats || {};
  const mood = moodFor(st);
  const greet = greeting();
  const last = latestWeight();
  const prev = last ? previousWeight(last) : null;
  const delta = last && prev ? +(last.kg - prev.kg).toFixed(2) : null;
  const nickname = p.nickname || '小米';
  const goalProgress = st.goalProgress;
  const todayMeals = mealsOn(todayStr());

  // 今天打卡到哪了（喝水够不够一眼就能看到）
  const ci = { water: 0, mood: '', poop: '', sleep: null, exercise: [], ...(state.db?.checkins?.[todayStr()] || {}) };
  ci.exercise = Array.isArray(ci.exercise) ? ci.exercise : [];
  const water = Number(ci.water) || 0;
  const WATER_GOAL = 1500;
  const waterPct = Math.min(1, water / WATER_GOAL);
  const waterFull = water >= WATER_GOAL;
  const exMin = ci.exercise.reduce((s, e) => s + (Number(e?.minutes) || 0), 0);

  // 经期前后体重上涨时，先把话说在前面，免得她被秤吓到
  const bloat = bloatExplain(periodInfo(state.db), st.trend7);

  const tipKey = `tip:${todayStr()}`;
  const tip = cacheGet(tipKey);
  const localTip = LOCAL_TIPS[new Date().getDate() % LOCAL_TIPS.length];

  root.innerHTML = html`
    <div class="view">
      <!-- 主卡片 -->
      <div class="card card--hero">
        <div class="row">
          <div class="mascot-wrap" data-mascot>${raw(mascotSvg({ mood, width: 104 }))}</div>
          <div class="grow">
            <div class="tiny bold soft">${greet.emoji} ${greet.text}，${nickname}</div>
            ${last
              ? raw(html`
                  <div class="big-number mt-8">
                    <span data-cur>0</span><small>kg</small>
                  </div>
                  <div class="row row--wrap mt-8" style="gap:6px">
                    ${delta != null
                      ? raw(
                          `<span class="badge ${delta < 0 ? 'badge--great' : delta > 0 ? 'badge--meh' : ''}">
                             ${delta < 0 ? '↓' : delta > 0 ? '↑' : '—'} ${Math.abs(delta).toFixed(1)}kg 较上次
                           </span>`,
                        )
                      : ''}
                    ${st.toGoal != null
                      ? raw(
                          `<span class="badge ${Math.abs(st.toGoal) < 0.05 ? 'badge--great' : ''}">
                             距目标 ${fmtKg(Math.abs(st.toGoal))}kg
                           </span>`,
                        )
                      : ''}
                  </div>
                `)
              : raw(html`
                  <div class="mt-8 bold" style="font-size:17px">还没有记过体重哦</div>
                  <div class="tiny muted mt-8">记下第一笔，我们就有起点啦</div>
                `)}
          </div>
        </div>

        ${last
          ? raw(html`
              <div class="progress mt-16">
                <div class="progress__bar" style="width:${goalProgress ?? 0}%"></div>
              </div>
              <div class="row row--between tiny muted mt-8">
                <span>起点 ${fmtKg(st.startWeight)}kg</span>
                <span class="bold" style="color:var(--strawberry-deep)">
                  ${goalProgress != null ? `已完成 ${goalProgress}%` : '设置目标后可以看进度'}
                </span>
                <span>目标 ${st.targetWeight != null ? fmtKg(st.targetWeight) + 'kg' : '未设置'}</span>
              </div>
            `)
          : raw(html`
              <button class="btn btn--primary btn--block btn--lg mt-16" data-go="weight">
                ⚖️ 去记第一笔体重
              </button>
            `)}
      </div>

      <!-- 快捷入口 -->
      <div class="row mt-12" style="gap:10px">
        <button class="btn btn--ghost grow" data-go="weight" style="flex-direction:column;padding:12px 8px">
          <span style="font-size:20px">⚖️</span><span class="tiny">记体重</span>
        </button>
        <button class="btn btn--ghost grow" data-go="food" style="flex-direction:column;padding:12px 8px">
          <span style="font-size:20px">🍚</span><span class="tiny">记一顿</span>
        </button>
        <button class="btn btn--ghost grow" data-go="decide" style="flex-direction:column;padding:12px 8px">
          <span style="font-size:20px">🎲</span><span class="tiny">吃啥好</span>
        </button>
        <button class="btn btn--ghost grow" data-go="checkin" style="flex-direction:column;padding:12px 8px">
          <span style="font-size:20px">📅</span><span class="tiny">去打卡</span>
        </button>
      </div>

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

      <!-- 今天打卡了没：喝水一眼可见 -->
      <div class="card">
        <div class="card__title">
          ✅ 今天的打卡
          <span class="hint" data-go="checkin" style="cursor:pointer">去打卡 ›</span>
        </div>
        <div class="row" style="gap:14px;align-items:center">
          <button class="cup${waterFull ? ' is-full' : ''}" data-cup-quick style="--pct:${waterPct.toFixed(3)};cursor:pointer">
            <div class="cup__fill"><span class="cup__wave"></span></div>
            <div class="cup__text">
              <span>${water}</span>
              <small>/ 1500 ml</small>
            </div>
          </button>
          <div class="grow">
            <div class="bold" style="font-size:13.5px">
              ${waterFull ? '今天水够啦 💚' : water === 0 ? '还没喝水哦' : `还差 ${1500 - water} ml`}
            </div>
            <div class="water-bar${waterFull ? ' is-full' : ''} mt-8" style="--pct:${waterPct.toFixed(3)}">
              <div class="water-bar__fill"></div>
            </div>
            <div class="row row--wrap mt-8" style="gap:6px">
              ${ci.mood ? raw(html`<span class="chip chip--soft is-on" style="pointer-events:none">心情已记</span>`) : ''}
              ${ci.poop ? raw(html`<span class="chip chip--soft is-on" style="pointer-events:none">便便已记</span>`) : ''}
              ${
                exMin
                  ? raw(html`<span class="chip chip--soft is-on" style="pointer-events:none">运动 ${exMin}′</span>`)
                  : ''
              }
              ${ci.sleep != null ? raw(html`<span class="chip chip--soft is-on" style="pointer-events:none">睡 ${ci.sleep}h</span>`) : ''}
              ${
                !ci.mood && !ci.poop && !exMin && ci.sleep == null
                  ? raw(html`<span class="tiny muted">点一下水杯就能加 200ml</span>`)
                  : ''
              }
            </div>
          </div>
        </div>
      </div>

      <!-- 今日概览 -->
      <div class="card mt-12 stagger">
        <div class="card__title">📊 记录概览<span class="hint">共 ${st.recordCount || 0} 笔</span></div>
        <div class="stat-grid">
          <div class="stat">
            <div class="stat__value">${fmtKg(st.totalLost ?? 0)}<small>kg</small></div>
            <div class="stat__label">已经减掉</div>
          </div>
          <div class="stat">
            <div class="stat__value">${st.streak ?? 0}<small>天</small></div>
            <div class="stat__label">连续记录</div>
          </div>
          <div class="stat">
            <div class="stat__value">${st.bmi != null ? fmt(st.bmi) : '--'}</div>
            <div class="stat__label">BMI ${st.bmiLabel || ''}</div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="stat-grid">
          <div class="stat">
            <div class="stat__value">${st.todayKcal || 0}<small>kcal</small></div>
            <div class="stat__label">今日已记录热量</div>
          </div>
          <div class="stat">
            <div class="stat__value">${st.todayScore != null ? st.todayScore : '--'}<small>分</small></div>
            <div class="stat__label">今日饮食健康分</div>
          </div>
          <div class="stat">
            <div class="stat__value">${todayMeals.length}<small>顿</small></div>
            <div class="stat__label">今日已记录</div>
          </div>
        </div>
      </div>

      <!-- 今日吃了啥 -->
      <div class="card">
        <div class="card__title">
          🍽️ 今天吃了什么
          <span class="hint">${dayLabel(todayStr())}</span>
        </div>
        ${todayMeals.length
          ? raw(
              todayMeals
                .map((m) => {
                  const slot = slotOf(m.slot);
                  const lv = m.analysis ? LEVEL_INFO[m.analysis.level] || LEVEL_INFO.good : null;
                  return html`
                    <div class="list-item">
                      <div class="list-item__icon" style="background:${raw(slot.tint)}">${slot.emoji}</div>
                      <div class="list-item__body">
                        <div class="list-item__title">${m.text || m.photoNote || slot.name}</div>
                        <div class="list-item__meta">
                          <span>${slot.name} ${timeLabel(m.at)}</span>
                          ${m.analysis
                            ? raw(`<span class="badge badge--${lv.cls}">${lv.emoji} ${lv.label}</span>`)
                            : raw('<span class="badge">待分析</span>')}
                          ${m.analysis?.kcal ? raw(`<span>约 ${m.analysis.kcal} kcal</span>`) : ''}
                        </div>
                      </div>
                    </div>
                  `;
                })
                .join(''),
            )
          : raw(html`
              <div class="empty">
                <span class="empty__mascot">🍽️</span>
                <div class="empty__text">今天还没记吃的～</div>
                <div class="empty__sub">记一顿，让小助手帮你看看健不健康</div>
                <button class="btn btn--primary btn--sm mt-12" data-go="food">去记一顿</button>
              </div>
            `)}
      </div>

      <!-- 小助手说 -->
      <div class="card card--tint">
        <div class="card__title">💌 小米团想说</div>
        <div class="row" style="gap:12px;align-items:flex-start">
          <div style="font-size:30px;line-height:1">${tip?.emoji || '🌸'}</div>
          <div class="grow">
            <div class="bold" style="font-size:14.5px;line-height:1.6" data-tip>
              ${tip?.tip || (state.ai.enabled && state.ai.configured ? '点下面按钮，让小助手给你说句话～' : localTip)}
            </div>
          </div>
        </div>
        <button class="btn btn--plain btn--sm mt-12" data-tip-btn>
          ${state.ai.enabled && state.ai.configured ? '✨ 换一句 AI 鼓励' : '💗 换一句鼓励'}
        </button>
      </div>

      <!-- 最近记录 -->
      ${weightMiniList()}
    </div>
  `;

  /* ---- 交互 ---- */

  // 数字滚动
  if (last) {
    const cur = qs('[data-cur]', root);
    countUp(cur, last.kg, { from: Math.max(0, last.kg - 1.5), dur: 1000, digits: 1 });
  }

  root.querySelectorAll('[data-go]').forEach((btn) => {
    btn.onclick = () => go(btn.dataset.go);
  });

  // 点首页的水杯直接 +200ml，不用跳页
  const cupQuick = qs('[data-cup-quick]', root);
  if (cupQuick) {
    cupQuick.onclick = async () => {
      const next = water + 200;
      try {
        await api.saveCheckin(todayStr(), { water: next });
        if (!state.db.checkins) state.db.checkins = {};
        state.db.checkins[todayStr()] = { ...ci, water: next };
        burstFrom(cupQuick, ['💧', '🫧'], 6);
        if (water < WATER_GOAL && next >= WATER_GOAL) {
          const { confetti: cf } = await import('../ui.js');
          cf({ count: 70 });
          toastOk('喝水达标啦 💧');
        }
        await render(root);
      } catch (err) {
        toastErr(err.message);
      }
    };
  }

  const tipBtn = qs('[data-tip-btn]', root);
  tipBtn.onclick = async () => {
    const restore = withLoading(tipBtn, '想想');
    try {
      if (state.ai.enabled && state.ai.configured) {
        const { tip: t } = await api.dailyTip();
        cacheSet(tipKey, t);
        qs('[data-tip]', root).textContent = t.tip;
        root.querySelector('.card--tint div[style*="font-size:30px"]').textContent = t.emoji || '🌸';
        burstFrom(tipBtn, ['💖', '✨', '🌸']);
      } else {
        const t = { tip: LOCAL_TIPS[Math.floor(Math.random() * LOCAL_TIPS.length)], emoji: '🌷' };
        cacheSet(tipKey, t);
        qs('[data-tip]', root).textContent = t.tip;
        burstFrom(tipBtn, ['💗', '🌷']);
      }
    } catch (err) {
      toastErr(err.message);
    } finally {
      restore();
    }
  };
}

function weightMiniList() {
  const days = daysFromWeights().slice(0, 3);
  if (!days.length) return raw('');
  return raw(html`
    <div class="card">
      <div class="card__title">
        ⚖️ 最近的体重
        <span class="hint" data-go="weight" style="cursor:pointer">全部 ›</span>
      </div>
      ${raw(
        days
          .map((d) => {
            const first = d.entries[0];
            const lastE = d.entries[d.entries.length - 1];
            const same = d.entries.length === 1;
            return html`
              <div class="list-item">
                <div class="list-item__icon">${d.entries.length > 1 ? '📈' : '⚖️'}</div>
                <div class="list-item__body">
                  <div class="list-item__title">${dayLabel(d.date)}</div>
                  <div class="list-item__meta">
                    <span>${same ? timeLabel(first.at) : `${d.entries.length} 次 · ${timeLabel(first.at)}→${timeLabel(lastE.at)}`}</span>
                  </div>
                </div>
                <div class="list-item__value">${fmtKg(lastE.kg)}<span class="tiny muted">kg</span></div>
              </div>
            `;
          })
          .join(''),
      )}
    </div>
  `);
}
