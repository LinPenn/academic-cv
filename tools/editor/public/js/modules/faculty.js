/**
 * 模块：导师主页
 * 编辑 content/faculty/*.md —— 简介、社会任职、论文列表、成果、获奖
 *
 * 论文列表条目很多，提供两种编辑方式：
 *   · 逐条列表：单行输入 + 上下移动 / 删除 / 搜索过滤
 *   · 批量模式：一段文本一行一条，适合整段粘贴
 */

import {
  api, el, clear, input, imageField, section, toast, reportError, reportSave, confirmDialog, modal, spinner, linesField, appendAll,
} from '../core.js';

let ctx = null;
let state = null;      // { files, path, doc }
let bulkSections = new Set();

const SECTION_HINTS = {
  Publications: '论文条目：一行一条，按年份从新到旧排列',
  'Scientific Achievements': '用「## 小标题」可以插入分组小标题（如 Software Copyrights、Patents）',
  'Honors and Awards': '获奖条目',
};

export default {
  id: 'faculty',
  label: '导师主页',
  icon: '🎓',
  group: '内容',
  previewPath: '/faculty/',
  title: '导师主页',
  desc: '编辑导师个人主页：个人简介、社会任职、论文列表、科研成果与获奖。写入 content/faculty/*.md。',

  async mount(root, context) {
    ctx = context;
    clear(root).append(spinner());
    try {
      const list = await api('/api/faculty');
      if (!list.files.length) {
        clear(root).append(el('div', { class: 'notice notice-warn', text: 'content/faculty/ 下没有找到任何 .md 文件。' }));
        return;
      }
      const first = context.query?.path && list.files.some((f) => f.path === context.query.path)
        ? context.query.path : list.files[0].path;
      await load(root, first, list.files);
    } catch (err) {
      reportError(err);
    }
  },
};

async function load(root, path, files) {
  state = { files, path };
  state.doc = await api(`/api/faculty/doc?path=${encodeURIComponent(path)}`);
  bulkSections = new Set();
  render(root);
  ctx.setPreview(previewUrl());
  ctx.registerSave(save);
}

function previewUrl() {
  const slug = (state.path.split('/').pop() ?? '').replace(/\.md$/, '');
  return `/faculty/${slug}/`;
}

function render(root) {
  clear(root);
  const d = state.doc;
  const fileSwitch = state.files.length > 1
    ? el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '选择文件' }),
      el('select', { onchange: async (e) => { await load(root, e.target.value, state.files); } },
        ...state.files.map((f) => el('option', { value: f.path, selected: f.path === state.path }, `${f.title}（${f.path}）`))))
    : null;

  appendAll(root, 
    el('h1', { class: 'page-title' }, '导师主页'),
    el('p', { class: 'page-desc', text: '编辑导师个人主页的简介与各类列表。列表条目支持批量粘贴，适合一次补多年的论文。' }),
    fileSwitch ? section('文件', fileSwitch) : null,
    section('基本信息',
      input({ label: '姓名 / 标题', value: d.title ?? '', onInput: (v) => { d.title = v; dirty(); } }),
      imageField({ label: '照片', value: d.photo ?? '', onChange: (v) => { d.photo = v; dirty(); } }),
      input({ label: '个人简介', rows: 12, value: d.bio ?? '', hint: '空行分段；不要写 Markdown 标题，正文会自动排版', onInput: (v) => { d.bio = v; dirty(); } })),
    ...d.sections.map((s, i) => sectionBlock(s, i)),
    section('保存说明',
      el('div', { class: 'notice' },
        el('p', { text: '保存后写入 ' + state.path + '，并自动刷新右侧预览。' }),
        el('p', { class: 'muted small', text: `该文件还有这些字段会原样保留：${(d.otherKeys ?? []).join('、')}` }))),
  );
  ctx.markDirty(false);
}

function sectionBlock(s, si) {
  const isBulk = bulkSections.has(si);
  const listBox = el('div');

  const renderList = (filter = '') => {
    clear(listBox);
    const keyword = filter.trim().toLowerCase();
    let shown = 0;
    s.items.forEach((item, ii) => {
      const text = itemToText(item);
      if (keyword && !text.toLowerCase().includes(keyword)) return;
      shown++;
      listBox.append(itemRow(s, ii, renderList, text));
    });
    if (!shown) listBox.append(el('p', { class: 'muted small', text: keyword ? '没有匹配的条目' : '暂无条目' }));
  };

  const searchBox = el('input', {
    type: 'search', placeholder: '搜索条目…', style: 'max-width:240px',
    oninput: (e) => renderList(e.target.value),
  });

  const bulkArea = el('textarea', { class: 'md-editor', rows: '18', value: itemsToText(s.items) });
  const bulkHint = el('p', { class: 'muted small', text: '一行一条。以「## 」开头表示分组小标题；「[文字](链接)」表示带链接的条目。' });
  const bulkApply = () => {
    try {
      s.items = textToItems(bulkArea.value, s.items);
      dirty();
      bulkSections.delete(si);
      rerenderSection();
      toast('已应用批量内容（还需点右下角「保存」才写入文件）', 'ok');
    } catch (err) { reportError(err); }
  };

  const body = el('div', { class: 'stack' },
    isBulk
      ? el('div', {}, bulkHint, bulkArea, el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { class: 'btn btn-primary btn-sm', text: '应用', onclick: bulkApply }),
        el('button', { class: 'btn btn-ghost btn-sm', text: '取消', onclick: () => { bulkSections.delete(si); rerenderSection(); } })))
      : el('div', {},
        el('div', { class: 'row', style: 'margin-bottom:8px' }, searchBox),
        listBox),
  );

  const hasUnknown = s.items.some((it) => isUnknownItem(it));
  const titleInput = el('input', {
    type: 'text', value: s.title ?? '', style: 'max-width:320px;font-weight:600',
    oninput: (e) => { s.title = e.target.value; ctx.markDirty(true); },
  });

  const card = el('section', { class: 'card' },
    el('h3', { class: 'card-title' },
      titleInput,
      el('span', { class: 'sub', text: `${s.items.length} 条` }),
      el('span', { class: 'card-actions' },
        el('button', {
          class: 'btn btn-ghost btn-sm', text: '+ 添加条目',
          onclick: () => { s.items.unshift(''); dirty(); rerenderSection(); },
        }),
        el('button', {
          class: 'btn btn-ghost btn-sm', text: '粘贴导入…',
          onclick: () => importDialog(s, rerenderSection),
        }),
        hasUnknown ? null : el('button', {
          class: 'btn btn-ghost btn-sm', text: isBulk ? '退出批量模式' : '批量编辑',
          onclick: () => {
            if (isBulk) bulkSections.delete(si); else bulkSections.add(si);
            rerenderSection();
          },
        }))),
    SECTION_HINTS[s.title] ? el('p', { class: 'muted small', text: SECTION_HINTS[s.title] }) : null,
    body,
  );

  function rerenderSection() {
    const fresh = sectionBlock(s, si);
    card.replaceWith(fresh);
  }

  if (!isBulk) renderList();
  return card;
}

function itemRow(s, ii, renderList, text) {
  const item = s.items[ii];
  const isSub = item && typeof item === 'object' && !Array.isArray(item) && item.subheading !== undefined;
  const isLink = item && typeof item === 'object' && !Array.isArray(item) && item.url !== undefined && item.subheading === undefined;

  let control;
  if (isSub) {
    control = el('div', { class: 'row', style: 'flex:1' },
      el('span', { class: 'chip', text: '小标题' }),
      el('input', {
        type: 'text', value: item.subheading ?? '', style: 'flex:1;font-weight:600',
        oninput: (e) => { item.subheading = e.target.value; dirty(); },
      }));
  } else if (isLink) {
    control = el('div', { class: 'row', style: 'flex:1' },
      el('span', { class: 'chip', text: '链接' }),
      el('input', { type: 'text', value: item.text ?? '', placeholder: '显示文字', style: 'flex:2', oninput: (e) => { item.text = e.target.value; dirty(); } }),
      el('input', { type: 'text', value: item.url ?? '', placeholder: 'https://…', style: 'flex:2', oninput: (e) => { item.url = e.target.value; dirty(); } }));
  } else if (isUnknownItem(item)) {
    control = el('div', { class: 'row', style: 'flex:1' },
      el('span', { class: 'chip', text: '复杂条目' }),
      el('span', { class: 'muted small mono', text: JSON.stringify(item).slice(0, 80) }),
      el('span', { class: 'muted small', text: '（此项由原文编辑维护，此处不改动）' }));
  } else {
    control = el('textarea', {
      rows: '2', value: text, style: 'flex:1;min-height:38px',
      oninput: (e) => { s.items[ii] = e.target.value; dirty(); },
    });
  }

  return el('div', { class: 'row', style: 'align-items:flex-start;padding:4px 0;border-bottom:1px dashed var(--border)' },
    el('span', { class: 'muted small', style: 'width:34px;padding-top:8px', text: String(ii + 1) }),
    control,
    el('div', { class: 'list-item-actions', style: 'padding-top:4px' },
      el('button', { class: 'icon-btn', title: '上移', text: '↑', onclick: () => { if (ii > 0) swap(s.items, ii, ii - 1); dirty(); renderList(); } }),
      el('button', { class: 'icon-btn', title: '下移', text: '↓', onclick: () => { if (ii < s.items.length - 1) swap(s.items, ii, ii + 1); dirty(); renderList(); } }),
      el('button', { class: 'icon-btn', title: '在下方插入', text: '＋', onclick: () => { s.items.splice(ii + 1, 0, ''); dirty(); renderList(); } }),
      el('button', { class: 'icon-btn danger', title: '删除', text: '✕', onclick: () => { s.items.splice(ii, 1); dirty(); renderList(); } })));
}

function importDialog(s, rerender) {
  const ta = el('textarea', { rows: '10', placeholder: '每行一条，直接粘贴即可（支持从 Word/PDF 复制的多行文本）' });
  const pos = el('select', {},
    el('option', { value: 'top' }, '插入到最前面（最新在上）'),
    el('option', { value: 'bottom' }, '追加到最后面'));
  modal({
    title: `粘贴导入到「${s.title}」`,
    wide: true,
    content: el('div', { class: 'stack' },
      el('p', { class: 'muted', text: '每行会被当成一个条目。行首的 -、*、· 等符号会自动去掉。' }),
      ta, pos),
    actions: [
      { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
      {
        label: '导入',
        onClick: (c) => {
          const lines = ta.value.replace(/\r\n?/g, '\n').split('\n')
            .map((l) => l.replace(/^\s*[-*·]\s*/, '').trim()).filter(Boolean);
          if (!lines.length) { toast('没有可导入的内容', 'info'); return; }
          const items = lines.map(parseLine);
          s.items = pos.value === 'top' ? [...items, ...s.items] : [...s.items, ...items];
          dirty();
          c();
          rerender();
          toast(`已导入 ${items.length} 条（记得点「保存」）`, 'ok');
        },
      },
    ],
  });
}

/* ---------------- 条目 ⇄ 文本 ---------------- */

function itemToText(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    if (item.subheading !== undefined) return `## ${item.subheading}`;
    if (item.url !== undefined) return `[${item.text ?? item.url}](${item.url})`;
  }
  return '';
}

function isUnknownItem(item) {
  if (typeof item === 'string' || item == null) return false;
  if (typeof item !== 'object' || Array.isArray(item)) return true;
  return !(item.subheading !== undefined || item.url !== undefined);
}

function itemsToText(items) {
  return items.map(itemToText).join('\n');
}

function parseLine(line) {
  const sub = /^##\s+(.*)$/.exec(line);
  if (sub) return { subheading: sub[1].trim() };
  const link = /^\[(.+?)\]\((.+?)\)$/.exec(line.trim());
  if (link) return { text: link[1], url: link[2] };
  return line;
}

function textToItems(text, original) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    out.push(parseLine(line.trim()));
  }
  return out;
}

/* ---------------- 保存 ---------------- */

async function save() {
  const res = await api('/api/faculty/save', {
    method: 'POST',
    body: {
      path: state.path,
      title: state.doc.title,
      photo: state.doc.photo,
      bio: state.doc.bio,
      sections: state.doc.sections.map((s) => ({ title: s.title, items: s.items })),
    },
  });
  reportSave(res, { label: '导师主页已保存' });
  ctx.markDirty(false);
  ctx.reloadPreview(previewUrl());
  await ctx.refreshStatus();
}

function swap(arr, a, b) {
  const t = arr[a]; arr[a] = arr[b]; arr[b] = t;
}
function dirty() { ctx.markDirty(true); }
