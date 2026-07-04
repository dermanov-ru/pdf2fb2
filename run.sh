#!/usr/bin/env bash
# pdf2fb2 CLI wrapper. Call by absolute path from anywhere; no cd needed.
#   run.sh diagnose  <pdf>
#   run.sh calibrate <pdf> [pages...]
#   run.sh build     <config.yaml> [--variant text|images|both]
#   run.sh verify    <fb2>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# System deps: poppler-utils (pdftotext/pdfimages/pdfinfo), python3 + Pillow + pyyaml.
for bin in pdftotext pdfimages pdfinfo python3; do
  command -v "$bin" >/dev/null || { echo "missing: $bin (install poppler-utils / python3)"; exit 1; }
done
python3 - <<'PY' || { echo "python deps missing: pip install pillow pyyaml"; exit 1; }
import importlib, sys
for m in ("PIL", "yaml"):
    importlib.import_module(m)
PY

exec python3 "$HERE/cli.py" "$@"
