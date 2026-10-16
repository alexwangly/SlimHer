/**
 * 页面冒烟测试：用极简 DOM 替身把每个 view 的 render() 真跑一遍。
 * 只连本地已经在跑的后端，抓的是"模板炸了/字段读错"这类错误。
 *
 * 用法：先 node server/index.mjs，再 node scripts/render-check.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:4321';

/* ---------------- DOM 替身 ---------------- */

const classList = {
  add() {},
  remove() {},
  toggle() {},
  contains: () => false,
};

function makeStub(label = 'stub') {
  const target = function () {};
  target.__label = label;
  return new Proxy(target, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return undefined;
      if (k === 'toString' || k === 'valueOf') return () => '';
      if (k === Symbol.toStringTag) return 'Stub';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (k === 'classList') return classList;
      if (k === 'style') return t.__style || (t.__style = makeStub('style'));
      if (k === 'dataset') return t.__dataset || (t.__dataset = {});
      if (k === 'files') return [];
      if (k === 'value') return '';
      if (k === 'checked') return false;
      if (k === 'length') return 0;
      if (k === 'children') return [];
      if (k === 'firstElementChild') return null;
      if (k === 'textContent') return t.__text ?? '';
      if (k === 'innerHTML') return t.__html ?? '';
      return makeStub(String(k));
    },
    set(t, k, v) {
      if (k === 'innerHTML' && typeof v === 'string') {
        t.__html = v;
        collected.push({ label: t.__label, html: v });
      }
      if (k === 'textContent') t.__text = v;
      t[k] = v;
      return true;
    },
    apply() {
      return makeStub('call');
    },
    construct() {
      return makeStub('new');
    },
  });
}

/** 所有被赋给 innerHTML 的 HTML 片段 */
const collected = [];

function makeRoot() {
  return makeStub('root');
}

globalThis.window = makeStub('window');
globalThis.window.innerWidth = 390;
globalThis.window.devicePixelRatio = 2;
globalThis.window.addEventListener = () => {};
globalThis.window.scrollTo = () => {};
globalThis.document = makeStub('document');
globalThis.document.querySelector = () => makeStub('el');
globalThis.document.querySelectorAll = () => [];
globalThis.document.createElement = () => makeStub('created');
globalThis.document.body = makeStub('body');
globalThis.location = { hash: '#/home', href: '' };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.setTimeout = globalThis.setTimeout;
globalThis.addEventListener = () => {};

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

// 相对 URL 补上后端地址
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) =>
  realFetch(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, opts);

/* ---------------- 跑起来 ---------------- */

const VIEWS = ['home', 'weight', 'food', 'decide', 'checkin', 'me', 'report'];

/** 每个页面必须出现的东西，防止"渲染成功了但其实是空的" */
const MUST_CONTAIN = {
  home: ['big-number', 'stat__value', 'card__title'],
  weight: ['data-chart', 'data-kg'],
  food: ['data-add', 'meal-block'],
  checkin: ['cal__grid', 'data-cal-day', 'cup__fill', 'data-water-add'],
  report: ['data-kind', 'kv__v', 'card'],
  me: ['badge-grid', 'data-go-report'],
};

const { reload, state } = await import('../public/js/state.js');

const ctx = {
  async refresh() {},
  async rerender() {},
};

let failed = 0;

await reload();
console.log(`数据就绪：体重 ${state.db.weights.length} 笔 / 饮食 ${state.db.meals.length} 条 / 食物 ${state.db.foods.length} 种\n`);

for (const name of VIEWS) {
  const mod = await import(`../public/js/views/${name}.js`);
  const root = makeRoot();
  const before = collected.length;
  const t0 = Date.now();
  try {
    await mod.render(root, ctx);
    const chunks = collected.slice(before);
    const html = chunks.map((c) => c.html).join('\n');

    // 模板里漏出来的坏值
    const bad = [];
    if (/undefined/.test(html)) bad.push('undefined');
    if (/NaN/.test(html)) bad.push('NaN');
    if (/\[object Object\]/.test(html)) bad.push('[object Object]');
    if (/&lt;script/i.test(html)) bad.push('可疑转义');
    const styleHole = html.match(/style="[^"]*(NaN|undefined)[^"]*"/);
    if (styleHole) bad.push('样式里混进坏值: ' + styleHole[0]);

    // HTML 被二次转义（raw() 忘了加，或者加错了地方）
    const leak = html.match(/&lt;(div|span|button|ul|li|svg)\b/);
    if (leak) bad.push('HTML 被转义成了文本: ' + leak[0]);

    // 标签粗略配平
    const opens = (html.match(/<(div|section|span|button|ul|li|svg)\b/g) || []).length;
    const closes = (html.match(/<\/(div|section|span|button|ul|li|svg)>/g) || []).length;

    if (html.length < 200) bad.push(`输出太短 (${html.length} 字节)`);

    // 必须出现的关键内容
    for (const needle of MUST_CONTAIN[name] || []) {
      if (!html.includes(needle)) bad.push(`缺少关键内容: ${needle}`);
    }

    if (bad.length) {
      failed++;
      console.log(`  ❌ ${name.padEnd(7)} ${bad.join(' / ')}`);
      // 定位到真正出问题的那一段，而不是永远指开头
      const markers = [];
      if (leak) markers.push(leak.index);
      for (const m of ['[object Object]', 'undefined', 'NaN']) {
        const i = html.indexOf(m);
        if (i >= 0) markers.push(i);
      }
      const anchor = markers.length ? Math.min(...markers) : 0;
      console.log('       附近片段: ' + html.slice(Math.max(0, anchor - 160), anchor + 120).replace(/\s+/g, ' '));
    } else {
      console.log(
        `  ✅ ${name.padEnd(7)} ${String(html.length).padStart(5)} 字节 · 标签 ${opens}/${closes}${
          opens === closes ? '' : ' ⚠️ 不配平'
        } (${Date.now() - t0}ms)`,
      );
    }
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name.padEnd(7)} ${err.message}`);
    console.log(String(err.stack).split('\n').slice(1, 5).join('\n'));
  }
}

// 顺便跑几个纯函数
try {
  const { analysisBlock, scoreRing, emptyState } = await import('../public/js/components.js');
  const a = analysisBlock({
    score: 82,
    level: 'great',
    kcal: 380,
    protein: 22,
    summary: '很不错的一顿',
    pros: ['有蛋白质'],
    cons: ['蔬菜偏少'],
    advice: ['加点绿叶菜'],
    swap: { from: '白米饭', to: '杂粮饭' },
    encourage: '继续保持呀',
  });
  if (!a.__raw.includes('82') && !a.__raw.includes('很不错')) throw new Error('analysisBlock 输出异常');
  scoreRing(75);
  emptyState({ text: '空' });
  console.log('  ✅ 组件函数通过');
} catch (err) {
  failed++;
  console.log('  ❌ 组件函数：' + err.message);
}

console.log(failed ? `\n有 ${failed} 项没过` : '\n全部通过 🎉');
process.exit(failed ? 1 : 0);
