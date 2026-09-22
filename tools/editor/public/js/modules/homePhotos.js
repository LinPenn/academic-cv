/**
 * 模块：首页照片（封面轮播）
 * ------------------------------------------------------------------
 * 照片放在 static/uploads/home/ 下，每张可以单独设置取景（缩放 / 水平 / 垂直），
 * 顺序、取景保存在 data/home_photos.yaml；轮播速度保存在 data/layout.yaml。
 *
 * 界面：左侧照片列表（点选、↑↓ 排序、删除），右侧是选中照片的大预览 + 三个滑块。
 */

import {
  api, el, clear, section, toast, reportError, reportSave, spinner, iconBtn, confirmDialog,
  uploadFile, appendAll, fmtSize,
} from '../core.js';

let ctx = null;
let root = null;
let d = null;            // /api/home-photos 返回的数据
let values = {};         // 轮播参数（间隔 / 淡入淡出）
let selected = null;     // 当前选中的照片名
let listBox = null;      // 左侧列表容器
let panelBox = null;     // 右侧预览 + 滑块容器

export default {
  id: 'homePhotos',
  label: '首页照片',
  icon: '🖼️',
  group: '站点',
  title: '首页照片',
  previewPath: '/',
  desc: '管理首页封面轮播：上传、排序、删除，并逐张调整取景（缩放与位置）。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await load();
  },
};

async function load() {
  clear(root).append(spinner());
  try {
    d = await api('/api/home-photos');
    values = { ...d.values };
  } catch (err) { reportError(err); return; }
  if (!d.photos.some((p) => p.name === selected)) selected = d.photos[0]?.name ?? null;
  render();
  ctx.setPreview('/');
  ctx.registerSave(save);
  ctx.markDirty(false);
}

function render() {
  clear(root);
  listBox = el('div', { class: 'stack' });
  panelBox = el('div', { class: 'stack' });

  appendAll(root,
    el('h1', { class: 'page-title' }, '首页照片'),
    el('p', { class: 'page-desc', text: '这些照片会作为首页封面轮播。点左侧某张照片，在右边单独调整它的取景；照片越靠上越先播放。' }),
    el('div', { class: 'row', style: 'align-items:flex-start;gap:20px;flex-wrap:wrap' },
      el('div', { style: 'flex:1 1 340px;min-width:320px' }, drawList()),
      el('div', { style: 'flex:1 1 420px;min-width:320px' }, drawPanel())),
    section('轮播设置',
      el('div', { class: 'grid-2' },
        numField({ key: 'home.slide_interval', label: '自动切换间隔（秒）', min: 2, max: 60, step: 1 }),
        numField({ key: 'home.slide_fade', label: '淡入淡出时长（秒）', min: 0, max: 6, step: 0.1, hint: '0 = 直接切换' })),
      el('p', { class: 'muted small', text: `共 ${d.photos.length} 张照片，轮播一轮约 ${(d.photos.length * (values['home.slide_interval'] || 6)).toFixed(0)} 秒。` })),
  );
  drawAll();
}

function drawList() {
  return el('section', { class: 'card' },
    el('h3', { class: 'card-title' }, '照片列表'),
    el('p', { class: 'muted small', text: '点缩略图选中；↑ ↓ 调整播放顺序；✕ 删除（进回收站）。' }),
    listBox,
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { class: 'btn btn-primary btn-sm', text: '+ 上传照片', onclick: pickFiles }),
      el('span', { class: 'muted small', text: '可一次选多张；建议宽度 1600px 以上、单张 1MB 以内' })));
}

function drawPanel() {
  return el('section', { class: 'card' },
    el('h3', { class: 'card-title' }, '取景（每张单独设置）'),
    panelBox);
}

function drawAll() {
  clear(listBox);
  if (!d.photos.length) {
    listBox.append(el('p', { class: 'muted small', text: '还没有照片，先上传几张吧。' }));
  }
  d.photos.forEach((p, i) => {
    const on = p.name === selected;
    const thumb = el('img', {
      src: url(p),
      alt: p.name,
      style: 'width:96px;height:58px;object-fit:cover;border-radius:6px;flex:0 0 auto;'
        + `object-position:${p.x}% ${p.y}%;transform:scale(${p.zoom / 100});`
        + `border:1px solid ${on ? '#2563eb' : 'var(--border)'}`,
    });
    listBox.append(el('div', {
      class: 'list-item',
      style: on ? 'outline:2px solid #2563eb' : '',
    },
    el('div', { class: 'list-item-head' },
      el('button', {
        type: 'button', class: 'list-item-title',
        style: 'display:flex;align-items:center;gap:10px;background:none;border:0;cursor:pointer;padding:0;text-align:left',
        onclick: () => { selected = p.name; drawAll(); },
      }, thumb, el('span', {},
        el('div', { text: p.name }),
        el('div', { class: 'muted small', text: `${fmtSize(p.size)} · 缩放 ${p.zoom}% · 位置 ${p.x}%,${p.y}%` }))),
      el('div', { class: 'list-item-actions' },
        iconBtn('↑', '上移', () => move(i, -1)),
        iconBtn('↓', '下移', () => move(i, 1)),
        iconBtn('✕', '删除该照片', () => confirmDialog('删除照片', `确定把「${p.name}」移入回收站吗？（可恢复）`, async () => {
          try {
            await api('/api/home-photos/delete', { method: 'POST', body: { name: p.name } });
            toast('已移入回收站', 'ok');
            if (selected === p.name) selected = null;
            await load();
          } catch (err) { reportError(err); }
        }), 'danger')))));
  });

  clear(panelBox);
  const p = d.photos.find((x) => x.name === selected) ?? d.photos[0];
  if (!p) {
    panelBox.append(el('p', { class: 'muted small', text: '还没有照片。' }));
    return;
  }
  const big = el('img', {
    src: url(p), alt: p.name,
    style: 'width:100%;height:230px;object-fit:cover;border-radius:8px;border:1px solid var(--border);'
      + `object-position:${p.x}% ${p.y}%;transform:scale(${p.zoom / 100})`,
  });
  panelBox.append(
    el('p', { class: 'muted small', text: `正在调整：${p.name}` }),
    el('div', { style: 'overflow:hidden;border-radius:8px' }, big),
    slider('缩放（%）', 'zoom', p, 100, 220, 1, (v) => set(p, 'zoom', v, big)),
    slider('水平取景（%）0=左 100=右', 'x', p, 0, 100, 1, (v) => set(p, 'x', v, big)),
    slider('垂直取景（%）0=上 100=下', 'y', p, 0, 100, 1, (v) => set(p, 'y', v, big)),
    el('div', { class: 'row', style: 'margin-top:6px' },
      el('button', {
        class: 'btn btn-ghost btn-sm', text: '恢复这张的默认取景',
        onclick: () => { p.zoom = 100; p.x = 50; p.y = 35; syncBig(big, p); drawAll(); dirty(); },
      })),
  );
}

/** 滑块改动：更新数据 → 大预览 → 左侧缩略图 → 标记未保存 */
function set(p, key, v, big) {
  p[key] = Number(v);
  syncBig(big, p);
  drawAll();
  dirty();
}

function syncBig(img, p) {
  img.style.objectPosition = `${p.x}% ${p.y}%`;
  img.style.transform = `scale(${p.zoom / 100})`;
}

function slider(label, key, photo, min, max, step, onChange) {
  const range = el('input', {
    type: 'range', min: String(min), max: String(max), step: String(step), value: String(photo[key]),
    style: 'width:100%',
    oninput: (e) => { num.value = e.target.value; onChange(e.target.value); },
  });
  const num = el('input', {
    type: 'number', min: String(min), max: String(max), step: String(step), value: String(photo[key]),
    style: 'width:84px',
    oninput: (e) => { range.value = e.target.value; onChange(e.target.value); },
  });
  return el('label', { class: 'fld' },
    el('span', { class: 'fld-label', text: label }),
    el('div', { class: 'row' }, el('div', { style: 'flex:0 0 auto' }, num), range));
}

function numField({ key, label, min, max, step, hint }) {
  return el('label', { class: 'fld' },
    el('span', { class: 'fld-label', text: label }),
    el('input', {
      type: 'number', min: String(min), max: String(max), step: String(step),
      value: String(values[key] ?? ''),
      oninput: (e) => { values[key] = e.target.value === '' ? null : Number(e.target.value); dirty(); },
    }),
    hint ? el('span', { class: 'fld-hint', text: hint }) : null);
}

function url(p) {
  return `${ctx.basePath()}${p.url.replace(/^\//, '')}`;
}

function move(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= d.photos.length) return;
  const t = d.photos[i];
  d.photos[i] = d.photos[j];
  d.photos[j] = t;
  drawAll();
  dirty();
}

function pickFiles() {
  const inp = el('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
  document.body.append(inp);
  inp.addEventListener('change', async () => {
    const files = Array.from(inp.files ?? []);
    inp.remove();
    if (!files.length) return;
    const t = toast(`正在上传 ${files.length} 张…`, 'info', { timeout: 0 });
    try {
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        await uploadFile(f, { subdir: 'home' });
      }
      t.remove();
      toast(`已上传 ${files.length} 张照片`, 'ok');
      await load();
    } catch (err) { t.remove(); reportError(err); }
  });
  inp.click();
}

async function save() {
  const photos = d.photos.map((p) => ({ name: p.name, zoom: p.zoom, x: p.x, y: p.y }));
  const res = await api('/api/home-photos/save', { method: 'POST', body: { photos } });
  const layoutRes = await api('/api/layout/save', { method: 'POST', body: { values } });
  reportSave(layoutRes, { label: '首页照片已保存' });
  if (!res.changed && layoutRes.changed === false) toast('没有变化', 'info');
  ctx.markDirty(false);
  ctx.reloadPreview('/');
  await ctx.refreshStatus();
  await load();
}

function dirty() { ctx.markDirty(true); }
