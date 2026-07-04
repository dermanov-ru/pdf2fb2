# -*- coding: utf-8 -*-
"""Pre-conversion diagnostics: is this PDF convertible, and how to configure it."""
import re
import subprocess
from collections import Counter

import images as im


def _run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout


def page_count(pdf):
    for line in _run(["pdfinfo", pdf]).splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":")[1])
    return None


def text_stats(pdf):
    """Total extracted chars and chars/page — low values hint at a scanned PDF."""
    txt = _run(["pdftotext", pdf, "-"])
    pages = page_count(pdf) or 1
    return len(txt), len(txt) / pages


def find_toc(pdf, max_pages=15):
    """Locate a table of contents and return its lines (heading + entries)."""
    txt = _run(["pdftotext", "-layout", "-f", "1", "-l", str(max_pages), pdf, "-"])
    lines = txt.split("\n")
    for i, l in enumerate(lines):
        if re.match(r"^\s*(Оглавление|Содержание|Contents)\b", l.strip(), re.I):
            block = []
            for l2 in lines[i:i + 60]:
                if l2.strip():
                    block.append(l2.strip())
                elif len(block) > 3:
                    break
            return block
    return []


def report(pdf):
    lines = []
    n = page_count(pdf)
    total, per = text_stats(pdf)
    lines.append(f"Страниц: {n}")
    lines.append(f"Текстовый слой: {total} символов  (~{per:.0f}/стр)")
    if per < 200:
        lines.append("  ⚠ мало текста на страницу — вероятно СКАН. Нужен OCR (вне этого инструмента).")
    else:
        lines.append("  ✓ полноценный текстовый слой — конвертация будет чистой.")

    imgs = im.list_images(pdf)
    lines.append(f"\nИзображений: {len(imgs)}")
    if imgs:
        modes = Counter(c for _, _, c in imgs)
        lines.append("  цветовые модели: " + ", ".join(f"{k}×{v}" for k, v in modes.items()))
        if "cmyk" in modes:
            lines.append("  ⚠ есть CMYK — при вшивке ставь images.cmyk_invert: auto (иначе негативы).")
        lines.append("  распределение по страницам (index → page):")
        preview = "  " + "  ".join(f"{i}:стр{p}" for i, p, _ in imgs[:12])
        lines.append(preview + (" …" if len(imgs) > 12 else ""))

    toc = find_toc(pdf)
    if toc:
        lines.append("\nНайдено оглавление (заготовка для chapters в конфиге):")
        for t in toc:
            lines.append("  " + t)
    else:
        lines.append("\nОглавление не найдено автоматически — задай chapters вручную.")
    return "\n".join(lines)


def calibrate(pdf, sample_pages):
    """Suggest para_min/para_max by histogramming leading-space indents."""
    hist = Counter()
    for pnum in sample_pages:
        txt = _run(["pdftotext", "-layout", "-f", str(pnum), "-l", str(pnum), pdf, "-"])
        for line in txt.split("\n"):
            if line.strip():
                ind = len(line) - len(line.lstrip(" "))
                if 1 <= ind <= 10:
                    hist[ind] += 1
    if not hist:
        return None, "не удалось измерить отступы (пустые страницы?)"
    red = hist.most_common(1)[0][0]           # dominant small indent = red line
    lo, hi = max(1, red - 1), red + 1
    dist = "  ".join(f"{k}пробелов×{v}" for k, v in sorted(hist.items()))
    return (lo, hi), f"гистограмма отступов: {dist}\nкрасная строка ≈ {red} => para_min={lo}, para_max={hi}"
