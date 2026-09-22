/**
 * 模块：高级工具
 * 原文编辑、备份恢复、回收站、构建校验
 */

import {
  api, el, clear, section, toast, reportError, spinner, fmtTime, fmtSize, modal, diffView, confirmDialog, reportSave, appendAll,
} from '../core.js';

let ctx = null;
let root = null;
let tab = 'raw';
let files = [];
let currentPath = null;
let text = '';
let backups = [];
let trash = [];

export default {
  id: 'advanced',
  label: '高级工具',
  icon: '🧰',
  group: '站点',
  title: '高级工具',
  desc: '直接编辑文件原文、从备份恢复、找回删除的内容。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await loadAll();
  },
};

async function loadAll() {
  clear(root).append(spinner());
  try {
    const [f, b, t] = await Promise.all([
      api('/api/files'),
      api('/api/backups').catch(() => ({ backups: [] })),
      api('/api/trash').catch(() => ({ trash: [] })),
    ]);
    files = f.files;
    backups = b.backups;
    trash = t.trash;
  } catch (err) { reportError(err); return; }
  render();
}

function render() {
  clear(root);
  appendAll(root, 
    el('h1', { class: 'page-title' }, '高级工具'),
    el('p', { class: 'page-desc', text: '这些工具会直接操作文件，请谨慎使用。每次保存前系统都会自动备份，可从「备份」标签页恢复。' }),
    el('div', { class: 'tabs' },
      ...[['raw', '原文编辑'], ['backup', `备份（${backups.length}）`], ['trash', `回收站（${trash.length}）`], ['check', '构建校验']].map(([id, label]) => el('button', {
        class: `tab${tab === id ? ' active' : ''}`, text: label,
        onclick: () => { tab = id; render(); },
      }))),
    tab === 'raw' ? rawPane() : null,
    tab === 'backup' ? backupPane() : null,
    tab === 'trash' ? trashPane() : null,
    tab === 'check' ? checkPane() : null,
  );
}

/* ---------------- 原文编辑 ---------------- */

let pendingRaw = null;

function rawPane() {
  const box = el('div');
  const renderEditor = () => {
    clear(box);
    if (!currentPath) {
      box.append(el('p', { class: 'muted', text: '从上面的下拉框选择一个文件开始编辑。' }));
      return;
    }
    const ta = el('textarea', { class: 'md-editor', rows: '26', value: text, oninput: (e) => { text = e.target.value; } });
    box.append(
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-ghost btn-sm', text: '重新载入', onclick: () => loadRaw(currentPath, renderEditor) }),
        el('button', { class: 'btn btn-primary btn-sm', text: '保存', onclick: () => saveRaw(renderEditor) }),
        el('span', { class: 'muted small mono', text: currentPath })),
      el('div', { class: 'notice notice-warn small' },
        el('p', { text: '这里显示的是文件原始内容（front matter + 正文）。请保持 YAML 缩进与格式，保存前会自动校验 front matter 能否解析。' })),
      ta);
  };
  const sel = el('select', {
    onchange: (e) => { currentPath = e.target.value; loadRaw(currentPath, renderEditor); },
  }, el('option', { value: '' }, '— 选择文件 —'), ...files.map((f) => el('option', { value: f.path, selected: f.path === currentPath }, f.path)));

  renderEditor();
  return section('原文编辑', sel, box);
}

async function loadRaw(path, rerender) {
  if (!path) return;
  try {
    const res = await api(`/api/raw?path=${encodeURIComponent(path)}`);
    text = res.text;
    rerender();
  } catch (err) { reportError(err); }
}

async function saveRaw(rerender) {
  try {
    const res = await api('/api/raw', { method: 'POST', body: { path: currentPath, text, dryRun: true } });
    if (!res.changed) { toast('内容没有变化', 'info'); return; }
    modal({
      title: '确认写入',
      wide: true,
      content: diffView(res.diff),
      actions: [
        { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
        {
          label: '确认写入',
          onClick: async (c) => {
            try {
              const done = await api('/api/raw', { method: 'POST', body: { path: currentPath, text } });
              c();
              reportSave(done, { label: '已写入' });
              await loadRaw(currentPath, rerender);
              await ctx.refreshStatus();
              ctx.reloadPreview();
            } catch (err) { reportError(err); }
          },
        },
      ],
    });
  } catch (err) { reportError(err); }
}

/* ---------------- 备份 ---------------- */

function backupPane() {
  if (!backups.length) return section('备份', el('p', { class: 'muted', text: '还没有备份。每次通过编辑器保存文件前都会自动备份一份。' }));
  return section('备份（最近 40 次）',
    el('p', { class: 'muted small', text: '备份保存在 .editor/backups/，不会提交到 GitHub。点「恢复」会把该文件还原到备份时的内容（当前内容也会被再备份一次）。' }),
    ...backups.map((b) => el('div', { class: 'card', style: 'box-shadow:none;background:#fcfdfe' },
      el('div', { class: 'row' },
        el('strong', { text: fmtTime(b.at) }),
        el('span', { class: 'muted small', text: `${b.files.length} 个文件` })),
      el('ul', { class: 'small' }, ...b.files.map((f) => el('li', {},
        el('span', { class: 'mono', text: f }),
        el('button', {
          class: 'btn btn-ghost btn-sm', style: 'margin-left:8px', text: '恢复',
          onclick: () => confirmDialog('恢复文件', `将 ${f} 恢复为 ${fmtTime(b.at)} 时的内容？`, async () => {
            try {
              await api('/api/restore', { method: 'POST', body: { id: b.id, path: f } });
              toast('已恢复，右侧预览会刷新', 'ok');
              await loadAll();
              ctx.reloadPreview();
            } catch (err) { reportError(err); }
          }),
        })))))));
}

/* ---------------- 回收站 ---------------- */

function trashPane() {
  if (!trash.length) return section('回收站', el('p', { class: 'muted', text: '回收站是空的。删除新闻、论文或图片时会移到这里。' }));
  return section('回收站',
    ...trash.map((t) => el('div', { class: 'card', style: 'box-shadow:none;background:#fcfdfe' },
      el('div', { class: 'row' }, el('strong', { text: fmtTime(t.at) }), el('span', { class: 'muted small', text: `${t.files.length} 个文件` })),
      el('ul', { class: 'small' }, ...t.files.map((f) => el('li', {},
        el('span', { class: 'mono', text: f }),
        el('button', {
          class: 'btn btn-ghost btn-sm', style: 'margin-left:8px', text: '恢复',
          onclick: async () => {
            try {
              await api('/api/trash/restore', { method: 'POST', body: { id: t.id, path: f } });
              toast('已恢复到原位置', 'ok');
              await loadAll();
            } catch (err) { reportError(err); }
          },
        })))))),
  );
}

/* ---------------- 构建校验 ---------------- */

function checkPane() {
  const out = el('div');
  return section('构建校验',
    el('p', { class: 'muted', text: '运行一次完整的 Hugo 构建，确认改动没有把站点改坏。约需 10 秒。建议在发布前点一次。' }),
    el('button', {
      class: 'btn btn-primary', text: '开始校验',
      onclick: async (e) => {
        const btn = e.target;
        btn.disabled = true;
        clear(out).append(spinner('正在构建，请稍候…'));
        try {
          const res = await api('/api/check', { method: 'POST' });
          clear(out);
          appendAll(out, el('div', { class: `notice ${res.ok ? 'notice-ok' : 'notice-warn'}` },
            el('p', { text: res.ok ? `构建成功（用时 ${(res.ms / 1000).toFixed(1)} 秒），可以放心发布。` : `构建失败（用时 ${(res.ms / 1000).toFixed(1)} 秒）` }),
            res.errors?.length ? el('ul', {}, ...res.errors.map((e2) => el('li', { class: 'mono small', text: e2 }))) : null,
            !res.ok ? el('pre', { class: 'mono small', style: 'max-height:240px;overflow:auto', text: res.output }) : null));
        } catch (err) { clear(out); reportError(err); } finally { btn.disabled = false; }
      },
    }),
    out);
}
