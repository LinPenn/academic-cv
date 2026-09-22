/**
 * 模块：概览
 */

import { api, el, clear, section, toast, reportError, spinner, fmtTime } from '../core.js';

let ctx = null;

export default {
  id: 'dashboard',
  label: '概览',
  icon: '🏠',
  group: '开始',
  title: '概览',
  desc: '网站概况与快捷入口。',

  async mount(root, context) {
    ctx = context;
    root.append(spinner());
    let st;
    try {
      st = await api('/api/state');
    } catch (err) { reportError(err); return; }

    const quick = [
      ['people', '成员与导师', '增删成员、改导师信息'],
      ['news', '新闻动态', '发布一条实验室新闻'],
      ['faculty', '导师主页', '补论文、软著、获奖'],
      ['publications', '论文发表', '维护论文列表'],
      ['pages', '页面文字', '改首页、研究、招生、联系'],
      ['media', '图片素材', '上传照片和图片'],
      ['settings', '站点设置', '站点名称、导航菜单'],
      ['publish', '发布到 GitHub', '把改动推送到线上'],
    ];

    clear(root).append(
      el('h1', { class: 'page-title' }, '实验室网站编辑器'),
      el('p', { class: 'page-desc', text: '在这里修改网站内容，右侧可以实时预览；改好后点右上角「发布到 GitHub」，网站会在 1~2 分钟后自动更新。' }),

      el('div', { class: 'grid-3' }, ...quick.map(([id, title, desc]) => el('button', {
        class: 'card', style: 'text-align:left;cursor:pointer;margin:0',
        onclick: () => ctx.navigate(id),
      },
      el('div', { style: 'font-weight:600;margin-bottom:4px' }, title),
      el('div', { class: 'muted small', text: desc })))),

      section('当前状态',
        el('dl', { class: 'kv' },
          el('dt', { text: '网站名称' }), el('dd', { text: st.site.title || '(未设置)' }),
          el('dt', { text: '线上地址' }), el('dd', {}, el('a', { href: st.site.baseURL, target: '_blank', text: st.site.baseURL })),
          el('dt', { text: '本地预览' }), el('dd', {}, st.preview.running
            ? el('span', { class: 'chip chip-ok', text: '运行中' })
            : el('span', { class: 'chip chip-warn', text: st.preview.error || '未启动' })),
          el('dt', { text: 'Hugo' }), el('dd', { class: 'mono small', text: st.hugo.ok ? st.hugo.version : (st.hugo.message || '未找到') }),
          el('dt', { text: '待提交' }), el('dd', {}, st.git.clean
            ? el('span', { class: 'chip chip-ok', text: '无改动' })
            : el('span', { class: 'chip chip-warn', text: `${st.git.files} 个文件` })),
          el('dt', { text: '待推送' }), el('dd', {}, st.git.ahead > 0
            ? el('span', { class: 'chip chip-warn', text: `${st.git.ahead} 个提交` })
            : el('span', { class: 'chip chip-ok', text: '已同步' })),
          st.git.behind > 0 ? el('dt', { text: '提醒' }) : null,
          st.git.behind > 0 ? el('dd', {}, el('span', { class: 'chip chip-err', text: `远端有 ${st.git.behind} 个新提交` })) : null),
        el('div', { class: 'row', style: 'margin-top:10px' },
          el('button', { class: 'btn btn-ghost btn-sm', text: '刷新状态', onclick: () => ctx.reload() }),
          !st.preview.running ? el('button', {
            class: 'btn btn-ghost btn-sm', text: '启动预览',
            onclick: async () => {
              try { await api('/api/preview/start', { method: 'POST' }); toast('预览已启动', 'ok'); ctx.reload(); } catch (err) { reportError(err); }
            },
          }) : null)),

      section('给维护者的说明',
        el('div', { class: 'notice' },
          el('p', { text: '1. 在左侧选择要修改的内容，改完点右下角「保存」——这一步只是写入本地文件。' }),
          el('p', { text: '2. 右侧预览会立即刷新，确认效果没问题。' }),
          el('p', { text: '3. 最后到「发布到 GitHub」点「提交并推送」，GitHub 会自动构建并发布网站。' }),
          el('p', { class: 'muted small', text: '所有改动都有备份（高级工具 → 备份），误删的内容可以从回收站找回。' }))),
    );
    ctx.markDirty(false);
  },
};
