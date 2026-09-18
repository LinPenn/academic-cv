"""
压缩首页大图（以及体积过大的成员头像）

用法：
  python tools/editor/compress-images.py            # 试运行，只报告
  python tools/editor/compress-images.py --write    # 实际写入

策略：
  · 首页大图：生成 1920px 与 960px 两个宽度，各出 JPEG（兜底）与 WebP（首选），
    页面用 <picture> + srcset，手机只下载小图；
  · 头像：显示尺寸只有 160px（高分屏 320px），压到 800px 足够；
  · 原始文件移到 .editor/originals/（已 gitignore，不会进仓库），可随时还原。
"""

import os
import shutil
import struct
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WRITE = '--write' in sys.argv
ORIGINALS = os.path.join(ROOT, '.editor', 'originals')


def jpeg_size(path):
    with open(path, 'rb') as f:
        d = f.read()
    i = 2
    while i < len(d):
        if d[i] != 0xFF:
            i += 1
            continue
        m = d[i + 1]
        if m in (0xC0, 0xC1, 0xC2, 0xC3):
            h, w = struct.unpack('>HH', d[i + 5:i + 9])
            return w, h
        if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        if i + 4 > len(d):
            break
        ln = struct.unpack('>H', d[i + 2:i + 4])[0]
        i += 2 + ln
    return None


def human(n):
    return f'{n / 1048576:.2f} MB' if n >= 1048576 else f'{n / 1024:.0f} KB'


def backup(rel):
    """把原始文件备份到 .editor/originals/（不进仓库）"""
    src = os.path.join(ROOT, rel)
    dst = os.path.join(ORIGINALS, rel)
    if os.path.exists(dst):
        return False
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    return True


def load_clean(path):
    """打开图片并去掉 EXIF 方向以外的一切元数据（省体积）"""
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)   # 按 EXIF 方向摆正
    if im.mode not in ('RGB', 'L'):
        im = im.convert('RGB')
    return im


def resize_to(im, width):
    if im.width <= width:
        return im
    h = round(im.height * width / im.width)
    return im.resize((width, h), Image.Resampling.LANCZOS)


def save_jpeg(im, path, quality=82):
    im.save(path, 'JPEG', quality=quality, optimize=True, progressive=True, subsampling='4:2:0')


def save_webp(im, path, quality=80):
    im.save(path, 'WEBP', quality=quality, method=6)


def process_home_photo():
    rel = 'static/uploads/lab-photo.jpg'
    # 幂等保护：已经压过的不要再压一次（避免二次压缩损失画质）
    if os.path.exists(os.path.join(ORIGINALS, rel)):
        print('首页大图：已压缩过，跳过')
        return
    src = os.path.join(ROOT, rel)
    if not os.path.exists(src):
        print(f'! 找不到 {rel}')
        return
    before = os.path.getsize(src)
    size = jpeg_size(src)
    print(f'\n首页大图 {rel}')
    print(f'  当前：{human(before)}  {size[0]}x{size[1]}' if size else f'  当前：{human(before)}')

    im = load_clean(src)
    out_dir = os.path.dirname(src)
    # 重要：必须在写入之前备份，否则备份到的就是压缩后的文件
    if WRITE and backup(rel):
        print(f'  原始文件已备份到 .editor/originals/{rel}')
    plans = [
        (1920, 'lab-photo.jpg', save_jpeg, 86),
        (960, 'lab-photo-960.jpg', save_jpeg, 85),
        (1920, 'lab-photo.webp', save_webp, 85),
        (960, 'lab-photo-960.webp', save_webp, 85),
    ]
    total = 0
    for width, name, fn, q in plans:
        out = os.path.join(out_dir, name)
        r = resize_to(im, width)
        if WRITE:
            fn(r, out, q)
        est = '（试运行）'
        if WRITE:
            total += os.path.getsize(out)
            est = human(os.path.getsize(out))
        print(f'  → {name:24s} {r.width}x{r.height}  {est}')
    if WRITE:
        print(f'  合计：{human(total)}（原来 {human(before)}，浏览器实际只下载其中一个）')


def process_avatar(rel, max_width=800):
    src = os.path.join(ROOT, rel)
    if not os.path.exists(src):
        return
    before = os.path.getsize(src)
    if before < 300 * 1024:
        print(f'\n头像 {rel}：{human(before)}，无需压缩')
        return
    ext = os.path.splitext(rel)[1].lower()
    print(f'\n头像 {rel}')
    print(f'  当前：{human(before)}')
    im = load_clean(src)
    r = resize_to(im, max_width)
    if WRITE:
        if backup(rel):
            print(f'  原始文件已备份到 .editor/originals/{rel}')
        if ext in ('.jpg', '.jpeg'):
            save_jpeg(r, src, 85)
        elif ext == '.png':
            r.save(src, 'PNG', optimize=True)
        elif ext == '.webp':
            save_webp(r, src, 85)
        print(f'  → {r.width}x{r.height}  {human(os.path.getsize(src))}')


def has_alpha(im):
    if im.mode in ('RGBA', 'LA'):
        lo, _ = im.getchannel('A').getextrema()
        return lo < 250
    return False


def process_member_photos():
    """static/uploads/people/：成员列表页与导师页用的照片"""
    d = os.path.join(ROOT, 'static/uploads/people')
    if not os.path.isdir(d):
        return
    for name in sorted(os.listdir(d)):
        rel = f'static/uploads/people/{name}'
        src = os.path.join(ROOT, rel)
        if not os.path.isfile(src):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext not in ('.jpg', '.jpeg', '.png', '.webp'):
            continue
        if os.path.exists(os.path.join(ORIGINALS, rel)):
            continue
        before = os.path.getsize(src)
        im = Image.open(src)
        # 只要偏大或尺寸超标就处理（成员列表里只显示约 240px 宽）
        if before < 120 * 1024 and im.width <= 1000:
            continue
        print(f'\n成员照片 {rel}')
        print(f'  当前：{human(before)}  {im.width}x{im.height}')
        if has_alpha(im):
            # 抠图人像：必须保留透明通道，转 WebP；引用处需要把 .png 改成 .webp
            out_rel = os.path.splitext(rel)[0] + '.webp'
            out = os.path.join(ROOT, out_rel)
            print('  检测到透明通道（抠图人像）→ 转 WebP 以保留去背效果')
            if WRITE:
                if backup(rel):
                    print(f'  原始文件已备份到 .editor/originals/{rel}')
                save_webp(im.convert('RGBA'), out, 88)
                print(f'  → {out_rel}  {human(os.path.getsize(out))}')
                print(f'  [注意] 需要把引用处的 {name} 改成 {os.path.basename(out_rel)}')
            else:
                print(f'  → 将生成 {out_rel}（试运行）')
        else:
            r = resize_to(im.convert('RGB'), 800)
            if WRITE:
                if backup(rel):
                    print(f'  原始文件已备份到 .editor/originals/{rel}')
                if ext in ('.png',):
                    r.save(src, 'PNG', optimize=True)
                elif ext == '.webp':
                    save_webp(r, src, 85)
                else:
                    save_jpeg(r, src, 85)
                print(f'  → {r.width}x{r.height}  {human(os.path.getsize(src))}')
            else:
                print(f'  → 将缩放到 {r.width}x{r.height} 并重新编码（试运行）')


def main():
    if WRITE:
        os.makedirs(ORIGINALS, exist_ok=True)
    process_home_photo()
    # 头像目录整体处理（文件名必须保持 <slug>.<后缀>，主题靠它匹配）
    adir = os.path.join(ROOT, 'assets/media/authors')
    if os.path.isdir(adir):
        for name in sorted(os.listdir(adir)):
            if os.path.splitext(name)[1].lower() in ('.jpg', '.jpeg', '.png', '.webp'):
                process_avatar(f'assets/media/authors/{name}')
    process_member_photos()
    print('')
    if not WRITE:
        print('这是试运行。确认后加 --write 参数实际写入。\n')


if __name__ == '__main__':
    main()
