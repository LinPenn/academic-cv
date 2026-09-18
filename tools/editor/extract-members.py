"""
从成员的 .docx / .pdf 材料里提取纯文本，输出到 .editor/extract/*.txt 便于分析。

用法： python tools/editor/extract-members.py "C:/Users/penn0/Desktop/实验室"
"""
import os
import re
import subprocess
import sys
import zipfile

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, '.editor', 'extract')


def docx_text(path):
    """从 docx 的 document.xml 里取出文字（保留段落与换行）"""
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n == 'word/document.xml']
        if not names:
            return ''
        xml = z.read('word/document.xml').decode('utf-8', 'replace')
    # 表格单元格 / 段落 / 换行 → 占位符
    xml = xml.replace('</w:tc>', '\t')
    xml = xml.replace('</w:tr>', '\n')
    xml = re.sub(r'<w:br[^>]*/>', '\n', xml)
    xml = xml.replace('</w:p>', '\n')
    xml = re.sub(r'<w:tab[^>]*/>', '\t', xml)
    # 去掉所有标签
    text = re.sub(r'<[^>]+>', '', xml)
    # 反转义
    for a, b in (('&lt;', '<'), ('&gt;', '>'), ('&amp;', '&'), ('&quot;', '"'), ('&apos;', "'")):
        text = text.replace(a, b)
    # 压缩多余空行
    lines = [ln.rstrip() for ln in text.split('\n')]
    out = []
    for ln in lines:
        if ln.strip() == '' and (not out or out[-1].strip() == ''):
            continue
        out.append(ln)
    return '\n'.join(out).strip()


def pdf_text(path):
    try:
        r = subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', path, '-'],
                           capture_output=True, timeout=60)
        return r.stdout.decode('utf-8', 'replace').strip()
    except Exception as e:
        return f'(PDF 解析失败: {e})'


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'C:/Users/penn0/Desktop/实验室'
    os.makedirs(OUT, exist_ok=True)
    files = sorted(os.listdir(src))
    print(f'源目录：{src}')
    print(f'输出目录：{os.path.relpath(OUT, ROOT)}')
    print('')
    total = 0
    for name in files:
        path = os.path.join(src, name)
        if not os.path.isfile(path):
            continue
        ext = os.path.splitext(name)[1].lower()
        base = os.path.splitext(name)[0]
        if ext == '.docx':
            text = docx_text(path)
        elif ext == '.pdf':
            text = pdf_text(path)
        elif ext in ('.txt', '.md'):
            with open(path, encoding='utf-8', errors='replace') as f:
                text = f.read()
        else:
            print(f'  - 跳过 {name}（不支持的格式）')
            continue
        dst = os.path.join(OUT, base + '.txt')
        with open(dst, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
        total += 1
        print(f'  ✓ {name:20s} → {len(text):6d} 字   行数 {text.count(chr(10)) + 1}')
    print(f'\n共提取 {total} 份材料')


if __name__ == '__main__':
    main()
