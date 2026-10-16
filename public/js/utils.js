/* 一些到处都要用的小工具 */

/** HTML 转义 —— 凡是用户输入过的内容都必须过这一道 */
export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 标记一段不想被转义的 HTML */
export const raw = (s) => ({ __raw: String(s) });

/** 模板字符串，插值默认转义；要用 HTML 就套 raw() */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    const piece = Array.isArray(v)
      ? v.map((x) => (x && x.__raw !== undefined ? x.__raw : esc(x))).join('')
      : v && v.__raw !== undefined
        ? v.__raw
        : esc(v);
    out += piece + strings[i + 1];
  });
  return out;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export const fmt = (n, d = 1) =>
  n === null || n === undefined || Number.isNaN(Number(n)) ? '--' : Number(n).toFixed(d);

/** 去掉尾巴上的 0：58.50 -> 58.5，58.00 -> 58 */
export const fmtKg = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '--';
  return String(+Number(n).toFixed(2));
};

/* ---------------- 日期 ---------------- */

const pad = (n) => String(n).padStart(2, '0');

export function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayStr = () => dateStr(new Date());

export function parseDay(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function shiftDay(s, delta) {
  const d = parseDay(s);
  d.setDate(d.getDate() + delta);
  return dateStr(d);
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekday(s) {
  return WEEK[parseDay(s).getDay()];
}

/** 今天 / 昨天 / 前天 / 3月5日 周三 */
export function dayLabel(s) {
  const today = todayStr();
  if (s === today) return '今天';
  if (s === shiftDay(today, -1)) return '昨天';
  if (s === shiftDay(today, -2)) return '前天';
  const d = parseDay(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日 ${weekday(s)}`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 只给日期用的小标签 */
export function dayShort(s) {
  const d = parseDay(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function timeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 记录时用的 datetime-local 值 */
export function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return { text: '夜深啦', emoji: '🌙' };
  if (h < 9) return { text: '早安', emoji: '🌤️' };
  if (h < 12) return { text: '上午好', emoji: '🍓' };
  if (h < 14) return { text: '午安', emoji: '🍚' };
  if (h < 18) return { text: '下午好', emoji: '🧋' };
  if (h < 22) return { text: '晚上好', emoji: '🌷' };
  return { text: '该睡啦', emoji: '💤' };
}

/* ---------------- 杂 ---------------- */

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带种子的伪随机，保证同一天抽到的东西稳定（可选） */
export function seededRandom(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) % 2147483647;
  return () => {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** 按 weight 权重随机挑一个 */
export function weightedPick(list, rnd = Math.random) {
  const total = list.reduce((s, x) => s + (Number(x.weight) || 1), 0);
  let r = rnd() * total;
  for (const item of list) {
    r -= Number(item.weight) || 1;
    if (r <= 0) return item;
  }
  return list[list.length - 1];
}

/* ---------------- 常量 ---------------- */

export const SLOTS = [
  { key: 'breakfast', name: '早餐', emoji: '🌅', tint: '#fff1d6' },
  { key: 'lunch', name: '午餐', emoji: '🍱', tint: '#ffe4ec' },
  { key: 'dinner', name: '晚餐', emoji: '🌛', tint: '#e6f0ff' },
  { key: 'snack', name: '加餐', emoji: '🍓', tint: '#e8fbf1' },
];

export const slotOf = (k) => SLOTS.find((s) => s.key === k) || SLOTS[1];

export const WEIGHT_TAGS = ['晨起空腹', '睡前', '运动后', '饭后', '生理期', '喝了水'];

export const MOODS = [
  { key: 'lazy', label: '懒得做', emoji: '🛋️' },
  { key: 'hungry', label: '很饿', emoji: '😵' },
  { key: 'light', label: '想吃清淡', emoji: '🥗' },
  { key: 'happy', label: '心情好', emoji: '🥰' },
  { key: 'sad', label: '想被安慰', emoji: '🥺' },
  { key: 'treat', label: '想奖励自己', emoji: '🎁' },
  { key: 'fast', label: '赶时间', emoji: '⚡' },
  { key: 'cheap', label: '想省钱', emoji: '🪙' },
];

export const LEVEL_INFO = {
  great: { label: '超棒', emoji: '🌟', cls: 'great' },
  good: { label: '还不错', emoji: '👍', cls: 'good' },
  meh: { label: '一般般', emoji: '😐', cls: 'meh' },
  bad: { label: '有点踩雷', emoji: '😣', cls: 'bad' },
};

export const AVATARS = ['🐱', '🐰', '🐻', '🐼', '🐨', '🦊', '🐣', '🐧', '🦄', '🐹', '🍓', '🌸'];
