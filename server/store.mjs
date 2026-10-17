import { mkdir, readFile, writeFile, rename, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, DB_FILE, CONFIG_FILE, BACKUP_DIR } from './paths.mjs';

export const uid = () => randomUUID().slice(0, 8) + Date.now().toString(36).slice(-4);

/** 本地日期 YYYY-MM-DD（不用 UTC，免得晚上记的账跑到第二天） */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ------------------------------------------------------------------ */
/* 默认数据                                                            */
/* ------------------------------------------------------------------ */

/** 内置食物库：转盘/老虎机用，weight 越大越容易被抽到 */
const DEFAULT_FOODS = [
  ['水煮蛋', ['breakfast'], 78, '高蛋白', 3],
  ['无糖豆浆', ['breakfast'], 80, '高蛋白', 3],
  ['燕麦牛奶粥', ['breakfast'], 210, '粗粮', 3],
  ['全麦三明治', ['breakfast'], 260, '粗粮', 2],
  ['希腊酸奶 + 蓝莓', ['breakfast', 'snack'], 150, '低卡', 3],
  ['蒸红薯', ['breakfast', 'snack'], 110, '粗粮', 2],
  ['玉米一根', ['breakfast', 'snack'], 105, '粗粮', 2],
  ['小笼包（4个）', ['breakfast'], 320, '快乐餐', 1],
  ['菜肉馄饨', ['breakfast', 'lunch'], 300, '热乎', 2],
  ['鸡胸肉沙拉', ['lunch', 'dinner'], 280, '高蛋白', 3],
  ['清蒸鲈鱼', ['lunch', 'dinner'], 200, '高蛋白', 2],
  ['番茄炒蛋', ['lunch', 'dinner'], 190, '家常', 3],
  ['西兰花炒虾仁', ['lunch', 'dinner'], 180, '高蛋白', 3],
  ['杂粮饭 + 青菜', ['lunch', 'dinner'], 320, '粗粮', 3],
  ['牛肉炒时蔬', ['lunch', 'dinner'], 300, '高蛋白', 2],
  ['荞麦凉面', ['lunch'], 340, '主食', 2],
  ['菌菇豆腐汤', ['lunch', 'dinner'], 120, '低卡', 2],
  ['麻辣烫（清汤少油）', ['lunch', 'dinner'], 420, '快乐餐', 2],
  ['日式寿司（8贯）', ['lunch', 'dinner'], 400, '快乐餐', 2],
  ['火锅（清汤涮菜）', ['dinner'], 500, '快乐餐', 1],
  ['小米南瓜粥', ['dinner', 'snack'], 140, '养胃', 2],
  ['烤鸡腿（去皮）', ['lunch', 'dinner'], 230, '高蛋白', 2],
  ['凉拌木耳黄瓜', ['lunch', 'dinner'], 70, '低卡', 2],
  ['一个苹果', ['snack'], 85, '低卡', 3],
  ['一小把坚果', ['snack'], 160, '优质脂肪', 2],
  ['黑巧克力 2 块', ['snack'], 90, '快乐餐', 2],
  ['无糖酸奶', ['snack'], 90, '低卡', 3],
  ['半杯奶茶（三分糖）', ['snack'], 210, '快乐餐', 1],
  ['圣女果一碗', ['snack'], 45, '低卡', 3],
  ['关东煮（萝卜海带魔芋）', ['snack', 'dinner'], 100, '低卡', 2],
];

function defaultDb() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    profile: {
      nickname: '小米',
      avatar: '🐱',
      height: 160,
      startWeight: null,
      targetWeight: null,
      startDate: localDate(),
      motto: '今天也要开开心心地瘦一点点～',
    },
    /** 体重记录：一天可以很多条 */
    weights: [],
    /** 饮食记录 */
    meals: [],
    /** 每日打卡：喝水 / 心情 / 便便 / 运动 / 睡眠 / 随手记 */
    checkins: {},
    /** 经期记录：[{ id, start, end|null, note }]，start/end 都是本地日期 */
    periods: [],
    /** 已解锁的成就：{ key: { at, seen } } */
    achievements: {},
    /** 今天吃什么用的食物库 */
    foods: DEFAULT_FOODS.map(([name, slots, kcal, tag, weight]) => ({
      id: uid(),
      name,
      slots,
      kcal,
      tag,
      weight,
      custom: false,
    })),
    /** 已经庆祝过的里程碑（kg 整数位） */
    milestones: [],
    /** 客户端偏好（非密钥） */
    settings: {
      units: 'kg',
      theme: 'strawberry',
      showBmi: true,
      encouragement: true,
    },
  };
}

function defaultConfig() {
  return {
    ai: {
      enabled: false,
      provider: 'openai-compatible',
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.6,
      timeoutMs: 45000,
      /**
       * 让推理模型跳过"先思考再回答"。思考既费 token 也费时间，
       * 实测关掉之后速度翻倍、结果质量没差别，所以默认开。
       * 万一网关不认 thinking 参数，server/ai.mjs 会自动去掉重试。
       */
      disableThinking: true,
      /** 额外的自定义请求头，JSON 对象 */
      extraHeaders: {},
    },
    auth: {
      /** 打开后访问本站在需要口令 */
      enabled: false,
      /** 明文口令，仅用于个人小站，别用重要密码 */
      password: '',
    },
  };
}

/* ------------------------------------------------------------------ */
/* 读写                                                                */
/* ------------------------------------------------------------------ */

let dbCache = null;
let configCache = null;
let writeQueue = Promise.resolve();

async function ensureDirs() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await mkdir(BACKUP_DIR, { recursive: true });
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'EROFS') {
      // 最常见的是 Docker 里把宿主机的 data/ 挂进来，而那个目录是 root 建的，
      // 容器里的进程没权限写。原始的 EACCES 堆栈完全看不出该怎么办，
      // 所以这里直接把原因和命令写出来。
      throw new Error(
        [
          `数据目录没有写权限：${DATA_DIR}`,
          `（${err.code}: ${err.message}）`,
          '',
          '如果你是用 Docker 跑的，多半是挂进来的宿主机目录属于 root，',
          '而容器里的 node 用户（uid 1000）写不了。在宿主机上执行一次：',
          '',
          '  mkdir -p ./data && chown -R 1000:1000 ./data',
          '',
          '然后重建容器。不想折腾权限的话，可以把 -v 换成命名卷：',
          '  -v mi-diary-data:/app/data',
          '',
          '如果是直接跑 node（不是 Docker），确认当前用户对 data/ 有写权限。',
        ].join('\n'),
      );
    }
    throw err;
  }
}

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[store] 读取 ${file} 失败，改用默认值：`, err.message);
      try {
        await copyFile(file, `${file}.broken-${Date.now()}`);
      } catch {}
    }
    return null;
  }
}

/** 原子写：先写 .tmp 再 rename，断电也不会写坏 */
async function writeJsonAtomic(file, data) {
  await ensureDirs();
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, file);
}

export async function getDb() {
  if (dbCache) return dbCache;
  await ensureDirs();
  let raw = await readJson(DB_FILE, null);
  if (!raw) {
    raw = defaultDb();
    await writeJsonAtomic(DB_FILE, raw);
  }
  // 补齐新版本新增的字段，老数据不会因为升级而炸掉
  dbCache = mergeDefaults(raw, defaultDb());
  return dbCache;
}

function mergeDefaults(value, defaults) {
  if (Array.isArray(defaults)) return Array.isArray(value) ? value : defaults;
  if (defaults && typeof defaults === 'object') {
    const out = value && typeof value === 'object' ? { ...value } : {};
    for (const [k, v] of Object.entries(defaults)) {
      out[k] = k in out ? mergeDefaults(out[k], v) : v;
    }
    return out;
  }
  return value === undefined || value === null ? defaults : value;
}

/** 串行落盘，避免并发请求互相覆盖 */
function persist(file, data) {
  writeQueue = writeQueue.then(() => writeJsonAtomic(file, data)).catch((e) => console.error('[store] 落盘失败：', e));
  return writeQueue;
}

export async function saveDb(db = dbCache) {
  dbCache = db;
  return persist(DB_FILE, db);
}

export async function getConfig() {
  if (configCache) return configCache;
  await ensureDirs();
  let raw = await readJson(CONFIG_FILE, null);
  if (!raw) {
    raw = defaultConfig();
    await writeJsonAtomic(CONFIG_FILE, raw);
  }
  configCache = mergeDefaults(raw, defaultConfig());
  return configCache;
}

export async function saveConfig(cfg = configCache) {
  configCache = cfg;
  return persist(CONFIG_FILE, cfg);
}

/** 供外部直接把已修改的对象写回去（简化调用方） */
export async function mutateDb(fn) {
  const db = await getDb();
  const result = await fn(db);
  await saveDb(db);
  return result;
}

/** 每天第一次改动前留一份备份，最多留 30 份 */
export async function backupDaily() {
  await ensureDirs();
  const stamp = localDate();
  const target = path.join(BACKUP_DIR, `db-${stamp}.json`);
  try {
    await readFile(target);
    return target; // 今天已经备份过
  } catch {}
  try {
    await copyFile(DB_FILE, target);
  } catch {}
  try {
    const files = (await readdir(BACKUP_DIR)).filter((f) => f.startsWith('db-')).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 30))) {
      await (await import('node:fs/promises')).unlink(path.join(BACKUP_DIR, old));
    }
  } catch {}
  return target;
}
