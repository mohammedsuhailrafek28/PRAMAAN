"""Bank-statement transaction table reconstruction from positioned segments (works for embedded text and OCR alike).

Column roles come from the header row; rows start at a date; continuation lines extend the description; every row is
checked against the running balance, which is the validation evidence behind a row's confidence.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Dict, List, Optional

from .layout import Line, Segment

ROLE_WORDS = {
    "date": [r"^(txn\.?|transaction|tran|post(ing)?|value)?\s*date$", r"^date$", r"^dt$"],
    "value_date": [r"^value\s*(date|dt)$"],
    "description": [r"^(narration|description|particulars|details|transaction (details|remarks)|remarks)$"],
    "reference": [r"^(chq\.?|cheque|ref\.?|reference|utr)(\s*(no\.?|number|/ref\.? no\.?))?([/ ].*)?$"],
    "debit": [r"^(debit|withdrawals?|withdrawal amt\.?|dr\.?|debits?)(\s*(amount|amt\.?))?$"],
    "credit": [r"^(credit|deposits?|deposit amt\.?|cr\.?|credits?)(\s*(amount|amt\.?))?$"],
    "balance": [r"^(closing\s*)?balance(\s*\(inr\))?$", r"^bal\.?$"],
    "amount": [r"^amount(\s*\(inr\))?$"],
}
NUMERIC_ROLES = {"debit", "credit", "balance", "amount"}

DATE_PATTERNS = [
    (re.compile(r"^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$"), "dmy"),
    (re.compile(r"^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$"), "dmy2"),
    (re.compile(r"^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$"), "ymd"),
    (re.compile(r"^(\d{1,2})[ \-]([A-Za-z]{3})[a-z]*[ \-,]*(\d{2,4})$"), "dMy"),
]
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
AMOUNT = re.compile(r"^\(?-?[\d,]+(\.\d{1,2})?\)?(\s*(cr|dr)\.?)?$", re.I)
STOP = re.compile(r"(closing balance|total|statement summary|end of statement|page \d+ of \d+|this is a computer generated)", re.I)


def parse_date(text: str) -> Optional[str]:
    text = text.strip()
    for pattern, kind in DATE_PATTERNS:
        match = pattern.match(text)
        if not match:
            continue
        try:
            if kind == "dmy":
                day, month, year = int(match[1]), int(match[2]), int(match[3])
            elif kind == "dmy2":
                day, month, year = int(match[1]), int(match[2]), 2000 + int(match[3])
            elif kind == "ymd":
                year, month, day = int(match[1]), int(match[2]), int(match[3])
            else:
                day, month, year = int(match[1]), MONTHS.get(match[2].lower()[:3], 0), int(match[3])
                year = year + 2000 if year < 100 else year
            return date(year, month, day).isoformat()
        except ValueError:
            return None
    return None


def parse_amount(text: str) -> Optional[tuple[float, Optional[str]]]:
    cleaned = text.strip().replace("₹", "").replace("Rs.", "").replace("INR", "").strip()
    if not cleaned or not AMOUNT.match(cleaned):
        return None
    suffix = None
    suffix_match = re.search(r"(cr|dr)\.?$", cleaned, re.I)
    if suffix_match:
        suffix = suffix_match.group(1).lower()
        cleaned = cleaned[: suffix_match.start()].strip()
    negative = cleaned.startswith("(") or cleaned.startswith("-")
    digits = cleaned.strip("()-").replace(",", "")
    try:
        value = float(digits)
    except ValueError:
        return None
    return (-value if negative else value, suffix)


def _role_of(text: str) -> Optional[str]:
    normalized = re.sub(r"\s+", " ", text.strip().lower().rstrip(":"))
    for role, patterns in ROLE_WORDS.items():
        if any(re.match(p, normalized) for p in patterns):
            return role
    return None



_DATE_TOKEN = r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}"
_ROW_START = re.compile(rf"^({_DATE_TOKEN})(?:\s*({_DATE_TOKEN}))?(?=\s*[A-Za-z0-9])\s*(.*)$")
_HEADER_RUN = re.compile(r"^(?P<d>txn\.?\s*date|transaction\s*date|post(?:ing)?\s*date|date)\s*(?P<v>value\s*date)?\s*(?P<x>description|narration|particulars|details|remarks)$", re.I)


def _slice(segment: Segment, start: int, end: int, text: str) -> Segment:
    """A piece of a segment whose characters were run together; its box is the proportional share of the original."""
    total = max(len(segment.text), 1)
    width = segment.bbox[2] - segment.bbox[0]
    return Segment(text=text, bbox=[segment.bbox[0] + width * start / total, segment.bbox[1], segment.bbox[0] + width * end / total, segment.bbox[3]], conf=segment.conf, method=segment.method)


def _explode_header(segments: List[Segment]) -> List[Segment]:
    """Fixed-width statements can run header words together ("Txn Date Value DateDescription"): split them by role."""
    out: List[Segment] = []
    for segment in segments:
        match = _HEADER_RUN.match(segment.text.strip())
        if not match:
            out.append(segment)
            continue
        for name in ("d", "v", "x"):
            if match.group(name):
                out.append(_slice(segment, match.start(name), match.end(name), match.group(name)))
    return out


def _explode_row(segments: List[Segment]) -> List[Segment]:
    """Splits "02/04/202602/04/2026NARRATION" into date, value date and narration when a row's first cells run together."""
    if not segments:
        return segments
    first = segments[0]
    match = _ROW_START.match(first.text.strip())
    if not match or (match.group(2) is None and not match.group(3)) or parse_date(match.group(1)) is None:
        return segments
    if match.group(2) is None and first.text.strip().startswith(match.group(1) + " "):
        return segments  # already separated by a space; ordinary layout handles it
    pieces = [_slice(first, match.start(1), match.end(1), match.group(1))]
    if match.group(2):
        pieces.append(_slice(first, match.start(2), match.end(2), match.group(2)))
    if match.group(3):
        pieces.append(_slice(first, match.start(3), match.end(3), match.group(3)))
    return pieces + segments[1:]


def find_header(lines: List[Line], start: int = 0) -> Optional[int]:
    for index in range(start, len(lines)):
        roles = {_role_of(segment.text) for segment in _explode_header(lines[index].segments)} - {None}
        if "date" in roles and len(roles) >= 3 and ("balance" in roles or "amount" in roles):
            return index
    return None


def _columns_from_header(lines: List[Line], index: int) -> Dict[str, List[float]]:
    columns: Dict[str, List[float]] = {}
    candidates = _explode_header(list(lines[index].segments))
    # Two-line headers ("Withdrawal" over "Amt."): fold in a directly following line that has no date/amount content.
    if index + 1 < len(lines):
        nxt = lines[index + 1]
        if nxt.bbox[1] - lines[index].bbox[3] < 12 and all(parse_date(s.text) is None and parse_amount(s.text) is None for s in nxt.segments):
            for lower in nxt.segments:
                for upper in candidates:
                    if abs((lower.bbox[0] + lower.bbox[2]) / 2 - (upper.bbox[0] + upper.bbox[2]) / 2) < 40:
                        upper.text = f"{upper.text} {lower.text}"
                        upper.bbox = [min(upper.bbox[0], lower.bbox[0]), upper.bbox[1], max(upper.bbox[2], lower.bbox[2]), lower.bbox[3]]
    for segment in candidates:
        role = _role_of(segment.text)
        if role and role not in columns:
            columns[role] = segment.bbox
    return columns


def _assign(segment: Segment, columns: Dict[str, List[float]]) -> Optional[str]:
    center = (segment.bbox[0] + segment.bbox[2]) / 2
    best, best_distance = None, 1e9
    numeric_like = parse_amount(segment.text) is not None
    for role, box in columns.items():
        if numeric_like and role not in NUMERIC_ROLES and role != "reference":
            continue
        if not numeric_like and role in NUMERIC_ROLES:
            continue
        distance = min(abs(center - (box[0] + box[2]) / 2), abs(segment.bbox[2] - box[2]) + 3, abs(segment.bbox[0] - box[0]) + 3)
        if distance < best_distance:
            best, best_distance = role, distance
    return best if best_distance < 70 else None


def _amounts_only_row(cells: Dict[str, List[Segment]], running: Optional[float], page_number: int, line: Line, segments: List[Segment]) -> Optional[dict]:
    if running is None or not cells.get("balance"):
        return None
    amounts = {}
    for role in ("debit", "credit", "balance"):
        if cells.get(role):
            parsed = parse_amount(cells[role][0].text)
            if parsed is None:
                return None
            amounts[role] = abs(parsed[0]) if role != "balance" else parsed[0]
    if "balance" not in amounts or (("debit" in amounts) == ("credit" in amounts)):
        return None
    if abs(running + amounts.get("credit", 0.0) - amounts.get("debit", 0.0) - amounts["balance"]) >= 0.015:
        return None
    return {"page": page_number, "date": None, "description": "", "reference": None, "debit": amounts.get("debit"), "credit": amounts.get("credit"), "balance": amounts["balance"],
            "bbox": [round(v, 1) for v in line.bbox], "method": "OCR" if any(s.method.startswith("OCR") for s in segments) else "EMBEDDED_TEXT", "_confs": [s.conf for s in segments]}


def extract_bank_table(pages: List[List[Line]]) -> Optional[dict]:
    columns: Optional[Dict[str, List[float]]] = None
    rows: List[dict] = []
    opening: Optional[float] = None
    header_pages: List[int] = []
    for page_number, lines in enumerate(pages, start=1):
        cursor = 0
        header = find_header(lines)
        if header is not None:
            columns = _columns_from_header(lines, header)
            header_pages.append(page_number)
            cursor = header + 1
        if columns is None or "date" not in columns:
            continue
        current: Optional[dict] = None
        for line in lines[cursor:]:
            segments = _explode_row(list(line.segments))
            texts = " ".join(s.text for s in segments)
            if STOP.search(texts) and not any(parse_date(s.text) for s in segments):
                current = None
                continue
            cells: Dict[str, List[Segment]] = {}
            for segment in segments:
                role = _assign(segment, columns)
                if role is None and parse_date(segment.text) is not None:
                    role = "date"
                if role:
                    cells.setdefault(role, []).append(segment)
            date_segment = next((s for s in cells.get("date", []) if parse_date(s.text)), None)
            if date_segment is None:
                balance_only = cells.get("balance") and not cells.get("debit") and not cells.get("credit") and re.search(r"opening", texts, re.I)
                if balance_only and opening is None:
                    parsed = parse_amount(cells["balance"][0].text)
                    opening = parsed[0] if parsed else None
                elif current is not None and cells.get("description") and not any(cells.get(r) for r in ("debit", "credit", "balance", "amount")):
                    current["description"] = (current["description"] + " " + " ".join(s.text for s in cells["description"])).strip()
                    current["_confs"].append(min(s.conf for s in cells["description"]))
                else:
                    # OCR sometimes drops the left-hand cells of a row. Amounts alone are accepted ONLY when they continue the
                    # running balance exactly; the row then carries no date and no narration (nothing is inferred).
                    recovered = _amounts_only_row(cells, rows[-1]["balance"] if rows else opening, page_number, line, segments)
                    if recovered is not None:
                        rows.append(recovered)
                        current = recovered
                continue
            row = {"page": page_number, "date": parse_date(date_segment.text), "description": " ".join(s.text for s in cells.get("description", [])).strip(),
                   "reference": " ".join(s.text for s in cells.get("reference", [])).strip() or None, "debit": None, "credit": None, "balance": None,
                   "bbox": [round(v, 1) for v in line.bbox], "method": "OCR" if any(s.method.startswith("OCR") for s in segments) else "EMBEDDED_TEXT",
                   "_confs": [s.conf for s in segments]}
            for role in ("debit", "credit", "balance", "amount"):
                if cells.get(role):
                    parsed = parse_amount(cells[role][0].text)
                    if parsed is not None:
                        amount, suffix = parsed
                        if role == "amount":
                            role = "credit" if suffix == "cr" else "debit"
                        row[role] = abs(amount) if role != "balance" else amount
            if row["debit"] is None and row["credit"] is None and row["balance"] is None:
                continue
            rows.append(row)
            current = row
    if not rows:
        return None
    checked = consistent = 0
    previous = opening
    for row in rows:
        row["balanceCheck"] = "NOT_APPLICABLE"
        if row["balance"] is not None and previous is not None and (row["debit"] is not None) != (row["credit"] is not None):
            expected = previous + (row["credit"] or 0) - (row["debit"] or 0)
            ok = abs(expected - row["balance"]) < 0.015
            row["balanceCheck"] = "PASSED" if ok else "FAILED"
            checked += 1
            consistent += 1 if ok else 0
        if row["balance"] is not None:
            previous = row["balance"]
        confs = row.pop("_confs")
        ocr_factor = min(1.0, 0.5 + min(confs) / 2) if row["method"] == "OCR" and confs else 1.0
        base = 0.0
        base += 0.25 if row["date"] else 0
        base += 0.25 if (row["debit"] is None) != (row["credit"] is None) else 0
        base += 0.10 if row["balance"] is not None else 0
        base += {"PASSED": 0.40, "NOT_APPLICABLE": 0.20, "FAILED": 0.0}[row["balanceCheck"]]
        row["confidence"] = round(min(base, 1.0) * ocr_factor, 2)
    return {
        "kind": "BANK_TRANSACTIONS",
        "columns": sorted(columns.keys()) if columns else [],
        "headerPages": header_pages,
        "openingBalance": opening,
        "rows": rows[:2000],
        "rowCount": len(rows),
        "balanceChecked": checked,
        "balanceConsistent": consistent,
        "reliable": checked >= 3 and consistent / checked >= 0.8,
    }
