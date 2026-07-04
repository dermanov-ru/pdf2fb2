# -*- coding: utf-8 -*-
"""Paragraph reconstruction from `pdftotext -layout` output.

The core insight: professionally typeset PDFs (InDesign / TeX) encode paragraph
structure via *indentation*, which `pdftotext -layout` preserves. From that we can
rebuild real paragraphs instead of the hard-wrapped line soup that a naive
extraction gives.

Heuristics implemented here (general to Russian/European typeset books):
  * red-line indent (a few leading spaces) => new paragraph;
  * a line at column 0 (or deeply indented, e.g. under a drop cap) => continuation;
  * a trailing "-" => soft word-wrap hyphen, glue the halves (keeping real
    compound hyphens like "во-первых" via a small whitelist);
  * a lone capital letter followed by lowercase on the same line => drop cap;
  * a standalone 1-3 digit line => page number, drop it;
  * page breaks and blank lines do NOT end a paragraph — only the next
    red-line indent does (so paragraphs survive page boundaries);
  * "hanging" mode (bibliographies): flush-left line starts an entry,
    indented lines continue it — the inverse of body text.
"""
import re
import subprocess

# Words that, following a line-ending hyphen, mark a REAL compound hyphen
# (во-первых, что-то, по-русски…) rather than a soft word-wrap hyphen to remove.
KEEP_HYPHEN_NEXT = re.compile(
    r'^(перв|втор|трет|четверт|пят|шест|седьм|восьм|девят|десят'
    r'|нибудь|либо|то|таки|как|русск|абхазск|прежнему|новому|моему|твоему'
    r'|своему|нашему|вашему|разному|другому|всякому|человечески|осеннему'
    r'|зимнему|летнему|весеннему|доброму|хорошему|прошлому|видимому)',
    re.IGNORECASE)

DROPCAP = re.compile(r'^([А-ЯЁA-Z])\s{2,}(\S.*)$')
PAGENUM = re.compile(r'^\s*\d{1,3}\s*$')


def layout_pages(pdf, first, last):
    """Return the pages [first..last] as a list of strings (split on form feed)."""
    out = subprocess.run(
        ["pdftotext", "-layout", "-f", str(first), "-l", str(last), pdf, "-"],
        capture_output=True, text=True, check=True).stdout
    return out.split("\f")


def indent_of(line):
    return len(line) - len(line.lstrip(" "))


def norm(s):
    """Normalise a heading for matching: uppercase, dots->spaces, collapse spaces."""
    s = s.upper().replace(".", " ")
    return re.sub(r"\s+", " ", s).strip()


def join_hyphen(buf, frag):
    """Append continuation `frag` to paragraph buffer `buf`, handling hyphenation."""
    frag = frag.strip()
    if not frag:
        return buf
    if buf.endswith("-") and not buf.endswith("--"):
        first_word = frag.split(" ", 1)[0]
        if KEEP_HYPHEN_NEXT.match(first_word):
            return buf + frag                 # keep real compound hyphen
        return buf[:-1] + frag                # drop soft word-wrap hyphen
    if not buf:
        return frag
    return buf + " " + frag


def build_paragraphs(pages, drop_heading_norm=None, hanging=False,
                     para_min=2, para_max=6):
    """Rebuild paragraphs from a list of `-layout` page strings.

    drop_heading_norm : norm()-ed chapter title to swallow at the very start
                        (so the heading text doesn't leak into the body).
    hanging           : bibliography mode (flush-left = new entry).
    para_min/para_max : leading-space range that marks a red-line indent.
    """
    paras, buf = [], ""
    heading_done = drop_heading_norm is None
    acc = ""

    def flush():
        nonlocal buf
        if buf.strip():
            paras.append(buf.strip())
        buf = ""

    for page in pages:
        for line in page.split("\n"):
            raw = line.rstrip()
            stripped = raw.strip()

            # swallow the chapter heading printed at the top of the first page
            if not heading_done:
                if not stripped:
                    continue
                cand = (acc + " " + norm(stripped)).strip()
                if drop_heading_norm.startswith(cand):
                    acc = cand
                    if cand == drop_heading_norm:
                        heading_done = True
                    continue
                heading_done = True  # mismatch -> heading already over, process line

            # blanks & page numbers never break a paragraph
            if not stripped or PAGENUM.match(raw):
                continue

            ind = indent_of(raw)

            if hanging:
                if ind <= 1:
                    flush(); buf = stripped
                else:
                    buf = join_hyphen(buf, stripped)
                continue

            probe = raw.lstrip(" ") if ind < 12 else raw
            m = DROPCAP.match(probe)
            if m:
                flush(); buf = m.group(1) + m.group(2).strip(); continue

            if para_min <= ind <= para_max:
                flush(); buf = stripped
            else:
                buf = join_hyphen(buf, stripped)
    flush()
    return paras


def slice_between(pages, start_marker, end_marker):
    """Return the lines of `pages` between the first line containing start_marker
    and the first line containing end_marker (end exclusive)."""
    lines = "\n".join(pages).split("\n")
    start = end = None
    for i, l in enumerate(lines):
        if start is None and start_marker in l:
            start = i
        elif start is not None and end_marker in l:
            end = i
            break
    if start is None:
        return []
    return lines[start:end if end is not None else len(lines)]
