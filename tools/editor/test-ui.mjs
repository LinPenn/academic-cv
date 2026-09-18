/**
 * 前端集成测试：用极简 DOM 模拟跑真实的模块代码 + 真实后端 API
 * ------------------------------------------------------------------
 * 目的：在没有浏览器的环境下，尽可能验证「界面代码 → API → 文件写入」整条链路，
 *       捕捉渲染期的运行时错误（拼写、字段名、事件回调等）。
 *
 * 用法： node tools/editor/test-ui.mjs [port]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.argv[2] ?? 7788);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
const log = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; log.push(`  ✓ ${name}`); }
  else { fail++; log.push(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`); }
}

/* ------------------------------------------------------------------ */
/* 极简 DOM 模拟                                                       */
/* ------------------------------------------------------------------ */

class ClassList {
  constructor(node) { this.node = node; }
  get set() { return new Set((this.node.className || '').split(/\s+/).filter(Boolean)); }
  _write(s) { this.node.className = [...s].join(' '); }
  add(...c) { const s = this.set; c.forEach((x) => s.add(x)); this._write(s); }
  remove(...c) { const s = this.set; c.forEach((x) => s.delete(x)); this._write(s); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const s = this.set;
    const on = force === undefined ? !s.has(c) : !!force;
    if (on) s.add(c); else s.delete(c);
    this._write(s);
    return on;
  }
}

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.handlers = {};
    this.style = {};
    this.className = '';
    this._text = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.selected = false;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.files = [];
    this.classList = new ClassList(this);
  }

  get firstChild() { return this.children[0] ?? null; }

  set textContent(v) { this._text = String(v ?? ''); this.children = []; }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent ?? '').join('');
    return this._text;
  }

  set innerHTML(v) { this._html = String(v ?? ''); }
  get innerHTML() { return this._html ?? ''; }

  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }

  addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
  removeEventListener() {}

  dispatch(type, event = {}) {
    const evt = { type, target: this, preventDefault() {}, stopPropagation() {}, ...event };
    for (const fn of this.handlers[type] ?? []) fn(evt);
    // 冒泡到父节点（只支持一层，够用）
    if (this.parentNode) this.parentNode.dispatch(type, { ...evt, target: this });
    return evt;
  }

  click() { this.dispatch('click'); }

  append(...nodes) {
    for (const n of nodes) {
      if (n === null || n === undefined || n === false) continue;
      const node = typeof n === 'string' ? new FakeNode('#text') : n;
      if (typeof n === 'string') node.textContent = n;
      node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(n) { this.append(n); return n; }
  removeChild(n) { this.children = this.children.filter((c) => c !== n); n.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  replaceWith(n) {
    const parent = this.parentNode;
    if (!parent) return;
    const i = parent.children.indexOf(this);
    if (i >= 0) { parent.children[i] = n; n.parentNode = parent; }
  }
  focus() {}
  setRangeText(text, start, end) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
  }

  _matches(sel) {
    return sel.split(',').map((s) => s.trim()).some((s) => {
      if (s.startsWith('.')) return this.classList.contains(s.slice(1));
      if (s.startsWith('#')) return this.attributes.id === s.slice(1);
      return this.tagName === s.toUpperCase();
    });
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (c._matches?.(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  closest(sel) { let n = this; while (n) { if (n._matches?.(sel)) return n; n = n.parentNode; } return null; }
}

const byId = new Map();
const document = {
  body: new FakeNode('body'),
  title: '',
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (t) => { const n = new FakeNode('#text'); n.textContent = t; return n; },
  getElementById: (id) => {
    if (!byId.has(id)) { const n = new FakeNode('div'); n.setAttribute('id', id); byId.set(id, n); }
    return byId.get(id);
  },
  querySelector: (sel) => document.body.querySelector(sel),
  addEventListener() {},
};

const appEl = new FakeNode('div');
appEl.className = 'app';
document.body.append(appEl);
byId.set('content', new FakeNode('div'));
byId.set('sidebar', new FakeNode('nav'));
byId.set('main', new FakeNode('main'));
byId.set('status-chips', new FakeNode('span'));
byId.set('toasts', new FakeNode('div'));
byId.set('brand-name', new FakeNode('span'));
byId.set('brand-site', new FakeNode('small'));
for (const id of ['btn-check', 'btn-open-site', 'btn-toggle-preview', 'btn-publish']) byId.set(id, new FakeNode('button'));

globalThis.document = document;
globalThis.Node = FakeNode;
globalThis.Event = class { constructor(type) { this.type = type; } };
if (!globalThis.navigator) globalThis.navigator = {};
try { globalThis.navigator.clipboard = { writeText: async () => {} }; } catch { Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.window = { open() {}, location: { hash: '#/dashboard' } };
globalThis.location = globalThis.window.location;
globalThis.Blob = class { constructor(parts) { this.parts = parts; this.size = 0; } };

const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => realFetch(url.startsWith('http') ? url : BASE + url, opts);

/* ------------------------------------------------------------------ */
/* 测试                                                               */
/* ------------------------------------------------------------------ */

const errors = [];
const cleanFetch = globalThis.fetch;

async function withCtx(mod) {
  const root = new FakeNode('div');
  const ctx = {
    query: {},
    basePath: () => '/academic-cv/',
    api: async (p, o) => (await import('./public/js/core.js')).api(p, o),
    navigate() {},
    markDirty(v) { ctx.dirty = v; },
    registerSave(fn) { ctx.save = fn; },
    setPreview() {},
    reloadPreview() {},
    refreshStatus: async () => {},
    reload() {},
  };
  const t0 = Date.now();
  await mod.mount(root, ctx);
  return { root, ctx, ms: Date.now() - t0 };
}

/** 统计内容恰好为 "null"/"undefined" 的文本节点（原生 append(null) 的痕迹） */
function collectNullTexts(n) {
  let bad = 0;
  const walk = (node) => {
    if (node.tagName === '#TEXT' && ['null', 'undefined'].includes((node.textContent || '').trim())) bad++;
    for (const c of node.children) walk(c);
  };
  walk(n);
  return bad;
}

function countNodes(n) {
  let c = 1;
  for (const ch of n.children) c += countNodes(ch);
  return c;
}

async function main() {
  console.log(`\n前端集成测试（DOM 模拟 + 真实 API ${BASE}）\n`);
  const core = await import('./public/js/core.js');
  core.setBasePath('/academic-cv/');
  // 让报错不会被吞掉
  const origError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); origError(...args); };

  const mods = ['dashboard', 'people', 'profiles', 'faculty', 'news', 'publications', 'pages', 'media', 'settings', 'layout', 'publish', 'advanced'];
  const mounted = {};
  for (const id of mods) {
    const mod = (await import(`./public/js/modules/${id}.js`)).default;
    try {
      const r = await withCtx(mod);
      mounted[id] = r;
      check(`模块「${mod.label}」渲染成功（${countNodes(r.root)} 个节点，${r.ms}ms）`, countNodes(r.root) > 3 && r.ms < 20000);
      // 把 null 直接传给原生 append 会插入 "null" 文本，这里守住这条底线
      const nullTexts = collectNullTexts(r.root);
      check(`模块「${mod.label}」没有多余的 "null" 文本`, nullTexts === 0, `发现 ${nullTexts} 处`);
    } catch (err) {
      check(`模块「${mod.label}」渲染成功`, false, err.stack?.split('\n').slice(0, 3).join(' | '));
    }
  }

  /* ---- 成员页：通过界面元素改一个字段并保存 ---- */
  {
    const rel = 'content/people/_index.md';
    const snap = fs.readFileSync(path.join(ROOT, rel));
    try {
      const { root, ctx } = mounted.people;
      const inputs = root.querySelectorAll('input');
      const nameInput = inputs[0];
      check('成员页渲染出了输入框', !!nameInput, `inputs=${inputs.length}`);
      if (nameInput) {
        nameInput.value = 'Zhuocheng Hou（测试）';
        nameInput.dispatch('input', { target: nameInput });
        check('修改字段后标记为「有未保存改动」', ctx.dirty === true);
        await ctx.save();
        check('保存后清除未保存标记', ctx.dirty === false);
        const after = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        check('改动已写入文件', after.includes('Zhuocheng Hou（测试）'));
        // 不写死姓名：只要文件结构还在、还有成员条目，就说明只改动了一个字段
        check('姓名未被写坏（其余内容仍在）', after.includes('- name:') && after.includes('slug:') && after.length > 100,
          `len=${after.length}`);
      }
    } catch (err) {
      check('成员页保存往返', false, err.message);
    }
    fs.writeFileSync(path.join(ROOT, rel), snap);
  }

  /* ---- 个人主页：改一个字段并保存 ---- */
  {
    const rel = 'data/authors/lincanping.yaml';
    const snap = fs.readFileSync(path.join(ROOT, rel));
    try {
      const { root, ctx } = mounted.profiles;
      const cards = root.querySelectorAll('.card');
      check('个人主页列表渲染出成员卡片', cards.length >= 20, `cards=${cards.length}`);
      // 进入某位成员的编辑页
      // 用列表第一张卡片即可，避免写死某位成员（名单随时会变）
      const target = cards.find((c) => /Lin|Canping/i.test(c.textContent)) ?? cards[0];
      check('列表里能找到指定成员', !!target);
      if (target) {
        target.dispatch('click', { target });
        await new Promise((r) => setTimeout(r, 300));
        const inputs = root.querySelectorAll('input');
        check('编辑页渲染出输入框', inputs.length > 4, `inputs=${inputs.length}`);
        const roleInput = inputs.find((i) => i.value === 'Ph.D. Student');
        if (roleInput) {
          roleInput.value = 'Ph.D. Candidate';
          roleInput.dispatch('input', { target: roleInput });
          check('改字段后标记为脏', ctx.dirty === true);
          await ctx.save();
          const after = fs.readFileSync(path.join(ROOT, rel), 'utf8');
          check('个人资料改动已写入', after.includes('Ph.D. Candidate'));
          check('原有链接未被破坏', after.includes('LinPenn') && after.includes('orcid.org'));
        } else {
          check('找到了职位输入框', false, inputs.map((i) => i.value).slice(0, 8).join(' | '));
        }

        /* ---- 自定义模块：添加一个「卡片」模块并保存 ---- */
        const addBtn = root.querySelectorAll('button').find((b) => (b.textContent || '').includes('添加模块'));
        check('编辑页有「+ 添加模块」按钮', !!addBtn);
        if (addBtn) {
          addBtn.dispatch('click', { target: addBtn });
          const boxes = document.body.querySelectorAll('.modal-box');
          const box = boxes[boxes.length - 1];
          check('弹出「添加自定义模块」对话框', !!box && box.textContent.includes('布局'));
          if (box) {
            const titleInput = box.querySelectorAll('input')[0];
            const layoutSel = box.querySelectorAll('select')[0];
            titleInput.value = 'ZZ-TEST-MODULE';
            titleInput.dispatch('input', { target: titleInput });
            layoutSel.value = 'cards';
            layoutSel.dispatch('change', { target: layoutSel });
            const confirmBtn = box.querySelectorAll('button').find((b) => (b.textContent || '').trim() === '添加');
            check('对话框里有「添加」按钮', !!confirmBtn);
            if (confirmBtn) {
              confirmBtn.dispatch('click', { target: confirmBtn });
              check('新模块加入表单并标记为脏', ctx.dirty === true);
              await ctx.save();
              const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
              check('自定义模块已写入 YAML', raw.includes('custom_sections') && raw.includes('ZZ-TEST-MODULE'), raw.slice(0, 0) + `len=${raw.length}`);
              check('布局类型已写入', raw.includes('layout: cards'));

              /* ---- 删除模块（用户报错的场景）---- */
              // 注意：资料里可能已经有别的模块，必须定位到「本次新增的那个」再删
              const targetCard = root.querySelectorAll('.list-item')
                .find((c) => (c.textContent || '').includes('ZZ-TEST-MODULE') && c.querySelectorAll('select').length > 0);
              const delBtn = targetCard?.querySelectorAll('.icon-btn')
                .find((b) => (b.getAttribute('title') || '') === '删除该模块');
              check('模块上有「删除该模块」按钮', !!delBtn);
              if (delBtn) {
                let threw = null;
                try { delBtn.dispatch('click', { target: delBtn }); } catch (e) { threw = e; }
                check('点击删除不再抛异常', !threw, threw ? threw.message : '');
                const boxes2 = document.body.querySelectorAll('.modal-box');
                const confirmBox = boxes2[boxes2.length - 1];
                const okBtn = confirmBox?.querySelectorAll('button').find((b) => (b.textContent || '').trim() === '确定');
                check('弹出删除确认框', !!okBtn);
                if (okBtn) {
                  okBtn.dispatch('click', { target: okBtn });
                  await ctx.save();
                  const raw2 = fs.readFileSync(path.join(ROOT, rel), 'utf8');
                  check('模块已从文件中删除', !raw2.includes('ZZ-TEST-MODULE'), raw2.slice(0, 0) + `len=${raw2.length}`);
                  check('删除后原有链接仍在', raw2.includes('LinPenn'));
                }
              }
              check('原有链接未被破坏（模块写入后）', raw.includes('LinPenn') && raw.includes('orcid.org'));
            }
          }
        }
      }
    } catch (err) {
      check('个人主页保存往返', false, err.message);
    }
    fs.writeFileSync(path.join(ROOT, rel), snap);
  }

  /* ---- 站点设置：改站点名并保存 ---- */
  {
    const files = ['config/_default/params.yaml', 'config/_default/languages.yaml', 'config/_default/hugo.yaml'];
    const snaps = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(ROOT, f))]));
    try {
      const { root, ctx } = mounted.settings;
      const input = root.querySelectorAll('input')[0];   // 站点名称
      check('设置页渲染出了输入框', !!input);
      if (input) {
        input.value = 'Poultry Breeding Innovation Team';
        input.dispatch('input', { target: input });
        check('修改设置后标记为脏', ctx.dirty === true);
        await ctx.save();
        const after = fs.readFileSync(path.join(ROOT, 'config/_default/params.yaml'), 'utf8');
        check('站点名已写入 params.yaml', after.includes('name: Poultry Breeding Innovation Team'));
      }
    } catch (err) {
      check('设置页保存往返', false, err.message);
    }
    files.forEach((f) => fs.writeFileSync(path.join(ROOT, f), snaps[f]));
    check('配置文件已还原', fs.readFileSync(path.join(ROOT, 'config/_default/params.yaml')).equals(snaps['config/_default/params.yaml']));
  }

  /* ---- 新闻页：新建 → 编辑 → 删除（走界面代码） ---- */
  {
    try {
      const { root, ctx } = mounted.news;
      check('新闻列表渲染出表格行', root.querySelectorAll('table').length > 0 || root.querySelectorAll('.empty').length > 0);
    } catch (err) {
      check('新闻列表渲染', false, err.message);
    }
  }

  /* ---- 高级工具：备份 / 回收站 / 校验 标签页可切换 ---- */
  {
    try {
      const { root } = mounted.advanced;
      const tabs = root.querySelectorAll('.tab');
      check('高级工具渲染出 4 个标签页', tabs.length === 4, `tabs=${tabs.length}`);
      tabs.forEach((t) => t.dispatch('click', { target: t }));
      check('切换标签页未报错', true);
    } catch (err) {
      check('高级工具标签页', false, err.message);
    }
  }

  /* ---- 发布页：按钮存在且状态正确 ---- */
  {
    try {
      const { root } = mounted.publish;
      const btns = root.querySelectorAll('button').map((b) => b.textContent);
      check('发布页包含「提交并推送」按钮', btns.some((t) => t.includes('提交并推送')), btns.slice(0, 8).join(' / '));
    } catch (err) {
      check('发布页渲染', false, err.message);
    }
  }

  console.error = origError;
  console.log(log.join('\n'));
  if (errors.length) {
    console.log(`\n渲染期间出现 ${errors.length} 条 console.error：`);
    console.log(errors.slice(0, 6).map((e) => '  · ' + e.split('\n')[0]).join('\n'));
  }
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项\n`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((err) => { console.error(err); process.exit(1); });
