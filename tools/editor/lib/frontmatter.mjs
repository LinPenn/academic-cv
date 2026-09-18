/**
 * Front matter 文档模型
 * ------------------------------------------------------------------
 * 读：把 Markdown 文件拆成 front matter（YAML）与正文两部分，并把 front matter
 *     解析成带行号区间的节点树。
 * 写：applyChanges() 只重写「用户实际改动的那个键」所占的行，其它一切原样保留。
 *
 * 每一次写入都会做三重校验：
 *   1) 新文本能重新解析；
 *   2) 被改动的路径解析回来等于期望值；
 *   3) 未改动的路径解析回来等于原值。
 * 任一不通过就抛错、拒绝落盘。
 */

import { YamlParseError, dumpNode, dumpKey, parseYaml } from './yaml.mjs';

export class SaveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SaveError';
  }
}

const FM_DELIM = /^---\s*$/;

/**
 * 解析文件。
 * @param {string} text
 * @param {{plain?: boolean}} [opts] plain=true 用于纯 YAML 文件（config/*.yaml，
 *        没有 --- 分隔符，整份文件都是 YAML），此时 fmOffset=0 且正文为空。
 */
export function parseFile(text, { plain = false } = {}) {
  let src = text;
  let bom = false;
  if (src.charCodeAt(0) === 0xfeff) {
    bom = true;
    src = src.slice(1);
  }
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const trailingNewline = lines.length > 1 && lines[lines.length - 1] === '';
  if (trailingNewline) lines.pop();

  if (plain) {
    const fmLines = lines.slice();
    let tree = null;
    let parseError = null;
    if (fmLines.join('').trim() !== '') {
      try {
        tree = parseYaml(fmLines.join('\n'));
      } catch (err) {
        parseError = err instanceof YamlParseError ? err.message : String(err);
      }
    } else {
      tree = { kind: 'map', start: 0, end: 0, indent: 0, entries: [] };
    }
    return {
      bom, eol, lines, trailingNewline, plain: true,
      hasFrontMatter: true, fmStart: 0, fmEnd: lines.length, fmOffset: 0,
      fmLines, fmText: fmLines.join('\n'), tree, parseError,
      bodyStart: lines.length,
    };
  }

  let fmStart = -1;
  let fmEnd = -1;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (lines[i].trim() === '---') { fmStart = i; break; }
    if (lines[i].trim() !== '') break;
  }
  if (fmStart >= 0) {
    for (let i = fmStart + 1; i < lines.length; i++) {
      if (FM_DELIM.test(lines[i]) || lines[i].trim() === '...') { fmEnd = i; break; }
    }
  }
  const hasFrontMatter = fmStart === 0 && fmEnd > 0;
  const fmLines = hasFrontMatter ? lines.slice(1, fmEnd) : [];
  const fmText = fmLines.join('\n');

  let tree = null;
  let parseError = null;
  if (hasFrontMatter && fmText.trim() !== '') {
    try {
      tree = parseYaml(fmText);
    } catch (err) {
      parseError = err instanceof YamlParseError ? err.message : String(err);
    }
  } else if (hasFrontMatter) {
    tree = { kind: 'map', start: 0, end: 0, indent: 0, entries: [] };
  }

  return {
    bom,
    eol,
    lines,
    trailingNewline,
    hasFrontMatter,
    fmStart,
    fmEnd,
    fmOffset: fmStart + 1, // front matter 第 0 行在整份文件中的下标
    fmLines,
    fmText,
    tree,
    parseError,
    bodyStart: hasFrontMatter ? fmEnd + 1 : 0,
  };
}

/* ------------------------------------------------------------------ */
/* 取值                                                                */
/* ------------------------------------------------------------------ */

function nodeToValue(node) {
  if (!node) return undefined;
  if (node.kind === 'scalar') return node.value;
  if (node.kind === 'seq') return node.items.map((it) => nodeToValue(it.node));
  if (node.kind === 'map') {
    const out = {};
    for (const e of node.entries) out[e.key] = nodeToValue(e.node);
    return out;
  }
  return undefined;
}

export function getPath(doc, path) {
  if (!doc.tree) return undefined;
  let node = doc.tree;
  for (const seg of path) {
    if (node == null) return undefined;
    if (node.kind === 'map') {
      const e = node.entries.find((x) => x.key === String(seg));
      if (!e) return undefined;
      node = e.node;
    } else if (node.kind === 'seq') {
      const it = node.items[Number(seg)];
      if (!it) return undefined;
      node = it.node;
    } else {
      return undefined;
    }
  }
  return nodeToValue(node);
}

export function getFrontMatter(doc) {
  return nodeToValue(doc.tree) ?? {};
}

/* ------------------------------------------------------------------ */
/* 改写                                                                */
/* ------------------------------------------------------------------ */

function resolveTarget(doc, path) {
  if (!doc.tree) throw new SaveError('该文件没有 front matter，无法按键写入');
  if (path.length === 0) throw new SaveError('路径不能为空');
  let node = doc.tree;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (node.kind === 'map') {
      const e = node.entries.find((x) => x.key === String(seg));
      if (!e) throw new SaveError(`找不到字段路径 ${path.slice(0, i + 1).join('.')}`);
      node = e.node;
    } else if (node.kind === 'seq') {
      const it = node.items[Number(seg)];
      if (!it) throw new SaveError(`找不到列表项 ${path.slice(0, i + 1).join('.')}`);
      node = it.node;
    } else {
      throw new SaveError(`字段 ${path.slice(0, i + 1).join('.')} 不是容器，无法继续深入`);
    }
  }
  const last = path[path.length - 1];
  if (node.kind === 'map') {
    const entry = node.entries.find((x) => x.key === String(last));
    return { parent: node, kind: 'map', key: String(last), entry };
  }
  if (node.kind === 'seq') {
    const idx = Number(last);
    const item = Number.isInteger(idx) ? node.items[idx] : undefined;
    return { parent: node, kind: 'seq', index: idx, entry: item };
  }
  throw new SaveError(`字段 ${path.join('.')} 的父级不是容器`);
}

/**
 * 注意：节点树里的行号是「front matter 内部行号」（0 起），
 * 而 doc.lines 是「整个文件的行」。二者相差 doc.fmOffset。
 * 早期版本漏了这个偏移，导致生成的键被写进了上一段块标量里——务必小心。
 */
function indentOfFmLine(doc, fmIdx) {
  const m = /^([ ]*)/.exec(doc.lines[fmIdx + doc.fmOffset] ?? '');
  return m ? m[1].length : 0;
}

/** 计算某个容器在文件中的缩进（用于插入新键） */
function containerIndent(doc, container) {
  if (container.kind === 'map' && container.entries.length) {
    return indentOfFmLine(doc, container.entries[0].keyLine);
  }
  if (container.kind === 'seq' && container.items.length) {
    return indentOfFmLine(doc, container.items[0].keyLine);
  }
  return container.indent ?? 0;
}

/**
 * @param {object} doc  parseFile 的结果
 * @param {Array<{path: (string|number)[], value: any}>} changes
 * @returns {string} 新的文件全文
 */
export function applyChanges(doc, changes) {
  if (!changes?.length) return serialize(doc);
  const lines = doc.lines.slice();
  const fmOffset = doc.fmOffset;

  const ops = [];
  for (const change of changes) {
    const path = change.path.map((s) => (typeof s === 'number' ? String(s) : s));
    const { parent, kind, key, entry } = resolveTarget(doc, path);
    const col = kind === 'map'
      ? (entry ? indentOfFmLine(doc, entry.keyLine) : containerIndent(doc, parent))
      : (entry ? indentOfFmLine(doc, entry.keyLine) : containerIndent(doc, parent) + 2);
    const newLines = kind === 'map'
      ? emitEntry(doc, change.value, entry ?? null, key, col, ' '.repeat(col))
      : emitEntry(doc, change.value, entry ?? null, '', col, ' '.repeat(col) + '- ');
    if (entry) {
      ops.push({ from: entry.keyLine, to: entry.valueEnd, lines: newLines });
    } else {
      const at = parent.end ?? (parent.start ?? 0);
      ops.push({ from: at, to: at, lines: newLines, insertAt: at });
    }
  }

  ops.sort((a, b) => b.from - a.from);
  for (const op of ops) {
    const fmFrom = op.from + fmOffset;
    const fmTo = op.to + fmOffset;
    lines.splice(fmFrom, fmTo - fmFrom, ...op.lines);
  }
  return serialize({ ...doc, lines });
}

/* ------------------------------------------------------------------ */
/* 智能生成：未变化的条目直接复用原文行                                */
/* ------------------------------------------------------------------ */

function leadingSpaces(s) {
  const m = /^ */.exec(s ?? '');
  return m ? m[0].length : 0;
}

/**
 * 复用原文行之前，必须确认缩进仍然吻合。
 * 注意 "- key: v" 这种紧凑写法：行首空格数是「短横线的列」，而不是键的列，
 * 所以序列项要用「前缀匹配」，普通键才用「前导空格数相等」。
 */
function indentMatches(rawFirstLine, prefix) {
  if (!rawFirstLine) return false;
  if (prefix.trim().startsWith('-')) return rawFirstLine.startsWith(prefix);
  return leadingSpaces(rawFirstLine) === prefix.length;
}

/**
 * 取一份「原始引用」在文件中的原始行。
 * 引用有两种形态，务必都支持（曾经因为混用导致复用判定永远失败）：
 *   · 条目包装对象 { key, keyLine, valueEnd, node }  —— 含键名/短横线那一行
 *   · 纯节点 { kind, start, end, ... }
 */
function rawLinesOf(doc, ref) {
  if (!ref) return null;
  const start = ref.keyLine !== undefined ? ref.keyLine : ref.start;
  if (start === undefined) return null;
  const end = ref.valueEnd !== undefined ? ref.valueEnd
    : (ref.end !== undefined ? ref.end : start + 1);
  const from = start + doc.fmOffset;
  if (from >= doc.lines.length) return null;
  return doc.lines.slice(from, Math.min(end + doc.fmOffset, doc.lines.length));
}

/** 从「条目包装对象」或「节点」里取出真正的节点 */
function refNode(ref) {
  return ref?.node ?? ref ?? null;
}

function refKind(ref) {
  return refNode(ref)?.kind;
}

function refToValue(ref) {
  const node = refNode(ref);
  return node ? nodeToValue(node) : undefined;
}

function sameAsNode(ref, value) {
  if (!ref) return false;
  try {
    return deepEqual(refToValue(ref), value === undefined ? null : value);
  } catch {
    return false;
  }
}

/**
 * 生成一个条目（键或序列项）的行。
 * 关键点：如果新值和文件里原来的值完全一样，就直接沿用原来的行，
 * 这样「加一条论文」在 git 里就只是一行新增，而不是把 92 条全改一遍。
 *
 * @param label 键名；序列项传 ''（此时首行内容要写在 "- " 后面）
 * @param col   该条目的起始列（键所在列 / "-" 所在列）
 * @param prefix 首行前缀（普通键为空格填充；序列项为 '  - '）
 */
function emitEntry(doc, value, oldNode, label, col, prefix) {
  const isSeqItem = label === '';
  const keyText = isSeqItem ? '' : `${dumpKey(label)}:`;
  const childCol = col + 2;
  const header = isSeqItem ? prefix : `${prefix}${keyText}`;

  // ① 值没变 → 复用原文（需缩进一致）
  if (oldNode && sameAsNode(oldNode, value)) {
    const raw = rawLinesOf(doc, oldNode);
    if (raw?.length && indentMatches(raw[0], prefix)) return raw;
  }

  // ② 数组
  if (Array.isArray(value)) {
    if (!value.length) return [isSeqItem ? `${prefix}[]` : `${header} []`];
    const out = isSeqItem ? [prefix.trimEnd()] : [header];
    const itemPad = ' '.repeat(childCol);
    const oldItems = refKind(oldNode) === 'seq' ? [...refNode(oldNode).items] : [];
    const used = new Array(oldItems.length).fill(false);
    const match = new Array(value.length).fill(null);
    /**
     * 分两遍认领旧条目：
     *   1) 先按值精确匹配 —— 没变化的条目整段复用原文；
     *   2) 剩下的（新增或被改动的）再按位置就近认领，这样即使某条内容变了，
     *      它内部没变的键仍能沿用原文。
     *
     * 顺序不能颠倒：如果一边遍历一边按位置兜底，插入一条会把后面的对应关系全部错位，
     * 于是所有旧条目都被重新生成（引号被去掉、diff 变成整段重写）。
     */
    value.forEach((item, idx) => {
      const hit = oldItems.findIndex((it, k) => !used[k] && sameAsNode(it, item));
      if (hit >= 0) {
        used[hit] = true;
        match[idx] = oldItems[hit];
      }
    });
    value.forEach((item, idx) => {
      if (match[idx]) return;
      const hit = (idx < oldItems.length && !used[idx]) ? idx : used.findIndex((u) => !u);
      if (hit >= 0) {
        used[hit] = true;
        match[idx] = oldItems[hit];
      }
    });
    value.forEach((item, idx) => {
      const old = match[idx];
      if (old) {
        const raw = rawLinesOf(doc, old);
        if (raw?.length && indentMatches(raw[0], `${itemPad}- `) && sameAsNode(old, item)) {
          out.push(...raw);
          return;
        }
      }
      out.push(...emitEntry(doc, item, old, '', childCol, `${itemPad}- `));
    });
    return out;
  }

  // ③ 对象
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return [isSeqItem ? `${prefix}{}` : `${header} {}`];
    const out = isSeqItem ? [] : [header];
    const childPad = ' '.repeat(childCol);
    keys.forEach((k, i) => {
      const parent = refNode(oldNode);
      const oldEntry = refKind(oldNode) === 'map' ? parent.entries.find((e) => e.key === k) : null;
      // 序列项对象：第一个键写在 "- " 同一行上，其余键与它左对齐
      const childPrefix = (isSeqItem && i === 0) ? prefix : childPad;
      out.push(...emitEntry(doc, value[k], oldEntry, k, childCol, childPrefix));
    });
    return out;
  }

  // ④ 标量 / 多行字符串
  return dumpNode(label, value, col, prefix);
}

function serialize(doc) {
  let text = doc.lines.join(doc.eol ?? '\n');
  if (doc.trailingNewline !== false) text += doc.eol ?? '\n';
  if (doc.bom) text = '\ufeff' + text;
  return text;
}

/* ------------------------------------------------------------------ */
/* 校验                                                                */
/* ------------------------------------------------------------------ */

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-12;
  return false;
}

/**
 * 安全写入：生成新文本 → 重新解析 → 逐项校验 → 返回文本
 * 校验不通过时抛 SaveError，调用方不得写盘。
 */
export function buildVerifiedText(doc, changes, { allowNewKeys = true } = {}) {
  const before = getFrontMatter(doc);
  const next = applyChanges(doc, changes);
  let reparsed;
  try {
    reparsed = parseFile(next, { plain: doc.plain === true });
  } catch (err) {
    throw new SaveError(`写入后无法重新解析，已取消保存：${err.message}`);
  }
  if (reparsed.parseError) {
    throw new SaveError(`写入后 front matter 解析失败，已取消保存：${reparsed.parseError}`);
  }
  if (!reparsed.hasFrontMatter && doc.hasFrontMatter) {
    throw new SaveError('写入后 front matter 丢失，已取消保存');
  }
  const after = getFrontMatter(reparsed);
  for (const change of changes) {
    const path = change.path.map(String);
    const got = getPath(reparsed, path);
    if (!deepEqual(got, normalize(change.value))) {
      throw new SaveError(
        `字段 ${path.join('.')} 写入校验失败：写入 ${brief(normalize(change.value))}，读回 ${brief(got)}，已取消保存`,
      );
    }
  }
  if (!allowNewKeys) {
    for (const key of Object.keys(after)) {
      if (!(key in before)) throw new SaveError(`不允许新增字段 ${key}`);
    }
  }
  return { text: next, doc: reparsed, frontMatter: after };
}

function brief(v) {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > 120 ? `${s.slice(0, 120)}…（共 ${s.length} 字符）` : s;
}

function normalize(v) {
  if (v === undefined) return null;
  return v;
}

/**
 * 替换 Markdown 正文（front matter 之外的整段内容）。
 * front matter 部分逐字节保留。
 */
export function applyBody(doc, bodyText) {
  const lines = doc.lines.slice(0, doc.bodyStart);
  const bodyLines = String(bodyText).replace(/\r\n?/g, '\n').split('\n');
  while (bodyLines.length && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();
  return serialize({ ...doc, lines: [...lines, ...bodyLines], trailingNewline: true });
}

export function getBody(doc) {
  return doc.lines.slice(doc.bodyStart).join(doc.eol ?? '\n');
}

export { deepEqual };
