/**
 * 编辑器前端核心：请求封装、DOM 小工具、表单组件、弹窗、提示条
 */

export async function api(path, { method = 'GET', body, raw, filename, timeout = 20000 } = {}) {
  const opts = { method, headers: {} };
  // 加超时：万一服务端无响应，界面要给出明确错误，而不是一直转圈
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  if (controller) {
    opts.signal = controller.signal;
    setTimeout(() => controller.abort(), timeout);
  }
  if (method !== 'GET') opts.headers['x-editor'] = '1';
  if (filename) opts.headers['x-filename'] = encodeURIComponent(filename);
  if (raw !== undefined) {
    opts.body = raw;
  } else if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`请求超时（${timeout / 1000} 秒无响应）：${path}。请确认编辑器服务还在运行。`);
    throw new Error(`无法连接编辑器服务：${err.message}。请确认 http://127.0.0.1 上的编辑器服务还在运行。`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok || (data && data.error)) {
    const err = new Error((data && data.error) || `请求失败（HTTP ${res.status}）`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* DOM 工具                                                            */
/* ------------------------------------------------------------------ */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') node[k] = !!v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * 往容器里追加子节点，自动忽略 null / undefined / false。
 *
 * 为什么需要它：原生 Element.append(null) 会插入一个内容为 "null" 的文本节点，
 * 页面上就会莫名多出 "null" 字样。el() 内部已做过滤，但直接对容器写
 * `.append(cond ? x : null)` 就会有这个问题，所以统一改用本函数。
 */
export function appendAll(parent, ...children) {
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}

export function input({ label, value = '', placeholder = '', hint, onInput, type = 'text', wide = false, rows }) {
  const control = rows
    ? el('textarea', { rows: String(rows), placeholder, oninput: (e) => onInput?.(e.target.value) }, value ?? '')
    : el('input', { type, value: value ?? '', placeholder, oninput: (e) => onInput?.(e.target.value) });
  return el('label', { class: `fld${wide ? ' fld-wide' : ''}` },
    el('span', { class: 'fld-label', text: label }),
    control,
    hint ? el('span', { class: 'fld-hint', text: hint }) : null);
}

export function select({ label, value, options, onChange, hint }) {
  const sel = el('select', { onchange: (e) => onChange?.(e.target.value) },
    options.map((o) => el('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  return el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: label }), sel,
    hint ? el('span', { class: 'fld-hint', text: hint }) : null);
}

export function checkbox({ label, checked, onChange, hint }) {
  return el('label', { class: 'fld fld-check' },
    el('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onChange?.(e.target.checked) }),
    el('span', { text: label }),
    hint ? el('span', { class: 'fld-hint', text: hint }) : null);
}

/** 多行文本 ⇄ 字符串数组（每行一项，去掉空行） */
export function linesField({ label, value = [], onChange, hint, rows = 5, placeholder }) {
  return input({
    label,
    value: (value ?? []).join('\n'),
    rows: Math.max(rows, Math.min((value ?? []).length + 2, 16)),
    hint: hint ?? '每行一条',
    placeholder,
    onInput: (v) => onChange?.(v.split('\n').map((s) => s.trim()).filter(Boolean)),
  });
}

/**
 * 可增删排序的列表编辑器
 * @param {{items: any[], render: (item, index, update)=>Node, onChange:(items:any[])=>void,
 *          create: ()=>any, addLabel?: string, collapsible?: boolean, itemTitle?:(item,i)=>string}} cfg
 */
export function listEditor(cfg) {
  const state = { items: structuredClone(cfg.items ?? []) };
  const wrap = el('div', { class: 'list-editor' });
  const body = el('div', { class: 'list-body' });
  const emit = () => { cfg.onChange?.(state.items); };
  const rerender = () => {
    clear(body);
    state.items.forEach((item, index) => {
      const update = () => { emit(); };
      const card = el('div', { class: 'list-item' + (cfg.collapsible ? ' collapsible' : '') });
      const head = el('div', { class: 'list-item-head' },
        cfg.itemTitle
          ? el('button', {
            type: 'button', class: 'list-item-title',
            onclick: () => card.classList.toggle('open'),
          }, cfg.itemTitle(item, index))
          : null,
        el('div', { class: 'list-item-actions' },
          iconBtn('↑', '上移', () => { if (index > 0) { move(state.items, index, index - 1); rerender(); emit(); } }),
          iconBtn('↓', '下移', () => { if (index < state.items.length - 1) { move(state.items, index, index + 1); rerender(); emit(); } }),
          iconBtn('复制', '复制一份', () => { state.items.splice(index + 1, 0, structuredClone(item)); rerender(); emit(); }),
          iconBtn('✕', '删除', () => { state.items.splice(index, 1); rerender(); emit(); }, 'danger')));
      card.append(head);
      const content = el('div', { class: 'list-item-body' }, cfg.render(item, index, () => { rerender(); update(); }));
      card.append(content);
      if (cfg.collapsible && index > 0) card.classList.remove('open');
      else card.classList.add('open');
      body.append(card);
    });
    if (!state.items.length) body.append(el('p', { class: 'muted', text: '暂无内容' }));
  };
  wrap.append(body, el('button', {
    type: 'button', class: 'btn btn-ghost',
    onclick: () => { state.items.push(cfg.create ? cfg.create() : {}); rerender(); emit(); },
  }, `+ ${cfg.addLabel ?? '添加一项'}`));
  rerender();
  wrap.items = state.items;
  return wrap;
}

function move(arr, from, to) {
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
}

export function iconBtn(text, title, onClick, kind = '') {
  return el('button', { type: 'button', class: `icon-btn ${kind}`, title, onclick: onClick, text });
}

export function section(title, ...children) {
  return el('section', { class: 'card' }, el('h3', { class: 'card-title', text: title }), ...children);
}

/* ------------------------------------------------------------------ */
/* 提示条 / 弹窗                                                       */
/* ------------------------------------------------------------------ */

let toastHost = null;
export function toast(message, kind = 'ok', { timeout = 4200, action } = {}) {
  toastHost = toastHost ?? document.getElementById('toasts');
  const node = el('div', { class: `toast toast-${kind}` },
    el('div', { class: 'toast-msg', text: message }),
    action ? el('button', { class: 'toast-action', text: action.label, onclick: () => { action.onClick(); node.remove(); } }) : null,
    el('button', { class: 'toast-close', text: '✕', onclick: () => node.remove() }));
  toastHost.append(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
  return node;
}

export function reportError(err) {
  const msg = err?.message ?? String(err);
  toast(msg, 'error', { timeout: 12000 });
  console.error(err);
}

export function modal({ title, content, actions = [], wide = false }) {
  const shell = el('div', { class: 'modal-overlay' });
  const close = () => shell.remove();
  const box = el('div', { class: `modal-box${wide ? ' modal-wide' : ''}` });
  box.append(
    el('div', { class: 'modal-head' },
      el('h2', { text: title }),
      el('button', { class: 'modal-close', text: '✕', onclick: close })),
    el('div', { class: 'modal-body' }, content),
    el('div', { class: 'modal-foot' }, ...actions.map((a) => el('button', {
      class: `btn ${a.kind ?? 'btn-primary'}`, text: a.label, onclick: () => a.onClick?.(close),
    }))),
  );
  shell.append(box);
  shell.addEventListener('click', (e) => { if (e.target === shell) close(); });
  shell.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.append(shell);
  return { close, node: box };
}

export function diffView(diff) {
  if (!diff || !diff.lines?.length) return el('p', { class: 'muted', text: '没有改动' });
  return el('div', { class: 'diff' },
    el('p', { class: 'muted', text: `共 ${diff.changed} 行发生变化${diff.truncated ? '（仅显示前 300 行）' : ''}` }),
    ...diff.lines.map((l) => el('pre', { class: `diff-line diff-${l.type === ' ' ? 'ctx' : l.type === '+' ? 'add' : l.type === '-' ? 'del' : 'gap'}`, text: `${l.type}${l.text}` })));
}

/** 保存结果 → 提示条（带「查看改动」） */
export function reportSave(res, { label = '已保存' } = {}) {
  if (!res?.changed) {
    toast('没有需要保存的改动', 'info', { timeout: 2600 });
    return;
  }
  const n = res.diff?.changed ?? 0;
  toast(`${label}（改动 ${n} 行）`, 'ok', {
    action: res.diff ? { label: '查看改动', onClick: () => modal({ title: '本次改动', content: diffView(res.diff), wide: true, actions: [{ label: '关闭', kind: 'btn-ghost', onClick: (c) => c() }] }) } : null,
  });
}

export function confirmDialog(title, message, onConfirm) {
  modal({
    title,
    content: el('p', { text: message }),
    actions: [
      { label: '取消', kind: 'btn-ghost', onClick: (c) => c() },
      { label: '确定', kind: 'btn-danger', onClick: (c) => { c(); onConfirm(); } },
    ],
  });
}

export function spinner(text = '加载中…') {
  return el('div', { class: 'loading' }, el('span', { class: 'spin' }), text);
}

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

export function fmtTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** 上传图片：返回后端结果 */
export async function uploadFile(file, { subdir = '' } = {}) {
  const q = new URLSearchParams();
  if (subdir) q.set('subdir', subdir);
  return api(`/api/media/upload?${q}`, { method: 'POST', raw: file, filename: file.name });
}

/** 一个「图片路径」输入框 + 选择/上传按钮 */
export function imageField({ label, value = '', onChange, hint }) {
  const preview = el('img', { class: 'img-preview', alt: '' });
  const sync = (v) => {
    preview.src = v ? withBase(v) : '';
    preview.style.display = v ? '' : 'none';
  };
  const text = el('input', { type: 'text', value: value ?? '', placeholder: 'uploads/xxx.jpg', oninput: (e) => { onChange?.(e.target.value); sync(e.target.value); } });
  sync(value);
  const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const res = await uploadFile(f);
      text.value = res.frontMatterPath;
      onChange?.(res.frontMatterPath);
      sync(res.frontMatterPath);
      toast(`已上传：${res.rel}${res.warnings?.length ? `（${res.warnings.join('；')}）` : ''}`, res.warnings?.length ? 'info' : 'ok');
    } catch (err) { reportError(err); }
    e.target.value = '';
  } });
  return el('div', { class: 'fld fld-wide' },
    el('span', { class: 'fld-label', text: label }),
    el('div', { class: 'img-field' },
      preview,
      el('div', { class: 'img-field-main' },
        text,
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn btn-ghost', text: '上传图片…', onclick: () => fileInput.click() }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: '从素材库选择', onclick: () => pickImage((p, isRaw) => { text.value = p; onChange?.(p); sync(p); }) }),
          fileInput))),
    hint ? el('span', { class: 'fld-hint', text: hint }) : null);
}

let basePathCache = '/';
export function setBasePath(p) { basePathCache = p || '/'; }
export function withBase(p) {
  if (!p) return '';
  if (/^(https?:)?\/\//.test(p) || p.startsWith('data:')) return p;
  const clean = p.replace(/^\/+/, '');
  return basePathCache + clean;
}

/**
 * 把素材库路径（uploads/xxx.jpg）转成「正文 markdown」里必须用的绝对路径（/uploads/xxx.jpg）。
 *
 * 为什么必须绝对：front matter 里的图片路径会被 layouts 用 absURL 拼成绝对地址，
 * 所以写相对的没问题；但正文里的 ![](uploads/xxx.jpg) 是浏览器按「当前页面 URL」解析的，
 * 在 /blog/xxx/ 这类子页面下会变成 /blog/xxx/uploads/xxx.jpg → 404。
 */
export function mediaUrl(p) {
  const v = String(p ?? '').trim();
  if (!v) return '';
  if (/^(https?:)?\/\//.test(v) || v.startsWith('data:') || v.startsWith('/')) return v;
  return '/' + v.replace(/^\.?\//, '');
}

/** 素材库选择弹窗 */
export async function pickImage(onPick) {
  try {
    const data = await api('/api/media');
    const images = data.uploads.filter((u) => u.isImage);
    const grid = el('div', { class: 'media-grid' }, ...images.map((img) => el('button', {
      type: 'button', class: 'media-cell', title: img.frontMatterPath,
      onclick: (e) => { e.preventDefault(); onPick(img.frontMatterPath, false); e.target.closest('.modal-overlay').remove(); },
    },
    el('img', { src: img.url, alt: img.name, loading: 'lazy' }),
    el('span', { class: 'media-name', text: img.name }))));
    modal({
      title: '从素材库选择图片',
      wide: true,
      content: images.length ? grid : el('p', { class: 'muted', text: '素材库还是空的，请先在「图片素材」里上传。' }),
      actions: [{ label: '关闭', kind: 'btn-ghost', onClick: (c) => c() }],
    });
  } catch (err) { reportError(err); }
}

/** 站内链接提示：把 markdown 工具条插入到 textarea 光标处 */
export function insertAtCursor(textarea, before, after = '', placeholder = '') {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const sel = textarea.value.slice(start, end) || placeholder;
  textarea.setRangeText(`${before}${sel}${after}`, start, end, 'end');
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
