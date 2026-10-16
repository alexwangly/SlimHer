/**
 * 「特定状态下的页面」检查。
 *
 * render-check.mjs 保证每个页面在正常数据下能渲染出来；这个脚本补的是
 * 那些平时走不到的渲染分支——它们恰恰最容易悄悄坏掉，因为只在特定条件下出现：
 *
 *   1. 经期水肿提醒卡片（要正好在易水肿窗口里 + 最近确实涨秤）
 *   2. AI 总结的结果块（要有能用的网关，这里直接把网关响应拦下来伪造）
 *
 * 用法：先 node server/index.mjs，再 node scripts/state-check.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:4321';

/**
 * 设了 DUMP_HTML=<路径> 就把渲染出来的 HTML 配上一套真样式，
 * 写成一个自成一体的小页面。这样可以用无头浏览器直接看这些
 * 平时走不到的分支长什么样（断言只能保证字符串在，保证不了好不好看）。
 */
const DUMP_HTML = process.env.DUMP_HTML || '';

/* ---------------- DOM 替身 ---------------- */

const collected = [];

/** 每个 innerHTML 赋值都记下来，最后拼成一整页 HTML 来断言 */
function makeEl(label) {
  const cls = new Set();
  const el = {
    __label: label,
    __html: '',
    __text: '',
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      add: (...c) => c.forEach((x) => cls.add(x)),
      remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)),
      contains: (c) => cls.has(c),
    },
    get innerHTML() {
      return this.__html;
    },
    set innerHTML(v) {
      this.__html = String(v);
      collected.push(this.__html);
    },
    get textContent() {
      return this.__text;
    },
    set textContent(v) {
      this.__text = String(v);
    },
    // 其它属性随便读写，别炸就行
    value: '',
    checked: false,
    files: [],
    children: [],
    firstElementChild: null,
    offsetWidth: 0,
    clientWidth: 360,
    clientHeight: 190,
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    remove() {},
    querySelector(sel) {
      return child(this, sel);
    },
    querySelectorAll() {
      return [];
    },
    getContext() {
      return ctx2d;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 190 }),
    setAttribute() {},
    getAttribute: () => null,
    closest: () => null,
    focus() {},
    blur() {},
    scrollIntoView() {},
  };
  return el;
}

/** 同一个元素上同一选择器每次都要拿到同一个替身，否则拿不回 onclick */
const childCache = new WeakMap();
function child(parent, sel) {
  let m = childCache.get(parent);
  if (!m) childCache.set(parent, (m = new Map()));
  if (!m.has(sel)) m.set(sel, makeEl(sel));
  return m.get(sel);
}

/** 万能替身：既能当函数调用，也能继续点属性，永远不炸 */
const anyFn = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyFn),
  apply: () => anyFn,
  construct: () => anyFn,
  set: () => true,
});

/** canvas 2d context 替身：createLinearGradient() 这类要能接着链式调用 */
const ctx2d = new Proxy(
  {},
  {
    get: () => anyFn,
    set: () => true,
  },
);

const root = makeEl('root');
const docEl = makeEl('document');

globalThis.window = makeEl('window');
globalThis.window.innerWidth = 390;
globalThis.window.devicePixelRatio = 2;
globalThis.window.addEventListener = () => {};
globalThis.window.scrollTo = () => {};
globalThis.window.matchMedia = () => ({ matches: true, addEventListener() {} });
globalThis.document = docEl;
globalThis.document.body = makeEl('body');
globalThis.document.documentElement = docEl;
globalThis.document.createElement = () => makeEl('created');
globalThis.location = { hash: '#/home', href: '' };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.addEventListener = () => {};
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const realFetch = globalThis.fetch;
/** 伪造的 AI 总结响应；命中就返回它，其余照旧打真后端 */
let fakeSummary = null;
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (fakeSummary && u.includes('/api/report/summary')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, summary: fakeSummary }),
      text: async () => JSON.stringify({ ok: true, summary: fakeSummary }),
    });
  }
  return realFetch(u.startsWith('/') ? BASE + u : u, opts);
};

/* ---------------- 跑 ---------------- */

const { reload, state } = await import('../public/js/state.js');
const { periodInfo, bloatExplain } = await import('../public/js/period.js');

const ctx = { async refresh() {}, async rerender() {} };

let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

/** 渲染一个页面，返回这次产生的所有 HTML */
async function renderPage(name) {
  const mod = await import(`../public/js/views/${name}.js`);
  const before = collected.length;
  await mod.render(root, ctx);
  return collected.slice(before).join('\n');
}

const pad = (n) => String(n).padStart(2, '0');
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

await reload();
console.log(`数据就绪：体重 ${state.db.weights.length} 笔\n`);

/* ---- 1. 经期水肿提醒 ---- */

console.log('经期水肿提醒卡片');

const savedPeriods = state.db.periods;
const savedTrend = state.stats?.trend7;

// 昨天来经期、还没结束 → 今天在易水肿窗口里
state.db.periods = [{ id: 'probe', start: daysAgo(-1), end: null, note: '' }];

// 不涨秤的时候，不该出现任何"是水肿啦"的说法
state.stats = { ...state.stats, trend7: 0.0 };
let html = await renderPage('home');
const quiet = /bloat-tip/.test(html);
check('没涨秤时首页不出现提醒卡片', !quiet);
check('periodInfo 认为处在易水肿窗口', periodInfo(state.db).inBloatingWindow === true);

// 涨了 0.5kg 就该提醒，并且说的是"经期第 N 天"而不是"离经期还有 N 天"
state.stats = { ...state.stats, trend7: 0.5 };
html = await renderPage('home');
check('涨秤时首页出现提醒卡片', /bloat-tip/.test(html));
check('提醒里说清楚了是经期第几天', /经期第 \d+ 天/.test(html));
check('提醒里给出了涨幅', /0\.5kg|0\.5 kg/.test(html));
const tipText = bloatExplain(periodInfo(state.db), 0.5) || '';
check('提醒用「水肿」解释而不是只说涨了', /水分|水肿/.test(tipText), tipText);

// 经期结束之后就不该再拿经期当借口
state.db.periods = [{ id: 'probe', start: daysAgo(-4), end: daysAgo(-1), note: '' }];
html = await renderPage('home');
check('经期结束后不再拿经期当借口', !/bloat-tip/.test(html));

state.db.periods = savedPeriods;
state.stats = { ...state.stats, trend7: savedTrend };

/* ---- 2. AI 总结结果块 ---- */

console.log('\nAI 总结结果块');

fakeSummary = {
  headline: '这一周稳得很，掉了 0.8kg',
  emoji: '🌷',
  mood: 'great',
  highlights: ['七天里记了七天的体重', '日均 1189 kcal 不极端'],
  watchout: ['有两天的蔬菜偏少'],
  nextStep: '下一期每天加一份绿叶菜',
  note: '你已经在往对的方向走了，不用急。',
  at: new Date().toISOString(),
};

html = await renderPage('report');
check('没点按钮时不该有总结内容', !/这一周稳得很/.test(html));
check('没点按钮时给的是"让 AI 写一份成绩单"', /让 AI 写一份成绩单/.test(html));

// 找到按钮并真触发它的 onclick
const aiBtn = child(root, '[data-ai]');
check('找到了 AI 按钮并且挂上了处理函数', typeof aiBtn.onclick === 'function');
if (typeof aiBtn.onclick === 'function') {
  const before = collected.length;
  await aiBtn.onclick({ currentTarget: aiBtn });
  const after = collected.slice(before).join('\n');
  check('点了之后出现 AI 写的标题', /这一周稳得很/.test(after));
  check('出现 emoji', /🌷/.test(after));
  check('出现做得好的地方', /七天里记了七天的体重/.test(after));
  check('出现可以留意的地方', /有两天的蔬菜偏少/.test(after));
  check('出现下一期只做一件事', /下一期每天加一份绿叶菜/.test(after));
  check('出现那句安抚', /不用急/.test(after));
  check('按钮变成"换一份总结"', /换一份总结/.test(after));
  check('没有把对象直接漏进 HTML', !/\[object Object\]/.test(after));
}

/* ---- 3. 空数据下不该崩 ---- */

console.log('\n空数据兜底');
state.db.periods = [];
state.stats = { ...state.stats, trend7: null };
html = await renderPage('home');
check('完全没有经期记录时首页照常渲染', html.length > 2000 && !/bloat-tip/.test(html));
html = await renderPage('report');
check('完全没有经期记录时周报照常渲染', html.length > 2000);

/* ---- 4. 可选：把某个状态导出成能直接看的页面 ---- */

if (DUMP_HTML) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(DUMP_HTML), { recursive: true });
  // 导出带 AI 总结的周报：这是平时最走不到的一段渲染，得先把按钮点一下
  let reportHtml = await renderPage('report');
  const dumpBtn = child(root, '[data-ai]');
  if (typeof dumpBtn.onclick === 'function') {
    const before = collected.length;
    await dumpBtn.onclick({ currentTarget: dumpBtn });
    // 只取最后一次整页渲染：中间还有"AI 正在读你的记录"这类过程态
    const chunks = collected.slice(before);
    const last = [...chunks].reverse().find((h) => /report-hero/.test(h));
    if (last) reportHtml = last;
  }

  const preview = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>state-check 预览</title>
<link rel="stylesheet" href="http://127.0.0.1:4321/css/style.css" />
<link rel="stylesheet" href="http://127.0.0.1:4321/css/animations.css" />
<style>
  body { background: var(--cream); margin: 0; }
  .preview { max-width: 512px; margin: 0 auto; padding: 16px 12px 60px; }
  .preview__title { font: 800 13px/1.6 var(--font-round); color: var(--strawberry-deep); margin: 6px 4px 10px; }
  /* 预览页没有 app.js 去启动入场动画，这里直接给终态，免得截图是空的 */
  .view, .card, .list-item, .badge, .bar-chart__bar, .cal__cell, .analysis__list li { animation: none !important; opacity: 1 !important; }
  /* 只看 AI 总结那张卡，别的先藏起来，免得截图截在折叠线以上 */
  .preview .view > .card:not(:last-child) { display: none; }
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute"><defs>
  <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#ffb7c7"/><stop offset="100%" stop-color="#f2688f"/>
  </linearGradient>
</defs></svg>
<div class="preview">
  <div class="preview__title">AI 总结渲染预览（数据是伪造的网关响应）</div>
  <main class="main">${reportHtml}</main>
</div>
</body>
</html>`;
  await writeFile(DUMP_HTML, preview, 'utf8');
  console.log(`\n已导出预览页：${DUMP_HTML}`);
}

console.log(failed ? `\n有 ${failed} 项没过` : '\n全部通过 🎉');
process.exit(failed ? 1 : 0);
