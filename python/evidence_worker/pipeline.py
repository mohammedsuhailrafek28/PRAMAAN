"""Hybrid page pipeline: embedded text first, OCR only where text is missing or unusable."""
from __future__ import annotations

import math
import re
import time
from typing import Dict, List, Optional

import numpy as np

from . import ocr
from .backends import ACTIVE_MARKERS, BackendUnavailable, Rect, TooManyObjects, open_document  # noqa: F401
from .layout import Item, Line, build_lines, order_lines
from .limits import LimitExceeded, check_memory
from .tables import extract_bank_table

REJECT_ACTIVE = {"JAVASCRIPT", "LAUNCH", "EMBEDDED_FILE", "RICH_MEDIA", "SUBMIT_FORM", "IMPORT_DATA", "UNPARSEABLE_STRUCTURE"}


class Limits:
    def __init__(self, **kw):
        self.max_bytes = kw.get("max_bytes", 5 * 1024 * 1024)
        self.max_pages = kw.get("max_pages", 40)
        self.max_ocr_pages = kw.get("max_ocr_pages", 12)
        self.max_pixels = kw.get("max_pixels", 12_000_000)
        self.dpi = kw.get("dpi", 200)
        self.max_objects = kw.get("max_objects", 20_000)
        self.max_items = kw.get("max_items", 30_000)
        self.time_budget = kw.get("time_budget", 80.0)
        self.max_memory_mb = kw.get("max_memory_mb", 1500)
        self.max_page_points = kw.get("max_page_points", 6000)


def _upright(words, direction, page_rect) -> List[Item]:
    dx, dy = direction
    theta = -math.atan2(dy, dx)
    c, s = round(math.cos(theta)), round(math.sin(theta))

    def rotate(x, y):
        return x * c - y * s, x * s + y * c

    corners = [rotate(x, y) for x, y in ((page_rect.x0, page_rect.y0), (page_rect.x1, page_rect.y0), (page_rect.x0, page_rect.y1), (page_rect.x1, page_rect.y1))]
    ox, oy = min(p[0] for p in corners), min(p[1] for p in corners)
    items: List[Item] = []
    for x0, y0, x1, y1, text, *_ in words:
        pts = [rotate(x, y) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
        items.append(Item(text=text, x0=min(p[0] for p in pts) - ox, y0=min(p[1] for p in pts) - oy, x1=max(p[0] for p in pts) - ox, y1=max(p[1] for p in pts) - oy, method="EMBEDDED_TEXT", conf=1.0))
    width = max(p[0] for p in corners) - ox
    height = max(p[1] for p in corners) - oy
    return items, width, height


_EN = dict(zip("abcdefghijklmnopqrstuvwxyz", [8.17, 1.49, 2.78, 4.25, 12.7, 2.23, 2.02, 6.09, 6.97, 0.15, 0.77, 4.03, 2.41, 6.75, 7.51, 1.93, 0.1, 5.99, 6.33, 9.06, 2.76, 0.98, 2.36, 0.15, 1.97, 0.07]))
_EN_TOTAL = sum(_EN.values())
LIKENESS_MIN = 0.048  # normal English text scores ~0.058-0.065; text with a broken font mapping scores ~0.035


def english_likeness(text: str) -> Optional[float]:
    """Dot product of the letter distribution with English's. Detects a text layer that is valid Unicode but meaningless
    (broken font encodings). None when there are too few letters to judge (digit-heavy tables, non-Latin scripts)."""
    counts: Dict[str, int] = {}
    for ch in text.lower():
        if ch in _EN:
            counts[ch] = counts.get(ch, 0) + 1
    total = sum(counts.values())
    if total < 25:
        return None
    return sum((_EN[k] / _EN_TOTAL) * counts.get(k, 0) / total for k in _EN)


def _text_quality(items: List[Item]) -> Dict[str, float]:
    text = "".join(item.text for item in items)
    total = max(len(text), 1)
    bad = sum(1 for ch in text if ch == "�" or "" <= ch <= "" or (ord(ch) < 32) or ch == "\x7f") + text.count("(cid:") * 6
    alnum = sum(1 for ch in text if ch.isalnum())
    likeness = english_likeness(text)
    return {"chars": len(text), "alnum": alnum, "garbledRatio": round(bad / total, 3), "words": len(items), "likeness": None if likeness is None else round(likeness, 4)}


def _sufficient(quality: Dict[str, float]) -> bool:
    likeness = quality.get("likeness")
    return quality["alnum"] >= 40 and quality["words"] >= 8 and quality["garbledRatio"] <= 0.1 and (likeness is None or likeness >= LIKENESS_MIN)


def _render(page, limits: Limits, clip: Optional[Rect] = None) -> Optional[tuple[np.ndarray, float]]:
    rect = clip or page.rect
    if rect.width > limits.max_page_points or rect.height > limits.max_page_points:
        return None
    scale = min(limits.dpi / 72.0, math.sqrt(limits.max_pixels / max(rect.width * rect.height, 1.0)))
    if scale < 0.5:
        return None
    return page.render(scale, clip), scale


def _ocr_items(image: np.ndarray, scale: float):
    boxes, rotation, upright, tried = ocr.oriented_recognition(image)
    items = [Item(text=text, x0=x0 / scale, y0=y0 / scale, x1=x1 / scale, y1=y1 / scale, method="OCR", conf=conf) for x0, y0, x1, y1, text, conf in boxes]
    mean = sum(b[5] for b in boxes) / len(boxes) if boxes else 0.0
    return items, rotation, upright.shape[1] / scale, upright.shape[0] / scale, round(mean, 3), tried


def process(path: str, limits: Limits, started: float) -> dict:
    out: dict = {"schema": 1, "status": "OK", "reason": None, "pageCount": 0, "processedPages": 0, "activeContent": [], "pages": [], "tables": [], "ocrPages": 0, "notes": []}
    try:
        doc = open_document(path)
    except BackendUnavailable:
        raise
    except Exception:
        out.update(status="UNSUPPORTED", reason="NOT_A_PDF")
        return out
    try:
        if doc.encrypted:
            out.update(status="UNSUPPORTED", reason="ENCRYPTED")
            return out
        out["pageCount"] = doc.page_count
        if doc.page_count == 0:
            out.update(status="UNREADABLE", reason="NO_PAGES")
            return out
        try:
            out["activeContent"] = doc.active_content(limits.max_objects)
        except TooManyObjects:
            raise LimitExceeded("TOO_MANY_OBJECTS")
        if REJECT_ACTIVE & set(out["activeContent"]):
            out.update(status="REJECTED", reason="ACTIVE_CONTENT")
            return out
        total_items = 0
        page_lines: List[List[Line]] = []
        page_seconds: List[float] = []
        degraded: Optional[str] = "PAGE_LIMIT" if doc.page_count > limits.max_pages else None
        for index in range(min(doc.page_count, limits.max_pages)):
            elapsed = time.monotonic() - started
            # Stop before a page that would probably overrun the budget (the slowest page so far is the estimate).
            if elapsed > limits.time_budget or (page_seconds and elapsed + 1.2 * max(page_seconds) > limits.time_budget):
                degraded = degraded or "TIME_LIMIT"
                break
            page_started = time.monotonic()
            check_memory(limits.max_memory_mb)
            page = doc.page(index)
            direction = page.direction()
            words = page.words()
            items, width, height = _upright(words, direction, page.rect)
            quality = _text_quality(items)
            method = "EMBEDDED_TEXT" if _sufficient(quality) else "NONE"
            ocr_meta = None
            page_notes: List[str] = []

            need_full_ocr = not _sufficient(quality)
            if need_full_ocr:
                items = []
            if need_full_ocr and out["ocrPages"] >= limits.max_ocr_pages:
                page_notes.append("OCR_PAGE_LIMIT")
                degraded = degraded or "OCR_PAGE_LIMIT"
                need_full_ocr = False
            if need_full_ocr and not ocr.available():
                page_notes.append("OCR_UNAVAILABLE")
                degraded = degraded or "OCR_UNAVAILABLE"
                need_full_ocr = False
            if need_full_ocr:
                rendered = _render(page, limits)
                if rendered is None:
                    page_notes.append("PAGE_TOO_LARGE_FOR_OCR")
                    degraded = degraded or "PAGE_TOO_LARGE"
                else:
                    image, scale = rendered
                    ocr_items, rotation, width, height, mean, tried = _ocr_items(image, scale)
                    items = ocr_items
                    method = "OCR" if ocr_items else "NONE"
                    out["ocrPages"] += 1
                    ocr_meta = {"engine": ocr.engine_version(), "meanConfidence": mean, "rotationDegrees": rotation, "rotationsTried": tried, "boxes": len(ocr_items), "dpi": round(scale * 72)}
            elif method == "EMBEDDED_TEXT" and ocr.available() and out["ocrPages"] < limits.max_ocr_pages:
                # Mixed page: large image regions that the text layer does not cover are OCR'd and merged.
                try:
                    page_area = page.rect.width * page.rect.height
                    regions = []
                    for box in page.image_boxes():
                        rect = box.intersect(page.rect)
                        if rect.is_empty or rect.width * rect.height < 0.12 * page_area:
                            continue
                        covered = sum(max(0.0, (min(w[2], rect.x1) - max(w[0], rect.x0))) * max(0.0, (min(w[3], rect.y1) - max(w[1], rect.y0))) for w in words)
                        if covered / (rect.width * rect.height) < 0.35:
                            regions.append(rect)
                    for rect in regions[:3]:
                        rendered = _render(page, limits, clip=rect)
                        if rendered is None:
                            continue
                        image, scale = rendered
                        boxes = ocr.recognize(image)
                        for x0, y0, x1, y1, text, conf in boxes:
                            item = Item(text=text, x0=rect.x0 + x0 / scale, y0=rect.y0 + y1 * 0 + y0 / scale, x1=rect.x0 + x1 / scale, y1=rect.y0 + y1 / scale, method="OCR_IMAGE_REGION", conf=conf)
                            overlaps = any(min(item.x1, e.x1) > max(item.x0, e.x0) and min(item.y1, e.y1) > max(item.y0, e.y0) for e in items)
                            if not overlaps:
                                items.append(item)
                        if boxes:
                            method = "MIXED"
                    if method == "MIXED":
                        out["ocrPages"] += 1
                        ocr_meta = {"engine": ocr.engine_version(), "regions": len(regions[:3]), "dpi": limits.dpi}
                except LimitExceeded:
                    raise
                except Exception:
                    page_notes.append("IMAGE_REGION_OCR_FAILED")

            total_items += len(items)
            if total_items > limits.max_items:
                raise LimitExceeded("CONTENT_LIMIT")
            lines = build_lines(items)
            lines, columns = order_lines(lines, width)
            page_lines.append(lines)
            out["pages"].append({
                "page": index + 1, "method": method, "width": round(width, 1), "height": round(height, 1), "columns": columns,
                "pdfRotation": page.rotation, "textQuality": quality, "ocr": ocr_meta, "notes": page_notes,
                "lines": [{"text": line.text, "bbox": [round(v, 1) for v in line.bbox], "column": line.column,
                           "segments": [{"text": s.text, "bbox": s.bbox, "conf": s.conf, "method": s.method} for s in line.segments]} for line in lines[:1500]],
            })
            out["processedPages"] += 1
            page_seconds.append(time.monotonic() - page_started)
        table = extract_bank_table(page_lines)
        if table:
            out["tables"].append(table)
        if degraded:
            out["status"], out["reason"] = "PARTIAL", degraded
        if not any(page["lines"] for page in out["pages"]):
            out["status"], out["reason"] = "UNREADABLE", out["reason"] or "NO_EXTRACTABLE_TEXT"
    finally:
        doc.close()
    return out


MAX_IMAGE_PIXELS = 60_000_000
IMAGE_MAGIC = {"png": b"\x89PNG\r\n\x1a\n", "jpeg": b"\xff\xd8\xff"}


def process_image(path: str, kind: str, limits: Limits, started: float) -> dict:
    """A photographed or scanned page uploaded as PNG/JPEG: always OCR, one page."""
    out: dict = {"schema": 1, "status": "OK", "reason": None, "pageCount": 1, "processedPages": 0, "activeContent": [], "pages": [], "tables": [], "ocrPages": 0, "notes": []}
    with open(path, "rb") as handle:
        if not handle.read(16).startswith(IMAGE_MAGIC.get(kind, b"\x00")):
            out.update(status="UNSUPPORTED", reason="NOT_AN_IMAGE", pageCount=0)
            return out
    if not ocr.available():
        out.update(status="UNREADABLE", reason="OCR_UNAVAILABLE")
        return out
    from PIL import Image, ImageOps

    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        with Image.open(path) as image:
            width, height = image.size
            if width * height > MAX_IMAGE_PIXELS:
                out.update(status="REJECTED", reason="IMAGE_TOO_LARGE")
                return out
            image = ImageOps.exif_transpose(image).convert("RGB")
            scale = min(1.0, math.sqrt(limits.max_pixels / max(width * height, 1)))
            if scale < 1.0:
                image = image.resize((max(int(width * scale), 1), max(int(height * scale), 1)))
            array = np.asarray(image).copy()
    except Image.DecompressionBombError:
        out.update(status="REJECTED", reason="IMAGE_TOO_LARGE")
        return out
    except Exception:
        out.update(status="UNREADABLE", reason="PARSE_ERROR")
        return out
    check_memory(limits.max_memory_mb)
    items, rotation, width_pt, height_pt, mean, tried = _ocr_items(array, 1.0)
    lines = build_lines(items)
    lines, columns = order_lines(lines, width_pt)
    out["pages"].append({"page": 1, "method": "OCR" if items else "NONE", "width": round(width_pt, 1), "height": round(height_pt, 1), "columns": columns, "pdfRotation": 0,
                         "textQuality": {"chars": sum(len(i.text) for i in items), "alnum": 0, "garbledRatio": 0, "words": len(items), "likeness": None},
                         "ocr": {"engine": ocr.engine_version(), "meanConfidence": mean, "rotationDegrees": rotation, "rotationsTried": tried, "boxes": len(items), "dpi": None}, "notes": [],
                         "lines": [{"text": line.text, "bbox": [round(v, 1) for v in line.bbox], "column": line.column,
                                    "segments": [{"text": s.text, "bbox": s.bbox, "conf": s.conf, "method": s.method} for s in line.segments]} for line in lines[:1500]]})
    out["processedPages"], out["ocrPages"] = 1, 1
    table = extract_bank_table([lines])
    if table:
        out["tables"].append(table)
    if not items:
        out.update(status="UNREADABLE", reason="NO_EXTRACTABLE_TEXT")
    return out
