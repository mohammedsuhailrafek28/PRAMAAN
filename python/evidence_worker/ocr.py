"""OCR adapter. RapidOCR (ONNX Runtime, models bundled in the wheel) runs fully offline; no model is downloaded at runtime.

Only this adapter knows the engine. Tesseract could be added behind the same `recognize` shape; it is not implemented
here because no Tesseract binary is available in the reference environment and untested code is not shipped.
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

import numpy as np

_engine = None
ENGINE_NAME = "rapidocr-onnxruntime"


def engine_version() -> Optional[str]:
    try:
        import importlib.metadata as metadata

        return f"{ENGINE_NAME} {metadata.version(ENGINE_NAME)}"
    except Exception:
        return None


def available() -> bool:
    try:
        import rapidocr_onnxruntime  # noqa: F401

        return True
    except Exception:
        return False


_last_cls: list = []


def _get_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _engine = RapidOCR()
        original = _engine.text_cls

        def recording(crops):
            result = original(crops)
            _last_cls[:] = result[1] or []
            return result

        _engine.text_cls = recording  # remembers the per-line 0/180 decisions of the last call
    return _engine


def upside_down_fraction() -> float:
    """Share of the last call's text lines the line classifier judged to be rotated 180 degrees."""
    if not _last_cls:
        return 0.0
    return sum(1 for label, _score in _last_cls if str(label) == "180") / len(_last_cls)


Box = Tuple[float, float, float, float, str, float]  # x0, y0, x1, y1, text, confidence (pixels)


def recognize(image: np.ndarray) -> List[Box]:
    result, _ = _get_engine()(image)
    boxes: List[Box] = []
    for points, text, score in result or []:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        text = str(text).strip()
        if text:
            boxes.append((min(xs), min(ys), max(xs), max(ys), text, float(score)))
    return boxes


def _quality(boxes: List[Box]) -> float:
    return sum(len(re.sub(r"[^A-Za-z0-9]", "", box[4])) * box[5] for box in boxes)


def _tall_fraction(boxes: List[Box]) -> float:
    if not boxes:
        return 0.0
    return sum(1 for b in boxes if (b[3] - b[1]) > 1.5 * (b[2] - b[0])) / len(boxes)


def _score(boxes: List[Box]) -> float:
    """Text quality discounted by the share of tall boxes: upright pages produce mostly wide boxes."""
    return _quality(boxes) * (1.0 - _tall_fraction(boxes)) ** 2


def _thumbnail(image: np.ndarray, long_side: int = 1100) -> np.ndarray:
    height, width = image.shape[:2]
    factor = long_side / max(height, width)
    if factor >= 1:
        return image
    step = max(int(round(1 / factor)), 1)
    return np.ascontiguousarray(image[::step, ::step])


def oriented_recognition(image: np.ndarray) -> Tuple[List[Box], int, np.ndarray, List[int]]:
    """OCR with orientation recovery.

    The page is OCR'd as given. Only when the result looks wrong (few boxes, low confidence or mostly tall boxes) are the
    other orientations compared, on a downscaled copy, and the page is then OCR'd once more at full size in the winner.
    Returns boxes, the clockwise rotation applied (degrees), the upright image, and the rotations tried.
    """
    global _rotation_hint
    tried = [0]
    if _rotation_hint:
        # Pages of one scan are almost always scanned the same way up: try the rotation found on the previous page first.
        k = {270: 1, 90: 3, 180: 2}[_rotation_hint]
        hinted_image = np.ascontiguousarray(np.rot90(image, k))
        hinted = recognize(hinted_image)
        hinted_conf = sum(b[5] for b in hinted) / len(hinted) if hinted else 0.0
        if len(hinted) >= 4 and hinted_conf >= 0.75 and _tall_fraction(hinted) <= 0.4 and upside_down_fraction() < 0.4:
            return hinted, _rotation_hint, hinted_image, [_rotation_hint]
    result = _oriented(image, tried)
    _rotation_hint = result[1] if result[1] in (90, 180, 270) else 0
    return result


_rotation_hint = 0


def _oriented(image: np.ndarray, tried: List[int]) -> Tuple[List[Box], int, np.ndarray, List[int]]:
    height, width = image.shape[:2]
    # A landscape raster of a portrait document is almost certainly a quarter-turned page: skip the (wasted) full-size pass
    # in the given orientation and compare orientations on a thumbnail straight away.
    boxes = [] if width > 1.15 * height else recognize(image)
    mean_conf = sum(b[5] for b in boxes) / len(boxes) if boxes else 0.0
    if len(boxes) >= 4 and mean_conf >= 0.75 and _tall_fraction(boxes) <= 0.4:
        if upside_down_fraction() >= 0.6:
            flipped = np.ascontiguousarray(np.rot90(image, 2))
            tried.append(180)
            again = recognize(flipped)
            if _quality(again) >= _quality(boxes) * 0.8 and upside_down_fraction() < 0.4:
                return again, 180, flipped, tried
        return boxes, 0, image, tried
    small = _thumbnail(image)
    candidates = {0: _score(recognize(small))}
    for k, angle in ((1, 270), (3, 90), (2, 180)):
        candidates[angle] = _score(recognize(np.ascontiguousarray(np.rot90(small, k))))
        tried.append(angle)
    best = max(candidates, key=candidates.get)
    if best == 0 or candidates[best] <= candidates[0] * 1.15:
        return boxes or recognize(image), 0, image, tried
    k = {270: 1, 90: 3, 180: 2}[best]
    rotated = np.ascontiguousarray(np.rot90(image, k))
    result = recognize(rotated)
    if upside_down_fraction() >= 0.6:
        # The quarter turn went the wrong way round: the page is upright after a further half turn.
        flipped = np.ascontiguousarray(np.rot90(rotated, 2))
        again = recognize(flipped)
        if upside_down_fraction() < 0.4:
            tried.append((best + 180) % 360)
            return again, (best + 180) % 360, flipped, tried
    return result, best, rotated, tried
