/**
 * Hugo 预览服务
 * ------------------------------------------------------------------
 * · 启动 hugo server（草稿/未来日期也构建，便于预览未发布的新闻）；
 * · 把它反向代理到编辑器同一个端口下，这样：
 *     - 预览用同源 iframe，不需要跨域设置；
 *     - 站点本身是 GitHub Pages 的「项目站点」，路径带 /academic-cv/ 前缀，
 *       代理会完整保留该前缀，预览里的相对链接因此和线上一致。
 * · 支持 WebSocket 升级（Hugo 的 livereload）；
 * · 另外提供「构建校验」：hugo --renderToMemory，用来确认改动没有把站点改坏。
 */

import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { SITE_ROOT } from './store.mjs';

const HUGO_CANDIDATES = [
  '.bin/hugo.exe',
  '.bin/hugo_v164.exe',
  '.bin/hugo_v131.exe',
  '.bin/hugo',
];

export function findHugo() {
  for (const rel of HUGO_CANDIDATES) {
    const abs = path.join(SITE_ROOT, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return 'hugo'; // 退回到 PATH
}

export function hugoVersion() {
  return new Promise((resolve) => {
    const p = spawn(findHugo(), ['version'], { cwd: SITE_ROOT, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => resolve({ ok: false, message: `找不到 hugo 可执行文件：${e.message}` }));
    p.on('close', (code) => resolve(code === 0
      ? { ok: true, version: out.trim() }
      : { ok: false, message: out.trim() || `hugo version 退出码 ${code}` }));
  });
}

const PORTS = [1313, 1314, 1399, 1431, 1513];
const PID_FILE = path.join(SITE_ROOT, '.editor', 'preview.pid');

/**
 * 清理「上一个编辑器进程留下的」hugo 进程。
 *
 * 为什么需要：Windows 下用 taskkill /F 结束编辑器时，Node 的退出钩子不会执行，
 * hugo 子进程会变成孤儿 —— 既占着 1313 等端口，又白吃几百 MB 内存，
 * 还会让新预览因为端口被占而不断换端口（表现为「本地预览未启动」）。
 * 只结束后缀包含本仓库路径的 hugo 进程，绝不碰其它项目。
 */
export function cleanupStrayServers() {
  const killed = [];
  const q = String.fromCharCode(39);            // 单引号
  const nl = new RegExp(String.fromCharCode(92) + 'r?' + String.fromCharCode(92) + 'n');
  try {
    if (process.platform === 'win32') {
      const root = SITE_ROOT;
      const ps = 'Get-CimInstance Win32_Process -Filter "Name=' + q + 'hugo.exe' + q + '"'
        + ' | Where-Object { $_.CommandLine -like ' + q + '*' + root + '*' + q + ' }'
        + ' | Select-Object -ExpandProperty ProcessId';
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        encoding: 'utf8', timeout: 20000, windowsHide: true,
      });
      for (const line of String(out).split(nl)) {
        const pid = Number(line.trim());
        if (!Number.isInteger(pid) || pid <= 0) continue;
        if (child && child.pid === pid) continue;
        try {
          execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore', timeout: 10000, windowsHide: true });
          killed.push(pid);
        } catch { /* 已经退出了 */ }
      }
    } else {
      const out = execFileSync('bash', ['-lc', 'pgrep -f "hugo.*server" || true'], { encoding: 'utf8', timeout: 10000 });
      for (const line of String(out).split(nl)) {
        const pid = Number(line.trim());
        if (!Number.isInteger(pid) || pid <= 0 || (child && child.pid === pid)) continue;
        try { process.kill(pid, 'SIGKILL'); killed.push(pid); } catch { /* 已退出 */ }
      }
    }
  } catch { /* 查询失败不影响启动 */ }
  if (killed.length) console.log('  已清理 ' + killed.length + ' 个上次遗留的预览进程：' + killed.join(', '));
  return killed;
}


function writePidFile(pid) {
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(pid), 'utf8');
  } catch { /* 忽略 */ }
}

function clearPidFile() {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch { /* 忽略 */ }
}

let child = null;
let stopping = false;          // 主动停止时不要触发自动重启
let autoRestarts = 0;
let lastAutoRestart = 0;
const MAX_AUTO_RESTARTS = 8;   // 5 分钟内最多自动重启 8 次（改配置后 Hugo 常会 panic 退出，需要拉回）

let state = {
  running: false,
  port: null,
  basePath: '/',
  url: '',
  error: null,
  startedAt: null,
  building: false,
  lastBuildLog: '',
  autoRestarts: 0,
  lastAutoRestartAt: null,
};

export function previewState() {
  return {
    ...state,
    proxyPath: state.basePath,
  };
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function pickPort() {
  for (const p of PORTS) {
    // eslint-disable-next-line no-await-in-loop
    if (await portFree(p)) return p;
  }
  return PORTS[0];
}

export async function startPreview({ force = false } = {}) {
  if (state.running && !force) return previewState();
  stopping = false;
  if (child) await stopPreview();
  stopping = false;
  const port = await pickPort();
  const hugo = findHugo();
  state = { ...state, running: false, error: null, port, basePath: '/', url: '', building: true };
  const args = [
    'server',
    '--disableFastRender',
    '--buildDrafts',
    '--buildFuture',
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--logLevel', 'info',
  ];
  child = spawn(hugo, args, { cwd: SITE_ROOT, windowsHide: true });
  writePidFile(child.pid);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  const onData = (buf) => {
    const text = String(buf);
    state.lastBuildLog = (state.lastBuildLog + text).slice(-4000);
    const m = /Web Server is available at (\S+)/.exec(text);
    if (m) {
      let pathname = '/';
      try {
        const stripped = m[1].replace(/^https?:\/\/[^/]+/, '');
        pathname = stripped || '/';
      } catch { /* ignore */ }
      if (!pathname.endsWith('/')) pathname += '/';
      state = { ...state, running: true, url: m[1], basePath: pathname, building: false, error: null };
    }
    if (/ERROR|Error:/.test(text) && !state.running) {
      state.lastBuildLog = state.lastBuildLog.slice(-2000);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => {
    const wasStopping = stopping;
    clearPidFile();
    state = { ...state, running: false, building: false, error: code === 0 ? null : `hugo server 退出（代码 ${code}）` };
    child = null;
    // 崩溃时把 hugo 的输出打出来，便于定位（以前只显示一句「退出代码 2」）
    if (code !== 0) {
      const tail = (state.lastBuildLog || '').split(/\r?\n/).filter((l) => l.trim()).slice(-12);
      if (tail.length) {
        console.log(`  预览进程退出的最后输出：`);
        for (const l of tail) console.log('    ' + l.slice(0, 160));
      }
    }
    /*
     * 预览进程意外退出时自动拉起：Hugo 在配置变动、构建锁冲突等情况下可能直接退出，
     * 用户不该为此手动点「重启预览」。崩溃循环时最多重试 3 次。
     */
    if (!wasStopping && code !== 0) {
      if (Date.now() - lastAutoRestart > 5 * 60 * 1000) autoRestarts = 0;
      if (autoRestarts < MAX_AUTO_RESTARTS) {
        autoRestarts++;
        lastAutoRestart = Date.now();
        state = { ...state, autoRestarts, lastAutoRestartAt: lastAutoRestart };
        console.log(`  预览进程意外退出（代码 ${code}），正在自动重启（第 ${autoRestarts} 次）…`);
        // 退避：1s、2s、3s…最多 5s，避免崩溃循环时疯狂重启
        const delay = Math.min(1000 * autoRestarts, 5000);
        setTimeout(() => {
          if (!state.running) startPreview({ force: true }).catch(() => {});
        }, delay);
      }
    }
  });
  child.on('error', (err) => {
    state = { ...state, running: false, building: false, error: `无法启动 hugo server：${err.message}` };
    child = null;
  });

  // 等待就绪（最多 60 秒）
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && !state.running && state.error === null) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 300));
  }
  return previewState();
}

/**
 * 配置文件改动后主动重启预览。
 *
 * 背景：Hugo 的 dev server 在「配置变动 → 重建」这条路径上会 panic 退出
 * （Go 层崩溃，命令行构建不受影响）。用户在「站点设置」里改菜单/站点名就会触发，
 * 表现为右侧预览突然打不开。这里主动重启，避免让用户看到崩溃后的空白。
 */
export async function restartPreviewIfRunning() {
  const wasRunning = state.running || !!child;
  if (!wasRunning) return previewState();
  await stopPreview();
  await new Promise((r) => setTimeout(r, 400));
  return startPreview({ force: true });
}

export async function stopPreview() {
  if (!child) return previewState();
  const c = child;
  child = null;
  stopping = true;
  const killedPid = c.pid;
  c.kill();
  // Windows 下 child.kill 有时杀不掉，补一刀
  try {
    if (process.platform === 'win32' && killedPid) {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(killedPid)], { stdio: 'ignore', timeout: 8000, windowsHide: true });
    }
  } catch { /* 已退出 */ }
  clearPidFile();
  state = { ...state, running: false };
  setTimeout(() => { stopping = false; }, 1500);
  return previewState();
}

/* ------------------------------------------------------------------ */
/* 反向代理                                                            */
/* ------------------------------------------------------------------ */

export function proxyToHugo(req, res) {
  if (!state.running || !state.port) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`预览服务未启动${state.error ? `：${state.error}` : ''}`);
    return;
  }
  const options = {
    host: '127.0.0.1',
    port: state.port,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: `127.0.0.1:${state.port}` },
  };
  const upstream = http.request(options, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`预览代理出错：${err.message}（可能 hugo server 还在重建，稍后刷新即可）`);
    } else {
      res.end();
    }
  });
  req.pipe(upstream);
}

/** WebSocket 升级（Hugo livereload） */
export function proxyUpgrade(req, socket, head) {
  if (!state.running || !state.port) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(state.port, '127.0.0.1', () => {
    const headers = Object.entries({ ...req.headers, host: `127.0.0.1:${state.port}` })
      .map(([k, v]) => `${k}: ${v}`).join('\r\n');
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

/* ------------------------------------------------------------------ */
/* 构建校验                                                            */
/* ------------------------------------------------------------------ */

export function buildCheck({ renderToMemory = true } = {}) {
  return new Promise((resolve) => {
    const wasRunning = state.running;
    // --noBuildLock：避免与正在运行的预览服务抢 .hugo_build.lock
    const args = ['--logLevel', 'warn', '--buildDrafts', '--buildFuture', '--noBuildLock'];
    if (renderToMemory) args.push('--renderToMemory');
    const started = Date.now();
    const p = spawn(findHugo(), args, { cwd: SITE_ROOT, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (err) => resolve({ ok: false, output: `无法启动 hugo：${err.message}`, ms: Date.now() - started }));
    p.on('close', (code) => {
      const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
      const errors = lines.filter((l) => /ERROR|error|failed/i.test(l)).slice(0, 12);
      resolve({
        ok: code === 0,
        code,
        ms: Date.now() - started,
        errors,
        output: out.split('\n').slice(-40).join('\n'),
      });
    });
  });
}
