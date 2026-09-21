/**
 * 模块：页面布局
 * ------------------------------------------------------------------
 * 把首页 / 研究页的间距与宽度集中到 data/layout.yaml，编辑器里改数字即可，
 * 不用再去动正文 HTML 和 CSS（模板侧由 layouts/_partials/hooks/head-end/spacing.html 读取）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT, exists, ensureEditorDirs, createText, readText } from './store.mjs';
import { saveByPath } from './site.mjs';

const LAYOUT_FILE = 'data/layout.yaml';

/**
 * 可编辑的布局参数。min/max 用于兜底：填成 0 或超大值都不会把页面搞坏。
 * group 决定在编辑器里归到哪一块。
 */
export const FIELDS = [
  { path: 'home.hero_height', group: 'home', label: '封面高度（%视口）', def: 100, min: 40, max: 130 },
  // 封面照片的显示方式（归到「首页照片」模块里调）
  { path: 'home.photo_zoom', group: 'photos', label: '照片缩放（%）', def: 100, min: 100, max: 220 },
  { path: 'home.photo_pos_x', group: 'photos', label: '水平取景（%，0 左 100 右）', def: 50, min: 0, max: 100 },
  { path: 'home.photo_pos_y', group: 'photos', label: '垂直取景（%，0 上 100 下）', def: 35, min: 0, max: 100 },
  { path: 'home.slide_interval', group: 'photos', label: '自动切换间隔（秒）', def: 6, min: 2, max: 60 },
  { path: 'home.slide_fade', group: 'photos', label: '淡入淡出时长（秒）', def: 1.6, min: 0, max: 6, step: 0.1 },
  { path: 'home.top_gap', group: 'home', label: '顶部留白', def: 8, min: 0, max: 400 },
  { path: 'home.title_gap_top', group: 'home', label: '大标题上方留白', def: 8, min: 0, max: 400 },
  { path: 'home.title_gap_bottom', group: 'home', label: '标题与主图之间', def: 8, min: 0, max: 400 },
  { path: 'home.image_max_width', group: 'home', label: '主图最大宽度', def: 1200, min: 200, max: 4000 },
  { path: 'home.image_text_gap', group: 'home', label: '主图与正文之间', def: 24, min: 0, max: 400 },
  { path: 'home.text_max_width', group: 'home', label: '正文最大宽度', def: 1100, min: 200, max: 4000 },

  // 校徽（左上角，编辑器「校徽」模块）
  { path: 'logo.image', group: 'logo', type: 'text', label: '校徽图片', def: 'uploads/cau.png' },
  { path: 'logo.height', group: 'logo', label: '高度（px）', def: 40, min: 16, max: 96 },
  { path: 'logo.position', group: 'logo', type: 'text', label: '位置（left/right）', def: 'left' },
  { path: 'logo.show_home', group: 'logo', label: '首页显示', def: 1, min: 0, max: 1 },
  { path: 'logo.show_all', group: 'logo', label: '其它页面也显示', def: 0, min: 0, max: 1 },
  { path: 'logo.hide_site_name', group: 'logo', label: '首页隐藏站名', def: 1, min: 0, max: 1 },

  { path: 'research.top_gap', group: 'research', label: '顶部留白', def: 24, min: 0, max: 400 },
  { path: 'research.cards_gap_top', group: 'research', label: '卡片区上方留白', def: 8, min: 0, max: 400 },
];

function defaults() {
  const out = {};
  for (const f of FIELDS) out[f.path] = f.def;
  return out;
}

function readRaw() {
  const abs = path.join(SITE_ROOT, LAYOUT_FILE);
  if (!fs.existsSync(abs)) return null;
  try {
    return readText(LAYOUT_FILE).text;
  } catch {
    return null;
  }
}

/** 极简 YAML 读取：这里只需要「两级缩进的数字」，不必引入完整解析器 */
function parseNumbers(text) {
  const out = {};
  let group = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const top = /^([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (top) { group = top[1]; continue; }
    const kv = /^\s+([A-Za-z_][\w-]*):\s*([^#]*?)\s*$/.exec(line);
    if (kv && group) {
      const raw = String(kv[2]).replace(/["']/g, '').trim();
      if (raw === '') continue;
      const n = Number(raw);
      out[`${group}.${kv[1]}`] = Number.isFinite(n) ? n : raw;   // 数字就存数字，其它按字符串
    }
  }
  return out;
}

function clamp(field, value) {
  if (field.type === 'text') return String(value ?? '').trim();
  const raw = Number(value);
  const n = Number.isFinite(raw) && !Number.isInteger(raw) ? Math.round(raw * 10) / 10 : Math.round(raw);
  if (!Number.isFinite(n)) return field.def;
  return Math.min(field.max, Math.max(field.min, n));
}

export function loadLayout() {
  const text = readRaw();
  const raw = text ? parseNumbers(text) : {};
  const values = defaults();
  for (const f of FIELDS) {
    if (raw[f.path] !== undefined) values[f.path] = raw[f.path];
  }
  return {
    file: LAYOUT_FILE,
    exists: text !== null,
    fields: FIELDS.map((f) => ({ ...f, value: values[f.path] })),
    values,
    defaults: defaults(),
  };
}

export function saveLayout({ values = {}, dryRun = false } = {}) {
  ensureEditorDirs();
  if (!exists(LAYOUT_FILE)) createText(LAYOUT_FILE, template());

  const ops = [];
  const skipped = [];
  for (const f of FIELDS) {
    const v = values[f.path];
    if (v === undefined || v === null || v === '') { skipped.push(f.path); continue; }
    ops.push([f.path, clamp(f, v)]);
  }
  if (!ops.length) return { changed: false, skipped, values: loadLayout().values };

  const res = saveByPath(LAYOUT_FILE, ops, dryRun, { strict: false, createMissing: true });
  // dry-run 时不写盘，返回「按上限/下限纠正后」的值，方便界面提示
  const intended = { ...loadLayout().values };
  for (const [k, v] of ops) intended[k] = v;
  return { ...res, skipped, intended, values: dryRun ? intended : loadLayout().values };
}

function template() {
  const lines = ['# 页面布局参数（由编辑器「页面布局」模块维护，单位 px）', ''];
  let g = null;
  for (const f of FIELDS) {
    if (f.group !== g) {
      g = f.group;
      lines.push(`${g}:`);
    }
    lines.push(`  ${f.path.split('.')[1]}: ${f.def}`);
  }
  lines.push('');
  return lines.join('\n');
}
