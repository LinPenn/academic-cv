/**
 * 模块：校徽 + 网站图标
 * ------------------------------------------------------------------
 * ① 导航栏左上角（或右上角）的校徽图片：
 *   · 换图片（从图片素材里选或直接上传）
 *   · 调高度、选左右位置
 *   · 决定它在首页 / 其它页面是否显示，以及首页是否隐藏原来的站名文字
 * 配置存在 data/layout.yaml 的 logo 段，模板 body-end/home-logo.html 读取后插入导航栏。
 *
 * ② 网站图标（浏览器标签页上的小图标 favicon）：
 *   主题从 assets/media/icon.svg（优先）或 assets/media/icon.png 读取，
 *   主题包里自带一张默认图标，项目里放同名文件即可覆盖。
 */

import {
  api, el, clear, section, toast, reportError, reportSave, spinner, imageField, appendAll,
} from '../core.js';

let ctx = null;
let root = null;
let v = {};          // 校徽配置
let preview = null;
let fav = {};        // 网站图标状态（来自 /api/favicon）
let favImg = null;
let favHint = null;

export default {
  id: 'logo',
  label: '校徽 / 图标',
  icon: '🏫',
  group: '站点',
  title: '校徽与网站图标',
  previewPath: '/',
  desc: '设置导航栏上的校徽，以及浏览器标签页上的网站图标（favicon）。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await load();
  },
};

async function load() {
  clear(root).append(spinner());
  try {
    const [lay, f] = await Promise.all([api('/api/layout'), api('/api/favicon').catch(() => ({}))]);
    v = {};
    for (const field of lay.fields ?? []) {
      if (field.group === 'logo') v[field.path.replace('logo.', '')] = field.value;
    }
    fav = f ?? {};
  } catch (err) { reportError(err); return; }
  render();
  ctx.setPreview('/');
  ctx.registerSave(save);
  ctx.markDirty(false);
  refreshFaviconPreview();
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

    section('网站图标（浏览器标签上的小图标）',
      el('div', { style: 'display:flex;gap:16px;align-items:center;flex-wrap:wrap' },
        el('div', {
          style: 'width:72px;height:72px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;'
            + 'display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto',
        }, favImg = el('img', {
          alt: '网站图标', style: 'max-width:56px;max-height:56px;display:none',
        })),
        el('div', { style: 'flex:1;min-width:240px' },
          favHint = el('p', { class: 'small', text: '读取中…' }),
          el('div', { class: 'row', style: 'margin-top:8px' },
            favUploadBtn(),
            el('button', {
              class: 'btn btn-ghost btn-sm', text: '恢复主题默认图标',
              onclick: async () => {
                if (!confirm('恢复成主题自带的默认图标？当前图标会移入回收站。')) return;
                try {
                  await api('/api/favicon?remove=1', { method: 'POST' });
                  toast('已恢复默认图标', 'ok');
                  await reloadFavicon();
                } catch (err) { reportError(err); }
              },
            }),
            el('button', {
              class: 'btn btn-ghost btn-sm', text: '预览标签页效果',
              onclick: () => ctx.reloadPreview('/'),
            }))),
        ),
      el('p', { class: 'muted small', text:
        '建议上传正方形 PNG（至少 180×180，透明底更佳），也可以用 SVG。'
        + '上传后浏览器标签上的图标可能需要刷新页面（或关掉标签重开）才会更新——浏览器会缓存旧图标。' })),
  );
}

function favUploadBtn() {
  const inp = el('input', {
    type: 'file', accept: '.png,.svg,image/png,image/svg+xml', style: 'display:none',
    onchange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      try {
        await api('/api/favicon', { method: 'POST', raw: f, filename: f.name, timeout: 60000 });
        toast(`已更新网站图标：${f.name}`, 'ok', { timeout: 5000 });
        await reloadFavicon();
      } catch (err) { reportError(err); }
    },
  });
  const btn = el('button', { class: 'btn btn-primary btn-sm', text: '上传新图标…', onclick: () => inp.click() });
  // 把 input 挂在按钮旁边，方便点击触发
  queueMicrotask(() => btn.parentElement?.append(inp));
  return btn;
}

async function reloadFavicon() {
  try { fav = await api('/api/favicon'); } catch { /* 保持原状态 */ }
  ctx.reloadPreview('/');
  await refreshFaviconPreview();
  await ctx.refreshStatus();
}

/**
 * 预览当前图标。
 * 主题输出的图标是 Hugo 处理过的带哈希地址（/media/icon_hu_xxx.png），
 * 没法直接拼出来，所以从预览站点的 HTML 里读 <link rel="icon">。
 */
async function refreshFaviconPreview() {
  if (!favImg || !favHint) return;
  const fromTheme = !fav.rel;
  let url = '';
  try {
    const html = await (await fetch('/zh/', { cache: 'no-store' })).text();
    const m = /<link\s+rel="icon"[^>]*href="([^"]+)"/i.exec(html);
    if (m) url = m[1];
  } catch { /* 预览没起来时忽略 */ }
  if (url) {
    favImg.src = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    favImg.style.display = 'block';
  } else {
    favImg.style.display = 'none';
  }
  favHint.textContent = fromTheme
    ? '当前：主题自带的默认图标（HugoBlox）。上传一张自己的图标即可替换。'
    : `当前：${fav.rel}（${fav.isSvg ? 'SVG' : 'PNG'}，${fmtSize(fav.size)}）`;
}

function fmtSize(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
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
