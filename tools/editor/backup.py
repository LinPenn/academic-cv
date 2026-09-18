"""
项目备份
==================================================
把项目打包成带时间戳的 zip（默认放到项目上一级目录）。

包含：源代码、内容、配置、.git 历史、.editor/originals（图片原图，未进仓库，丢了就没了）
排除：node_modules、public、resources、.pnpm-store（可再生）、.bin（3 份 hugo.exe 共 187MB，可从 hugo 官网重下）、
      .editor/backups、.editor/test-snapshots、.editor/extract（临时产物）

用法：
  python tools/editor/backup.py                 # 备份到 上一级目录
  python tools/editor/backup.py D:/backups      # 指定目录
"""
import os
import sys
import time
import zipfile

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXCLUDE_DIRS = {'node_modules', 'public', 'resources', '.pnpm-store', '.bin'}
EXCLUDE_PREFIXES = (
    os.path.join('.editor', 'backups'),
    os.path.join('.editor', 'test-snapshots'),
    os.path.join('.editor', 'extract'),
    '.git/lfs',
)


def main():
    dest_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(ROOT)
    os.makedirs(dest_dir, exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M')
    name = f'{os.path.basename(ROOT)}-backup-{stamp}.zip'
    dest = os.path.join(dest_dir, name)

    kept = 0
    skipped = 0
    total_bytes = 0
    t0 = time.time()
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            rel = os.path.relpath(dirpath, ROOT)
            if rel == '.':
                rel = ''
            # 目录级排除：只排除「项目根目录下」的同名目录，
            # 否则会误伤 tools/editor/public（编辑器界面）、content/resources（资源页）等
            if rel == '':
                dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            else:
                dirnames[:] = [d for d in dirnames if d != '.git']
            parts = rel.replace('\\', '/')
            if any(parts == p.replace('\\', '/') or parts.startswith(p.replace('\\', '/') + '/')
                   for p in EXCLUDE_PREFIXES):
                skipped += 1
                continue
            for fn in filenames:
                src = os.path.join(dirpath, fn)
                arc = os.path.join(rel, fn) if rel else fn
                try:
                    z.write(src, arc)
                    kept += 1
                    total_bytes += os.path.getsize(src)
                except ValueError:
                    # 少数文件的修改时间早于 1980（zip 格式下限），用固定时间写入
                    try:
                        zi = zipfile.ZipInfo(arc, date_time=(1980, 1, 1, 0, 0, 0))
                        zi.compress_type = zipfile.ZIP_DEFLATED
                        with open(src, 'rb') as f:
                            z.writestr(zi, f.read())
                        kept += 1
                        total_bytes += os.path.getsize(src)
                    except OSError:
                        skipped += 1
                except (OSError, PermissionError):
                    skipped += 1

    size = os.path.getsize(dest)
    print(f'备份完成：{dest}')
    print(f'  文件数：{kept}（跳过 {skipped}）')
    print(f'  原始大小：{total_bytes / 1048576:.1f} MB  压缩后：{size / 1048576:.1f} MB')
    print(f'  耗时：{time.time() - t0:.1f} 秒')
    print('')
    print('  含：源代码 / 内容 / 配置 / .git 历史 / .editor/originals（图片原图）')
    print('  不含：node_modules、public、resources（可用 pnpm install 与 hugo 重建）')
    print('')
    print('  还原方式：解压后，在项目目录执行  pnpm install  即可恢复可运行状态。')


if __name__ == '__main__':
    main()
