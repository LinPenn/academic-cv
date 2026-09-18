/**
 * 浏览器启动流程复现测试
 * ------------------------------------------------------------------
 * 用极简 DOM 模拟加载 index.html 的结构，然后执行 public/js/app.js，
 * 检查「8 秒内是否完成启动」（对应界面上的「载入失败」提示）。
 *
 * 用法： node tools/editor/test-boot.mjs [port]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function realErrorQuiet(msg) { console.log(msg); }
const PORT = Number(process.argv[2] ?? 7789);
const BASE = `http://127.0.0.1:${PORT}`;

/* ---------------- 极简 DOM 模拟 ---------------- */

class ClassList {
  constructor(node) { this.node = node; }
  get set() { return new Set((this.node.className || '').split(/\s+/).filter(Boolean)); }
  _w(s) { this.node.className = [...s].join(' '); }
  add(...c) { const s = this.set; c.forEach((x) => s.add(x)); this._w(s); }
  remove(...c) { const s = this.set; c.forEach((x) => s.delete(x)); this._w(s); }
  contains(c) { return this.set.has(c); }
  toggle(c, f) { const s = this.set; const on = f === undefined ? !s.has(c) : !!f; if (on) s.add(c); else s.delete(c); this._w(s); return on; }
}

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parentNode = null; this.attributes = {};
    this.dataset = {}; this.handlers = {}; this.style = {}; this.className = '';
    this._text = ''; this.value = ''; this.checked = false; this.disabled = false;
    this.selected = false; this.selectionStart = 0; this.selectionEnd = 0; this.files = [];
    this.classList = new ClassList(this);
  }
  get firstChild() { return this.children[0] ?? null; }
  set textContent(v) { this._text = String(v ?? ''); this.children = []; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent ?? '').join('') : this._text; }
  set innerHTML(v) { this._html = String(v ?? ''); }
  get innerHTML() { return this._html ?? ''; }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  addEventListener(t, fn) { (this.handlers[t] ??= []).push(fn); }
  removeEventListener() {}
  dispatch(t, e = {}) { const ev = { type: t, target: this, preventDefault() {}, stopPropagation() {}, ...e }; (this.handlers[t] ?? []).forEach((f) => f(ev)); return ev; }
  click() { this.dispatch('click'); }
  append(...ns) {
    for (const n of ns) {
      if (n === null || n === undefined || n === false) continue;
      const node = typeof n === 'string' ? Object.assign(new FakeNode('#text'), { textContent: n }) : n;
      node.parentNode = this; this.children.push(node);
    }
  }
  appendChild(n) { this.append(n); return n; }
  removeChild(n) { this.children = this.children.filter((c) => c !== n); n.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; const i = p.children.indexOf(this); if (i >= 0) { p.children[i] = n; n.parentNode = p; } }
  focus() {}
  setRangeText(text, s, e) { this.value = this.value.slice(0, s) + text + this.value.slice(e); }
  _m(sel) {
    return sel.split(',').map((x) => x.trim()).some((x) => {
      if (x.startsWith('.')) return this.classList.contains(x.slice(1));
      if (x.startsWith('#')) return this.attributes.id === x.slice(1);
      return this.tagName === x.toUpperCase();
    });
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (c._m?.(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  closest(sel) { let n = this; while (n) { if (n._m?.(sel)) return n; n = n.parentNode; } return null; }
}

const byId = new Map();
const document = {
  body: new FakeNode('body'),
  title: '',
  createElement: (t) => new FakeNode(t),
  createTextNode: (t) => Object.assign(new FakeNode('#text'), { textContent: t }),
  getElementById: (id) => {
    if (!byId.has(id)) { const n = new FakeNode('div'); n.setAttribute('id', id); byId.set(id, n); }
    return byId.get(id);
  },
  querySelector: (s) => document.body.querySelector(s),
  querySelectorAll: (s) => document.body.querySelectorAll(s),
  addEventListener() {},
};

const appEl = new FakeNode('div');
appEl.className = 'app';
document.body.append(appEl);
// 按 index.html 的结构建立元素
for (const id of ['content', 'sidebar', 'main', 'status-chips', 'toasts', 'brand-name', 'brand-site', 'boot-hint', 'boot-error', 'boot-error-msg', 'btn-check', 'btn-open-site', 'btn-toggle-preview', 'btn-publish']) {
  byId.set(id, new FakeNode('div'));
}
const windowHandlers = {};
globalThis.document = document;
globalThis.Node = FakeNode;
globalThis.Event = class { constructor(t) { this.type = t; } };
globalThis.window = {
  open() {},
  location: { hash: '' },
  confirm: () => true,
  addEventListener(t, fn) { (windowHandlers[t] ??= []).push(fn); },
  removeEventListener() {},
};
globalThis.location = globalThis.window.location;
globalThis.Blob = class { constructor(p) { this.parts = p; } };
if (!globalThis.navigator) globalThis.navigator = {};
try { globalThis.navigator.clipboard = { writeText: async () => {} }; } catch { /* ignore */ }

const realFetch = globalThis.fetch;
const slow = [];
globalThis.fetch = async (url, opts) => {
  const abs = url.startsWith('http') ? url : BASE + url;
  const t0 = Date.now();
  try {
    const res = await realFetch(abs, opts);
    const ms = Date.now() - t0;
    if (ms > 500) slow.push(`${abs} ${ms}ms`);
    return res;
  } catch (err) {
    slow.push(`${abs} 失败: ${err.message}（${Date.now() - t0}ms）`);
    throw err;
  }
};

/* ---------------- 运行 ---------------- */

/* ---------------- 0) 先做静态语法检查 ---------------- */
// 教训：之前用脚本改 JS 时写进了一个真实换行符，app.js 语法错误导致整页白屏，
// 而当时的检查被 .catch 吞掉了。这里把每个前端文件都转成 CommonJS 后真正解析一遍。
{
  const vm = await import('node:vm');

  /** 把 ESM 源码转成可被 vm.Script 解析的等价形式（保持行号不变） */
  function toCommonJsForParsing(src) {
    const lines = src.split(String.fromCharCode(10));
    const out = [];
    let insideImport = false;
    for (const line of lines) {
      if (line.startsWith('import ')) {
        insideImport = !line.trimEnd().endsWith(';');
        out.push('//' + line);
        continue;
      }
      if (insideImport) {
        out.push('//' + line);
        if (line.startsWith('} from')) insideImport = false;
        continue;
      }
      if (line.startsWith('export default ')) { out.push('const __default__ = ' + line.slice('export default '.length)); continue; }
      if (line.startsWith('export ')) { out.push(line.slice('export '.length)); continue; }
      out.push(line);
    }
    return out.join(String.fromCharCode(10));
  }

  const walk = (dir, out = []) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p, out);
      else if (name.endsWith('.js')) out.push(p);
    }
    return out;
  };

  const files = walk(path.join(ROOT, 'tools/editor/public/js'));
  const bad = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    try {
      // eslint-disable-next-line no-new
      new vm.Script(toCommonJsForParsing(fs.readFileSync(file, 'utf8')), { filename: rel });
    } catch (err) {
      const at = /:(\d+)/.exec(err.stack ?? '');
      bad.push(`${rel}${at ? `（约第 ${at[1]} 行）` : ''} → ${err.message}`);
    }
  }
  if (bad.length) {
    console.log(`  ✗ 前端 JS 语法检查未通过（浏览器里会整页白屏），共 ${bad.length} 个：`);
    bad.forEach((b) => console.log('      · ' + b));
    console.log('');
    process.exit(1);
  }
  console.log(`  ✓ 前端 JS 全部通过语法检查（${files.length} 个文件）`);
}

/* ---------------- 1) 启动流程 ---------------- */

const errors = [];
const realError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); realError('  [console.error]', ...a); };

const t0 = Date.now();
let ready = false;
try {
  await import('./public/js/app.js');
  // 等待启动完成（最多 8 秒，与页面上的兜底一致）
  while (Date.now() - t0 < 8000 && !globalThis.window.__editorReady) {
    await new Promise((r) => setTimeout(r, 100));
  }
  ready = !!globalThis.window.__editorReady;
} catch (err) {
  realError('  [模块加载异常]', err.stack?.split('\n').slice(0, 4).join('\n'));
}

const contentEl = byId.get('content');
const text = contentEl.textContent.slice(0, 120).replace(/\s+/g, ' ');

console.log('');
console.log(`  启动耗时：${Date.now() - t0}ms`);
console.log(`  __editorReady：${ready ? '✓ 已置位' : '✗ 未置位（界面上会显示「编辑器载入失败」）'}`);
console.log(`  内容区文字：${JSON.stringify(text)}`);
console.log(`  侧栏按钮数：${byId.get('sidebar').querySelectorAll('button').length}`);
console.log(`  状态栏节点：${byId.get('status-chips').children.length}`);
if (slow.length) {
  console.log('  较慢/失败的请求：');
  slow.forEach((s) => console.log('    · ' + s));
}
if (errors.length) {
  console.log(`  console.error ${errors.length} 条：`);
  errors.slice(0, 5).forEach((e) => console.log('    · ' + e.split('\n')[0]));
}
console.log('');
process.exitCode = ready ? 0 : 1;
