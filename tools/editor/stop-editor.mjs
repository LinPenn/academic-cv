/**
 * 停止本地编辑器与预览，释放端口
 * ------------------------------------------------------------------
 * · 先优雅停掉预览（通过编辑器接口，释放 1313 等 hugo 端口）
 * · 再结束编辑器进程（释放 7788 等端口）
 * · 最后清理本仓库残留的 hugo 进程（只杀命令行里包含本目录的，
 *   不会碰其它项目的 hugo）
 *
 * 用法： node tools/editor/stop-editor.mjs
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORTS = [];
for (let p = 7788; p <= 7800; p++) PORTS.push(p);
const HUGO_PORTS = [1313, 1314, 1399, 1431, 1513];

const nl = new RegExp(String.fromCharCode(92) + 'r?' + String.fromCharCode(92) + 'n');

async function findEditor() {
  for (const port of PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(600) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.app === 'lab-site-editor') return { port, pid: data.pid };
    } catch { /* 该端口没有编辑器 */ }
  }
  return null;
}

function killPid(pid, { tree = false } = {}) {
  const args = tree ? ['/F', '/T', '/PID', String(pid)] : ['/F', '/PID', String(pid)];
  try {
    execFileSync('taskkill', args, { stdio: 'ignore', timeout: 10000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** 清理本仓库残留的 hugo（按命令行里是否包含项目路径判断） */
function killStrayHugo() {
  const killed = [];
  try {
    const q = String.fromCharCode(39);
    const ps = 'Get-CimInstance Win32_Process -Filter "Name=' + q + 'hugo.exe' + q + '"'
      + ' | Where-Object { $_.CommandLine -like ' + q + '*' + ROOT + '*' + q + ' }'
      + ' | Select-Object -ExpandProperty ProcessId';
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8', timeout: 20000, windowsHide: true,
    });
    for (const line of String(out).split(nl)) {
      const pid = Number(line.trim());
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (killPid(pid)) killed.push(pid);
    }
  } catch { /* 查询失败就算了 */ }
  return killed;
}

function portBusy(port) {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    return out.split(nl).some((l) => l.includes(`:${port} `) && l.includes('LISTENING'));
  } catch {
    return false;
  }
}

const editor = await findEditor();

if (editor) {
  console.log(`发现编辑器：端口 ${editor.port}，进程 ${editor.pid}`);
  // 1) 优雅停掉预览（释放 hugo 端口）
  try {
    await fetch(`http://127.0.0.1:${editor.port}/api/preview/stop`, {
      method: 'POST',
      headers: { 'x-editor': '1' },
      signal: AbortSignal.timeout(5000),
    });
    console.log('  已通知预览服务停止（释放 hugo 端口）');
  } catch { /* 编辑器可能已经在退出 */ }

  // 2) 结束编辑器（连带子进程）
  if (killPid(editor.pid, { tree: true })) console.log(`  已结束编辑器进程 ${editor.pid}（释放端口 ${editor.port}）`);
} else {
  console.log('没有发现正在运行的编辑器（7788~7800 都没响应）');
}

// 3) 兜底：清理本仓库残留的 hugo
const strays = killStrayHugo();
if (strays.length) console.log(`  已清理残留预览进程：${strays.join(', ')}`);

// 4) 确认端口状态
await new Promise((r) => setTimeout(r, 1200));
const stillBusy = [...PORTS, ...HUGO_PORTS].filter(portBusy);
console.log('');
if (stillBusy.length) {
  console.log(`以下端口仍被占用：${stillBusy.join(', ')}`);
  console.log('可能是别的程序（不是本项目）。查看占用者：netstat -ano | findstr :端口号');
  process.exitCode = 1;
} else {
  console.log('端口已全部释放：7788~7800（编辑器）、1313/1314/1399/1431/1513（预览）');
  console.log('重新启动：双击项目根目录的 start-editor.bat');
}
