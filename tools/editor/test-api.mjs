/**
 * 端到端 API 测试（对运行中的编辑器服务发请求）
 * 用法： node tools/editor/test-api.mjs [port]
 * 测试完成后会自动把改动还原（git checkout / 删除测试文件），确保仓库不被弄脏。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unifiedDiff } from './lib/diff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.argv[2] ?? 7788);
const BASE = `http://127.0.0.1:${PORT}`;
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

let pass = 0;
let fail = 0;
const results = [];

const strip = (t) => String(t).split(CR + LF).join(LF);
const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const existsIn = (rel) => fs.existsSync(path.join(ROOT, rel));

function snapshot(rel) { return fs.readFileSync(path.join(ROOT, rel)); }
/**
 * 按字节还原文件。
 * marker 是「测试自己写进去的内容特征」：如果当前文件里找不到它，
 * 说明测试期间有别的进程（例如你正在用的编辑器）改过这个文件，
 * 此时跳过还原，避免把用户的改动覆盖掉。
 */
function restore(snap, rel, marker = null) {
  const target = path.join(ROOT, rel);
  const cur = fs.readFileSync(target);
  if (cur.equals(snap)) return true;
  if (marker && !cur.toString('utf8').includes(marker)) {
    console.log(`  [跳过还原] ${rel} 在测试期间被外部修改，保留当前内容以免覆盖你的编辑`);
    return false;
  }
  fs.writeFileSync(target, snap);
  return true;
}

function check(name, ok, detail = '') {
  if (ok) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`); }
}

async function api(p, { method = 'GET', body, raw, filename } = {}) {
  const headers = {};
  if (method !== 'GET') headers['x-editor'] = '1';
  if (filename) headers['x-filename'] = encodeURIComponent(filename);
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data };
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** 真实的增删行数（而不是按下标逐行比对） */
function diffStat(a, b) {
  const ops = unifiedDiff(a, b, { maxLines: 200000 }).lines;
  return {
    added: ops.filter((o) => o.type === '+').length,
    removed: ops.filter((o) => o.type === '-').length,
  };
}

/** 测试会改动的文件（结束后必须按字节还原） */
const TOUCHED_FILES = [
  'content/people/_index.md',
  'content/_index.md',
  'content/faculty/zhuocheng-hou.md',
  'data/authors/lincanping.yaml',
  'config/_default/params.yaml',
  'config/_default/languages.yaml',
  'config/_default/hugo.yaml',
  'config/_default/menus.yaml',
];

/**
 * 测试开始前把所有会被改到的文件原样留一份到 .editor/test-snapshots/。
 * 另外：本测试只按字节还原文件，绝不使用 git checkout —— 那会把用户尚未提交的编辑一起丢掉。
 */
function safetySnapshot() {
  const dir = path.join(ROOT, '.editor', 'test-snapshots', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const rel of TOUCHED_FILES) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  return path.relative(ROOT, dir).split(path.sep).join('/');
}

async function main() {
  console.log(`\n对 http://127.0.0.1:${PORT} 运行端到端测试\n`);
  const snapDir = safetySnapshot();
  console.log(`测试前的文件快照：${snapDir}（出错时可按此找回）`);
  const uncommitted = git(['status', '--porcelain', '--', 'content', 'data', 'config']).split(LF).filter(Boolean);
  if (uncommitted.length) {
    console.log('注意：以下文件有未提交改动，测试结束后会按字节还原：');
    for (const l of uncommitted) console.log('  ' + l);
  }

  /* ---------- 1. 成员名单：改动 → 保存 → 校验 → 还原 ---------- */
  {
    const rel = 'content/people/_index.md';
    const snap = snapshot(rel);
    const before = readFile(rel);
    const people = (await api('/api/people')).data;
    check('读取成员名单', Array.isArray(people.groups) && people.groups.length > 0, `groups=${people.groups?.length}`);

    const groups = structuredClone(people.groups);
    const master = groups.find((g) => /master/i.test(g.category)) ?? groups[groups.length - 1];
    master.members.push({ name: 'Test Student', slug: 'test-student', title: 'M.S. Student', email: '', photo: '', bio: '' });

    const dry = await api('/api/people', { method: 'POST', body: { pi: people.pi, groups, dryRun: true } });
    check('成员改动 dry-run 返回 diff', dry.status === 200 && dry.data.diff?.changed > 0, JSON.stringify(dry.data).slice(0, 200));
    check('dry-run 不写盘', readFile(rel) === before);

    const saved = await api('/api/people', { method: 'POST', body: { pi: people.pi, groups } });
    check('成员改动写入成功', saved.status === 200 && saved.data.changed === true, JSON.stringify(saved.data).slice(0, 200));

    const after = readFile(rel);
    const d = diffStat(before, after);
    check('diff 最小化：只新增该成员的 6 行、不重写其它内容', d.added === 6 && d.removed === 0, JSON.stringify(d));
    check('新成员已写入', after.includes('Test Student'));
    check('原有成员仍在', after.includes('Canping Lin') && after.includes('Yin Zhongtao'));
    check('行尾保持 CRLF', after.includes(CR + LF));

    restore(snap, rel, 'Test Student');
    check('已还原文件', readFile(rel) === before);
  }

  /* ---------- 2. 导师主页：论文插入 → 语义与 diff 校验 ---------- */
  {
    const rel = 'content/faculty/zhuocheng-hou.md';
    const snap = snapshot(rel);
    const before = readFile(rel);
    const doc = (await api(`/api/faculty/doc?path=${encodeURIComponent(rel)}`)).data;
    check('读取导师主页', doc.sections?.length === 4, `sections=${doc.sections?.length}`);

    const sections = doc.sections.map((s) => ({ title: s.title, items: structuredClone(s.items) }));
    sections[1].items.unshift('Test et al. 2026. A brand new paper. TEST JOURNAL.');
    const saved = await api('/api/faculty/save', { method: 'POST', body: { path: rel, sections } });
    check('导师主页保存成功', saved.status === 200 && saved.data.changed, JSON.stringify(saved.data).slice(0, 200));

    const after = readFile(rel);
    check('新论文已插入', after.includes('A brand new paper'));
    const dd = diffStat(before, after);
    check('diff 最小化：插入 1 篇论文只新增 1 行', dd.added === 1 && dd.removed === 0, JSON.stringify(dd));
    const reread = (await api(`/api/faculty/doc?path=${encodeURIComponent(rel)}`)).data;
    check('论文条目数 +1（语义校验）', reread.sections[1].items.length === doc.sections[1].items.length + 1,
      `${doc.sections[1].items.length} -> ${reread.sections[1].items.length}`);
    check('原有论文逐条内容不变', doc.sections[1].items.every((t, k) => reread.sections[1].items[k + 1] === t));
    check('其它分区（软著/获奖）内容不变', JSON.stringify(doc.sections[2].items) === JSON.stringify(reread.sections[2].items));
    check('个人简介未被改写', /bio: >-/.test(after));
    restore(snap, rel);
    check('已还原导师页', readFile(rel) === before);
  }

  /* ---------- 3. 页面文字：首页标题与简介 ---------- */
  {
    const rel = 'content/_index.md';
    const snap = snapshot(rel);
    const before = readFile(rel);
    const doc = (await api(`/api/pages/doc?path=${encodeURIComponent(rel)}`)).data;
    check('读取首页', doc.isHome === true && doc.blocks.length > 0);
    check('首页快速字段已解析', typeof doc.home?.heading === 'string' && doc.home.heading.length > 0, JSON.stringify(doc.home));

    const saved = await api('/api/pages/save', {
      method: 'POST',
      body: {
        path: rel,
        title: doc.title,
        quick: { heading: 'Poultry Breeding Innovation Team', intro: 'Test intro sentence.' },
        blocks: doc.blocks.filter((b) => b.hasText || b.isMarkdown)
          .map((b) => ({ index: b.index, text: b.text, title: b.hasTitle ? b.title : undefined })),
      },
    });
    check('首页保存成功', saved.status === 200 && saved.data.changed, JSON.stringify(saved.data).slice(0, 300));
    const after = readFile(rel);
    check('首页大标题已替换', after.includes('Poultry Breeding Innovation Team'));
    check('首页简介已替换', after.includes('Test intro sentence.'));
    check('图片标签仍在', after.includes('lab-photo.jpg'));
    restore(snap, rel);
    check('已还原首页', readFile(rel) === before);
  }

  /* ---------- 4. 站点设置 ---------- */
  {
    // 只处理实际存在的配置文件（单语言站点没有 menus.zh.yaml）
    const files = ['params.yaml', 'languages.yaml', 'hugo.yaml', 'menus.yaml', 'menus.zh.yaml']
      .map((f) => `config/_default/${f}`)
      .filter((f) => existsIn(f));
    const snaps = Object.fromEntries(files.map((f) => [f, snapshot(f)]));
    const before = Object.fromEntries(files.map((f) => [f, readFile(f)]));
    // 用 try/finally 保证：即使中间某步报错，也会把配置文件还原回去
    try {
    const st = (await api('/api/settings')).data;
    check('读取设置', typeof st.brand?.name === 'string' && st.brand.name.length > 0, JSON.stringify(st.brand));
    check('读取英文菜单', Array.isArray(st.menus.en) && st.menus.en.length >= 5, `en=${st.menus.en?.length}`);
    const hasZh = (st.languages?.available ?? []).includes('zh');
    check('读取中文菜单', !hasZh || (Array.isArray(st.menus.zh) && st.menus.zh.length >= 5), `zh=${st.menus.zh?.length}`);

    const dry = await api('/api/settings', { method: 'POST', body: { brand: { name: 'Test Lab Name' }, dryRun: true } });
    check('设置 dry-run 返回 diff', dry.status === 200 && dry.data.changed === true, JSON.stringify(dry.data).slice(0, 200));
    check('设置 dry-run 不写盘', readFile('config/_default/params.yaml') === before['config/_default/params.yaml']);

    // 界面上改「站点名称」时会同时同步三个文件（与 UI 发送的字段一致）
    const saved = await api('/api/settings', {
      method: 'POST',
      body: { brand: { name: 'Test Lab Name' }, site: { siteTitle: 'Test Lab Name' } },
    });
    check('设置保存成功', saved.status === 200 && saved.data.changed, JSON.stringify(saved.data).slice(0, 200));
    const afterParams = readFile('config/_default/params.yaml');
    check('params.yaml 已更新站点名', afterParams.includes('name: Test Lab Name'));
    const pd = diffStat(before['config/_default/params.yaml'], afterParams);
    check('params.yaml 只改了 1 行', pd.added === 1 && pd.removed === 1, JSON.stringify(pd));
    check('菜单文件未被无谓改写', readFile('config/_default/menus.yaml') === before['config/_default/menus.yaml']);
    // 站点名会同步到 hugo.yaml / params.yaml / languages.yaml 三处，所以 languages.yaml 只应改 title 一行
    const langDiff = diffStat(before['config/_default/languages.yaml'], readFile('config/_default/languages.yaml'));
    check('languages.yaml 只同步改了 1 行', langDiff.added === 1 && langDiff.removed === 1, JSON.stringify(langDiff));
    check('hugo.yaml 只同步改了 1 行', (() => {
      const h = diffStat(before['config/_default/hugo.yaml'], readFile('config/_default/hugo.yaml'));
      return h.added === 1 && h.removed === 1;
    })());


    // 记录菜单操作之前的 languages.yaml（前面改站点名时它已被合法修改过）
    const langBeforeMenu = readFile('config/_default/languages.yaml');
    const menusEn = structuredClone(st.menus.en);
    menusEn.push(menusEn.shift());
    const mSaved = await api('/api/settings', { method: 'POST', body: { menus: { en: menusEn } } });
    check('英文菜单调整保存成功', mSaved.status === 200 && mSaved.data.changed, JSON.stringify(mSaved.data).slice(0, 200));
    const menusAfter = strip(readFile('config/_default/menus.yaml'));
    check('menus.yaml 首项已变为 Research', /main:[\s\S]*?name: '?Research'?/.test(menusAfter), menusAfter.split('main:')[1]?.slice(0, 90));
    // 保存菜单不应再改 languages.yaml（旧实现会把菜单同时写进这里，导致配置两处不一致）
    check('languages.yaml 未被菜单操作改动',
      readFile('config/_default/languages.yaml') === langBeforeMenu);

    if (hasZh) {
      const menusZh = structuredClone(st.menus.zh);
      menusZh.push(menusZh.shift());
      const zSaved = await api('/api/settings', { method: 'POST', body: { menus: { zh: menusZh } } });
      check('中文菜单调整保存成功', zSaved.status === 200 && zSaved.data.changed, JSON.stringify(zSaved.data).slice(0, 200));
      const zhMenuAfter = strip(readFile('config/_default/menus.zh.yaml'));
      check('menus.zh.yaml 首项已变为 研究方向', /main:[\s\S]*?name: '?研究方向'?/.test(zhMenuAfter), zhMenuAfter.split('main:')[1]?.slice(0, 90));
    } else {
      check('单语言站点：不写多余的 menus.zh.yaml', !existsIn('config/_default/menus.zh.yaml'));
    }

    // menus.yaml 里没有站点名，所以不设标记（无条件还原），其余文件用站点名做标记
    files.forEach((f) => restore(snaps[f], f, null));
    check('已还原配置文件', files.every((f) => readFile(f) === before[f]));
    } finally {
      // 无论上面是否抛错，都必须还原，避免测试值留在配置里
      for (const f of files) if (readFile(f) !== before[f]) restore(snaps[f], f, null);
    }
  }

  /* ---------- 5. 新闻：新建 → 编辑 → 删除 → 回收站恢复 ---------- */
  {
    const created = await api('/api/news/create', {
      method: 'POST',
      body: { title: 'Test News Title', slug: 'zz-test-news', date: '2026-01-01', summary: 'test summary', draft: true, body: 'First paragraph.' },
    });
    check('新建新闻', created.status === 200 && created.data.path === 'content/blog/zz-test-news/index.md', JSON.stringify(created.data));
    const rel = created.data.path;
    if (rel && existsIn(rel)) {
      const doc = (await api(`/api/news/doc?path=${encodeURIComponent(rel)}`)).data;
      check('读取新新闻', doc.title === 'Test News Title' && doc.draft === true, JSON.stringify({ t: doc.title, d: doc.draft }));
      const saved = await api('/api/news/save', {
        method: 'POST',
        body: {
          path: rel, title: 'Test News Title (edited)', date: '2026-01-02', summary: 'edited summary',
          tags: ['test'], draft: false, body: 'Edited body.' + LF + LF + 'Second paragraph.',
        },
      });
      check('保存新闻', saved.status === 200 && saved.data.changed, JSON.stringify(saved.data).slice(0, 200));
      const raw = readFile(rel);
      check('新闻正文已更新', raw.includes('Second paragraph.'));
      check('草稿标记已改为 false', /^draft: false/m.test(raw));
      check('标签已写入', raw.includes('- test'));

      const del = await api('/api/news/delete', { method: 'POST', body: { path: rel } });
      check('删除新闻（进回收站）', del.status === 200 && !existsIn('content/blog/zz-test-news'));
      const trashEntry = (await api('/api/trash')).data.trash.find((t) => t.files.some((f) => f.includes('zz-test-news')));
      check('回收站里有记录', !!trashEntry);
      if (trashEntry) {
        const file = trashEntry.files.find((f) => f.includes('zz-test-news'));
        const rest = await api('/api/trash/restore', { method: 'POST', body: { id: trashEntry.id, path: file } });
        check('从回收站恢复', rest.status === 200 && existsIn(rel));
      }
    }
    fs.rmSync(path.join(ROOT, 'content/blog/zz-test-news'), { recursive: true, force: true });
  }

  /* ---------- 6. 论文：新建 → 保存 → 删除 ---------- */
  {
    const created = await api('/api/publications/create', {
      method: 'POST',
      body: { title: 'Test Paper Title', slug: 'zz-test-paper', date: '2026-03-01', publication: 'Test Journal', authors: ['me'], draft: true },
    });
    check('新建论文', created.status === 200 && created.data.path === 'content/publications/zz-test-paper/index.md', JSON.stringify(created.data));
    const rel = created.data.path;
    if (rel && existsIn(rel)) {
      const doc = (await api(`/api/publications/doc?path=${encodeURIComponent(rel)}`)).data;
      check('读取新论文', doc.title === 'Test Paper Title' && doc.publication === 'Test Journal', JSON.stringify({ t: doc.title, p: doc.publication }));
      const saved = await api('/api/publications/save', {
        method: 'POST',
        body: { path: rel, title: 'Test Paper Title', abstract: 'An abstract.', tags: ['duck'], links: [{ type: 'pdf', url: 'https://example.com/a.pdf' }], featured: true, body: 'Notes.' },
      });
      check('保存论文', saved.status === 200 && saved.data.changed, JSON.stringify(saved.data).slice(0, 200));
      const reread = (await api(`/api/publications/doc?path=${encodeURIComponent(rel)}`)).data;
      check('论文链接已保存', reread.links?.[0]?.url === 'https://example.com/a.pdf', JSON.stringify(reread.links));
      check('论文摘要已保存', reread.abstract === 'An abstract.');
      check('原有期刊字段未被清空', reread.publication === 'Test Journal');
      const del = await api('/api/publications/delete', { method: 'POST', body: { path: rel } });
      check('删除论文（进回收站）', del.status === 200 && !existsIn('content/publications/zz-test-paper'));
    }
    fs.rmSync(path.join(ROOT, 'content/publications/zz-test-paper'), { recursive: true, force: true });
  }

  /* ---------- 7. 图片上传（GitHub 文件名规范化） ---------- */
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await api('/api/media/upload', { method: 'POST', raw: png, filename: 'My Test Photo.PNG' });
    check('上传图片', up.status === 200 && /^static\/uploads\/.+\.png$/.test(up.data.rel ?? ''), JSON.stringify(up.data));
    if (up.data.rel) {
      check('文件名规范化为小写 ASCII', /\/[a-z0-9._-]+$/.test(up.data.rel), up.data.rel);
      check('front matter 路径不含 static/', up.data.frontMatterPath.startsWith('uploads/'), up.data.frontMatterPath);
      const del = await api('/api/media/delete', { method: 'POST', body: { path: up.data.rel } });
      check('删除图片（进回收站）', del.status === 200);
    }
  }

  /* ---------- 7.5 成员个人主页 ---------- */
  {
    const list = (await api('/api/profiles')).data;
    check('读取个人主页列表', list.items.length >= 20, `items=${list.items.length}`);
    // 头像已压缩到 300KB 以内，这里应不再报告「过大」
    check('体积过大的头像已被压缩（列表为空）', Array.isArray(list.oversizedAvatars) && list.oversizedAvatars.length === 0,
      JSON.stringify(list.oversizedAvatars.map((a) => `${a.name} ${(a.size / 1048576).toFixed(1)}MB`)));

    const target = 'lincanping';
    const dataRel = `data/authors/${target}.yaml`;
    const pageRel = `content/authors/${target}/_index.md`;
    const snapData = snapshot(dataRel);
    const snapPage = snapshot(pageRel);
    const before = readFile(dataRel);

    const doc = (await api(`/api/profiles/doc?slug=${target}`)).data;
    check('读取个人资料', doc.profile.display === 'Canping Lin' && doc.profile.links.length === 3,
      JSON.stringify({ d: doc.profile.display, links: doc.profile.links.length }));
    check('识别出资料里的教育经历', doc.profile.education.length === 2, JSON.stringify(doc.profile.education));

    const profile = structuredClone(doc.profile);
    profile.role = 'Ph.D. Candidate';
    profile.interests = [...profile.interests, 'Duck Genomics'];
    profile.links = [...profile.links, { icon: 'globe', url: 'https://example.com/lab', label: 'Website', display: 'example.com' }];

    const dry = await api('/api/profiles/save', { method: 'POST', body: { slug: target, profile, dryRun: true } });
    check('资料 dry-run 返回 diff', dry.status === 200 && dry.data.changed, JSON.stringify(dry.data).slice(0, 160));
    check('资料 dry-run 不写盘', readFile(dataRel) === before);

    const saved = await api('/api/profiles/save', { method: 'POST', body: { slug: target, profile } });
    check('资料保存成功', saved.status === 200 && saved.data.changed, JSON.stringify(saved.data).slice(0, 200));

    const after = readFile(dataRel);
    check('职位已更新', after.includes('Ph.D. Candidate'));
    check('新链接已写入', after.includes('example.com/lab') && after.includes('Website'));
    check('新兴趣已写入', after.includes('Duck Genomics'));
    check('原有链接未丢失', after.includes('LinPenn') && after.includes('orcid.org'));
    const d2 = diffStat(before, after);
    // 只改了 role（1 行替换）+ 新增 1 条兴趣 + 新增 1 条链接（4 行），其余 3 条链接原文照旧
    check('diff 最小化：只动改动过的字段', d2.removed === 1 && d2.added <= 8, JSON.stringify(d2));

    const reread = (await api(`/api/profiles/doc?slug=${target}`)).data;
    check('读回与写入一致', JSON.stringify(reread.profile.links) === JSON.stringify(profile.links.filter((l) => l.url)),
      JSON.stringify(reread.profile.links).slice(0, 160));
    check('页面文件未被误改', readFile(pageRel) === snapPage.toString('utf8'));

    restore(snapData, dataRel, 'Ph.D. Candidate');
    check('已还原个人资料', readFile(dataRel) === before);
  }

  /* ---------- 7.55 个人主页 · 自定义模块（布局可调） ---------- */
  {
    const target = 'lincanping';
    const dataRel = `data/authors/${target}.yaml`;
    const snap = snapshot(dataRel);
    const basePath = (await api('/api/state')).data.site.basePath;

    const doc = (await api(`/api/profiles/doc?slug=${target}`)).data;
    const profile = structuredClone(doc.profile);
    profile.sections = [
      {
        title: '我开发的工具',
        layout: 'cards',
        text: '实验室自研工具。',
        columns: 2,
        items: [
          { title: 'GLinformer', subtitle: '基因组育种值估计系统', meta: '2025', url: 'https://example.com/glinformer', tags: ['Python', 'Web'] },
          { title: 'DuckFat', text: '鸭肉脂肪含量快速测定' },
          { title: '', url: '' },                       // 空条目：应被清洗掉
        ],
      },
      { title: '专利', layout: 'timeline', items: [{ title: '一种鸭皮脂性状活体预测方法', subtitle: 'CN201911077412.4', meta: '2019' }] },
      { title: '已发表论文', layout: 'publications' },
      { title: '折叠说明', layout: 'markdown', collapse: true, text: '这里默认折叠。' },
      { title: '未知布局测试', layout: '不存在的布局', text: '应回退为列表布局' },
    ];

    const saved = await api('/api/profiles/save', { method: 'POST', body: { slug: target, profile } });
    check('保存自定义模块', saved.status === 200 && saved.data.changed, JSON.stringify(saved.data).slice(0, 200));

    const reread = (await api(`/api/profiles/doc?slug=${target}`)).data;
    const secs = reread.profile.sections;
    check('自定义模块数量正确', secs.length === 5, `sections=${secs.length}`);
    check('卡片模块与条目正确', secs[0].layout === 'cards' && secs[0].columns === 2 && secs[0].items.length === 2,
      JSON.stringify(secs[0]).slice(0, 200));
    check('空条目被清洗掉', secs[0].items.every((it) => it.title || it.url), JSON.stringify(secs[0].items));
    check('时间线模块保留时间和副标题', secs[1].items[0].meta === '2019' && secs[1].items[0].subtitle === 'CN201911077412.4');
    check('未知布局回退为 list', secs[4].layout === 'list', secs[4].layout);
    check('折叠标记已保存', secs[3].collapse === true);
    check('标签数组已保存', JSON.stringify(secs[0].items[0].tags) === JSON.stringify(['Python', 'Web']));
    check('模块顺序被保留', secs.map((x) => x.title).join('|') === '我开发的工具|专利|已发表论文|折叠说明|未知布局测试',
      secs.map((x) => x.title).join('|'));

    // 真正渲染验证：等 hugo 重建后抓个人主页 HTML
    let html = '';
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${BASE}${basePath}authors/${target}/?t=${Date.now()}`);
      html = await res.text();
      if (html.includes('我开发的工具')) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    check('页面里渲染出了自定义模块标题', html.includes('我开发的工具'), html.slice(0, 0) + `htmlLen=${html.length}`);
    check('卡片布局渲染出工具条目', html.includes('GLinformer') && html.includes('DuckFat'));
    check('卡片列数生效（2 列）', html.includes('md:grid-cols-2'));
    check('时间线布局渲染出专利', html.includes('CN201911077412.4') && html.includes('relative border-l'));
    check('标签渲染为徽标', html.includes('Python') && html.includes('Web'));
    check('折叠模块用 details 渲染', html.includes('<details>'));
    check('自动列出论文模块给出提示', html.includes('没有找到该作者的论文条目'));
    check('模块出现在基本信息下方', html.indexOf('Research Interests') < html.indexOf('我开发的工具'));

    restore(snap, dataRel, '我开发的工具');
    check('已还原个人资料（自定义模块测试）', readFile(dataRel) === snap.toString('utf8'));
  }

  /* ---------- 7.6 新建 / 头像 / 删除 个人主页 ---------- */
  {
    const slug = 'zz-test-profile';
    const created = await api('/api/profiles/create', {
      method: 'POST',
      body: { slug, display: 'Test Person', role: 'M.S. Student', bio: '测试用', addToGroup: null },
    });
    check('新建个人主页', created.status === 200 && created.data.dataPath === `data/authors/${slug}.yaml`, JSON.stringify(created.data));
    const dataRel = `data/authors/${slug}.yaml`;
    const pageRel = `content/authors/${slug}/_index.md`;
    check('资料文件已创建', existsIn(dataRel));
    check('页面文件已创建', existsIn(pageRel));
    check('页面标题已写入', readFile(pageRel).includes('Test Person'));

    const doc = (await api(`/api/profiles/doc?slug=${slug}`)).data;
    check('新资料字段齐全', doc.profile.display === 'Test Person' && doc.profile.role === 'M.S. Student'
      && Array.isArray(doc.profile.links) && doc.hasData === true, JSON.stringify(doc.profile));

    const saved = await api('/api/profiles/save', {
      method: 'POST',
      body: {
        slug,
        pageTitle: 'Test Person',
        profile: {
          ...doc.profile,
          bio: '编辑后的简介',
          statusIcon: '🎓',
          interests: ['测试兴趣'],
          affiliations: [{ name: '中国农业大学', url: '' }],
          education: [{ degree: 'M.S.', institution: 'CAU', year: '2026 -' }],
        },
      },
    });
    check('编辑新资料', saved.status === 200 && saved.data.changed, JSON.stringify(saved.data).slice(0, 200));
    const raw = readFile(dataRel);
    check('简介/状态/兴趣已写入', raw.includes('编辑后的简介') && raw.includes('🎓') && raw.includes('测试兴趣'));
    check('单位与教育已写入', raw.includes('中国农业大学') && raw.includes('M.S.'));

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await api(`/api/profiles/avatar?slug=${slug}`, { method: 'POST', raw: png, filename: 'avatar.png' });
    check('上传头像', up.status === 200 && up.data.avatar?.rel === `assets/media/authors/${slug}.png`, JSON.stringify(up.data));
    check('头像文件已落地', existsIn(`assets/media/authors/${slug}.png`));

    const avDoc = (await api(`/api/profiles/doc?slug=${slug}`)).data;
    check('资料里能看到头像', avDoc.avatar?.rel === `assets/media/authors/${slug}.png`);

    const rm = await api(`/api/profiles/avatar?slug=${slug}&remove=1`, { method: 'POST', raw: new Blob([]), filename: 'x.png' });
    check('移除头像', rm.status === 200 && !existsIn(`assets/media/authors/${slug}.png`));

    const del = await api('/api/profiles/delete', {
      method: 'POST',
      body: { slug, removeData: true, removePage: true, removeAvatar: false },
    });
    check('删除个人主页（进回收站）', del.status === 200 && !existsIn(dataRel) && !existsIn(pageRel), JSON.stringify(del.data));
    check('回收站里有记录', (await api('/api/trash')).data.trash.some((tk) => tk.files.some((f) => f.includes(slug))));
  }

  /* ---------- 7.7 成员名单联动：自动补齐个人主页 ---------- */
  {
    const peopleRel = 'content/people/_index.md';
    const snapPeople = snapshot(peopleRel);
    const slug = 'zz-test-member';
    const people = (await api('/api/people')).data;
    const groups = structuredClone(people.groups);
    const master = groups.find((g) => /master/i.test(g.category)) ?? groups[groups.length - 1];
    master.members.push({ name: 'Test Member', slug, title: 'M.S. Student', email: '', photo: '', bio: '' });

    const res = await api('/api/people', {
      method: 'POST',
      body: { pi: people.pi, groups, createAuthorPages: [slug] },
    });
    check('保存成员并自动补齐个人主页', res.status === 200 && res.data.createdProfiles?.created?.includes(slug),
      JSON.stringify(res.data.createdProfiles));
    check('自动创建了资料文件', existsIn(`data/authors/${slug}.yaml`));
    check('自动创建了页面文件', existsIn(`content/authors/${slug}/_index.md`));
    const auto = readFile(`data/authors/${slug}.yaml`);
    check('自动填充了姓名与职位', auto.includes('Test Member') && auto.includes('M.S. Student'));

    fs.rmSync(path.join(ROOT, `content/authors/${slug}`), { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, `data/authors/${slug}.yaml`), { force: true });
    restore(snapPeople, peopleRel);
    check('已还原成员名单', readFile(peopleRel) === snapPeople.toString('utf8'));
  }

  /* ---------- 8. 安全：路径与鉴权 ---------- */
  {
    const bad = await api('/api/raw?path=' + encodeURIComponent('../../../Windows/win.ini'));
    check('拒绝越界路径', bad.status === 400 && /不允许|超出/.test(bad.data.error ?? ''), JSON.stringify(bad.data));
    const bad2 = await api('/api/raw', { method: 'POST', body: { path: 'package.json', text: 'x' } });
    check('拒绝写非白名单文件', bad2.status === 400 && /不允许/.test(bad2.data.error ?? ''), JSON.stringify(bad2.data));
    const noHeader = await fetch(BASE + '/api/people', { method: 'POST', body: '{}' });
    check('无编辑器标识头时拒绝写入', noHeader.status === 403, String(noHeader.status));
    const broken = ['---', 'pi:', '  name: x', '   bad: indent', '---', ''].join(LF);
    const badYaml = await api('/api/raw', { method: 'POST', body: { path: 'content/people/_index.md', text: broken } });
    check('拒绝写入 front matter 坏掉的文件', badYaml.status === 400 && /解析失败/.test(badYaml.data.error ?? ''), JSON.stringify(badYaml.data).slice(0, 160));
    check('被拒绝后文件未损坏', readFile('content/people/_index.md').includes('Canping Lin'));
  }

  /* ---------- 9. 备份 ---------- */
  {
    const b = (await api('/api/backups')).data.backups;
    check('存在自动备份记录', Array.isArray(b) && b.length > 0, `backups=${b?.length}`);
    if (b?.length) {
      check('备份中能看到改过的文件', b.some((x) => x.files.includes('content/people/_index.md')), JSON.stringify(b[0]?.files));
    }
  }

  /* ---------- 10. 构建校验 ---------- */
  {
    const res = await api('/api/check', { method: 'POST' });
    check('Hugo 构建校验通过', res.status === 200 && res.data.ok === true, JSON.stringify(res.data).slice(0, 300));
  }

  /* ---------- 11. Git / GitHub 集成 ---------- */
  {
    const st = (await api('/api/git/status')).data;
    check('读取 git 状态', st.isRepo === true && st.branch === 'main', JSON.stringify({ b: st.branch }));
    check('Actions 链接正确', st.actionsUrl === 'https://github.com/LinPenn/academic-cv/actions', st.actionsUrl);
    check('Pages 链接正确', st.pagesUrl === 'https://linpenn.github.io/academic-cv/', st.pagesUrl);
    check('提交者身份已配置', st.identityReady === true);
  }

  console.log(results.join(LF));
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项\n`);
  const dirty = git(['status', '--porcelain', '-uall']).split(LF)
    .filter((l) => l && /(content|config|static)\//.test(l));
  if (dirty.length) {
    console.log('⚠ 测试后仍有未还原的内容文件：');
    console.log(dirty.join(LF));
  } else {
    console.log('✓ 仓库内容文件已全部还原（仅剩新增的 tools/ 与 .gitignore 改动）');
  }
  process.exitCode = fail ? 1 : 0;
}

main().catch((err) => { console.error(err); process.exit(1); });
