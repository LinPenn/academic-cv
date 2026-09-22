/**
 * 模块：发布到 GitHub
 * ------------------------------------------------------------------
 * 站点部署链路：本地改动 → git 提交 → 推送到 GitHub → GitHub Actions 构建
 * → GitHub Pages 上线（通常 1~2 分钟）。这里把这条链路做成三个按钮。
 */

import {
  api, el, clear, section, toast, reportError, spinner, fmtTime, modal, appendAll,
} from '../core.js';

let ctx = null;
let root = null;
let st = null;

export default {
  id: 'publish',
  label: '发布到 GitHub',
  icon: '🚀',
  group: '站点',
  title: '发布到 GitHub',
  desc: '把本地改动提交并推送到 GitHub，触发自动构建与发布。',

  async mount(r, context) {
    ctx = context;
    root = r;
    await load();
  },
};

async function load() {
  clear(root).append(spinner());
  try {
    st = await api('/api/git/status');
  } catch (err) { reportError(err); return; }
  render();
}

function render() {
  clear(root);
  if (!st.isRepo) {
    root.append(el('div', { class: 'notice notice-warn', text: '当前目录不是 git 仓库，无法发布。' }));
    return;
  }
  const msgInput = el('input', {
    type: 'text',
    value: `content: 更新网站内容（${new Date().toLocaleDateString('zh-CN')}）`,
  });

  const changes = st.files.map((f) => el('tr', {},
    el('td', { class: 'mono small', text: f.code || 'M' }),
    el('td', { class: 'mono small', text: f.path })));

  appendAll(root, 
    el('h1', { class: 'page-title' }, '发布到 GitHub'),
    el('p', { class: 'page-desc', text: '改动只有在推送之后才会出现在正式网站上。流程：提交 → 推送 → GitHub 自动构建（约 1~2 分钟）→ 网站更新。' }),

    section('当前状态',
      el('dl', { class: 'kv' },
        el('dt', { text: '分支' }), el('dd', { class: 'mono', text: st.branch || '(未知)' }),
        el('dt', { text: '远端' }), el('dd', { class: 'mono', text: st.remoteUrl || '(未配置)' }),
        el('dt', { text: '本地改动' }), el('dd', {}, st.clean
          ? el('span', { class: 'chip chip-ok', text: '没有未提交的改动' })
          : el('span', { class: 'chip chip-warn', text: `${st.files.length} 个文件待提交` })),
        el('dt', { text: '待推送' }), el('dd', {}, st.ahead > 0
          ? el('span', { class: 'chip chip-warn', text: `${st.ahead} 个提交尚未推送` })
          : el('span', { class: 'chip chip-ok', text: '已与远端同步' })),
        st.behind > 0 ? el('dt', { text: '远端更新' }) : null,
        st.behind > 0 ? el('dd', {}, el('span', { class: 'chip chip-err', text: `远端有 ${st.behind} 个新提交，需要先拉取` })) : null,
        el('dt', { text: '线上站点' }), el('dd', {}, el('a', { href: st.pagesUrl, target: '_blank', text: st.pagesUrl })),
        el('dt', { text: '构建记录' }), el('dd', {}, st.actionsUrl ? el('a', { href: st.actionsUrl, target: '_blank', text: '在 GitHub 上查看 Actions' }) : '—')),
      !st.identityReady ? el('div', { class: 'notice notice-warn', style: 'margin-top:12px' },
        el('p', { text: 'Git 还没有配置提交者身份，无法提交。请在命令行执行一次：' }),
        el('pre', { class: 'mono small', text: 'git config --global user.name "你的名字"\ngit config --global user.email "你的邮箱"' })) : null),

    st.behind > 0 ? section('先拉取远端更新',
      el('p', { class: 'muted', text: '别人（或你在别处）已经往 GitHub 推了新内容。直接推送会被拒绝，先拉取合并。' }),
      el('button', { class: 'btn btn-primary', text: '拉取远端更新', onclick: doPull })) : null,

    section('发布',
      el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '提交说明' }), msgInput,
        el('span', { class: 'fld-hint', text: '会记录在 GitHub 的提交历史里，方便日后回溯' })),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-primary', text: '① 提交并推送到 GitHub', onclick: () => doCommitAndPush(msgInput.value) }),
        el('button', { class: 'btn btn-ghost', text: '只提交（暂不推送）', onclick: () => doCommit(msgInput.value) }),
        st.ahead > 0 ? el('button', { class: 'btn btn-ghost', text: `推送 ${st.ahead} 个待推送提交`, onclick: doPush }) : null,
        st.behind > 0 ? el('button', { class: 'btn btn-ghost', text: '拉取远端更新', onclick: doPull }) : null),
      el('div', { class: 'notice small', style: 'margin-top:12px' },
        el('p', { text: '推送后 GitHub 会自动构建并发布，通常 1~2 分钟后线上生效。' }),
        el('p', { text: '如果推送失败：多半是网络无法访问 github.com，或尚未登录 GitHub。首次推送会弹出登录窗口，登录一次即可。' }))),

    section(`待提交的改动（${st.files.length}）`,
      st.files.length
        ? el('div', { class: 'file-list' }, el('table', { class: 'tbl' }, el('tbody', {}, ...changes)))
        : el('p', { class: 'muted', text: '工作区是干净的。' })),

    section('最近的提交',
      el('table', { class: 'tbl' },
        el('tbody', {}, ...(st.log ?? []).map((c) => el('tr', {},
          el('td', { class: 'mono small', text: c.hash }),
          el('td', { class: 'small', text: c.subject }),
          el('td', { class: 'muted small', text: `${c.date} ${c.author}` })))))),
  );
}

/**
 * 网络慢或需要代理时，git push/pull 可能要几十秒。
 * 不能用默认的 20 秒超时，否则界面会在 git 真正返回前就放弃，看起来像「点了没反应」。
 */
const GIT_TIMEOUT = 180000;

async function doCommit(message) {
  try {
    const res = await api('/api/git/commit', { method: 'POST', body: { message, all: true }, timeout: 60000 });
    toast(res.message, res.changed ? 'ok' : 'info');
    await load();
    await ctx.refreshStatus();
  } catch (err) { reportError(err); }
}

async function doPush() {
  const t = toast('正在推送…（网络慢时可能要等十几秒，请不要关闭页面）', 'info', { timeout: 0 });
  try {
    const res = await api('/api/git/push', { method: 'POST', timeout: GIT_TIMEOUT });
    t.remove();
    toast(res.message || '已推送', 'ok', {
      action: st.actionsUrl ? { label: '查看构建进度', onClick: () => window.open(st.actionsUrl, '_blank') } : null,
      timeout: 12000,
    });
    await load();
    await ctx.refreshStatus();
  } catch (err) {
    t.remove();
    reportError(err);
  }
}

async function doPull() {
  const t = toast('正在拉取…', 'info', { timeout: 0 });
  try {
    const res = await api('/api/git/pull', { method: 'POST', timeout: GIT_TIMEOUT });
    t.remove();
    toast(res.message || '已拉取', 'ok');
    await load();
    ctx.reloadPreview();
  } catch (err) { t.remove(); reportError(err); }
}

async function doCommitAndPush(message) {
  const btn = toast('正在提交…', 'info', { timeout: 0 });
  try {
    const c = await api('/api/git/commit', { method: 'POST', body: { message, all: true }, timeout: 60000 });
    btn.remove();
    if (!c.changed) {
      const st2 = await api('/api/git/status');
      if (st2.ahead === 0) { toast('没有需要提交的改动', 'info'); await load(); return; }
    }
    await doPush();
  } catch (err) {
    btn.remove();
    reportError(err);
  }
}
