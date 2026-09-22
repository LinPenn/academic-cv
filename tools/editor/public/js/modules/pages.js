/**
 * 模块：页面文字
 * 编辑首页 / 研究 / 招生 / 联系 / 资源等 landing 页面的标题与正文。
 * 卡片型区块（研究方向的 research-areas）可以在这里逐张添加 / 修改 / 排序。
 */

import {
  api, el, clear, input, section, toast, reportError, reportSave, spinner, imageField,
  appendAll, iconBtn, confirmDialog, mediaUrl,
} from '../core.js';

let ctx = null;
let root = null;
let pages = [];
let doc = null;
let quick = null;   // 首页快速字段

/** 常用图标（主题自带的 hero 图标集，共 1200+ 个，也可以直接填 emoji） */
const ICONS = [
  'hero/beaker', 'hero/cube-transparent', 'hero/squares-2x2', 'hero/chart-bar', 'hero/eye',
  'hero/cpu-chip', 'hero/sparkles', 'hero/academic-cap', 'hero/globe-alt', 'hero/bolt',
  'hero/light-bulb', 'hero/calculator', 'hero/circle-stack', 'hero/variable', 'hero/cog-6-tooth',
  'hero/document-magnifying-glass', 'hero/presentation-chart-bar', 'hero/user-group',
  'hero/device-tablet', 'hero/adjustments-horizontal', 'hero/arrow-trending-up', 'hero/swatch',
  'hero/clipboard-document-list', 'hero/magnifying-glass',
];

/** 常用卡片配色（Tailwind 渐变，构建时自动生成对应样式） */
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

const LAYOUTS = [
  ['cards', '卡片网格（推荐）'],
  ['hexagon', '六边形'],
  ['timeline', '时间线'],
];

export default {
  id: 'pages',
  label: '页面文字',
  icon: '📝',
  group: '内容',
  previewPath: '/',
  title: '页面文字',
  desc: '编辑首页、研究、招生、联系等页面的标题、正文和卡片（研究方向等）。正文支持 Markdown 语法。',

  async mount(r, context) {
    ctx = context;
    root = r;
    clear(root).append(spinner());
    try {
      const data = await api('/api/pages');
      pages = data.pages;
      const want = context.query?.path;
      await open(want && pages.some((p) => p.path === want) ? want : pages[0]?.path);
    } catch (err) { reportError(err); }
  },
};

async function open(path) {
  if (!path) return;
  clear(root).append(spinner());
  doc = await api(`/api/pages/doc?path=${encodeURIComponent(path)}`);
  quick = doc.home ? { ...doc.home } : null;
  render();
  ctx.setPreview(pageUrl(doc.path));
  ctx.registerSave(save);
  ctx.markDirty(false);
}

function pageUrl(p) {
  // 中文页面（*.zh.md）在 /zh/ 下，预览要跳对地方
  const isZh = /\.zh\.md$/.test(p);
  let rel = p.replace(/^content\//, '').replace(/\.zh\.md$/, '.md')
    .replace(/_index\.md$/, '').replace(/\.md$/, '');
  if (rel && !rel.endsWith('/')) rel += '/';
  const url = '/' + rel;
  return isZh ? '/zh' + url : url;
}

function render() {
  clear(root);
  const d = doc;
  appendAll(root,
    el('h1', { class: 'page-title' }, '页面文字'),
    el('p', { class: 'page-desc', text: '选择要编辑的页面。正文里的 ### 是三等标题，**加粗** 是加粗，- 开头是列表。' }),
    section('选择页面',
      el('div', { class: 'row' },
        ...pages.map((p) => el('button', {
          class: `btn ${p.path === d.path ? 'btn-primary' : 'btn-ghost'}`,
          text: p.label,
          onclick: () => open(p.path),
        }))),
      el('p', { class: 'muted small mono', text: d.path })),
    d.parseError ? el('div', { class: 'notice notice-warn', text: `该文件的 front matter 无法解析（${d.parseError}），请用「原文编辑」修改。` }) : null,
    section('页面标题',
      input({ label: '标题', value: d.title ?? '', hint: '显示在浏览器标签和搜索结果里', onInput: (v) => { d.title = v; dirty(); } })),
    d.isHome && quick ? homeQuickCard() : null,
    ...d.blocks.filter((b) => b.isMarkdown || b.hasText || b.hasItems).map((b) => blockCard(b)),
  );
}

function homeQuickCard() {
  return section('首页快速设置',
    el('p', { class: 'muted small', text: '这里可以直接改首页的大标题、主图和简介段落，不用碰 HTML。' }),
    input({ label: '首页大标题 (H1)', value: quick.heading ?? '', onInput: (v) => { quick.heading = v; dirty(); } }),
    imageField({ label: '首页主图', value: quick.image ?? '', onChange: (v) => { quick.image = v; dirty(); }, hint: '建议宽度 1600px 以上，横版' }),
    input({ label: '简介段落', rows: 4, value: quick.intro ?? '', onInput: (v) => { quick.intro = v; dirty(); } }));
}

function blockCard(b) {
  const ta = el('textarea', {
    class: 'md-editor', rows: '16', value: b.text ?? '',
    oninput: (e) => { b.text = e.target.value; dirty(); },
  });
  return el('section', { class: 'card' },
    el('h3', { class: 'card-title' },
      b.hasTitle
        ? el('input', {
          type: 'text', value: b.title ?? '', style: 'max-width:340px;font-weight:600',
          placeholder: '区块标题',
          oninput: (e) => { b.title = e.target.value; dirty(); },
        })
        : el('span', { text: `区块 ${b.index + 1}（${b.block || 'markdown'}）` }),
      el('span', { class: 'sub', text: b.block ? `类型：${b.block}` : '' })),
    b.hasLayout ? layoutRow(b) : null,
    b.hasText || b.isMarkdown
      ? el('div', {},
        el('div', { class: 'md-toolbar' },
          mdBtn('H3', () => insert(ta, '\n### ', '', '小标题')),
          mdBtn('B', () => insert(ta, '**', '**', '加粗')),
          mdBtn('•', () => insert(ta, '\n- ', '', '列表项')),
          mdBtn('🔗', () => { const u = prompt('链接地址：', 'https://'); if (u) insert(ta, '[', `](${u})`, '文字'); }),
          mdBtn('🖼', () => {
            // 正文里的图片必须用「/」开头的绝对路径，否则子页面下会 404
            const p = prompt('图片路径（可用「图片素材」模块上传后复制路径）：', '/uploads/');
            if (p) insert(ta, '![', `](${mediaUrl(p)})`, '图片说明');
          })),
        ta)
      : null,
    b.hasItems ? itemsEditor(b) : null,
    !b.hasText && !b.isMarkdown && !b.hasItems
      ? el('p', { class: 'muted small', text: '这个区块没有正文文本（可能是自动列表），无需编辑。' })
      : null);
}

/** 区块的整体排布方式（卡片 / 六边形 / 时间线） */
function layoutRow(b) {
  return el('label', { class: 'fld' },
    el('span', { class: 'fld-label', text: '区块排布' }),
    el('select', { onchange: (e) => { b.layout = e.target.value; dirty(); } },
      ...LAYOUTS.map(([v, label]) => el('option', { value: v, selected: b.layout === v }, label))),
    el('span', { class: 'fld-hint', text: '卡片网格最常用；六边形最多 4~6 张；时间线适合按阶段展示' }));
}

/* ---------------- 卡片条目（研究方向等） ---------------- */

function itemsEditor(b) {
  const listId = `page-icons-${Math.random().toString(36).slice(2, 8)}`;
  const dataList = el('datalist', { id: listId }, ...ICONS.map((v) => el('option', { value: v })));
  const box = el('div', { class: 'stack' });
  const draw = () => {
    clear(box);
    const items = b.items ?? (b.items = []);
    items.forEach((it, i) => box.append(itemCard(b, it, i, draw, listId)));
    if (!items.length) box.append(el('p', { class: 'muted small', text: '还没有卡片，点下面的「+ 添加一张卡片」开始。' }));
  };
  draw();
  return el('div', { style: 'border-top:1px dashed var(--border);padding-top:12px;margin-top:12px' },
    el('p', { class: 'fld-label', text: '卡片内容' }),
    el('p', { class: 'muted small', text: '一张卡片 = 一个研究方向。名称和简介显示在卡片上，图标与配色决定卡片顶部色块。' }),
    dataList,
    box,
    el('div', { class: 'row', style: 'margin-top:8px' },
      el('button', {
        class: 'btn btn-ghost btn-sm', text: '+ 添加一张卡片',
        onclick: () => {
          b.items = b.items ?? [];
          b.items.push({ name: '新的方向', description: '', icon: 'hero/beaker', gradient: GRADIENTS[0][0], topics: [], extra: {} });
          draw();
          dirty();
        },
      }),
      el('span', { class: 'muted small', text: `共 ${(b.items ?? []).length} 张` })));
}

function itemCard(b, it, i, redraw, listId) {
  const head = el('button', {
    type: 'button', class: 'list-item-title',
    onclick: () => card.classList.toggle('open'),
  }, it.name || `卡片 ${i + 1}`);
  const body = el('div', { class: 'list-item-body' }, el('div', { class: 'stack' },
    el('div', { class: 'grid-2' },
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '名称（研究方向）' }),
        el('input', {
          type: 'text', value: it.name ?? '', placeholder: '例如 Functional Gene Research',
          oninput: (e) => { it.name = e.target.value; head.textContent = it.name || `卡片 ${i + 1}`; dirty(); },
        })),
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '图标' }),
        el('input', {
          type: 'text', value: it.icon ?? '', list: listId, placeholder: 'hero/beaker',
          oninput: (e) => { it.icon = e.target.value; dirty(); },
        }),
        el('span', { class: 'fld-hint', text: '点输入框可选常用图标，也可填 emoji（如 🧬）' }))),
    input({
      label: '简介', rows: 3, value: it.description ?? '',
      hint: '一两句话说清这个方向做什么',
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

  const card = el('div', { class: 'list-item' },
    el('div', { class: 'list-item-head' },
      head,
      el('div', { class: 'list-item-actions' },
        iconBtn('↑', '上移', () => { if (i > 0) { const t = b.items[i - 1]; b.items[i - 1] = b.items[i]; b.items[i] = t; redraw(); dirty(); } }),
        iconBtn('↓', '下移', () => { if (i < b.items.length - 1) { const t = b.items[i + 1]; b.items[i + 1] = b.items[i]; b.items[i] = t; redraw(); dirty(); } }),
        iconBtn('复制', '复制该卡片', () => { b.items.splice(i + 1, 0, structuredClone(it)); redraw(); dirty(); }),
        iconBtn('✕', '删除该卡片', () => confirmDialog('删除卡片', `确定删除「${it.name || `卡片 ${i + 1}`}」吗？（保存后生效，可从备份恢复）`, () => { b.items.splice(i, 1); redraw(); dirty(); }), 'danger'))),
    body);
  return card;
}

function gradientOptions(current) {
  const known = GRADIENTS.some(([v]) => v === current);
  const opts = GRADIENTS.map(([v, label]) => el('option', { value: v, selected: v === current }, label));
  return known || !current ? opts : [el('option', { value: current, selected: true }, `当前：${current}`), ...opts];
}

function mdBtn(label, onClick) {
  return el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: label, onclick: onClick });
}

function insert(ta, before, after = '', placeholder = '') {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = ta.value.slice(start, end) || placeholder;
  ta.setRangeText(`${before}${sel}${after}`, start, end, 'end');
  ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

async function save() {
  const res = await api('/api/pages/save', {
    method: 'POST',
    body: {
      path: doc.path,
      title: doc.title,
      quick: doc.isHome ? quick : undefined,
      blocks: doc.blocks
        .filter((b) => b.hasText || b.isMarkdown || b.hasItems)
        .map((b) => ({
          index: b.index,
          text: (b.hasText || b.isMarkdown) ? b.text : undefined,
          title: b.hasTitle ? b.title : undefined,
          items: b.hasItems ? b.items : undefined,
          layout: b.hasLayout ? b.layout : undefined,
        })),
    },
  });
  reportSave(res, { label: '页面已保存' });
  ctx.markDirty(false);
  ctx.reloadPreview(pageUrl(doc.path));
  await ctx.refreshStatus();
}

function dirty() { ctx.markDirty(true); }
