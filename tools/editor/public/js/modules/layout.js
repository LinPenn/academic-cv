/**
 * 模块：页面布局
 * ------------------------------------------------------------------
 * 首页与研究页的间距、图片/文字宽度都用这里的数字控制，
 * 存在 data/layout.yaml，由模板 hooks/head-end/spacing.html 写成页面样式。
 * 改完保存 → 预览自动重建 → 右侧就能看到效果。
 */

import {
  api, el, clear, section, toast, reportError, reportSave, spinner, appendAll,
} from '../core.js';

let ctx = null;
let root = null;
let d = null;          // 服务端返回的布局数据
let values = {};       // 正在编辑的数值

const GROUPS = [
  {
    id: 'home',
    title: '首页',
    desc: '首页顶部留白、大标题、主图和正文之间的距离与宽度。',
    preview: '/',
  },
  {
    id: 'research',
    title: '研究页',
    desc: '研究方向卡片页顶部的留白。',
    preview: '/research/',
  },
];

export default {
  id: 'layout',
  label: '页面布局',
  icon: '📐',
  group: '站点',
  title: '页面布局',
  desc: '用数字调整首页与研究页的留白和宽度，不用改代码。保存后预览会立即重建。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await load();
  },
};

async function load() {
  clear(root).append(spinner());
  try {
    d = await api('/api/layout');
  } catch (err) { reportError(err); return; }
  values = { ...d.values };
  render();
  ctx.setPreview('/');
  ctx.registerSave(save);
  ctx.markDirty(false);
}

function render() {
  clear(root);
  appendAll(root,
    el('h1', { class: 'page-title' }, '页面布局'),
    el('p', { class: 'page-desc', text: '这些数字写在 data/layout.yaml，保存后预览会自动重建，右上角能立刻看到效果。单位都是像素。' }),
    el('div', { class: 'notice' },
      el('p', { text: '提示：顶部留白指导航栏与第一个内容块之间的距离。主题默认值很大（96px），所以之前看起来「上空一大片」。' })),
    ...GROUPS.map((g) => groupCard(g)),
    section('其它',
      el('p', { class: 'muted small', text: `配置文件：${d.file}${d.exists ? '' : '（尚未创建，保存时会自动生成）'}` }),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-ghost btn-sm', text: '恢复默认值', onclick: resetAll }),
        el('span', { class: 'muted small', text: '恢复后需要点「保存」才会写入。' }))),
  );
}

function groupCard(g) {
  const fields = d.fields.filter((f) => f.group === g.id);
  return section(g.title,
    el('p', { class: 'muted small', text: g.desc }),
    el('div', { class: 'grid-2' }, ...fields.map((f) => numField(g, f))),
    el('div', { class: 'row', style: 'margin-top:8px' },
      el('button', {
        class: 'btn btn-ghost btn-sm', text: `预览${g.title}`,
        onclick: () => ctx.reloadPreview(g.preview),
      }),
      el('span', { class: 'muted small', text: `默认值：${fields.map((f) => `${f.label} ${f.def}`).join(' · ')}` })));
}

function numField(g, f) {
  const current = values[f.path] ?? f.def;
  const sync = (v) => {
    const n = Number(v);
    values[f.path] = Number.isFinite(n) ? n : f.def;
    range.value = String(Math.min(f.max, Math.max(f.min, values[f.path])));
    hint.textContent = valueHint(f, values[f.path]);
    dirty();
  };
  const number = el('input', {
    type: 'number', value: String(current), min: String(f.min), max: String(f.max), step: '1',
    oninput: (e) => sync(e.target.value),
  });
  const range = el('input', {
    type: 'range', value: String(current), min: String(f.min),
    max: String(Math.min(f.max, f.max > 2000 ? 2000 : f.max)), step: '1',
    style: 'width:100%',
    oninput: (e) => { number.value = e.target.value; sync(e.target.value); },
  });
  const hint = el('span', { class: 'fld-hint', text: valueHint(f, current) });
  return el('label', { class: 'fld' },
    el('span', { class: 'fld-label', text: `${f.label}（${f.min}–${f.max}px）` }),
    el('div', { class: 'row' },
      el('div', { style: 'width:96px;flex:0 0 auto' }, number),
      range),
    hint);
}

function valueHint(f, v) {
  if (f.path === 'home.top_gap') {
    return v <= 8 ? '很紧凑（推荐）' : v >= 96 ? '主题默认值，会比较空' : `留白 ${v}px`;
  }
  if (f.path === 'research.top_gap') {
    return v <= 24 ? '很紧凑（推荐）' : v >= 96 ? '主题默认值，会比较空' : `留白 ${v}px`;
  }
  return `当前 ${v}px`;
}

function resetAll() {
  values = { ...d.defaults };
  render();
  dirty();
  toast('已恢复默认值，记得点保存', 'info');
}

async function save() {
  const res = await api('/api/layout/save', { method: 'POST', body: { values } });
  reportSave(res, { label: '布局已保存' });
  values = { ...res.values };
  d.values = { ...res.values };
  d.exists = true;
  ctx.markDirty(false);
  ctx.reloadPreview();
  await ctx.refreshStatus();
  render();
}

function dirty() { ctx.markDirty(true); }
