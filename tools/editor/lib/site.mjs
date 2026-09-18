/**
 * 内容模型层
 * ------------------------------------------------------------------
 * 每个模块负责：读出结构化数据 → 交给界面表单 → 回收表单值 → 只改动变化过的键。
 * 所有写入都经过「生成 → 重新解析 → 逐项校验 → 备份 → 原子落盘」，
 * 未改动的字段（含注释）字节级保留。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  parseFile, getFrontMatter, getPath, buildVerifiedText, applyBody, getBody, deepEqual,
  SaveError,
} from './frontmatter.mjs';
import {
  SITE_ROOT, readText, writeText, listDirs, listFiles, exists, trashPath,
  resolveSafe, createText, ensureEditorDirs, saveUpload,
} from './store.mjs';
import { unifiedDiff } from './diff.mjs';

export { SaveError };

/* ------------------------------------------------------------------ */
/* 通用文档读写                                                        */
/* ------------------------------------------------------------------ */

export function loadDoc(rel) {
  const { text, rel: r } = readText(rel);
  const doc = parseFile(text);
  return { rel: r, doc, text, fm: getFrontMatter(doc), body: getBody(doc) };
}

/** 纯 YAML 配置文件（config/_default/*.yaml，没有 --- 分隔符） */
export function loadYamlDoc(rel) {
  const { text, rel: r } = readText(rel);
  const doc = parseFile(text, { plain: true });
  if (doc.parseError) throw new SaveError(`${r} 解析失败：${doc.parseError}`);
  return { rel: r, doc, text, fm: getFrontMatter(doc) };
}

/**
 * 保存：keys 里只写「和当前值不同」的键。
 * @param {string} rel
 * @param {{keys?: Record<string, any>, body?: string, dryRun?: boolean, note?: string}} opts
 */
export function saveDocument(rel, { keys, body, dryRun = false, note = '' } = {}) {
  const { text, rel: r } = readText(rel);
  const doc = parseFile(text);
  if (doc.hasFrontMatter && doc.parseError) {
    throw new SaveError(
      `该文件的 front matter 无法解析（${doc.parseError}），为避免改坏文件，请用「原文编辑」手动修改。`,
    );
  }
  const current = getFrontMatter(doc);
  const changes = [];
  for (const [key, value] of Object.entries(keys ?? {})) {
    if (value === undefined) continue;
    if (!deepEqual(current[key], value)) changes.push({ path: [key], value });
  }

  let result = changes.length
    ? buildVerifiedText(doc, changes)
    : { text, doc, frontMatter: current };

  let finalText = result.text;
  let bodyChanged = false;
  if (typeof body === 'string') {
    const before = getBody(parseFile(finalText));
    if (before.replace(/\r\n?/g, '\n').trimEnd() !== body.replace(/\r\n?/g, '\n').trimEnd()) {
      finalText = applyBody(parseFile(finalText), body);
      bodyChanged = true;
      const check = parseFile(finalText);
      if (getFrontMatter(check) && JSON.stringify(getFrontMatter(check)) !== JSON.stringify(result.frontMatter)) {
        throw new SaveError('写入正文后 front matter 发生了变化，已取消保存');
      }
    }
  }

  const diff = unifiedDiff(text, finalText);
  if (finalText === text) {
    return { rel: r, changed: false, diff, warnings: [] };
  }
  if (dryRun) {
    return { rel: r, changed: true, diff, dryRun: true, preview: finalText, warnings: [] };
  }
  ensureEditorDirs();
  const { backupId } = writeText(r, finalText);
  return {
    rel: r,
    changed: true,
    backupId,
    diff,
    warnings: [],
    note,
    keysChanged: changes.map((c) => c.path[0]),
    bodyChanged,
  };
}

/* ------------------------------------------------------------------ */
/* 站点基本信息                                                        */
/* ------------------------------------------------------------------ */

export function getSiteInfo() {
  let hugo = {};
  try {
    hugo = loadYamlDoc('config/_default/hugo.yaml').fm;
  } catch (err) {
    console.warn('读取 hugo.yaml 失败：', err.message);
  }
  const baseURL = String(hugo.baseURL ?? '');
  let basePath = '/';
  try {
    basePath = new URL(baseURL).pathname || '/';
  } catch { /* 忽略：baseURL 可能是相对路径 */ }
  if (!basePath.endsWith('/')) basePath += '/';
  return {
    title: hugo.title ?? '',
    baseURL,
    basePath,
    remote: 'origin',
  };
}

/* ------------------------------------------------------------------ */
/* 模块：成员与导师                                                    */
/* ------------------------------------------------------------------ */

const PEOPLE_FILE = 'content/people/_index.md';

export function loadPeople() {
  const { rel, doc, fm } = loadDoc(PEOPLE_FILE);
  const authorSlugs = listDirs('content/authors').map((d) => path.basename(d));
  const groups = Array.isArray(fm.groups) ? fm.groups : [];
  return {
    path: rel,
    title: fm.title ?? 'People',
    pi: fm.pi ?? {},
    groups: groups.map((g) => ({
      category: g?.category ?? '',
      members: Array.isArray(g?.members) ? g.members : [],
    })),
    otherKeys: Object.keys(fm).filter((k) => !['title', 'pi', 'groups'].includes(k)),
    authorSlugs,
    extraKeysOnPi: Object.keys(fm.pi ?? {}).filter(
      (k) => !['name', 'photo', 'roles', 'interests', 'faculty_url', 'email', 'orcid', 'github'].includes(k),
    ),
  };
}

export function savePeople({ title, pi, groups, dryRun = false, createAuthorPages = [] }) {
  const keys = {};
  if (title !== undefined) keys.title = title;
  if (pi !== undefined) keys.pi = cleanUndefined(pi);
  if (groups !== undefined) keys.groups = groups.map((g) => cleanUndefined({
    category: g.category,
    members: (g.members ?? []).map((m) => cleanUndefined(m)),
  }));
  const res = saveDocument(PEOPLE_FILE, { keys, dryRun, note: '更新成员名单' });
  const created = [];
  if (!dryRun) {
    for (const slug of createAuthorPages) {
      const target = `content/authors/${slug}/_index.md`;
      if (exists(target)) continue;
      const name = findMemberName(groups, slug) ?? slug;
      createText(target, `---\ntitle: "${String(name).replace(/"/g, '\\"')}"\n---\n`);
      created.push(target);
    }
  }
  return { ...res, createdAuthors: created };
}

function findMemberName(groups, slug) {
  for (const g of groups ?? []) {
    for (const m of g.members ?? []) if (m.slug === slug) return m.name;
  }
  return null;
}

function cleanUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === undefined) continue;
    if (v === '' && k !== 'email' && k !== 'bio') {
      // 空字符串一律写成空值：Hugo 对 ''/null 都能处理，但空字段更干净
      out[k] = '';
      continue;
    }
    out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 模块：导师主页                                                      */
/* ------------------------------------------------------------------ */

export function listFaculty() {
  const files = listFiles('content/faculty', { filter: (p) => /\.md$/i.test(p) });
  return files.map((f) => {
    try {
      const { fm } = loadDoc(f.rel);
      return { path: f.rel, title: fm.title ?? path.basename(f.rel, '.md') };
    } catch {
      return { path: f.rel, title: path.basename(f.rel, '.md') };
    }
  });
}

export function loadFaculty(rel) {
  const { rel: r, doc, fm } = loadDoc(rel);
  const sections = Array.isArray(fm.sections) ? fm.sections : [];
  return {
    path: r,
    title: fm.title ?? '',
    photo: fm.photo ?? '',
    bio: fm.bio ?? '',
    type: fm.type ?? 'faculty',
    sections: sections.map((s, i) => ({
      index: i,
      title: s?.title ?? '',
      items: Array.isArray(s?.items) ? s.items : [],
    })),
    otherKeys: Object.keys(fm).filter((k) => !['title', 'photo', 'bio', 'sections', 'type'].includes(k)),
    template: sections.length
      ? null
      : { title: 'Publications', items: [] },
  };
}

export function saveFaculty({ path: rel, title, photo, bio, sections, dryRun = false }) {
  const keys = {};
  if (title !== undefined) keys.title = title;
  if (photo !== undefined) keys.photo = photo;
  if (bio !== undefined) keys.bio = bio;
  if (sections !== undefined) keys.sections = sections;
  return saveDocument(rel, { keys, dryRun, note: '更新导师主页' });
}

/** 把整段文本按行拆成条目（用于批量粘贴导入论文/成果） */
export function splitItems(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*·]\s*/, '').trim())
    .filter((l) => l !== '');
}

/* ------------------------------------------------------------------ */
/* 模块：页面文字（首页 / 研究 / 招生 / 联系 …）                        */
/* ------------------------------------------------------------------ */

export const PAGE_FILES = [
  { path: 'content/_index.md', label: '首页' },
  { path: 'content/research/_index.md', label: '研究' },
  { path: 'content/join/_index.md', label: '招生' },
  { path: 'content/contact/_index.md', label: '联系' },
  { path: 'content/resources/_index.md', label: '资源' },
  { path: 'content/projects/_index.md', label: '项目列表' },
  { path: 'content/events/_index.md', label: '报告/活动' },
  { path: 'content/experience.md', label: '经历页' },
];

export function listPages() {
  return PAGE_FILES.filter((p) => exists(p.path)).map((p) => {
    try {
      const { fm } = loadDoc(p.path);
      return { ...p, title: fm.title ?? p.label };
    } catch {
      return p;
    }
  });
}

export function loadPage(rel) {
  const { rel: r, doc, fm } = loadDoc(rel);
  const sections = Array.isArray(fm.sections) ? fm.sections : [];
  return {
    path: r,
    title: fm.title ?? '',
    parseError: doc.parseError ?? null,
    blocks: sections.map((s, i) => ({
      index: i,
      block: s?.block ?? '',
      title: s?.content?.title ?? '',
      hasTitle: s?.content != null && 'title' in (s.content ?? {}),
      subtitle: s?.content?.subtitle ?? '',
      hasSubtitle: s?.content != null && 'subtitle' in (s.content ?? {}),
      text: typeof s?.content?.text === 'string' ? s.content.text : '',
      hasText: s?.content != null && 'text' in (s.content ?? {}),
      isMarkdown: (s?.block ?? '') === 'markdown',
      contentExists: s?.content != null,
      // 卡片型区块（如 research-areas）：把 items 拆成可编辑的小卡片
      items: extractItems(s),
      hasItems: Array.isArray(s?.content?.items) && s.content.items.length > 0,
      layout: s?.design?.layout ?? '',
      hasLayout: s?.design != null && 'layout' in (s.design ?? {}),
    })),
    isHome: r === 'content/_index.md',
    home: r === 'content/_index.md' ? extractHome(sections) : null,
  };
}

/**
 * 卡片型区块（research-areas / features 等）的 items：
 * 只暴露编辑器需要编辑的字段，其余键原样保留（保存时按 name 回填）。
 */
function extractItems(section) {
  const raw = section?.content?.items;
  if (!Array.isArray(raw)) return [];
  return raw.map((it, i) => {
    const o = (it && typeof it === 'object') ? it : {};
    return {
      i,
      name: typeof o.name === 'string' ? o.name : '',
      description: typeof o.description === 'string' ? o.description : '',
      icon: typeof o.icon === 'string' ? o.icon : '',
      gradient: typeof o.gradient === 'string' ? o.gradient : '',
      topics: Array.isArray(o.topics) ? o.topics.map((t) => String(t)) : [],
      extra: Object.fromEntries(
        Object.entries(o).filter(([k]) => !['name', 'description', 'icon', 'gradient', 'topics'].includes(k)),
      ),
    };
  });
}

function extractHome(sections) {
  const first = sections.find((s) => typeof s?.content?.text === 'string');
  const text = first?.content?.text ?? '';
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text);
  const img = /<img[^>]*\ssrc="([^"]*)"/i.exec(text);
  const p = /<p>([\s\S]*?)<\/p>/i.exec(text);
  return {
    heading: h1 ? decodeEntities(h1[1].trim()) : '',
    image: img ? img[1] : '',
    intro: p ? decodeEntities(p[1].trim()) : '',
  };
}

function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 首页快速字段：对正文 HTML 做定点替换（标题 / 图片 / 简介段落） */
function patchHomeText(text, quick) {
  let out = text;
  if (quick.heading !== undefined && quick.heading !== '') {
    out = /<h1[^>]*>[\s\S]*?<\/h1>/i.test(out)
      ? out.replace(/(<h1[^>]*>)[\s\S]*?(<\/h1>)/i, `$1${escapeHtml(quick.heading)}$2`)
      : `${out}\n<h1>${escapeHtml(quick.heading)}</h1>`;
  }
  if (quick.image !== undefined && quick.image !== '') {
    out = /<img[^>]*\ssrc="[^"]*"/i.test(out)
      ? out.replace(/(<img[^>]*\ssrc=")[^"]*(")/i, `$1${quick.image}$2`)
      : `${out}\n<img src="${quick.image}" alt="${escapeHtml(quick.heading ?? '')}" class="w-full h-auto rounded-lg shadow-md">`;
  }
  if (quick.intro !== undefined && quick.intro !== '') {
    const html = escapeHtml(quick.intro);
    if (/<p>[\s\S]*?<\/p>/i.test(out)) out = out.replace(/(<p>)[\s\S]*?(<\/p>)/i, `$1${html}$2`);
    else out = `${out}\n<p>${html}</p>`;
  }
  return out;
}

/** 把编辑器传来的卡片数组整理成干净的 YAML 结构（保留未知键） */
function cleanPageItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const o = (it && typeof it === 'object') ? it : {};
    const out = { ...(o.extra && typeof o.extra === 'object' ? o.extra : {}) };
    out.name = String(o.name ?? '').trim();
    const desc = String(o.description ?? '').trim();
    if (desc) out.description = desc;
    const icon = String(o.icon ?? '').trim();
    if (icon) out.icon = icon;
    const gradient = String(o.gradient ?? '').trim();
    if (gradient) out.gradient = gradient;
    const topics = (Array.isArray(o.topics) ? o.topics : String(o.topics ?? '').split(','))
      .map((t) => String(t).trim()).filter(Boolean);
    if (topics.length) out.topics = topics;
    return out;
  }).filter((o) => o.name);
}

export function savePage({ path: rel, title, blocks = [], quick, dryRun = false }) {
  const loaded = loadPage(rel);
  const changes = [];
  for (const b of blocks) {
    const base = ['sections', b.index];
    if (b.text !== undefined) {
      let value = b.text;
      if (loaded.isHome && quick) value = patchHomeText(value, quick);
      changes.push({ path: [...base, 'content', 'text'], value });
    }
    if (b.title !== undefined && loaded.blocks[b.index]?.hasTitle) {
      changes.push({ path: [...base, 'content', 'title'], value: b.title });
    }
    if (b.subtitle !== undefined && loaded.blocks[b.index]?.hasSubtitle) {
      changes.push({ path: [...base, 'content', 'subtitle'], value: b.subtitle });
    }
    if (b.items !== undefined && loaded.blocks[b.index]?.hasItems) {
      changes.push({ path: [...base, 'content', 'items'], value: cleanPageItems(b.items) });
    }
    if (b.layout !== undefined && loaded.blocks[b.index]?.hasLayout) {
      changes.push({ path: [...base, 'design', 'layout'], value: String(b.layout) });
    }
  }

  const { text, rel: r } = readText(rel);
  const doc = parseFile(text);
  if (doc.hasFrontMatter && doc.parseError) {
    throw new SaveError(`该文件的 front matter 无法解析（${doc.parseError}），请用「原文编辑」。`);
  }
  const current = getFrontMatter(doc);
  const realChanges = changes.filter((c) => !deepEqual(getPath(doc, c.path), c.value));
  const keys = {};
  if (title !== undefined) keys.title = title;

  let result;
  if (realChanges.length) {
    result = buildVerifiedText(doc, realChanges);
  } else {
    result = { text, doc, frontMatter: current };
  }
  let finalText = result.text;
  const titleChanges = Object.entries(keys).filter(([k, v]) => !deepEqual(current[k], v));
  if (titleChanges.length) {
    finalText = buildVerifiedText(parseFile(finalText), titleChanges.map(([k, v]) => ({ path: [k], value: v }))).text;
  }

  const diff = unifiedDiff(text, finalText);
  if (finalText === text) return { rel: r, changed: false, diff };
  if (dryRun) return { rel: r, changed: true, dryRun: true, diff, preview: finalText };
  ensureEditorDirs();
  const { backupId } = writeText(r, finalText);
  return { rel: r, changed: true, diff, backupId, note: '更新页面文字' };
}

/* ------------------------------------------------------------------ */
/* 模块：新闻动态（blog）                                              */
/* ------------------------------------------------------------------ */

const BLOG_DIR = 'content/blog';

export function listNews() {
  return listDirs(BLOG_DIR).map((dir) => {
    const rel = `${dir}/index.md`;
    if (!exists(rel)) return null;
    const { fm } = loadDoc(rel);
    const cover = ['featured.jpg', 'featured.png', 'featured.webp', 'cover.jpg', 'cover.png']
      .map((f) => `${dir}/${f}`)
      .find((f) => exists(f)) ?? '';
    return {
      dir,
      path: rel,
      slug: path.basename(dir),
      title: fm.title ?? path.basename(dir),
      date: normalizeDate(fm.date),
      summary: fm.summary ?? '',
      authors: Array.isArray(fm.authors) ? fm.authors : (fm.authors ? [fm.authors] : []),
      tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []),
      draft: fm.draft === true,
      featured: fm.featured === true,
      cover,
      url: `/blog/${path.basename(dir)}/`,
    };
  }).filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function normalizeDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return String(d);
}

export function loadNews(rel) {
  const { rel: r, doc, fm, body } = loadDoc(rel);
  const dir = path.dirname(r).replace(/\\/g, '/');
  return {
    path: r,
    dir,
    title: fm.title ?? '',
    date: normalizeDate(fm.date),
    summary: fm.summary ?? '',
    authors: Array.isArray(fm.authors) ? fm.authors : (fm.authors ? [fm.authors] : []),
    tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []),
    draft: fm.draft === true,
    featured: fm.featured === true,
    body,
    cover: ['featured.jpg', 'featured.png', 'featured.webp', 'cover.jpg', 'cover.png']
      .map((f) => `${dir}/${f}`).find((f) => exists(f)) ?? '',
    otherKeys: Object.keys(fm).filter(
      (k) => !['title', 'date', 'summary', 'authors', 'tags', 'draft', 'featured', 'image', 'cover'].includes(k),
    ),
  };
}

export function saveNews({ path: rel, title, date, summary, authors, tags, draft, featured, body, dryRun = false }) {
  const keys = {};
  if (title !== undefined) keys.title = title;
  if (date !== undefined) keys.date = date || undefined;
  if (summary !== undefined) keys.summary = summary;
  if (authors !== undefined) keys.authors = authors;
  if (tags !== undefined) keys.tags = tags;
  if (draft !== undefined) keys.draft = !!draft;
  if (featured !== undefined) keys.featured = !!featured;
  return saveDocument(rel, { keys, body, dryRun, note: '更新新闻' });
}

export function slugifyAscii(input) {
  const s = String(input ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '-')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return s.slice(0, 60);
}

export function createNews({ title, slug, date, summary = '', body = '', tags = [], authors = [], draft = true }) {
  const finalSlug = (slug ?? '').trim() || slugifyAscii(date ? `${date}-${title}` : title) || `news-${Date.now()}`;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(finalSlug)) {
    throw new SaveError('目录名只能是「小写字母、数字、连字符」，例如 duck-genome-2026');
  }
  const dir = `${BLOG_DIR}/${finalSlug}`;
  const rel = `${dir}/index.md`;
  if (exists(rel)) throw new SaveError(`已存在同名新闻：${rel}`);
  const fmKeys = {
    title: title ?? '未命名',
    date: date || new Date().toISOString().slice(0, 10),
  };
  if (summary) fmKeys.summary = summary;
  if (authors.length) fmKeys.authors = authors;
  if (tags.length) fmKeys.tags = tags;
  if (draft) fmKeys.draft = true;
  const text = `---\n${dumpFrontMatter(fmKeys)}---\n\n${body || ''}\n`;
  ensureEditorDirs();
  createText(rel, text);
  return { path: rel, dir, slug: finalSlug };
}

export function deleteContent(rel, note) {
  ensureEditorDirs();
  return trashPath(rel, note);
}

/** 设置文章封面：写入文章目录下的 featured.<ext>（主题会自动识别） */
export function setPostCover({ path: postRel, filename, buffer, remove = false }) {
  const dir = path.dirname(postRel).replace(/\\/g, '/');
  if (!dir.startsWith(BLOG_DIR) && !dir.startsWith('content/publications')) {
    throw new SaveError('只支持给新闻或论文条目设置封面');
  }
  const existing = ['featured.jpg', 'featured.png', 'featured.webp', 'cover.jpg', 'cover.png']
    .filter((f) => exists(`${dir}/${f}`));
  for (const f of existing) trashPath(`${dir}/${f}`, '更换封面');
  if (remove) return { cover: '' };
  const ext = (path.extname(filename) || '.jpg').toLowerCase();
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  if (!allowed.includes(ext)) throw new SaveError(`封面图仅支持 ${allowed.join(' ')}`);
  const target = `${dir}/featured${ext === '.jpeg' ? '.jpg' : ext}`;
  const { abs } = resolveSafe(target, { mustExist: false });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  return { cover: target };
}

/* ------------------------------------------------------------------ */
/* 模块：论文发表                                                      */
/* ------------------------------------------------------------------ */

const PUB_DIR = 'content/publications';

export function listPublications() {
  return listDirs(PUB_DIR).map((dir) => {
    const rel = `${dir}/index.md`;
    if (!exists(rel)) return null;
    const { fm } = loadDoc(rel);
    const cover = ['featured.jpg', 'featured.png', 'featured.webp']
      .map((f) => `${dir}/${f}`).find((f) => exists(f)) ?? '';
    return {
      dir,
      path: rel,
      slug: path.basename(dir),
      title: fm.title ?? '',
      date: normalizeDate(fm.date),
      publication: fm.publication ?? '',
      publication_types: Array.isArray(fm.publication_types) ? fm.publication_types : [],
      authors: Array.isArray(fm.authors) ? fm.authors : [],
      featured: fm.featured === true,
      draft: fm.draft === true,
      cover,
      hasPdf: exists(`${dir}/cite.bib`) || Array.isArray(fm.links) && fm.links.some((l) => l?.type === 'pdf' && l?.url),
      url: `/publications/${path.basename(dir)}/`,
    };
  }).filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function loadPublication(rel) {
  const { rel: r, doc, fm, body } = loadDoc(rel);
  const dir = path.dirname(r).replace(/\\/g, '/');
  return {
    path: r,
    dir,
    title: fm.title ?? '',
    authors: Array.isArray(fm.authors) ? fm.authors : [],
    author_notes: Array.isArray(fm.author_notes) ? fm.author_notes : [],
    date: normalizeDate(fm.date),
    publication: fm.publication ?? '',
    publication_short: fm.publication_short ?? '',
    publication_types: Array.isArray(fm.publication_types) ? fm.publication_types : [],
    abstract: fm.abstract ?? '',
    summary: fm.summary ?? '',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    featured: fm.featured === true,
    draft: fm.draft === true,
    links: Array.isArray(fm.links) ? fm.links : [],
    projects: Array.isArray(fm.projects) ? fm.projects : [],
    url_pdf: fm.url_pdf ?? '',
    url_code: fm.url_code ?? '',
    url_dataset: fm.url_dataset ?? '',
    url_project: fm.url_project ?? '',
    url_slides: fm.url_slides ?? '',
    url_video: fm.url_video ?? '',
    url_source: fm.url_source ?? '',
    url_poster: fm.url_poster ?? '',
    doi: fm.doi ?? '',
    body,
    cover: ['featured.jpg', 'featured.png', 'featured.webp']
      .map((f) => `${dir}/${f}`).find((f) => exists(f)) ?? '',
    hasBib: exists(`${dir}/cite.bib`),
    bib: exists(`${dir}/cite.bib`) ? readText(`${dir}/cite.bib`).text : '',
    otherKeys: Object.keys(fm),
  };
}

export function savePublication(input) {
  const { path: rel, dryRun = false } = input;
  const keys = {};
  const map = {
    title: 'title', date: 'date', publication: 'publication', publication_short: 'publication_short',
    publication_types: 'publication_types', abstract: 'abstract', summary: 'summary', tags: 'tags',
    featured: 'featured', authors: 'authors', author_notes: 'author_notes', links: 'links',
    projects: 'projects', doi: 'doi',
  };
  for (const [from, to] of Object.entries(map)) {
    if (input[from] !== undefined) keys[to] = input[from];
  }
  for (const u of ['url_pdf', 'url_code', 'url_dataset', 'url_project', 'url_slides', 'url_video', 'url_source', 'url_poster']) {
    if (input[u] !== undefined) keys[u] = input[u];
  }
  if (input.date !== undefined && input.date) keys.date = String(input.date);
  const res = saveDocument(rel, { keys, body: input.body, dryRun, note: '更新论文' });
  if (!dryRun && input.bib !== undefined && exists(`${path.dirname(rel).replace(/\\/g, '/')}/cite.bib`)) {
    if (input.bib.trim() === '') {
      trashPath(`${path.dirname(rel).replace(/\\/g, '/')}/cite.bib`, '清空 BibTeX');
    } else {
      writeText(`${path.dirname(rel).replace(/\\/g, '/')}/cite.bib`, input.bib);
    }
  }
  return res;
}

export function createPublication({ title, slug, date, publication = '', publication_types = ['article-journal'], authors = [], abstract = '', body = '', links = [], draft = true }) {
  const finalSlug = (slug ?? '').trim() || slugifyAscii(title) || `paper-${Date.now()}`;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(finalSlug)) {
    throw new SaveError('目录名只能是「小写字母、数字、连字符」，例如 zhu-2026-duck-genome');
  }
  const rel = `${PUB_DIR}/${finalSlug}/index.md`;
  if (exists(rel)) throw new SaveError(`已存在同名论文：${rel}`);
  const keys = {
    title: title ?? '未命名',
    authors,
    date: date || new Date().toISOString().slice(0, 10),
    publication_types,
    publication,
    abstract,
    summary: abstract,
    featured: false,
    links,
    projects: [],
    slides: '',
  };
  if (draft) keys.draft = true;
  ensureEditorDirs();
  createText(rel, `---\n${dumpFrontMatter(keys)}---\n\n${body || ''}\n`);
  return { path: rel, slug: finalSlug };
}

/* ------------------------------------------------------------------ */
/* front matter 序列化（新建文件用）                                    */
/* ------------------------------------------------------------------ */

import { dumpYaml } from './yaml.mjs';

function dumpFrontMatter(keys) {
  const ordered = {};
  for (const [k, v] of Object.entries(keys)) {
    if (v === undefined) continue;
    ordered[k] = v;
  }
  return dumpYaml(ordered);
}

/* ------------------------------------------------------------------ */
/* 模块：站点设置                                                      */
/* ------------------------------------------------------------------ */

/** 中文菜单文件：Hugo 语言专属配置用「文件名后缀」区分（config/_default/menus.<语言>.yaml） */
const MENUS_ZH_FILE = 'config/_default/menus.zh.yaml';

/** 读取菜单项地址：兼容 url 与 pageRef 两种写法 */
function menuUrlOf(m) {
  if (!m) return '';
  if (m.url) return String(m.url);
  if (m.pageRef) {
    const p = String(m.pageRef);
    return p === '/' ? '/' : (p.endsWith('/') ? p : `${p}/`);
  }
  return '';
}

export function loadSettings() {
  const hugo = loadYamlDoc('config/_default/hugo.yaml');
  const params = loadYamlDoc('config/_default/params.yaml');
  const menus = loadYamlDoc('config/_default/menus.yaml');
  const menusZh = exists(MENUS_ZH_FILE) ? loadYamlDoc(MENUS_ZH_FILE) : { fm: {}, rel: MENUS_ZH_FILE };
  const langs = loadYamlDoc('config/_default/languages.yaml');
  const site = getSiteInfo();
  const identity = params.fm?.hugoblox?.identity ?? {};
  const theme = params.fm?.hugoblox?.theme ?? {};
  const mainMenu = Array.isArray(menus.fm?.main) ? menus.fm.main : [];
  const mainMenuZh = Array.isArray(menusZh.fm?.main) ? menusZh.fm.main : [];
  const langEn = langs.fm?.en ?? {};
  return {
    site: {
      siteTitle: hugo.fm?.title ?? '',
      baseURL: hugo.fm?.baseURL ?? '',
      basePath: site.basePath,
    },
    brand: {
      name: identity.name ?? '',
      tagline: identity.tagline ?? '',
      description: identity.description ?? '',
    },
    theme: {
      mode: theme.mode ?? 'light',
      pack: theme.pack ?? 'contrast',
      primary: theme.colors?.primary ?? '',
      secondary: theme.colors?.secondary ?? '',
      neutral: theme.colors?.neutral ?? '',
      font: params.fm?.hugoblox?.typography?.font ?? 'sans',
      headerSearch: params.fm?.hugoblox?.header?.search !== false,
      themeToggle: params.fm?.hugoblox?.header?.theme_toggle !== false,
      footerStyle: params.fm?.hugoblox?.footer?.style ?? 'minimal',
      copyright: params.fm?.hugoblox?.copyright?.notice ?? '',
    },
    languages: {
      /** 站点配置了哪些语言（界面据此决定是否显示中文菜单） */
      available: Object.keys(langs.fm ?? {}).filter((k) => k !== 'weight'),
      title: langEn.title ?? '',
      description: langEn.params?.description ?? '',
      zh: {
        title: langs.fm?.zh?.title ?? '',
        description: langs.fm?.zh?.params?.description ?? '',
      },
    },
    menus: {
      en: mainMenu.map((m) => ({ name: m?.name ?? '', url: menuUrlOf(m), weight: m?.weight ?? 0 })),
      zh: mainMenuZh.map((m) => ({ name: m?.name ?? '', url: menuUrlOf(m), weight: m?.weight ?? 0 })),
    },
    files: {
      hugo: hugo.rel,
      params: params.rel,
      menus: menus.rel,
      menusZh: menusZh.rel,
      languages: langs.rel,
    },
  };
}

export function saveSettings(payload) {
  const dryRun = !!payload?.dryRun;
  /*
   * 先把所有文件的改动都算成「计划」，全部成功后才统一落盘。
   * 之前是边算边写，一旦后面某个文件校验失败，前面的文件已经改了
   * —— 曾把英文导航菜单写成空数组，导致页面导航整条消失。
   */
  const plans = [];
  const { site = {}, brand = {}, theme = {}, languages = {}, menus = {} } = payload;

  // 站点名称同时写在三个地方：
  //   hugo.yaml    title           （Hugo 的站点标题）
  //   params.yaml  hugoblox.identity.name（页头/浏览器标签实际显示的名称）
  //   languages.yaml en.title      （多语言配置）
  const siteName = brand.name !== undefined ? brand.name
    : (site.siteTitle !== undefined ? site.siteTitle : undefined);

  const paramsOps = [];
  if (siteName !== undefined) paramsOps.push(['hugoblox.identity.name', siteName]);
  if (brand.tagline !== undefined) paramsOps.push(['hugoblox.identity.tagline', brand.tagline]);
  if (brand.description !== undefined) paramsOps.push(['hugoblox.identity.description', brand.description]);
  if (theme.mode !== undefined) paramsOps.push(['hugoblox.theme.mode', theme.mode]);
  if (theme.pack !== undefined) paramsOps.push(['hugoblox.theme.pack', theme.pack]);
  if (theme.primary !== undefined) paramsOps.push(['hugoblox.theme.colors.primary', theme.primary]);
  if (theme.secondary !== undefined) paramsOps.push(['hugoblox.theme.colors.secondary', theme.secondary]);
  if (theme.neutral !== undefined) paramsOps.push(['hugoblox.theme.colors.neutral', theme.neutral]);
  if (theme.font !== undefined) paramsOps.push(['hugoblox.typography.font', theme.font]);
  if (theme.headerSearch !== undefined) paramsOps.push(['hugoblox.header.search', !!theme.headerSearch]);
  if (theme.themeToggle !== undefined) paramsOps.push(['hugoblox.header.theme_toggle', !!theme.themeToggle]);
  if (theme.footerStyle !== undefined) paramsOps.push(['hugoblox.footer.style', theme.footerStyle]);
  if (theme.copyright !== undefined) paramsOps.push(['hugoblox.copyright.notice', theme.copyright]);
  if (paramsOps.length) plans.push(planByPath('config/_default/params.yaml', paramsOps));

  if (site.siteTitle !== undefined) {
    plans.push(planByPath('config/_default/hugo.yaml', [['title', site.siteTitle]]));
  }
  if (siteName !== undefined) {
    plans.push(planByPath('config/_default/languages.yaml', [['en.title', siteName]]));
  }
  if (languages.description !== undefined) {
    plans.push(planByPath('config/_default/languages.yaml', [['en.params.description', languages.description]]));
  }

  /*
   * 导航菜单按语言分文件：
   *   英文 config/_default/menus.yaml
   *   中文 config/_default/menus.zh.yaml（Hugo 语言专属配置用文件名后缀区分）
   * 不要写进 languages.yaml —— 那里的 menu 键在 Hugo 新版配置里已失效，
   * 之前写错位置导致「英文导航被清空」。
   */
  const cleanMenu = (list) => (list ?? [])
    .filter((m) => m && m.name && m.url)
    .map((m, i) => ({ name: String(m.name), url: String(m.url), weight: Number(m.weight) || (i + 1) * 10 }));

  if (Array.isArray(menus.en)) {
    plans.push(planByPath('config/_default/menus.yaml', [['main', cleanMenu(menus.en)]]));
  }
  // 只在「站点确实有多语言」或「中文菜单非空」时才动 menus.zh.yaml，
  // 避免单语言站点里凭空多出一个文件
  const hasZh = exists(MENUS_ZH_FILE) || (Array.isArray(menus.zh) && menus.zh.length > 0);
  if (Array.isArray(menus.zh) && hasZh) {
    if (exists(MENUS_ZH_FILE)) {
      plans.push(planByPath(MENUS_ZH_FILE, [['main', cleanMenu(menus.zh)]]));
    } else {
      // 文件不存在则新建（例如以后增加第三种语言）
      const lines = ['main:'];
      for (const m of cleanMenu(menus.zh)) {
        lines.push(`  - name: ${JSON.stringify(m.name)}`);
        lines.push(`    url: ${JSON.stringify(m.url)}`);
        lines.push(`    weight: ${m.weight}`);
      }
      plans.push({ rel: MENUS_ZH_FILE, changed: true, text: `${lines.join('\n')}\n`, diff: { changed: 0, lines: [] }, created: true });
    }
  }
  // 兼容旧字段（视为英文菜单）
  if (Array.isArray(menus.main)) {
    plans.push(planByPath('config/_default/menus.yaml', [['main', cleanMenu(menus.main)]]));
  }

  const changed = plans.filter((p) => p.changed);
  if (dryRun) {
    return {
      changed: changed.length > 0,
      dryRun: true,
      results: changed.map((p) => ({ rel: p.rel, changed: true, diff: p.diff, skipped: p.skipped })),
      diff: changed.length ? changed[changed.length - 1].diff : { changed: 0, lines: [] },
    };
  }
  // 到这里说明所有文件都能正确生成，再统一写盘（不会出现改了一半的情况）
  const written = changed.map((p) => applyPlan(p));
  return {
    changed: written.length > 0,
    results: written.map((p) => ({
      rel: p.rel, changed: true, backupId: p.backupId, diff: p.diff, skipped: p.skipped, created: p.created,
    })),
    diff: written.length ? written[written.length - 1].diff : { changed: 0, lines: [] },
  };
}

/** 按点号路径批量改键（路径不存在时会被拒绝，避免写出结构错误） */
/**
 * 按「点号路径」批量改键。
 * @param {object} [opts]
 *   · strict        : 路径不存在时报错（默认 true，用于站点配置，宁可拒绝也不猜）
 *   · createMissing : strict=false 时，是否允许新建缺失的键（默认 false，即跳过并记录）
 */
export function planByPath(rel, ops, opts = {}) {
  const { strict = true, createMissing = false } = opts;
  const { text } = readText(rel);
  const doc = parseFile(text, { plain: true });
  if (doc.parseError) throw new SaveError(`${rel} 无法解析：${doc.parseError}`);
  const changes = [];
  const skipped = [];
  const verify = [];   // 写完后再按原始路径回读校验一次
  for (const [dotPath, value] of ops) {
    const p = dotPath.split('.');
    const cur = getPath(doc, p);
    if (cur === undefined) {
      if (strict) {
        throw new SaveError(`${rel} 中没有 ${dotPath} 这一项，为避免改坏配置已取消`);
      }
      if (!createMissing) { skipped.push(dotPath); continue; }
      /*
       * 需要新建这个键。可能连中间层都不存在（例如 status.icon 而文件里没有 status），
       * 那就找到「已存在的最深前缀」，在它下面一次性建出剩余的嵌套结构。
       */
      let k = 0;
      for (let i = 1; i <= p.length; i++) {
        if (getPath(doc, p.slice(0, i)) !== undefined) k = i;
        else break;
      }
      let nested = value;
      for (let i = p.length - 1; i > k; i--) nested = { [p[i]]: nested };
      changes.push({ path: p.slice(0, k + 1), value: nested });
      verify.push({ path: p, value });
      continue;
    }
    if (!deepEqual(cur, value)) {
      changes.push({ path: p, value });
      verify.push({ path: p, value });
    }
  }
  if (!changes.length) return { rel, changed: false, text, diff: { changed: 0, lines: [] }, skipped };
  const res = buildVerifiedText(doc, changes);
  for (const v of verify) {
    const got = getPath(res.doc, v.path);
    if (!deepEqual(got, v.value)) {
      throw new SaveError(`字段 ${v.path.join('.')} 写入校验失败，已取消保存`);
    }
  }
  const diff = unifiedDiff(text, res.text);
  return { rel, changed: true, text: res.text, diff, skipped };
}

/** 落地一个改动计划（真正写盘 + 备份） */
export function applyPlan(plan) {
  if (!plan?.changed) return plan;
  ensureEditorDirs();
  const { backupId } = writeText(plan.rel, plan.text);
  const { text, ...rest } = plan;
  return { ...rest, backupId };
}

/** 兼容旧调用：单文件按路径改键 = planByPath + applyPlan */
export function saveByPath(rel, ops, dryRun, opts = {}) {
  const plan = planByPath(rel, ops, opts);
  if (dryRun || !plan.changed) return plan;
  return applyPlan(plan);
}

/* ------------------------------------------------------------------ */
/* 模块：图片素材                                                      */
/* ------------------------------------------------------------------ */

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|svg|avif|bmp|ico)$/i;

export function listMedia() {
  const site = getSiteInfo();
  const uploads = listFiles('static/uploads', { recursive: true })
    .filter((f) => !f.rel.endsWith('/'))
    .map((f) => ({
      rel: f.rel,
      name: path.basename(f.rel),
      size: f.size,
      mtime: f.mtime,
      isImage: IMAGE_EXT.test(f.rel),
      url: site.basePath + f.rel.replace(/^static\//, ''),
      // front matter 里用这个（layouts 会再用 absURL 拼绝对地址）
      frontMatterPath: f.rel.replace(/^static\//, ''),
    }))
    .sort((a, b) => b.mtime - a.mtime);
  const covers = listFiles('content', { recursive: true, filter: (p) => IMAGE_EXT.test(p) && /(featured|cover)\./i.test(p) })
    .map((f) => ({ rel: f.rel, size: f.size, mtime: f.mtime, name: path.basename(f.rel), isImage: true, isCover: true }));
  return { uploads, covers, uploadDir: 'static/uploads' };
}

export { saveUpload };
