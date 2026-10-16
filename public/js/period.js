/**
 * 经期推算（前端版，跟 server/metrics.mjs 的 periodInfo 保持同一套口径）。
 *
 * 为什么前端也留一份：打卡页记完经期之后可以立刻重算并重绘，
 * 不用等 /api/stats 回来，动画不会断。口径改的时候两边要一起改。
 */

import { todayStr, parseDay, shiftDay } from './utils.js';

export function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}

export function periodInfo(db) {
  const today = todayStr();
  const list = [...(db?.periods || [])].filter((p) => p && p.start).sort((a, b) => (a.start < b.start ? -1 : 1));
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

  let bleedLength = 5;
  const lens = finished.map((p) => daysBetween(p.start, p.end) + 1).filter((n) => n >= 1 && n <= 12);
  if (lens.length) bleedLength = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);

  const last = list[list.length - 1] || null;
  const ongoing =
    list.find((p) => !p.end && daysBetween(p.start, today) >= 0 && daysBetween(p.start, today) <= 12) || null;

  let dayOfCycle = null;
  let nextStart = null;
  let daysToNext = null;
  if (last) {
    dayOfCycle = daysBetween(last.start, today) + 1;
    nextStart = shiftDay(last.start, cycleLength);
    let guard = 0;
    while (daysBetween(today, nextStart) < 0 && guard++ < 3) nextStart = shiftDay(nextStart, cycleLength);
    daysToNext = daysBetween(today, nextStart);
  }

  // 容易水肿/体重虚高的窗口：
  //   1) 正在经期里（第 1~3 天最明显）
  //   2) 下次经期前的 3 天（黄体期水肿）
  // 注意别把"经期结束后那几天"也算进来：那时体重上涨跟经期没关系，
  // 硬套一个"经前水肿"的说法只会让人困惑。
  const inBloatingWindow = !!ongoing || (daysToNext != null && daysToNext <= 3);

  const stage = !last
    ? 'none'
    : ongoing
      ? 'period'
      : daysToNext != null && daysToNext <= 3
        ? 'pms'
        : dayOfCycle != null && dayOfCycle >= 12 && dayOfCycle <= 16
          ? 'ovulation'
          : 'normal';

  return {
    today,
    hasData: list.length > 0,
    periods: list,
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
    stage,
  };
}

/** 一句话描述现在处在周期的哪个阶段 */
export function periodStageText(info) {
  if (!info.hasData) return '还没记过经期';
  switch (info.stage) {
    case 'period':
      return `经期第 ${info.ongoingDay} 天`;
    case 'pms':
      return info.daysToNext === 0 ? '预计今天来' : `还有 ${info.daysToNext} 天来经期`;
    case 'ovulation':
      return '差不多是排卵期';
    default:
      return info.daysToNext != null ? `离下次经期还有 ${info.daysToNext} 天` : '周期进行中';
  }
}

/**
 * 体重上涨时，判断能不能用"经期水肿"来解释。
 * 返回 null 表示不该拿经期当借口。
 */
export function bloatExplain(info, trend) {
  if (!info.hasData || trend == null || trend <= 0.15) return null;
  if (!info.inBloatingWindow) return null;
  const rise = Math.abs(trend).toFixed(1);
  if (info.stage === 'period') {
    return `经期第 ${info.ongoingDay} 天，涨的 ${rise}kg 多半是水分和糖原，等结束了会掉回去的。`;
  }
  return `离经期还有 ${info.daysToNext} 天，这 ${rise}kg 很可能是经前水肿，别被秤吓到呀。`;
}
