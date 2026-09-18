/**
 * 实验室网站可视化编辑器 · 本地服务
 * ------------------------------------------------------------------
 * 只监听 127.0.0.1，仅在本机使用；所有写操作都经过校验与备份。
 *
 * 启动： node tools/editor/server.mjs [--port 7788] [--no-preview]
 */

import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as site from './lib/site.mjs';
import * as profiles from './lib/profiles.mjs';
import * as layout from './lib/layout.mjs';
import * as store from './lib/store.mjs';
import * as git from './lib/git.mjs';
import * as hugo from './lib/hugo.mjs';
import { parseFile } from './lib/frontmatter.mjs';
import { unifiedDiff } from './lib/diff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');

const argv = process.argv.slice(2);
function argValue(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const PORT = Number(argValue('--port', process.env.EDITOR_PORT || 7788));
const HOST = '127.0.0.1';
const NO_PREVIEW = argv.includes('--no-preview');
const AUTO_OPEN = argv.includes('--open');

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function sendError(res, err, status = 400) {
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error(err);
  sendJson(res, { error: message }, status);
}

function readBody(req, limit = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error(`请求体过大（>${Math.round(limit / 1048576)}MB）`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

const routes = {
  // 供启动脚本探测「编辑器是否已在运行」，避免重复开实例
  'GET /api/ping': () => ({ app: 'lab-site-editor', port: server.__port ?? PORT, pid: process.pid }),

  'GET /api/state': async () => {
    const info = site.getSiteInfo();
    const g = git.status();
    const pv = hugo.previewState();
    const hv = await hugo.hugoVersion();
    return {
      site: info,
      preview: pv,
      hugo: hv,
      git: {
        branch: g.branch, clean: g.clean, files: g.files?.length ?? 0,
        ahead: g.ahead, behind: g.behind, pagesUrl: g.pagesUrl, actionsUrl: g.actionsUrl,
        identityReady: g.identityReady,
      },
      editorDir: path.relative(store.SITE_ROOT, store.EDITOR_DIR).replace(/\\/g, '/'),
      platform: process.platform,
    };
  },

  'GET /api/people': () => site.loadPeople(),
  'POST /api/people': async (req) => {
    const body = await readJson(req);
    const res = site.savePeople(body);
    // 勾选「自动创建缺失的个人主页」时，同时补齐 data/authors 资料与 content/authors 页面
    if (body.createAuthorPages?.length && !body.dryRun) {
      res.createdProfiles = profiles.ensureProfiles(body.createAuthorPages, body.groups);
    }
    return res;
  },

  /* ---------------- 成员个人主页 ---------------- */
  'GET /api/profiles': () => ({
    ...profiles.listProfiles(),
    oversizedAvatars: profiles.listOversizedAvatars(),
    layouts: profiles.SECTION_LAYOUTS,   // 自定义模块支持的布局，界面直接用它渲染下拉框
  }),
  'GET /api/profiles/doc': (req, res, url) => profiles.loadProfile(url.searchParams.get('slug')),
  'POST /api/profiles/save': async (req) => profiles.saveProfile(await readJson(req)),
  'POST /api/profiles/create': async (req) => profiles.createProfile(await readJson(req)),
  'POST /api/profiles/delete': async (req) => profiles.deleteProfile(await readJson(req)),
  'POST /api/profiles/avatar': async (req, res, url) => {
    const slug = url.searchParams.get('slug');
    if (url.searchParams.get('remove') === '1') return profiles.setProfileAvatar({ slug, remove: true });
    const filename = decodeURIComponent(req.headers['x-filename'] ?? 'avatar.jpg');
    const buf = await readBody(req);
    return profiles.setProfileAvatar({ slug, filename, buffer: buf });
  },

  'GET /api/faculty': () => ({ files: site.listFaculty() }),
  'GET /api/faculty/doc': (req, res, url) => site.loadFaculty(url.searchParams.get('path')),
  'POST /api/faculty/save': async (req) => site.saveFaculty(await readJson(req)),
  'POST /api/faculty/import': async (req) => {
    const { path: rel, sectionIndex, text, position = 'top' } = await readJson(req);
    const doc = site.loadFaculty(rel);
    const items = site.splitItems(text);
    if (!items.length) throw new Error('没有解析到任何条目');
    const sections = doc.sections.map((s) => ({ title: s.title, items: s.items }));
    const target = sections[sectionIndex];
    if (!target) throw new Error('目标分区不存在');
    target.items = position === 'top' ? [...items, ...target.items] : [...target.items, ...items];
    const res = site.saveFaculty({ path: rel, sections });
    return { ...res, imported: items.length };
  },

  'GET /api/layout': () => layout.loadLayout(),
  'POST /api/layout/save': async (req) => layout.saveLayout(await readJson(req)),

  'GET /api/pages': () => ({ pages: site.listPages() }),
  'GET /api/pages/doc': (req, res, url) => site.loadPage(url.searchParams.get('path')),
  'POST /api/pages/save': async (req) => site.savePage(await readJson(req)),

  'GET /api/news': () => ({ posts: site.listNews() }),
  'GET /api/news/doc': (req, res, url) => site.loadNews(url.searchParams.get('path')),
  'POST /api/news/save': async (req) => site.saveNews(await readJson(req)),
  'POST /api/news/create': async (req) => site.createNews(await readJson(req)),
  'POST /api/news/delete': async (req) => {
    const { path: rel } = await readJson(req);
    const dir = path.dirname(rel).replace(/\\/g, '/');
    const res = site.deleteContent(dir, '删除新闻');
    return { ...res, removed: dir };
  },
  'POST /api/news/cover': async (req, res, url) => {
    const rel = url.searchParams.get('path');
    if (url.searchParams.get('remove') === '1') return site.setPostCover({ path: rel, remove: true });
    const filename = decodeURIComponent(req.headers['x-filename'] ?? 'cover.jpg');
    const buf = await readBody(req);
    return site.setPostCover({ path: rel, filename, buffer: buf });
  },

  'GET /api/publications': () => ({ items: site.listPublications() }),
  'GET /api/publications/doc': (req, res, url) => site.loadPublication(url.searchParams.get('path')),
  'POST /api/publications/save': async (req) => site.savePublication(await readJson(req)),
  'POST /api/publications/create': async (req) => site.createPublication(await readJson(req)),
  'POST /api/publications/delete': async (req) => {
    const { path: rel } = await readJson(req);
    const dir = path.dirname(rel).replace(/\\/g, '/');
    return { ...site.deleteContent(dir, '删除论文'), removed: dir };
  },
  'POST /api/publications/cover': async (req, res, url) => {
    const rel = url.searchParams.get('path');
    if (url.searchParams.get('remove') === '1') return site.setPostCover({ path: rel, remove: true });
    const filename = decodeURIComponent(req.headers['x-filename'] ?? 'featured.jpg');
    const buf = await readBody(req);
    return site.setPostCover({ path: rel, filename, buffer: buf });
  },

  'GET /api/files': () => ({
    files: [
      ...store.listFiles('content', { recursive: true, filter: (p) => /\.(md|ya?ml|toml|json|bib|txt|csv)$/i.test(p) }),
      ...store.listFiles('config', { recursive: true, filter: (p) => /\.(ya?ml|toml|json)$/i.test(p) }),
    ].map((f) => ({ path: f.rel, size: f.size })).sort((a, b) => a.path.localeCompare(b.path)),
  }),

  'GET /api/media': () => site.listMedia(),
  'POST /api/media/upload': async (req, res, url) => {
    const filename = decodeURIComponent(req.headers['x-filename'] ?? '');
    if (!filename) throw new Error('缺少文件名');
    const subdir = url.searchParams.get('subdir') ?? '';
    const overwrite = url.searchParams.get('overwrite') === '1';
    const buf = await readBody(req);
    return store.saveUpload({ filename, buffer: buf, subdir, overwrite });
  },
  'POST /api/media/delete': async (req) => {
    const { path: rel } = await readJson(req);
    return store.trashPath(rel, '删除图片');
  },

  'GET /api/settings': () => site.loadSettings(),
  'POST /api/settings': async (req) => {
    const body = await readJson(req);
    const res = site.saveSettings(body);
    // 配置改动会让 Hugo 在重建时崩溃退出，这里主动重启预览
    if (res.changed && !body.dryRun) await hugo.restartPreviewIfRunning();
    return res;
  },

  'GET /api/raw': (req, res, url) => {
    const rel = url.searchParams.get('path');
    const { text, rel: r } = store.readText(rel);
    return { path: r, text };
  },
  'POST /api/raw': async (req) => {
    const { path: rel, text, dryRun } = await readJson(req);
    const { text: old } = store.readText(rel);
    const diff = unifiedDiff(old, text);
    if (old === text) return { changed: false, diff };
    if (dryRun) return { changed: true, diff, dryRun: true };
    // 原文编辑同样做一次「能否解析」校验，避免留下坏文件
    if (/\.(md|ya?ml)$/i.test(rel)) {
      const doc = parseFile(text, { plain: /\.ya?ml$/i.test(rel) });
      if (doc.hasFrontMatter && doc.parseError) {
        throw new Error(`保存被拒绝：front matter 解析失败 —— ${doc.parseError}`);
      }
    }
    store.ensureEditorDirs();
    const { backupId } = store.writeText(rel, text);
    return { changed: true, diff, backupId };
  },

  'GET /api/backups': () => {
    const dir = store.BACKUP_DIR;
    if (!fs.existsSync(dir)) return { backups: [] };
    const backups = fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort().reverse().slice(0, 40).map((id) => {
      const files = [];
      const walk = (d) => {
        for (const name of fs.readdirSync(d)) {
          const p = path.join(d, name);
          if (fs.statSync(p).isDirectory()) walk(p);
          else files.push(store.toRel(p).replace(/^\.editor\/backups\/[^/]+\//, ''));
        }
      };
      walk(path.join(dir, id));
      return { id, files, at: fs.statSync(path.join(dir, id)).mtimeMs };
    });
    return { backups };
  },
  'POST /api/restore': async (req) => {
    const { id, path: rel } = await readJson(req);
    const src = path.join(store.BACKUP_DIR, id, rel);
    if (!fs.existsSync(src)) throw new Error(`备份中找不到该文件：${rel}`);
    const { text } = { text: fs.readFileSync(src, 'utf8') };
    store.backupFile(rel);
    store.writeText(rel, text, { backup: false });
    return { rel, restored: true, from: id };
  },
  'GET /api/trash': () => ({ trash: store.listTrash() }),
  'POST /api/trash/restore': async (req) => {
    const { id, path: rel } = await readJson(req);
    return store.restoreTrash(id, rel);
  },

  'POST /api/check': async () => hugo.buildCheck(),

  'GET /api/git/status': () => git.status(),
  'POST /api/git/commit': async (req) => {
    const { message, all } = await readJson(req);
    return git.commit(message, { all });
  },
  'POST /api/git/push': () => git.push(),
  'POST /api/git/pull': () => git.pull(),
  'GET /api/git/diff': () => ({ diff: git.diffStat() }),

  'GET /api/preview': () => hugo.previewState(),
  'POST /api/preview/start': () => hugo.startPreview({ force: true }),
  'POST /api/preview/stop': () => hugo.stopPreview(),
};

/* ------------------------------------------------------------------ */
/* 服务器                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  // 同源保护：拒绝来自其它站点的请求（防 CSRF / DNS rebinding）
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try {
      const o = new URL(origin);
      ok = (o.hostname === '127.0.0.1' || o.hostname === 'localhost' || o.hostname === '[::1]') && Number(o.port || 80) === PORT;
    } catch { ok = false; }
    if (!ok) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('拒绝跨站请求');
      return;
    }
  }

  try {
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(302, { location: '/admin/' });
      res.end();
      return;
    }
    if (pathname.startsWith('/admin')) {
      const rel = pathname.replace(/^\/admin\/?/, '') || 'index.html';
      const target = path.join(PUBLIC_DIR, rel);
      if (!path.relative(PUBLIC_DIR, target).startsWith('..')) {
        serveStatic(res, target);
        return;
      }
    }
    if (pathname.startsWith('/api/')) {
      const key = `${req.method} ${pathname}`;
      const handler = routes[key];
      if (!handler) {
        sendJson(res, { error: `未知接口：${key}` }, 404);
        return;
      }
      if (req.method === 'POST' && req.headers['x-editor'] !== '1') {
        sendJson(res, { error: '缺少编辑器标识头（x-editor），已拒绝写入' }, 403);
        return;
      }
      const data = await handler(req, res, url);
      sendJson(res, data ?? { ok: true });
      return;
    }
    // 其余请求全部转给 hugo server（站点预览）
    hugo.proxyToHugo(req, res);
  } catch (err) {
    sendError(res, err, err?.name === 'GitError' || err?.name === 'SaveError' || err?.name === 'PathError' ? 400 : 400);
  }
});

server.on('upgrade', (req, socket, head) => {
  hugo.proxyUpgrade(req, socket, head);
});

// 端口被占用时自动往后试，避免用户只看到一句 EADDRINUSE
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const next = Number(server.__port ?? PORT) + 1;
    if (next > PORT + 20) {
      console.error(`\n  端口 ${PORT} 起的 20 个端口都被占用，请用 --port 指定其它端口。\n`);
      process.exit(1);
    }
    console.warn(`  端口 ${server.__port ?? PORT} 已被占用，改用 ${next} …`);
    server.__port = next;
    setTimeout(() => server.listen(next, HOST), 50);
    return;
  }
  console.error(err);
});

/** 用系统默认浏览器打开（端口可能因为占用而后移，所以由服务端来开） */
function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* 打不开就算了，用户可以手动访问 */ }
}

server.__port = PORT;
server.listen(PORT, HOST, async () => {
  const port = server.__port;
  const info = site.getSiteInfo();
  console.log('');
  console.log('  实验室网站编辑器已启动');
  console.log(`  打开：http://${HOST}:${port}/admin/`);
  if (info.baseURL) console.log(`  站点：${info.title || '(未命名)'}  (${info.baseURL})`);
  console.log('  关闭：在本窗口按 Ctrl+C');
  console.log('');
  if (!NO_PREVIEW) {
    // 先清掉上次异常退出时留下的 hugo 进程（否则端口被占、预览会一直换端口甚至起不来）
    hugo.cleanupStrayServers();
    console.log('  正在启动预览服务（hugo server），首次启动约 10 秒…');
    const st = await hugo.startPreview();
    if (st.running) console.log(`  预览就绪：http://${HOST}:${port}${st.basePath}`);
    else console.log(`  预览未启动：${st.error ?? '未知原因'}（可在页面里点「重启预览」）`);
    console.log('');
  }
  if (AUTO_OPEN) openBrowser(`http://${HOST}:${port}/admin/`);
});

function shutdown() {
  console.log('\n正在关闭…');
  hugo.stopPreview().finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
