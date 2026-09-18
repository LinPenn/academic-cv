/**
 * 回写安全性自测
 * ------------------------------------------------------------------
 * 对站点里所有真实文件做「解析 → 原样回写 → 校验」测试：
 * 只要有一个键在回写后读回来和原值不同，就说明该键不能用表单编辑，
 * 必须报告出来（而不是悄悄改坏文件）。
 *
 * 用法： node tools/editor/test-roundtrip.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile, getFrontMatter, buildVerifiedText, deepEqual } from './lib/frontmatter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(p, out);
    } else if (/\.(md|ya?ml)$/i.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const targets = [
  ...walk(path.join(root, 'content')),
  ...walk(path.join(root, 'config')),
  ...walk(path.join(root, 'data')),   // 成员个人资料 data/authors/*.yaml
];

let ok = 0;
const opaque = [];
const failures = [];

for (const file of targets) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const text = fs.readFileSync(file, 'utf8');
  let doc;
  try {
    doc = parseFile(text);
  } catch (err) {
    opaque.push(`${rel} → 解析异常：${err.message}`);
    continue;
  }
  if (!doc.hasFrontMatter) { ok++; continue; }
  if (doc.parseError) {
    opaque.push(`${rel} → ${doc.parseError}`);
    continue;
  }
  const fm = getFrontMatter(doc);
  const keys = Object.keys(fm);
  // 1) 逐个键单独回写
  for (const key of keys) {
    try {
      buildVerifiedText(doc, [{ path: [key], value: fm[key] }]);
    } catch (err) {
      failures.push(`${rel} :: ${key} → ${err.message}`);
    }
  }
  // 2) 一次性回写全部键，并检查其它键的值不变
  if (keys.length) {
    try {
      const res = buildVerifiedText(doc, keys.map((k) => ({ path: [k], value: fm[k] })));
      const after = res.frontMatter;
      for (const k of keys) {
        if (!deepEqual(after[k], fm[k])) failures.push(`${rel} :: ${k} → 全量回写后值不一致`);
      }
      // 3) 正文必须原样保留
      const bodyBefore = doc.lines.slice(doc.bodyStart).join('\n');
      const bodyAfter = res.doc.lines.slice(res.doc.bodyStart).join('\n');
      if (bodyBefore !== bodyAfter) failures.push(`${rel} :: 正文被改动（front matter 之外的文本不应变化）`);
      // 4) 幂等：再写一次应完全相同（否则反复保存会不断漂移格式）
      const keys2 = Object.keys(res.frontMatter);
      const res2 = buildVerifiedText(res.doc, keys2.map((k) => ({ path: [k], value: res.frontMatter[k] })));
      if (res2.text !== res.text) {
        failures.push(`${rel} :: 非幂等（第二次保存产生了额外的格式变化）`);
      }
    } catch (err) {
      failures.push(`${rel} :: <全部键> → ${err.message}`);
    }
  }
  ok++;
}

console.log(`\n扫描文件：${targets.length}    可用：${ok}    解析受限：${opaque.length}    回写失败：${failures.length}\n`);
if (opaque.length) {
  console.log('—— 解析受限（这些文件的字段在编辑器里会显示为「只读/原文编辑」）——');
  for (const o of opaque) console.log('  · ' + o);
  console.log('');
}
if (failures.length) {
  console.log('—— 回写校验失败（必须修复）——');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('✅ 所有可解析的文件都能安全回写。\n');
}
