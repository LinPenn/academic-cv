/**
 * 成员个人主页
 * ------------------------------------------------------------------
 * 主题实际读取的三处：
 *   data/authors/<slug>.yaml          —— 资料本体（姓名、职位、简介、兴趣、链接、单位、教育）
 *   assets/media/authors/<slug>.<ext> —— 头像（主题用 resources.GetMatch 取）
 *   content/authors/<slug>/_index.md  —— 页面标题，并保证该成员页面存在
 *
 * 依赖方向：profiles → site（单向），因此 site.mjs 不引用本文件，
 * 由 server.mjs 作为组合层调用，避免循环依赖。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  loadDoc, loadYamlDoc, saveDocument, saveByPath, loadPeople, SaveError,
} from './site.mjs';
import {
  exists, listFiles, listDirs, trashPath, resolveSafe, ensureEditorDirs, createText,
  AVATAR_EXTS, AVATAR_WARN_BYTES, MAX_UPLOAD_BYTES,
} from './store.mjs';
import { dumpYaml } from './yaml.mjs';

const AUTHOR_DATA_DIR = 'data/authors';
const AUTHOR_PAGE_DIR = 'content/authors';
const AVATAR_DIR = 'assets/media/authors';
const DATA_EXTS = ['.yaml', '.yml'];

/** 表单里可编辑的字段，其余字段一律原样保留 */
const EDITABLE_FIELDS = [
  'schema', 'slug', 'is_owner', 'name', 'role', 'bio', 'interests', 'links',
  'affiliations', 'education', 'status', 'ids', 'pronouns', 'weight',
  'graduation_year', 'skills', 'languages', 'awards', 'postnominals',
  'experience', 'user_groups', 'custom_sections',
];

/** 自定义模块支持的布局（与 layouts/_partials/author_custom_sections.html 对应） */
export const SECTION_LAYOUTS = [
  { value: 'list', label: '列表', desc: '一行一条，适合论文/专利清单', hasItems: true },
  { value: 'cards', label: '卡片', desc: '带图/标签的卡片网格，适合自研工具、项目', hasItems: true },
  { value: 'timeline', label: '时间线', desc: '按时间排列，适合经历、获奖、专利', hasItems: true },
  { value: 'links', label: '链接按钮', desc: '一排按钮，适合常用网址、软件下载', hasItems: true },
  { value: 'gallery', label: '图片墙', desc: '图片网格，适合截图、样品照片', hasItems: true },
  { value: 'markdown', label: '自由文字', desc: '一段 Markdown 文字，可含标题、列表、图片', hasItems: false },
  { value: 'publications', label: '自动列出论文', desc: '自动抓取 content/publications 里作者包含本成员的条目', hasItems: false },
];
const SECTION_LAYOUT_VALUES = SECTION_LAYOUTS.map((x) => x.value);

export function profileTemplate(slug, display) {
  return {
    schema: 'hugoblox/author/v1',
    slug,
    is_owner: false,
    name: { display },
    role: '',
    bio: '',
    interests: [],
    links: [],
    affiliations: [],
    education: [],
  };
}

function findDataFile(slug) {
  for (const ext of DATA_EXTS) {
    const rel = `${AUTHOR_DATA_DIR}/${slug}${ext}`;
    if (exists(rel)) return rel;
  }
  return null;
}

function findAvatar(slug) {
  const files = listFiles(AVATAR_DIR).filter((f) => {
    const base = path.basename(f.rel);
    const ext = path.extname(base).toLowerCase();
    return base.slice(0, base.length - ext.length) === slug && AVATAR_EXTS.includes(ext);
  });
  if (!files.length) return null;
  const f = files[0];
  return { rel: f.rel, ext: path.extname(f.rel).toLowerCase(), size: f.size, mtime: f.mtime };
}

function avatarWarning(avatar) {
  if (!avatar) return null;
  if (avatar.size > AVATAR_WARN_BYTES) {
    return `头像 ${(avatar.size / 1048576).toFixed(2)}MB 偏大（会随仓库提交、也拖慢页面），建议压缩到 300KB 以内`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 列表                                                                */
/* ------------------------------------------------------------------ */

export function listProfiles() {
  let people = { groups: [] };
  try { people = loadPeople(); } catch { /* 名单读不出来也要能列出资料 */ }

  const memberOf = new Map();
  (people.groups ?? []).forEach((g, gi) => {
    for (const m of g.members ?? []) {
      if (m.slug && !memberOf.has(m.slug)) memberOf.set(m.slug, { member: m, group: g.category, groupIndex: gi });
    }
  });

  const slugs = new Set();
  for (const f of listFiles(AUTHOR_DATA_DIR, { filter: (p) => DATA_EXTS.includes(path.extname(p).toLowerCase()) })) {
    slugs.add(path.basename(f.rel, path.extname(f.rel)));
  }
  for (const dir of listDirs(AUTHOR_PAGE_DIR)) {
    const slug = path.basename(dir);
    if (slug !== '_index') slugs.add(slug);
  }
  for (const slug of memberOf.keys()) slugs.add(slug);

  const items = [];
  for (const slug of slugs) {
    const dataPath = findDataFile(slug);
    const pagePath = `${AUTHOR_PAGE_DIR}/${slug}/_index.md`;
    const hasPage = exists(pagePath);
    let display = slug;
    let role = '';
    let parseError = null;
    let extraKeys = [];
    if (dataPath) {
      try {
        const fm = loadYamlDoc(dataPath).fm;
        display = fm?.name?.display ?? fm?.title ?? slug;
        role = fm?.role ?? '';
        extraKeys = Object.keys(fm ?? {}).filter((k) => !EDITABLE_FIELDS.includes(k));
      } catch (err) { parseError = err.message; }
    } else if (hasPage) {
      try { display = loadDoc(pagePath).fm.title ?? slug; } catch { /* 忽略 */ }
    }
    const info = memberOf.get(slug);
    if (info && (!dataPath || display === slug)) display = info.member.name || display;
    const avatar = findAvatar(slug);
    items.push({
      slug,
      display,
      role: role || info?.member?.title || '',
      dataPath,
      pagePath: hasPage ? pagePath : null,
      hasData: !!dataPath,
      hasPage,
      avatar,
      avatarWarning: avatarWarning(avatar),
      inPeople: !!info,
      group: info?.group ?? null,
      groupIndex: info?.groupIndex ?? 999,
      extraKeys,
      url: `/authors/${slug}/`,
      parseError,
    });
  }
  items.sort((a, b) => (a.groupIndex - b.groupIndex) || String(a.display).localeCompare(String(b.display)));
  return { items, groups: (people.groups ?? []).map((g) => g.category) };
}

/* ------------------------------------------------------------------ */
/* 读取                                                                */
/* ------------------------------------------------------------------ */

export function loadProfile(slug) {
  if (!slug) throw new SaveError('缺少成员标识（slug）');
  const dataPath = findDataFile(slug);
  const pagePath = `${AUTHOR_PAGE_DIR}/${slug}/_index.md`;
  const hasPage = exists(pagePath);
  let fm = null;
  if (dataPath) {
    const loaded = loadYamlDoc(dataPath);
    fm = loaded.fm;
  }
  const template = !dataPath;
  const base = fm ?? profileTemplate(slug, slug);
  const pageFm = hasPage ? loadDoc(pagePath).fm : null;

  const preserved = Object.keys(base).filter((k) => ![
    'name', 'role', 'bio', 'interests', 'links', 'affiliations', 'education',
    'slug', 'schema', 'is_owner', 'status',
  ].includes(k));

  return {
    slug,
    dataPath,
    pagePath: hasPage ? pagePath : null,
    hasData: !!dataPath,
    hasPage,
    template,
    avatar: findAvatar(slug),
    avatarWarning: avatarWarning(findAvatar(slug)),
    pageTitle: pageFm?.title ?? '',
    profile: {
      display: base?.name?.display ?? base?.title ?? '',
      given: base?.name?.given ?? '',
      family: base?.name?.family ?? '',
      role: base?.role ?? '',
      bio: base?.bio ?? '',
      interests: Array.isArray(base?.interests) ? base.interests : [],
      links: Array.isArray(base?.links) ? base.links : [],
      affiliations: Array.isArray(base?.affiliations) ? base.affiliations : [],
      education: Array.isArray(base?.education) ? base.education : [],
      sections: Array.isArray(base?.custom_sections) ? base.custom_sections : [],
      statusIcon: base?.status?.icon ?? '',
      isOwner: base?.is_owner === true,
      pronouns: base?.pronouns ?? '',
      weight: base?.weight ?? '',
      graduationYear: base?.graduation_year ?? '',
    },
    preservedFields: preserved,
    otherKeys: Object.keys(base ?? {}).filter((k) => !EDITABLE_FIELDS.includes(k)),
  };
}

/* ------------------------------------------------------------------ */
/* 保存                                                                */
/* ------------------------------------------------------------------ */

export function saveProfile(input) {
  const { slug, dryRun = false } = input;
  if (!slug) throw new SaveError('缺少成员标识（slug）');
  const existing = findDataFile(slug);
  const dataPath = existing ?? `${AUTHOR_DATA_DIR}/${slug}.yaml`;
  const isNew = !existing;
  const pagePath = `${AUTHOR_PAGE_DIR}/${slug}/_index.md`;
  const p = input.profile ?? {};

  if (isNew && !dryRun) {
    ensureEditorDirs();
    createText(dataPath, dumpYaml(profileTemplate(slug, p.display || slug)));
  }

  const ops = [];
  if (p.display !== undefined) ops.push(['name.display', p.display]);
  if (p.given) ops.push(['name.given', p.given]);
  if (p.family) ops.push(['name.family', p.family]);
  if (p.role !== undefined) ops.push(['role', p.role]);
  if (p.bio !== undefined) ops.push(['bio', p.bio]);
  if (p.interests !== undefined) ops.push(['interests', (p.interests ?? []).filter((x) => x !== '')]);
  if (p.links !== undefined) ops.push(['links', (p.links ?? []).filter((l) => l && l.url)]);
  if (p.affiliations !== undefined) ops.push(['affiliations', (p.affiliations ?? []).filter((a) => a && a.name)]);
  if (p.education !== undefined) ops.push(['education', (p.education ?? []).filter((e) => e && (e.degree || e.institution))]);
  if (p.sections !== undefined) ops.push(['custom_sections', cleanSections(p.sections)]);
  if (p.statusIcon) ops.push(['status.icon', p.statusIcon]);
  if (p.isOwner !== undefined) ops.push(['is_owner', !!p.isOwner]);
  if (p.pronouns) ops.push(['pronouns', p.pronouns]);
  if (p.graduationYear !== '' && p.graduationYear !== undefined) ops.push(['graduation_year', p.graduationYear]);
  if (p.weight !== '' && p.weight !== undefined) ops.push(['weight', Number(p.weight) || p.weight]);

  const res = saveByPath(dataPath, ops, dryRun, { strict: false, createMissing: true });

  // 页面标题 / 页面文件
  let pageRes = null;
  const wantTitle = input.pageTitle !== undefined ? input.pageTitle : p.display;
  if (wantTitle !== undefined && wantTitle !== null && wantTitle !== '') {
    if (exists(pagePath)) {
      if (input.pageTitle !== undefined) pageRes = saveDocument(pagePath, { keys: { title: wantTitle }, dryRun });
    } else if (!dryRun && input.createPage !== false) {
      ensureEditorDirs();
      createText(pagePath, `---\ntitle: "${String(wantTitle).replace(/"/g, '\\"')}"\n---\n`);
      pageRes = { rel: pagePath, changed: true, created: true };
    }
  }

  return {
    slug,
    changed: Boolean(res.changed || pageRes?.changed || (isNew && !dryRun)),
    created: isNew && !dryRun ? dataPath : null,
    data: res,
    page: pageRes,
    skipped: res.skipped ?? [],
  };
}

/**
 * 清洗自定义模块：
 *   · 去掉未知布局、空条目、空的可选字段（让 YAML 保持干净）；
 *   · 只保留布局真正会用到的字段，避免写进一堆无用键。
 */
export function cleanSections(sections) {
  const out = [];
  for (const raw of sections ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const layout = SECTION_LAYOUT_VALUES.includes(raw.layout) ? raw.layout : 'list';
    const section = { title: String(raw.title ?? '').trim() || '未命名模块', layout };
    if (raw.subtitle) section.subtitle = String(raw.subtitle);
    if (raw.text) section.text = String(raw.text);
    if (raw.collapse === true) section.collapse = true;
    if (layout === 'cards' || layout === 'gallery') {
      const cols = Number(raw.columns);
      section.columns = cols >= 1 && cols <= 4 ? cols : (layout === 'gallery' ? 3 : 3);
    }
    const needsItems = SECTION_LAYOUTS.find((x) => x.value === layout)?.hasItems;
    if (needsItems) {
      const items = [];
      for (const it of raw.items ?? []) {
        if (!it || typeof it !== 'object') continue;
        const item = {};
        const title = String(it.title ?? '').trim();
        const url = String(it.url ?? '').trim();
        const image = String(it.image ?? '').trim();
        if (!title && !url && !image) continue;      // 完全空的条目不写入
        if (title) item.title = title;
        if (it.subtitle) item.subtitle = String(it.subtitle);
        if (it.meta) item.meta = String(it.meta);
        if (it.text) item.text = String(it.text);
        if (url) item.url = url;
        if (image) item.image = image;
        if (it.icon) item.icon = String(it.icon);
        const tags = (it.tags ?? []).map((t) => String(t).trim()).filter(Boolean);
        if (tags.length) item.tags = tags;
        items.push(item);
      }
      section.items = items;
    }
    out.push(section);
  }
  return out;
}

export function createProfile({ slug, display, role = '', bio = '', pageTitle, addToGroup = null, dryRun = false }) {
  const clean = String(slug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(clean)) {
    throw new SaveError('成员标识（slug）只能用小写字母、数字和连字符，例如 zhang-san');
  }
  const dupData = findDataFile(clean);
  if (dupData) throw new SaveError(`已存在同名的个人资料：${dupData}`);
  if (exists(`${AUTHOR_PAGE_DIR}/${clean}/_index.md`)) {
    throw new SaveError(`已存在同名的个人页面：${AUTHOR_PAGE_DIR}/${clean}/_index.md`);
  }
  if (dryRun) return { dryRun: true, slug: clean };

  ensureEditorDirs();
  const dataPath = `${AUTHOR_DATA_DIR}/${clean}.yaml`;
  const tpl = profileTemplate(clean, display || clean);
  tpl.role = role;
  tpl.bio = bio;
  createText(dataPath, dumpYaml(tpl));
  const title = pageTitle || display || clean;
  createText(`${AUTHOR_PAGE_DIR}/${clean}/_index.md`, `---\ntitle: "${String(title).replace(/"/g, '\\"')}"\n---\n`);

  let addedToGroup = null;
  if (addToGroup) {
    try { addedToGroup = addMemberToGroup(clean, display || clean, role, addToGroup); }
    catch (err) { addedToGroup = `登记到成员名单失败：${err.message}`; }
  }
  return { slug: clean, dataPath, pagePath: `${AUTHOR_PAGE_DIR}/${clean}/_index.md`, addedToGroup };
}

/** 把成员登记进成员名单的某个分组 */
function addMemberToGroup(slug, name, title, groupCategory) {
  const people = loadPeople();
  const groups = people.groups.map((g) => ({ category: g.category, members: structuredClone(g.members) }));
  let target = groups.find((g) => g.category === groupCategory);
  if (!target) {
    target = { category: groupCategory, members: [] };
    groups.push(target);
  }
  if (target.members.some((m) => m.slug === slug)) return null;
  target.members.push({ name, slug, title });
  savePeople({ pi: people.pi, groups, title: people.title });
  return groupCategory;
}

/** 批量补齐缺失的个人主页（成员名单里勾选「自动创建」时调用） */
export function ensureProfiles(slugs, groups = []) {
  const created = [];
  const skipped = [];
  for (const slug of slugs ?? []) {
    try {
      const hasData = !!findDataFile(slug);
      const pagePath = `${AUTHOR_PAGE_DIR}/${slug}/_index.md`;
      const hasPage = exists(pagePath);
      if (hasData && hasPage) { skipped.push(slug); continue; }
      let name = slug;
      let role = '';
      for (const g of groups ?? []) {
        for (const m of g.members ?? []) {
          if (m.slug === slug) { name = m.name || slug; role = m.title || ''; }
        }
      }
      if (!hasData) {
        ensureEditorDirs();
        const tpl = profileTemplate(slug, name);
        tpl.role = role;
        createText(`${AUTHOR_DATA_DIR}/${slug}.yaml`, dumpYaml(tpl));
      }
      if (!hasPage) {
        ensureEditorDirs();
        createText(pagePath, `---\ntitle: "${String(name).replace(/"/g, '\\"')}"\n---\n`);
      }
      created.push(slug);
    } catch (err) {
      skipped.push(`${slug}（${err.message}）`);
    }
  }
  return { created, skipped };
}

export function deleteProfile({ slug, removeData = true, removePage = true, removeAvatar = false }) {
  const removed = [];
  const dataPath = findDataFile(slug);
  if (removeData && dataPath) removed.push(trashPath(dataPath, '删除成员资料').rel);
  const pagePath = `${AUTHOR_PAGE_DIR}/${slug}/_index.md`;
  if (removePage && exists(pagePath)) removed.push(trashPath(path.dirname(pagePath), '删除成员页面').rel);
  if (removeAvatar) {
    const avatar = findAvatar(slug);
    if (avatar) removed.push(trashPath(avatar.rel, '删除成员头像').rel);
  }
  return { slug, removed };
}

/* ------------------------------------------------------------------ */
/* 头像                                                                */
/* ------------------------------------------------------------------ */

export function setProfileAvatar({ slug, filename, buffer, remove = false }) {
  if (!slug) throw new SaveError('缺少成员标识（slug）');
  const existing = listFiles(AVATAR_DIR).filter((f) => {
    const base = path.basename(f.rel);
    const ext = path.extname(base).toLowerCase();
    return base.slice(0, base.length - ext.length) === slug && AVATAR_EXTS.includes(ext);
  });
  for (const f of existing) trashPath(f.rel, '更换头像');
  if (remove) return { avatar: null, warnings: [] };

  let ext = path.extname(String(filename ?? '')).toLowerCase();
  if (ext === '.jpeg') ext = '.jpg';
  if (!AVATAR_EXTS.includes(ext)) throw new SaveError(`头像仅支持 ${AVATAR_EXTS.join(' ')} 格式`);
  if (!buffer?.length) throw new SaveError('文件内容为空');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new SaveError(`头像 ${(buffer.length / 1048576).toFixed(1)}MB 超过 GitHub 单文件 100MB 限制`);
  }
  const warnings = [];
  if (buffer.length > AVATAR_WARN_BYTES) {
    warnings.push(
      `头像 ${(buffer.length / 1048576).toFixed(2)}MB 偏大：它会随仓库提交、也会拖慢页面加载。`
      + '页面上只显示 160px，压到 600×600 / 300KB 以内即可。',
    );
  }
  const rel = `${AVATAR_DIR}/${slug}${ext}`;
  const { abs } = resolveSafe(rel, { mustExist: false });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  return { avatar: { rel, ext, size: buffer.length }, warnings };
}

/** 列出体积过大的头像，供界面提示（GitHub 仓库体积问题） */
export function listOversizedAvatars() {
  return listFiles(AVATAR_DIR)
    .filter((f) => AVATAR_EXTS.includes(path.extname(f.rel).toLowerCase()) && f.size > AVATAR_WARN_BYTES)
    .map((f) => ({ rel: f.rel, size: f.size, name: path.basename(f.rel) }))
    .sort((a, b) => b.size - a.size);
}
