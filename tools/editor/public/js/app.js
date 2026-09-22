/**
 * 编辑器外壳：侧栏导航、路由、预览面板、保存条、状态
 */

import * as core from './core.js';
import dashboard from './modules/dashboard.js';
import people from './modules/people.js';
import profiles from './modules/profiles.js';
import faculty from './modules/faculty.js';
import news from './modules/news.js';
import publications from './modules/publications.js';
import pages from './modules/pages.js';
import media from './modules/media.js';
import settings from './modules/settings.js';
import layout from './modules/layout.js';
import homePhotos from './modules/homePhotos.js';
import logo from './modules/logo.js';
import research from './modules/research.js';
import resourcesM from './modules/resources.js';
import researchPages from './modules/researchPages.js';
import publish from './modules/publish.js';
import advanced from './modules/advanced.js';

const MODULES = [dashboard, people, profiles, faculty, news, publications, research, researchPages, resourcesM, pages, media, homePhotos, logo, settings, layout, publish, advanced];
const byId = new Map(MODULES.map((m) => [m.id, m]));

const contentEl = document.getElementById('content');
const sidebarEl = document.getElementById('sidebar');
const mainEl = document.getElementById('main');
const chipsEl = document.getElementById('status-chips');

const state = {
  current: null,
  dirty: false,
  saveFn: null,
  basePath: '/',
  previewPath: '/',
  previewVisible: true,
  query: {},
};

/* ------------------------------------------------------------------ */
/* ctx：提供给各模块的接口                                             */
/* ------------------------------------------------------------------ */

const ctx = {
  get query() { return state.query; },
  basePath: () => state.basePath,
  api: core.api,
  navigate: (id, query) => navigate(id, query),
  markDirty(v) {
    state.dirty = !!v;
    renderSaveBar();
  },
  registerSave(fn) {
    state.saveFn = fn;
    // 模块是在渲染完成后才注册保存回调的，注册后必须刷新保存条，
    // 否则会一直显示「本页无需保存」。
    renderSaveBar();
  },
  setPreview(path) { if (path) state.previewPath = path; syncPreview(); },
  reloadPreview(path) {
    if (path) state.previewPath = path;
    syncPreview();
  },
  async refreshStatus() { await refreshStatus(); },
  reload() { if (state.current) mount(state.current, { keepDirty: false }); },
};

/* ------------------------------------------------------------------ */
/* 导航                                                               */
/* ------------------------------------------------------------------ */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [id, qs] = raw.split('?');
  const query = {};
  if (qs) for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  return { id: id || 'dashboard', query };
}

function navigate(id, query = {}) {
  const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  location.hash = `#/${id}${qs ? `?${qs}` : ''}`;
}

function renderSidebar() {
  core.clear(sidebarEl);
  const groups = new Map();
  for (const m of MODULES) {
    const g = m.group ?? '其它';
    groups.set(g, [...(groups.get(g) ?? []), m]);
  }
  for (const [group, mods] of groups) {
    const box = core.el('div', { class: 'nav-group' }, core.el('div', { class: 'nav-group-title', text: group }));
    for (const m of mods) {
      box.append(core.el('button', {
        class: `nav-item${state.current === m.id ? ' active' : ''}`,
        onclick: () => navigate(m.id),
      }, core.el('span', { class: 'ico', text: m.icon ?? '•' }), core.el('span', { text: m.label })));
    }
    sidebarEl.append(box);
  }
}

async function mount(id, { keepDirty = false } = {}) {
  const mod = byId.get(id) ?? dashboard;
  state.current = mod.id;
  state.saveFn = null;
  if (!keepDirty) state.dirty = false;
  renderSidebar();
  renderSaveBar();
  contentEl.scrollTop = 0;
  if (mod.previewPath) ctx.setPreview(mod.previewPath);
  document.title = `${mod.label} · 实验室网站编辑器`;
  try {
    await mod.mount(contentEl, ctx);
  } catch (err) {
    core.reportError(err);
  }
}

/* ------------------------------------------------------------------ */
/* 保存条                                                             */
/* ------------------------------------------------------------------ */

let saveBar = null;

function renderSaveBar() {
  if (!saveBar) {
    saveBar = core.el('div', { class: 'savebar' });
    document.querySelector('.app').append(saveBar);
  }
  core.clear(saveBar);
  const hasSave = typeof state.saveFn === 'function';
  core.appendAll(saveBar, 
    core.el('span', { class: state.dirty ? 'dirty' : 'clean', text: state.dirty ? '● 有未保存的改动' : '○ 暂无改动' }),
    core.el('span', { class: 'spacer', style: 'flex:1' }),
    hasSave ? core.el('button', {
      class: 'btn btn-ghost', text: '放弃改动',
      disabled: !state.dirty,
      onclick: () => core.confirmDialog('放弃改动', '将重新载入文件内容，未保存的修改会丢失。确定吗？', () => ctx.reload()),
    }) : null,
    hasSave ? core.el('button', {
      class: 'btn btn-primary', text: '保存', disabled: !state.dirty,
      onclick: () => doSave(),
    }) : core.el('span', { class: 'muted small', text: '本页无需保存' }),
  );
  saveBar.classList.toggle('with-preview', state.previewVisible);
}

async function doSave() {
  if (!state.saveFn) return;
  const btns = saveBar.querySelectorAll('button');
  btns.forEach((b) => { b.disabled = true; });
  try {
    await state.saveFn();
  } catch (err) {
    core.reportError(err);
  } finally {
    renderSaveBar();
  }
}

/* ------------------------------------------------------------------ */
/* 预览面板                                                           */
/* ------------------------------------------------------------------ */

let previewPane = null;
let previewFrame = null;
let previewPathEl = null;
let previewStateEl = null;
let restartBtn = null;

function ensurePreview() {
  if (previewPane) return;
  previewFrame = core.el('iframe', { class: 'preview-frame', title: '站点预览' });
  previewPathEl = core.el('span', { class: 'path' });
  previewStateEl = core.el('span', { class: 'chip', text: '' });
  restartBtn = core.el('button', {
    class: 'btn btn-ghost btn-sm', text: '重启预览', style: 'display:none',
    onclick: async () => {
      restartBtn.disabled = true;
      try {
        await core.api('/api/preview/start', { method: 'POST' });
        core.toast('预览已重启', 'ok');
        syncPreview();
      } catch (err) { core.reportError(err); } finally { restartBtn.disabled = false; }
    },
  });
  const reload = () => syncPreview();
  previewPane = core.el('div', { class: 'preview-pane' },
    core.el('div', { class: 'preview-head' },
      previewPathEl,
      previewStateEl,
      restartBtn,
      core.el('button', { class: 'btn btn-ghost btn-sm', text: '刷新', onclick: reload }),
      core.el('button', {
        class: 'btn btn-ghost btn-sm', text: '新窗口打开',
        onclick: () => window.open(state.previewPath, '_blank'),
      }),
      core.el('button', { class: 'btn btn-ghost btn-sm', text: '✕', title: '隐藏预览', onclick: () => togglePreview(false) })),
    previewFrame);
  mainEl.append(previewPane);
}

async function refreshPreviewStatus() {
  try {
    const st = await core.api('/api/preview');
    if (!previewStateEl) return;
    core.clear(previewStateEl);
    if (st.running) {
      previewStateEl.className = 'chip chip-ok';
      previewStateEl.textContent = st.autoRestarts ? `预览运行中（已自动重启 ${st.autoRestarts} 次）` : '预览运行中';
      if (restartBtn) restartBtn.style.display = 'none';
    } else {
      previewStateEl.className = 'chip chip-err';
      previewStateEl.textContent = st.error ? '预览已停止' : '预览未启动';
      if (restartBtn) restartBtn.style.display = '';
    }
  } catch { /* 状态查询失败不影响预览 */ }
}

function syncPreview() {
  ensurePreview();
  let path = state.previewPath || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  const full = state.basePath.replace(/\/$/, '') + path;
  previewPathEl.textContent = full;
  // 始终带一个时间戳参数，避免浏览器复用旧页面（Hugo 重建后内容会变）
  previewFrame.src = `${full}${full.includes('?') ? '&' : '?'}_t=${Date.now()}`;
  refreshPreviewStatus();
}

function togglePreview(on) {
  state.previewVisible = on ?? !state.previewVisible;
  if (state.previewVisible) {
    ensurePreview();
    previewPane.style.display = '';
    mainEl.classList.add('with-preview');
    syncPreview();
  } else if (previewPane) {
    previewPane.style.display = 'none';
    mainEl.classList.remove('with-preview');
  }
  document.getElementById('btn-toggle-preview').classList.toggle('btn-primary', state.previewVisible);
  renderSaveBar();
}

/* ------------------------------------------------------------------ */
/* 状态栏                                                             */
/* ------------------------------------------------------------------ */

let lastStatus = null;

async function refreshStatus() {
  try {
    const st = await api0('/api/state');
    lastStatus = st;
    state.basePath = st.site.basePath || '/';
    core.setBasePath(state.basePath);
    core.clear(chipsEl);
    core.appendAll(chipsEl, 
      st.git.clean
        ? core.el('span', { class: 'chip chip-ok', text: '本地已保存' })
        : core.el('span', { class: 'chip chip-warn', text: `${st.git.files} 个文件待发布` }),
      st.git.ahead > 0 ? core.el('span', { class: 'chip chip-warn', text: `${st.git.ahead} 个提交待推送` }) : null,
      st.git.behind > 0 ? core.el('span', { class: 'chip chip-err', text: `远端有 ${st.git.behind} 个新提交` }) : null,
      !st.preview.running ? core.el('span', { class: 'chip chip-err', text: '预览未启动' }) : null,
    );
    document.getElementById('brand-site').textContent = st.site.baseURL || '';
    document.getElementById('brand-name').textContent = `${st.site.title || '实验室'}网站编辑器`;
  } catch (err) {
    console.error(err);
  }
}

async function api0(path, opts) { return core.api(path, opts); }

/* ------------------------------------------------------------------ */
/* 顶栏事件                                                           */
/* ------------------------------------------------------------------ */

document.getElementById('btn-check').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = '校验中…';
  try {
    const res = await core.api('/api/check', { method: 'POST' });
    if (res.ok) {
      core.toast(`构建成功（${(res.ms / 1000).toFixed(1)} 秒），改动没有问题${res.previewRestarted ? '；预览已自动重启' : ''}`, 'ok');
      refreshPreviewStatus();
    }
    else {
      core.toast(`构建失败，请检查`, 'error', { timeout: 12000 });
      core.modal({
        title: '构建失败详情',
        wide: true,
        content: core.el('div', {},
          ...(res.errors ?? []).map((t) => core.el('pre', { class: 'mono small', text: t })),
          core.el('pre', { class: 'mono small', style: 'max-height:300px;overflow:auto', text: res.output ?? '' })),
        actions: [{ label: '关闭', kind: 'btn-ghost', onClick: (c) => c() }],
      });
    }
  } catch (err) { core.reportError(err); } finally {
    btn.disabled = false;
    btn.textContent = '校验构建';
  }
});

document.getElementById('btn-open-site').addEventListener('click', () => {
  const url = lastStatus?.site?.baseURL ?? '/';
  window.open(url, '_blank');
});

document.getElementById('btn-toggle-preview').addEventListener('click', () => togglePreview());

document.getElementById('btn-publish').addEventListener('click', async () => {
  if (state.dirty) {
    core.toast('当前页面还有未保存的改动，请先保存', 'info');
    return;
  }
  navigate('publish');
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (state.dirty) doSave();
  }
});

let skipGuard = false;
window.addEventListener('hashchange', () => {
  const { id, query } = parseHash();
  // 离开当前页面会丢弃未保存的改动，先问一下
  if (!skipGuard && state.dirty && id !== state.current) {
    const ok = typeof window.confirm === 'function'
      ? window.confirm('当前页面还有未保存的改动，离开将丢失这些改动。确定离开吗？（按「取消」返回当前页面继续编辑）')
      : true;
    if (!ok) {
      skipGuard = true;
      location.hash = `#/${state.current}`;
      return;
    }
    state.dirty = false;
  }
  skipGuard = false;
  state.query = query;
  mount(id, { keepDirty: false });
});

/* ------------------------------------------------------------------ */
/* 启动                                                               */
/* ------------------------------------------------------------------ */

(async function boot() {
  try {
    // 状态刷新失败不应阻塞界面：先渲染页面，状态在后台刷新
    const statusPromise = refreshStatus();
    const { id, query } = parseHash();
    state.query = query;
    togglePreview(true);
    const hint = document.getElementById('boot-hint');
    if (hint) hint.remove();
    await mount(id);
    window.__editorReady = true;
    await statusPromise.catch(() => {});
    setInterval(() => refreshPreviewStatus(), 20000);
  } catch (err) {
    console.error(err);
    // 载入失败时明确告诉用户原因，而不是留下空白页
    const hint = document.getElementById('boot-hint');
    if (hint) hint.remove();
    if (typeof window.__editorShowError === 'function') {
      window.__editorShowError(`初始化失败：${err?.message ?? err}`);
    }
  }
})();
