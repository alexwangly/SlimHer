import { html, raw, esc, fmtKg, fmt, AVATARS, qs } from '../utils.js';
import { state, profile, cacheGet, cacheSet } from '../state.js';
import { api } from '../api.js';
import { toastOk, toastErr, withLoading, celebrate, confirmDialog, openSheet } from '../ui.js';

export async function render(root, ctx) {
  const p = profile();
  const st = state.stats || {};
  const cfgRes = await api.getConfig().catch(() => ({ config: null }));
  const ai = cfgRes.config?.ai || { enabled: false, baseUrl: '', apiKey: '', model: '', temperature: 0.6, timeoutMs: 45000 };
  const auth = cfgRes.config?.auth || { enabled: false, hasPassword: false };
  // 成就列表：拉不到就退化成没墙，不要整页报错
  const ach = await api.achievements().catch(() => null);

  root.innerHTML = html`
    <div class="view">
      <!-- 档案 -->
      <div class="card card--hero">
        <div class="card__title">🐱 我的档案</div>

        <div class="field">
          <label class="field__label">选一个代表你的小头像</label>
          <div class="chips" data-avatar>
            ${raw(
              AVATARS.map(
                (a) =>
                  `<button class="chip ${a === p.avatar ? 'is-on' : ''}" data-a="${a}" style="font-size:18px;padding:6px 11px">${a}</button>`,
              ).join(''),
            )}
          </div>
        </div>

        <div class="field">
          <label class="field__label">昵称</label>
          <input class="input" data-nick value="${esc(p.nickname || '小米')}" maxlength="12" />
        </div>

        <div class="row" style="gap:10px">
          <div class="field grow">
            <label class="field__label">身高 (cm)</label>
            <input class="input" data-height type="number" inputmode="decimal" value="${p.height ?? ''}" placeholder="160" />
          </div>
          <div class="field grow">
            <label class="field__label">起始体重 (kg)</label>
            <input class="input" data-start type="number" inputmode="decimal" value="${p.startWeight ?? ''}" placeholder="60" />
          </div>
          <div class="field grow">
            <label class="field__label">目标体重 (kg)</label>
            <input class="input" data-target type="number" inputmode="decimal" value="${p.targetWeight ?? ''}" placeholder="50" />
          </div>
        </div>

        <div class="field">
          <label class="field__label">座右铭</label>
          <input class="input" data-motto value="${esc(p.motto || '')}" maxlength="30" placeholder="今天也要开开心心地瘦一点点～" />
        </div>

        <button class="btn btn--primary btn--block" data-save-profile>💾 保存档案</button>
      </div>

      <!-- 成就 -->
      <div class="card">
        <div class="card__title">
          🏆 我的成就
          <span class="hint">${ach ? `${ach.unlockedCount}/${ach.total}` : ''} 已减 ${fmtKg(st.totalLost ?? 0)}kg</span>
        </div>
        <div class="stat-grid">
          <div class="stat">
            <div class="stat__value">${st.recordCount || 0}<small>笔</small></div>
            <div class="stat__label">体重记录</div>
          </div>
          <div class="stat">
            <div class="stat__value">${st.recordedDays || 0}<small>天</small></div>
            <div class="stat__label">坚持天数</div>
          </div>
          <div class="stat">
            <div class="stat__value">${st.streak || 0}<small>天</small></div>
            <div class="stat__label">当前连续</div>
          </div>
        </div>

        ${ach
          ? raw(html`
              <div class="row row--between mt-16">
                <span class="tiny muted">勋章墙</span>
                <span class="tiny muted">点一个看怎么解锁</span>
              </div>
              ${raw(
                ['起步', '坚持', '里程碑']
                  .map((group) => {
                    const list = ach.all.filter((a) => a.group === group);
                    if (!list.length) return '';
                    return html`
                      <div class="tiny muted mt-12" style="font-weight:800">${group}</div>
                      <div class="badge-grid mt-8">
                        ${raw(
                          list
                            .map(
                              (a) => html`
                                <button
                                  class="badge${a.unlocked ? ' is-on' : ''}"
                                  data-badge="${a.key}"
                                  title="${a.name}"
                                >
                                  <span class="badge__emoji">${a.emoji}</span>
                                  <span class="badge__name">${a.name}</span>
                                  ${a.progress && !a.unlocked
                                    ? raw(html`
                                        <span class="badge__progress">
                                          <i
                                            style="width:${Math.min(100, (a.progress.current / a.progress.target) * 100).toFixed(0)}%"
                                          ></i>
                                        </span>
                                      `)
                                    : ''}
                                </button>
                              `,
                            )
                            .join(''),
                        )}
                      </div>
                    `;
                  })
                  .join(''),
              )}
            `)
          : raw(html`<div class="tiny muted mt-16">成就加载中…</div>`)}
      </div>

      <!-- 周报入口 -->
      <div class="card">
        <div class="card__title">📊 周报 / 月报</div>
        <div class="tiny muted" style="line-height:1.75">
          把一段时间的体重、饮食和打卡汇成一张成绩单，还能让 AI 写一段具体到数字的小结。
        </div>
        <button class="btn btn--ghost btn--block mt-12" data-go-report>看看这一周 📈</button>
      </div>

      <!-- AI -->
      <div class="card">
        <div class="card__title">🤖 AI 小助手</div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">打开 AI 功能</div>
            <div class="setting-row__desc">关掉之后所有 AI 按钮都会变成灰灰的</div>
          </div>
          <label class="switch">
            <input type="checkbox" data-ai-enabled ${ai.enabled ? 'checked' : ''} />
            <span class="switch__track"></span>
          </label>
        </div>

        <div class="field mt-12">
          <label class="field__label">网关地址</label>
          <input class="input" data-ai-url value="${esc(ai.baseUrl || '')}" placeholder="http://127.0.0.1:8000 或 https://api.deepseek.com" />
          <div class="tiny muted mt-8">
            只有服务器能访问这个地址也没关系 —— 请求由后端代理发出。可以只填到域名，会自动补 /v1/chat/completions
          </div>
        </div>

        <div class="field">
          <label class="field__label">API Key</label>
          <input class="input" data-ai-key type="password" value="${esc(ai.apiKey || '')}" placeholder="sk-..." autocomplete="off" />
          <div class="tiny muted mt-8">密钥只保存在服务器的 data/config.json 里，不会发给浏览器</div>
        </div>

        <div class="row" style="gap:10px">
          <div class="field grow">
            <label class="field__label">模型名</label>
            <input class="input" data-ai-model value="${esc(ai.model || '')}" placeholder="deepseek-chat" />
          </div>
          <div class="field" style="width:110px">
            <label class="field__label">温度</label>
            <input class="input" data-ai-temp type="number" step="0.1" min="0" max="2" value="${ai.temperature ?? 0.6}" />
          </div>
        </div>

        <div class="row" style="gap:10px">
          <button class="btn btn--primary grow" data-save-ai>💾 保存 AI 设置</button>
          <button class="btn btn--plain" data-test-ai>🧪 测试</button>
        </div>
        <div data-ai-result class="mt-12"></div>
      </div>

      <!-- 口令 -->
      <div class="card">
        <div class="card__title">🔒 访问口令</div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">打开口令保护</div>
            <div class="setting-row__desc">放到公网服务器上时建议打开，防止别人看到你的日记</div>
          </div>
          <label class="switch">
            <input type="checkbox" data-auth-enabled ${auth.enabled ? 'checked' : ''} />
            <span class="switch__track"></span>
          </label>
        </div>
        <div class="row mt-12" style="gap:10px">
          <input class="input grow" data-auth-pass type="password" placeholder="${auth.hasPassword ? '已设置，留空则不修改' : '设置一个口令'}" autocomplete="new-password" />
          <button class="btn btn--primary" data-save-auth>保存</button>
        </div>
      </div>

      <!-- 数据 -->
      <div class="card">
        <div class="card__title">💾 数据</div>
        <div class="row" style="gap:10px">
          <button class="btn btn--plain grow" data-export>⬇️ 导出备份</button>
          <button class="btn btn--plain grow" data-import>⬆️ 导入备份</button>
        </div>
        <div class="row" style="gap:10px;margin-top:10px">
          <button class="btn btn--ghost grow" data-demo>🎁 灌入示例数据</button>
          <button class="btn btn--ghost grow" data-clear>🧹 清空所有记录</button>
        </div>
        <input type="file" accept="application/json,.json" data-file class="hidden" />
        <div class="tiny muted mt-12">
          数据存在服务器的 <code>data/db.json</code>，每天第一次改动前会自动备份到 <code>data/backups/</code>（保留 30 天）。
          想正式开始记录之前，点「清空所有记录」就变回一张白纸啦（食物库会留着）。
        </div>
      </div>

      <div class="center tiny muted" style="padding:16px 0 4px">
        小米减肥日记 · 慢慢来，比较快 🌷
      </div>
    </div>
  `;

  let avatar = p.avatar || '🐱';

  /* ---- 头像 ---- */
  qs('[data-avatar]', root).onclick = (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    avatar = b.dataset.a;
    qs('[data-avatar]', root).querySelectorAll('[data-a]').forEach((x) => x.classList.toggle('is-on', x === b));
  };

  /* ---- 保存档案 ---- */
  qs('[data-save-profile]', root).onclick = async (e) => {
    const restore = withLoading(e.currentTarget, '保存');
    try {
      const num = (sel) => {
        const v = qs(sel, root).value.trim();
        return v === '' ? null : Number(v);
      };
      await api.updateProfile({
        avatar,
        nickname: qs('[data-nick]', root).value.trim() || '小米',
        height: num('[data-height]'),
        startWeight: num('[data-start]'),
        targetWeight: num('[data-target]'),
        motto: qs('[data-motto]', root).value.trim(),
      });
      await ctx.refresh();
      toastOk('档案保存好啦～');
    } catch (err) {
      toastErr(err.message);
    } finally {
      restore();
    }
  };

  /* ---- AI ---- */
  qs('[data-save-ai]', root).onclick = async (e) => {
    const restore = withLoading(e.currentTarget, '保存');
    try {
      await api.saveConfig({
        ai: {
          enabled: qs('[data-ai-enabled]', root).checked,
          baseUrl: qs('[data-ai-url]', root).value.trim(),
          apiKey: qs('[data-ai-key]', root).value.trim(),
          model: qs('[data-ai-model]', root).value.trim(),
          temperature: Number(qs('[data-ai-temp]', root).value) || 0.6,
        },
      });
      await ctx.refresh();
      toastOk('AI 设置存好啦～');
    } catch (err) {
      toastErr(err.message);
    } finally {
      restore();
    }
  };

  qs('[data-test-ai]', root).onclick = async (e) => {
    const box = qs('[data-ai-result]', root);
    const btn = e.currentTarget;
    const restore = withLoading(btn, '测试中');
    box.innerHTML = html`<div class="thinking"><div class="spinner spinner--pink"></div><span>正在呼叫网关…</span></div>`;
    try {
      const res = await api.testConfig();
      box.innerHTML = html`
        <div class="pick-card">
          <div class="pick-card__name">✅ 网关通了！</div>
          <div class="pick-card__reason">模型：${res.model || '未知'}</div>
          <div class="pick-card__tip">它回了：${(res.raw || '').slice(0, 80)}</div>
        </div>
      `;
      burstFromSafe(btn, ['🎉', '✨']);
    } catch (err) {
      box.innerHTML = html`
        <div class="pick-card" style="background:linear-gradient(135deg,#ffe9ec,#fff);border-color:var(--danger)">
          <div class="pick-card__name">😣 没通</div>
          <div class="pick-card__reason">${err.message}</div>
        </div>
      `;
      toastErr('测试失败，看看下面的原因');
    } finally {
      restore();
    }
  };

  /* ---- 口令 ---- */
  qs('[data-save-auth]', root).onclick = async (e) => {
    const restore = withLoading(e.currentTarget, '保存');
    try {
      const pass = qs('[data-auth-pass]', root).value;
      const enabled = qs('[data-auth-enabled]', root).checked;
      if (enabled && !pass && !auth.hasPassword) {
        toastErr('打开口令保护就得设一个口令哦～');
        return;
      }
      const payload = { auth: { enabled } };
      if (pass) payload.auth.password = pass;
      await api.saveConfig(payload);
      await ctx.refresh();
      toastOk(enabled ? '口令保护打开啦，下次访问要输口令' : '口令保护已关闭');
    } catch (err) {
      toastErr(err.message);
    } finally {
      restore();
    }
  };

  /* ---- 勋章墙 ---- */
  root.querySelectorAll('[data-badge]').forEach((b) => {
    b.onclick = () => {
      const a = (ach?.all || []).find((x) => x.key === b.dataset.badge);
      if (!a) return;
      const pctText = a.progress
        ? `${a.progress.current} / ${a.progress.target}`
        : a.unlocked
          ? '已达成'
          : '继续加油';
      openSheet({
        title: a.name,
        emoji: a.emoji,
        content: html`
          <div class="center">
            <div
              class="badge__emoji"
              style="font-size:56px;${a.unlocked ? '' : 'filter:grayscale(1);opacity:.35'}"
            >
              ${a.emoji}
            </div>
            <div class="bold mt-12" style="font-size:16px">${a.name}</div>
            <div class="tiny muted mt-8">${a.desc}</div>
            <div class="badge__progress mt-16">
              <i style="width:${a.progress ? Math.min(100, (a.progress.current / a.progress.target) * 100).toFixed(0) : a.unlocked ? 100 : 0}%"></i>
            </div>
            <div class="tiny muted mt-8">${pctText}</div>
            ${a.at
              ? raw(html`<div class="tiny muted mt-8">解锁于 ${new Date(a.at).toLocaleDateString('zh-CN')}</div>`)
              : ''}
            ${!a.unlocked && a.progress
              ? raw(html`<div class="bloat-tip mt-16"><span class="bloat-tip__emoji">💪</span><span>还差 <b>${fmt(a.progress.target - a.progress.current, a.progress.target % 1 ? 1 : 0)}</b> 就解锁啦</span></div>`)
              : ''}
          </div>
        `,
      });
    };
  });

  /* ---- 周报入口 ---- */
  const reportBtn = qs('[data-go-report]', root);
  if (reportBtn) {
    reportBtn.onclick = () => import('../router.js').then(({ go }) => go('report'));
  }

  /* ---- 示例 / 清空 ---- */
  qs('[data-demo]', root).onclick = async (e) => {
    const okGo = await confirmDialog({
      title: '灌入示例数据？',
      desc: '会覆盖现在的体重和饮食记录（食物库保留）',
      okText: '好呀',
    });
    if (!okGo) return;
    const restore = withLoading(e.currentTarget, '生成中');
    try {
      await api.reset('demo');
      await ctx.refresh();
      toastOk('示例数据准备好啦，随便玩～');
    } catch (err) {
      toastErr(err.message);
    } finally {
      restore();
    }
  };

  qs('[data-clear]', root).onclick = async (e) => {
    const okGo = await confirmDialog({
      title: '清空所有记录？',
      desc: '体重、饮食、打卡都会删掉，建议先导出一份备份',
      okText: '清空',
      danger: true,
    });
    if (!okGo) return;
    const second = await confirmDialog({
      title: '真的确定吗？',
      desc: '这一步没法撤销哦',
      okText: '确定清空',
      danger: true,
    });
    if (!second) return;
    const restore = withLoading(e.currentTarget, '清理中');
    try {
      await api.reset('empty');
      await ctx.refresh();
      toastOk('清空啦，可以从今天重新开始～');
    } catch (err) {
      toastErr(err.message);
    } finally {
      restore();
    }
  };

  /* ---- 数据 ---- */
  qs('[data-export]', root).onclick = () => {
    const a = document.createElement('a');
    a.href = api.exportUrl();
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toastOk('开始下载备份啦～');
  };

  const file = qs('[data-file]', root);
  qs('[data-import]', root).onclick = () => file.click();

  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.weights)) throw new Error('这份文件里没有体重记录，可能不是小米日记的备份');

      const mode = await askImportMode(data);
      if (!mode) return;

      await api.importData({ ...data, __opts: { mode } });
      await ctx.refresh();
      const st2 = state.stats || {};
      await celebrate({
        emoji: '📦',
        title: '导入完成！',
        desc: `现在一共有 ${st2.recordCount} 笔体重记录、${state.db.meals.length} 条饮食记录`,
        button: '好耶',
      });
    } catch (err) {
      toastErr('这个文件读不了：' + err.message);
    } finally {
      file.value = '';
    }
  };
}

/** 问一下是合并还是整个覆盖 */
function askImportMode(data) {
  const counts = `这份备份有 ${data.weights?.length || 0} 笔体重、${data.meals?.length || 0} 条饮食`;
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const { close } = openModal({
      content: html`
        <div style="font-size:36px;line-height:1">📦</div>
        <div style="font-size:17px;font-weight:800;margin-top:8px">怎么导入？</div>
        <div class="soft tiny mt-8">${counts}</div>
        <div class="tiny muted mt-12" style="text-align:left;line-height:1.7">
          <b>合并</b>：保留现在已有的记录，只把备份里没有的加进来（推荐）<br />
          <b>覆盖</b>：用备份完全替换现在服务器上的数据
        </div>
        <div class="sheet__actions" style="margin-top:16px">
          <button class="btn btn--plain" data-x="cancel">取消</button>
          <button class="btn btn--ghost" data-x="merge">合并</button>
          <button class="btn btn--primary" data-x="replace">覆盖</button>
        </div>
      `,
      onMount(box, closeFn) {
        qs('[data-x="cancel"]', box).onclick = () => {
          closeFn();
          done(null);
        };
        qs('[data-x="merge"]', box).onclick = () => {
          closeFn();
          done('merge');
        };
        qs('[data-x="replace"]', box).onclick = () => {
          closeFn();
          done('replace');
        };
      },
    });
    // 点遮罩关掉时按取消算
    setTimeout(() => {
      const check = setInterval(() => {
        if (!document.querySelector('.modal')) {
          clearInterval(check);
          if (!settled) done(null);
        }
      }, 200);
      setTimeout(() => clearInterval(check), 120000);
    }, 300);
    void close;
  });
}

function burstFromSafe(el, emojis) {
  try {
    const r = el.getBoundingClientRect();
    import('../ui.js').then((m) => m.emojiBurst(r.left + r.width / 2, r.top, emojis, 10));
  } catch {}
}
