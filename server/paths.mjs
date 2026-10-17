import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录 */
export const ROOT = path.resolve(here, '..');
/** 前端静态资源目录 */
export const PUBLIC_DIR = path.join(ROOT, 'public');
/** 数据目录（运行时创建，备份只需要拷这一个目录） */
export const DATA_DIR = path.join(ROOT, 'data');

export const DB_FILE = path.join(DATA_DIR, 'db.json');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/** 默认 8087，可以用环境变量 PORT 盖掉：PORT=9000 node server/index.mjs */
export const PORT = Number(process.env.PORT || 8087);
export const HOST = process.env.HOST || '0.0.0.0';
