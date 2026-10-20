"""PDF library adapters. The pipeline only talks to the small interface below, so the parsing library can be swapped.

* "pymupdf" (default, production): PyMuPDF. Open-source use is under AGPL-3.0; a commercial licence is sold by Artifex.
* "pdfium" (EXPERIMENTAL, opt-in with EVIDENCE_PDF_BACKEND=pdfium): pypdfium2 (Apache-2.0 / BSD-3-Clause) for text, geometry and
  rendering, plus pypdf (BSD-3-Clause) to inspect PDF objects for active content, because PDFium exposes no object access.
  It is never selected automatically: see docs/HORIZON_DOCUMENT_INTELLIGENCE.md for the comparison gates.

All geometry handed to the pipeline is in the DISPLAYED page's coordinates (after the page's /Rotate), in points, origin at the
top-left, y growing downwards. Words are (x0, y0, x1, y1, text).
"""
from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

ACTIVE_MARKERS = [(b"/JavaScript", "JAVASCRIPT"), (b"/JS", "JAVASCRIPT"), (b"/Launch", "LAUNCH"), (b"/EmbeddedFile", "EMBEDDED_FILE"),
                  (b"/RichMedia", "RICH_MEDIA"), (b"/SubmitForm", "SUBMIT_FORM"), (b"/ImportData", "IMPORT_DATA")]
ACTIVE_NAMES = {marker[1:].decode(): name for marker, name in ACTIVE_MARKERS}


class BackendUnavailable(Exception):
    pass


class TooManyObjects(Exception):
    pass


@dataclass(frozen=True)
class Rect:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def is_empty(self) -> bool:
        return self.x1 <= self.x0 or self.y1 <= self.y0

    def intersect(self, other: "Rect") -> "Rect":
        return Rect(max(self.x0, other.x0), max(self.y0, other.y0), min(self.x1, other.x1), min(self.y1, other.y1))


def _clamp_scale(rect: Rect, dpi: int, max_pixels: int, max_page_points: float) -> Optional[float]:
    if rect.width > max_page_points or rect.height > max_page_points:
        return None
    scale = min(dpi / 72.0, math.sqrt(max_pixels / max(rect.width * rect.height, 1.0)))
    return None if scale < 0.5 else scale


# --------------------------------------------------------------------------------------------------------------------- PyMuPDF
class _FitzPage:
    def __init__(self, page, fitz):
        self._page, self._fitz = page, fitz
        r = page.rect
        self.rotation = page.rotation
        # PyMuPDF reports page.rect AFTER /Rotate but extracts text in the UNROTATED page's coordinates, so the frame the words
        # live in has the width and height swapped for quarter-turn pages.
        quarter = self.rotation in (90, 270)
        self.rect = Rect(r.x0, r.y0, r.x0 + (r.height if quarter else r.width), r.y0 + (r.width if quarter else r.height))

    def words(self) -> List[tuple]:
        return [(w[0], w[1], w[2], w[3], w[4]) for w in self._page.get_text("words")]

    def direction(self) -> Tuple[float, float]:
        weight: Dict[tuple, int] = {}
        try:
            for block in self._page.get_text("dict", flags=self._fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
                for line in block.get("lines", []):
                    key = (round(line["dir"][0]), round(line["dir"][1]))
                    weight[key] = weight.get(key, 0) + sum(len(span["text"]) for span in line["spans"])
        except Exception:
            return (1.0, 0.0)
        return max(weight, key=weight.get) if weight else (1.0, 0.0)

    def image_boxes(self, limit: int = 12) -> List[Rect]:
        return [Rect(*info["bbox"]) for info in self._page.get_image_info()[:limit]]

    def render(self, scale: float, clip: Optional[Rect]) -> np.ndarray:
        fitz = self._fitz
        pix = self._page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=fitz.Rect(clip.x0, clip.y0, clip.x1, clip.y1) if clip else None, colorspace=fitz.csRGB, alpha=False)
        return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()


class PymupdfDocument:
    name = "pymupdf"

    def __init__(self, path: str):
        import fitz

        self._fitz = fitz
        self._doc = fitz.open(path, filetype="pdf")

    def close(self) -> None:
        self._doc.close()

    @property
    def encrypted(self) -> bool:
        return bool(self._doc.needs_pass or self._doc.is_encrypted)

    @property
    def page_count(self) -> int:
        return self._doc.page_count

    def page(self, index: int) -> _FitzPage:
        return _FitzPage(self._doc[index], self._fitz)

    def active_content(self, max_objects: int) -> List[str]:
        found: set = set()
        count = self._doc.xref_length()
        if count > max_objects:
            raise TooManyObjects()
        for xref in range(1, count):
            try:
                raw = self._doc.xref_object(xref, compressed=True).encode("latin1", "ignore")
            except Exception:
                continue
            for marker, name in ACTIVE_MARKERS:
                if marker in raw:
                    found.add(name)
        return sorted(found)


# --------------------------------------------------------------------------------------------------------------------- PDFium
class _PdfiumPage:
    def __init__(self, page, raw, ctypes):
        self._page, self._raw, self._ct = page, raw, ctypes
        self.rotation = page.get_rotation()
        width, height = page.get_size()  # displayed size: PDFium applies /Rotate
        self.rect = Rect(0.0, 0.0, float(width), float(height))
        self._size = (width, height)

    def _to_device(self, x: float, y: float) -> Tuple[float, float]:
        ct = self._ct
        dx, dy = ct.c_int(), ct.c_int()
        w, h = self._size
        # Device units of one point == 1/1000 so rounding does not distort word boxes: scale the "device" canvas by 1000.
        self._raw.FPDF_PageToDevice(self._page, 0, 0, int(round(w * 1000)), int(round(h * 1000)), 0, x, y, ct.byref(dx), ct.byref(dy))
        return dx.value / 1000.0, dy.value / 1000.0

    def _text(self):
        if not hasattr(self, "_tp"):
            self._tp = self._page.get_textpage()
        return self._tp

    def words(self) -> List[tuple]:
        ct, raw = self._ct, self._raw
        tp = self._text()
        handle = tp.raw
        total = tp.count_chars()
        words: List[tuple] = []
        current: List[str] = []
        box: Optional[List[float]] = None
        left, right, bottom, top = ct.c_double(), ct.c_double(), ct.c_double(), ct.c_double()
        rect = raw.FS_RECTF()

        def flush():
            nonlocal current, box
            if current and box is not None:
                corners = [self._to_device(x, y) for x, y in ((box[0], box[1]), (box[2], box[1]), (box[0], box[3]), (box[2], box[3]))]
                words.append((min(c[0] for c in corners), min(c[1] for c in corners), max(c[0] for c in corners), max(c[1] for c in corners), "".join(current)))
            current, box = [], None

        for index in range(total):
            code = raw.FPDFText_GetUnicode(handle, index)
            ch = chr(code) if 0 < code < 0x110000 else ""
            if not ch or ch.isspace() or ch == "￾" or ch == "\x00":
                flush()
                continue
            # The loose box spans the font's ascent to descent like PyMuPDF's word boxes (the tight glyph box would shrink the
            # line height the layout code derives its spacing thresholds from).
            if not raw.FPDFText_GetLooseCharBox(handle, index, rect):
                flush()
                continue
            current.append(ch)
            l, b_, r, t_ = rect.left, rect.bottom, rect.right, rect.top
            if box is None:
                box = [l, b_, r, t_]
            else:
                box = [min(box[0], l), min(box[1], b_), max(box[2], r), max(box[3], t_)]
        flush()
        return words

    def direction(self) -> Tuple[float, float]:
        """Dominant text direction in displayed (y-down) coordinates, quadrant-rounded like PyMuPDF's line direction."""
        ct, raw = self._ct, self._raw
        tp = self._text()
        handle = tp.raw
        weight: Dict[tuple, int] = {}
        origin = self._to_device(0.0, 0.0)
        cache: Dict[int, tuple] = {}
        for index in range(tp.count_chars()):
            code = raw.FPDFText_GetUnicode(handle, index)
            if code <= 32:
                continue
            angle = raw.FPDFText_GetCharAngle(handle, index)  # radians, page space (y-up)
            if angle < 0:
                continue
            quadrant = int(round(angle / (math.pi / 2))) % 4
            if quadrant not in cache:
                tip = self._to_device(math.cos(quadrant * math.pi / 2), math.sin(quadrant * math.pi / 2))
                cache[quadrant] = (round(tip[0] - origin[0]), round(tip[1] - origin[1]))
            weight[cache[quadrant]] = weight.get(cache[quadrant], 0) + 1
        return max(weight, key=weight.get) if weight else (1.0, 0.0)

    def image_boxes(self, limit: int = 12) -> List[Rect]:
        raw = self._raw
        boxes: List[Rect] = []
        for obj in self._page.get_objects(filter=[raw.FPDF_PAGEOBJ_IMAGE]):
            l, b, r, t = obj.get_bounds()
            corners = [self._to_device(x, y) for x, y in ((l, b), (r, b), (l, t), (r, t))]
            boxes.append(Rect(min(c[0] for c in corners), min(c[1] for c in corners), max(c[0] for c in corners), max(c[1] for c in corners)))
            if len(boxes) >= limit:
                break
        return boxes

    def render(self, scale: float, clip: Optional[Rect]) -> np.ndarray:
        width, height = self._size
        crop = (0, 0, 0, 0) if clip is None else (clip.x0, height - clip.y1, width - clip.x1, clip.y0)  # left, bottom, right, top
        bitmap = self._page.render(scale=scale, crop=crop)
        image = bitmap.to_numpy()
        if image.ndim == 3 and image.shape[2] == 4:
            image = image[:, :, :3]
        if image.ndim == 3:
            image = image[:, :, ::-1]  # BGR -> RGB
        return np.ascontiguousarray(image)


class PdfiumDocument:
    name = "pdfium"

    def __init__(self, path: str):
        try:
            import ctypes

            import pypdfium2 as pdfium
            import pypdfium2.raw as raw
            import pypdf
        except ImportError as error:  # pragma: no cover - environment dependent
            raise BackendUnavailable(str(error))
        self._ct, self._raw, self._path = ctypes, raw, path
        self._pypdf = pypdf
        try:
            self._doc = pdfium.PdfDocument(path)
        except pdfium.PdfiumError as error:
            message = str(error).lower()
            if "password" in message:
                self._encrypted = True
                self._doc = None
                return
            raise
        self._encrypted = False

    def close(self) -> None:
        if self._doc is not None:
            self._doc.close()

    @property
    def encrypted(self) -> bool:
        return self._encrypted

    @property
    def page_count(self) -> int:
        return len(self._doc)

    def page(self, index: int) -> _PdfiumPage:
        return _PdfiumPage(self._doc[index], self._raw, self._ct)

    def active_content(self, max_objects: int) -> List[str]:
        """Walks every PDF object (including those inside object streams) looking for the same action/feature names the PyMuPDF
        scan looks for. PDFium itself has no object access, so pypdf does the parsing; a file pypdf cannot parse fails closed."""
        pypdf = self._pypdf
        try:
            reader = pypdf.PdfReader(self._path, strict=False)
            if reader.is_encrypted:
                return []
            found: set = set()
            seen = 0
            stack: list = [reader.trailer]
            visited: set = set()
            numbers = [(generation, number) for generation, table in reader.xref.items() for number in table]
            numbers += [(0, number) for number in reader.xref_objStm]
            for generation, number in numbers:
                seen += 1
                if seen > max_objects:
                    raise TooManyObjects()
                try:
                    stack.append(reader.get_object(pypdf.generic.IndirectObject(number, generation, reader)))
                except Exception:
                    continue
                while stack:
                    node = stack.pop()
                    if isinstance(node, pypdf.generic.IndirectObject):
                        continue  # visited through the xref walk itself
                    if id(node) in visited:
                        continue
                    visited.add(id(node))
                    if isinstance(node, pypdf.generic.NameObject):
                        name = ACTIVE_NAMES.get(str(node)[1:])
                        if name:
                            found.add(name)
                    elif isinstance(node, dict):
                        for key, value in node.items():
                            name = ACTIVE_NAMES.get(str(key)[1:])
                            if name:
                                found.add(name)
                            stack.append(value)
                    elif isinstance(node, (list, tuple)):
                        stack.extend(node)
            return sorted(found)
        except TooManyObjects:
            raise
        except Exception:
            # Unparseable structure: do not guess that it is clean.
            return ["UNPARSEABLE_STRUCTURE"]


def backend_name() -> str:
    name = os.environ.get("EVIDENCE_PDF_BACKEND", "pymupdf").lower()
    return name if name in ("pymupdf", "pdfium") else "pymupdf"


def open_document(path: str, name: Optional[str] = None):
    name = name or backend_name()
    if name == "pdfium":
        return PdfiumDocument(path)
    return PymupdfDocument(path)


def version_info(name: Optional[str] = None) -> Dict[str, Optional[str]]:
    name = name or backend_name()
    if name == "pdfium":
        try:
            import pypdf
            import pypdfium2

            return {"backend": "pdfium (experimental)", "pypdfium2": pypdfium2.version.PYPDFIUM_INFO.version if hasattr(pypdfium2, "version") else None, "pypdf": pypdf.__version__}
        except ImportError:
            return {"backend": "pdfium (unavailable)"}
    import fitz

    return {"backend": "pymupdf", "pymupdf": fitz.VersionBind}
