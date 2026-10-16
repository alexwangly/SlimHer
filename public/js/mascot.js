/* 吉祥物：一只叫"小米团"的粉色小猫，纯 SVG 手绘 + CSS 动画 */

const INK = '#f491b3';
const FUR = '#fff2f7';
const FUR_DARK = '#ffe0ea';
const BLUSH = '#ffb0c8';

function eyes(mood) {
  const L = 47;
  const R = 73;
  const y = 58;
  switch (mood) {
    case 'happy':
    case 'cheer':
      // 弯弯的笑眼 ^ ^
      return `
        <path d="M${L - 6} ${y + 2} q6 -7 12 0" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" class="mascot__eye"/>
        <path d="M${R - 6} ${y + 2} q6 -7 12 0" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" class="mascot__eye"/>`;
    case 'sad':
      return `
        <ellipse cx="${L}" cy="${y + 1}" rx="5.2" ry="5.8" fill="#5c4148" class="mascot__eye"/>
        <ellipse cx="${R}" cy="${y + 1}" rx="5.2" ry="5.8" fill="#5c4148" class="mascot__eye"/>
        <circle cx="${L + 1.8}" cy="${y - 1.4}" r="1.9" fill="#fff"/>
        <circle cx="${R + 1.8}" cy="${y - 1.4}" r="1.9" fill="#fff"/>
        <path d="M${L - 7} ${y - 7} q7 -3 13 1" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" opacity="0.7"/>
        <path d="M${R + 7} ${y - 7} q-7 -3 -13 1" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" opacity="0.7"/>
        <path d="M${R + 8} ${y + 8} q3 6 0 8 q-3 -2 0 -8" fill="#8ecbff" opacity="0.9"/>`;
    case 'think':
      return `
        <ellipse cx="${L}" cy="${y}" rx="5" ry="6" fill="#5c4148" class="mascot__eye"/>
        <path d="M${R - 6} ${y + 1} q6 -5 12 0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
        <circle cx="${L + 1.6}" cy="${y - 2}" r="1.8" fill="#fff"/>`;
    default:
      return `
        <ellipse cx="${L}" cy="${y}" rx="4.9" ry="5.8" fill="#5c4148" class="mascot__eye"/>
        <ellipse cx="${R}" cy="${y}" rx="4.9" ry="5.8" fill="#5c4148" class="mascot__eye"/>
        <circle cx="${L + 1.9}" cy="${y - 2}" r="1.9" fill="#fff"/>
        <circle cx="${R + 1.9}" cy="${y - 2}" r="1.9" fill="#fff"/>`;
  }
}

function mouth(mood) {
  const y = 64;
  if (mood === 'cheer')
    return `<ellipse cx="60" cy="${y + 5}" rx="5.4" ry="6" fill="#e2648c"/>
              <ellipse cx="60" cy="${y + 7.4}" rx="3" ry="3.2" fill="#ff9cbb"/>`;
  if (mood === 'happy') return `<path d="M52 ${y + 2} q8 7 16 0" fill="none" stroke="#e2648c" stroke-width="2.6" stroke-linecap="round"/>`;
  if (mood === 'sad') return `<path d="M53 ${y + 6} q7 -6 14 0" fill="none" stroke="#e2648c" stroke-width="2.6" stroke-linecap="round"/>`;
  return `<path d="M60 ${y} c-1.3 3.2 -4.6 3.2 -6.2 0.6" fill="none" stroke="#e2648c" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M60 ${y} c1.3 3.2 4.6 3.2 6.2 0.6" fill="none" stroke="#e2648c" stroke-width="2.2" stroke-linecap="round"/>`;
}

function extras(mood) {
  switch (mood) {
    case 'cheer':
      return `
        <text x="8" y="26" font-size="16">✨</text>
        <text x="96" y="22" font-size="14">✨</text>
        <text x="52" y="12" font-size="13">💖</text>`;
    case 'happy':
      return `<text x="94" y="30" font-size="15">💕</text>`;
    case 'think':
      return `<text x="94" y="24" font-size="17">💭</text>`;
    case 'sad':
      return `<text x="94" y="28" font-size="14">🥺</text>`;
    default:
      return '';
  }
}

/**
 * 生成吉祥物 SVG
 * @param {{mood?:string, width?:number, className?:string}} opts
 */
export function mascotSvg({ mood = 'idle', width = 108, className = '' } = {}) {
  return `
<svg class="mascot ${className}" data-mood="${mood}" viewBox="0 0 120 132" width="${width}" height="${(width / 120) * 132}" role="img" aria-label="小米团">
  <defs>
    <radialGradient id="furGrad" cx="45%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="${FUR}"/>
      <stop offset="100%" stop-color="${FUR_DARK}"/>
    </radialGradient>
  </defs>

  <!-- 尾巴 -->
  <path class="mascot__tail" d="M84 102 q26 -2 24 -26 q-1 -12 -11 -13 q-8 -1 -9 7 q-1 7 7 7"
        fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round" opacity="0.95"/>
  <path class="mascot__tail" d="M84 102 q26 -2 24 -26 q-1 -12 -11 -13"
        fill="none" stroke="${FUR}" stroke-width="5" stroke-linecap="round" opacity="0.75"/>

  <g class="mascot__body-group">
    <!-- 身体 -->
    <ellipse cx="60" cy="101" rx="27" ry="23" fill="url(#furGrad)" stroke="${INK}" stroke-width="2.4"/>
    <!-- 小脚丫 -->
    <ellipse cx="47" cy="120" rx="9.5" ry="6" fill="${FUR}" stroke="${INK}" stroke-width="2.2"/>
    <ellipse cx="73" cy="120" rx="9.5" ry="6" fill="${FUR}" stroke="${INK}" stroke-width="2.2"/>
    <ellipse cx="47" cy="120" rx="3.6" ry="2.4" fill="${BLUSH}" opacity="0.85"/>
    <ellipse cx="73" cy="120" rx="3.6" ry="2.4" fill="${BLUSH}" opacity="0.85"/>

    <!-- 耳朵 -->
    <path class="mascot__ear-l" d="M35 40 L27 8 Q26 3 31.5 5.5 L58 24 Z" fill="${FUR}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M38.5 34 L33 15 L53 26 Z" fill="${BLUSH}" opacity="0.8"/>
    <path class="mascot__ear-r" d="M85 40 L93 8 Q94 3 88.5 5.5 L62 24 Z" fill="${FUR}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M81.5 34 L87 15 L67 26 Z" fill="${BLUSH}" opacity="0.8"/>

    <!-- 头 -->
    <circle cx="60" cy="58" r="31" fill="url(#furGrad)" stroke="${INK}" stroke-width="2.4"/>

    <!-- 腮红 -->
    <ellipse class="mascot__blush" cx="37" cy="68" rx="7.2" ry="4.4" fill="${BLUSH}"/>
    <ellipse class="mascot__blush" cx="83" cy="68" rx="7.2" ry="4.4" fill="${BLUSH}"/>

    <!-- 胡须 -->
    <g stroke="${INK}" stroke-width="1.7" stroke-linecap="round" opacity="0.55">
      <path d="M28 60 L14 55"/>
      <path d="M28 65 L13 65"/>
      <path d="M92 60 L106 55"/>
      <path d="M92 65 L107 65"/>
    </g>

    ${eyes(mood)}

    <!-- 鼻子 -->
    <path d="M56.6 62.2 h6.8 l-3.4 3 z" fill="#e2648c"/>
    ${mouth(mood)}

    ${extras(mood)}
  </g>
</svg>`;
}

/** 按减脂进度给吉祥物挑表情 */
export function moodFor(state) {
  const { goalProgress, trend7, streak, latestKg } = state || {};
  if (latestKg == null) return 'idle';
  if (goalProgress != null && goalProgress >= 100) return 'cheer';
  if (trend7 != null && trend7 <= -0.3) return 'happy';
  if (trend7 != null && trend7 >= 0.5) return 'sad';
  if (streak >= 7) return 'happy';
  return 'idle';
}
