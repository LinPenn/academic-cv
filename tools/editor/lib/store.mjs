/**
 * 文件存储层
 * ------------------------------------------------------------------
 * 负责：路径安全、读写、备份、回收站、图片上传。
 *
 * 针对 GitHub Pages 的关键适配：
 *   · 只允许写 content/ config/_default/ static/uploads/ 三处；
 *   · 文件名规范化为小写 ASCII（GitHub Pages 的 Linux 文件系统区分大小写，
 *     且 URL 里的中文/空格会被百分号编码，容易出问题）；
 *   · 单文件 95MB 硬上限（GitHub 单文件 100MB 限制），超过 5MB 给出警告；
 *   · 每次写入前自动备份到 .editor/backups（已加入 .gitignore，不会进仓库）。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SITE_ROOT = path.resolve(here, '../../..');
export const EDITOR_DIR = path.join(SITE_ROOT, '.editor');
export const BACKUP_DIR = path.join(EDITOR_DIR, 'backups');
export const TRASH_DIR = path.join(EDITOR_DIR, 'trash');

/**
 * 允许写入的目录前缀（相对站点根目录）
 * data/authors      —— 成员个人资料（主题实际读取的就是这里）
 * assets/media/authors —— 成员头像（主题用 resources.GetMatch 从这里取）
 */
export const WRITABLE_ROOTS = [
  'content',
  'config/_default',
  'static/uploads',
  'data/authors',
  'assets/media/authors',
];
/** 允许读取的目录前缀 */
export const READABLE_ROOTS = ['content', 'config', 'static/uploads', 'data', 'layouts', 'assets/media'];

export class PathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathError';
  }
}

/** 把相对路径安全地解析成绝对路径，拒绝越界与非法字符 */
export function resolveSafe(rel, { roots = WRITABLE_ROOTS, mustExist = false } = {}) {
  if (typeof rel !== 'string' || rel.trim() === '') throw new PathError('路径不能为空');
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (cleaned.includes('\0')) throw new PathError('路径非法');
  const abs = path.resolve(SITE_ROOT, cleaned);
  const relFromRoot = path.relative(SITE_ROOT, abs).replace(/\\/g, '/');
  if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
    throw new PathError(`路径超出站点目录：${rel}`);
  }
  const allowed = roots.some((r) => relFromRoot === r || relFromRoot.startsWith(r + '/'));
  if (!allowed) {
    throw new PathError(`出于安全考虑，不允许访问该路径：${relFromRoot}（仅限 ${roots.join('、')}）`);
  }
  if (mustExist && !fs.existsSync(abs)) throw new PathError(`文件不存在：${relFromRoot}`);
  return { abs, rel: relFromRoot };
}

export function toRel(abs) {
  return path.relative(SITE_ROOT, abs).replace(/\\/g, '/');
}

export function exists(rel) {
  try {
    return fs.existsSync(resolveSafe(rel, { roots: READABLE_ROOTS }).abs);
  } catch {
    return false;
  }
}

export function readText(rel, opts) {
  const { abs, rel: r } = resolveSafe(rel, { roots: READABLE_ROOTS, mustExist: true, ...opts });
  return { text: fs.readFileSync(abs, 'utf8'), rel: r, abs };
}

export function stat(rel) {
  const { abs, rel: r } = resolveSafe(rel, { roots: READABLE_ROOTS, mustExist: true });
  const st = fs.statSync(abs);
  return { rel: r, abs, size: st.size, mtime: st.mtimeMs };
}

export function listFiles(relDir, { recursive = false, filter = null } = {}) {
  const { abs, rel: r } = resolveSafe(relDir, { roots: READABLE_ROOTS });
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (recursive) walk(p);
      } else if (!filter || filter(toRel(p))) {
        out.push({ rel: toRel(p), size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  walk(abs);
  return out;
}

export function listDirs(relDir) {
  const { abs } = resolveSafe(relDir, { roots: READABLE_ROOTS });
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => toRel(path.join(abs, d.name)));
}

/* ------------------------------------------------------------------ */
/* 备份与写盘                                                          */
/* ------------------------------------------------------------------ */

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function pruneBackups(keep = 60) {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const dirs = fs.readdirSync(BACKUP_DIR).filter((n) => !n.startsWith('.')).sort();
  while (dirs.length > keep) {
    const victim = dirs.shift();
    fs.rmSync(path.join(BACKUP_DIR, victim), { recursive: true, force: true });
  }
}

/** 备份单个文件（写入前调用）。返回备份目录名 */
export function backupFile(rel) {
  const { abs, rel: r } = resolveSafe(rel, { roots: READABLE_ROOTS });
  if (!fs.existsSync(abs)) return null;
  const dir = path.join(BACKUP_DIR, stamp());
  const dest = path.join(dir, r);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
  pruneBackups();
  return path.basename(dir);
}

/**
 * 原子写入文本文件，保持原有行尾（Windows 下 core.autocrlf=true，工作区是 CRLF）。
 * 新文件默认使用 CRLF（与现有文件保持一致，git 提交时会被规范化）。
 */
export function writeText(rel, text, { backup = true } = {}) {
  const { abs, rel: r } = resolveSafe(rel, { mustExist: false });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const backupId = backup ? backupFile(r) : null;
  const tmp = `${abs}.editor-tmp-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, abs);
  return { rel: r, backupId };
}

/** 新建文件（若已存在则报错，避免误覆盖） */
export function createText(rel, text) {
  const { abs, rel: r } = resolveSafe(rel, { mustExist: false });
  if (fs.existsSync(abs)) throw new PathError(`文件已存在：${r}`);
  return writeText(r, text, { backup: false });
}

/** 删除：移入回收站而不是真删，可恢复 */
export function trashPath(rel, note = '') {
  const { abs, rel: r } = resolveSafe(rel, { mustExist: true });
  const dir = path.join(TRASH_DIR, `${stamp()}-${crypto.randomBytes(3).toString('hex')}`);
  const dest = path.join(dir, r);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(abs, dest);
  fs.writeFileSync(path.join(dir, 'note.txt'), `${r}\n删除时间：${new Date().toLocaleString('zh-CN')}\n说明：${note}\n`, 'utf8');
  return { rel: r, trashId: path.basename(dir) };
}

export function listTrash() {
  if (!fs.existsSync(TRASH_DIR)) return [];
  return fs.readdirSync(TRASH_DIR).filter((n) => !n.startsWith('.')).sort().reverse().map((id) => {
    const dir = path.join(TRASH_DIR, id);
    const files = [];
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else files.push(toRel(p).replace(/^\.editor\/trash\/[^/]+\//, ''));
      }
    };
    walk(dir);
    return { id, files: files.filter((f) => f !== 'note.txt'), at: fs.statSync(dir).mtimeMs };
  });
}

export function restoreTrash(id, rel) {
  const dir = path.join(TRASH_DIR, id);
  if (!fs.existsSync(dir)) throw new PathError(`回收站条目不存在：${id}`);
  const src = path.join(dir, rel);
  if (!fs.existsSync(src)) throw new PathError(`回收站中没有该文件：${rel}`);
  const { abs, rel: r } = resolveSafe(rel, { mustExist: false });
  if (fs.existsSync(abs)) throw new PathError(`目标已存在，未覆盖：${r}`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.renameSync(src, abs);
  return { rel: r };
}

/** 成员头像允许的扩展名（与主题 resources.GetMatch 匹配范围一致） */
export const AVATAR_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
/** 头像建议体积：超过就提示压缩（仓库体积 + 页面加载速度） */
export const AVATAR_WARN_BYTES = 500 * 1024;

/* ------------------------------------------------------------------ */
/* 图片上传（GitHub Pages 适配）                                        */
/* ------------------------------------------------------------------ */

export const UPLOAD_DIR = 'static/uploads';
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024; // GitHub 单文件 100MB 硬限制
export const WARN_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif', '.bmp', '.ico',
  '.pdf', '.mp4', '.webm', '.mp3', '.bib', '.csv', '.txt', '.zip',
]);

const EXT_FIX = {
  '.jpe': '.jpg', '.jfif': '.jpg', '.tif': '.tif', '.tiff': '.tif', '.htm': '.html',
};

/**
 * 规范化文件名：小写、ASCII、去空格（GitHub Pages 是大写敏感 + URL 编码）。
 * @returns {{ name: string, warnings: string[] }}
 */
export function sanitizeFilename(input, { keepDirs = '' } = {}) {
  const warnings = [];
  let base = path.basename(input.replace(/\\/g, '/'));
  let ext = path.extname(base).toLowerCase();
  let stem = base.slice(0, base.length - ext.length);
  if (EXT_FIX[ext]) ext = EXT_FIX[ext];

  if (ext && !ALLOWED_EXT.has(ext)) {
    throw new PathError(`不支持的文件类型：${ext}（允许：${[...ALLOWED_EXT].join(' ')}）`);
  }
  if (/[A-Z]/.test(base)) warnings.push('文件名中的大写字母已改为小写（GitHub Pages 区分大小写，避免链接失效）');
  if (/\s/.test(base)) warnings.push('文件名中的空格已改为连字符');
  if (/[^\x20-\x7e]/.test(base)) warnings.push('文件名中的非 ASCII 字符（如中文）已替换，避免 URL 百分号编码问题');

  stem = stem
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/-{2,}/g, '-')
    .replace(/[-_]+$/, '')
    .toLowerCase();
  if (!stem) stem = `file-${Date.now()}`;
  if (stem.length > 60) {
    stem = stem.slice(0, 60).replace(/[-_]+$/, '');
    warnings.push('文件名过长，已截断到 60 字符');
  }
  if (/^[_.]/.test(stem)) stem = 'u' + stem;
  const name = `${keepDirs ? keepDirs.replace(/^\/+|\/+$/g, '') + '/' : ''}${stem}${ext}`;
  return { name, warnings };
}

export function uniqueUploadPath(name, warnings = []) {
  const parsed = path.parse(name);
  let candidate = `${UPLOAD_DIR}/${name}`;
  let i = 2;
  while (fs.existsSync(path.join(SITE_ROOT, candidate))) {
    candidate = `${UPLOAD_DIR}/${parsed.dir ? parsed.dir + '/' : ''}${parsed.name}-${i}${parsed.ext}`;
    i++;
    if (i > 99) throw new PathError('同名文件过多，请换个文件名');
  }
  if (i > 2) warnings.push(`已存在同名文件，自动重命名为 ${path.basename(candidate)}`);
  return candidate;
}

export function saveUpload({ filename, buffer, subdir = '', overwrite = false }) {
  if (!buffer || !buffer.length) throw new PathError('文件内容为空');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new PathError(`文件 ${(buffer.length / 1048576).toFixed(1)}MB 超过 GitHub 单文件 100MB 限制，请先压缩`);
  }
  const warnings = [];
  const { name, warnings: w } = sanitizeFilename(filename, { keepDirs: subdir });
  warnings.push(...w);
  if (buffer.length > WARN_UPLOAD_BYTES) {
    warnings.push(`文件较大（${(buffer.length / 1048576).toFixed(1)}MB），会拖慢站点加载与仓库克隆，建议压缩到 1MB 以内`);
  }
  let rel = `${UPLOAD_DIR}/${name}`;
  if (overwrite && exists(rel)) {
    // 覆盖已有图片
  } else {
    rel = uniqueUploadPath(name, warnings);
  }
  const { abs, rel: r } = resolveSafe(rel, { mustExist: false });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.editor-tmp-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, abs);
  return {
    rel: r,
    size: buffer.length,
    warnings,
    // layouts 里用 `| absURL` 拼绝对地址，所以 front matter 存相对路径；
    // 裸 HTML（如首页正文）里要用带站点前缀的绝对路径。
    frontMatterPath: r.replace(/^static\//, ''),
    url: '/' + r.replace(/^static\//, ''),
  };
}

export function ensureEditorDirs() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(TRASH_DIR, { recursive: true });
}
