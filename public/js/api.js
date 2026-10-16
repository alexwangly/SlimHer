/* 后端 API 封装 —— 所有请求都带 cookie，401 时自动喊登录 */

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

export class ApiError extends Error {
  constructor(message, status, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch (err) {
    throw new ApiError('连不上服务器，检查一下后端有没有在跑～', 0);
  }

  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(`服务器返回了看不懂的内容（${res.status}）`, res.status);
    }
  }

  if (!res.ok || data.ok === false) {
    if (res.status === 401 && onUnauthorized) onUnauthorized(data);
    throw new ApiError(data.error || `请求失败（${res.status}）`, res.status, data);
  }
  return data;
}

const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b ?? {});
const patch = (p, b) => request('PATCH', p, b ?? {});
const put = (p, b) => request('PUT', p, b ?? {});
const del = (p) => request('DELETE', p);

export const api = {
  bootstrap: () => get('/api/bootstrap'),
  login: (password) => post('/api/login', { password }),
  logout: () => post('/api/logout'),

  updateProfile: (patchBody) => patch('/api/profile', patchBody),

  addWeight: (payload) => post('/api/weights', payload),
  updateWeight: (id, payload) => patch(`/api/weights/${id}`, payload),
  removeWeight: (id) => del(`/api/weights/${id}`),

  addMeal: (payload) => post('/api/meals', payload),
  updateMeal: (id, payload) => patch(`/api/meals/${id}`, payload),
  removeMeal: (id) => del(`/api/meals/${id}`),
  analyzeMeal: (id) => post(`/api/meals/${id}/analyze`),
  analyzeDay: (date) => post('/api/analyze/day', { date }),

  addFood: (payload) => post('/api/foods', payload),
  updateFood: (id, payload) => patch(`/api/foods/${id}`, payload),
  removeFood: (id) => del(`/api/foods/${id}`),

  saveCheckin: (date, payload) => put(`/api/checkins/${date}`, payload),
  checkins: (month) => get(`/api/checkins${month ? `?month=${encodeURIComponent(month)}` : ''}`),

  addPeriod: (payload) => post('/api/periods', payload),
  updatePeriod: (id, payload) => patch(`/api/periods/${id}`, payload),
  deletePeriod: (id) => del(`/api/periods/${id}`),

  achievements: () => get('/api/achievements'),
  achievementsSeen: (keys) => post('/api/achievements/seen', { keys }),

  report: (period = 'week', offset = 0) =>
    get(`/api/report?period=${encodeURIComponent(period)}&offset=${offset}`),
  reportSummary: (period = 'week', offset = 0) => post('/api/report/summary', { period, offset }),

  stats: (range = 30) => get(`/api/stats?range=${encodeURIComponent(range)}`),

  decide: (payload) => post('/api/decide', payload),
  dailyTip: () => post('/api/daily-tip'),

  getConfig: () => get('/api/config'),
  saveConfig: (payload) => put('/api/config', payload),
  testConfig: () => post('/api/config/test'),
  aiChat: (messages, json = false) => post('/api/ai/chat', { messages, json }),

  exportUrl: () => '/api/export',
  importData: (payload) => post('/api/import', payload),
  reset: (mode) => post('/api/reset', { mode }),
};
