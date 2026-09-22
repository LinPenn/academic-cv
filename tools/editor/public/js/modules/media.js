/**
 * 模块：图片素材
 * 管理 static/uploads/ 下的图片与文件；上传时自动适配 GitHub Pages 的文件名规则
 */

import {
  api, el, clear, section, toast, reportError, confirmDialog, spinner, fmtSize, fmtTime, modal, appendAll,
} from '../core.js';

let ctx = null;
let root = null;
let data = null;

export default {
  id: 'media',
  label: '图片素材',
  icon: '🖼',
  group: '内容',
  title: '图片素材',
  desc: '上传和管理图片。文件保存在 static/uploads/，会随站点一起提交到 GitHub。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await refresh();
  },
};

async function refresh() {
  clear(root).append(spinner());
  try {
    data = await api('/api/media');
  } catch (err) { reportError(err); return; }
  render();
}

function render() {
  clear(root);
  const uploads = data.uploads;
  const images = uploads.filter((u) => u.isImage);

  appendAll(root, 
    el('h1', { class: 'page-title' }, '图片素材'),
    el('p', { class: 'page-desc', text: '直接拖拽图片到这里即可上传。文件名会自动转成小写英文（GitHub Pages 区分大小写，中文名和空格容易导致链接失效）。' }),
    uploadCard(),
    section(`素材库（${images.length} 张图片 / 共 ${uploads.length} 个文件）`,
      images.length
        ? el('div', { class: 'media-grid' }, ...images.map(imageCell))
        : el('p', { class: 'muted', text: '还没有上传任何图片。' }),
      uploads.filter((u) => !u.isImage).length
        ? el('div', { style: 'margin-top:14px' },
          el('h4', { class: 'small muted', text: '其它文件' }),
          el('table', { class: 'tbl' }, el('tbody', {}, ...uploads.filter((u) => !u.isImage).map((f) => el('tr', {},
            el('td', { class: 'mono small', text: f.rel }),
            el('td', { class: 'muted small', text: fmtSize(f.size) }),
            el('td', {}, el('button', { class: 'btn btn-danger btn-sm', text: '删除', onclick: () => removeFile(f) })))))))
        : null),
    section('文章封面图',
      el('p', { class: 'muted small', text: '这些是新闻和论文条目里的封面（featured.jpg 等），在各目的编辑页面里更换。' }),
      data.covers.length
        ? el('table', { class: 'tbl' }, el('tbody', {}, ...data.covers.map((c) => el('tr', {},
          el('td', { class: 'mono small', text: c.rel }),
          el('td', { class: 'muted small', text: fmtSize(c.size) })))))
        : el('p', { class: 'muted small', text: '暂无' })),
  );
}

function imageCell(img) {
  return el('div', { class: 'media-cell' },
    el('img', { src: img.url, alt: img.name, loading: 'lazy' }),
    el('span', { class: 'media-name', title: img.rel, text: img.name }),
    el('span', { class: 'muted', style: 'font-size:11px', text: `${fmtSize(img.size)} · ${fmtTime(img.mtime)}` }),
    el('div', { class: 'row' },
      el('button', {
        class: 'btn btn-ghost btn-sm', text: '复制路径',
        title: '复制 front matter 用的路径（uploads/…）。正文里插图请用「新闻」或「页面」模块的 🖼 按钮，那会自动补成 /uploads/… 绝对路径',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(img.frontMatterPath);
            toast(`已复制：${img.frontMatterPath}`, 'ok', { timeout: 2600 });
          } catch {
            modal({
              title: '复制路径',
              content: el('input', { type: 'text', value: img.frontMatterPath, readonly: true, style: 'width:100%' }),
              actions: [{ label: '关闭', kind: 'btn-ghost', onClick: (c) => c() }],
            });
          }
        },
      }),
      el('button', { class: 'btn btn-danger btn-sm', text: '删除', onclick: () => removeFile(img) })));
}

function uploadCard() {
  const zone = el('div', { class: 'drop-zone' },
    el('p', { text: '把图片拖到这里，或' }),
    el('button', { class: 'btn btn-primary btn-sm', text: '选择文件…', onclick: () => fileInput().click() }));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    await doUpload([...e.dataTransfer.files]);
  });
  return section('上传图片', zone,
    el('div', { class: 'notice notice-warn small', style: 'margin-top:12px' },
      el('p', { text: '上传前请注意（这些限制来自 GitHub，不是编辑器）：' }),
      el('p', { text: '· 单个文件不能超过 100MB（这里限制 95MB），建议每张图压缩到 1MB 以内；' }),
      el('p', { text: '· 文件名会转成小写英文短名，避免中文和空格；' }),
      el('p', { text: '· 图片会进入 git 仓库，长期积累会让仓库变大、克隆变慢。' })));
}

function fileInput() {
  const inp = el('input', { type: 'file', accept: 'image/*,.pdf,.mp4', multiple: true, style: 'display:none' });
  document.body.append(inp);
  inp.onchange = async () => {
    const files = [...inp.files];
    inp.remove();
    await doUpload(files);
  };
  return inp;
}

async function doUpload(files) {
  if (!files.length) return;
  let ok = 0;
  const notes = [];
  for (const f of files) {
    try {
      const res = await api('/api/media/upload', { method: 'POST', raw: f, filename: f.name });
      ok++;
      if (res.warnings?.length) notes.push(`${res.rel}：${res.warnings.join('；')}`);
    } catch (err) {
      notes.push(`${f.name}：${err.message}`);
    }
  }
  await refresh();
  await ctx.refreshStatus();
  toast(`已上传 ${ok}/${files.length} 个文件`, notes.length ? 'info' : 'ok', { timeout: notes.length ? 12000 : 4000 });
  if (notes.length) {
    modal({
      title: '上传提示',
      content: el('ul', {}, ...notes.map((n) => el('li', { text: n }))),
      actions: [{ label: '知道了', onClick: (c) => c() }],
    });
  }
}

function removeFile(f) {
  confirmDialog('删除文件', `确定删除 ${f.rel} 吗？文件会被移入回收站（.editor/trash），可以恢复。注意：站内引用它的地方会显示裂图。`, async () => {
    try {
      await api('/api/media/delete', { method: 'POST', body: { path: f.rel } });
      toast('已移入回收站', 'ok');
      await refresh();
      await ctx.refreshStatus();
    } catch (err) { reportError(err); }
  });
}
