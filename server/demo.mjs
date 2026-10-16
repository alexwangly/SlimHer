/**
 * 示例数据生成器 —— 让第一次打开就有东西看。
 * 用确定性伪随机，所以每次生成的样子基本一致。
 */
import { uid, localDate } from './store.mjs';

function rng(seed = 20260101) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function shift(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function at(dateStr, hh, mm) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

const WEIGHT_TAGS = ['晨起空腹', '睡前', '运动后', '饭后'];

/** 一周的餐食模板，够展示各种分析结果了 */
const MEAL_TEMPLATES = [
  [
    { slot: 'breakfast', hh: 7, mm: 40, text: '燕麦牛奶粥 + 水煮蛋 + 半根玉米', score: 88, kcal: 320, protein: 18,
      summary: '扎实又清爽的一顿早餐', pros: ['蛋白质够', '粗粮扛饿'], cons: [],
      advice: ['可以再加一小把蓝莓补点维C'], swap: null, encourage: '这样的早餐，上午不会饿到心慌哦～' },
    { slot: 'lunch', hh: 12, mm: 20, text: '鸡胸肉沙拉 + 杂粮饭半碗', score: 85, kcal: 430, protein: 35,
      summary: '减脂餐的标准答案', pros: ['蛋白质很足', '蔬菜量够'], cons: ['沙拉酱可能偏多'],
      advice: ['酱汁换成油醋汁会更轻'], swap: { from: '千岛酱', to: '油醋汁' }, encourage: '这顿吃得漂亮，下午有劲啦！' },
    { slot: 'snack', hh: 15, mm: 30, text: '无糖酸奶 + 一小把坚果', score: 79, kcal: 240, protein: 9,
      summary: '健康的加餐，但坚果别贪多', pros: ['选了无糖的'], cons: ['坚果热量密度高'],
      advice: ['坚果控制在一小把以内'], swap: null, encourage: '会挑加餐的人，减脂都走得比较远～' },
    { slot: 'dinner', hh: 18, mm: 50, text: '清蒸鲈鱼 + 西兰花 + 小半碗米饭', score: 90, kcal: 380, protein: 32,
      summary: '清淡又满足的晚餐', pros: ['优质蛋白', '烹饪方式健康'], cons: [],
      advice: ['饭后散步 20 分钟效果更好'], swap: null, encourage: '今天整体都很稳，给自己鼓个掌！' },
  ],
  [
    { slot: 'breakfast', hh: 8, mm: 10, text: '全麦三明治 + 无糖豆浆', score: 82, kcal: 340, protein: 16,
      summary: '快手又体面的早餐', pros: ['全麦主食'], cons: ['夹心可能有点咸'],
      advice: ['配一份水果更完整'], swap: null, encourage: '赶时间的早晨也能吃得不错呀～' },
    { slot: 'lunch', hh: 12, mm: 40, text: '麻辣烫（清汤，多菜少丸子）+ 米饭', score: 62, kcal: 620, protein: 22,
      summary: '能吃，但隐形油脂和钠都不少', pros: ['蔬菜种类多'], cons: ['汤底钠偏高', '丸子类加工食品多'],
      advice: ['下次把丸子换成豆腐', '汤别喝完'], swap: { from: '各类丸子', to: '嫩豆腐 + 鹌鹑蛋' },
      encourage: '偶尔一顿没关系，下一顿清淡点就回来了～' },
    { slot: 'snack', hh: 16, mm: 0, text: '半杯奶茶（三分糖）', score: 42, kcal: 210, protein: 2,
      summary: '快乐是真的，糖也是真的', pros: ['选了三分糖'], cons: ['液体热量不扛饿', '容易越喝越想喝'],
      advice: ['下次换成无糖茶 + 一份水果'], swap: { from: '奶茶', to: '无糖乌龙 + 一个苹果' },
      encourage: '喝了就喝了，别自责，明天继续就好 💗' },
    { slot: 'dinner', hh: 19, mm: 10, text: '番茄炒蛋 + 凉拌木耳黄瓜 + 半碗饭', score: 84, kcal: 400, protein: 20,
      summary: '家常、清爽、好执行', pros: ['蔬菜量足', '油不多'], cons: [],
      advice: ['炒蛋时少放半勺油就完美了'], swap: null, encourage: '这样吃下去，秤会慢慢给你面子的～' },
  ],
  [
    { slot: 'breakfast', hh: 7, mm: 20, text: '蒸红薯 + 无糖酸奶 + 一个水煮蛋', score: 86, kcal: 290, protein: 15,
      summary: '粗粮 + 蛋白，稳血糖的组合', pros: ['饱腹感强', '升糖慢'], cons: [],
      advice: ['再补点颜色鲜艳的蔬果就更好'], swap: null, encourage: '这顿吃完，上午不容易嘴馋哦～' },
    { slot: 'lunch', hh: 12, mm: 10, text: '牛肉炒时蔬 + 杂粮饭', score: 87, kcal: 470, protein: 34,
      summary: '有肉有菜有主食，很均衡', pros: ['红肉补铁', '搭配均衡'], cons: ['注意炒菜用油量'],
      advice: ['先吃菜和肉，最后吃饭'], swap: null, encourage: '这一餐挑不出什么毛病，厉害！' },
    { slot: 'dinner', hh: 18, mm: 30, text: '菌菇豆腐汤 + 凉拌西兰花 + 半个玉米', score: 89, kcal: 300, protein: 18,
      summary: '轻但不饿，很好的晚餐选择', pros: ['热量低', '汤水饱腹'], cons: [],
      advice: ['如果晚上会饿，加个水煮蛋'], swap: null, encourage: '晚上这么吃，第二天秤上会见效的～' },
  ],
];

function makeAnalysis(t, when) {
  return {
    at: when,
    model: 'demo',
    score: t.score,
    level: t.score >= 80 ? 'great' : t.score >= 60 ? 'good' : t.score >= 40 ? 'meh' : 'bad',
    kcal: t.kcal,
    protein: t.protein,
    summary: t.summary,
    pros: t.pros,
    cons: t.cons,
    advice: t.advice,
    swap: t.swap,
    encourage: t.encourage,
  };
}

/**
 * 生成一份示例数据库（不含 foods，调用方会保留默认食物库）
 * @param {object} base 现有的 db（用来保留 foods / settings）
 */
export function buildDemoDb(base) {
  const today = localDate();
  const start = shift(today, -20);
  const rand = rng(7788);

  const startWeight = 62.0;
  const targetWeight = 52.0;

  /* ---- 体重：20 天空腹记录，其中 5 天晚上多记一次 ---- */
  const weights = [];
  let kg = startWeight;
  const doubleDays = new Set([4, 9, 13, 17, 19]);
  for (let i = 0; i <= 20; i++) {
    const date = shift(start, i);
    kg -= 0.16 + rand() * 0.1; // 总体向下
    if (i % 7 === 3) kg += 0.35; // 偶尔反弹一下，更真实
    const morning = +kg.toFixed(2);
    weights.push({
      id: uid(),
      at: at(date, 6 + (i % 2), 30 + Math.floor(rand() * 20)),
      kg: morning,
      note: i === 0 ? '起点，从今天开始认真记录' : i % 7 === 3 ? '昨晚吃多了点，正常' : '',
      tags: ['晨起空腹'],
    });
    if (doubleDays.has(i)) {
      weights.push({
        id: uid(),
        at: at(date, 21, 30 + Math.floor(rand() * 25)),
        kg: +(morning + 0.4 + rand() * 0.3).toFixed(2),
        note: '晚上称果然重一点，喝水也有重量啦',
        tags: ['睡前'],
      });
    }
  }

  /* ---- 最近 4 周的饮食 ----
     本周每天记全，更早的日子稀疏一些、偶尔整天没记。
     只铺 7 天的话，周报和月报会显示一模一样的数字，月报看着像坏了。 */
  const meals = [];
  for (let i = 27; i >= 0; i--) {
    const date = shift(today, -i);
    const template = MEAL_TEMPLATES[i % MEAL_TEMPLATES.length];
    // 真实使用本来就会断，别摆成一条完美的直线
    if (i > 7 && (i % 5 === 4 || i % 7 === 6)) continue;
    // 更早的日子只记正餐，懒得记加餐
    const items = i > 14 ? template.filter((t) => t.slot !== 'snack') : template;
    for (const t of items) {
      // 今天只记到当前时间为止，更像"正在进行中"
      if (i === 0) {
        const hh = new Date().getHours();
        if (t.hh > hh) continue;
      }
      const when = at(date, t.hh, t.mm);
      meals.push({
        id: uid(),
        date,
        slot: t.slot,
        at: when,
        text: t.text,
        foods: [],
        photoNote: '',
        // 今天最近的一顿留成未分析，好让 AI 按钮有东西可点
        analysis: i === 0 && t.slot === 'lunch' ? null : makeAnalysis(t, when),
      });
    }
  }

  /* ---- 打卡：最近 7 天连续，更早的偶尔断一天 ---- */
  const checkins = {};
  for (let i = 27; i >= 0; i--) {
    if (i > 7 && i % 4 === 3) continue;
    const date = shift(today, -i);
    const r = rand();
    checkins[date] = {
      water: r > 0.35 ? 1500 + Math.floor(rand() * 600) : 800 + Math.floor(rand() * 500),
      mood: ['happy', 'ok', 'tired', 'great'][Math.floor(rand() * 4)],
      poop: ['ok', 'ok', 'no'][Math.floor(rand() * 3)],
      sleep: +(6 + rand() * 2.5).toFixed(1),
      exercise: rand() > 0.45 ? [{ name: rand() > 0.5 ? '快走' : '跳绳', minutes: 20 + Math.floor(rand() * 25) }] : [],
      note: i === 2 ? '今天特别想吃甜的，忍住了，喝了两杯水' : '',
      updatedAt: new Date().toISOString(),
    };
  }

  /* ---- 经期：最近两个周期，好让推算有数据 ---- */
  const periods = [
    { id: uid(), start: shift(today, -34), end: shift(today, -30), note: '' },
    { id: uid(), start: shift(today, -6), end: shift(today, -2), note: '' },
  ];

  /* ---- 里程碑 ---- */
  const lowest = Math.min(...weights.map((w) => w.kg));
  const milestones = [];
  for (let k = 1; k <= 20; k++) {
    const line = +(startWeight - k).toFixed(2);
    if (lowest <= line) milestones.push({ kg: line, at: new Date().toISOString() });
  }

  return {
    ...base,
    version: 1,
    createdAt: base?.createdAt || new Date().toISOString(),
    profile: {
      nickname: '小米',
      avatar: '🐱',
      height: 160,
      startWeight,
      targetWeight,
      startDate: start,
      motto: '不着急，慢慢来，比较快 🌷',
    },
    weights,
    meals,
    checkins,
    periods,
    achievements: {},
    milestones,
    foods: base?.foods?.length ? base.foods : [],
    settings: base?.settings || { units: 'kg', theme: 'strawberry', showBmi: true, encouragement: true },
  };
}

/** 清空成一张白纸，但保留食物库 */
export function buildEmptyDb(base) {
  return {
    ...base,
    profile: {
      nickname: '小米',
      avatar: '🐱',
      height: null,
      startWeight: null,
      targetWeight: null,
      startDate: localDate(),
      motto: '今天也要开开心心地瘦一点点～',
    },
    weights: [],
    meals: [],
    checkins: {},
    periods: [],
    achievements: {},
    milestones: [],
    foods: base?.foods || [],
  };
}
