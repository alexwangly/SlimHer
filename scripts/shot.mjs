/**
 * 用 Chrome DevTools Protocol 按真实手机视口截图。
 *
 * 为什么不用 `chrome --screenshot --window-size=390,...`：
 * headless Chrome 会把布局宽度卡在 512px，再把截图裁到 390px 宽——
 * 结果是"看起来是 390，实际按 512 排版、右边被切掉"，
 * 而这是个手机优先的站，正好验证不到最该验证的那档宽度。
 * 走 CDP 的 Emulation.setDeviceMetricsOverride 才是真的按 390 排版。
 *
 * 用法：
 *   node scripts/shot.mjs                      # 截全部页面到 docs/screenshots/
 *   node scripts/shot.mjs --w 390 --h 844       # 换视口
 *   node scripts/shot.mjs --only checkin,report # 只截几页
 *   node scripts/shot.mjs --out .tmp/shots      # 换输出目录
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ---------------- 参数 ---------------- */

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const BASE = process.env.BASE || 'http://127.0.0.1:8087';
const WIDTH = Number(arg('w', 390));
const HEIGHT = Number(arg('h', 844));
const OUT = arg('out', 'docs/screenshots');
const PORT = Number(arg('port', 9333));
const DPR = Number(arg('dpr', 2));
// 页面太长时截断，免得单张图几十 MB
const MAX_H = Number(arg('maxh', 4200));
// 截之前先点一下某个元素（比如周报的"让 AI 写一份成绩单"）
const CLICK = arg('click', '');
// 点完之后等这个选择器出现，再截图
const WAIT_FOR = arg('waitfor', '');
const WAIT_MS = Number(arg('wait', 12000));

const ALL = ['home', 'weight', 'food', 'decide', 'checkin', 'report', 'me'];
const PAGES = arg('only', '')
  ? arg('only', '').split(',').map((s) => s.trim()).filter(Boolean)
  : ALL;

/* ---------------- 找 Chrome ---------------- */

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chromePath = CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('找不到 Chrome，可以用 CHROME_PATH 环境变量指定');
  process.exit(1);
}

/* ---------------- 启一个带调试端口的 Chrome ---------------- */

const profile = join(tmpdir(), `mi-shot-${Date.now()}`);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--no-first-run',
    '--hide-scrollbars',
    // 页面里的入场动画全部走"直接给终态"，免得截到一半
    '--force-prefers-reduced-motion',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等调试端口起来 */
async function waitForDevtools(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(150);
  }
  throw new Error('Chrome 调试端口没起来');
}

/* ---------------- 极简 CDP 客户端 ---------------- */

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
        else res(msg.result);
      }
    });
    ws.addEventListener('error', () => reject(new Error('CDP 连接出错')));
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          const myId = ++id;
          return new Promise((res, rej) => {
            pending.set(myId, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id: myId, method, params }));
            setTimeout(() => {
              if (pending.has(myId)) {
                pending.delete(myId);
                rej(new Error(`${method} 超时`));
              }
            }, 30000);
          });
        },
        close: () => ws.close(),
      }),
    );
  });
}

/* ---------------- 主流程 ---------------- */

await mkdir(OUT, { recursive: true });
await waitForDevtools();

const results = [];

for (const name of PAGES) {
  // 每个页面开一个独立 target，互不干扰
  const targetRes = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  const target = await targetRes.json();
  const cdp = await connect(target.webSocketDebuggerUrl);

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // 关键的一步：真的按手机视口排版
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: DPR,
      mobile: true,
    });

    await cdp.send('Page.navigate', { url: `${BASE}/#/${name}` });

    // 等应用启动 + 数据回来；轮询到页面真的有内容为止
    const t0 = Date.now();
    let contentH = HEIGHT;
    for (;;) {
      await sleep(250);
      const m = await cdp.send('Page.getLayoutMetrics').catch(() => null);
      contentH = Math.ceil(m?.cssContentSize?.height || HEIGHT);
      const ok = await cdp
        .send('Runtime.evaluate', {
          expression:
            "!!document.querySelector('#view .card, #view .view') && document.querySelectorAll('.card').length > 0",
          returnByValue: true,
        })
        .then((r) => r?.result?.value)
        .catch(() => false);
      if (ok && contentH > 200) break;
      if (Date.now() - t0 > 12000) break;
    }

    // 再多等一会儿，让数字滚动/图表收尾
    await sleep(700);

    // 可选：先点一下某个按钮，再等结果出来（比如触发 AI 总结）
    if (CLICK) {
      const clicked = await cdp
        .send('Runtime.evaluate', {
          expression: `(() => { const el = document.querySelector(${JSON.stringify(CLICK)});
            if (!el) return 'no-element'; el.click(); return 'clicked'; })()`,
          returnByValue: true,
        })
        .then((r) => r?.result?.value)
        .catch((e) => 'error: ' + e.message);
      console.log(`     ↳ click ${CLICK} → ${clicked}`);
      if (clicked === 'clicked') {
        if (WAIT_FOR) {
          const t1 = Date.now();
          for (;;) {
            await sleep(300);
            const ok = await cdp
              .send('Runtime.evaluate', {
                expression: `!!document.querySelector(${JSON.stringify(WAIT_FOR)})`,
                returnByValue: true,
              })
              .then((r) => r?.result?.value)
              .catch(() => false);
            if (ok || Date.now() - t1 > WAIT_MS) break;
          }
          const appeared = await cdp
            .send('Runtime.evaluate', {
              expression: `!!document.querySelector(${JSON.stringify(WAIT_FOR)})`,
              returnByValue: true,
            })
            .then((r) => r?.result?.value)
            .catch(() => false);
          console.log(`     ↳ wait ${WAIT_FOR} → ${appeared ? '出现了' : '超时没出现'}`);
        } else {
          await sleep(WAIT_MS);
        }
      }
    }

    const m = await cdp.send('Page.getLayoutMetrics');
    contentH = Math.min(MAX_H, Math.ceil(m.cssContentSize.height || HEIGHT));
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: contentH,
      deviceScaleFactor: DPR,
      mobile: true,
    });
    await sleep(700); // 视口变了，图表会重画一次

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const file = join(OUT, `${name}.png`);
    await writeFile(file, Buffer.from(shot.data, 'base64'));

    const kb = Math.round(Buffer.from(shot.data, 'base64').length / 1024);
    results.push({ name, w: WIDTH, h: contentH, kb });
    console.log(`  ✅ ${name.padEnd(8)} ${WIDTH}x${contentH}  ${kb} KB`);
  } catch (err) {
    results.push({ name, error: err.message });
    console.log(`  ❌ ${name.padEnd(8)} ${err.message}`);
  } finally {
    cdp.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
  }
}

chrome.kill();
await rm(profile, { recursive: true, force: true }).catch(() => {});

const bad = results.filter((r) => r.error).length;
console.log(bad ? `\n${bad} 个页面没截成` : `\n全部截好，放在 ${OUT}/`);
process.exit(bad ? 1 : 0);
