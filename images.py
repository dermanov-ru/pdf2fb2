# -*- coding: utf-8 -*-
"""Image extraction and normalisation for FB2 embedding.

pdfimages dumps the raw compressed streams. Images authored in Adobe apps are
usually stored as *inverted* CMYK JPEGs; extracted verbatim they render as photo
negatives. The fix is to invert the CMYK channels before converting to RGB.
That is what `cmyk_invert: auto` does (invert whenever the source is CMYK).
"""
import os
import re
import glob
import subprocess

try:
    from PIL import Image, ImageChops
except ImportError:  # pragma: no cover
    Image = None


def list_images(pdf):
    """Return [(index, page, colormode), ...] from `pdfimages -list`."""
    out = subprocess.run(["pdfimages", "-list", pdf],
                         capture_output=True, text=True, check=True).stdout
    # columns: page num type width height color comp bpc enc interp object ID ...
    rows = []
    for line in out.splitlines()[2:]:
        parts = line.split()
        if len(parts) < 6 or not parts[0].isdigit():
            continue
        page, num, color = int(parts[0]), int(parts[1]), parts[5]
        rows.append((num, page, color))
    rows.sort()
    return rows


def extract_raw(pdf, workdir):
    """Run `pdfimages -all`; return {index: path} of the extracted files."""
    os.makedirs(workdir, exist_ok=True)
    for f in glob.glob(os.path.join(workdir, "raw-*")):
        os.remove(f)
    subprocess.run(["pdfimages", "-all", pdf, os.path.join(workdir, "raw")],
                   check=True)
    files = {}
    for path in glob.glob(os.path.join(workdir, "raw-*")):
        m = re.search(r"raw-(\d+)\.", os.path.basename(path))
        if m:
            files[int(m.group(1))] = path
    return files


def prepare(pdf, workdir, cmyk_invert="auto", quality=85):
    """Extract every image and normalise to RGB JPEG `im{index:03d}.jpg`.

    cmyk_invert: auto  -> invert channels only when the source is CMYK
                 always -> invert regardless (escape hatch)
                 never  -> straight convert (use if 'auto' yields negatives)
    Returns {index: rgb_jpeg_path}.
    """
    if Image is None:
        raise RuntimeError("Pillow is required for image embedding (pip install pillow)")
    raw = extract_raw(pdf, workdir)
    rgbdir = os.path.join(workdir, "rgb")
    os.makedirs(rgbdir, exist_ok=True)
    for f in glob.glob(os.path.join(rgbdir, "*.jpg")):
        os.remove(f)
    result = {}
    for idx, src in sorted(raw.items()):
        im = Image.open(src)
        do_invert = cmyk_invert == "always" or (cmyk_invert == "auto" and im.mode == "CMYK")
        if do_invert:
            im = ImageChops.invert(im)
        im = im.convert("RGB")
        dst = os.path.join(rgbdir, f"im{idx:03d}.jpg")
        im.save(dst, quality=quality, optimize=True)
        result[idx] = dst
    return result
