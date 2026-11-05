# pdf2fb2

[Русская версия](README.md)

Convert a **text-layer** PDF book into clean **FB2**, with paragraphs, chapters,
metadata and (optionally) embedded photos — the things a generic converter
(Calibre) mangles on professionally typeset books.

It is **not** a one-button "any PDF → FB2". It is an assisted pipeline: the CLI
does the deterministic mechanics, a small per-book YAML config supplies the
judgement (chapter ranges, metadata, what to drop), and an operator (you, or the
`pdf-to-fb2` skill) confirms the few things that need a human eye.

Scanned PDFs (no text layer) are **out of scope** — they need OCR first.

**Web version:** https://dermanov.ru/pdf2fb2/ — the same ideas ported to TypeScript on
top of pdf.js. Runs fully in the browser (the file never leaves the device), outputs
FB2 and EPUB, has a reader preview. Source: [`web/`](web/).

## Why it exists

`pdftotext` alone gives hard-wrapped line soup. But professionally typeset PDFs
(InDesign/TeX) encode paragraph structure via **indentation**, which
`pdftotext -layout` preserves. From that, pdf2fb2 rebuilds real paragraphs and
handles the recurring traps:

- red-line indent ⇒ new paragraph; column-0 line ⇒ continuation;
- soft word-wrap hyphens are glued (`охваты-\nвает` → `охватывает`) while real
  compound hyphens survive (`во-первых`, `по-русски`);
- drop caps rejoined (`Р  одился` → `Родился`);
- standalone page-number lines dropped; running headers ignored;
- paragraphs survive page breaks (a page boundary does not end a paragraph);
- bibliographies use a "hanging indent" mode (flush-left = new entry);
- Adobe **CMYK** images (which `pdfimages` dumps as negatives) are channel-inverted
  and converted to RGB before embedding.

## Requirements

- `poppler-utils` (`pdftotext`, `pdfimages`, `pdfinfo`)
- Python 3 with **Pillow** and **PyYAML** (both usually already present system-wide)

No venv needed if those are installed. `run.sh` checks and tells you what's missing.

## Usage

```bash
# 1. Is it convertible? Get image map + a TOC skeleton for the config.
./run.sh diagnose  book.pdf

# 2. Suggest the red-line indent thresholds.
./run.sh calibrate book.pdf

# 3. Write book.yaml (copy examples/ardzinba.yaml and edit chapters/metadata).

# 4. Build. Produces <stem>.fb2 (text) and, if images.mode: embed, <stem>_foto.fb2.
./run.sh build book.yaml --variant both     # text | images | both

# 5. Sanity-check any FB2 (well-formed XML + every image ref resolves).
./run.sh verify book.fb2
```

`examples/ardzinba.yaml` is a complete worked config (В. Г. Ардзинба, «Моя жизнь»,
512 pp., 90 photos) — the first book this tool was built from and validated against.

## Per-book workflow (what needs a human)

1. `diagnose` → confirm there is a text layer; note CMYK; grab the TOC.
2. Fill `chapters` from the TOC. Check the page **offset** (does `pdftotext -f N`
   land on printed page N?). Usually the printed page number == PDF page.
3. `calibrate` → set `indent.para_min/para_max`.
4. Decide what to **drop** (name indexes, two-column matter that `-layout`
   scrambles) and what to promote (a foreword). Record drops under `skip:`.
5. For images: map chapter-opening portraits (`portraits:`) and the plate section
   (`photoblock:`) using the `diagnose` index→page listing. Pick a `cover_index`.
6. `build` → `verify` → eyeball a couple of embedded images and a few chapters.

## Files

| File | Role |
|------|------|
| `run.sh` | dependency-checking wrapper → `cli.py` |
| `cli.py` | `diagnose` / `calibrate` / `build` / `verify` |
| `textproc.py` | paragraph reconstruction engine (the reusable core) |
| `images.py` | extract + CMYK-invert + RGB-normalise images |
| `fb2.py` | assemble the FB2 XML (description, body, binaries) |
| `diagnose.py` | text-layer / image / TOC diagnostics + indent calibration |
| `examples/ardzinba.yaml` | reference config |
| `skill/SKILL.md` | the `pdf-to-fb2` Claude Code skill (copy into `~/.claude/skills/pdf-to-fb2/` and set the path to `run.sh`) |

See `SDD.md` for the design rationale and the boundaries of what generalises.

## Web version (`web/`)

TypeScript port that runs in the browser on [pdf.js](https://github.com/mozilla/pdf.js)
(`pdfjs-dist` 6.x, legacy build). Live: https://dermanov.ru/pdf2fb2/

Instead of `pdftotext -layout` it works with pdf.js text coordinates, and needs no
per-book config:

- `extract.ts` — lines from text items, body font size = most frequent size, paragraph
  indent in ems, drop caps, running headers (lines repeated on many pages), chapters from
  PDF bookmarks or large headings, chapter titles spelled as in the printed TOC, footnotes
  moved to the chapter end, title/author from the title page;
- `textproc.ts` — paragraphs, hyphen gluing, title case (port of `textproc.py`);
- `glyphfix.ts` + `ptserif-order.ts` — fonts embedded without a ToUnicode map
  (CID Identity-H from Word/InDesign): pdf.js and poppler return glyph ids instead of
  letters. ASCII/Latin-1 are restored by a fixed offset, the Cyrillic offset is found by
  Russian letter frequencies; PT Serif is decoded by its exact glyph order (so Abkhaz
  letters and dashes come out right too);
- `pdfjs-patch.mjs` — Vite plugin patching the pdf.js worker: some typesetters encode the
  em dash as a wide U+00AD, which pdf.js otherwise drops as an invisible mark;
- `fb2.ts`, `epub.ts` — FB2 2.0 and EPUB 3 (with `toc.ncx` for older readers, zipped by
  [fflate](https://github.com/101arrowz/fflate));
- `browser.ts` — wiring: worker, cMaps, standard fonts.

The UI page lives in the site repo; these files are its core, copied as is.
