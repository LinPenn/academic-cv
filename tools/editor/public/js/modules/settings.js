/**
 * 模块：站点设置
 * 站点名称、简介、主题、导航菜单
 */

import { api, el, clear, input, section, toast, reportError, reportSave, spinner, iconBtn, confirmDialog } from '../core.js';

let ctx = null;
let root = null;
let s = null;

export default {
  id: 'settings',
  label: '站点设置',
  icon: '⚙️',
  group: '站点',
  title: '站点设置',
  desc: '站点名称、简介、配色和导航菜单。修改后需要发布到 GitHub 才会在正式网站上生效。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await load();
  },
};

async function load() {
  clear(root).append(spinner());
  try {
    s = await api('/api/settings');
  } catch (err) { reportError(err); return; }
  render();
  ctx.setPreview('/');
  ctx.registerSave(save);
  ctx.markDirty(false);
}

function render() {
  clear(root);
  root.append(
    el('h1', { class: 'page-title' }, '站点设置'),
    el('p', { class: 'page-desc', text: '这些设置写在 config/_default/ 下的配置文件里。改完保存后，需要「发布到 GitHub」才会在线上生效。' }),

    section('站点名称与简介',
      el('div', { class: 'notice', style: 'margin-bottom:12px' },
        el('p', { text: `当前网站标题显示为「${s.brand.name || '(空)'}」。如果想让它显示实验室全称，把下面的「站点名称」改成中文名即可（例如：畜禽育种创新团队）。` })),
      input({ label: '站点名称', value: s.brand.name ?? '', hint: '显示在浏览器标签、页头和搜索结果里', onInput: (v) => { s.brand.name = v; dirty(); } }),
      input({ label: '一句话标语 (tagline)', value: s.brand.tagline ?? '', onInput: (v) => { s.brand.tagline = v; dirty(); } }),
      input({ label: '站点描述', rows: 3, value: s.brand.description ?? '', hint: '用于搜索引擎与社交分享', onInput: (v) => { s.brand.description = v; dirty(); } }),
      el('label', { class: 'fld' },
        el('span', { class: 'fld-label', text: '网站地址 (baseURL)' }),
        el('input', { type: 'text', value: s.site.baseURL ?? '', readonly: true }),
        el('span', { class: 'fld-hint', text: 'GitHub Pages 项目站点的地址，一般不需要改；如需修改请直接编辑 config/_default/hugo.yaml' }))),

    section('外观',
      el('div', { class: 'grid-2' },
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '明暗模式' }),
          el('select', { onchange: (e) => { s.theme.mode = e.target.value; dirty(); } },
            ...[['light', '浅色（白底）'], ['dark', '深色'], ['system', '跟随系统']].map(([v, l]) => el('option', { value: v, selected: s.theme.mode === v }, l)))),
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '配色方案' }),
          el('select', { onchange: (e) => { s.theme.pack = e.target.value; dirty(); } },
            ...[['contrast', '对比 (contrast)'], ['default', '默认']].map(([v, l]) => el('option', { value: v, selected: s.theme.pack === v }, l)))),
        input({ label: '主色调', value: s.theme.primary ?? '', hint: '留空使用默认；可填颜色名或 #2563eb', onInput: (v) => { s.theme.primary = v; dirty(); } }),
        input({ label: '强调色', value: s.theme.secondary ?? '', hint: '留空使用默认', onInput: (v) => { s.theme.secondary = v; dirty(); } }),
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '字体' }),
          el('select', { onchange: (e) => { s.theme.font = e.target.value; dirty(); } },
            ...[['sans', '无衬线（推荐）'], ['serif', '衬线']].map(([v, l]) => el('option', { value: v, selected: s.theme.font === v }, l)))),
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '页脚样式' }),
          el('select', { onchange: (e) => { s.theme.footerStyle = e.target.value; dirty(); } },
            ...[['minimal', '简洁'], ['standard', '标准']].map(([v, l]) => el('option', { value: v, selected: s.theme.footerStyle === v }, l))))),
      el('div', { class: 'row' },
        el('label', { class: 'fld fld-check' }, el('input', { type: 'checkbox', checked: s.theme.headerSearch, onchange: (e) => { s.theme.headerSearch = e.target.checked; dirty(); } }), el('span', { text: '显示站内搜索框' })),
        el('label', { class: 'fld fld-check' }, el('input', { type: 'checkbox', checked: s.theme.themeToggle, onchange: (e) => { s.theme.themeToggle = e.target.checked; dirty(); } }), el('span', { text: '显示明暗切换按钮' }))),
      input({ label: '版权信息', value: s.theme.copyright ?? '', hint: '可用 {year} 和 {name} 占位', onInput: (v) => { s.theme.copyright = v; dirty(); } })),

    menusCard(),

    section('保存说明',
      el('div', { class: 'notice' },
        el('p', { text: `站点名称写入 ${s.files.params} 与 ${s.files.languages}；导航菜单同时写入 ${s.files.menus} 与 ${s.files.languages}，两处会保持一致。` }),
        el('p', { text: '主题色等外观设置写入 config/_default/params.yaml。' }))),
  );
  ctx.markDirty(false);
}

function menusCard() {
  return section('导航菜单',
    el('p', { class: 'muted small', text: '页面顶部的菜单项，中英文各自一套。链接填站内路径（如 /research/，会自动带上语言前缀）或完整网址。' }),
    el('div', { class: 'grid-2' },
      menuColumn('en', '英文菜单（config/_default/menus.yaml）'),
      // 站点配置了中文（languages.yaml 里有 zh）才显示中文菜单
      (s.languages?.available ?? []).includes('zh')
        ? menuColumn('zh', '中文菜单（config/_default/menus.zh.yaml）')
        : null));
}

function menuColumn(lang, title) {
  if (!Array.isArray(s.menus[lang])) s.menus[lang] = [];
  const list = s.menus[lang];
  const box = el('div');
  const draw = () => {
    clear(box);
    list.forEach((m, i) => {
      box.append(el('div', { class: 'row', style: 'margin-bottom:6px' },
        el('input', {
          type: 'text', value: m.name ?? '', placeholder: '名称', style: 'width:120px',
          oninput: (e) => { m.name = e.target.value; dirty(); },
        }),
        el('input', {
          type: 'text', value: m.url ?? '', placeholder: '链接，如 /research/', style: 'flex:1',
          oninput: (e) => { m.url = e.target.value; dirty(); },
        }),
        el('input', {
          type: 'number', value: String(m.weight ?? 0), style: 'width:64px', title: '排序权重，越小越靠前',
          oninput: (e) => { m.weight = Number(e.target.value); dirty(); },
        }),
        iconBtn('↑', '上移', () => { if (i > 0) { swap(list, i, i - 1); draw(); dirty(); } }),
        iconBtn('↓', '下移', () => { if (i < list.length - 1) { swap(list, i, i + 1); draw(); dirty(); } }),
        iconBtn('✕', '删除', () => { list.splice(i, 1); draw(); dirty(); }, 'danger')));
    });
    if (!list.length) box.append(el('p', { class: 'muted small', text: '（空）' }));
  };
  draw();
  return el('div', {},
    el('p', { class: 'fld-label', text: title }),
    box,
    el('button', {
      class: 'btn btn-ghost btn-sm', text: '+ 添加菜单项',
      onclick: () => { list.push({ name: '新页面', url: '/', weight: (list.length + 1) * 10 }); draw(); dirty(); },
    }));
}


function swap(arr, a, b) { const t = arr[a]; arr[a] = arr[b]; arr[b] = t; }

async function save() {
  const res = await api('/api/settings', {
    method: 'POST',
    body: {
      site: { siteTitle: s.brand.name },
      brand: s.brand,
      theme: s.theme,
      languages: { description: s.brand.description },
      menus: { en: s.menus.en, zh: s.menus.zh },
    },
  });
  if (!res.changed) { toast('没有需要保存的改动', 'info'); return; }
  const n = res.results?.reduce((a, r) => a + (r.diff?.changed ?? 0), 0) ?? 0;
  toast(`设置已保存（共 ${n} 行改动，涉及 ${res.results.length} 个文件）`, 'ok', {
    action: res.results?.[0]?.diff ? {
      label: '查看改动',
      onClick: () => import('../core.js').then(({ diffView, modal }) => modal({ title: '设置改动', content: diffView(res.results[res.results.length - 1].diff), wide: true, actions: [{ label: '关闭', kind: 'btn-ghost', onClick: (c) => c() }] })),
    } : null,
  });
  ctx.markDirty(false);
  ctx.reloadPreview('/');
  await ctx.refreshStatus();
}

function dirty() { ctx.markDirty(true); }
