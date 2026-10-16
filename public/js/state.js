/* 全局状态：数据量很小，改动后整体重取，简单可靠 */

import { api } from './api.js';

export const state = {
  db: null,
  stats: null, // 全量统计
  ai: { enabled: false, configured: false, model: '' },
  auth: { enabled: false, authed: true },
  today: null,
  route: 'home',
  config: null,
  ready: false,
};

export async function reload() {
  const [boot, statsRes] = await Promise.all([api.bootstrap(), api.stats(0)]);
  state.db = boot.db;
  state.ai = boot.ai || state.ai;
  state.auth = { ...state.auth, enabled: !!boot.auth?.enabled };
  state.today = boot.today;
  state.stats = statsRes.stats;
  state.ready = true;
  return state;
}

/** 只刷新统计，不重取整库（用于图表切换范围之类） */
export async function refreshStats(range = 0) {
  const res = await api.stats(range);
  return res.stats;
}

/* ---------------- 本地缓存（AI 每日一句之类） ---------------- */

const KEY = 'mi-diary:';

export function cacheGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(KEY + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function cacheSet(key, value) {
  try {
    localStorage.setItem(KEY + key, JSON.stringify(value));
  } catch {}
}

/* ---------------- 便捷读取 ---------------- */

export const profile = () => state.db?.profile || {};
export const weights = () => [...(state.db?.weights || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
export const meals = () => state.db?.meals || [];
export const foods = () => state.db?.foods || [];

export function mealsOn(date) {
  return meals()
    .filter((m) => m.date === date)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

export function weightsOn(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return weights()
    .filter((w) => {
      const d = new Date(w.at);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === date;
    })
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

/** 最近一条体重 */
export const latestWeight = () => {
  const w = weights();
  return w.length ? w[w.length - 1] : null;
};

/** 某条记录的前一条（用来算增减） */
export function previousWeight(entry) {
  const list = weights();
  const i = list.findIndex((x) => x.id === entry.id);
  return i > 0 ? list[i - 1] : null;
}

/** 每天的汇总（用于列表分组） */
export function daysFromWeights(list = weights()) {
  const map = new Map();
  for (const w of list) {
    const d = new Date(w.at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(w);
  }
  return [...map.entries()]
    .map(([date, entries]) => ({ date, entries: entries.sort((a, b) => new Date(a.at) - new Date(b.at)) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
