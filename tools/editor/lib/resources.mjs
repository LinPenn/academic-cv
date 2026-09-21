/**
 * 模块：数据集 / 资源（content/resources/ 下的子页面）
 * ------------------------------------------------------------------
 * 一个数据集 = 一个页面包：
 *   content/resources/<slug>/index.md       英文正文
 *   content/resources/<slug>/index.zh.md    中文正文（可选）
 *   content/resources/<slug>/featured.*     卡片封面（卡片视图会自动取 *featured* 文件）
 *
 * 这里提供：列出、读取、保存、新建、上传封面、删除（进回收站）。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  exists, listDirs, listFiles, resolveSafe, trashPath, createText, ensureEditorDirs,
} from './store.mjs';
import { loadDoc, saveDocument, SaveError } from './site.mjs';

const DIR = 'content/resources';
export const RESEARCH_DIR = 'content/research';
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;
const COVER_EXT = ['.webp', '.jpg', '.jpeg', '.png', '.avif', '.gif'];

/** 递归找出所有页面包（含 index.md 的目录），最多两层：base/group/slug */
function dirs(base = DIR, depth = 2) {
  if (!exists(base)) return [];
  const out = [];
  for (const d of listDirs(base)) {
    const dir = d.split(String.fromCharCode(92)).join('/');
    if (exists(`${dir}/index.md`)) out.push(dir);
    if (depth > 1) out.push(...dirs(dir, depth - 1));
  }
  return [...new Set(out)];
}

/** 该页面属于哪一组（相对 base 的目录名，例如 database）；顶层页面返回 '' */
function groupOf(dir, base = DIR) {
  const rest = dir.slice(base.length + 1);
  const parts = rest.split('/');
  return parts.length > 1 ? parts[0] : '';
}

function coverOf(dir) {
  const files = listFiles(dir).map((f) => path.basename(f.rel));
  const hit = files.find((f) => /featured/i.test(f) && IMAGE_EXT.test(f))
    ?? files.find((f) => /cover/i.test(f) && IMAGE_EXT.test(f));
  return hit ? `${dir}/${hit}` : '';
}

function humanize(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function listResources(base = DIR) {
  return dirs(base).map((dir) => {
    const slug = path.basename(dir);
    const { fm } = loadDoc(`${dir}/index.md`);
    return {
      slug,
      dir,
      group: groupOf(dir, base),
      path: `${dir}/index.md`,
      pathZh: exists(`${dir}/index.zh.md`) ? `${dir}/index.zh.md` : null,
      title: fm.title ?? humanize(slug),
      summary: fm.summary ?? '',
      weight: fm.weight ?? '',
      cover: coverOf(dir),
      url: `/${dir.replace(/^content\//, '')}/`,
    };
  }).sort((a, b) => (Number(a.weight) || 999) - (Number(b.weight) || 999) || a.slug.localeCompare(b.slug));
}

export function loadResource(rel) {
  if (!exists(rel)) throw new SaveError(`文件不存在：${rel}`);
  const { fm, body } = loadDoc(rel);
  const dir = path.dirname(rel).replace(/\\/g, '/');
  return {
    path: rel,
    dir,
    slug: path.basename(dir),
    title: fm.title ?? '',
    summary: fm.summary ?? '',
    weight: fm.weight ?? '',
    body: body ?? '',
    cover: coverOf(dir),
    hasZh: exists(`${dir}/index.zh.md`),
  };
}

export function saveResource({ path: rel, title, summary, weight, body, dryRun = false }) {
  if (!exists(rel)) throw new SaveError(`文件不存在：${rel}`);
  const keys = {};
  if (title !== undefined) keys.title = title;
  if (summary !== undefined) keys.summary = summary;
  if (weight !== undefined) keys.weight = weight === '' ? undefined : Number(weight) || weight;
  const res = saveDocument(rel, {
    keys, body: typeof body === 'string' ? body : undefined, dryRun, note: '更新数据集',
  });
  return res;
}

export function createResource({ base = DIR, group = '', title, slug, summary = '', weight = '', withZh = false }) {
  const name = String(title ?? '').trim();
  if (!name) throw new SaveError('请填写标题');
  let s = String(slug ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) throw new SaveError('无法生成目录名，请手动填写 slug（仅限小写字母、数字、连字符）');

  const g = String(group ?? '').trim().replace(/^\/+|\/+$/g, '');
  const dir = g ? `${base}/${g}/${s}` : `${base}/${s}`;
  if (exists(dir)) throw new SaveError(`目录已存在：${dir}`);
  ensureEditorDirs();

  const esc = (v) => String(v).replace(/"/g, '\\"');
  const fm = [
    '---',
    `title: "${esc(name)}"`,
    `date: "${new Date().toISOString().slice(0, 10)}"`,
    weight ? `weight: ${Number(weight) || weight}` : 'weight: 10',
    `summary: "${esc(summary)}"`,
    'featured: true',
    '---',
    '',
    `**${esc(name)}**`,
    '',
    '> **待补充：** 数据内容说明、下载地址、版本号、引用方式。',
    '',
  ].join('\n');

  createText(`${dir}/index.md`, fm);
  if (withZh) {
    createText(`${dir}/index.zh.md`, fm);
  }
  return { dir, slug: s, created: true };
}

/** 上传封面：存成 featured.<ext>（卡片视图会自动取 *featured* 文件） */
export function setResourceCover({ rel, filename, buffer, remove = false }) {
  const dir = path.dirname(rel).replace(/\\/g, '/');
  if (!exists(dir)) throw new SaveError(`目录不存在：${dir}`);
  // 先删掉旧封面
  for (const f of listFiles(dir)) {
    const base = path.basename(f.rel);
    if (/^(featured|cover)\./i.test(base) && IMAGE_EXT.test(base)) trashPath(f.rel, '更换数据集封面');
  }
  if (remove) return { cover: '' };
  if (!buffer?.length) throw new SaveError('文件内容为空');
  let ext = path.extname(String(filename ?? '')).toLowerCase();
  if (ext === '.jpeg') ext = '.jpg';
  if (!COVER_EXT.includes(ext)) throw new SaveError(`封面仅支持 ${COVER_EXT.join(' ')}`);
  const target = `${dir}/featured${ext}`;
  const { abs } = resolveSafe(target, { mustExist: false });
  fs.writeFileSync(abs, buffer);
  return { cover: target };
}

export function deleteResource({ dir }) {
  const d = String(dir ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!d.startsWith(`${DIR}/`)) throw new SaveError('只能删除 content/resources 下的数据集');
  const { rel } = resolveSafe(d, { mustExist: true });
  const removed = trashPath(rel, '删除数据集');
  return { removed: removed.rel, dir: rel };
}
