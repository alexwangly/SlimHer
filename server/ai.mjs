import { getConfig } from './store.mjs';

/**
 * 记录"这个网关不认 thinking 参数"，键是 `接口地址|模型名`。
 * 只有在真的撞到 400 之后才会被填上，所以不会误伤正常的网关。
 */
let thinkingRejectedFor = '';

/** 从模型回复里抠出 JSON —— 很多国产模型爱裹 ```json 代码块或者在前面废话两句 */
export function extractJson(text) {
  if (!text) throw gatewayError('AI 返回了空内容', 502);
  const cleaned = String(text).trim();

  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  let v = tryParse(cleaned);
  if (v !== undefined) return v;

  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    v = tryParse(fenced[1].trim());
    if (v !== undefined) return v;
  }

  const start = cleaned.search(/[[{]/);
  if (start >= 0) {
    const open = cleaned[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          v = tryParse(cleaned.slice(start, i + 1));
          if (v !== undefined) return v;
          break;
        }
      }
    }
  }
  throw gatewayError('AI 没有返回可解析的 JSON。原始回复：' + cleaned.slice(0, 300), 502);
}

export async function aiStatus() {
  const cfg = await getConfig();
  return {
    enabled: !!cfg.ai.enabled,
    configured: !!(cfg.ai.baseUrl && cfg.ai.apiKey && cfg.ai.model),
    model: cfg.ai.model || '',
    baseUrl: cfg.ai.baseUrl || '',
  };
}

function normalizeBase(baseUrl) {
  const b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) throw configError('还没有配置 AI 网关地址，去「我的 → AI 小助手」里填一下吧～');
  // 允许用户只填到域名，也允许直接填到 /v1/chat/completions
  if (/\/chat\/completions$/.test(b)) return b;
  if (/\/v\d+$/.test(b)) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

/** 配置没填好：这是用户能自己修的问题，用 400 而不是 500 */
function configError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** 网关那边出问题（连不上 / 超时 / 返回垃圾），用 502 / 504 */
function gatewayError(message, status = 502) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * 调用 OpenAI 兼容网关。网关只有服务器能访问，所以走这里代理。
 * @param {{messages:Array, json?:boolean, temperature?:number, maxTokens?:number}} opts
 */
export async function chat(opts) {
  const cfg = await getConfig();
  const ai = cfg.ai;

  if (!ai.enabled) throw configError('AI 功能还没打开，去「我的 → AI 小助手」里打开吧～');
  if (!ai.baseUrl) throw configError('还没有填 AI 网关地址，去「我的 → AI 小助手」里填一下');
  if (!ai.apiKey) throw configError('还没有填 API Key，去「我的 → AI 小助手」里填一下');
  if (!ai.model) throw configError('还没有填模型名，去「我的 → AI 小助手」里填一下');

  const url = normalizeBase(ai.baseUrl);

  /**
   * @param {boolean} noThinking 要不要带"别思考"的参数
   *
   * 推理模型（deepseek-v4-flash / reasoner 这类）每次都会先输出一段思考，
   * 思考既占 token 也占时间。实测同一份周报数据、同一个提示词，关掉思考
   * 平均从 4736ms 降到 2532ms，而引用数字的准确度和结论都没变，所以默认关掉。
   */
  const buildBody = (noThinking) => {
    const body = {
      model: ai.model,
      messages: opts.messages,
      temperature: opts.temperature ?? ai.temperature ?? 0.6,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) body.response_format = { type: 'json_object' };
    if (noThinking) body.thinking = { type: 'disabled' };
    return body;
  };

  const send = async (noThinking) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ai.timeoutMs || 45000);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ai.apiKey}`,
          ...(ai.extraHeaders && typeof ai.extraHeaders === 'object' ? ai.extraHeaders : {}),
        },
        body: JSON.stringify(buildBody(noThinking)),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw gatewayError('AI 网关超时了，等一下再试试～', 504);
      throw gatewayError(`连不上 AI 网关（${url}）：${err.message}`, 502);
    } finally {
      clearTimeout(timer);
    }
  };

  const key = `${url}|${ai.model}`;
  const wantNoThinking = ai.disableThinking !== false && thinkingRejectedFor !== key;

  let res = await send(wantNoThinking);
  let raw = await res.text();

  // 有的网关不认 thinking 这个字段，会直接 400。
  // 撞一次就记住，之后不再带，免得每次都白跑一趟。
  if (!res.ok && wantNoThinking && res.status === 400) {
    thinkingRejectedFor = key;
    console.warn(`[ai] ${key} 似乎不支持 thinking 参数，已自动去掉并重试`);
    res = await send(false);
    raw = await res.text();
  }

  if (!res.ok) {
    throw gatewayError(`AI 网关返回 ${res.status}：${raw.slice(0, 300)}`, 502);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw gatewayError('AI 网关返回的不是 JSON：' + raw.slice(0, 200), 502);
  }

  const choice = data?.choices?.[0];
  const text = choice?.message?.content ?? choice?.text ?? data?.output?.text ?? '';
  const finishReason = choice?.finish_reason ?? null;
  // 推理模型（deepseek-reasoner 这类）会先输出一段思考，思考也算 token
  const reasoning = choice?.message?.reasoning_content ?? '';

  if (!text) {
    // 这几种情况都表现为"没内容"，但原因完全不同，混在一起报会让人去查错方向
    if (finishReason === 'length') {
      throw gatewayError(
        'AI 才写一半就被截断了——这类模型会先"思考"再回答，而思考也占 token，' +
          'max_tokens 给小了就会全花在思考上。把 max_tokens 调大一点再试试～',
        502,
      );
    }
    if (reasoning) {
      throw gatewayError('AI 只吐了思考过程、没给答案，再点一次或者换一个模型试试～', 502);
    }
    throw gatewayError('AI 网关没有返回内容：' + raw.slice(0, 200), 502);
  }

  return {
    text,
    finishReason,
    truncated: finishReason === 'length',
    usage: data.usage || null,
    model: data.model || ai.model,
  };
}

/**
 * 把一次 AI 回复当 JSON 解析。
 *
 * 单独包一层的原因：截断和"模型乱说"是两回事，但都表现为"解析不出来"。
 * 截断的原始回复看起来就是一段很像样的 JSON 断在半句，很容易被误判成
 * 提示词写得不好，其实是 max_tokens 不够——所以这里要明确说是截断。
 */
function parseReply(result) {
  if (result.truncated) {
    console.warn(
      `[ai] 回复被截断（finish_reason=length, completion=${result.usage?.completion_tokens ?? '?'} tokens），` +
        '这通常是 max_tokens 给小了',
    );
    throw gatewayError('AI 这次话有点多，还没写完就被截断了（一截断 JSON 也就断了）。再点一次通常就好～', 502);
  }
  try {
    return extractJson(result.text);
  } catch (err) {
    if (err.status) throw err;
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* 业务提示词                                                          */
/* ------------------------------------------------------------------ */

const PERSONA = `你是一位温柔、专业、不说教的营养师兼减脂教练，服务对象是一位正在减脂的年轻女生（昵称"小米"）。
说话风格：像贴心的闺蜜，用中文，活泼但专业，多用"～""呀""哦"这类软糯语气词，可以带一点点 emoji，但别刷屏。
原则：不制造身材焦虑，不推荐极端节食，不鼓励断食或催吐；强调"可持续"而不是"快"。
所有热量都是估算值，别假装精确。`;

function profileLine(profile) {
  if (!profile) return '';
  const bits = [];
  if (profile.nickname) bits.push(`昵称 ${profile.nickname}`);
  if (profile.height) bits.push(`身高 ${profile.height}cm`);
  if (profile.targetWeight) bits.push(`目标体重 ${profile.targetWeight}kg`);
  return bits.length ? `\n【小米的档案】${bits.join('，')}` : '';
}

const MEAL_SLOT = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐/零食' };

/** 分析一顿吃了什么 */
export async function analyzeMeal({ meal, profile, recentWeight }) {
  const slot = MEAL_SLOT[meal.slot] || '一餐';
  const weightLine = recentWeight ? `\n【最近体重】${recentWeight} kg` : '';

  const prompt = `请分析小米的这顿${slot}吃得健不健康。

【她吃的内容】${meal.text || '（没写文字，只拍了照片）'}
${meal.photoNote ? `【照片说明】${meal.photoNote}\n` : ''}${profileLine(profile)}${weightLine}

请严格只输出一个 JSON 对象（不要 markdown 代码块，不要多余文字），字段如下：
{
  "score": 0-100 的整数，健康分。60 以下=踩雷，60-79=还行，80-100=很棒,
  "level": "great" | "good" | "meh" | "bad",
  "kcal": 这顿的热量估算整数（kcal）,
  "protein": 蛋白质估算整数（克）,
  "summary": "一句话总结这顿，20 字以内，可爱一点",
  "pros": ["做得好的地方", "最多 3 条，每条 18 字以内"],
  "cons": ["需要注意的地方", "最多 3 条，每条 18 字以内；如果确实没有就返回空数组"],
  "advice": ["下一顿可以怎么调整", "2-3 条，每条 22 字以内，要具体可执行"],
  "swap": { "from": "这顿里最该换掉的那样东西", "to": "换成什么更好吃又不胖的东西" },
  "encourage": "一句给她的鼓励，25 字以内，真诚不油腻"
}`;

  const res = await chat({
    messages: [
      { role: 'system', content: PERSONA },
      { role: 'user', content: prompt },
    ],
    json: true,
    temperature: 0.5,
    // 分析结果字段多，加上推理模型的"思考"开销，留足余量
    maxTokens: 2000,
  });

  const parsed = parseReply(res);
  return normalizeAnalysis(parsed, res.model);
}

const LEVELS = new Set(['great', 'good', 'meh', 'bad']);

function normalizeAnalysis(v, model) {
  const num = (x, d = 0) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.round(n) : d;
  };
  const arr = (x, max = 3) =>
    (Array.isArray(x) ? x : x ? [x] : [])
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, max);

  const score = Math.max(0, Math.min(100, num(v.score, 70)));
  let level = String(v.level || '').toLowerCase();
  if (!LEVELS.has(level)) level = score >= 80 ? 'great' : score >= 60 ? 'good' : score >= 40 ? 'meh' : 'bad';

  return {
    at: new Date().toISOString(),
    model: model || '',
    score,
    level,
    kcal: Math.max(0, num(v.kcal)),
    protein: Math.max(0, num(v.protein)),
    summary: String(v.summary || '').slice(0, 60),
    pros: arr(v.pros),
    cons: arr(v.cons),
    advice: arr(v.advice),
    swap:
      v.swap && typeof v.swap === 'object' && (v.swap.from || v.swap.to)
        ? { from: String(v.swap.from || '').slice(0, 40), to: String(v.swap.to || '').slice(0, 40) }
        : null,
    encourage: String(v.encourage || '').slice(0, 80),
  };
}

const MOOD_LABEL = {
  lazy: '懒得做饭，越简单越好',
  hungry: '饿到不行，想吃扎实的',
  light: '想吃清淡一点的',
  happy: '今天心情好，想吃点开心的',
  sad: '心情不太好，需要被安慰',
  treat: '今天想奖励自己一顿好的',
  cheap: '想省点钱',
  fast: '赶时间，要快',
};

/** 今天吃什么 —— 让 AI 从候选里挑 */
export async function decideMeal({ slot, moods = [], avoid = '', candidates = [], profile, budgetKcal }) {
  const slotName = MEAL_SLOT[slot] || '这一餐';
  const moodText = moods.map((m) => MOOD_LABEL[m] || m).join('；') || '没特别说';
  const list = candidates.map((f) => `${f.name}（约${f.kcal}kcal${f.tag ? '，' + f.tag : ''}）`).join('\n');

  const prompt = `小米在纠结${slotName}吃什么，请你帮她拿主意。

【她的状态】${moodText}
${avoid ? `【不想吃/不能吃】${avoid}\n` : ''}${budgetKcal ? `【这一餐的热量预算】大约 ${budgetKcal} kcal\n` : ''}${profileLine(profile)}
【候选清单】（优先从这里挑）
${list || '（没有候选，你自己想几个家常又容易买到的）'}

请严格只输出一个 JSON 对象（不要 markdown 代码块，不要多余文字）：
{
  "picks": [
    {
      "name": "推荐的食物名",
      "kcal": 热量整数,
      "reason": "为什么推荐给她，20 字以内，贴心一点",
      "tip": "怎么吃更减脂，18 字以内"
    }
  ],
  "combo": "如果想凑成完整一餐，可以这样搭配：…（30 字以内）",
  "avoidToday": "今天最好避开什么，18 字以内",
  "cheer": "一句宠她的话，25 字以内"
}
picks 给 3 个，按推荐度排序。`;

  const res = await chat({
    messages: [
      { role: 'system', content: PERSONA },
      { role: 'user', content: prompt },
    ],
    json: true,
    temperature: 0.85,
    maxTokens: 2000,
  });

  const v = parseReply(res);
  const picks = (Array.isArray(v.picks) ? v.picks : [])
    .slice(0, 4)
    .map((p) => ({
      name: String(p?.name || '').slice(0, 40),
      kcal: Math.max(0, Math.round(Number(p?.kcal) || 0)),
      reason: String(p?.reason || '').slice(0, 60),
      tip: String(p?.tip || '').slice(0, 60),
    }))
    .filter((p) => p.name);

  return {
    at: new Date().toISOString(),
    model: res.model || '',
    picks,
    combo: String(v.combo || '').slice(0, 90),
    avoidToday: String(v.avoidToday || '').slice(0, 60),
    cheer: String(v.cheer || '').slice(0, 80),
  };
}

/** 每天的碎碎念鼓励 */
export async function dailyTip({ profile, stats }) {
  const prompt = `用一句话鼓励正在减脂的小米，可以结合她的数据，别超过 30 字。
【数据】${JSON.stringify(stats)}
${profileLine(profile)}
注意：
- 上面所有体重的单位都是 kg（公斤），换算成斤要乘 2。别把 kg 直接读成"斤"，差一倍她会发现。
- **只能用上面出现过的数字**。不要自己编造体重、进度或日期。
严格只输出 JSON：{"tip": "……", "emoji": "一个最贴切的 emoji"}`;

  const res = await chat({
    messages: [
      { role: 'system', content: PERSONA },
      { role: 'user', content: prompt },
    ],
    json: true,
    temperature: 0.9,
    maxTokens: 1200,
  });
  const v = parseReply(res);
  return { tip: String(v.tip || '').slice(0, 60), emoji: String(v.emoji || '🌸').slice(0, 4) };
}

/** 周报 / 月报总结 */
export async function reportSummary({ payload, profile }) {
  const prompt = `下面是小米一个周期的减脂记录，写一份小小的"成绩单"给她。

【这一期的数据】
${JSON.stringify(payload, null, 1)}

${profileLine(profile)}

要求：
1. headline：一句 12 字以内的总结，要具体（比如"稳住了，还悄悄掉了半斤"），不许空泛
2. highlights：2-3 条做得好、值得夸的地方，**必须引用上面的具体数字**，每条 40 字以内
3. watchout：1-2 条温和的提醒，只挑最值得改的那一点，别列一堆，每条 40 字以内
4. nextStep：下一期只做**一件**最容易做到的小事，要具体到可执行（比如"晚饭后走 15 分钟"），40 字以内
5. mood：从 great / good / steady / tough 里选一个词，表示这一期的整体状态
6. emoji：一个最贴切的 emoji
7. note：1-2 句像朋友一样的收尾，不要鸡汤，不要"继续加油"这种空话，60 字以内

如果数据显示这一期几乎没记录，就温柔地提一句"记录断了没关系，回来就好"，不要批评她。
如果体重涨了，先解释可能的原因（水肿 / 生理期 / 吃咸了 / 肌肉），再说不要慌。
绝对不许出现"你太胖了""管住嘴"这类话；不许建议低于 1200 kcal 的饮食或者断食。
写短一点，每条都要落在 40 字以内，别铺开写。
严格只输出 JSON：{"headline":"…","emoji":"…","mood":"…","highlights":["…"],"watchout":["…"],"nextStep":"…","note":"…"}`;

  const res = await chat({
    messages: [
      { role: 'system', content: PERSONA },
      { role: 'user', content: prompt },
    ],
    json: true,
    temperature: 0.75,
    // 这个输出最长（3 条亮点 + 2 条提醒 + 收尾），加上推理开销要留够，
    // 不然会断在半句、JSON 直接解析不出来
    maxTokens: 3000,
  });
  const v = parseReply(res);
  const arr = (x, n = 3) =>
    (Array.isArray(x) ? x : x ? [x] : []).slice(0, n).map((s) => String(s).slice(0, 160));

  return {
    headline: String(v.headline || '这一期也记下来了').slice(0, 40),
    emoji: String(v.emoji || '🌷').slice(0, 4),
    mood: ['great', 'good', 'steady', 'tough'].includes(v.mood) ? v.mood : 'steady',
    highlights: arr(v.highlights, 3),
    watchout: arr(v.watchout, 2),
    nextStep: String(v.nextStep || '').slice(0, 160),
    note: String(v.note || '').slice(0, 240),
    at: new Date().toISOString(),
  };
}

