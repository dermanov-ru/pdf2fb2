# pdf2fb2 — design notes

## Problem

Generic PDF→FB2 (Calibre) is mediocre precisely because it is generic: on a
justified, professionally typeset book it leaves page numbers, running headers,
broken hyphenation and lost paragraph boundaries in the text. But such books
carry enough structure to reconstruct cleanly — if you use the right signal.

## Key insight

`pdftotext -layout` preserves horizontal position. In a typeset book:

- a **new paragraph** starts with a red-line indent (a few leading spaces);
- **continuation** lines sit at column 0;
- the **last** line of a justified paragraph is short, but we don't need that —
  the *next* red-line indent is the reliable delimiter, so page breaks and blank
  lines are safely ignored (paragraphs survive page boundaries);
- **bibliographies** invert this: hanging indent, so flush-left = new entry.

Everything else is cleanup layered on top (hyphenation, drop caps, page numbers).

## What generalises vs. what is per-book

Reusable **logic** (in `textproc.py` / `images.py` / `fb2.py`), unchanged per book:
paragraph reconstruction, hyphen handling with a compound-word whitelist, drop
caps, page-number stripping, hanging-indent mode, CMYK inversion, FB2 assembly.

Per-book **configuration** (`book.yaml`), never code:
chapter titles + page ranges, metadata, page-offset, indent thresholds, image
maps (portraits / photoblock / cover), and the list of sections to drop.

Human **judgement**, once per book: does a text layer exist; is a section a
two-column index that `-layout` scrambles (drop it); is some front matter a
foreword to promote; do the embedded images look right (not negatives).

## Boundaries (deliberately not handled)

- **Scanned PDFs**: no text layer → needs OCR (tesseract) first. Different tool.
- **Multi-column body text**: `-layout` interleaves columns. Detected areas
  (e.g. name indexes) are meant to be *dropped* via `skip:`, not parsed.
- **Rich inline formatting** (italics/bold runs, footnotes): the text layer does
  not expose it reliably; output is plain paragraphs. Good enough for prose.
- **Automatic chapter detection**: intentionally manual — the TOC (surfaced by
  `diagnose`) makes filling `chapters:` a 2-minute job and avoids false splits.

## Validation

The tool was built from and is regression-checked against Ардзинба «Моя жизнь»
(2018, 512 pp., 90 CMYK photos). Its 1837 body paragraphs are the reference:
the CLI reproduces them exactly, and every embedded image reference resolves.
