/**
 * 派生数据：打卡指标、经期推算、成就、周报月报。
 * 这些都是从 db 里算出来的，不单独存表，改口径时不用做数据迁移。
 */
import { localDate } from './store.mjs';

/* ------------------------------------------------------------------ */
/* 日期小工具                                                          */
/* ------------------------------------------------------------------ */

function parseDay(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function shiftDay(s, delta) {
  const d = parseDay(s);
  d.setDate(d.getDate() + delta);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysBetween(a, b) {
  const ms = parseDay(b) - parseDay(a);
  return Math.round(ms / 86400000);
}

/* ------------------------------------------------------------------ */
/* 打卡                                                                */
/* ------------------------------------------------------------------ */

export const DEFAULT_GOALS = {
  water: 1500, // ml
  sleep: 7.5, // 小时
  exercise: 30, // 分钟
};

export const EMPTY_CHECKIN = {
  water: 0,
  mood: '',
  poop: '',
  sleep: null,
  exercise: [],
  note: '',
};

export function normalizeCheckin(raw) {
  const c = { ...EMPTY_CHECKIN, ...(raw || {}) };
  c.water = Math.max(0, Math.round(Number(c.water) || 0));
  c.sleep = c.sleep == null || c.sleep === '' ? null : Math.max(0, Math.min(24, Number(c.sleep)));
  c.exercise = Array.isArray(c.exercise)
    ? c.exercise
        .map((e) => (typeof e === 'string' ? { name: e, minutes: 0 } : e))
        .filter((e) => e && e.name)
        .slice(0, 10)
    : [];
  c.mood = String(c.mood || '').slice(0, 12);
  c.poop = String(c.poop || '').slice(0, 12);
  c.note = String(c.note || '').slice(0, 200);
  return c;
}

const WATER_GOAL = DEFAULT_GOALS.water;

/** 打卡相关的连续/完成度指标 */
export function checkinMetrics(db) {
  const today = localDate();
  const entries = Object.entries(db.checkins || {}).map(([date, raw]) => [date, normalizeCheckin(raw)]);

  const done = (c) => c.water > 0 || c.mood || c.poop || c.sleep != null || c.exercise.length;
  const days = new Set(entries.filter(([, c]) => done(c)).map(([d]) => d));

  // 连续打卡（从今天或昨天往前数）
  let streak = 0;
  let cursor = today;
  if (!days.has(cursor)) cursor = shiftDay(cursor, -1);
  while (days.has(cursor)) {
    streak++;
    cursor = shiftDay(cursor, -1);
  }

  // 喝水达标连续天数
  const waterDays = new Set(entries.filter(([, c]) => c.water >= WATER_GOAL).map(([d]) => d));
  let waterStreak = 0;
  cursor = today;
  if (!waterDays.has(cursor)) cursor = shiftDay(cursor, -1);
  while (waterDays.has(cursor)) {
    waterStreak++;
    cursor = shiftDay(cursor, -1);
  }

  const todayCheckin = normalizeCheckin(db.checkins?.[today]);
  const last7 = entries.filter(([d]) => daysBetween(d, today) >= 0 && daysBetween(d, today) < 7);
  const waterAvg = last7.length
    ? Math.round(last7.reduce((s, [, c]) => s + c.water, 0) / last7.length)
    : 0;

  return {
    today,
    todayCheckin,
    checkedDays: days.size,
    streak,
    waterGoal: WATER_GOAL,
    waterStreak,
    waterAvg7: waterAvg,
    waterToday: todayCheckin.water,
    waterDone: todayCheckin.water >= WATER_GOAL,
  };
}

/* ------------------------------------------------------------------ */
/* 经期                                                                */
/* ------------------------------------------------------------------ */

/** 把 periods 按开始日期排序，顺便补全 */
function sortedPeriods(db) {
  return [...(db.periods || [])]
    .filter((p) => p && p.start)
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

/**
 * 周期推算。数据不够时用默认 28 天，并且明确告诉前端"这是估的"。
 */
export function periodInfo(db) {
  const today = localDate();
  const list = sortedPeriods(db);
  const finished = list.filter((p) => p.end);

  // 用相邻两次"开始日"的间隔平均出周期长度（只看 20~45 天的合理值）。
  // 这里刻意不要求上一次已经填了结束日：她很可能只点了"今天来经期了"，
  // 而最近这一轮间隔恰恰是最有参考价值的，不能因为没填 end 就丢掉。
  let cycleLength = 28;
  let estimated = true;
  if (list.length >= 2) {
    const gaps = [];
    for (let i = 1; i < list.length; i++) {
      const g = daysBetween(list[i - 1].start, list[i].start);
      if (g >= 20 && g <= 45) gaps.push(g);
    }
    if (gaps.length) {
      cycleLength = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      estimated = gaps.length < 2;
    }
  }

  // 平均经期长度
  let bleedLength = 5;
  const lens = finished.map((p) => daysBetween(p.start, p.end) + 1).filter((n) => n >= 1 && n <= 12);
  if (lens.length) bleedLength = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);

  const last = list[list.length - 1] || null;
  const ongoing = list.find((p) => !p.end && daysBetween(p.start, today) >= 0 && daysBetween(p.start, today) <= 12) || null;

  let dayOfCycle = null;
  let nextStart = null;
  let daysToNext = null;
  if (last) {
    dayOfCycle = daysBetween(last.start, today) + 1;
    nextStart = shiftDay(last.start, cycleLength);
    // 预测日已经过去了就往后推，最多推两轮，避免显示一个过去的日期
    while (daysBetween(today, nextStart) < 0) nextStart = shiftDay(nextStart, cycleLength);
    daysToNext = daysBetween(today, nextStart);
  }

  // 容易水肿/体重虚高的窗口：
  //   1) 正在经期里（第 1~3 天最明显）
  //   2) 下次经期前的 3 天（黄体期水肿）
  // 注意别把"经期结束后那几天"也算进来：那时体重上涨跟经期没关系，
  // 硬套一个"经前水肿"的说法只会让人困惑。
  const inBloatingWindow = !!ongoing || (daysToNext != null && daysToNext <= 3);

  return {
    today,
    hasData: list.length > 0,
    periods: list.slice(-24),
    lastStart: last ? last.start : null,
    ongoing: !!ongoing,
    ongoingDay: ongoing ? daysBetween(ongoing.start, today) + 1 : null,
    dayOfCycle,
    nextStart,
    daysToNext,
    cycleLength,
    bleedLength,
    estimated,
    inBloatingWindow,
    stage: !last
      ? 'none'
      : ongoing
        ? 'period'
        : daysToNext != null && daysToNext <= 3
          ? 'pms'
          : dayOfCycle != null && dayOfCycle >= 12 && dayOfCycle <= 16
            ? 'ovulation'
            : 'normal',
  };
}

/* ------------------------------------------------------------------ */
/* 成就                                                                */
/* ------------------------------------------------------------------ */

const hoursOf = (iso) => new Date(iso).getHours();

export const ACHIEVEMENTS = [
  { key: 'first_weight', name: '写下第一笔', desc: '记下第一笔体重', emoji: '🌱', group: '起步',
    check: (c) => c.recordCount >= 1 },
  { key: 'first_meal', name: '开始记录饮食', desc: '记下第一顿吃了什么', emoji: '🍚', group: '起步',
    check: (c) => c.mealCount >= 1 },
  { key: 'first_ai', name: '会用小助手', desc: '用 AI 分析过一次饮食', emoji: '🤖', group: '起步',
    check: (c) => c.aiAnalyzedCount >= 1 },
  { key: 'first_checkin', name: '今天也打卡了', desc: '完成第一次每日打卡', emoji: '✅', group: '起步',
    check: (c) => c.checkedDays >= 1 },

  { key: 'streak_3', name: '三天打鱼', desc: '连续记录体重 3 天', emoji: '🐟', group: '坚持',
    check: (c) => c.streak >= 3, progress: (c) => [c.streak, 3] },
  { key: 'streak_7', name: '一周不断', desc: '连续记录体重 7 天', emoji: '🔥', group: '坚持',
    check: (c) => c.streak >= 7, progress: (c) => [c.streak, 7] },
  { key: 'streak_30', name: '月度全勤', desc: '连续记录体重 30 天', emoji: '🏆', group: '坚持',
    check: (c) => c.streak >= 30, progress: (c) => [c.streak, 30] },
  { key: 'records_50', name: '记录狂', desc: '累计记满 50 笔体重', emoji: '📒', group: '坚持',
    check: (c) => c.recordCount >= 50, progress: (c) => [c.recordCount, 50] },
  { key: 'records_100', name: '一百笔', desc: '累计记满 100 笔体重', emoji: '📚', group: '坚持',
    check: (c) => c.recordCount >= 100, progress: (c) => [c.recordCount, 100] },
  { key: 'twice_a_day', name: '较真的人', desc: '某一天记了 3 次以上体重', emoji: '🔍', group: '坚持',
    check: (c) => c.maxPerDay >= 3 },
  { key: 'early_bird', name: '早起的人', desc: '连续 3 天在 8 点前记录', emoji: '🌅', group: '坚持',
    check: (c) => c.earlyStreak >= 3, progress: (c) => [c.earlyStreak, 3] },
  { key: 'water_7', name: '水做的女孩子', desc: '连续 7 天喝水达标', emoji: '💧', group: '坚持',
    check: (c) => c.waterStreak >= 7, progress: (c) => [c.waterStreak, 7] },
  { key: 'meal_days_7', name: '认真吃饭一周', desc: '连续 7 天有饮食记录', emoji: '🥗', group: '坚持',
    check: (c) => c.mealDayStreak >= 7, progress: (c) => [c.mealDayStreak, 7] },

  { key: 'lost_1', name: '开张大吉', desc: '减掉第 1 公斤', emoji: '🎉', group: '里程碑',
    check: (c) => c.totalLost >= 1, progress: (c) => [Math.max(0, c.totalLost), 1] },
  { key: 'lost_3', name: '三公斤', desc: '减掉 3 公斤', emoji: '⭐', group: '里程碑',
    check: (c) => c.totalLost >= 3, progress: (c) => [Math.max(0, c.totalLost), 3] },
  { key: 'lost_5', name: '五公斤俱乐部', desc: '减掉 5 公斤', emoji: '🥇', group: '里程碑',
    check: (c) => c.totalLost >= 5, progress: (c) => [Math.max(0, c.totalLost), 5] },
  { key: 'lost_10', name: '十公斤勇士', desc: '减掉 10 公斤', emoji: '👑', group: '里程碑',
    check: (c) => c.totalLost >= 10, progress: (c) => [Math.max(0, c.totalLost), 10] },
  { key: 'halfway', name: '过半啦', desc: '目标完成度超过 50%', emoji: '🚩', group: '里程碑',
    check: (c) => c.goalProgress != null && c.goalProgress >= 50, progress: (c) => [c.goalProgress || 0, 50] },
  { key: 'goal', name: '达成目标', desc: '体重终于到目标了', emoji: '🎊', group: '里程碑',
    check: (c) => c.goalProgress != null && c.goalProgress >= 100 },
  { key: 'bmi_normal', name: '进入正常区间', desc: 'BMI 降到 24 以下', emoji: '💚', group: '里程碑',
    check: (c) => c.bmi != null && c.bmi < 24 },
  { key: 'green_day', name: '全绿的一天', desc: '某天所有饮食都拿到 80 分以上', emoji: '🌟', group: '里程碑',
    check: (c) => c.greenDays >= 1 },
];

function achievementMetrics(db, stats) {
  const weights = [...(db.weights || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
  const meals = db.meals || [];

  // 每天几条
  const perDay = new Map();
  for (const w of weights) {
    const d = localDate(new Date(w.at));
    perDay.set(d, (perDay.get(d) || 0) + 1);
  }
  const maxPerDay = perDay.size ? Math.max(...perDay.values()) : 0;

  // 连续早起记录
  const earlyDays = new Set(weights.filter((w) => hoursOf(w.at) < 8).map((w) => localDate(new Date(w.at))));
  let earlyStreak = 0;
  {
    const today = localDate();
    let cursor = earlyDays.has(today) ? today : shiftDay(today, -1);
    while (earlyDays.has(cursor)) {
      earlyStreak++;
      cursor = shiftDay(cursor, -1);
    }
  }

  // 连续有饮食记录的天数
  const mealDays = new Set(meals.map((m) => m.date));
  let mealDayStreak = 0;
  {
    const today = localDate();
    let cursor = mealDays.has(today) ? today : shiftDay(today, -1);
    while (mealDays.has(cursor)) {
      mealDayStreak++;
      cursor = shiftDay(cursor, -1);
    }
  }

  // 全绿的日子
  const byDay = new Map();
  for (const m of meals) {
    if (!m.analysis) continue;
    if (!byDay.has(m.date)) byDay.set(m.date, []);
    byDay.get(m.date).push(m.analysis.score);
  }
  let greenDays = 0;
  for (const scores of byDay.values()) {
    if (scores.length >= 3 && scores.every((s) => s >= 80)) greenDays++;
  }

  const ci = checkinMetrics(db);

  return {
    ...stats,
    mealCount: meals.length,
    aiAnalyzedCount: meals.filter((m) => m.analysis).length,
    checkedDays: ci.checkedDays,
    waterStreak: ci.waterStreak,
    maxPerDay,
    earlyStreak,
    mealDayStreak,
    greenDays,
  };
}

/**
 * 算出所有成就的解锁状态；顺手把新解锁的记进 db.achievements
 * @returns {{all:Array, newly:Array}} newly 是这次新解锁、还没被前端展示过的
 */
export function computeAchievements(db, stats) {
  if (!db.achievements) db.achievements = {};
  const metrics = achievementMetrics(db, stats);
  const now = new Date().toISOString();
  const newly = [];

  const all = ACHIEVEMENTS.map((a) => {
    let unlocked = false;
    try {
      unlocked = !!a.check(metrics);
    } catch {
      unlocked = false;
    }
    const record = db.achievements[a.key];
    if (unlocked && !record) {
      db.achievements[a.key] = { at: now, seen: false };
      newly.push({ key: a.key, name: a.name, desc: a.desc, emoji: a.emoji, group: a.group });
    } else if (unlocked && record && !record.seen) {
      newly.push({ key: a.key, name: a.name, desc: a.desc, emoji: a.emoji, group: a.group });
    }

    let progress = null;
    if (a.progress) {
      try {
        const [cur, target] = a.progress(metrics);
        progress = { current: Math.round((Number(cur) || 0) * 10) / 10, target };
      } catch {
        progress = null;
      }
    }

    return {
      key: a.key,
      name: a.name,
      desc: a.desc,
      emoji: a.emoji,
      group: a.group,
      unlocked: !!(unlocked || db.achievements[a.key]),
      at: db.achievements[a.key]?.at || null,
      progress,
    };
  });

  return { all, newly, metrics };
}

/** 前端弹过庆祝之后调这个，避免重复弹 */
export function markAchievementsSeen(db, keys) {
  if (!db.achievements) db.achievements = {};
  for (const k of keys || []) {
    if (db.achievements[k]) db.achievements[k].seen = true;
  }
}

/* ------------------------------------------------------------------ */
/* 周报 / 月报                                                         */
/* ------------------------------------------------------------------ */

const MEAL_SLOT_NAME = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };

/**
 * @param {'week'|'month'} period
 * @param {number} offset 0=本期，1=上一期，2=上上期…
 */
export function buildReport(db, stats, period = 'week', offset = 0) {
  const today = localDate();
  let start;
  let end;
  let label;

  if (period === 'month') {
    const d = parseDay(today);
    const firstThisMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    firstThisMonth.setMonth(firstThisMonth.getMonth() - offset);
    const firstNext = new Date(firstThisMonth.getFullYear(), firstThisMonth.getMonth() + 1, 1);
    const p = (n) => String(n).padStart(2, '0');
    start = `${firstThisMonth.getFullYear()}-${p(firstThisMonth.getMonth() + 1)}-01`;
    end = `${firstNext.getFullYear()}-${p(firstNext.getMonth() + 1)}-01`;
    end = shiftDay(end, -1);
    label = offset === 0 ? '本月' : `${firstThisMonth.getFullYear()}年${firstThisMonth.getMonth() + 1}月`;
  } else {
    // 以「今天」为终点往前 7 天，这样当周也能看到完整的一周
    end = shiftDay(today, -offset * 7);
    start = shiftDay(end, -6);
    label = offset === 0 ? '最近 7 天' : offset === 1 ? '前 7 天' : `再往前 ${offset} 周`;
  }

  const inRange = (dateStr) => dateStr >= start && dateStr <= end;
  const weights = db.weights || [];
  const meals = db.meals || [];

  const wIn = weights.filter((w) => inRange(localDate(new Date(w.at))));
  const wSorted = [...wIn].sort((a, b) => new Date(a.at) - new Date(b.at));

  const dayFirst = new Map();
  for (const w of wSorted) {
    const d = localDate(new Date(w.at));
    if (!dayFirst.has(d)) dayFirst.set(d, w.kg);
  }
  const dailyValues = [...dayFirst.values()];

  const first = wSorted.length ? wSorted[0].kg : null;
  const lastW = wSorted.length ? wSorted[wSorted.length - 1].kg : null;
  const change = first != null && lastW != null ? +(lastW - first).toFixed(2) : null;
  const avg = dailyValues.length ? +(dailyValues.reduce((a, b) => a + b, 0) / dailyValues.length).toFixed(2) : null;

  // 上一个等长周期，用来对比
  const prevEnd = shiftDay(start, -1);
  const prevStart = shiftDay(prevEnd, -(daysBetween(start, end)));
  const wPrevIn = weights.filter((w) => {
    const d = localDate(new Date(w.at));
    return d >= prevStart && d <= prevEnd;
  });
  const prevDaily = new Map();
  for (const w of wPrevIn) {
    const d = localDate(new Date(w.at));
    if (!prevDaily.has(d)) prevDaily.set(d, w.kg);
  }
  const prevAvg = prevDaily.size
    ? +( [...prevDaily.values()].reduce((a, b) => a + b, 0) / prevDaily.size).toFixed(2)
    : null;
  const vsPrev = avg != null && prevAvg != null ? +(avg - prevAvg).toFixed(2) : null;

  // 记录天数
  const recordedDays = new Set(wSorted.map((w) => localDate(new Date(w.at))));
  const totalDays = daysBetween(start, end) + 1;

  // 饮食
  const mIn = meals.filter((m) => inRange(m.date));
  const analyzed = mIn.filter((m) => m.analysis);
  const avgScore = analyzed.length
    ? Math.round(analyzed.reduce((s, m) => s + m.analysis.score, 0) / analyzed.length)
    : null;
  const totalKcal = analyzed.reduce((s, m) => s + (m.analysis.kcal || 0), 0);
  const kcalDays = new Set(analyzed.map((m) => m.date)).size;
  const kcalPerDay = kcalDays ? Math.round(totalKcal / kcalDays) : 0;

  const mealDays = new Set(mIn.map((m) => m.date));
  const slotCount = {};
  for (const m of mIn) slotCount[m.slot] = (slotCount[m.slot] || 0) + 1;

  // 高分和踩雷
  const best = [...analyzed].sort((a, b) => b.analysis.score - a.analysis.score)[0] || null;
  const worst = [...analyzed].sort((a, b) => a.analysis.score - b.analysis.score)[0] || null;

  // 每天的健康分，给柱状图用
  const scoreByDay = new Map();
  for (const m of analyzed) {
    if (!scoreByDay.has(m.date)) scoreByDay.set(m.date, []);
    scoreByDay.get(m.date).push(m.analysis.score);
  }
  const scoreSeries = [...scoreByDay.entries()]
    .map(([date, arr]) => ({ date, score: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // 体重序列（按天取首笔）
  const weightSeries = [...dayFirst.entries()]
    .map(([date, kg]) => ({ date, kg }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-14);

  // 打卡
  const checkins = db.checkins || {};
  const ciIn = Object.entries(checkins)
    .filter(([d]) => inRange(d))
    .map(([d, c]) => [d, normalizeCheckin(c)]);
  const waterDaysDone = ciIn.filter(([, c]) => c.water >= DEFAULT_GOALS.water).length;
  const waterAvg = ciIn.length ? Math.round(ciIn.reduce((s, [, c]) => s + c.water, 0) / ciIn.length) : 0;
  const exerciseMinutes = ciIn.reduce((s, [, c]) => s + c.exercise.reduce((t, e) => t + (Number(e.minutes) || 0), 0), 0);
  const sleepVals = ciIn.map(([, c]) => c.sleep).filter((n) => n != null);
  const sleepAvg = sleepVals.length ? +(sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length).toFixed(1) : null;

  const pInfo = periodInfo(db);

  return {
    period,
    offset,
    label,
    start,
    end,
    totalDays,
    weight: {
      first,
      last: lastW,
      change,
      avg,
      prevAvg,
      vsPrev,
      min: dailyValues.length ? Math.min(...dailyValues) : null,
      max: dailyValues.length ? Math.max(...dailyValues) : null,
      recordCount: wIn.length,
      recordedDays: recordedDays.size,
      series: weightSeries,
    },
    meal: {
      count: mIn.length,
      days: mealDays.size,
      analyzed: analyzed.length,
      avgScore,
      totalKcal,
      kcalPerDay,
      slots: slotCount,
      best: best ? { text: best.text, score: best.analysis.score, date: best.date, slot: best.slot } : null,
      worst: worst ? { text: worst.text, score: worst.analysis.score, date: worst.date, slot: worst.slot } : null,
      scoreSeries,
    },
    checkin: {
      days: ciIn.length,
      waterDaysDone,
      waterAvg,
      exerciseMinutes,
      sleepAvg,
    },
    period_hint: pInfo.hasData
      ? { inWindow: pInfo.inBloatingWindow, stage: pInfo.stage, dayOfCycle: pInfo.dayOfCycle }
      : null,
  };
}

/** 把报告压成给 AI 的一段文字 */
export function reportPromptPayload(report, profile) {
  const r = report;
  // 键名带上单位，模型就不用猜了：之前只写"期内变化"，
  // 它把 kg 当斤说过"掉3斤多"（实际 6.4 斤）。
  return {
    周期: `${r.start} ~ ${r.end}（${r.label}）`,
    身高cm: profile?.height ?? null,
    目标体重kg: profile?.targetWeight ?? null,
    体重kg: {
      期内变化: r.weight.change,
      期初: r.weight.first,
      期末: r.weight.last,
      本期平均: r.weight.avg,
      上一期平均: r.weight.prevAvg,
      最低: r.weight.min,
      最高: r.weight.max,
      记录天数: `${r.weight.recordedDays}/${r.totalDays}`,
      记录笔数: r.weight.recordCount,
    },
    饮食: {
      记录餐数: r.meal.count,
      记录天数: r.meal.days,
      平均健康分: r.meal.avgScore,
      日均热量kcal: r.meal.kcalPerDay,
      吃得最好的一顿: r.meal.best,
      最该反省的一顿: r.meal.worst,
    },
    打卡: r.checkin,
    经期: r.period_hint,
  };
}

/**
 * 每日鼓励要发给 AI 的数据。
 *
 * 只为了一句 30 字的鼓励，没必要把整条体重时间序列发过去：
 * 又费 token，又容易让模型在一堆数字里把哪个是哪个搅混
 * （实测发全量的时候它编出过数据里根本不存在的"65公斤"）。
 * 所以这里只挑真正会用到的几个标量。
 */
export function dailyTipPayload(stats, profile) {
  const s = stats || {};
  const num = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  return {
    她的昵称: profile?.nickname || null,
    身高cm: profile?.height ?? null,
    目标体重kg: profile?.targetWeight ?? null,
    当前体重kg: num(s.latestKg),
    起始体重kg: num(s.startWeight),
    一共减掉kg: num(s.totalLost),
    离目标还差kg: num(s.toGoal),
    进度百分比: num(s.goalProgress),
    历史最低kg: num(s.lowest),
    BMI: num(s.bmi),
    BMI评价: s.bmiLabel || null,
    连续记录天数: num(s.streak),
    最近7天体重变化kg: num(s.trend7),
    今天记录餐数: num(s.todayMeals),
    今天热量kcal: num(s.todayKcal),
    今天饮食健康分: num(s.todayScore),
  };
}

export { MEAL_SLOT_NAME };
