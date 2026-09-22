/**
 * 模块：新闻动态
 * 管理 content/blog/<目录>/index.md
 */

import {
  api, el, clear, input, section, toast, reportError, reportSave, confirmDialog, modal, spinner, linesField, imageField, insertAtCursor, today, pickImage, uploadFile, fmtSize, appendAll, mediaUrl,
} from '../core.js';

let ctx = null;
let root = null;
let mode = 'list';        // list | edit
let posts = [];
let current = null;       // 正在编辑的文章
let authorSlugs = [];

export default {
  id: 'news',
  label: '新闻动态',
  icon: '📰',
  group: '内容',
  previewPath: '/blog/',
  title: '新闻动态',
  desc: '发布实验室新闻、通知与动态。每篇新闻是 content/blog 下的一个文件夹，可上传封面图。草稿不会出现在正式网站上。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await refresh();
  },
};

async function refresh() {
  clear(root).append(spinner());
  try {
    const [data, people] = await Promise.all([api('/api/news'), api('/api/people')]);
    posts = data.posts;
    authorSlugs = people.authorSlugs ?? [];
  } catch (err) { reportError(err); return; }
  if (mode === 'edit' && current) renderEdit();
  else renderList();
}

/* ---------------- 列表 ---------------- */

function renderList() {
  clear(root);
  // 同一条新闻的中英文是两个文件，这里判断某条是否缺另一语言版本
  const langsOf = new Map();
  for (const p of posts) {
    if (!langsOf.has(p.slug)) langsOf.set(p.slug, new Set());
    langsOf.get(p.slug).add(p.lang);
  }
  const rows = posts.map((p) => el('tr', {},
    el('td', {},
      el('div', { style: 'font-weight:600' }, p.title || '(无标题)'),
      el('div', { class: 'muted small', text: p.summary || '' }),
      el('div', { class: 'row small', style: 'margin-top:4px' },
        el('span', { class: 'chip', text: p.lang === 'zh' ? '中文' : 'EN' }),
        p.draft ? el('span', { class: 'chip chip-warn', text: '草稿' }) : null,
        p.featured ? el('span', { class: 'chip', text: '置顶' }) : null,
        ...(p.tags ?? []).map((t) => el('span', { class: 'chip', text: t })))),
    el('td', { class: 'mono small', text: p.date || '' }),
    el('td', { class: 'small muted', text: p.cover ? '有封面' : '—' }),
    el('td', {},
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-ghost btn-sm', text: '编辑', onclick: () => openEdit(p.path) }),
        el('button', { class: 'btn btn-ghost btn-sm', text: '预览', onclick: () => ctx.reloadPreview(p.url) }),
        (langsOf.get(p.slug)?.size ?? 1) < 2
          ? el('button', {
            class: 'btn btn-ghost btn-sm',
            text: p.lang === 'zh' ? '＋ 英文版' : '＋ 中文版',
            onclick: () => addTranslation(p),
          })
          : null,
        el('button', {
          class: 'btn btn-danger btn-sm', text: '删除',
          onclick: () => confirmDialog('删除新闻', `确定删除「${p.title}」吗？文件会被移入回收站（.editor/trash），可以恢复。`, async () => {
            try {
              await api('/api/news/delete', { method: 'POST', body: { path: p.path } });
              toast('已移入回收站', 'ok');
              await refresh();
              await ctx.refreshStatus();
            } catch (err) { reportError(err); }
          }),
        })))));

  root.append(
    el('h1', { class: 'page-title' }, '新闻动态',
      el('span', { class: 'right' },
        el('button', { class: 'btn btn-primary', text: '+ 发布新闻', onclick: createDialog }))),
    el('p', { class: 'page-desc', text: '管理实验室新闻。每篇新闻可分别维护中文和英文两个版本（同一目录名，网址分别为 /blog/… 和 /zh/blog/…），网站右上角的语言按钮会自动互链。勾选「草稿」的内容不会出现在正式网站上。' }),
    posts.length
      ? el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {}, el('th', { text: '标题' }), el('th', { text: '日期' }), el('th', { text: '封面' }), el('th', { text: '操作' }))),
        el('tbody', {}, ...rows))
      : el('div', { class: 'empty', text: '还没有新闻，点右上角「+ 发布新闻」写第一篇。' }),
  );
}

function createDialog() {
  const titleF = el('input', { type: 'text', placeholder: '例如：团队在《Nature Communications》发表鸭基因组研究新成果' });
  const dateF = el('input', { type: 'date', value: today() });
  const slugF = el('input', { type: 'text', placeholder: '目录名，如 duck-genome-2026（留空自动生成）' });
  const summaryF = el('textarea', { rows: '2', placeholder: '一句话摘要（显示在列表里）' });
  const draftF = el('input', { type: 'checkbox', checked: true });
  const langF = el('select', {},
    el('option', { value: 'zh', text: '中文（/zh/blog/…）' }),
    el('option', { value: 'en', text: 'English（/blog/…）' }));
  modal({
    title: '发布新闻',
    wide: true,
    content: el('div', { class: 'stack' },
      el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '标题' }), titleF),
      el('div', { class: 'grid-2' },
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '日期' }), dateF),
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '语言' }), langF)),
      el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '目录名' }), slugF,
        el('span', { class: 'fld-hint', text: '只能用小写字母、数字、连字符；决定网址 /blog/<目录名>/。中英文两版共用同一个目录名。' })),
      el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '摘要' }), summaryF),
      el('label', { class: 'fld fld-check' }, draftF, el('span', { text: '先存为草稿（确认后再取消勾选发布）' }))),
    actions: [
      { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
      {
        label: '创建并编辑',
        onClick: async (c) => {
          try {
            const res = await api('/api/news/create', {
              method: 'POST',
              body: {
                title: titleF.value.trim() || '未命名新闻',
                slug: slugF.value.trim(),
                date: dateF.value,
                summary: summaryF.value.trim(),
                draft: draftF.checked,
                lang: langF.value,
              },
            });
            c();
            toast(`已创建 ${res.path}`, 'ok');
            await refresh();
            await openEdit(res.path);
            await ctx.refreshStatus();
          } catch (err) { reportError(err); }
        },
      },
    ],
  });
}

/** 给这条新闻补另一语言版本（复制 front matter，正文留空，默认草稿） */
async function addTranslation(p) {
  const other = p.lang === 'zh' ? '英文' : '中文';
  try {
    const res = await api('/api/news/translate', { method: 'POST', body: { path: p.path } });
    toast(`已创建${other}版：${res.path}`, 'ok', { timeout: 5000 });
    await refresh();
    await openEdit(res.path);
    await ctx.refreshStatus();
  } catch (err) { reportError(err); }
}

/* ---------------- 编辑 ---------------- */

async function openEdit(path) {
  clear(root).append(spinner());
  try {
    current = await api(`/api/news/doc?path=${encodeURIComponent(path)}`);
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

  const toolbar = el('div', { class: 'md-toolbar' },
    mdBtn('B', '加粗', () => insertAtCursor(bodyArea, '**', '**', '粗体')),
    mdBtn('I', '斜体', () => insertAtCursor(bodyArea, '*', '*', '斜体')),
    mdBtn('H2', '二级标题', () => insertAtCursor(bodyArea, '\n## ', '', '小标题')),
    mdBtn('•', '无序列表', () => insertAtCursor(bodyArea, '\n- ', '', '列表项')),
    mdBtn('1.', '有序列表', () => insertAtCursor(bodyArea, '\n1. ', '', '列表项')),
    mdBtn('🔗', '链接', () => {
      const url = prompt('链接地址：', 'https://');
      if (url) insertAtCursor(bodyArea, '[', `](${url})`, '链接文字');
    }),
    mdBtn('🖼', '插入图片（从素材库）', () => pickImage((p) => insertAtCursor(bodyArea, '![', `](${mediaUrl(p)})`, '图片说明'))),
    mdBtn('＋', '上传并插入图片', async () => {
      const inp = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
      document.body.append(inp);
      inp.onchange = async () => {
        const f = inp.files?.[0];
        inp.remove();
        if (!f) return;
        try {
          const res = await uploadFile(f);
          toast(`已上传 ${res.rel}${res.warnings?.length ? `（${res.warnings.join('；')}）` : ''}`, res.warnings?.length ? 'info' : 'ok', { timeout: 8000 });
          insertAtCursor(bodyArea, '![', `](${mediaUrl(res.frontMatterPath)})`, '图片说明');
        } catch (err) { reportError(err); }
      };
      inp.click();
    }),
    mdBtn('💡', '提示框', () => insertAtCursor(bodyArea, '\n> [!NOTE]\n> ', '', '提示内容')),
    mdBtn('𝕏', '分隔线 / 更多', () => insertAtCursor(bodyArea, '\n---\n', '', '')),
  );

  const coverBox = el('div');
  const renderCover = () => {
    clear(coverBox);
    appendAll(coverBox, el('div', { class: 'img-field' },
      d.cover ? el('img', { class: 'img-preview', src: withCoverUrl(d.cover), alt: '' }) : el('div', { class: 'img-preview' }),
      el('div', { class: 'img-field-main' },
        el('p', { class: 'muted small', text: d.cover ? `当前封面：${d.cover}` : '暂无封面（建议 16:9 或 1200×630 以上）' }),
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-ghost btn-sm', text: '上传封面…', onclick: () => pickCover(d, renderCover) }),
          d.cover ? el('button', {
            class: 'btn btn-danger btn-sm', text: '移除封面',
            onclick: async () => {
              try {
                await api(`/api/news/cover?path=${encodeURIComponent(d.path)}&remove=1`, {
                  method: 'POST', raw: new Blob([]), filename: 'x.jpg',
                });
                d.cover = '';
                renderCover();
                ctx.reloadPreview(postUrl(d));
                toast('已移除封面', 'ok');
              } catch (err) { reportError(err); }
            },
          }) : null))));
  };
  renderCover();

  appendAll(root, 
    el('div', { class: 'row', style: 'margin-bottom:8px' },
      el('button', { class: 'btn btn-ghost btn-sm', text: '← 返回列表', onclick: async () => { mode = 'list'; current = null; await refresh(); } }),
      el('span', { class: 'muted small mono', text: d.path })),
    el('h1', { class: 'page-title' }, '编辑新闻'),
    section('基本信息',
      input({ label: '标题', value: d.title ?? '', onInput: (v) => { d.title = v; dirty(); } }),
      el('div', { class: 'grid-2' },
        input({ label: '日期', type: 'date', value: d.date ?? '', onInput: (v) => { d.date = v; dirty(); } }),
        input({ label: '摘要', value: d.summary ?? '', hint: '显示在新闻列表和搜索引擎结果里', onInput: (v) => { d.summary = v; dirty(); } })),
      el('div', { class: 'grid-2' },
        linesField({ label: '标签', value: d.tags ?? [], rows: 3, onChange: (v) => { d.tags = v; dirty(); } }),
        linesField({
          label: '作者（作者页目录名）', value: d.authors ?? [], rows: 3, hint: '可留空；填了会自动链接到成员页',
          onChange: (v) => { d.authors = v; dirty(); },
        })),
      el('div', { class: 'row' },
        el('label', { class: 'fld fld-check' }, el('input', {
          type: 'checkbox', checked: !!d.draft, onchange: (e) => { d.draft = e.target.checked; dirty(); },
        }), el('span', { text: '草稿（不发布到网站）' })),
        el('label', { class: 'fld fld-check' }, el('input', {
          type: 'checkbox', checked: !!d.featured, onchange: (e) => { d.featured = e.target.checked; dirty(); },
        }), el('span', { text: '在列表中突出显示' })))),
    section('封面图', coverBox),
    el('section', { class: 'card' },
      el('h3', { class: 'card-title' }, '正文（Markdown）',
        el('span', { class: 'card-actions' },
          el('button', { class: 'btn btn-ghost btn-sm', text: '保存并预览', onclick: async () => { await saveCurrent(); ctx.reloadPreview(postUrl(d)); } }))),
      toolbar,
      bodyArea,
      el('p', { class: 'muted small', text: '支持 Markdown：**加粗**、## 小标题、- 列表、[链接](网址)、![图片](路径)、> [!NOTE] 提示框。空行分段。' })),
    d.otherKeys?.length ? section('其它字段（原样保留）',
      el('p', { class: 'muted small', text: d.otherKeys.join('、') })) : null,
  );
  ctx.markDirty(false);
}

function withCoverUrl(rel) {
  // rel 形如 content/blog/<slug>/featured.jpg
  // 站点里对应地址是 <basePath>blog/<slug>/featured.jpg
  const cleaned = String(rel).replace(/\\/g, '/').replace(/^content\//, '');
  return cleaned ? ctx.basePath() + cleaned : '';
}

function pickCover(d, rerender) {
  const inp = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  document.body.append(inp);
  inp.onchange = async () => {
    const f = inp.files?.[0];
    inp.remove();
    if (!f) return;
    try {
      const res = await api(`/api/news/cover?path=${encodeURIComponent(d.path)}`, { method: 'POST', raw: f, filename: f.name });
      d.cover = res.cover;
      rerender();
      toast(`封面已更新：${res.cover}（需点「保存」记录其它字段改动）`, 'ok', { timeout: 7000 });
      ctx.reloadPreview(postUrl(d));
    } catch (err) { reportError(err); }
  };
  inp.click();
}

function postUrl(d) {
  const slug = String(d.path).replace(/^content\/blog\//, '').replace(/\/index(\.zh)?\.md$/, '');
  return (d.lang === 'zh' ? '/zh/blog/' : '/blog/') + slug + '/';
}

function mdBtn(label, title, onClick) {
  return el('button', { type: 'button', class: 'btn btn-ghost btn-sm', title, text: label, onclick: onClick });
}

async function saveCurrent() {
  const d = current;
  const res = await api('/api/news/save', {
    method: 'POST',
    body: {
      path: d.path,
      title: d.title,
      date: d.date || undefined,
      summary: d.summary,
      authors: d.authors,
      tags: d.tags,
      draft: !!d.draft,
      featured: !!d.featured,
      body: d.body,
    },
  });
  reportSave(res, { label: '新闻已保存' });
  ctx.markDirty(false);
  ctx.reloadPreview(postUrl(d));
  await ctx.refreshStatus();
}

function dirty() { ctx.markDirty(true); }
