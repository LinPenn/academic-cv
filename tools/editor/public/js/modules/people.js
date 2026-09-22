/**
 * 模块：成员与导师
 * 编辑 content/people/_index.md —— 导师(PI)信息 + 成员分组
 */

import {
  api, el, clear, input, linesField, imageField, section, toast, reportError,
  reportSave, confirmDialog, modal, spinner, listEditor,
} from '../core.js';

let ctx = null;
let state = null;

export default {
  id: 'people',
  label: '成员与导师',
  icon: '👥',
  group: '内容',
  previewPath: '/people/',
  title: '成员与导师',
  desc: '编辑「成员」页面（/people/）：导师简介、头衔、研究兴趣，以及各分组的学生名单。改动会写回 content/people/_index.md。',

  async mount(root, context) {
    ctx = context;
    root.append(spinner());
    try {
      state = await api('/api/people');
    } catch (err) {
      clear(root).append(el('div', { class: 'notice notice-warn', text: `读取失败：${err.message}` }));
      return;
    }
    ctx.registerSave(save);
    render(root);
  },
};

function render(root) {
  clear(root);
  root.append(
    el('h1', { class: 'page-title' }, '成员与导师'),
    el('p', { class: 'page-desc', text: '编辑「成员」页面：导师信息与各分组名单。姓名的目录名（slug）对应个人主页地址 /authors/<目录名>/，留空则不生成链接。' }),
    piCard(),
    groupsCard(),
    hintCard(),
  );
  ctx.markDirty(false);
}

/* ---------------- 导师卡片 ---------------- */

function piCard() {
  const pi = state.pi ?? (state.pi = {});
  return section('导师（PI）信息',
    el('div', { class: 'grid-2' },
      input({ label: '姓名', value: pi.name ?? '', onInput: (v) => { pi.name = v; dirty(); } }),
      input({ label: '邮箱', value: pi.email ?? '', onInput: (v) => { pi.email = v; dirty(); } }),
      input({ label: '个人主页链接', value: pi.faculty_url ?? '', hint: '例如 /faculty/zhuocheng-hou/，留空则不显示「Faculty Page」按钮', onInput: (v) => { pi.faculty_url = v; dirty(); } }),
      input({ label: 'ORCID', value: pi.orcid ?? '', onInput: (v) => { pi.orcid = v; dirty(); } }),
      input({ label: 'GitHub 用户名', value: pi.github ?? '', onInput: (v) => { pi.github = v; dirty(); } })),
    imageField({ label: '照片', value: pi.photo ?? '', onChange: (v) => { pi.photo = v; dirty(); }, hint: '建议竖版 3:4，宽度 600px 以上' }),
    linesField({ label: '头衔 / 职务', value: pi.roles ?? [], rows: 8, onChange: (v) => { pi.roles = v; dirty(); } }),
    linesField({ label: '研究兴趣', value: pi.interests ?? [], rows: 4, onChange: (v) => { pi.interests = v; dirty(); } }),
  );
}

/* ---------------- 分组与成员 ---------------- */

function groupsCard() {
  const groupsBox = el('div');
  const renderGroups = () => {
    clear(groupsBox);
    if (!state.groups.length) groupsBox.append(el('p', { class: 'muted', text: '还没有分组，点下面「添加分组」开始。' }));
    state.groups.forEach((g, gi) => groupsBox.append(groupBlock(g, gi, renderGroups)));
    ctx.markDirty(true);
  };
  const card = section('成员分组',
    groupsBox,
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', {
        class: 'btn btn-ghost', text: '+ 添加分组',
        onclick: () => { state.groups.push({ category: '新分组', members: [] }); renderGroups(); },
      }),
      el('button', {
        class: 'btn btn-ghost', text: '批量添加成员…',
        onclick: () => bulkAdd(renderGroups),
      })));
  card.querySelector('.card-title').append(el('span', { class: 'card-actions' },
    el('span', { class: 'muted small', text: '用 ↑ ↓ 调整顺序，顺序即页面上的显示顺序' })));
  renderGroups();
  ctx.markDirty(false);
  return card;
}

function groupBlock(group, gi, rerender) {
  const membersBox = el('div', { class: 'stack' });
  const renderMembers = () => {
    clear(membersBox);
    if (!group.members?.length) membersBox.append(el('p', { class: 'muted small', text: '该分组暂无成员' }));
    (group.members ?? []).forEach((m, mi) => membersBox.append(memberRow(group, m, mi, renderMembers)));
    ctx.markDirty(true);
  };

  const head = el('div', { class: 'row' },
    el('input', {
      type: 'text', value: group.category ?? '', placeholder: '分组名称，例如 PhD / Master',
      style: 'max-width:260px',
      oninput: (e) => { group.category = e.target.value; ctx.markDirty(true); },
    }),
    el('span', { class: 'muted small', text: `${(group.members ?? []).length} 人` }),
    el('span', { class: 'right row' },
      el('button', { class: 'icon-btn', title: '上移分组', text: '↑', onclick: () => { if (gi > 0) swap(state.groups, gi, gi - 1); rerender(); } }),
      el('button', { class: 'icon-btn', title: '下移分组', text: '↓', onclick: () => { if (gi < state.groups.length - 1) swap(state.groups, gi, gi + 1); rerender(); } }),
      el('button', { class: 'icon-btn danger', title: '删除分组', text: '✕', onclick: () => confirmDialog('删除分组', `确定删除分组「${group.category}」及其 ${(group.members ?? []).length} 名成员吗？（保存后生效，可从备份恢复）`, () => { state.groups.splice(gi, 1); rerender(); }) })));

  const block = el('div', { class: 'card', style: 'box-shadow:none;background:#fcfdfe' },
    head, membersBox,
    el('button', {
      class: 'btn btn-ghost btn-sm', text: '+ 添加成员',
      onclick: () => {
        group.members = group.members ?? [];
        group.members.push({ name: '', slug: '', title: '' });
        renderMembers();
      },
    }));
  renderMembers();
  return block;
}

function memberRow(group, m, mi, rerender) {
  const title = () => m.name || '(未填写姓名)';
  const headTitle = el('button', { class: 'list-item-title', type: 'button', onclick: () => card.classList.toggle('open') }, title());
  const extraKeys = Object.keys(m).filter((k) => !['name', 'slug', 'title', 'email', 'photo', 'bio'].includes(k));

  const body = el('div', { class: 'list-item-body' },
    el('div', { class: 'grid-2' },
      input({ label: '姓名', value: m.name ?? '', onInput: (v) => { m.name = v; headTitle.textContent = title(); ctx.markDirty(true); } }),
      input({ label: '职称 / 身份', value: m.title ?? '', hint: '例如 Ph.D. Student、Associate Professor', onInput: (v) => { m.title = v; ctx.markDirty(true); } }),
      input({ label: '目录名（slug）', value: m.slug ?? '', hint: '小写字母与连字符，对应 /authors/<slug>/；留空则姓名不可点击', onInput: (v) => { m.slug = v.trim(); ctx.markDirty(true); } }),
      input({ label: '邮箱', value: m.email ?? '', onInput: (v) => { m.email = v; ctx.markDirty(true); } })),
    imageField({ label: '照片', value: m.photo ?? '', onChange: (v) => { m.photo = v; ctx.markDirty(true); } }),
    input({ label: '简介', rows: 3, value: m.bio ?? '', hint: '可留空', onInput: (v) => { m.bio = v; ctx.markDirty(true); } }),
    extraKeys.length ? el('p', { class: 'muted small', text: `该成员还有其它字段会原样保留：${extraKeys.join('、')}` }) : null);

  const card = el('div', { class: 'list-item' },
    el('div', { class: 'list-item-head' },
      headTitle,
      el('div', { class: 'list-item-actions' },
        el('button', { class: 'icon-btn', title: '上移', text: '↑', onclick: () => { if (mi > 0) swap(group.members, mi, mi - 1); rerender(); } }),
        el('button', { class: 'icon-btn', title: '下移', text: '↓', onclick: () => { if (mi < group.members.length - 1) swap(group.members, mi, mi + 1); rerender(); } }),
        el('button', { class: 'icon-btn', title: '移到其它分组', text: '⇄', onclick: () => moveDialog(group, mi, rerender) }),
        el('button', { class: 'icon-btn danger', title: '删除', text: '✕', onclick: () => { group.members.splice(mi, 1); rerender(); } }))),
    body);
  return card;
}

function moveDialog(group, mi, rerender) {
  const options = state.groups.map((g, i) => el('option', { value: String(i) }, g.category || `分组 ${i + 1}`));
  const sel = el('select', {}, ...options);
  modal({
    title: '移动成员到其它分组',
    content: el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '目标分组' }), sel),
    actions: [
      { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
      {
        label: '移动',
        onClick: (c) => {
          const target = state.groups[Number(sel.value)];
          const [m] = group.members.splice(mi, 1);
          target.members = target.members ?? [];
          target.members.push(m);
          c();
          rerender();
        },
      },
    ],
  });
}

function bulkAdd(rerender) {
  const ta = el('textarea', { rows: '8', placeholder: '每行一位成员，用 | 分隔字段：\n姓名 | 职称 | 邮箱 | 目录名\n例如：\nZhang San | Ph.D. Student | zs@cau.edu.cn | zhang-san' });
  const sel = el('select', {}, ...state.groups.map((g) => el('option', { value: g.category }, g.category || '(未命名分组)')));
  const newGroup = el('input', { type: 'text', placeholder: '或输入新分组名称（填写后忽略上面的选择）' });
  modal({
    title: '批量添加成员',
    wide: true,
    content: el('div', { class: 'stack' },
      el('p', { class: 'muted', text: '适合一次录入一届新生。字段用 | 分隔，后三项可留空。' }),
      ta,
      el('div', { class: 'grid-2' },
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '加入分组' }), sel),
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '新建分组（可选）' }), newGroup))),
    actions: [
      { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
      {
        label: '添加',
        onClick: (c) => {
          const lines = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
          if (!lines.length) { toast('没有输入内容', 'info'); return; }
          let group = state.groups.find((g) => g.category === sel.value);
          if (newGroup.value.trim()) {
            group = { category: newGroup.value.trim(), members: [] };
            state.groups.push(group);
          }
          if (!group) { toast('请选择或新建一个分组', 'error'); return; }
          group.members = group.members ?? [];
          let count = 0;
          for (const line of lines) {
            const [name, title, email, slug] = line.split('|').map((s) => (s ?? '').trim());
            if (!name) continue;
            group.members.push({ name, title: title || '', email: email || '', slug: slug || '' });
            count++;
          }
          c();
          rerender();
          toast(`已添加 ${count} 位成员，记得点「保存」`, 'ok');
        },
      },
    ],
  });
}

function hintCard() {
  const missing = missingAuthors();
  return section('保存说明',
    el('div', { class: 'notice' },
      el('p', { text: '点击右下角「保存」后，改动会写入 content/people/_index.md，右侧预览会自动刷新。' }),
      missing.length
        ? el('p', { text: `以下目录名还没有对应的个人主页：${missing.join('、')}。勾选下面的选项可以在保存时自动创建。` })
        : el('p', { text: '所有成员的目录名都已存在对应的个人主页。' })),
    missing.length ? el('label', { class: 'fld fld-check' },
      el('input', { type: 'checkbox', id: 'auto-author', checked: true }),
      el('span', { text: `保存时自动创建缺失的个人主页（${missing.length} 个）` }),
      el('span', { class: 'fld-hint', text: '会生成 content/authors/<目录名>/_index.md' })) : null);
}

function missingAuthors() {
  const known = new Set(state.authorSlugs ?? []);
  const out = [];
  for (const g of state.groups ?? []) {
    for (const m of g.members ?? []) {
      if (m.slug && !known.has(m.slug) && !out.includes(m.slug)) out.push(m.slug);
    }
  }
  return out;
}

/* ---------------- 保存 ---------------- */

async function save() {
  const autoBox = document.getElementById('auto-author');
  const res = await api('/api/people', {
    method: 'POST',
    body: {
      title: state.title,
      pi: state.pi,
      groups: state.groups,
      createAuthorPages: autoBox?.checked ? missingAuthors() : [],
    },
  });
  reportSave(res, { label: '成员名单已保存' });
  if (res.createdAuthors?.length) {
    toast(`已创建个人主页：${res.createdAuthors.map((p) => p.split('/')[2]).join('、')}`, 'ok', { timeout: 8000 });
  }
  ctx.markDirty(false);
  ctx.reloadPreview('/people/');
  await ctx.refreshStatus();
  // 注意：这里只刷新作者目录列表。
  // 不能替换 state.pi / state.groups —— 表单里的输入框绑定的是这些对象，
  // 一旦换成服务器返回的新对象，用户后续的编辑就会写入「已经不在 state 里」的对象而丢失。
  const fresh = await api('/api/people');
  state.authorSlugs = fresh.authorSlugs;
}

function swap(arr, a, b) {
  const t = arr[a];
  arr[a] = arr[b];
  arr[b] = t;
}

function dirty() { ctx.markDirty(true); }
