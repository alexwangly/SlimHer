/* 极简 hash 路由 */

let handler = null;
export const setRouter = (fn) => {
  handler = fn;
};

/**
 * 所有页面。nav:false 的不进底部导航（我的、周报都是二级页面）。
 */
export const ROUTES = [
  { key: 'home', icon: '🏠', label: '首页' },
  { key: 'weight', icon: '⚖️', label: '体重' },
  { key: 'food', icon: '🍚', label: '饮食' },
  { key: 'decide', icon: '🎲', label: '吃啥' },
  { key: 'checkin', icon: '📅', label: '打卡' },
  { key: 'me', icon: '🐱', label: '我的', nav: false },
  { key: 'report', icon: '📊', label: '周报', nav: false },
];

/** 底部导航用这几项 */
export const NAV_ROUTES = ROUTES.filter((r) => r.nav !== false);

export function routeMeta(key) {
  return ROUTES.find((r) => r.key === key) || ROUTES[0];
}

export function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES.some((r) => r.key === h) ? h : 'home';
}

export function go(route, params) {
  if (currentRoute() === route && !params) {
    // 已经在这一页就重新渲染一次，当作刷新
    handler && handler(route, {});
    return;
  }
  const q = params ? '?' + new URLSearchParams(params).toString() : '';
  location.hash = `#/${route}${q}`;
}

export function routeParams() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}
