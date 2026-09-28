/**
 * 模块：网站图标（浏览器标签页上的小图标，favicon）
 * ------------------------------------------------------------------
 * 主题的 head 会按这个顺序找图标（layouts/_partials/functions/get_site_icon.html）：
 *   1. assets/media/icon.svg   （优先，矢量、可适配深色模式）
 *   2. assets/media/icon.png   （退回，Hugo 会自动裁成方图）
 * 主题模块里自带一张默认的 HugoBlox 图标；只要项目根目录下放了同名文件，
 * 就会覆盖掉主题那张 —— 这就是换图标的方式。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  exists, stat, resolveSafe, trashPath,
} from './store.mjs';
import { SaveError } from './frontmatter.mjs';

export const FAVICON_DIR = 'assets/media';
/** 主题的查找顺序（前者优先） */
export const FAVICON_FILES = ['icon.svg', 'icon.png'];
const ALLOWED_EXT = ['.svg', '.png'];
const MAX_BYTES = 2 * 1024 * 1024;

export function getFavicon() {
  for (const name of FAVICON_FILES) {
    const rel = `${FAVICON_DIR}/${name}`;
    if (!exists(rel)) continue;
    const s = stat(rel);
    return {
      rel,
      name,
      ext: path.extname(name).toLowerCase(),
      isSvg: name.endsWith('.svg'),
      size: s.size,
      mtime: s.mtime,
    };
  }
  return { rel: '', name: '', ext: '', isSvg: false, size: 0, mtime: 0, isThemeDefault: true };
}

/**
 * 换图标：写进 assets/media/icon.png 或 icon.svg，旧的那份移入回收站。
 * @param {{filename?: string, buffer?: Buffer, remove?: boolean}} opts
 */
export function setFavicon({ filename, buffer, remove = false } = {}) {
  const existing = FAVICON_FILES
    .map((n) => `${FAVICON_DIR}/${n}`)
    .filter((rel) => exists(rel));
  for (const rel of existing) trashPath(rel, '更换网站图标');
  if (remove) return { rel: '', removed: existing.length };

  if (!buffer?.length) throw new SaveError('文件内容为空');
  let ext = path.extname(String(filename ?? '')).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    throw new SaveError(`网站图标只支持 ${ALLOWED_EXT.join(' / ')}（建议用方形 PNG，至少 180×180）`);
  }
  if (buffer.length > MAX_BYTES) {
    throw new SaveError(`图标文件太大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），请压到 2MB 以内`);
  }
  const target = `${FAVICON_DIR}/icon${ext}`;
  const { abs } = resolveSafe(target, { mustExist: false });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  return { rel: target, isSvg: ext === '.svg' };
}
