import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { PUBLIC_DIR, PORT, HOST, DB_FILE } from './paths.mjs';
import {
  getDb,
  saveDb,
  mutateDb,
  getConfig,
  saveConfig,
  backupDaily,
  uid,
  localDate,
} from './store.mjs';
import { chat, analyzeMeal, decideMeal, dailyTip, reportSummary, aiStatus, extractJson } from './ai.mjs';
import { buildDemoDb, buildEmptyDb } from './demo.mjs';
import {
  checkinMetrics,
  periodInfo,
  computeAchievements,
  markAchievementsSeen,
  buildReport,
  reportPromptPayload,
  normalizeCheckin,
  shiftDay,
  daysBetween,
  DEFAULT_GOALS,
} from './metrics.mjs';

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf ? body : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

const ok = (res, data) => send(res, 200, { ok: true, ...data });
const fail = (res, status, message, extra = {}) => send(res, status, { ok: false, error: message, ...extra });

async function readBody(req, limit = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体太大了');
    chunks.push(chunk);
  }
  if (!size) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

/* ------------------------------------------------------------------ */
/* 口令保护（个人小站够用了）                                           */
/* ------------------------------------------------------------------ */

function tokenFor(password) {
  return createHash('sha256').update(`mi-diary::${password}`).digest('hex').slice(0, 32);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function constantEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function isAuthed(req) {
  const cfg = await getConfig();
  if (!cfg.auth?.enabled || !cfg.auth?.password) return true;
  const cookies = parseCookies(req);
  return !!cookies.mi_token && constantEqual(cookies.mi_token, tokenFor(cfg.auth.password));
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

/** 同一天多次测量：保留最早和最晚，日均用平均 */
export function groupByDay(entries) {
  const map = new Map();
  for (const e of entries) {
    const day = localDate(new Date(e.at));
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(e);
  }
  const days = [...map.entries()].map(([date, list]) => {
    list.sort((a, b) => new Date(a.at) - new Date(b.at));
    return {
      date,
      first: list[0].kg,
      last: list[list.length - 1].kg,
      min: Math.min(...list.map((x) => x.kg)),
      avg: +(list.reduce((s, x) => s + x.kg, 0) / list.length).toFixed(2),
      count: list.length,
      entries: list,
    };
  });
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return days;
}

/** 线性回归式移动平均，用来把体重曲线磨平一点 */
function movingAverage(days, window = 7) {
  return days.map((d, i) => {
    const slice = days.slice(Math.max(0, i - window + 1), i + 1);
    const avg = slice.reduce((s, x) => s + x.last, 0) / slice.length;
    return { date: d.date, value: +avg.toFixed(2) };
  });
}

function bmi(kg, heightCm) {
  if (!kg || !heightCm) return null;
  const m = heightCm / 100;
  return +(kg / (m * m)).toFixed(1);
}

function bmiLabel(v) {
  if (v == null) return '';
  if (v < 18.5) return '偏瘦';
  if (v < 24) return '正常';
  if (v < 28) return '微胖';
  return '偏重';
}

/**
 * 经期水肿提醒的"事实"部分。
 *
 * 这里刻意只回数字和阶段，不回现成句子：措辞统一由前端 period.js 的
 * bloatExplain 生成，否则服务端和前端各写一套话术，同一个现象很快就会出现
 * 两种说法。/api/stats 和 /api/report 都走这个函数，形状也保持一致。
 *
 * @returns {{stage:string, dayOfCycle:number|null, daysToNext:number|null, trend:number}|null}
 */
function bloatFacts(info, trend) {
  if (!info?.hasData) return null;
  if (!info.inBloatingWindow) return null;
  if (trend == null || !(trend > 0.15)) return null;
  return {
    stage: info.stage,
    dayOfCycle: info.dayOfCycle ?? null,
    daysToNext: info.daysToNext ?? null,
    trend: Number(trend.toFixed(2)),
  };
}

function buildStats(db, rangeDays = 30) {
  const weights = [...db.weights].sort((a, b) => new Date(a.at) - new Date(b.at));
  const allDays = groupByDay(weights);
  const days = rangeDays > 0 ? allDays.slice(-rangeDays) : allDays;

  const latest = weights.length ? weights[weights.length - 1] : null;
  const first = weights.length ? weights[0] : null;
  const p = db.profile || {};
  const startWeight = p.startWeight ?? (first ? first.kg : null);

  const latestKg = latest ? latest.kg : null;
  const totalLost = startWeight != null && latestKg != null ? +(startWeight - latestKg).toFixed(2) : 0;
  const toGoal =
    p.targetWeight != null && latestKg != null ? +(latestKg - p.targetWeight).toFixed(2) : null;
  const goalProgress =
    startWeight != null && p.targetWeight != null && startWeight !== p.targetWeight
      ? Math.max(0, Math.min(100, Math.round(((startWeight - latestKg) / (startWeight - p.targetWeight)) * 100)))
      : null;

  // 连续记录天数（从今天或昨天往前数）
  const daySet = new Set(allDays.map((d) => d.date));
  let streak = 0;
  const cursor = new Date();
  if (!daySet.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (daySet.has(localDate(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const lowest = weights.length ? Math.min(...weights.map((w) => w.kg)) : null;
  const highest = weights.length ? Math.max(...weights.map((w) => w.kg)) : null;

  // 近 7 天 vs 前 7 天
  const recent = allDays.slice(-7);
  const prev = allDays.slice(-14, -7);
  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x.last, 0) / arr.length : null);
  const trend =
    avg(recent) != null && avg(prev) != null ? +(avg(recent) - avg(prev)).toFixed(2) : null;

  const today = localDate();
  const todayMeals = db.meals.filter((m) => m.date === today);

  return {
    latestKg,
    latestAt: latest ? latest.at : null,
    firstKg: first ? first.kg : null,
    firstAt: first ? first.at : null,
    startWeight,
    targetWeight: p.targetWeight ?? null,
    totalLost,
    toGoal,
    goalProgress,
    lowest,
    highest,
    bmi: bmi(latestKg, p.height),
    bmiLabel: bmiLabel(bmi(latestKg, p.height)),
    recordCount: weights.length,
    recordedDays: allDays.length,
    streak,
    trend7: trend,
    todayMeals: todayMeals.length,
    todayKcal: todayMeals.reduce((s, m) => s + (m.analysis?.kcal || 0), 0),
    todayScore: todayMeals.filter((m) => m.analysis).length
      ? Math.round(
          todayMeals.filter((m) => m.analysis).reduce((s, m) => s + m.analysis.score, 0) /
            todayMeals.filter((m) => m.analysis).length,
        )
      : null,
    series: days.map((d) => ({
      date: d.date,
      last: d.last,
      first: d.first,
      avg: d.avg,
      count: d.count,
    })),
    movingAvg: movingAverage(days, 7),
    allDays,
    weights,
  };
}

/* ------------------------------------------------------------------ */
/* 里程碑                                                              */
/* ------------------------------------------------------------------ */

function checkMilestones(db, newKg) {
  const p = db.profile || {};
  const start = p.startWeight;
  const reached = [];
  if (start == null) return reached;
  for (let k = 1; k <= 200; k++) {
    const line = +(start - k).toFixed(2);
    if (newKg <= line && !db.milestones.some((m) => m.kg === line)) {
      db.milestones.push({ kg: line, at: new Date().toISOString() });
      reached.push({ type: 'milestone', kg: line, lost: k });
    }
  }
  return reached;
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const regex = new RegExp(
    '^' +
      pattern
        .split('/')
        .map((seg) => {
          if (seg.startsWith(':')) {
            keys.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/') +
      '$',
  );
  routes.push({ method, regex, keys, handler, ...opts });
};

/* ---- 基础 ---- */

route('GET', '/api/bootstrap', async (req, res) => {
  const db = await getDb();
  const cfg = await getConfig();
  ok(res, {
    db,
    ai: await aiStatus(),
    auth: { enabled: !!cfg.auth?.enabled },
    today: localDate(),
  });
});

route('POST', '/api/login', async (req, res) => {
  const cfg = await getConfig();
  const { password } = await readBody(req);
  if (!cfg.auth?.enabled) return ok(res, { authed: true });
  if (!password || password !== cfg.auth.password) return fail(res, 401, '口令不对哦～');
  send(
    res,
    200,
    { ok: true, authed: true },
    { 'Set-Cookie': `mi_token=${tokenFor(password)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax; HttpOnly` },
  );
});

route('POST', '/api/logout', async (req, res) => {
  send(res, 200, { ok: true }, { 'Set-Cookie': 'mi_token=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly' });
});

/* ---- 档案 ---- */

route('PATCH', '/api/profile', async (req, res) => {
  const patch = await readBody(req);
  const db = await mutateDb((db) => {
    const allowed = ['nickname', 'avatar', 'height', 'startWeight', 'targetWeight', 'startDate', 'motto'];
    for (const k of allowed) if (k in patch) db.profile[k] = patch[k];
    return db.profile;
  });
  ok(res, { profile: db });
});

/* ---- 体重 ---- */

route('POST', '/api/weights', async (req, res) => {
  const { kg, at, note = '', tags = [] } = await readBody(req);
  const num = Number(kg);
  if (!Number.isFinite(num) || num <= 20 || num > 400) return fail(res, 400, '体重数字看起来不太对哦～');

  const result = await mutateDb((db) => {
    const entry = {
      id: uid(),
      at: at ? new Date(at).toISOString() : new Date().toISOString(),
      kg: +num.toFixed(2),
      note: String(note).slice(0, 200),
      tags: Array.isArray(tags) ? tags.slice(0, 5) : [],
    };
    const before = [...db.weights].sort((a, b) => new Date(a.at) - new Date(b.at));
    const prevLowest = before.length ? Math.min(...before.map((w) => w.kg)) : null;
    db.weights.push(entry);

    const celebrations = checkMilestones(db, entry.kg);
    if (before.length === 0) celebrations.unshift({ type: 'first' });
    else if (prevLowest != null && entry.kg < prevLowest) celebrations.unshift({ type: 'lowest', kg: entry.kg });
    return { entry, celebrations };
  });
  ok(res, result);
});

route('PATCH', '/api/weights/:id', async (req, res) => {
  const patch = await readBody(req);
  const result = await mutateDb((db) => {
    const w = db.weights.find((x) => x.id === req.params.id);
    if (!w) return null;
    if (patch.kg != null && Number.isFinite(Number(patch.kg))) w.kg = +Number(patch.kg).toFixed(2);
    if (patch.at) w.at = new Date(patch.at).toISOString();
    if (patch.note != null) w.note = String(patch.note).slice(0, 200);
    if (Array.isArray(patch.tags)) w.tags = patch.tags.slice(0, 5);
    return w;
  });
  if (!result) return fail(res, 404, '找不到这条记录');
  ok(res, { entry: result });
});

route('DELETE', '/api/weights/:id', async (req, res) => {
  const removed = await mutateDb((db) => {
    const i = db.weights.findIndex((x) => x.id === req.params.id);
    if (i < 0) return 0;
    db.weights.splice(i, 1);
    return 1;
  });
  ok(res, { removed });
});

/* ---- 饮食 ---- */

route('POST', '/api/meals', async (req, res) => {
  const { date, slot = 'lunch', at, text = '', foods = [], photoNote = '' } = await readBody(req);
  const result = await mutateDb((db) => {
    const meal = {
      id: uid(),
      date: date || localDate(),
      slot,
      at: at ? new Date(at).toISOString() : new Date().toISOString(),
      text: String(text).slice(0, 500),
      foods: Array.isArray(foods) ? foods.slice(0, 30) : [],
      photoNote: String(photoNote).slice(0, 200),
      analysis: null,
    };
    if (!meal.text && !meal.foods.length && !meal.photoNote) return null;
    db.meals.push(meal);
    return meal;
  });
  if (!result) return fail(res, 400, '先写点吃了什么吧～');
  ok(res, { meal: result });
});

route('PATCH', '/api/meals/:id', async (req, res) => {
  const patch = await readBody(req);
  const result = await mutateDb((db) => {
    const m = db.meals.find((x) => x.id === req.params.id);
    if (!m) return null;
    for (const k of ['date', 'slot', 'text', 'photoNote']) if (patch[k] != null) m[k] = String(patch[k]).slice(0, 500);
    if (Array.isArray(patch.foods)) m.foods = patch.foods.slice(0, 30);
    if (patch.analysis === null) m.analysis = null;
    return m;
  });
  if (!result) return fail(res, 404, '找不到这顿饭');
  ok(res, { meal: result });
});

route('DELETE', '/api/meals/:id', async (req, res) => {
  const removed = await mutateDb((db) => {
    const i = db.meals.findIndex((x) => x.id === req.params.id);
    if (i < 0) return 0;
    db.meals.splice(i, 1);
    return 1;
  });
  ok(res, { removed });
});

/** 分析一顿；不带 id 就分析某天的全部未分析餐次 */
route('POST', '/api/meals/:id/analyze', async (req, res) => {
  const db = await getDb();
  const meal = db.meals.find((x) => x.id === req.params.id);
  if (!meal) return fail(res, 404, '找不到这顿饭');

  const stats = buildStats(db, 30);
  const analysis = await analyzeMeal({
    meal,
    profile: db.profile,
    recentWeight: stats.latestKg,
  });

  await mutateDb((d) => {
    const m = d.meals.find((x) => x.id === req.params.id);
    if (m) m.analysis = analysis;
  });
  ok(res, { analysis });
});

route('POST', '/api/analyze/day', async (req, res) => {
  const { date } = await readBody(req);
  const day = date || localDate();
  const db = await getDb();
  const targets = db.meals.filter((m) => m.date === day && !m.analysis);
  if (!targets.length) return ok(res, { analyzed: [], skipped: true });

  const recentWeight = buildStats(db, 30).latestKg;
  const analyzed = [];
  const errors = [];
  for (const meal of targets) {
    try {
      const analysis = await analyzeMeal({ meal, profile: db.profile, recentWeight });
      await mutateDb((d) => {
        const m = d.meals.find((x) => x.id === meal.id);
        if (m) m.analysis = analysis;
      });
      analyzed.push({ id: meal.id, analysis });
    } catch (err) {
      errors.push({ id: meal.id, error: err.message });
    }
  }
  ok(res, { analyzed, errors });
});

/* ---- 食物库 ---- */

route('POST', '/api/foods', async (req, res) => {
  const { name, slots = ['lunch'], kcal = 0, tag = '', weight = 2 } = await readBody(req);
  if (!name || !String(name).trim()) return fail(res, 400, '食物得有个名字呀');
  const food = await mutateDb((db) => {
    const f = {
      id: uid(),
      name: String(name).slice(0, 40).trim(),
      slots: Array.isArray(slots) && slots.length ? slots : ['lunch'],
      kcal: Math.max(0, Math.round(Number(kcal) || 0)),
      tag: String(tag).slice(0, 12),
      weight: Math.max(1, Math.min(9, Math.round(Number(weight) || 2))),
      custom: true,
    };
    db.foods.push(f);
    return f;
  });
  ok(res, { food });
});

route('PATCH', '/api/foods/:id', async (req, res) => {
  const patch = await readBody(req);
  const food = await mutateDb((db) => {
    const f = db.foods.find((x) => x.id === req.params.id);
    if (!f) return null;
    if (patch.name != null) f.name = String(patch.name).slice(0, 40);
    if (Array.isArray(patch.slots)) f.slots = patch.slots;
    if (patch.kcal != null) f.kcal = Math.max(0, Math.round(Number(patch.kcal) || 0));
    if (patch.tag != null) f.tag = String(patch.tag).slice(0, 12);
    if (patch.weight != null) f.weight = Math.max(1, Math.min(9, Math.round(Number(patch.weight) || 2)));
    return f;
  });
  if (!food) return fail(res, 404, '找不到这个食物');
  ok(res, { food });
});

route('DELETE', '/api/foods/:id', async (req, res) => {
  const removed = await mutateDb((db) => {
    const i = db.foods.findIndex((x) => x.id === req.params.id);
    if (i < 0) return 0;
    db.foods.splice(i, 1);
    return 1;
  });
  ok(res, { removed });
});

/* ---- 打卡 ---- */

route('PUT', '/api/checkins/:date', async (req, res) => {
  const patch = await readBody(req);
  const result = await mutateDb((db) => {
    const day = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const merged = normalizeCheckin({ ...(db.checkins[day] || {}), ...patch });
    db.checkins[day] = { ...merged, updatedAt: new Date().toISOString() };
    return db.checkins[day];
  });
  if (!result) return fail(res, 400, '日期格式不对');
  ok(res, { checkin: result });
});

/** 一次拿到整月的打卡，月历用 */
route('GET', '/api/checkins', async (req, res) => {
  const month = req.query.get('month'); // YYYY-MM
  const db = await getDb();
  const out = {};
  for (const [date, raw] of Object.entries(db.checkins || {})) {
    if (month && !date.startsWith(month)) continue;
    out[date] = normalizeCheckin(raw);
  }
  ok(res, { checkins: out, goals: DEFAULT_GOALS });
});

/* ---- 经期 ---- */

route('POST', '/api/periods', async (req, res) => {
  const { start, end = null, note = '' } = await readBody(req);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start || ''))) return fail(res, 400, '开始日期格式不对');
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(String(end))) return fail(res, 400, '结束日期格式不对');
  if (end && end < start) return fail(res, 400, '结束日期不能早于开始日期');

  const result = await mutateDb((db) => {
    if (!db.periods) db.periods = [];
    // 同一开始日期就更新，避免重复记
    const exist = db.periods.find((p) => p.start === start);
    if (exist) {
      exist.end = end;
      exist.note = String(note).slice(0, 120);
      return exist;
    }
    const item = { id: uid(), start, end, note: String(note).slice(0, 120) };
    db.periods.push(item);
    return item;
  });
  ok(res, { period: result, info: periodInfo(await getDb()) });
});

route('PATCH', '/api/periods/:id', async (req, res) => {
  const patch = await readBody(req);
  const result = await mutateDb((db) => {
    const p = (db.periods || []).find((x) => x.id === req.params.id);
    if (!p) return null;
    if (patch.start) p.start = patch.start;
    if ('end' in patch) p.end = patch.end || null;
    if (patch.note != null) p.note = String(patch.note).slice(0, 120);
    return p;
  });
  if (!result) return fail(res, 404, '找不到这条经期记录');
  ok(res, { period: result });
});

route('DELETE', '/api/periods/:id', async (req, res) => {
  const removed = await mutateDb((db) => {
    const i = (db.periods || []).findIndex((x) => x.id === req.params.id);
    if (i < 0) return 0;
    db.periods.splice(i, 1);
    return 1;
  });
  ok(res, { removed });
});

/* ---- 成就 ---- */

route('GET', '/api/achievements', async (req, res) => {
  const db = await getDb();
  const stats = buildStats(db, 0);
  const { all, newly, metrics } = computeAchievements(db, stats);
  if (newly.length) await saveDb(db);
  ok(res, {
    all,
    newly,
    unlockedCount: all.filter((a) => a.unlocked).length,
    total: all.length,
    checkedDays: metrics.checkedDays,
    waterStreak: metrics.waterStreak,
    mealCount: metrics.mealCount,
  });
});

route('POST', '/api/achievements/seen', async (req, res) => {
  const { keys = [] } = await readBody(req);
  await mutateDb((db) => markAchievementsSeen(db, keys));
  ok(res, { marked: keys.length });
});

/* ---- 周报 / 月报 ---- */

route('GET', '/api/report', async (req, res) => {
  const db = await getDb();
  const period = req.query.get('period') === 'month' ? 'month' : 'week';
  const offset = Math.max(0, Math.min(60, Number(req.query.get('offset')) || 0));
  const stats = buildStats(db, 0);
  const report = buildReport(db, stats, period, offset);
  const info = periodInfo(db);
  const ci = checkinMetrics(db);

  // 波动提醒：在易水肿窗口里且最近体重是涨的。
  // 跟 /api/stats 回同一个形状、同一套事实，措辞由前端 bloatExplain 负责。
  const bloatTip = bloatFacts(info, stats.trend7);

  ok(res, { report, period: info, checkin: ci, bloatTip });
});

route('POST', '/api/report/summary', async (req, res) => {
  const { period = 'week', offset = 0 } = await readBody(req);
  const db = await getDb();
  const stats = buildStats(db, 0);
  const report = buildReport(db, stats, period, offset);
  if (!report.weight.recordCount && !report.meal.count && !report.checkin.days) {
    return fail(res, 400, '这一期还没有记录，先去记点什么吧～');
  }
  const summary = await reportSummary({
    payload: reportPromptPayload(report, db.profile),
    profile: db.profile,
  });
  ok(res, { summary, report });
});

/* ---- 统计 ---- */

route('GET', '/api/stats', async (req, res) => {
  const db = await getDb();
  const range = Number(req.query.get('range') || 30);
  const stats = buildStats(db, Number.isFinite(range) ? range : 30);
  const { allDays, weights, ...rest } = stats;
  const info = periodInfo(db);
  const ci = checkinMetrics(db);

  // 经期前后的体重虚高提醒：只回事实，措辞交给前端 period.js 的 bloatExplain。
  // 两边各写一套话术的话，同一个现象就会出现两种说法，早晚对不上。
  const bloat = bloatFacts(info, rest.trend7);

  ok(res, { stats: rest, period: info, checkin: ci, bloatTip: bloat });
});

/* ---- 今天吃什么 ---- */

route('POST', '/api/decide', async (req, res) => {
  const { slot = 'lunch', moods = [], avoid = '', budgetKcal } = await readBody(req);
  const db = await getDb();
  const candidates = db.foods
    .filter((f) => !slot || f.slots.includes(slot))
    .sort((a, b) => (b.weight || 1) - (a.weight || 1))
    .slice(0, 40);
  const result = await decideMeal({
    slot,
    moods,
    avoid,
    budgetKcal,
    candidates,
    profile: db.profile,
  });
  ok(res, { decision: result });
});

/* ---- AI 杂项 ---- */

route('POST', '/api/daily-tip', async (req, res) => {
  const db = await getDb();
  const stats = buildStats(db, 30);
  const { series, allDays, weights, ...rest } = stats;
  const result = await dailyTip({ profile: db.profile, stats: rest });
  ok(res, { tip: result });
});

route('POST', '/api/ai/chat', async (req, res) => {
  const { messages, json = false } = await readBody(req);
  if (!Array.isArray(messages) || !messages.length) return fail(res, 400, '消息是空的');
  const cfg = await getConfig();
  const system = {
    role: 'system',
    content: `你是"小米减肥日记"里的贴心小助手，服务一位正在减脂的年轻女生。温柔、专业、不说教，中文回复，别制造身材焦虑，不推荐极端节食。${
      cfg.ai.enabled ? '' : '（AI 未启用）'
    }`,
  };
  const result = await chat({ messages: [system, ...messages.slice(-20)], json });
  ok(res, { text: result.text, model: result.model, usage: result.usage });
});

/* ---- 配置 ---- */

route('GET', '/api/config', async (req, res) => {
  const cfg = await getConfig();
  ok(res, {
    config: {
      ai: { ...cfg.ai, apiKey: cfg.ai.apiKey ? '••••••••' + cfg.ai.apiKey.slice(-4) : '' },
      auth: { enabled: !!cfg.auth?.enabled, hasPassword: !!cfg.auth?.password },
    },
  });
});

route('PUT', '/api/config', async (req, res) => {
  const patch = await readBody(req);
  const config = await getConfig();

  if (patch.ai && typeof patch.ai === 'object') {
    const a = patch.ai;
    if ('enabled' in a) config.ai.enabled = !!a.enabled;
    if ('baseUrl' in a) config.ai.baseUrl = String(a.baseUrl).trim().replace(/\/+$/, '');
    if ('model' in a) config.ai.model = String(a.model).trim();
    if ('temperature' in a) config.ai.temperature = Math.max(0, Math.min(2, Number(a.temperature) || 0.6));
    if ('timeoutMs' in a) config.ai.timeoutMs = Math.max(5000, Math.min(180000, Number(a.timeoutMs) || 45000));
    // 只在前端真的传了新 key 时才覆盖，避免把掩码写回去
    if (a.apiKey && !a.apiKey.startsWith('••')) config.ai.apiKey = String(a.apiKey).trim();
    if (a.apiKey === '') config.ai.apiKey = '';
    if (a.extraHeaders && typeof a.extraHeaders === 'object') config.ai.extraHeaders = a.extraHeaders;
  }

  if (patch.auth && typeof patch.auth === 'object') {
    if ('enabled' in patch.auth) config.auth.enabled = !!patch.auth.enabled;
    if ('password' in patch.auth) config.auth.password = String(patch.auth.password || '');
  }

  await saveConfig(config);
  ok(res, {
    config: {
      ai: { ...config.ai, apiKey: config.ai.apiKey ? '••••••••' + config.ai.apiKey.slice(-4) : '' },
      auth: { enabled: !!config.auth.enabled, hasPassword: !!config.auth.password },
    },
  });
});

route('POST', '/api/config/test', async (req, res) => {
  try {
    // 故意不设 max_tokens：业务调用也不设。设小了会把推理模型的
    // 思考预算掐掉，测出来的是假故障。
    const result = await chat({
      messages: [
        { role: 'system', content: '你是一个测试助手。' },
        { role: 'user', content: '只输出这个 JSON：{"hello":"world","ok":true}' },
      ],
      json: true,
      temperature: 0,
    });
    let parsed = null;
    try {
      parsed = extractJson(result.text);
    } catch {}
    ok(res, {
      model: result.model,
      raw: result.text.slice(0, 300),
      parsed,
      usage: result.usage,
      finishReason: result.finishReason,
    });
  } catch (err) {
    fail(res, err.status || 400, err.message);
  }
});

/* ---- 数据导出 / 导入 ---- */

route('GET', '/api/export', async (req, res) => {
  const db = await getDb();
  const stamp = localDate();
  send(res, 200, JSON.stringify(db, null, 2), {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="mi-diary-${stamp}.json"`,
  });
});

route('POST', '/api/import', async (req, res) => {
  const incoming = await readBody(req, 32 * 1024 * 1024);
  if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.weights)) {
    return fail(res, 400, '这个文件看起来不是小米日记的备份');
  }
  const { mode = 'merge' } = incoming.__opts || {};
  if (mode === 'replace') {
    await saveDb(incoming);
    return ok(res, { mode });
  }
  const result = await mutateDb((db) => {
    const seenW = new Set(db.weights.map((w) => w.id));
    const seenM = new Set(db.meals.map((m) => m.id));
    const seenF = new Set(db.foods.map((f) => f.name));
    let added = 0;
    for (const w of incoming.weights || []) if (w?.id && !seenW.has(w.id)) (db.weights.push(w), added++);
    for (const m of incoming.meals || []) if (m?.id && !seenM.has(m.id)) (db.meals.push(m), added++);
    for (const f of incoming.foods || []) if (f?.name && !seenF.has(f.name)) (db.foods.push(f), added++);
    return { added };
  });
  ok(res, result);
});

route('GET', '/api/health', async (req, res) => ok(res, { up: true, today: localDate() }));

/** 重置：example=灌一份示例数据，empty=清空记录（食物库都保留） */
route('POST', '/api/reset', async (req, res) => {
  const { mode = 'empty' } = await readBody(req);
  const db = await getDb();
  const next = mode === 'demo' ? buildDemoDb(db) : buildEmptyDb(db);
  await saveDb(next);
  ok(res, { mode, weights: next.weights.length, meals: next.meals.length });
});

/* ------------------------------------------------------------------ */
/* 静态文件                                                            */
/* ------------------------------------------------------------------ */

async function serveStatic(req, res, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  let filePath = path.join(PUBLIC_DIR, rel);
  // 目录穿越保护
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden');

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    // SPA 兜底：不是文件就交给前端路由
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    // 代码和页面每次都重新拉，免得改了看不到；图片字体可以缓存
    const isStatic = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.woff2', '.ico', '.svg'].includes(ext);
    send(res, 200, data, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isStatic ? 'public, max-age=86400' : 'no-store',
    });
  } catch {
    send(res, 404, 'not found');
  }
}

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      // 未开启口令时，除了登录接口其它都放行
      const publicPaths = new Set(['/api/login', '/api/health']);
      if (!publicPaths.has(url.pathname) && !(await isAuthed(req))) {
        return fail(res, 401, '还没登录哦～', { needLogin: true });
      }

      const match = routes.find((r) => r.method === req.method && r.regex.test(url.pathname));
      if (!match) return fail(res, 404, `没有这个接口：${req.method} ${url.pathname}`);

      const m = url.pathname.match(match.regex);
      req.params = {};
      match.keys.forEach((k, i) => (req.params[k] = decodeURIComponent(m[i + 1])));
      req.query = url.searchParams;

      await match.handler(req, res);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    // 配置没填全、AI 网关拒绝这类"是你那边的问题"，不该报成 500，
    // 否则前端只能一律说"服务器出错了"，用户根本不知道该去改哪儿。
    const status = err.status || 500;
    if (status >= 500) console.error('[server]', req.method, url.pathname, err);
    if (!res.headersSent) fail(res, status, err.message || '服务器出错了');
  }
});

backupDaily().catch(() => {});
await getDb();
await getConfig();

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('');
  console.log('  🌸  小米减肥日记 已经跑起来啦');
  console.log(`     本机访问：  http://${shown}:${PORT}`);
  console.log(`     数据文件：  ${DB_FILE}`);
  console.log('     按 Ctrl+C 可以停下来～');
  console.log('');
});
