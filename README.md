# pdf2fb2

Convert a **text-layer** PDF book into clean **FB2**, with paragraphs, chapters,
metadata and (optionally) embedded photos — the things a generic converter
(Calibre) mangles on professionally typeset books.

It is **not** a one-button "any PDF → FB2". It is an assisted pipeline: the CLI
does the deterministic mechanics, a small per-book YAML config supplies the
judgement (chapter ranges, metadata, what to drop), and an operator (you, or the
`pdf-to-fb2` skill) confirms the few things that need a human eye.

Scanned PDFs (no text layer) are **out of scope** — they need OCR first.

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
| `skill/SKILL.md` | the `pdf-to-fb2` Claude Code skill (symlinked into `~/.claude/skills`) |

See `SDD.md` for the design rationale and the boundaries of what generalises.
