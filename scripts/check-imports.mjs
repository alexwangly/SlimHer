/**
 * 静态检查：确认每个 import 的具名导出在目标模块里真的存在。
 * node --check 只能查语法，这种"导入了不存在的名字"的错误只在浏览器里才会炸。
 *
 * 用法：node scripts/check-imports.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public', 'js');

async function walk(dir, out = []) {
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) await walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

function exportsOf(source) {
  const names = new Set();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+class\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /export\s*\{([^}]*)\}/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      if (re.source.includes('\\{')) {
        for (const part of m[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop().trim();
          if (name) names.add(name);
        }
      } else {
        names.add(m[1]);
      }
    }
  }
  // export default
  if (/export\s+default/.test(source)) names.add('default');
  return names;
}

const files = await walk(ROOT);
const cache = new Map();
const problems = [];

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const importRe = /import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(importRe)) {
    const clause = m[1].trim();
    const spec = m[2];
    if (!spec.startsWith('.')) continue; // 跳过裸模块

    const target = path.resolve(path.dirname(file), spec);
    if (!cache.has(target)) {
      try {
        cache.set(target, exportsOf(await readFile(target, 'utf8')));
      } catch {
        problems.push(`${path.relative(ROOT, file)} -> 找不到模块 ${spec}`);
        cache.set(target, new Set());
      }
    }
    const available = cache.get(target);

    // import { a, b as c } from
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (const part of named[1].split(',')) {
        const raw = part.trim();
        if (!raw) continue;
        const [orig, alias] = raw.split(/\s+as\s+/).map((s) => s.trim());
        if (!available.has(orig)) {
          problems.push(`${path.relative(ROOT, file)} -> 引用了 ${spec} 里不存在的导出 "${orig}"${alias ? ` (as ${alias})` : ''}`);
        }
      }
    }

    // import X from  （默认导入）
    const def = clause.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (def && !named && !clause.startsWith('*')) {
      if (!available.has('default')) {
        problems.push(`${path.relative(ROOT, file)} -> ${spec} 没有默认导出，但用了默认导入 "${def[1]}"`);
      }
    }

    // import * as ns
    if (clause.startsWith('*')) continue;
  }
}

if (problems.length) {
  console.log('发现 ' + problems.length + ' 个导入问题：');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exitCode = 1;
} else {
  console.log(`检查了 ${files.length} 个文件，所有具名导入都能对上 ✅`);
}
