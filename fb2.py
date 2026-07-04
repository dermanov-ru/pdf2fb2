# -*- coding: utf-8 -*-
"""Assemble an FB2 (FictionBook 2.0) document from reconstructed content."""
import base64
import os

import textproc as tp

FB2_NS = "http://www.gribuser.ru/xml/fictionbook/2.0"
XLINK_NS = "http://www.w3.org/1999/xlink"


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def p(text):
    return "<p>" + esc(text) + "</p>"


def image_tag(idx):
    return f'<image l:href="#im{idx:03d}.jpg"/>'


# ---------------------------------------------------------------- description

def annotation_xml(cfg):
    text = (cfg.get("annotation") or "").strip()
    if not text:
        return ""
    paras = [b.strip() for b in text.split("\n\n") if b.strip()] or [text]
    return "<annotation>" + "".join(p(a) for a in paras) + "</annotation>"

def author_xml(cfg):
    a = cfg.get("author", {})
    parts = []
    if a.get("first"):  parts.append(f"<first-name>{esc(a['first'])}</first-name>")
    if a.get("middle"): parts.append(f"<middle-name>{esc(a['middle'])}</middle-name>")
    if a.get("last"):   parts.append(f"<last-name>{esc(a['last'])}</last-name>")
    return "<author>" + "".join(parts) + "</author>"

def description_xml(cfg, with_images, cover_index):
    genres = cfg.get("genres") or ["nonfiction"]
    genre_xml = "".join(f"<genre>{esc(g)}</genre>" for g in genres)
    cover = ""
    if with_images and cover_index is not None:
        cover = f'<coverpage><image l:href="#im{cover_index:03d}.jpg"/></coverpage>'
    pub = cfg.get("publish", {})
    year = pub.get("year", "")
    publish_xml = ""
    if pub:
        publish_xml = (
            "<publish-info>"
            f"<book-name>{esc(cfg['title'])}</book-name>"
            f"<publisher>{esc(pub.get('publisher',''))}</publisher>"
            f"<city>{esc(pub.get('city',''))}</city>"
            f"<year>{esc(str(year))}</year>"
            "</publish-info>")
    book_id = cfg.get("id") or "pdf2fb2-book"
    return (
        "<description>"
        "<title-info>"
        f"{genre_xml}"
        f"{author_xml(cfg)}"
        f"<book-title>{esc(cfg['title'])}</book-title>"
        f"{annotation_xml(cfg)}"
        f"<date value=\"{esc(str(year))}-01-01\">{esc(str(year))}</date>"
        f"{cover}"
        f"<lang>{esc(cfg.get('lang','ru'))}</lang>"
        "</title-info>"
        "<document-info>"
        "<author><nickname>pdf2fb2</nickname></author>"
        "<program-used>pdf2fb2 (pdftotext -layout + reconstruction)</program-used>"
        "<date>generated</date>"
        f"<id>{esc(book_id)}</id>"
        "<version>1.0</version>"
        "</document-info>"
        f"{publish_xml}"
        "</description>")


# ---------------------------------------------------------------- body sections

def foreword_section(pdf, cfg, front_last):
    fw = cfg.get("foreword")
    if not fw:
        return None
    pages = tp.layout_pages(pdf, 1, front_last)
    block = tp.slice_between(pages, fw["start_marker"], fw.get("end_marker", fw["start_marker"]))
    if not block:
        return None
    paras = tp.build_paragraphs(["\n".join(block)],
                                para_min=cfg["indent"]["para_min"],
                                para_max=cfg["indent"]["para_max"])
    title = fw.get("title", "Предисловие")
    out = ["<section>", f"<title>{p(title)}</title>"]
    for para in paras:
        if para.strip().rstrip("!") == title.rstrip("!"):
            continue
        out.append(p(para))
    if fw.get("signature"):
        out.append(f"<p><emphasis>{esc(fw['signature'])}</emphasis></p>")
    out.append("</section>")
    return "\n".join(out)

def chapter_section(pdf, cfg, ch, with_images, portraits):
    pages = tp.layout_pages(pdf, ch["start"], ch["end"])
    hanging = ch.get("mode") == "hanging"
    paras = tp.build_paragraphs(pages, tp.norm(ch["title"]), hanging=hanging,
                                para_min=cfg["indent"]["para_min"],
                                para_max=cfg["indent"]["para_max"])
    out = ["<section>", f"<title>{p(ch['title'])}</title>"]
    if with_images and ch["start"] in portraits:
        out.append(image_tag(portraits[ch["start"]]))
    out.extend(p(x) for x in paras)
    out.append("</section>")
    return "\n".join(out)

def photoblock_section(cfg, indices):
    pb = (cfg.get("images") or {}).get("photoblock")
    if not pb or not indices:
        return None
    out = ["<section>", f"<title>{p(pb.get('title','Фотоблок'))}</title>"]
    out.extend(image_tag(i) for i in indices)
    out.append("</section>")
    return "\n".join(out)


# ---------------------------------------------------------------- binaries

def binaries_xml(images_map):
    out = []
    for idx in sorted(images_map):
        with open(images_map[idx], "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode()
        out.append(f'<binary id="im{idx:03d}.jpg" content-type="image/jpeg">{b64}</binary>')
    return "\n".join(out)


# ---------------------------------------------------------------- top level

def build(pdf, cfg, with_images=False, images_map=None):
    images_map = images_map or {}
    img_cfg = cfg.get("images") or {}
    portraits = {int(k): int(v) for k, v in (img_cfg.get("portraits") or {}).items()}
    cover_index = img_cfg.get("cover_index")

    chapters = cfg["chapters"]
    front_last = max(1, chapters[0]["start"] - 1)

    # visible title page inside <body>: author, short title, optional subtitle
    a = cfg.get("author", {})
    author_line = " ".join(x for x in (a.get("first"), a.get("last")) if x).strip()
    title_short = cfg.get("title_short", cfg["title"])
    tparts = []
    if author_line:
        tparts.append(p(author_line))
    tparts.append(p(title_short))
    if cfg["title"] != title_short:
        subtitle = cfg["title"].replace(title_short, "").lstrip(" .—-") or cfg["title"]
        tparts.append("<empty-line/>")
        tparts.append(p(subtitle))
    body = ["<body>", "<title>" + "".join(tparts) + "</title>"]

    fw = foreword_section(pdf, cfg, front_last)
    if fw:
        body.append(fw)
    for ch in chapters:
        body.append(chapter_section(pdf, cfg, ch, with_images, portraits))

    # photoblock: indices from first_index up to the max embedded index
    if with_images and img_cfg.get("photoblock"):
        first = img_cfg["photoblock"].get("first_index", 0)
        idxs = [i for i in sorted(images_map) if i >= first]
        pbs = photoblock_section(cfg, idxs)
        if pbs:
            body.append(pbs)
    body.append("</body>")

    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<FictionBook xmlns="{FB2_NS}" xmlns:l="{XLINK_NS}">',
        description_xml(cfg, with_images, cover_index),
        "\n".join(body),
    ]
    if with_images:
        parts.append(binaries_xml(images_map))
    parts.append("</FictionBook>")
    return "\n".join(parts)
