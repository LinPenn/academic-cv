/**
 * 模块：首页照片（封面轮播）
 * ------------------------------------------------------------------
 * 照片放在 static/uploads/home/ 下；这里负责
 *   · 列出照片（含每张的取景参数）
 *   · 保存顺序与每张照片的取景（缩放 / 水平 / 垂直）
 *   · 删除（进回收站）
 *
 * 顺序与取景写在 data/home_photos.yaml：
 *   photos:
 *     - name: 2021.jpg
 *       zoom: 100
 *       x: 50
 *       y: 35
 * 没被记录的照片（新上传的）自动排在末尾，并使用默认取景。
 */

import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT, listFiles, trashPath, exists, resolveSafe, writeText, readText } from './store.mjs';
import { dumpYaml } from './yaml.mjs';
import { loadLayout } from './layout.mjs';

export const HOME_PHOTO_DIR = 'static/uploads/home';
export const HOME_PHOTO_FILE = 'data/home_photos.yaml';
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;

const DEFAULT_FRAMING = { zoom: 100, x: 50, y: 35 };

function photoFiles() {
  if (!exists(HOME_PHOTO_DIR)) return [];
  return listFiles(HOME_PHOTO_DIR)
    .filter((f) => !f.rel.endsWith('/') && IMAGE_EXT.test(f.rel))
    .map((f) => path.basename(f.rel))
    .sort((a, b) => a.localeCompare(b, 'zh'));
}

function num(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 读取已保存的顺序与取景 */
function readSaved() {
  if (!exists(HOME_PHOTO_FILE)) return [];
  const text = readText(HOME_PHOTO_FILE).text;
  const out = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*-\s*name:\s*(.+?)\s*$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { name: m[1].replace(/^["']|["']$/g, '') };
      continue;
    }
    const kv = /^\s+(zoom|x|y):\s*([\d.]+)\s*$/.exec(line);
    if (kv && cur) cur[kv[1]] = Number(kv[2]);
  }
  if (cur) out.push(cur);
  return out.filter((p) => p.name);
}

export function listHomePhotos() {
  const layout = loadLayout();
  const names = photoFiles();
  const saved = readSaved();

  const ordered = [
    ...saved.filter((s) => names.includes(s.name)),
    ...names.filter((n) => !saved.some((s) => s.name === n))
      .map((n) => ({ name: n })),
  ].map((s) => ({
    name: s.name,
    zoom: num(s.zoom, 100, 220, DEFAULT_FRAMING.zoom),
    x: num(s.x, 0, 100, DEFAULT_FRAMING.x),
    y: num(s.y, 0, 100, DEFAULT_FRAMING.y),
    saved: saved.some((o) => o.name === s.name),
  }));

  return {
    dir: HOME_PHOTO_DIR,
    file: HOME_PHOTO_FILE,
    order: ordered.map((p) => p.name),
    photos: ordered.map((p) => {
      const rel = `${HOME_PHOTO_DIR}/${p.name}`;
      let size = 0;
      let mtime = 0;
      try {
        const st = fs.statSync(path.join(SITE_ROOT, rel));
        size = st.size;
        mtime = st.mtimeMs;
      } catch { /* 忽略 */ }
      return { ...p, rel, url: `/uploads/home/${p.name}`, size, mtime };
    }),
    values: {
      'home.slide_interval': layout.values['home.slide_interval'],
      'home.slide_fade': layout.values['home.slide_fade'] ?? 1.6,
    },
  };
}

/** 保存顺序 + 每张照片的取景 */
export function saveHomePhotos({ photos = [], values = null } = {}) {
  const names = photoFiles();
  const clean = photos
    .filter((p) => p && names.includes(p.name))
    .map((p) => ({
      name: p.name,
      zoom: num(p.zoom, 100, 220, DEFAULT_FRAMING.zoom),
      x: num(p.x, 0, 100, DEFAULT_FRAMING.x),
      y: num(p.y, 0, 100, DEFAULT_FRAMING.y),
    }));
  for (const n of names) {
    if (!clean.some((c) => c.name === n)) clean.push({ name: n, ...DEFAULT_FRAMING });
  }

  const before = exists(HOME_PHOTO_FILE) ? readText(HOME_PHOTO_FILE).text : '';
  const after = dumpYaml({ photos: clean });
  let changed = before.trim() !== after.trim();
  if (changed) {
    writeText(HOME_PHOTO_FILE, after);
  }
  return { changed, photos: clean, values };
}

/** 删除一张照片（进回收站），并从配置里去掉 */
export function deleteHomePhoto({ name } = {}) {
  if (!name || !IMAGE_EXT.test(name)) throw new Error('文件名不合法');
  const rel = `${HOME_PHOTO_DIR}/${name}`;
  const { rel: safeRel } = resolveSafe(rel, { mustExist: true });
  const removed = trashPath(safeRel, '删除首页照片');
  const saved = readSaved().filter((p) => p.name !== name);
  if (saved.length || exists(HOME_PHOTO_FILE)) {
    writeText(HOME_PHOTO_FILE, dumpYaml({ photos: saved }));
  }
  return { removed: removed.rel, name };
}
