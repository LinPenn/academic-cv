/**
 * Git / GitHub 集成
 * ------------------------------------------------------------------
 * 站点通过 .github/workflows/deploy.yml 部署：推送到 main 分支 →
 * GitHub Actions 构建 → GitHub Pages 发布。所以编辑器里的「发布」
 * 就是一次 git 提交 + 推送。
 */

import { execFileSync } from 'node:child_process';
import { SITE_ROOT } from './store.mjs';
import { getSiteInfo } from './site.mjs';

const TIMEOUT = 180000;

export class GitError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'GitError';
    this.detail = detail;
  }
}

function git(args, { allowFail = false } = {}) {
  try {
    const stdout = execFileSync('git', args, {
      cwd: SITE_ROOT,
      encoding: 'utf8',
      timeout: TIMEOUT,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { ok: true, stdout: stdout.trim(), stderr: '', code: 0 };
  } catch (err) {
    const out = {
      ok: false,
      stdout: String(err.stdout ?? '').trim(),
      stderr: String(err.stderr ?? '').trim(),
      code: err.status ?? -1,
      message: err.message,
    };
    if (!allowFail) {
      const detail = out.stderr || out.stdout || err.message;
      throw new GitError(`git ${args.join(' ')} 失败：${detail.split('\n').slice(0, 6).join('\n')}`, out);
    }
    return out;
  }
}

export function isRepo() {
  return git(['rev-parse', '--is-inside-work-tree'], { allowFail: true }).ok;
}

function parseRemote(url) {
  if (!url) return null;
  const m = /github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/i.exec(url.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2], web: `https://github.com/${m[1]}/${m[2]}` };
}

export function status() {
  if (!isRepo()) {
    return { isRepo: false, message: '当前目录不是 git 仓库' };
  }
  const porcelain = git(['status', '--porcelain=v1', '-uall', '--branch'], { allowFail: true }).stdout;
  const lines = porcelain.split('\n').filter(Boolean);
  const branchLine = lines.find((l) => l.startsWith('##')) ?? '';
  const files = lines.filter((l) => !l.startsWith('##')).map((l) => ({
    code: l.slice(0, 2).trim(),
    path: l.slice(3).replace(/^"(.*)"$/, '$1'),
  }));
  const branch = branchLine.replace(/^##\s*/, '').split('...')[0].split(' ')[0];
  const upstream = /\.\.\.(\S+)/.exec(branchLine)?.[1] ?? '';
  const ahead = Number(/ahead (\d+)/.exec(branchLine)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(branchLine)?.[1] ?? 0);
  const remoteUrl = git(['remote', 'get-url', 'origin'], { allowFail: true }).stdout;
  const gh = parseRemote(remoteUrl);
  const site = getSiteInfo();
  const log = git(['log', '-6', '--pretty=format:%h|%ad|%an|%s', '--date=format:%Y-%m-%d %H:%M'], { allowFail: true })
    .stdout.split('\n').filter(Boolean).map((l) => {
      const [hash, date, author, subject] = l.split('|');
      return { hash, date, author, subject };
    });
  const identity = {
    name: git(['config', '--get', 'user.name'], { allowFail: true }).stdout,
    email: git(['config', '--get', 'user.email'], { allowFail: true }).stdout,
  };
  return {
    isRepo: true,
    branch,
    upstream,
    ahead,
    behind,
    files,
    clean: files.length === 0,
    remoteUrl,
    github: gh,
    actionsUrl: gh ? `${gh.web}/actions` : '',
    pagesUrl: site.baseURL,
    repoWeb: gh?.web ?? '',
    log,
    identity,
    identityReady: Boolean(identity.name && identity.email),
  };
}

/** 只提交内容相关目录，避免把编辑器临时文件带进去 */
const CONTENT_PATHS = ['content', 'config', 'static/uploads', 'assets/media'];

export function commit(message, { paths = CONTENT_PATHS, all = false } = {}) {
  const st = status();
  if (!st.isRepo) throw new GitError('当前目录不是 git 仓库');
  if (st.clean) return { ok: true, changed: false, message: '没有需要提交的改动' };
  if (!st.identityReady) {
    throw new GitError(
      'Git 还没有配置提交者身份。请先在命令行执行：\n'
      + '  git config --global user.name "你的名字"\n'
      + '  git config --global user.email "你的邮箱"',
    );
  }
  const targets = all ? ['.'] : paths.filter((p) => st.files.some((f) => f.path === p || f.path.startsWith(p + '/')));
  if (!targets.length && !all) {
    const other = st.files.map((f) => f.path).join('、');
    throw new GitError(`没有检测到内容文件的改动（当前改动：${other || '无'}）。如需提交全部改动，请勾选「提交所有改动」。`);
  }
  git(['add', '--', ...targets]);
  const res = git(['commit', '-m', message || 'content: 更新站点内容'], { allowFail: true });
  if (!res.ok) {
    if (/nothing to commit/i.test(res.stdout + res.stderr)) {
      return { ok: true, changed: false, message: '没有需要提交的改动' };
    }
    throw new GitError(`提交失败：${(res.stderr || res.stdout || '').split('\n').slice(0, 6).join('\n')}`);
  }
  const after = status();
  return {
    ok: true,
    changed: true,
    message: (res.stdout.split('\n')[0] ?? '').trim() || '已提交',
    ahead: after.ahead,
    files: targets,
  };
}

export function push() {
  const st = status();
  if (!st.isRepo) throw new GitError('当前目录不是 git 仓库');
  if (!st.upstream) throw new GitError(`分支 ${st.branch} 没有设置上游分支，无法推送。请先执行：git push -u origin ${st.branch}`);
  if (st.behind > 0) {
    throw new GitError(
      `远端有 ${st.behind} 个新提交，直接推送会被拒绝。请先点击「拉取远端更新」，` +
      '如果有冲突需要手动解决。',
    );
  }
  if (st.ahead === 0) return { ok: true, pushed: false, message: '没有需要推送的提交' };
  const res = git(['push', 'origin', st.branch], { allowFail: true });
  if (!res.ok) {
    const detail = (res.stderr || res.stdout || '').split('\n').filter(Boolean).slice(0, 8).join('\n');
    throw new GitError(
      `推送失败：\n${detail}\n\n`
      + '常见原因：\n'
      + '· 网络无法访问 github.com（可稍后重试，或使用代理）\n'
      + '· 尚未登录 GitHub（首次推送会弹出凭据窗口，登录一次即可）\n'
      + '· 远端有新提交，需要先拉取',
    );
  }
  return { ok: true, pushed: true, message: `已推送到 origin/${st.branch}`, actionsUrl: st.actionsUrl };
}

export function pull() {
  const st = status();
  if (!st.isRepo) throw new GitError('当前目录不是 git 仓库');
  if (!st.upstream) throw new GitError('当前分支没有设置上游分支，无法拉取');
  const res = git(['pull', '--rebase', '--no-edit'], { allowFail: true });
  if (!res.ok) {
    const detail = (res.stderr || res.stdout || '').split('\n').filter(Boolean).slice(0, 8).join('\n');
    throw new GitError(
      `拉取失败：\n${detail}\n\n如果有冲突，需要在命令行手动解决；也可以先提交本地改动再重试。`,
    );
  }
  return { ok: true, message: res.stdout || '已是最新', status: status() };
}

export function diffStat() {
  const res = git(['diff', '--stat', 'HEAD'], { allowFail: true });
  return res.stdout;
}
