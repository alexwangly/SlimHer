/* 体重曲线：canvas 手绘，带入场动画和触摸提示 */

import { dayShort, fmtKg } from './utils.js';

const PAD = { l: 36, r: 14, t: 16, b: 26 };

function niceBounds(values) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return { min: 0, max: 1 };
  let min = Math.min(...clean);
  let max = Math.max(...clean);
  const span = max - min;
  const padY = Math.max(0.5, span * 0.18);
  min -= padY;
  max += padY;
  if (max - min < 1.5) {
    const mid = (max + min) / 2;
    min = mid - 0.9;
    max = mid + 0.9;
  }
  return { min, max };
}

function smooth(ctx, pts) {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.2;
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) * t,
      p1.y + (p2.y - p0.y) * t,
      p2.x - (p3.x - p1.x) * t,
      p2.y - (p3.y - p1.y) * t,
      p2.x,
      p2.y,
    );
  }
}

/**
 * 统一的取数：体重页的 series 用 `last`，周报用 `value`，
 * 这里三种都认，免得换个调用方就静默画出一条空线。
 */
function pickValue(d) {
  if (d == null) return NaN;
  if (Number.isFinite(d.last)) return d.last;
  if (Number.isFinite(d.value)) return d.value;
  if (Number.isFinite(d.kg)) return d.kg;
  return NaN;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{series:Array, movingAvg:Array, goal:number|null, tipEl:HTMLElement}} opts
 */
export function drawWeightChart(canvas, opts = {}) {
  if (!canvas) return;
  const { series = [], movingAvg = [], goal = null, tipEl = null } = opts;
  // 记住最后一次的参数：resize 时直接用同一份重画，几何信息每次都重新算
  canvas.__miCfg = opts;
  canvas.__miRedraw = () => drawWeightChart(canvas, canvas.__miCfg);

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 320;
  const h = canvas.clientHeight || 190;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const points = series
    .map((d) => ({ date: d.date, value: pickValue(d) }))
    .filter((d) => d.date && Number.isFinite(d.value));
  const maPoints = movingAvg
    .map((d) => ({ date: d.date, value: pickValue(d) }))
    .filter((d) => d.date && Number.isFinite(d.value));

  if (!points.length) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#bda5ac';
    ctx.font = '600 13px "PingFang SC", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('还没有数据，记一笔试试～', w / 2, h / 2);
    return;
  }

  const dataValues = [...points.map((p) => p.value), ...maPoints.map((p) => p.value)];
  const dataMin = Math.min(...dataValues);
  const dataMax = Math.max(...dataValues);
  const dataSpan = Math.max(0.8, dataMax - dataMin);
  // 目标离数据太远时就不塞进 Y 轴，否则整条曲线会被压成一条直线；
  // 这时候改成在底边挂一个小绿标，信息不丢，图也好看。
  const goalInRange = goal != null && goal >= dataMin - dataSpan * 1.2 && goal <= dataMax + dataSpan * 1.2;
  // 告诉外面目标线到底画没画，图例好跟着显示
  canvas.dataset.goalVisible = goal == null ? 'none' : goalInRange ? 'yes' : 'edge';
  const { min, max } = niceBounds(goalInRange ? [...dataValues, goal] : dataValues);

  const plotW = w - PAD.l - PAD.r;
  const plotH = h - PAD.t - PAD.b;
  const n = points.length;

  const X = (i) => PAD.l + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const Y = (v) => PAD.t + plotH - ((v - min) / (max - min)) * plotH;

  const mIndex = new Map(maPoints.map((p) => [p.date, p.value]));

  // 提示气泡每次画完更新几何信息，保证切换时间范围后不会读到旧坐标
  canvas.__miGeom = { points, X, Y, mIndex, n };

  function frameGrid() {
    ctx.clearRect(0, 0, w, h);
    // 网格 + Y 轴刻度
    ctx.font = '600 10px "PingFang SC", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = min + ((max - min) * i) / steps;
      const y = Y(v);
      ctx.strokeStyle = i === 0 ? 'rgba(255,183,199,0.55)' : 'rgba(255,183,199,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(w - PAD.r, y);
      ctx.stroke();
      ctx.fillStyle = '#bda5ac';
      ctx.fillText(v.toFixed(1), PAD.l - 7, y);
    }
    // X 轴日期，最多 5 个
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ticks = Math.min(5, n);
    for (let i = 0; i < ticks; i++) {
      const idx = Math.round((i * (n - 1)) / Math.max(1, ticks - 1));
      ctx.fillStyle = '#bda5ac';
      ctx.fillText(dayShort(points[idx].date), X(idx), h - PAD.b + 7);
    }
  }

  function drawGoal() {
    if (goal == null) return;

    if (!goalInRange) {
      // 目标在视野外，只在角落提示一下方向
      const below = goal < min;
      ctx.font = '700 10px "PingFang SC", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#5fc79c';
      ctx.fillText(`${below ? '↓' : '↑'} 目标 ${fmtKg(goal)} 在${below ? '下' : '上'}面`, PAD.l + 2, h - PAD.b - 3);
      return;
    }

    const y = Y(goal);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(95,199,156,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(w - PAD.r, y);
    ctx.stroke();
    ctx.restore();
    ctx.font = '700 10px "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = '#5fc79c';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`目标 ${fmtKg(goal)}`, PAD.l + 4, y - 2);
  }

  function drawLine(limit) {
    // limit: 0~1 表示画到哪
    const upto = limit * (n - 1);
    const drawn = points.slice(0, Math.max(1, Math.floor(upto) + 1)).map((p, i) => ({ x: X(i), y: Y(p.value) }));

    // 面积
    const grad = ctx.createLinearGradient(0, PAD.t, 0, h - PAD.b);
    grad.addColorStop(0, 'rgba(255,143,177,0.42)');
    grad.addColorStop(1, 'rgba(255,143,177,0.02)');
    ctx.beginPath();
    smooth(ctx, drawn);
    ctx.lineTo(drawn[drawn.length - 1].x, h - PAD.b);
    ctx.lineTo(drawn[0].x, h - PAD.b);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 主线
    ctx.beginPath();
    smooth(ctx, drawn);
    ctx.strokeStyle = '#f2688f';
    ctx.lineWidth = 2.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // 数据点
    drawn.forEach((p, i) => {
      const isLast = i === drawn.length - 1 && limit >= 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isLast ? 4.6 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#f2688f';
      ctx.stroke();
      if (isLast) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,143,177,0.22)';
        ctx.fill();
      }
    });
  }

  function drawMA(limit) {
    const pts = points
      .map((p, i) => ({ x: X(i), y: Y(mIndex.get(p.date) ?? p.value), v: mIndex.get(p.date), i }))
      .filter((p) => p.v != null && p.i <= limit * (n - 1));
    if (pts.length < 2) return;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    smooth(ctx, pts);
    ctx.strokeStyle = 'rgba(203,184,255,0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  let progress = 0;
  const animate = () => {
    frameGrid();
    drawGoal();
    drawMA(progress);
    drawLine(progress);
  };

  // 关掉动画偏好的人不该看见曲线"长出来"，直接给最终帧
  const reduceMotion =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) {
    progress = 1;
    animate();
  } else {
    const start = performance.now();
    const dur = 900;
    function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      progress = 1 - Math.pow(1 - t, 3);
      animate();
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---- 触摸 / 鼠标提示（只绑一次，读的是最新几何） ---- */
  if (tipEl && !canvas.__miBound) {
    canvas.__miBound = true;
    const showAt = (clientX) => {
      const g = canvas.__miGeom;
      if (!g || !g.points.length) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      let idx = 0;
      let best = Infinity;
      for (let i = 0; i < g.n; i++) {
        const d = Math.abs(g.X(i) - x);
        if (d < best) {
          best = d;
          idx = i;
        }
      }
      const p = g.points[idx];
      const ma = g.mIndex.get(p.date);
      tipEl.innerHTML = `<b>${p.date.slice(5)}</b> ${fmtKg(p.value)}kg${ma != null ? ` · 均${fmtKg(ma)}` : ''}`;
      tipEl.style.left = g.X(idx) + 'px';
      tipEl.style.top = g.Y(p.value) + 'px';
      tipEl.classList.add('is-on');
    };
    const hide = () => tipEl.classList.remove('is-on');
    canvas.addEventListener('pointermove', (e) => showAt(e.clientX));
    canvas.addEventListener('pointerdown', (e) => showAt(e.clientX));
    canvas.addEventListener('pointerleave', hide);
    canvas.addEventListener('pointerup', hide);
  }
}
