/**
 * 模块：论文发表
 * 管理 content/publications/<目录>/index.md
 */

import {
  api, el, clear, input, section, toast, reportError, reportSave, confirmDialog, modal, spinner, linesField, insertAtCursor, today, listEditor, iconBtn, fmtSize, appendAll,
} from '../core.js';

let ctx = null;
let root = null;
let mode = 'list';
let items = [];
let current = null;

const PUB_TYPES = [
  ['article-journal', '期刊论文 (article-journal)'],
  ['paper-conference', '会议论文 (paper-conference)'],
  ['preprint', '预印本 (preprint)'],
  ['article', '文章 (article)'],
  ['book', '专著 (book)'],
  ['chapter', '章节 (chapter)'],
  ['thesis', '学位论文 (thesis)'],
  ['report', '报告 (report)'],
  ['dataset', '数据集 (dataset)'],
  ['software', '软件 (software)'],
  ['misc', '其它 (misc)'],
];

const LINK_TYPES = ['pdf', 'code', 'dataset', 'poster', 'project', 'slides', 'source', 'video', 'site', 'doi'];

export default {
  id: 'publications',
  label: '论文发表',
  icon: '📚',
  group: '内容',
  previewPath: '/publications/',
  title: '论文发表',
  desc: '维护论文列表。每条论文是 content/publications 下的一个文件夹，可上传 PDF、BibTeX 与封面。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await refresh();
  },
};

async function refresh() {
  clear(root).append(spinner());
  try {
    const data = await api('/api/publications');
    items = data.items;
  } catch (err) { reportError(err); return; }
  if (mode === 'edit' && current) renderEdit();
  else renderList();
}

/* ---------------- 列表 ---------------- */

function renderList() {
  clear(root);
  const byYear = {};
  for (const p of items) {
    const y = (p.date || '').slice(0, 4) || '未填年份';
    (byYear[y] = byYear[y] ?? []).push(p);
  }
  const blocks = Object.keys(byYear).sort().reverse().map((year) => el('div', {},
    el('h3', { class: 'card-title', style: 'margin:18px 0 8px' }, `${year}`, el('span', { class: 'sub', text: `${byYear[year].length} 篇` })),
    el('table', { class: 'tbl' },
      el('tbody', {}, ...byYear[year].map((p) => el('tr', {},
        el('td', {},
          el('div', { style: 'font-weight:600' }, p.title || '(无标题)'),
          el('div', { class: 'muted small', text: [p.publication, (p.authors ?? []).join(', ')].filter(Boolean).join(' · ') }),
          el('div', { class: 'row small', style: 'margin-top:4px' },
            p.draft ? el('span', { class: 'chip chip-warn', text: '草稿' }) : null,
            p.featured ? el('span', { class: 'chip', text: '精选' }) : null,
            ...(p.publication_types ?? []).map((t) => el('span', { class: 'chip', text: t })))),
        el('td', { style: 'width:200px' },
          el('div', { class: 'row' },
            el('button', { class: 'btn btn-ghost btn-sm', text: '编辑', onclick: () => openEdit(p.path) }),
            el('button', { class: 'btn btn-ghost btn-sm', text: '预览', onclick: () => ctx.reloadPreview(p.url) }),
            el('button', {
              class: 'btn btn-danger btn-sm', text: '删除',
              onclick: () => confirmDialog('删除论文', `确定删除「${p.title}」吗？整个文件夹会被移入回收站，可以恢复。`, async () => {
                try {
                  await api('/api/publications/delete', { method: 'POST', body: { path: p.path } });
                  toast('已移入回收站', 'ok');
                  await refresh();
                  await ctx.refreshStatus();
                } catch (err) { reportError(err); }
              }),
            })))))))));

  root.append(
    el('h1', { class: 'page-title' }, '论文发表',
      el('span', { class: 'right row' },
        el('button', { class: 'btn btn-ghost', text: '批量新建…', onclick: bulkCreate }),
        el('button', { class: 'btn btn-primary', text: '+ 新建论文', onclick: () => openEdit(null, true) }))),
    el('p', { class: 'page-desc', text: '论文按年份倒序显示在 /publications/ 页面。可以给每篇论文附上 PDF、BibTeX 引用和外部链接。' }),
    items.length ? el('div', {}, ...blocks) : el('div', { class: 'empty', text: '还没有论文，点「+ 新建论文」开始。' }),
  );
}

function bulkCreate() {
  const ta = el('textarea', { rows: '10', placeholder: '每行一条论文标题，例如：\nComprehensive multi-omics reveals dynamic chromatin changes during duck folliculogenesis\nSingle-cell transcriptomics reveal mechanisms of skeletal muscle differentiation' });
  const yearF = el('input', { type: 'text', value: String(new Date().getFullYear()) });
  modal({
    title: '批量新建论文条目',
    wide: true,
    content: el('div', { class: 'stack' },
      el('p', { class: 'muted', text: '适合先把论文清单录进来，之后逐条补全作者、期刊、链接等细节。新条目默认为「草稿」，不会出现在正式网站上。' }),
      ta,
      el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '年份' }), yearF)),
    actions: [
      { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
      {
        label: '创建',
        onClick: async (c) => {
          const lines = ta.value.replace(/\r\n?/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
          if (!lines.length) { toast('没有输入标题', 'info'); return; }
          let ok = 0;
          const failed = [];
          for (const title of lines) {
            try {
              await api('/api/publications/create', {
                method: 'POST',
                body: { title, date: `${yearF.value}-01-01`, draft: true },
              });
              ok++;
            } catch (err) { failed.push(`${title.slice(0, 30)}…：${err.message}`); }
          }
          c();
          await refresh();
          await ctx.refreshStatus();
          toast(`已创建 ${ok} 条${failed.length ? `，${failed.length} 条失败` : ''}`, failed.length ? 'info' : 'ok', { timeout: 9000 });
          if (failed.length) console.warn(failed);
        },
      },
    ],
  });
}

/* ---------------- 编辑 ---------------- */

async function openEdit(path, isNew = false) {
  if (isNew) {
    const titleF = el('input', { type: 'text', placeholder: '论文标题' });
    const slugF = el('input', { type: 'text', placeholder: '目录名，如 zhu-2026-duck-genome' });
    const dateF = el('input', { type: 'date', value: today() });
    const pubF = el('input', { type: 'text', placeholder: '期刊 / 会议名称' });
    const typeF = el('select', {}, ...PUB_TYPES.map(([v, l]) => el('option', { value: v }, l)));
    modal({
      title: '新建论文',
      wide: true,
      content: el('div', { class: 'stack' },
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '标题' }), titleF),
        el('div', { class: 'grid-2' },
          el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '日期' }), dateF),
          el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '目录名' }), slugF,
            el('span', { class: 'fld-hint', text: '小写字母、数字、连字符' }))),
        el('div', { class: 'grid-2' },
          el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '类型' }), typeF),
          el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '期刊 / 会议' }), pubF))),
      actions: [
        { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
        {
          label: '创建并编辑',
          onClick: async (c) => {
            try {
              const res = await api('/api/publications/create', {
                method: 'POST',
                body: {
                  title: titleF.value.trim() || '未命名论文',
                  slug: slugF.value.trim(),
                  date: dateF.value,
                  publication: pubF.value.trim(),
                  publication_types: [typeF.value],
                  authors: ['me'],
                  draft: true,
                },
              });
              c();
              await refresh();
              await openEdit(res.path);
              await ctx.refreshStatus();
            } catch (err) { reportError(err); }
          },
        },
      ],
    });
    return;
  }
  clear(root).append(spinner());
  try {
    current = await api(`/api/publications/doc?path=${encodeURIComponent(path)}`);
  } catch (err) { reportError(err); return; }
  mode = 'edit';
  renderEdit();
  ctx.setPreview(current.path.replace(/^content/, '').replace(/\/index\.md$/, '/'));
  ctx.registerSave(saveCurrent);
  ctx.markDirty(false);
}

function renderEdit() {
  clear(root);
  const d = current;
  const bodyArea = el('textarea', { class: 'md-editor', value: d.body ?? '', oninput: (e) => { d.body = e.target.value; dirty(); } });

  const linksBox = el('div');
  const renderLinks = () => {
    clear(linksBox);
    (d.links ?? []).forEach((l, i) => {
      linksBox.append(el('div', { class: 'row', style: 'margin-bottom:6px' },
        el('select', { style: 'width:140px', onchange: (e) => { l.type = e.target.value; dirty(); } },
          ...LINK_TYPES.map((t) => el('option', { value: t, selected: t === l.type }, t))),
        el('input', {
          type: 'text', value: l.url ?? '', placeholder: 'https://…', style: 'flex:1',
          oninput: (e) => { l.url = e.target.value; dirty(); },
        }),
        iconBtn('✕', '删除链接', () => { d.links.splice(i, 1); renderLinks(); dirty(); }, 'danger')));
    });
    if (!(d.links ?? []).length) linksBox.append(el('p', { class: 'muted small', text: '暂无链接' }));
  };
  renderLinks();

  appendAll(root, 
    el('div', { class: 'row', style: 'margin-bottom:8px' },
      el('button', { class: 'btn btn-ghost btn-sm', text: '← 返回列表', onclick: async () => { mode = 'list'; current = null; await refresh(); } }),
      el('span', { class: 'muted small mono', text: d.path })),
    el('h1', { class: 'page-title' }, '编辑论文'),
    section('基本信息',
      input({ label: '标题', value: d.title ?? '', onInput: (v) => { d.title = v; dirty(); } }),
      el('div', { class: 'grid-2' },
        input({ label: '日期', type: 'date', value: d.date ?? '', hint: '用于排序和年份分组', onInput: (v) => { d.date = v; dirty(); } }),
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '类型' }),
          el('select', { onchange: (e) => { d.publication_types = [e.target.value]; dirty(); } },
            ...PUB_TYPES.map(([v, l]) => el('option', { value: v, selected: (d.publication_types ?? [])[0] === v }, l))))),
      el('div', { class: 'grid-2' },
        input({ label: '期刊 / 会议全称', value: d.publication ?? '', hint: '支持 *斜体* 标记期刊名', onInput: (v) => { d.publication = v; dirty(); } }),
        input({ label: '简称', value: d.publication_short ?? '', onInput: (v) => { d.publication_short = v; dirty(); } })),
      el('div', { class: 'grid-2' },
        linesField({ label: '作者（每行一位）', value: d.authors ?? [], rows: 3, hint: '写 me 表示本人；顺序即署名顺序', onChange: (v) => { d.authors = v; dirty(); } }),
        linesField({ label: '作者标注', value: d.author_notes ?? [], rows: 3, hint: '与作者一一对应，例如 Equal contribution', onChange: (v) => { d.author_notes = v; dirty(); } })),
      linesField({ label: '标签', value: d.tags ?? [], rows: 3, onChange: (v) => { d.tags = v; dirty(); } }),
      el('div', { class: 'row' },
        el('label', { class: 'fld fld-check' }, el('input', { type: 'checkbox', checked: !!d.draft, onchange: (e) => { d.draft = e.target.checked; dirty(); } }), el('span', { text: '草稿（不发布）' })),
        el('label', { class: 'fld fld-check' }, el('input', { type: 'checkbox', checked: !!d.featured, onchange: (e) => { d.featured = e.target.checked; dirty(); } }), el('span', { text: '精选' })))),
    section('摘要',
      input({ label: '摘要 (abstract)', rows: 6, value: d.abstract ?? '', onInput: (v) => { d.abstract = v; dirty(); } }),
      input({ label: '列表摘要 (summary)', rows: 3, value: d.summary ?? '', hint: '显示在论文列表里的一句话', onInput: (v) => { d.summary = v; dirty(); } })),
    section('链接',
      linksBox,
      el('button', { class: 'btn btn-ghost btn-sm', text: '+ 添加链接', onclick: () => { d.links = d.links ?? []; d.links.push({ type: 'pdf', url: '' }); renderLinks(); dirty(); } })),
    section('正文（可选）',
      el('div', { class: 'md-toolbar' },
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'B', title: '加粗', onclick: () => insertAtCursor(bodyArea, '**', '**', '粗体') }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '🔗', title: '链接', onclick: () => { const u = prompt('链接地址：', 'https://'); if (u) insertAtCursor(bodyArea, '[', `](${u})`, '文字'); } }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '💡', title: '提示框', onclick: () => insertAtCursor(bodyArea, '\n> [!NOTE]\n> ', '', '说明') })),
      bodyArea),
    d.hasBib ? section('BibTeX 引用 (cite.bib)',
      el('textarea', { class: 'md-editor', rows: '8', value: d.bib ?? '', oninput: (e) => { d.bib = e.target.value; dirty(); } })) : null,
    section('文件与封面',
      el('p', { class: 'muted small', text: 'PDF、BibTeX 等文件请放到对应目录：' + d.dir + '/ ，文件名建议用论文英文短名。可以用「图片素材」模块上传后手动放到该目录。' }),
      el('p', { class: 'small', text: d.cover ? `当前封面：${d.cover}` : '暂无封面（publications 列表里会显示默认样式）' })),
    d.otherKeys?.length ? section('其它字段（原样保留）', el('p', { class: 'muted small', text: d.otherKeys.join('、') })) : null,
  );
  ctx.markDirty(false);
}

async function saveCurrent() {
  const d = current;
  const res = await api('/api/publications/save', {
    method: 'POST',
    body: {
      path: d.path,
      title: d.title,
      authors: d.authors,
      author_notes: d.author_notes,
      date: d.date || undefined,
      publication: d.publication,
      publication_short: d.publication_short,
      publication_types: d.publication_types,
      abstract: d.abstract,
      summary: d.summary,
      tags: d.tags,
      featured: !!d.featured,
      links: (d.links ?? []).filter((l) => l.url),
      bib: d.bib,
      body: d.body,
    },
  });
  reportSave(res, { label: '论文已保存' });
  ctx.markDirty(false);
  ctx.reloadPreview(d.path.replace(/^content/, '').replace(/\/index\.md$/, '/'));
  await ctx.refreshStatus();
}

function dirty() { ctx.markDirty(true); }
