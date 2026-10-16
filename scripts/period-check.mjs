/**
 * 经期推算的回归检查。
 *
 * 有两件事容易悄悄坏掉：
 *   1. server/metrics.mjs 和 public/js/period.js 是两份重复实现，
 *      改了一边忘了另一边，页面上的说法就和后端算的对不上；
 *   2. "这几天体重上涨是水肿" 这种话一旦判断错，就是在给用户一个
 *      错误的安慰，比不说还糟。
 *
 * 用法：node scripts/period-check.mjs
 */
import { periodInfo as serverPeriod } from '../server/metrics.mjs';
import { periodInfo as clientPeriod, bloatExplain } from '../public/js/period.js';

const KEYS = [
  'hasData',
  'ongoing',
  'ongoingDay',
  'dayOfCycle',
  'nextStart',
  'daysToNext',
  'cycleLength',
  'bleedLength',
  'estimated',
  'inBloatingWindow',
  'stage',
];

const fmt = (n) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const one = (startOffset, endOffset = null) => ({
  periods: [{ id: 'p', start: fmt(startOffset), end: endOffset == null ? null : fmt(endOffset) }],
});

const two = (aStart, aEnd, bStart, bEnd) => ({
  periods: [
    { id: 'a', start: fmt(aStart), end: aEnd == null ? null : fmt(aEnd) },
    { id: 'b', start: fmt(bStart), end: bEnd == null ? null : fmt(bEnd) },
  ],
});

const PARITY_CASES = [
  ['完全没记录', { periods: [] }],
  ['只有一次进行中', one(-1)],
  ['刚结束', one(-4, -1)],
  ['经前 3 天', one(-25, -21)],
  ['两次记录（可算周期）', two(-56, -52, -28, -24)],
  ['最近一次没填结束日', two(-34, -30, -1)],
  ['长周期 35 天', two(-35, -31, -1)],
  ['脏数据（结束早于开始）', one(-10, -20)],
];

// [说明, db, 七天趋势, 是否应该提醒]
const BLOAT_CASES = [
  ['经期中涨秤', one(-1), 0.4, true],
  ['经期中没涨', one(-1), 0.0, false],
  ['经期刚结束涨秤（不该甩锅给经期）', one(-4, -1), 0.5, false],
  ['经前 3 天涨秤', one(-25, -21), 0.5, true],
  ['经前 3 天只涨了一点点', one(-25, -21), 0.05, false],
  ['经前 4 天涨秤', one(-24, -20), 0.5, false],
  ['排卵期涨秤', one(-14, -10), 0.5, false],
  ['没有经期记录', { periods: [] }, 0.5, false],
];

let failed = 0;

console.log('前后端口径对比');
for (const [name, db] of PARITY_CASES) {
  const s = serverPeriod(db);
  const c = clientPeriod(db);
  const diff = KEYS.filter((k) => String(s[k]) !== String(c[k]));
  if (diff.length) {
    failed++;
    console.log(`  ❌ ${name}`);
    for (const k of diff) console.log(`       ${k}: server=${s[k]}  client=${c[k]}`);
  } else {
    console.log(
      `  ✅ ${name.padEnd(22)} stage=${String(s.stage).padEnd(9)} day=${String(s.dayOfCycle ?? '-').padStart(2)} ` +
        `toNext=${String(s.daysToNext ?? '-').padStart(2)} cycle=${String(s.cycleLength).padStart(2)}`,
    );
  }
}

console.log('\n水肿提醒该不该出现');
for (const [name, db, trend, should] of BLOAT_CASES) {
  const info = clientPeriod(db);
  const msg = bloatExplain(info, trend);
  const got = !!msg;
  if (got === should) {
    console.log(`  ✅ ${name.padEnd(32)} ${should ? '提醒：' + msg : '不提醒'}`);
  } else {
    failed++;
    console.log(`  ❌ ${name.padEnd(32)} 期望 ${should ? '提醒' : '不提醒'}，实际 ${got ? '提醒：' + msg : '没提醒'}`);
  }
}

// 周期长度必须真的用上"最近一次没填结束日"的那段间隔
const open = clientPeriod(two(-34, -30, -1));
if (open.cycleLength !== 33) {
  failed++;
  console.log(`\n  ❌ 最近一次没填结束日时，周期长度应为 33，实际 ${open.cycleLength}`);
}

console.log(failed ? `\n有 ${failed} 项没过` : '\n全部通过 🎉');
process.exit(failed ? 1 : 0);
