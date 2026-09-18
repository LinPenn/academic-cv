/**
 * 探测本机是否已经有编辑器实例在运行（供 start-editor.bat / .sh 使用）
 * 有则打印端口号，没有则不输出任何内容。
 *
 * 目的：避免实验室同学重复双击启动脚本，导致同时跑起多个实例
 * （每个实例都会再起一个 hugo server，白占几百 MB 内存，还容易端口混乱）。
 */

const PORTS = [];
for (let p = 7788; p <= 7800; p++) PORTS.push(p);

const results = await Promise.all(PORTS.map(async (port) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(600) });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.app === 'lab-site-editor' ? { port, pid: data.pid } : null;
  } catch {
    return null;
  }
}));

const found = results.filter(Boolean);
if (found.length) {
  // 输出格式：第一个是端口，用来拼地址
  console.log(String(found[0].port));
  if (process.env.EDITOR_VERBOSE) {
    for (const f of found) console.error(`  已在运行：端口 ${f.port}（pid ${f.pid}）`);
  }
}
