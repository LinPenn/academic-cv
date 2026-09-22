/**
 * 模块：研究方向
 * ------------------------------------------------------------------
 * 研究页（/research/ 和 /zh/research/）上那几张方向卡片：名称、简介、图标、配色、关键词，
 * 支持新增 / 排序 / 删除。数据写在 content/research/_index.md(.zh.md) 的
 * sections[].content.items 里（区块类型 research-areas）。
 */

import {
  api, el, clear, section, toast, reportError, reportSave, spinner, iconBtn, confirmDialog,
  appendAll, input,
} from '../core.js';

const PAGES = [
  { lang: 'en', path: 'content/research/_index.md', label: 'English' },
  { lang: 'zh', path: 'content/research/_index.zh.md', label: '中文' },
];

const ICONS = [
  'hero/beaker', 'hero/cube-transparent', 'hero/squares-2x2', 'hero/chart-bar', 'hero/eye',
  'hero/cpu-chip', 'hero/sparkles', 'hero/academic-cap', 'hero/globe-alt', 'hero/bolt',
  'hero/light-bulb', 'hero/calculator', 'hero/circle-stack', 'hero/variable', 'hero/cog-6-tooth',
  'hero/document-magnifying-glass', 'hero/presentation-chart-bar', 'hero/user-group',
  'hero/device-tablet', 'hero/adjustments-horizontal', 'hero/arrow-trending-up', 'hero/swatch',
];

const GRADIENTS = [
  ['from-primary-400 to-secondary-400', '蓝紫（主题默认）'],
  ['from-emerald-400 to-teal-600', '青绿'],
  ['from-sky-400 to-indigo-600', '天蓝 → 靛蓝'],
  ['from-fuchsia-400 to-purple-600', '紫红'],
  ['from-amber-400 to-orange-500', '琥珀 → 橙'],
  ['from-rose-400 to-pink-600', '玫红'],
  ['from-blue-400 to-purple-500', '蓝 → 紫'],
  ['from-yellow-400 to-orange-500', '黄 → 橙'],
  ['from-slate-800 to-zinc-800', '深灰'],
];

let ctx = null;
let root = null;
let cur = PAGES[0];      // 当前编辑的语言
let d = null;            // 该页面的数据
let items = [];          // 方向列表
let blockIndex = 0;
let listBox = null;

export default {
  id: 'research',
  label: '研究方向',
  icon: '🔬',
  group: '内容',
  title: '研究方向',
  previewPath: '/research/',
  desc: '管理研究页上的方向卡片：名称、简介、图标、配色与关键词。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await load();
  },
};

async function load() {
  clear(root).append(spinner());
  try {
    d = await api(`/api/pages/doc?path=${encodeURIComponent(cur.path)}`);
    const blocks = d.blocks ?? [];
    blockIndex = Math.max(0, blocks.findIndex((b) => b.block === 'research-areas'));
    const b = blocks[blockIndex];
    items = (b?.items ?? []).map((x) => ({ ...x }));
  } catch (err) { reportError(err); return; }
  render();
  ctx.setPreview(cur.lang === 'zh' ? '/zh/research/' : '/research/');
  ctx.registerSave(save);
  ctx.markDirty(false);
}

function render() {
  clear(root);
  listBox = el('div', { class: 'stack' });

  appendAll(root,
    el('h1', { class: 'page-title' }, '研究方向'),
    el('p', { class: 'page-desc', text: '这些卡片显示在研究页上。可以改名称、简介、图标、配色和关键词，也能新增或删除方向。' }),
    section('编辑哪个语言',
      el('div', { class: 'row' },
        ...PAGES.map((p) => el('button', {
          class: `btn ${p === cur ? 'btn-primary' : 'btn-ghost'}`,
          text: p.label,
          onclick: async () => { cur = p; await load(); },
        }))),
      el('p', { class: 'muted small mono', text: cur.path })),
    section('方向卡片',
      el('p', { class: 'muted small', text: '用 ↑ ↓ 调整顺序；图标可填 hero/ 开头的图标名或 emoji。' }),
      listBox,
      el('div', { class: 'row', style: 'margin-top:10px' },
        el('button', {
          class: 'btn btn-primary btn-sm', text: '+ 添加方向',
          onclick: () => {
            items.push({ name: '新的方向', description: '', icon: 'hero/beaker', gradient: GRADIENTS[0][0], topics: [], extra: {} });
            drawList(); dirty();
          },
        }),
        el('span', { class: 'muted small', text: `共 ${items.length} 个方向` }))),
  );
  drawList();
}

function drawList() {
  clear(listBox);
  if (!items.length) listBox.append(el('p', { class: 'muted small', text: '还没有方向，点下面「+ 添加方向」。' }));
  items.forEach((it, i) => listBox.append(card(it, i)));
}

function card(it, i) {
  const titleBtn = el('button', {
    type: 'button', class: 'list-item-title',
    onclick: () => wrapper.classList.toggle('open'),
  }, it.name || `方向 ${i + 1}`);

  const iconList = el('datalist', { id: `research-icons-${i}` }, ...ICONS.map((v) => el('option', { value: v })));

  const body = el('div', { class: 'list-item-body' }, el('div', { class: 'stack' },
    el('div', { class: 'grid-2' },
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '名称' }),
        el('input', {
          type: 'text', value: it.name ?? '',
          oninput: (e) => { it.name = e.target.value; titleBtn.textContent = it.name || `方向 ${i + 1}`; dirty(); },
        })),
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '图标' }),
        el('input', {
          type: 'text', value: it.icon ?? '', list: `research-icons-${i}`, placeholder: 'hero/beaker',
          oninput: (e) => { it.icon = e.target.value; dirty(); },
        }),
        iconList,
        el('span', { class: 'fld-hint', text: '点输入框可选常用图标，也可直接填 emoji' }))),
    input({
      label: '简介', rows: 3, value: it.description ?? '',
      onInput: (v) => { it.description = v; dirty(); },
    }),
    el('div', { class: 'grid-2' },
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '卡片配色' }),
        el('select', { onchange: (e) => { it.gradient = e.target.value; dirty(); } },
          ...gradientOptions(it.gradient))),
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '关键词（可选）' }),
        el('input', {
          type: 'text', value: (it.topics ?? []).join(', '), placeholder: 'Genomics, GWAS',
          oninput: (e) => { it.topics = e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean); dirty(); },
        }),
        el('span', { class: 'fld-hint', text: '用逗号分隔，卡片上最多显示 3 个' }))),
  ));

  const wrapper = el('div', { class: 'list-item open' },
    el('div', { class: 'list-item-head' },
      titleBtn,
      el('div', { class: 'list-item-actions' },
        iconBtn('↑', '上移', () => { if (i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; drawList(); dirty(); } }),
        iconBtn('↓', '下移', () => { if (i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; drawList(); dirty(); } }),
        iconBtn('✕', '删除该方向', () => confirmDialog('删除方向', `确定删除「${it.name}」吗？（保存后生效）`, () => { items.splice(i, 1); drawList(); dirty(); }), 'danger'))),
    body);
  return wrapper;
}

function gradientOptions(current) {
  const known = GRADIENTS.some(([v]) => v === current);
  const opts = GRADIENTS.map(([v, label]) => el('option', { value: v, selected: v === current }, label));
  return known || !current ? opts : [el('option', { value: current, selected: true }, `当前：${current}`), ...opts];
}

async function save() {
  const res = await api('/api/pages/save', {
    method: 'POST',
    body: { path: cur.path, title: d.title, blocks: [{ index: blockIndex, items }] },
  });
  reportSave(res, { label: '研究方向已保存' });
  ctx.markDirty(false);
  ctx.reloadPreview(cur.lang === 'zh' ? '/zh/research/' : '/research/');
  await ctx.refreshStatus();
  await load();
}

function dirty() { ctx.markDirty(true); }
