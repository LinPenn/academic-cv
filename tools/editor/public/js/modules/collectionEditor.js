/**
 * 通用的「页面集合」编辑器工厂
 * ------------------------------------------------------------------
 * 数据集（content/resources）和研究方向页面（content/research）结构相同：
 *   <目录>/<slug>/index.md      英文
 *   <目录>/<slug>/index.zh.md   中文（可选）
 *   <目录>/<slug>/featured.*    卡片封面
 * 这里把列表 / 新建 / 编辑（标题、简介、权重、封面、正文）/ 删除做成一整套，
 * 由各模块传入配置复用。
 *
 * 用法：
 *   export default makeCollectionEditor({ id:'resources', api:'/api/resources', ... });
 */

import {
  api, el, clear, section, toast, reportError, reportSave, spinner, iconBtn, confirmDialog,
  modal, input, appendAll,
} from '../core.js';

export function makeCollectionEditor(cfg) {
  const {
    id, label, icon, desc, apiBase, previewBase,
    itemName = '条目', dirHint = '', groups = null,
  } = cfg;

  const groupLabel = (v) => (groups ?? []).find((g) => g.value === v)?.label ?? v;

  let ctx = null;
  let root = null;
  let list = [];
  let doc = null;
  let lang = 'en';

  async function refresh() {
    clear(root).append(spinner());
    try {
      const data = await api(apiBase);
      list = data.items ?? [];
    } catch (err) { reportError(err); return; }
    doc = null;
    renderList();
  }

  function renderList() {
    clear(root);
    appendAll(root,
      el('h1', { class: 'page-title' }, label),
      el('p', { class: 'page-desc', text: desc }),
      dirHint ? el('p', { class: 'muted small mono', text: dirHint }) : null,
      section(`全部${itemName}`,
        list.length
          ? el('div', { class: 'stack' }, ...list.map((it) => row(it)))
          : el('p', { class: 'muted small', text: `还没有${itemName}。` }),
        el('div', { class: 'row', style: 'margin-top:10px' },
          el('button', { class: 'btn btn-primary btn-sm', text: `+ 新建${itemName}`, onclick: createDialog }),
          el('span', { class: 'muted small', text: `共 ${list.length} 个` }))),
    );
  }

  function row(it) {
    const thumb = it.cover
      ? el('img', {
        src: url(it.cover), alt: it.title,
        style: 'width:88px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--border);flex:0 0 auto',
      })
      : el('div', {
        style: 'width:88px;height:56px;border-radius:6px;border:1px dashed var(--border);flex:0 0 auto;'
          + 'display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:11px',
      }, '无封面');

    return el('div', { class: 'list-item' },
      el('div', { class: 'list-item-head' },
        el('button', {
          type: 'button', class: 'list-item-title',
          style: 'display:flex;align-items:center;gap:10px;background:none;border:0;cursor:pointer;padding:0;text-align:left',
          onclick: () => open(it.path),
        }, thumb, el('span', {},
          el('div', { text: it.title }),
          el('div', { class: 'muted small', text: `${groups && it.group ? groupLabel(it.group) + ' · ' : ''}${it.slug} · 权重 ${it.weight || '-'} · ${it.pathZh ? '有中文版' : '仅英文'}` }))),
        el('div', { class: 'list-item-actions' },
          iconBtn('✎', '编辑', () => open(it.path)),
          iconBtn('✕', '删除（回收站）', () => confirmDialog(`删除${itemName}`, `确定把「${it.title}」整个目录移入回收站吗？（可恢复）`, async () => {
            try {
              await api(`${apiBase}/delete`, { method: 'POST', body: { dir: it.dir } });
              toast('已移入回收站', 'ok');
              await refresh();
            } catch (err) { reportError(err); }
          }), 'danger'))));
  }

  function createDialog() {
    const title = el('input', { type: 'text', placeholder: '例如 DuckGTEx' });
    const slug = el('input', { type: 'text', placeholder: '目录名（留空自动按标题生成）' });
    const summary = el('input', { type: 'text', placeholder: '一句话简介（显示在卡片上）' });
    const weight = el('input', { type: 'number', value: '10' });
    const zh = el('input', { type: 'checkbox' });
    const groupSel = groups
      ? el('select', {}, ...groups.map((g) => el('option', { value: g.value }, g.label)))
      : null;

    modal({
      title: `新建${itemName}`,
      content: el('div', { class: 'stack' },
        groupSel ? el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '归到哪一组' }), groupSel) : null,
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '标题' }), title),
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '目录名 (slug)' }), slug),
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '简介' }), summary),
        el('label', { class: 'fld' }, el('span', { class: 'fld-label', text: '排序权重（小的在前）' }), weight),
        el('label', { class: 'fld fld-check' }, zh, el('span', { text: '同时创建中文版页面' })),
        el('p', { class: 'muted small', text: '创建后可以上传封面、填写正文。' })),
      actions: [
        { label: '创建', onClick: async (close) => {
          try {
            const res = await api(`${apiBase}/create`, {
              method: 'POST',
              body: {
                title: title.value, slug: slug.value, summary: summary.value,
                weight: weight.value, withZh: zh.checked,
                group: groupSel ? groupSel.value : undefined,
              },
            });
            close();
            toast('已创建', 'ok');
            await refresh();
            if (res?.dir) await open(`${res.dir}/index.md`);
          } catch (err) { reportError(err); }
        } },
        { label: '取消', kind: 'btn-ghost', onClick: (close) => close() },
      ],
    });
  }

  async function open(path) {
    clear(root).append(spinner());
    try {
      doc = await api(`${apiBase}/doc?path=${encodeURIComponent(path)}`);
    } catch (err) { reportError(err); return; }
    lang = 'en';
    renderEdit();
    ctx.setPreview(previewBase);
    ctx.registerSave(save);
    ctx.markDirty(false);
  }

  function renderEdit() {
    clear(root);
    const d = doc;

    const coverBox = el('div');
    const renderCover = () => {
      clear(coverBox);
      appendAll(coverBox,
        d.cover
          ? el('img', {
            src: url(d.cover), alt: '',
            style: 'width:260px;max-width:100%;border-radius:8px;border:1px solid var(--border)',
          })
          : el('div', {
            style: 'width:260px;height:140px;border:1px dashed var(--border);border-radius:8px;'
              + 'display:flex;align-items:center;justify-content:center;color:#9ca3af',
          }, '还没有封面'),
        el('div', { class: 'row', style: 'margin-top:8px' },
          el('button', { class: 'btn btn-ghost btn-sm', text: d.cover ? '更换封面…' : '上传封面…', onclick: pickCover }),
          d.cover ? el('button', {
            class: 'btn btn-danger btn-sm', text: '移除封面',
            onclick: () => confirmDialog('移除封面', '封面会移入回收站，可恢复。确定吗？', async () => {
              try {
                await api(`${apiBase}/cover?path=${encodeURIComponent(d.path)}&remove=1`, { method: 'POST', raw: new Blob([]), filename: 'x.png' });
                d.cover = '';
                renderCover();
                toast('已移除封面', 'ok');
              } catch (err) { reportError(err); }
            }),
          }) : null),
        el('p', { class: 'muted small', text: '建议宽度 1600px 以内；卡片会自动裁切为缩略图。' }));
    };
    renderCover();

    appendAll(root,
      el('div', { class: 'row', style: 'margin-bottom:8px' },
        el('button', { class: 'btn btn-ghost btn-sm', text: '← 返回列表', onclick: () => { ctx.registerSave(null); refresh(); } }),
        el('span', { class: 'muted small mono', text: d.dir }),
        el('span', { class: 'right row' },
          el('button', { class: 'btn btn-ghost btn-sm', text: '查看页面', onclick: () => ctx.reloadPreview(previewBase) }))),
      el('h1', { class: 'page-title' }, d.title || d.slug),

      section('封面', coverBox),

      section('基本信息',
        input({ label: '标题', value: d.title ?? '', onInput: (v) => { d.title = v; dirty(); } }),
        input({ label: '简介', rows: 2, value: d.summary ?? '', hint: '显示在列表页的卡片上', onInput: (v) => { d.summary = v; dirty(); } }),
        input({ label: '排序权重', value: String(d.weight ?? ''), hint: '数字小的排前面', onInput: (v) => { d.weight = v; dirty(); } })),

      section('正文',
        d.hasZh
          ? el('div', { class: 'row', style: 'margin-bottom:10px' },
            ...[['en', 'English'], ['zh', '中文']].map(([v, label2]) => el('button', {
              class: `btn ${lang === v ? 'btn-primary' : 'btn-ghost'} btn-sm`,
              text: label2,
              onclick: () => switchLang(v),
            })),
            el('span', { class: 'muted small', text: lang === 'zh' ? '正在编辑中文版' : '正在编辑英文版' }))
          : el('div', { class: 'notice' },
            el('p', { text: '还没有中文版。' }),
            el('button', {
              class: 'btn btn-ghost btn-sm', text: '创建中文版（复制当前正文）',
              onclick: async () => {
                try {
                  await api(`${apiBase}/save`, {
                    method: 'POST',
                    body: { path: `${d.dir}/index.zh.md`, title: d.title, summary: d.summary, weight: d.weight, body: d.body },
                  });
                  toast('中文版已创建', 'ok');
                  await open(d.path);
                } catch (err) { reportError(err); }
              },
            })),
        el('p', { class: 'muted small mono', text: lang === 'zh' && d.hasZh ? `${d.dir}/index.zh.md` : d.path }),
        el('textarea', {
          class: 'md-editor', rows: '18', value: d.body ?? '',
          oninput: (e) => { d.body = e.target.value; dirty(); },
        }),
        el('p', { class: 'muted small', text: '正文用 Markdown 写；图片可用「图片素材」模块上传后复制路径。' })),
    );
  }

  async function switchLang(v) {
    try { await save(); } catch { /* 保存失败也允许切换 */ }
    lang = v;
    await open(v === 'zh' ? `${doc.dir}/index.zh.md` : doc.path);
  }

  function pickCover() {
    const inp = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    document.body.append(inp);
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (!f) return;
      const t = toast('正在上传封面…', 'info', { timeout: 0 });
      try {
        const res = await api(`${apiBase}/cover?path=${encodeURIComponent(doc.path)}`, {
          method: 'POST', raw: f, filename: f.name,
        });
        t.remove();
        doc.cover = res.cover || doc.cover;
        renderEdit();
        toast('封面上传成功', 'ok');
      } catch (err) { t.remove(); reportError(err); }
    });
    inp.click();
  }

  function url(rel) {
    return `${ctx.basePath()}${String(rel).replace(/^content\//, '').replace(/^\//, '')}`;
  }

  async function save() {
    const path = lang === 'zh' && doc.hasZh ? `${doc.dir}/index.zh.md` : doc.path;
    const res = await api(`${apiBase}/save`, {
      method: 'POST',
      body: { path, title: doc.title, summary: doc.summary, weight: doc.weight, body: doc.body },
    });
    reportSave(res, { label: '已保存' });
    ctx.markDirty(false);
    ctx.reloadPreview(previewBase);
    await ctx.refreshStatus();
  }

  function dirty() { ctx.markDirty(true); }

  return {
    id,
    label,
    icon,
    group: '内容',
    title: label,
    desc,
    previewPath: previewBase,
    async mount(r, context) {
      ctx = context;
      root = r;
      await refresh();
    },
  };
}
