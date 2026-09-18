/**
 * 轻量 YAML 子集解析 / 生成器（零依赖）
 * ------------------------------------------------------------------
 * 目标不是实现完整 YAML 规范，而是安全地编辑 Hugo 站点里的 front matter：
 *
 *  1. 解析成带「行号区间」的节点树，每个键都知道自己占用文件的哪几行；
 *  2. 保存时只把「被编辑的那个键」的原始行替换成新生成的行，
 *     其余内容（包括注释、空行、未识别的键、Markdown 正文）字节级保留。
 *
 * 这样即使某个键的写法超出本解析器支持范围，只要它没被编辑，
 * 就绝不会被改写；解析失败时直接抛错，不做任何猜测性写入。
 */

export class YamlParseError extends Error {
  constructor(message, lineNo) {
    super(lineNo ? `${message}（第 ${lineNo} 行）` : message);
    this.name = 'YamlParseError';
    this.lineNo = lineNo;
  }
}

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

export function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n');
}

function toLines(text) {
  const norm = normalizeNewlines(text);
  const lines = norm.split('\n');
  // 末尾换行会产生一个空元素，去掉它（写入时再补回）
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((raw, i) => {
    const m = /^([ \t]*)(.*)$/.exec(raw);
    const indentRaw = m[1];
    const content = m[2];
    return {
      no: i + 1,
      index: i,
      raw,
      indent: indentRaw.length,
      content,
      blank: content.trim() === '',
      comment: content.trimStart().startsWith('#'),
    };
  });
}

function isSignificant(line) {
  return !line.blank && !line.comment;
}

/** 在 [i, limit) 内找到下一个有意义行；没有则返回 limit */
function nextSignificant(lines, i, limit) {
  while (i < limit && !isSignificant(lines[i])) i++;
  return i;
}

function findCommentStart(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '#' && (i === 0 || /\s/.test(s[i - 1]))) return i;
  }
  return -1;
}

/** 把一个单行文本拆成 key / rest；不是键值对则返回 null */
export function splitKeyValue(s) {
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < n) {
        if (q === '"' && s[i] === '\\') { i += 2; continue; }
        if (s[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '[' || c === '{') { i++; continue; }
    if (c === ':') {
      if (i + 1 === n || s[i + 1] === ' ' || s[i + 1] === '\t') {
        const keyRaw = s.slice(0, i).trim();
        if (!keyRaw) return null;
        return { key: unquoteKey(keyRaw), rest: s.slice(i + 1).trim() };
      }
    }
    i++;
  }
  return null;
}

function unquoteKey(k) {
  if (k.length >= 2 && (k[0] === '"' || k[0] === "'") && k[k.length - 1] === k[0]) {
    return unquoteScalar(k);
  }
  return k;
}

function unquoteScalar(s) {
  const q = s[0];
  if (q === '"') {
    const body = s.slice(1, -1);
    let out = '';
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c !== '\\') { out += c; continue; }
      const e = body[++i];
      switch (e) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case '0': out += '\0'; break;
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'u': {
          const hex = body.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4; }
          else out += 'u';
          break;
        }
        default: out += e ?? '';
      }
    }
    return out;
  }
  if (q === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/* ------------------------------------------------------------------ */
/* 标量解析                                                            */
/* ------------------------------------------------------------------ */

const NULLS = new Set(['', '~', 'null', 'Null', 'NULL']);
const TRUES = new Set(['true', 'True', 'TRUE', 'yes', 'Yes', 'YES', 'on', 'On', 'ON']);
const FALSES = new Set(['false', 'False', 'FALSE', 'no', 'No', 'NO', 'off', 'Off', 'OFF']);
const INT_RE = /^[+-]?\d+$/;
const FLOAT_RE = /^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/;

export function parseScalarToken(s) {
  const t = s.trim();
  if (NULLS.has(t)) return null;
  if (TRUES.has(t)) return true;
  if (FALSES.has(t)) return false;
  if (t[0] === '"' || t[0] === "'") return unquoteScalar(t);
  const ci = findCommentStart(t);
  let body = ci >= 0 ? t.slice(0, ci).trim() : t;
  if (INT_RE.test(body)) {
    const n = Number(body);
    if (Number.isSafeInteger(n)) return n;
  }
  if (FLOAT_RE.test(body)) {
    const n = Number(body);
    if (Number.isFinite(n) && /[.eE]/.test(body)) return n;
  }
  return body;
}

/* ------------------------------------------------------------------ */
/* 流式（flow）解析：[a, b] / {a: b, c: d}                             */
/* ------------------------------------------------------------------ */

function splitFlowItems(body) {
  const items = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'") {
      const q = c;
      cur += c;
      i++;
      while (i < body.length) {
        cur += body[i];
        if (q === '"' && body[i] === '\\') { cur += body[i + 1] ?? ''; i += 2; continue; }
        if (body[i] === q) break;
        i++;
      }
      continue;
    }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { items.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') items.push(cur);
  return items;
}

export function parseFlow(s) {
  const t = s.trim();
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) throw new YamlParseError('内联数组缺少 ]');
    const body = t.slice(1, -1).trim();
    if (!body) return [];
    return splitFlowItems(body).map((item) => parseInlineValue(item));
  }
  if (t.startsWith('{')) {
    if (!t.endsWith('}')) throw new YamlParseError('内联对象缺少 }');
    const body = t.slice(1, -1).trim();
    if (!body) return {};
    const out = {};
    for (const item of splitFlowItems(body)) {
      const kv = splitKeyValue(item.trim());
      if (!kv) throw new YamlParseError(`内联对象项无法解析：${item.trim()}`);
      out[kv.key] = parseInlineValue(kv.rest);
    }
    return out;
  }
  throw new YamlParseError('不是内联值');
}

function parseInlineValue(s) {
  const t = s.trim();
  if (t.startsWith('[') || t.startsWith('{')) return parseFlow(t);
  return parseScalarToken(t);
}

/* ------------------------------------------------------------------ */
/* 块解析（带行号区间）                                                 */
/* ------------------------------------------------------------------ */

const BLOCK_HEADER_RE = /^([|>])([+-]?)(\d*)$/;

/**
 * 一个键的区间不包含它后面的空行和注释——那些属于「下一个键」。
 * 否则重写该键时会顺手吞掉下一个键上方的注释（曾导致反复保存注释丢失）。
 */
function trimTrailingBlankRange(lines, startIdx, endIdx) {
  let end = endIdx;
  while (end > startIdx && (lines[end - 1].blank || lines[end - 1].comment)) end--;
  return end;
}

/** 收集块标量内容，返回 { text, end } */
function parseBlockScalar(lines, keyLineIdx, limit, keyIndent, header) {
  const style = header[0];
  const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';
  const explicit = /\d/.exec(header);
  let i = keyLineIdx + 1;
  const collected = [];
  let contentIndent = explicit ? keyIndent + Number(explicit[0]) : null;
  while (i < limit) {
    const L = lines[i];
    if (L.blank) { collected.push(L); i++; continue; }
    if (L.indent <= keyIndent) break;
    if (contentIndent === null) contentIndent = L.indent;
    collected.push(L);
    i++;
  }
  // 末尾空行不属于内容，留给后面的键
  let lastSig = collected.length;
  while (lastSig > 0 && collected[lastSig - 1].blank) lastSig--;
  const used = collected.slice(0, lastSig);
  const end = keyLineIdx + 1 + lastSig;

  if (contentIndent === null) contentIndent = keyIndent + 2;
  const rawTexts = used.map((L) => {
    if (L.blank) return '';
    const stripped = L.raw.slice(Math.min(contentIndent, L.indent));
    return stripped;
  });

  let text;
  if (style === '|') {
    text = rawTexts.join('\n');
  } else {
    // 折叠标量：段内用空格连接，空行分段
    const paras = [];
    let cur = [];
    let moreIndented = false;
    for (const t of rawTexts) {
      if (t === '') { if (cur.length) { paras.push({ lines: cur, more: moreIndented }); cur = []; moreIndented = false; } continue; }
      const isMore = /^[ \t]/.test(t);
      if (isMore || moreIndented) {
        if (cur.length && !moreIndented) { paras.push({ lines: cur, more: false }); cur = []; }
        moreIndented = true;
        cur.push(t);
      } else {
        cur.push(t.trim());
      }
    }
    if (cur.length) paras.push({ lines: cur, more: moreIndented });
    text = paras.map((p) => (p.more ? p.lines.join('\n') : p.lines.join(' '))).join('\n');
  }
  if (chomp === 'clip') {
    if (text !== '') text += '\n';
  } else if (chomp === 'keep') {
    text += '\n'.repeat(used.length - lastSig + 1 > 0 ? 1 : 0);
  }
  return { text, end };
}

function parseMap(lines, opts) {
  const { limit, indent } = opts;
  let i = opts.start;
  const entries = [];
  if (opts.firstKv) {
    const res = parseEntryValue(lines, opts.firstKv.line, limit, indent, opts.firstKv.rest);
    entries.push({ key: opts.firstKv.key, keyLine: opts.firstKv.line, valueEnd: res.end, node: res.node });
    i = res.end;
  }
  while (i < limit) {
    const L = lines[i];
    if (!isSignificant(L)) { i++; continue; }
    if (L.indent < indent) break;
    if (L.indent > indent) {
      throw new YamlParseError(`缩进不一致，意外的更深缩进：「${L.content.trim()}」`, L.no);
    }
    if (L.content === '-' || L.content.startsWith('- ')) break;
    const kv = splitKeyValue(L.content);
    if (!kv) throw new YamlParseError(`无法解析的行：「${L.content.trim()}」`, L.no);
    const res = parseEntryValue(lines, i, limit, indent, kv.rest);
    entries.push({ key: kv.key, keyLine: i, valueEnd: res.end, node: res.node });
    i = res.end;
  }
  const end = trimTrailingBlankRange(lines, opts.start, i);
  return {
    node: { kind: 'map', start: opts.start, end, indent, entries },
    end,
  };
}

function parseSeq(lines, opts) {
  const { limit, indent } = opts;
  let i = opts.start;
  const items = [];
  while (i < limit) {
    const L = lines[i];
    if (!isSignificant(L)) { i++; continue; }
    if (L.indent < indent) break;
    if (L.indent > indent) {
      throw new YamlParseError(`序列项缩进不一致：「${L.content.trim()}」`, L.no);
    }
    if (!(L.content === '-' || L.content.startsWith('- '))) break;
    let rest = L.content.slice(1);
    let k = 0;
    while (rest[k] === ' ') k++;
    rest = rest.slice(k);
    const restCol = L.indent + 1 + k;

    if (rest === '' || rest.startsWith('#')) {
      const res = parseValueBlock(lines, i + 1, limit, L.indent);
      items.push({ keyLine: i, valueEnd: res.end, node: res.node });
      i = res.end;
      continue;
    }
    const header = BLOCK_HEADER_RE.exec(rest);
    if (header) {
      const res = parseBlockScalar(lines, i, limit, L.indent, rest);
      items.push({ keyLine: i, valueEnd: res.end, node: { kind: 'scalar', value: res.text, start: i, end: res.end } });
      i = res.end;
      continue;
    }
    const kv = splitKeyValue(rest);
    if (kv) {
      // 紧凑写法：- key: value（后续键与第一个键对齐）
      const res = parseMap(lines, { start: i + 1, limit, indent: restCol, firstKv: { key: kv.key, rest: kv.rest, line: i } });
      items.push({ keyLine: i, valueEnd: res.end, node: res.node });
      i = res.end;
      continue;
    }
    if (rest === '-' || rest.startsWith('- ')) {
      const sub = parseSeq(lines, { start: i, limit, indent: restCol, firstItemInline: rest });
      items.push({ keyLine: i, valueEnd: sub.end, node: sub.node });
      i = sub.end;
      continue;
    }
    // 普通标量（可能后面还有续行，这里只支持单行）
    items.push({ keyLine: i, valueEnd: i + 1, node: { kind: 'scalar', value: parseInlineValue(rest), start: i, end: i + 1 } });
    i++;
  }
  const end = trimTrailingBlankRange(lines, opts.start, i);
  return {
    node: { kind: 'seq', start: opts.start, end, indent, items },
    end,
  };
}

/** 解析 key: 之后的取值，返回 { node, end }，end 为该键占用的最后一行 +1 */
function parseEntryValue(lines, keyLineIdx, limit, keyIndent, rest) {
  if (rest === '' || rest.startsWith('#')) {
    return parseValueBlock(lines, keyLineIdx + 1, limit, keyIndent);
  }
  const header = BLOCK_HEADER_RE.exec(rest);
  if (header) {
    const res = parseBlockScalar(lines, keyLineIdx, limit, keyIndent, rest);
    return { node: { kind: 'scalar', value: res.text, start: keyLineIdx, end: res.end }, end: res.end };
  }
  return { node: { kind: 'scalar', value: parseInlineValue(rest), start: keyLineIdx, end: keyLineIdx + 1 }, end: keyLineIdx + 1 };
}

/** 键后面换行写块的情形：找缩进更深的子块 */
function parseValueBlock(lines, start, limit, parentIndent) {
  const j = nextSignificant(lines, start, limit);
  if (j >= limit || lines[j].indent <= parentIndent) {
    return { node: { kind: 'scalar', value: null, start, end: nextSignificant(lines, start, limit) }, end: j };
  }
  const L = lines[j];
  if (L.content === '-' || L.content.startsWith('- ')) {
    const res = parseSeq(lines, { start: j, limit, indent: L.indent });
    return { node: res.node, end: res.end };
  }
  if (splitKeyValue(L.content)) {
    const res = parseMap(lines, { start: j, limit, indent: L.indent });
    return { node: res.node, end: res.end };
  }
  throw new YamlParseError(`无法解析的子块：「${L.content.trim()}」`, L.no);
}

/* ------------------------------------------------------------------ */
/* 对外：解析整段 YAML                                                 */
/* ------------------------------------------------------------------ */

export function parseYaml(text) {
  const lines = toLines(text);
  const limit = lines.length;
  const j = nextSignificant(lines, 0, limit);
  if (j >= limit) return { kind: 'map', start: 0, end: 0, entries: [] };
  const L = lines[j];
  if (L.content === '-' || L.content.startsWith('- ')) {
    return parseSeq(lines, { start: j, limit, indent: L.indent }).node;
  }
  return parseMap(lines, { start: j, limit, indent: L.indent }).node;
}

/* ------------------------------------------------------------------ */
/* 序列化                                                              */
/* ------------------------------------------------------------------ */

const PLAIN_SAFE_RE = /^[A-Za-z0-9\u00a1-\uffff][A-Za-z0-9 _.\u00a1-\uffff/@()%!?;=<>|^*~$&#+\-'",\[\]{}]*$/;
const DATE_LIKE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function scalarNeedsQuote(s) {
  if (s === '') return true;
  if (NULLS.has(s) || TRUES.has(s) || FALSES.has(s)) return true;
  if (INT_RE.test(s) || FLOAT_RE.test(s)) return true;
  if (DATE_LIKE_RE.test(s)) return false; // 保持原样（Hugo 两种都接受，且文件里本来就不加引号）
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return true;
  if (/[:#] /.test(s) || s.endsWith(':')) return true;
  if (/^\s|\s$/.test(s)) return true;
  if (!PLAIN_SAFE_RE.test(s)) return true;
  return false;
}

export function dumpScalar(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  const s = String(value);
  if (scalarNeedsQuote(s)) return JSON.stringify(s);
  return s;
}

/** 键名：能用裸写法就用裸写法 */
export function dumpKey(key) {
  const s = String(key);
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s)) return s;
  return JSON.stringify(s);
}

function isPlainScalarValue(v) {
  return v === null || typeof v !== 'object';
}

/** 多行字符串用字面块标量（|-）——首行是空行或以空格开头时退化为双引号转义 */
function canUseLiteralBlock(s) {
  if (!s.includes('\n')) return false;
  const first = s.split('\n')[0];
  if (first === '' || /^[ \t]/.test(first)) return false;
  if (/\r/.test(s)) return false;
  return true;
}

/**
 * 生成一个键（或序列项）占用的若干行。
 * @param {string} label  已格式化的键名，或 '' 表示序列项
 * @param {*} value
 * @param {number} col    该行起始列（块标量内容缩进 = col + 2）
 * @param {string} dashPrefix 形如 '- ' 的前缀（用于序列项），其长度必须等于 col
 */
export function dumpNode(label, value, col, dashPrefix = '') {
  const out = [];
  const pad = ' '.repeat(col);
  const head = (text) => {
    if (dashPrefix) {
      out.push(dashPrefix + text);
      dashPrefix = '';
    } else {
      out.push(pad + text);
    }
  };
  const keyPart = label ? `${dumpKey(label)}:` : '';

  if (typeof value === 'string' && value.includes('\n')) {
    if (canUseLiteralBlock(value)) {
      const body = value.endsWith('\n') ? value.slice(0, -1) : value;
      const chomp = value.endsWith('\n') ? '|' : '|-';
      head(`${keyPart}${keyPart ? ' ' : ''}${chomp}`);
      const bodyPad = ' '.repeat(col + 2);
      for (const line of body.split('\n')) out.push(line === '' ? '' : bodyPad + line);
      return out;
    }
    head(keyPart ? `${keyPart} ${JSON.stringify(value)}` : JSON.stringify(value));
    return out;
  }

  if (isPlainScalarValue(value)) {
    const dumped = dumpScalar(value);
    head(keyPart ? (dumped === '' ? keyPart : `${keyPart} ${dumped}`) : dumped);
    return out;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      head(keyPart ? `${keyPart} []` : '[]');
      return out;
    }
    head(keyPart);
    for (const item of value) {
      // 映射项用紧凑写法：第一个键写在 "- " 同一行，其余键与它左对齐
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length) {
          // 短横线所在列 = col + 2；键所在列 = col + 4（"- " 占两列）
          const dashCol = col + 2;
          out.push(...dumpNode(keys[0], item[keys[0]], dashCol + 2, ' '.repeat(dashCol) + '- '));
          for (const k of keys.slice(1)) out.push(...dumpNode(k, item[k], dashCol + 2));
          continue;
        }
      }
      out.push(...dumpNode('', item, col + 2, ' '.repeat(col + 2) + '- '));
    }
    return out;
  }

  // map
  const keys = Object.keys(value);
  if (keys.length === 0) {
    head(keyPart ? `${keyPart} {}` : '{}');
    return out;
  }
  head(keyPart);
  for (const k of keys) {
    out.push(...dumpNode(k, value[k], col + 2));
  }
  return out;
}

/** 生成完整的 YAML 文本（用于新建文件的 front matter 等） */
export function dumpYaml(value) {
  if (value === null || typeof value !== 'object') return dumpScalar(value) + '\n';
  if (Array.isArray(value)) {
    if (!value.length) return '[]\n';
    const out = [];
    for (const item of value) out.push(...dumpNode('', item, 0, '- '));
    return out.join('\n') + '\n';
  }
  const out = [];
  for (const k of Object.keys(value)) out.push(...dumpNode(k, value[k], 0));
  return out.join('\n') + '\n';
}
