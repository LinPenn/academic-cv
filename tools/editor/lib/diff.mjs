/** 极简行级 diff（用于保存前给用户看改动），基于 LCS */

function lcsMatrix(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j]
        ? dp[at(i + 1, j + 1)] + 1
        : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }
  return { dp, at, n, m };
}

/** 返回 [{type:' '|'-'|'+', text}] */
export function lineDiff(aLines, bLines) {
  const { dp, at, n, m } = lcsMatrix(aLines, bLines);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) { out.push({ type: ' ', text: aLines[i] }); i++; j++; continue; }
    if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) { out.push({ type: '-', text: aLines[i] }); i++; }
    else { out.push({ type: '+', text: bLines[j] }); j++; }
  }
  while (i < n) { out.push({ type: '-', text: aLines[i++] }); }
  while (j < m) { out.push({ type: '+', text: bLines[j++] }); }
  return out;
}

/** 生成带上下文的可读 diff 文本 */
export function unifiedDiff(aText, bText, { context = 2, maxLines = 300 } = {}) {
  const a = aText.replace(/\r\n?/g, '\n').split('\n');
  const b = bText.replace(/\r\n?/g, '\n').split('\n');
  const ops = lineDiff(a, b);
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type === ' ') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });
  const lines = [];
  let lastKept = -2;
  ops.forEach((op, idx) => {
    if (!keep[idx]) return;
    if (idx - lastKept > 1) lines.push({ type: '@', text: '…' });
    lines.push(op);
    lastKept = idx;
  });
  const changed = ops.filter((o) => o.type !== ' ').length;
  if (lines.length > maxLines) {
    return { changed, truncated: true, lines: lines.slice(0, maxLines) };
  }
  return { changed, truncated: false, lines };
}
