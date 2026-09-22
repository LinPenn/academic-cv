/**
 * 模块：校徽
 * ------------------------------------------------------------------
 * 导航栏左上角（或右上角）的校徽图片：
 *   · 换图片（从图片素材里选或直接上传）
 *   · 调高度、选左右位置
 *   · 决定它在首页 / 其它页面是否显示，以及首页是否隐藏原来的站名文字
 * 配置存在 data/layout.yaml 的 logo 段，模板 body-end/home-logo.html 读取后插入导航栏。
 */

import {
  api, el, clear, section, toast, reportError, reportSave, spinner, imageField, appendAll,
} from '../core.js';

let ctx = null;
let root = null;
let v = {};          // 校徽配置
let preview = null;

export default {
  id: 'logo',
  label: '校徽',
  icon: '🏫',
  group: '站点',
  title: '校徽',
  previewPath: '/',
  desc: '设置导航栏上的校徽：图片、大小、位置，以及在各页面的显示方式。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await load();
  },
};

async function load() {
  clear(root).append(spinner());
  try {
    const lay = await api('/api/layout');
    v = {};
    for (const f of lay.fields ?? []) {
      if (f.group === 'logo') v[f.path.replace('logo.', '')] = f.value;
    }
  } catch (err) { reportError(err); return; }
  render();
  ctx.setPreview('/');
  ctx.registerSave(save);
  ctx.markDirty(false);
}

function render() {
  clear(root);
  appendAll(root,
    el('h1', { class: 'page-title' }, '校徽'),
    el('p', { class: 'page-desc', text: '校徽显示在导航栏上，固定不动，不随首页封面照片切换。图片路径相对 static/ 目录。' }),

    section('校徽图片',
      imageField({
        label: '图片',
        value: v.image ?? '',
        hint: '建议用透明底的 PNG，高度 100px 以上；白色校徽在深色导航栏上效果最好',
        onChange: (val) => { v.image = val; syncPreview(); dirty(); },
      }),
      el('div', { style: 'margin-top:10px' },
        el('p', { class: 'fld-label', text: '预览（深色背景，模拟导航栏）' }),
        el('div', {
          style: 'background:#0f172a;border-radius:8px;padding:14px 18px;display:flex;align-items:center;gap:10px',
        },
        imgPreview(),
        el('span', { style: 'color:#e5e7eb;font-weight:600', text: '（导航栏）' })))),

    section('显示方式',
      el('div', { class: 'grid-2' },
        el('label', { class: 'fld' },
          el('span', { class: 'fld-label', text: `高度：${v.height ?? 40}px` }),
          el('input', {
            type: 'range', min: '16', max: '96', value: String(v.height ?? 40), style: 'width:100%',
            oninput: (e) => { v.height = Number(e.target.value); syncPreview(); render0(); dirty(); },
          })),
        el('label', { class: 'fld' },
          el('span', { class: 'fld-label', text: '位置' }),
          el('select', {
            onchange: (e) => { v.position = e.target.value; dirty(); },
          },
          ...[['left', '左侧（原站名的位置）'], ['right', '右侧（搜索/语言按钮旁）']]
            .map(([val, label]) => el('option', { value: val, selected: (v.position ?? 'left') === val }, label))))),
      el('div', { class: 'grid-3', style: 'margin-top:10px' },
        check('首页显示', 'show_home'),
        check('其它页面也显示', 'show_all'),
        check('首页隐藏站名文字', 'hide_site_name')),
      el('p', { class: 'muted small', text: '关闭「首页隐藏站名文字」后，首页会同时出现校徽和 hzclab 站名。' })),
  );
}

function imgPreview() {
  preview = el('img', {
    src: v.image ? `${ctx.basePath()}${String(v.image).replace(/^\//, '')}` : '',
    alt: '校徽预览',
    style: `height:${v.height ?? 40}px;width:auto;display:${v.image ? 'block' : 'none'}`,
  });
  return preview;
}

function syncPreview() {
  if (!preview) return;
  preview.src = v.image ? `${ctx.basePath()}${String(v.image).replace(/^\//, '')}` : '';
  preview.style.display = v.image ? 'block' : 'none';
  preview.style.height = `${v.height ?? 40}px`;
  const label = preview.parentElement?.previousElementSibling;
  if (label) label.textContent = `高度：${v.height ?? 40}px`;
}

/** 只重画「高度」那行的文字，避免滑块失焦 */
function render0() {
  const range = root.querySelector('input[type=range]');
  const lab = range?.parentElement?.querySelector('.fld-label');
  if (lab) lab.textContent = `高度：${v.height ?? 40}px`;
}

function check(label, key) {
  return el('label', { class: 'fld fld-check' },
    el('input', {
      type: 'checkbox', checked: Number(v[key] ?? 0) === 1,
      onchange: (e) => { v[key] = e.target.checked ? 1 : 0; dirty(); },
    }),
    el('span', { text: label }));
}

async function save() {
  const values = {
    'logo.image': v.image ?? '',
    'logo.height': v.height ?? 40,
    'logo.position': v.position ?? 'left',
    'logo.show_home': Number(v.show_home ?? 1),
    'logo.show_all': Number(v.show_all ?? 0),
    'logo.hide_site_name': Number(v.hide_site_name ?? 1),
  };
  const res = await api('/api/layout/save', { method: 'POST', body: { values } });
  reportSave(res, { label: '校徽设置已保存' });
  ctx.markDirty(false);
  ctx.reloadPreview('/');
  await ctx.refreshStatus();
}

function dirty() { ctx.markDirty(true); }
