/**
 * 模块：成员个人主页
 * ------------------------------------------------------------------
 * 一份「个人主页」由三部分组成（主题实际读取位置）：
 *   data/authors/<slug>.yaml          资料：姓名、职位、简介、研究兴趣、链接、单位、教育
 *   assets/media/authors/<slug>.<ext> 头像
 *   content/authors/<slug>/_index.md  页面标题
 */

import {
  api, el, clear, input, section, toast, reportError, reportSave, confirmDialog, modal, spinner, linesField, fmtSize, iconBtn, imageField, appendAll,
} from '../core.js';

let ctx = null;
let root = null;
let list = [];
let doc = null;        // 当前编辑的个人主页
let filter = '';
const state = { oversized: [] };

/**
 * 自定义模块可用的布局。
 * 初始值只是兜底，真实清单由 /api/profiles 返回（与模板 author_custom_sections.html 一致）。
 */
let layouts = [
  { value: 'list', label: '列表', desc: '一行一条，适合论文/专利清单', hasItems: true },
  { value: 'cards', label: '卡片', desc: '带图/标签的卡片网格，适合自研工具、项目', hasItems: true },
  { value: 'timeline', label: '时间线', desc: '按时间排列，适合经历、获奖、专利', hasItems: true },
  { value: 'links', label: '链接按钮', desc: '一排按钮，适合常用网址、软件下载', hasItems: true },
  { value: 'gallery', label: '图片墙', desc: '图片网格，适合截图、样品照片', hasItems: true },
  { value: 'markdown', label: '自由文字', desc: '一段 Markdown 文字，可含标题、列表、图片', hasItems: false },
  { value: 'publications', label: '自动列出论文', desc: '自动抓取 content/publications 里作者包含本成员的条目', hasItems: false },
];
const layoutMeta = (v) => layouts.find((x) => x.value === v) ?? layouts[0];

const LINK_ICONS = [
  ['envelope', '邮箱'], ['github', 'GitHub'], ['orcid', 'ORCID'], ['linkedin', 'LinkedIn'],
  ['x-twitter', 'X / Twitter'], ['graduation-cap', 'Google Scholar'], ['globe', '个人网站'],
  ['researchgate', 'ResearchGate'], ['weixin', '微信'], ['phone', '电话'], ['link', '其它链接'],
];

export default {
  id: 'profiles',
  label: '个人主页',
  icon: '🧑‍🔬',
  group: '内容',
  previewPath: '/authors/',
  title: '成员个人主页',
  desc: '编辑每位成员的个人主页：头像、职位、简介、研究兴趣、常用链接、所属单位与教育经历。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await refresh();
  },
};

async function refresh(slug) {
  clear(root).append(spinner());
  try {
    const data = await api('/api/profiles');
    list = data.items;
    state.oversized = data.oversizedAvatars ?? [];
    if (Array.isArray(data.layouts) && data.layouts.length) layouts = data.layouts;
  } catch (err) { reportError(err); return; }
  if (slug) {
    doc = await api(`/api/profiles/doc?slug=${encodeURIComponent(slug)}`);
    renderEdit();
  } else {
    doc = null;
    renderList();
  }
}

/* ------------------------------------------------------------------ */
/* 列表                                                               */
/* ------------------------------------------------------------------ */

function renderList() {
  clear(root);
  const keyword = filter.trim().toLowerCase();
  const shown = list.filter((p) => !keyword
    || p.slug.includes(keyword)
    || String(p.display).toLowerCase().includes(keyword)
    || String(p.role).toLowerCase().includes(keyword));

  const missing = list.filter((p) => !p.hasData || !p.hasPage);

  appendAll(root, 
    el('h1', { class: 'page-title' }, '成员个人主页',
      el('span', { class: 'right row' },
        el('button', { class: 'btn btn-primary', text: '+ 新建个人主页', onclick: createDialog }))),
    el('p', { class: 'page-desc', text: '每位成员的个人主页由资料文件（data/authors）、头像（assets/media/authors）和页面标题三部分组成，这里可以一起编辑。' }),

    state.oversized.length
      ? el('div', { class: 'notice notice-warn' },
        el('p', { text: `有 ${state.oversized.length} 张头像体积过大，会随仓库提交并拖慢网页加载：` }),
        el('ul', {}, ...state.oversized.map((a) => el('li', { text: `${a.name}　${fmtSize(a.size)}` }))),
        el('p', { class: 'muted small', text: '页面上头像只显示 160px，压缩到 600×600、300KB 以内即可。可以在对应成员的主页里重新上传。' }))
      : null,

    missing.length
      ? el('div', { class: 'notice notice-warn' },
        el('p', { text: `以下成员还没有完整的个人主页：${missing.map((m) => m.slug).join('、')}` }),
        el('p', { class: 'muted small', text: '在「成员与导师」里勾选「保存时自动创建缺失的个人主页」即可补齐。' }))
      : el('div', { class: 'notice notice-ok' }, el('p', { text: '所有成员的个人主页都已就绪。' })),

    el('div', { class: 'row', style: 'margin-bottom:12px' },
      el('input', {
        type: 'search', placeholder: '搜索姓名 / 目录名 / 职位…', value: filter,
        style: 'max-width:280px',
        oninput: (e) => { filter = e.target.value; renderList(); },
      }),
      el('span', { class: 'muted small', text: `共 ${list.length} 位成员` })),

    el('div', { class: 'grid-3' }, ...shown.map(profileCard)),
  );
  ctx.markDirty(false);
}

function profileCard(p) {
  return el('div', { class: 'card', style: 'margin:0;cursor:pointer', onclick: () => refresh(p.slug) },
    el('div', { class: 'row', style: 'align-items:center;gap:12px' },
      p.avatar
        ? el('img', { src: `${ctx.basePath()}${p.avatar.rel.replace(/^assets\//, '')}`, alt: p.display, style: 'width:56px;height:56px;object-fit:cover;border-radius:50%;border:1px solid var(--border)' })
        : el('div', { style: 'width:56px;height:56px;border-radius:50%;background:#eef2f7;display:flex;align-items:center;justify-content:center;color:#9aa4b2;font-size:22px' }, '👤'),
      el('div', { style: 'flex:1;min-width:0' },
        el('div', { style: 'font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, p.display || p.slug),
        el('div', { class: 'muted small', text: p.role || '（未填写职位）' }),
        el('div', { class: 'row small', style: 'margin-top:4px' },
          p.group ? el('span', { class: 'chip', text: p.group }) : null,
          !p.hasData ? el('span', { class: 'chip chip-warn', text: '无资料文件' }) : null,
          !p.hasPage ? el('span', { class: 'chip chip-warn', text: '无页面' }) : null,
          p.avatarWarning ? el('span', { class: 'chip chip-warn', text: '头像过大' }) : null))),
  );
}

/* ------------------------------------------------------------------ */
/* 编辑                                                               */
/* ------------------------------------------------------------------ */

function renderEdit() {
  clear(root);
  const d = doc;
  const p = d.profile;

  const avatarBox = el('div');
  const renderAvatar = () => {
    clear(avatarBox);
    appendAll(avatarBox, el('div', { class: 'img-field' },
      doc.avatar
        ? el('img', { class: 'img-preview', src: `${ctx.basePath()}${doc.avatar.rel.replace(/^assets\//, '')}`, alt: '' })
        : el('div', { class: 'img-preview' }),
      el('div', { class: 'img-field-main' },
        el('p', { class: 'muted small', text: doc.avatar
          ? `当前头像：${doc.avatar.rel}（${fmtSize(doc.avatar.size)}）`
          : '暂无头像（未上传时页面显示默认图标）' }),
        doc.avatarWarning ? el('p', { class: 'small', style: 'color:var(--amber)' }, doc.avatarWarning) : null,
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-ghost btn-sm', text: doc.avatar ? '更换头像…' : '上传头像…', onclick: () => pickAvatar(d, renderAvatar) }),
          doc.avatar ? el('button', {
            class: 'btn btn-danger btn-sm', text: '移除头像',
            onclick: () => confirmDialog('移除头像', '头像文件会被移入回收站（.editor/trash），可以恢复。确定吗？', async () => {
              try {
                await api(`/api/profiles/avatar?slug=${encodeURIComponent(d.slug)}&remove=1`, { method: 'POST', raw: new Blob([]), filename: 'x.jpg' });
                doc.avatar = null;
                doc.avatarWarning = null;
                renderAvatar();
                toast('已移除头像', 'ok');
              } catch (err) { reportError(err); }
            }),
          }) : null,
          el('span', { class: 'muted small', text: '建议 600×600 以内、300KB 以内' }))),
      doc.avatar ? avatarCropBox(p) : null));
  };
  renderAvatar();

  appendAll(root, 
    el('div', { class: 'row', style: 'margin-bottom:8px' },
      el('button', { class: 'btn btn-ghost btn-sm', text: '← 返回列表', onclick: () => refresh() }),
      el('span', { class: 'muted small mono', text: `data/authors/${d.slug}.yaml` }),
      el('span', { class: 'right row' },
        el('button', { class: 'btn btn-ghost btn-sm', text: '查看页面', onclick: () => ctx.reloadPreview(`/authors/${d.slug}/`) }))),
    el('h1', { class: 'page-title' }, p.display || d.slug),

    !d.hasData ? el('div', { class: 'notice notice-warn' }, el('p', { text: '这位成员还没有资料文件，保存后会创建 data/authors/' + d.slug + '.yaml。' })) : null,
    !d.hasPage ? el('div', { class: 'notice notice-warn' }, el('p', { text: '这位成员还没有页面文件，保存后会创建 content/authors/' + d.slug + '/_index.md。' })) : null,

    section('头像', avatarBox),

    section('基本信息',
      el('div', { class: 'grid-2' },
        input({ label: '显示姓名', value: p.display ?? '', hint: '显示在个人主页标题、论文作者等处', onInput: (v) => { p.display = v; dirty(); } }),
        input({ label: '职位 / 身份', value: p.role ?? '', hint: '例如 Ph.D. Student、Associate Professor', onInput: (v) => { p.role = v; dirty(); } }),
        input({ label: '名 (given)', value: p.given ?? '', hint: '可留空；填写后用于按姓/名排序', onInput: (v) => { p.given = v; dirty(); } }),
        input({ label: '姓 (family)', value: p.family ?? '', hint: '可留空', onInput: (v) => { p.family = v; dirty(); } })),
      input({ label: '简介', rows: 5, value: p.bio ?? '', hint: '显示在个人主页姓名下方，2~4 句即可', onInput: (v) => { p.bio = v; dirty(); } }),
      el('div', { class: 'grid-2' },
        input({ label: '页面标题', value: d.pageTitle ?? '', hint: '浏览器标签上显示的文字，通常与姓名一致', onInput: (v) => { d.pageTitle = v; dirty(); } }),
        input({ label: '状态图标', value: p.statusIcon ?? '', hint: '可留空；填 emoji 会显示在姓名旁，例如 🎓', onInput: (v) => { p.statusIcon = v; dirty(); } }))),

    section('研究兴趣',
      linesField({ label: '研究兴趣', value: p.interests ?? [], rows: 4, onChange: (v) => { p.interests = v; dirty(); } })),

    section('常用链接',
      el('p', { class: 'muted small', text: '例如邮箱、GitHub、ORCID、Google Scholar。显示名称留空时用链接地址代替。' }),
      linksEditor(p, () => renderEdit())),

    section('所属单位',
      itemsEditor({
        items: p.affiliations,
        create: () => ({ name: '', url: '' }),
        title: (a, i) => a?.name || `单位 ${i + 1}`,
        render: (a) => el('div', { class: 'grid-2' },
          input({ label: '单位名称', value: a.name ?? '', onInput: (v) => { a.name = v; dirty(); } }),
          input({ label: '单位网址（可选）', value: a.url ?? '', onInput: (v) => { a.url = v; dirty(); } })),
        addLabel: '添加单位',
        onChange: (v) => { p.affiliations = v; dirty(); },
      })),

    section('教育经历',
      itemsEditor({
        items: p.education,
        create: () => ({ degree: '', institution: '', year: '' }),
        title: (e, i) => e?.institution || `经历 ${i + 1}`,
        render: (e) => el('div', {},
          el('div', { class: 'grid-2' },
            input({ label: '学位', value: e.degree ?? '', hint: '例如 Bachelor of Agriculture', onInput: (v) => { e.degree = v; dirty(); } }),
            input({ label: '时间', value: e.year ?? '', hint: '例如 2024 - Present', onInput: (v) => { e.year = v; dirty(); } })),
          input({ label: '学校 / 院系', value: e.institution ?? '', onInput: (v) => { e.institution = v; dirty(); } })),
        addLabel: '添加教育经历',
        onChange: (v) => { p.education = v; dirty(); },
      })),

    section('自定义模块',
      el('p', { class: 'muted small', text: '在基本信息下方追加任意模块，例如「我开发的工具」「已发表论文/专利」「项目经历」。每个模块可单独选择布局，顺序即页面上的显示顺序。' }),
      sectionsEditor(p)),

    section('其它',
      el('label', { class: 'fld fld-check' },
        el('input', { type: 'checkbox', checked: !!p.isOwner, onchange: (e) => { p.isOwner = e.target.checked; dirty(); } }),
        el('span', { text: '这是团队主页（is_owner）' }),
        el('span', { class: 'fld-hint', text: '用于站点的「负责人」标识，普通成员不要勾选' })),
      el('div', { class: 'grid-2' },
        input({ label: '代词', value: p.pronouns ?? '', hint: '可留空', onInput: (v) => { p.pronouns = v; dirty(); } }),
        input({ label: '排序权重', value: String(p.weight ?? ''), hint: '可留空；数字越小越靠前', onInput: (v) => { p.weight = v; dirty(); } })),
      d.preservedFields?.length
        ? el('p', { class: 'muted small', text: `该成员资料里还有这些字段会原样保留（本页不修改）：${d.preservedFields.join('、')}` })
        : null),

    d.otherKeys?.length
      ? section('未识别的字段（原样保留）', el('p', { class: 'muted small', text: d.otherKeys.join('、') }))
      : null,

    section('危险操作',
      el('p', { class: 'muted small', text: '删除会移入回收站（.editor/trash），可以从「高级工具 → 回收站」恢复。' }),
      el('button', { class: 'btn btn-danger', text: '删除这位成员的个人主页…', onclick: () => deleteDialog(d) })),
  );
  ctx.markDirty(false);
  ctx.setPreview(`/authors/${d.slug}/`);
  ctx.registerSave(save);
}

/* ---------------- 自定义模块编辑器 ---------------- */

function sectionsEditor(p) {
  const box = el('div', { class: 'stack' });
  const draw = () => {
    clear(box);
    const arr = p.sections ?? (p.sections = []);
    arr.forEach((sec, i) => box.append(sectionCard(arr, sec, i, draw)));
    if (!arr.length) {
      box.append(el('p', { class: 'muted', text: '还没有自定义模块。点下面「+ 添加模块」可以加入「我开发的工具」「已发表论文」「专利」等内容。' }));
    }
  };
  draw();
  return el('div', {}, box,
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { class: 'btn btn-primary btn-sm', text: '+ 添加模块', onclick: () => addSectionDialog(p, draw) }),
      el('span', { class: 'muted small', text: '顺序即页面上的显示顺序，用 ↑ ↓ 调整' })));
}

function sectionCard(sections, sec, i, redraw) {
  const meta = layoutMeta(sec.layout);
  const titleBtn = el('button', {
    type: 'button', class: 'list-item-title',
    onclick: () => card.classList.toggle('open'),
  }, sec.title || '未命名模块');

  const body = el('div', { class: 'list-item-body' }, el('div', { class: 'stack' },
    el('div', { class: 'grid-2' },
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '模块标题' }),
        el('input', {
          type: 'text', value: sec.title ?? '',
          oninput: (e) => { sec.title = e.target.value; titleBtn.textContent = sec.title || '未命名模块'; dirty(); },
        })),
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '布局' }),
        el('select', {
          onchange: (e) => {
            sec.layout = e.target.value;
            const m = layoutMeta(sec.layout);
            if (m.hasItems && !Array.isArray(sec.items)) sec.items = [];
            if ((sec.layout === 'cards' || sec.layout === 'gallery') && !sec.columns) sec.columns = 3;
            dirty();
            redraw();
          },
        }, ...layouts.map((L) => el('option', { value: L.value, selected: sec.layout === L.value }, L.label))),
        el('span', { class: 'fld-hint', text: meta.desc }))),
    el('div', { class: 'grid-2' },
      input({ label: '副标题（可选）', value: sec.subtitle ?? '', onInput: (v) => { sec.subtitle = v; dirty(); } }),
      (sec.layout === 'cards' || sec.layout === 'gallery')
        ? el('label', { class: 'fld' },
          el('span', { class: 'fld-label', text: '每行列数' }),
          el('select', { onchange: (e) => { sec.columns = Number(e.target.value); dirty(); } },
            ...[1, 2, 3, 4].map((n) => el('option', { value: String(n), selected: Number(sec.columns ?? 3) === n }, `${n} 列`))))
        : null),
    input({
      label: '说明文字（可选，支持 Markdown）', rows: 3, value: sec.text ?? '',
      hint: '显示在模块标题下方', onInput: (v) => { sec.text = v; dirty(); },
    }),
    el('label', { class: 'fld fld-check' },
      el('input', { type: 'checkbox', checked: !!sec.collapse, onchange: (e) => { sec.collapse = e.target.checked; dirty(); } }),
      el('span', { text: '默认折叠（点击标题展开）' })),

    sec.layout === 'publications'
      ? el('div', { class: 'notice' },
        el('p', { text: '这个模块会自动列出 content/publications 里「作者包含本成员目录名」的论文，不需要手动维护条目。' }),
        el('p', { class: 'muted small', text: `本成员的目录名：${doc?.slug ?? ''}（论文条目的 authors 列表里要有这个值）` }))
      : null,

    meta.hasItems ? sectionItems(sec) : null,
  ));

  const card = el('div', { class: 'list-item open' },
    el('div', { class: 'list-item-head' },
      titleBtn,
      el('span', { class: 'chip', text: meta.label }),
      el('div', { class: 'list-item-actions' },
        iconBtn('↑', '上移', () => { if (i > 0) { const t = sections[i - 1]; sections[i - 1] = sections[i]; sections[i] = t; redraw(); dirty(); } }),
        iconBtn('↓', '下移', () => { if (i < sections.length - 1) { const t = sections[i + 1]; sections[i + 1] = sections[i]; sections[i] = t; redraw(); dirty(); } }),
        iconBtn('复制', '复制该模块', () => { sections.splice(i + 1, 0, structuredClone(sec)); redraw(); dirty(); }),
        iconBtn('✕', '删除该模块', () => confirmDialog('删除模块', `确定删除模块「${sec.title}」及其条目吗？（保存后生效，可从备份恢复）`, () => { sections.splice(i, 1); redraw(); dirty(); }), 'danger'))),
    body);
  return card;
}

/* ---------------- 模块内的条目 ---------------- */

function sectionItems(sec) {
  const box = el('div', { class: 'stack' });
  const draw = () => {
    clear(box);
    const items = sec.items ?? (sec.items = []);
    items.forEach((it, i) => box.append(itemCard(sec, it, i, draw)));
    if (!items.length) box.append(el('p', { class: 'muted small', text: '还没有条目：可以逐条添加，也可以「批量粘贴」' }));
  };
  draw();
  return el('div', { style: 'border-top:1px dashed var(--border);padding-top:12px' },
    el('p', { class: 'fld-label', text: '模块内容' }),
    box,
    el('div', { class: 'row', style: 'margin-top:8px' },
      el('button', {
        class: 'btn btn-ghost btn-sm', text: '+ 添加条目',
        onclick: () => {
          sec.items = sec.items ?? [];
          sec.items.push(sec.layout === 'gallery' ? { title: '', image: '' } : { title: '', url: '' });
          draw();
          dirty();
        },
      }),
      el('button', { class: 'btn btn-ghost btn-sm', text: '批量粘贴…', onclick: () => bulkItemsDialog(sec, draw) }),
      el('span', { class: 'muted small', text: `共 ${(sec.items ?? []).length} 条` })));
}

function itemCard(sec, it, i, redraw) {
  const head = el('button', { type: 'button', class: 'list-item-title', onclick: () => card.classList.toggle('open') },
    it.title || it.image || `条目 ${i + 1}`);
  const isImageItem = sec.layout === 'gallery';
  const body = el('div', { class: 'list-item-body' }, el('div', { class: 'stack' },
    el('div', { class: 'grid-2' },
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '标题' }),
        el('input', {
          type: 'text', value: it.title ?? '',
          oninput: (e) => { it.title = e.target.value; head.textContent = it.title || `条目 ${i + 1}`; dirty(); },
        })),
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: isImageItem ? '说明（可选）' : '副标题 / 说明（可选）' }),
        el('input', { type: 'text', value: it.subtitle ?? '', oninput: (e) => { it.subtitle = e.target.value; dirty(); } }))),
    el('div', { class: 'grid-2' },
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '右侧信息（可选）' }),
        el('input', { type: 'text', value: it.meta ?? '', placeholder: '例如 2025 / v1.2 / 已授权', oninput: (e) => { it.meta = e.target.value; dirty(); } })),
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '链接（可选）' }),
        el('input', { type: 'text', value: it.url ?? '', placeholder: 'https://…', oninput: (e) => { it.url = e.target.value; dirty(); } }))),
    imageField({
      label: '配图（可选）', value: it.image ?? '',
      hint: '卡片与图片墙布局会显示；建议宽度 1200px 以内',
      onChange: (v) => { it.image = v; dirty(); },
    }),
    input({ label: '详细说明（可选）', rows: 2, value: it.text ?? '', onInput: (v) => { it.text = v; dirty(); } }),
    linesField({ label: '标签（可选）', value: it.tags ?? [], rows: 2, onChange: (v) => { it.tags = v; dirty(); } }),
  ));

  const card = el('div', { class: 'list-item' },
    el('div', { class: 'list-item-head' },
      head,
      el('div', { class: 'list-item-actions' },
        iconBtn('↑', '上移', () => { if (i > 0) { const t = sec.items[i - 1]; sec.items[i - 1] = sec.items[i]; sec.items[i] = t; redraw(); dirty(); } }),
        iconBtn('↓', '下移', () => { if (i < sec.items.length - 1) { const t = sec.items[i + 1]; sec.items[i + 1] = sec.items[i]; sec.items[i] = t; redraw(); dirty(); } }),
        iconBtn('复制', '复制条目', () => { sec.items.splice(i + 1, 0, structuredClone(it)); redraw(); dirty(); }),
        iconBtn('✕', '删除条目', () => { sec.items.splice(i, 1); redraw(); dirty(); }, 'danger'))),
    body);
  return card;
}

function bulkItemsDialog(sec, redraw) {
  const ta = el('textarea', {
    rows: '10',
    placeholder: '每行一条。\n一整行会作为标题，例如：\nHou Z, An L, Han J. Revolutionize livestock breeding in the future. J ANIM SCI BIOTECHNO. 2018.\n\n也可以用 | 分隔字段：\n标题 | 副标题 | 时间 | 链接\n或用 Markdown 链接：[标题](https://…)',
  });
  modal({
    title: '批量粘贴条目',
    wide: true,
    content: el('div', { class: 'stack' },
      el('p', { class: 'muted', text: '适合一次粘贴多年的论文、专利清单。行首的 -、*、· 会自动去掉。' }),
      ta),
    actions: [
      { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
      {
        label: '导入',
        onClick: (c) => {
          const lines = ta.value.replace(/\r\n?/g, '\n').split('\n')
            .map((l) => l.replace(/^\s*[-*·]\s*/, '').trim()).filter(Boolean);
          if (!lines.length) { toast('没有可导入的内容', 'info'); return; }
          sec.items = sec.items ?? [];
          for (const line of lines) {
            const md = /^\[(.+?)\]\((.+?)\)$/.exec(line);
            if (md) { sec.items.push({ title: md[1], url: md[2] }); continue; }
            const parts = line.split('|').map((x) => x.trim());
            if (parts.length > 1) {
              const [title, subtitle, metaText, url] = parts;
              const item = { title };
              if (subtitle) item.subtitle = subtitle;
              if (metaText) item.meta = metaText;
              if (url) item.url = url;
              sec.items.push(item);
            } else {
              sec.items.push({ title: line });
            }
          }
          c();
          redraw();
          dirty();
          toast(`已导入 ${lines.length} 条（记得点「保存」）`, 'ok');
        },
      },
    ],
  });
}

function addSectionDialog(p, redraw) {
  const nameF = el('input', { type: 'text', placeholder: '例如：我开发的工具' });
  const layoutF = el('select', {}, ...layouts.map((L) => el('option', { value: L.value }, `${L.label} —— ${L.desc}`)));
  modal({
    title: '添加自定义模块',
    wide: true,
    content: el('div', { class: 'stack' },
      el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '模块标题' }), nameF),
      el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '布局' }), layoutF,
        el('span', { class: 'fld-hint', text: '添加后随时可以改布局，内容不会丢' }))),
    actions: [
      { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
      {
        label: '添加',
        onClick: (c) => {
          p.sections = p.sections ?? [];
          const layout = layoutF.value;
          const sec = { title: nameF.value.trim() || '新模块', layout };
          if (layoutMeta(layout).hasItems) sec.items = [];
          if (layout === 'cards' || layout === 'gallery') sec.columns = 3;
          p.sections.push(sec);
          c();
          redraw();
          dirty();
        },
      },
    ],
  });
}

/* ---------------- 链接编辑器 ---------------- */

function linksEditor(p, rerender) {
  const box = el('div');
  const render = () => {
    clear(box);
    (p.links ?? []).forEach((l, i) => {
      box.append(el('div', { class: 'row', style: 'margin-bottom:6px;align-items:flex-start' },
        el('select', {
          style: 'width:150px',
          onchange: (e) => { l.icon = e.target.value; dirty(); },
        }, ...LINK_ICONS.map(([v, label]) => el('option', { value: v, selected: l.icon === v }, label))),
        el('div', { style: 'flex:1' },
          el('input', {
            type: 'text', value: l.url ?? '', placeholder: 'https://… 或 mailto:…', style: 'width:100%;margin-bottom:4px',
            oninput: (e) => { l.url = e.target.value; dirty(); },
          }),
          el('div', { class: 'row' },
            el('input', {
              type: 'text', value: l.label ?? '', placeholder: '名称（如 GitHub）', style: 'width:45%',
              oninput: (e) => { l.label = e.target.value; dirty(); },
            }),
            el('input', {
              type: 'text', value: l.display ?? '', placeholder: '显示文字（可留空）', style: 'flex:1',
              oninput: (e) => { l.display = e.target.value; dirty(); },
            }))),
        iconBtn('↑', '上移', () => { if (i > 0) { const t = p.links[i - 1]; p.links[i - 1] = p.links[i]; p.links[i] = t; render(); dirty(); } }),
        iconBtn('↓', '下移', () => { if (i < p.links.length - 1) { const t = p.links[i + 1]; p.links[i + 1] = p.links[i]; p.links[i] = t; render(); dirty(); } }),
        iconBtn('✕', '删除', () => { p.links.splice(i, 1); render(); dirty(); }, 'danger')));
    });
    if (!(p.links ?? []).length) box.append(el('p', { class: 'muted small', text: '暂无链接' }));
  };
  render();
  const wrap = el('div', {},
    box,
    el('div', { class: 'row', style: 'margin-top:6px' },
      el('button', { class: 'btn btn-ghost btn-sm', text: '+ 添加链接', onclick: () => { p.links = p.links ?? []; p.links.push({ icon: 'link', url: '', label: '', display: '' }); render(); dirty(); } }),
      el('button', {
        class: 'btn btn-ghost btn-sm', text: '从成员名单带入邮箱…',
        onclick: async () => {
          try {
            const people = await api('/api/people');
            let email = '';
            for (const g of people.groups ?? []) {
              for (const m of g.members ?? []) if (m.slug === doc.slug && m.email) email = m.email;
            }
            email = email || people.pi?.email || '';
            if (!email) { toast('没有找到该成员的邮箱，请手动填写', 'info'); return; }
            if (email === people.pi?.email && people.pi?.name && !doc.slug) { /* 忽略 */ }
            p.links = p.links ?? [];
            p.links.push({ icon: 'envelope', url: `mailto:${email}`, label: 'E-mail', display: email });
            render();
            dirty();
            toast(`已添加邮箱链接：${email}`, 'ok');
          } catch (err) { reportError(err); }
        },
      })));
  return wrap;
}

/* ---------------- 通用小列表编辑器（单位 / 教育） ---------------- */

function itemsEditor({ items, render, create, title, addLabel, onChange }) {
  const box = el('div');
  const draw = () => {
    clear(box);
    const arr = items;
    arr.forEach((item, i) => {
      box.append(el('div', { class: 'list-item open' },
        el('div', { class: 'list-item-head' },
          el('span', { class: 'list-item-title', text: title(item, i) }),
          el('div', { class: 'list-item-actions' },
            iconBtn('↑', '上移', () => { if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; draw(); onChange(arr); } }),
            iconBtn('↓', '下移', () => { if (i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; draw(); onChange(arr); } }),
            iconBtn('✕', '删除', () => { arr.splice(i, 1); draw(); onChange(arr); }, 'danger'))),
        el('div', { class: 'list-item-body' }, render(item, i))));
    });
    if (!arr.length) box.append(el('p', { class: 'muted small', text: '暂无内容' }));
  };
  draw();
  return el('div', {}, box, el('button', {
    class: 'btn btn-ghost btn-sm', style: 'margin-top:6px', text: `+ ${addLabel}`,
    onclick: () => { items.push(create()); draw(); onChange(items); },
  }));
}

/* ---------------- 圆形头像的裁剪位置 ---------------- */

/**
 * 拖动滑块调整圆形头像取景。
 * 页面上图片按原比例缩放，再用 CSS object-position 决定圆心落在原图的哪个位置，
 * 所以可以自由上下左右移，直到脸完整露出来。
 */
function avatarCropBox(p) {
  const [x0, y0] = parseAvatarPosition(p.avatarPosition);
  const url = `${ctx.basePath()}${doc.avatar.rel.replace(/^assets\//, '')}`;
  const preview = el('img', {
    src: url,
    alt: '',
    style: 'width:128px;height:128px;flex:0 0 auto;object-fit:cover;border-radius:50%;'
      + `border:1px solid var(--border);background:#fff;object-position:${x0}% ${y0}%`,
  });
  const label = el('span', { class: 'muted small', text: `左右 ${x0}% · 上下 ${y0}%` });
  const apply = () => {
    const v = `${rangeX.value}% ${rangeY.value}%`;
    preview.style.objectPosition = v;
    p.avatarPosition = v;
    label.textContent = `左右 ${rangeX.value}% · 上下 ${rangeY.value}%`;
    dirty();
  };
  const rangeX = el('input', {
    type: 'range', min: '0', max: '100', step: '1', value: String(x0),
    style: 'width:100%', oninput: apply,
  });
  const rangeY = el('input', {
    type: 'range', min: '0', max: '100', step: '1', value: String(y0),
    style: 'width:100%', oninput: apply,
  });
  const preset = (x, y) => { rangeX.value = String(x); rangeY.value = String(y); apply(); };
  return el('div', { style: 'margin-top:12px;border-top:1px dashed var(--border);padding-top:12px' },
    el('p', { class: 'fld-label', text: '圆形裁剪位置' }),
    el('div', { class: 'row', style: 'align-items:flex-start;gap:16px' },
      preview,
      el('div', { style: 'flex:1 1 auto;min-width:220px' },
        el('label', { class: 'fld' },
          el('span', { class: 'fld-label', text: '左右' }), rangeX),
        el('label', { class: 'fld' },
          el('span', { class: 'fld-label', text: '上下（脸偏上就把滑块往下拖）' }), rangeY),
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-ghost btn-sm', text: '偏上', onclick: () => preset(50, 20) }),
          el('button', { class: 'btn btn-ghost btn-sm', text: '居中', onclick: () => preset(50, 50) }),
          el('button', { class: 'btn btn-ghost btn-sm', text: '偏下', onclick: () => preset(50, 80) }),
          el('button', { class: 'btn btn-ghost btn-sm', text: '重置', onclick: () => preset(50, 50) })),
        label,
        el('p', { class: 'muted small', text: '只改变圆形取景范围，不改动原图；保存后个人主页立即生效。' }))));
}

function parseAvatarPosition(v) {
  const m = /^(\d{1,3})%\s+(\d{1,3})%$/.exec(String(v ?? '').trim());
  if (!m) return [50, 50];
  return [Math.min(100, Number(m[1])), Math.min(100, Number(m[2]))];
}

/* ---------------- 头像上传 ---------------- */

function pickAvatar(d, rerender) {
  const inp = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  document.body.append(inp);
  inp.onchange = async () => {
    const f = inp.files?.[0];
    inp.remove();
    if (!f) return;
    try {
      const res = await api(`/api/profiles/avatar?slug=${encodeURIComponent(d.slug)}`, {
        method: 'POST', raw: f, filename: f.name,
      });
      d.avatar = res.avatar;
      d.avatarWarning = res.warnings?.length ? res.warnings[0] : null;
      rerender();
      ctx.reloadPreview(`/authors/${d.slug}/`);
      toast(res.warnings?.length ? res.warnings[0] : `头像已更新：${res.avatar.rel}`, res.warnings?.length ? 'info' : 'ok', { timeout: res.warnings?.length ? 12000 : 4000 });
    } catch (err) { reportError(err); }
  };
  inp.click();
}

/* ---------------- 新建 / 删除 ---------------- */

function createDialog() {
  const slugF = el('input', { type: 'text', placeholder: 'zhang-san（小写字母、数字、连字符）' });
  const nameF = el('input', { type: 'text', placeholder: '张三' });
  const roleF = el('input', { type: 'text', placeholder: 'Ph.D. Student' });
  const bioF = el('textarea', { rows: '2', placeholder: '一句话简介（可留空）' });
  const groupSel = el('select', {}, el('option', { value: '' }, '（不登记到成员名单）'));
  // 分组列表从接口取，保证是最新的
  api('/api/profiles').then((data) => {
    const groups = data.groups ?? [];
    clear(groupSel);
    groupSel.append(el('option', { value: '' }, '（不登记到成员名单）'));
    groups.forEach((g) => groupSel.append(el('option', { value: g }, g)));
  }).catch(() => {});

  modal({
    title: '新建成员个人主页',
    wide: true,
    content: el('div', { class: 'stack' },
      el('p', { class: 'muted', text: '会创建 data/authors/<目录名>.yaml 与 content/authors/<目录名>/_index.md，并可选地登记到成员名单。' }),
      el('div', { class: 'grid-2' },
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '目录名 (slug)' }), slugF),
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '姓名' }), nameF)),
      el('div', { class: 'grid-2' },
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '职位 / 身份' }), roleF),
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '登记到分组' }), groupSel)),
      el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '简介' }), bioF)),
    actions: [
      { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
      {
        label: '创建并编辑',
        onClick: async (c) => {
          try {
            const res = await api('/api/profiles/create', {
              method: 'POST',
              body: {
                slug: slugF.value.trim(),
                display: nameF.value.trim(),
                role: roleF.value.trim(),
                bio: bioF.value.trim(),
                addToGroup: groupSel.value || null,
              },
            });
            c();
            toast(`已创建 ${res.dataPath}`, 'ok', { timeout: 6000 });
            if (res.addedToGroup) toast(`已登记到「${res.addedToGroup}」分组`, 'ok');
            await refresh(res.slug);
            await ctx.refreshStatus();
          } catch (err) { reportError(err); }
        },
      },
    ],
  });
}

function deleteDialog(d) {
  const cbData = el('input', { type: 'checkbox', checked: true });
  const cbPage = el('input', { type: 'checkbox', checked: true });
  const cbAvatar = el('input', { type: 'checkbox', checked: false });
  modal({
    title: '删除个人主页',
    content: el('div', { class: 'stack' },
      el('p', { text: `将删除成员「${d.profile.display || d.slug}」的以下内容（都会移入回收站，可恢复）：` }),
      el('label', { class: 'fld fld-check' }, cbData, el('span', { text: `资料文件 data/authors/${d.slug}.yaml` })),
      el('label', { class: 'fld fld-check' }, cbPage, el('span', { text: `页面文件 content/authors/${d.slug}/_index.md` })),
      el('label', { class: 'fld fld-check' }, cbAvatar, el('span', { text: '头像文件（建议保留，可能被别处引用）' })),
      el('p', { class: 'muted small', text: '注意：如果这位成员还在「成员名单」里，删除后名单上的链接会指向不存在的页面。' })),
    actions: [
      { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
      {
        label: '删除',
        kind: 'btn-danger',
        onClick: async (c) => {
          try {
            const res = await api('/api/profiles/delete', {
              method: 'POST',
              body: { slug: d.slug, removeData: cbData.checked, removePage: cbPage.checked, removeAvatar: cbAvatar.checked },
            });
            c();
            toast(`已移入回收站：${res.removed.length} 项`, 'ok');
            await refresh();
            await ctx.refreshStatus();
          } catch (err) { reportError(err); }
        },
      },
    ],
  });
}

/* ---------------- 保存 ---------------- */

async function save() {
  const d = doc;
  const res = await api('/api/profiles/save', {
    method: 'POST',
    body: {
      slug: d.slug,
      pageTitle: d.pageTitle,
      profile: d.profile,
    },
  });
  if (!res.changed) { toast('没有需要保存的改动', 'info', { timeout: 2600 }); return; }
  const diff = res.data?.diff;
  toast(`已保存${res.created ? '（新建了资料文件）' : ''}`, 'ok', {
    action: diff ? {
      label: '查看改动',
      onClick: () => import('../core.js').then(({ diffView, modal: m }) => m({
        title: '本次改动', content: diffView(diff), wide: true,
        actions: [{ label: '关闭', kind: 'btn-ghost', onClick: (c) => c() }],
      })),
    } : null,
  });
  if (res.skipped?.length) {
    toast(`以下字段因原资料中没有而跳过：${res.skipped.join('、')}`, 'info', { timeout: 8000 });
  }
  ctx.markDirty(false);
  ctx.reloadPreview(`/authors/${d.slug}/`);
  await ctx.refreshStatus();
  // 注意：不要用接口返回的新对象替换 doc —— 表单里的输入框绑定的是当前这个对象
}

function dirty() { ctx.markDirty(true); }
