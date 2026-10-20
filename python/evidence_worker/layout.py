"""Reading-order reconstruction: text items -> lines -> segments (gap-separated cells), with simple multi-column detection.

All coordinates are in points in the page's upright frame. An *item* is a word (embedded text) or a detected text box
(OCR); both carry a bounding box, text, a method and a confidence.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class Item:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    method: str
    conf: float

    @property
    def yc(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def h(self) -> float:
        return max(self.y1 - self.y0, 0.1)


@dataclass
class Segment:
    text: str
    bbox: List[float]
    conf: float
    method: str


@dataclass
class Line:
    segments: List[Segment] = field(default_factory=list)
    bbox: List[float] = field(default_factory=lambda: [0, 0, 0, 0])
    column: int = 0

    @property
    def text(self) -> str:
        return "  ".join(segment.text for segment in self.segments)


def build_lines(items: List[Item]) -> List[Line]:
    items = [item for item in items if item.text.strip()]
    if not items:
        return []
    median_h = statistics.median(item.h for item in items)
    tolerance = max(median_h * 0.55, 2.0)
    rows: List[List[Item]] = []
    for item in sorted(items, key=lambda i: (i.yc, i.x0)):
        placed = False
        for row in reversed(rows[-6:]):
            row_yc = statistics.fmean(member.yc for member in row)
            if abs(item.yc - row_yc) <= tolerance:
                row.append(item)
                placed = True
                break
        if not placed:
            rows.append([item])
    lines: List[Line] = []
    for row in rows:
        row.sort(key=lambda i: i.x0)
        height = statistics.median(member.h for member in row)
        gap_limit = max(height * 1.1, 5.0)
        segments: List[List[Item]] = []
        for member in row:
            if segments and member.x0 - segments[-1][-1].x1 <= gap_limit:
                segments[-1].append(member)
            else:
                segments.append([member])
        line = Line()
        for group in segments:
            method = "OCR" if any(member.method.startswith("OCR") for member in group) else "EMBEDDED_TEXT"
            if len({member.method for member in group}) > 1:
                method = "MIXED"
            text = " ".join(member.text.strip() for member in group)
            weight = sum(max(len(member.text), 1) for member in group)
            conf = sum(member.conf * max(len(member.text), 1) for member in group) / weight
            line.segments.append(Segment(text=text, bbox=[round(min(m.x0 for m in group), 1), round(min(m.y0 for m in group), 1), round(max(m.x1 for m in group), 1), round(max(m.y1 for m in group), 1)], conf=round(conf, 3), method=method))
        line.bbox = [min(s.bbox[0] for s in line.segments), min(s.bbox[1] for s in line.segments), max(s.bbox[2] for s in line.segments), max(s.bbox[3] for s in line.segments)]
        lines.append(line)
    lines.sort(key=lambda l: (round(l.bbox[1] / 2), l.bbox[0]))
    return lines


def detect_columns(lines: List[Line], page_width: float) -> Optional[float]:
    """Returns the x position of a gutter when the page holds two independent flowing text columns, else None.

    Key/value forms also have a vertical gap, but their left and right cells sit on the same rows. Flowing columns are
    recognised by long lines on both sides whose vertical positions do not line up row for row.
    """
    if len(lines) < 12 or page_width <= 0:
        return None
    bins = 120
    step = page_width / bins
    occupancy = [0] * bins
    for line in lines:
        for segment in line.segments:
            for b in range(max(int(segment.bbox[0] / step), 0), min(int(segment.bbox[2] / step) + 1, bins)):
                occupancy[b] += 1
    lo, hi = int(bins * 0.3), int(bins * 0.7)
    gutter_bin = min(range(lo, hi), key=lambda b: occupancy[b])
    if occupancy[gutter_bin] > max(1, len(lines) * 0.05):
        return None
    x = (gutter_bin + 0.5) * step
    left = [l for l in lines if l.bbox[2] <= x + 2 and (l.bbox[2] - l.bbox[0]) >= page_width * 0.25]
    right = [l for l in lines if l.bbox[0] >= x - 2 and (l.bbox[2] - l.bbox[0]) >= page_width * 0.25]
    if len(left) < 5 or len(right) < 5:
        return None
    left_rows = {round(l.bbox[1] / 3) for l in left}
    right_rows = {round(l.bbox[1] / 3) for l in right}
    aligned = len(left_rows & right_rows) / max(min(len(left_rows), len(right_rows)), 1)
    return x if aligned < 0.5 else None


def order_lines(lines: List[Line], page_width: float) -> tuple[List[Line], int]:
    gutter = detect_columns(lines, page_width)
    if gutter is None:
        for line in lines:
            line.column = 0
        return lines, 1
    left: List[Line] = []
    right: List[Line] = []
    spanning: List[Line] = []
    for line in lines:
        if line.bbox[2] <= gutter + 2:
            line.column = 0
            left.append(line)
        elif line.bbox[0] >= gutter - 2:
            line.column = 1
            right.append(line)
        else:
            line.column = 0
            spanning.append(line)
    # Spanning lines (titles, footers) keep their vertical place; each column then reads top to bottom.
    top = [l for l in spanning if l.bbox[1] < (min(l2.bbox[1] for l2 in left + right) if left + right else 0)]
    bottom = [l for l in spanning if l not in top]
    return top + left + right + bottom, 2
