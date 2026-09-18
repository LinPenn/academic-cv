#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把导师页面（content/faculty/zhuocheng-hou.md）里的 Publications 清单
导入成 publications 板块的独立条目（content/publications/<slug>/index.md）。

清单格式约定（Academic 风格的一行式引用）：
    Authors. Title. JOURNAL. 2026 2026/4/30;17(1):79.

用法：
    python tools/editor/import-publications.py --dry-run     # 只打印解析结果
    python tools/editor/import-publications.py --write       # 真正写文件
    python tools/editor/import-publications.py --write --prune   # 同时删掉模板示例条目
"""

import argparse
import os
import re
import shutil
import sys
import unicodedata

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FACULTY = os.path.join(ROOT, 'content', 'faculty', 'zhuocheng-hou.md')
PUBDIR = os.path.join(ROOT, 'content', 'publications')
DEMO_DIRS = ['journal-article', 'conference-paper', 'preprint']

# 一行式引用里，年份及之后的部分（可能带日期、卷期、页码）
TAIL_RE = re.compile(
    r'(?P<year>(?:19|20)\d{2})'
    r'(?:\s+(?P<date>(?:19|20)\d{2}/\d{1,2}/\d{1,2}))?'
    r'(?:[;:]\s*(?P<rest>[^.;]*))?'
    r'\.?$'
)


def read_text(path):
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        return f.read()


def detect_eol(text):
    return '\r\n' if '\r\n' in text else '\n'


def extract_items(text):
    m = re.search(r'-\s*title:\s*"Publications"(.*?)(?=\n  - title:|\n---)', text, re.S)
    if not m:
        raise SystemExit('没有找到导师页面里的 Publications 清单')
    return [s.strip().strip('"') for s in re.findall(r'\n      - (.*)', m.group(1))]


def parse_citation(raw):
    """把一行引用拆成 authors / title / journal / 年份 / 卷期页。"""
    s = re.sub(r'\s+', ' ', raw).strip().rstrip('.')
    m = TAIL_RE.search(s)
    if not m:
        return {'raw': raw, 'ok': False, 'why': '没有解析出年份'}
    head = s[:m.start()].rstrip(' .;:')
    tail_year = m.group('year')
    tail_date = m.group('date')
    tail_rest = (m.group('rest') or '').strip()

    parts = [p.strip() for p in re.split(r'\.\s+', head) if p.strip()]
    if len(parts) < 2:
        return {'raw': raw, 'ok': False, 'why': '缺少“作者. 标题.”结构'}
    authors = parts[0]
    journal = parts[-1]
    title = '. '.join(parts[1:-1]) if len(parts) > 2 else ''
    if not title:
        return {'raw': raw, 'ok': False, 'why': '标题为空（可能刊名里带句点）'}

    volume = issue = pages = ''
    vm = re.match(r'^(\d+)\s*(?:\((\d+|[^)]*)\))?\s*:\s*(.+)$', tail_rest)
    if vm:
        volume, issue, pages = vm.group(1), (vm.group(2) or ''), vm.group(3)
    elif tail_rest:
        pages = tail_rest

    if tail_date:
        y, mo, dy = tail_date.split('/')
        date = f'{y}-{int(mo):02d}-{int(dy):02d}'
    else:
        date = f'{tail_year}-01-01'
    return {
        'raw': raw, 'ok': True, 'authors': authors, 'title': title,
        'journal': journal, 'year': tail_year, 'date': date,
        'volume': volume, 'issue': issue, 'pages': pages,
    }


def slugify(title, year, used):
    s = unicodedata.normalize('NFKD', title)
    s = s.replace('∼', '~').replace('–', '-').replace('—', '-')
    s = re.sub(r'[^A-Za-z0-9]+', '-', s).strip('-').lower()
    words, out = s.split('-'), []
    for w in words:                      # 截断到 60 字符左右
        if len('-'.join(out + [w])) > 60:
            break
        out.append(w)
    slug = '-'.join(out) or 'publication'
    base, n = slug, 2
    while slug in used:
        slug = f'{base}-{n}'
        n += 1
    used.add(slug)
    return slug


def yaml_str(v):
    return '"' + str(v).replace('\\', '\\\\').replace('"', '\\"') + '"'


def build_entry(p):
    pub = f"*{p['journal']}*"
    detail = []
    if p['volume']:
        detail.append(p['volume'] + (f"({p['issue']})" if p['issue'] else ''))
    if p['pages']:
        detail.append(p['pages'])
    if detail:
        pub += ', ' + ', '.join(detail)
    authors = [a.strip() for a in p['authors'].split(',') if a.strip()]
    lines = ['---', f'title: {yaml_str(p["title"])}', 'authors:']
    lines += [f'- {yaml_str(a)}' for a in authors]
    lines += [
        f'date: {yaml_str(p["date"] + "T00:00:00Z")}',
        'publication_types: ["article-journal"]',
        f'publication: {yaml_str(pub)}',
        'publication_short: ""',
        'abstract: ""',
        'summary: ""',
        'tags: []',
        'featured: false',
        'links: []',
        'projects: []',
        'slides: ""',
        '---',
        '',
        '<!-- 由 tools/editor/import-publications.py 从导师页面的论文清单自动生成 -->',
        '',
    ]
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--prune', action='store_true', help='删除模板自带示例条目')
    args = ap.parse_args()
    write = args.write and not args.dry_run

    src = read_text(FACULTY)
    eol = detect_eol(src)
    items = extract_items(src)
    print(f'清单条数: {len(items)}')

    used, parsed, failed = set(), [], []
    for raw in items:
        p = parse_citation(raw)
        if p['ok']:
            p['slug'] = slugify(p['title'], p['year'], used)
            parsed.append(p)
        else:
            failed.append(p)

    print(f'解析成功: {len(parsed)}  失败: {len(failed)}')
    for f in failed:
        print('  [失败]', f['why'], '->', f['raw'][:110])

    if parsed:
        print('\n样例（前 3 条）:')
        for p in parsed[:3]:
            print(f"  slug: {p['slug']}")
            print(f"    作者: {p['authors']}")
            print(f"    标题: {p['title']}")
            print(f"    出处: {p['journal']} {p['year']} {p['volume']}({p['issue']}) {p['pages']}  日期 {p['date']}")

    years = sorted({p['year'] for p in parsed}, reverse=True)
    print(f"\n年份范围: {years[-1]} – {years[0]}，共 {len(years)} 个年份")

    if not write:
        print('\n（dry-run，未写任何文件；加 --write 真正生成）')
        return

    if args.prune:
        for d in DEMO_DIRS:
            path = os.path.join(PUBDIR, d)
            if os.path.isdir(path):
                shutil.rmtree(path)
                print('已删除模板示例:', f'content/publications/{d}')

    for p in parsed:
        d = os.path.join(PUBDIR, p['slug'])
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'index.md'), 'w', encoding='utf-8', newline=eol) as f:
            f.write(build_entry(p))
    print(f'已生成 {len(parsed)} 个条目到 content/publications/')


if __name__ == '__main__':
    main()
