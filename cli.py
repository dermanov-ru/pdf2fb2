#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pdf2fb2 — convert a text-layer PDF book into clean FB2.

Commands:
  diagnose  <pdf>                 is it convertible? images / TOC / CMYK hints
  calibrate <pdf> [pages...]      suggest indent thresholds for the config
  build     <config.yaml>         build FB2 (text and/or images) per config
  verify    <fb2>                 well-formedness + image-reference integrity
"""
import argparse
import os
import sys
import xml.dom.minidom as minidom

import yaml

import diagnose
import images as imgmod
import fb2


def load_cfg(path):
    with open(path, encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)
    cfg.setdefault("indent", {}).setdefault("para_min", 2)
    cfg["indent"].setdefault("para_max", 6)
    cfg.setdefault("lang", "ru")
    cfg.setdefault("title_short", cfg["title"])
    return cfg


def cmd_diagnose(args):
    print(diagnose.report(args.pdf))


def cmd_calibrate(args):
    n = diagnose.page_count(args.pdf) or 20
    pages = args.pages or list(range(max(1, n // 3), max(1, n // 3) + 8))
    thresh, msg = diagnose.calibrate(args.pdf, pages)
    print(f"страницы-образцы: {pages}")
    print(msg)


def _workdir(cfg, config_path):
    base = cfg.get("workdir") or os.path.join(
        os.path.dirname(os.path.abspath(config_path)), ".pdf2fb2-work")
    return base


def cmd_build(args):
    cfg = load_cfg(args.config)
    pdf = cfg["pdf"]
    out_dir = cfg.get("out_dir") or os.path.dirname(os.path.abspath(pdf))
    stem = cfg.get("out_stem") or os.path.splitext(os.path.basename(pdf))[0]

    img_cfg = cfg.get("images") or {}
    want_images = img_cfg.get("mode", "none") == "embed"
    variant = args.variant

    outputs = []

    if variant in ("text", "both"):
        xml = fb2.build(pdf, cfg, with_images=False)
        path = os.path.join(out_dir, f"{stem}.fb2")
        _write(path, xml)
        outputs.append(path)

    if variant in ("images", "both") and want_images:
        wd = _workdir(cfg, args.config)
        print("извлекаю и нормализую изображения…", file=sys.stderr)
        images_map = imgmod.prepare(
            pdf, os.path.join(wd, "img"),
            cmyk_invert=img_cfg.get("cmyk_invert", "auto"),
            quality=img_cfg.get("quality", 85))
        xml = fb2.build(pdf, cfg, with_images=True, images_map=images_map)
        path = os.path.join(out_dir, f"{stem}_foto.fb2")
        _write(path, xml)
        outputs.append(path)
    elif variant == "images" and not want_images:
        print("images.mode != embed — пропускаю версию с картинками", file=sys.stderr)

    for pth in outputs:
        ok, info = _verify(pth)
        flag = "✓" if ok else "✗"
        print(f"{flag} {pth}  ({os.path.getsize(pth)//1024} КБ)  {info}")


def cmd_verify(args):
    ok, info = _verify(args.fb2)
    print(("✓ " if ok else "✗ ") + args.fb2 + "  " + info)
    sys.exit(0 if ok else 1)


def _write(path, xml):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(xml)


def _verify(path):
    import re
    data = open(path, encoding="utf-8").read()
    try:
        minidom.parseString(data.encode("utf-8"))
    except Exception as e:
        return False, f"невалидный XML: {e}"
    refs = set(re.findall(r'l:href="#([^"]+)"', data))
    bins = set(re.findall(r'<binary id="([^"]+)"', data))
    missing = refs - bins
    secs = data.count("<section>")
    if missing:
        return False, f"ссылки без бинарника: {sorted(missing)[:5]}"
    return True, f"XML ok, секций: {secs}, картинок: {len(bins)}"


def main():
    ap = argparse.ArgumentParser(prog="pdf2fb2", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("diagnose"); d.add_argument("pdf"); d.set_defaults(fn=cmd_diagnose)
    c = sub.add_parser("calibrate"); c.add_argument("pdf")
    c.add_argument("pages", nargs="*", type=int); c.set_defaults(fn=cmd_calibrate)
    b = sub.add_parser("build"); b.add_argument("config")
    b.add_argument("--variant", choices=["text", "images", "both"], default="both")
    b.set_defaults(fn=cmd_build)
    v = sub.add_parser("verify"); v.add_argument("fb2"); v.set_defaults(fn=cmd_verify)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
