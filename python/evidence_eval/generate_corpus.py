"""Deterministic, privacy-safe evaluation corpus for the document-understanding pipeline.

Everything here is FICTIONAL. Identifiers are generated (valid GSTIN check character, valid PAN/Udyam/IFSC shapes), company
names are invented, and no real person's or business's document is used. Layouts are modelled on the *kinds* of
documents Indian MSMEs hold (GST registration certificate, Udyam certificate, bank statement) from general knowledge of
their typical structure, NOT copied from any real issued document, so results here say nothing about real-document accuracy.

    python -m evidence_eval.generate_corpus --out <dir> [--seed 7]

Writes PDFs plus manifest.json with ground truth (fields, transaction rows, text lines) for each case.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import random
import shutil
import zlib
from datetime import date, timedelta
from pathlib import Path

import fitz
import numpy as np
from PIL import Image, ImageFilter
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

W, H = A4
ALPHA = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"

FIRST = ["Sunrise", "Moonrise", "Kaveri", "Narmada", "Himalaya", "Lotus", "Banyan", "Mangal", "Surya", "Tulsi", "Ganga", "Vikram", "Shree", "Anand", "Prakash"]
SECOND = ["Textiles", "Traders", "Engineering Works", "Foods", "Plastics", "Agro Products", "Logistics", "Fabricators", "Packaging", "Precision Tools"]
SUFFIX = ["Private Limited", "Pvt Ltd", "LLP", "& Sons", "Enterprises"]
BANKS = [("HDFC Bank", "HDFC"), ("State Bank of India", "SBIN"), ("ICICI Bank", "ICIC"), ("Axis Bank", "UTIB"), ("Kotak Mahindra Bank", "KKBK"), ("Bank of Baroda", "BARB")]
STATES = [("27", "MH"), ("29", "KA"), ("33", "TN"), ("24", "GJ"), ("07", "DL"), ("19", "WB")]
MERCHANTS = ["SWIGGY", "AMAZON PAY", "IRCTC", "RELIANCE JIO", "TATA POWER", "BLUE DART", "GST PAYMENT", "SALARY", "VENDOR PAYMENT", "CASH DEPOSIT", "NEFT", "RTGS", "IMPS", "ATM WDL", "CHEQUE DEP", "UPI"]


def gstin_checksum(body14: str) -> str:
    total = 0
    for index, ch in enumerate(body14):
        product = ALPHA.index(ch) * (1 if index % 2 == 0 else 2)
        total += product // 36 + product % 36
    return ALPHA[(36 - total % 36) % 36]


def make_entity(rng: random.Random, index: int) -> dict:
    state_code, state_abbr = STATES[rng.randrange(len(STATES))]
    pan = "".join(rng.choice(LETTERS) for _ in range(3)) + "C" + rng.choice(LETTERS) + "".join(str(rng.randrange(10)) for _ in range(4)) + rng.choice(LETTERS)
    body = f"{state_code}{pan}{rng.randrange(1, 5)}Z"
    gstin = body + gstin_checksum(body)
    name = f"{rng.choice(FIRST)} {rng.choice(SECOND)} {rng.choice(SUFFIX)}"
    bank_name, ifsc4 = rng.choice(BANKS)
    account = "".join(str(rng.randrange(10)) for _ in range(rng.choice([11, 12, 14, 16])))
    return {
        "index": index, "legalName": name, "tradeName": f"{name.split()[0]} {name.split()[1]}", "gstin": gstin, "pan": pan,
        "udyamNumber": f"UDYAM-{state_abbr}-{rng.randrange(10, 40):02d}-{rng.randrange(1000000):07d}", "enterpriseType": rng.choice(["Micro", "Small", "Medium"]),
        "bankName": bank_name, "ifsc": f"{ifsc4}0{rng.randrange(1000000):06d}", "account": account, "accountMasked": "X" * (len(account) - 4) + account[-4:],
        "address": f"Plot {rng.randrange(1, 90)}, Industrial Estate, {rng.choice(['Pune', 'Bengaluru', 'Chennai', 'Surat', 'Kolkata', 'Delhi'])}",
        "registrationDate": (date(2019, 1, 1) + timedelta(days=rng.randrange(1800))).strftime("%d/%m/%Y"),
    }


# ---------------------------------------------------------------------------------------------------------------- fonts
def register_fonts() -> dict:
    fonts = {"helvetica": ("Helvetica", "Helvetica-Bold"), "times": ("Times-Roman", "Times-Bold"), "courier": ("Courier", "Courier-Bold")}
    windows = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    for key, regular, bold in (("arial", "arial.ttf", "arialbd.ttf"), ("calibri", "calibri.ttf", "calibrib.ttf"), ("verdana", "verdana.ttf", "verdanab.ttf"), ("consolas", "consola.ttf", "consolab.ttf")):
        try:
            pdfmetrics.registerFont(TTFont(f"{key}-r", str(windows / regular)))
            pdfmetrics.registerFont(TTFont(f"{key}-b", str(windows / bold)))
            fonts[key] = (f"{key}-r", f"{key}-b")
        except Exception:
            continue
    return fonts


class Pen:
    """Draws text and records exactly what was drawn, page by page, as the line-level ground truth."""

    def __init__(self, c: canvas.Canvas, font: tuple[str, str]):
        self.c, self.font, self.page_lines, self.cur = c, font, [], []

    def text(self, x, y, s, size=10, bold=False, align="left"):
        self.c.setFont(self.font[1] if bold else self.font[0], size)
        {"left": self.c.drawString, "right": self.c.drawRightString, "center": self.c.drawCentredString}[align](x, y, s)
        self.cur.append(s)

    def line(self, x0, y0, x1, y1):
        self.c.line(x0, y0, x1, y1)

    def new_page(self):
        self.c.showPage()
        self.page_lines.append(self.cur)
        self.cur = []

    def finish(self):
        self.page_lines.append(self.cur)
        self.c.save()


# ---------------------------------------------------------------------------------------------------------------- documents
def draw_gst(pen: Pen, e: dict, layout: str):
    pen.text(W / 2, 800, "Government of India", 12, True, "center")
    pen.text(W / 2, 782, "Form GST REG-06", 11, True, "center")
    pen.text(W / 2, 766, "Registration Certificate", 11, False, "center")
    if layout == "numbered":
        pen.text(60, 730, f"Registration Number : {e['gstin']}", 11, True)
        rows = [("1.", "Legal Name", e["legalName"]), ("2.", "Trade Name, if any", e["tradeName"]), ("3.", "Constitution of Business", "Private Limited Company"),
                ("4.", "Address of Principal Place of Business", e["address"]), ("5.", "Date of Liability", e["registrationDate"]), ("6.", "Type of Registration", "Regular")]
        y = 690
        for number, label, value in rows:
            pen.text(60, y, f"{number} {label}", 10)
            pen.text(300, y, value, 10, True)
            pen.line(55, y - 6, 540, y - 6)
            y -= 32
        pen.text(60, y - 10, f"Permanent Account Number (PAN) : {e['pan']}", 10)
    elif layout == "stacked":
        y = 720
        for label, value in (("Registration Number (GSTIN)", e["gstin"]), ("Legal Name", e["legalName"]), ("Trade Name", e["tradeName"]), ("PAN", e["pan"]), ("Date of Registration", e["registrationDate"])):
            pen.text(60, y, label, 8)
            pen.text(60, y - 15, value, 12, True)
            y -= 48
    elif layout == "two_column":
        # Left column holds a flowing notice; the facts sit in the right column under their labels.
        notice = ["This certificate is issued under the Goods and Services Tax Act.", "It must be displayed at the principal place of business and at every", "additional place of business.", "The registration is subject to the conditions of the Act.",
                  "Any change in the particulars must be intimated to the", "proper officer within the prescribed period.", "This is a system generated document."] * 2
        y = 730
        for sentence in notice:
            pen.text(50, y, sentence, 8)
            y -= 14
        y = 730
        for label, value in (("GSTIN/UIN", e["gstin"]), ("Legal Name of Business", e["legalName"]), ("PAN", e["pan"]), ("Constitution", "Private Limited Company")):
            pen.text(330, y, label, 8)
            pen.text(330, y - 14, value, 11, True)
            y -= 50
    else:  # "inline"
        y = 720
        for label, value in (("GSTIN", e["gstin"]), ("Legal Name", e["legalName"]), ("PAN", e["pan"]), ("Date of Registration", e["registrationDate"])):
            pen.text(60, y, f"{label} : {value}", 11)
            y -= 26


def draw_udyam(pen: Pen, e: dict, layout: str):
    pen.text(W / 2, 800, "Ministry of Micro, Small and Medium Enterprises", 12, True, "center")
    pen.text(W / 2, 780, "UDYAM REGISTRATION CERTIFICATE", 13, True, "center")
    if layout == "inline":
        y = 730
        for label, value in (("Udyam Registration Number", e["udyamNumber"]), ("Name of Enterprise", e["legalName"]), ("Type of Enterprise", e["enterpriseType"]),
                             ("Major Activity", "Manufacturing"), ("Date of Udyam Registration", e["registrationDate"])):
            pen.text(60, y, f"{label} : {value}", 11)
            y -= 28
    elif layout == "table":
        y = 730
        for label, value in (("UDYAM REGISTRATION NUMBER", e["udyamNumber"]), ("NAME OF ENTERPRISE", e["legalName"]), ("TYPE OF ENTERPRISE", e["enterpriseType"]),
                             ("DATE OF UDYAM REGISTRATION", e["registrationDate"])):
            pen.text(60, y, label, 9, True)
            pen.text(280, y, value, 10)
            pen.line(55, y - 8, 540, y - 8)
            y -= 34
    else:  # stacked, two blocks side by side
        pen.text(60, 730, "UDYAM REGISTRATION NUMBER", 8)
        pen.text(60, 714, e["udyamNumber"], 12, True)
        pen.text(60, 670, "NAME OF ENTERPRISE", 8)
        pen.text(60, 654, e["legalName"], 12, True)
        pen.text(330, 730, "TYPE OF ENTERPRISE", 8)
        pen.text(330, 714, e["enterpriseType"], 11, True)
        pen.text(330, 670, "DATE OF UDYAM REGISTRATION", 8)
        pen.text(330, 654, e["registrationDate"], 11, True)


def inr(value: float) -> str:
    whole, frac = f"{value:.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{whole}.{frac}"


def make_transactions(rng: random.Random, count: int, start: date) -> tuple[float, list[dict]]:
    opening = round(rng.uniform(50_000, 900_000), 2)
    balance, rows, day = opening, [], start
    for _ in range(count):
        day += timedelta(days=rng.choice([0, 0, 1, 1, 2, 3]))
        merchant = rng.choice(MERCHANTS)
        ref = "".join(str(rng.randrange(10)) for _ in range(rng.choice([6, 10, 12])))
        narration = f"{merchant}/{ref}/{rng.choice(['okhdfcbank', 'oksbi', 'paytm', 'ybl'])}" if merchant == "UPI" else f"{merchant} {ref}"
        if rng.random() < 0.3:
            narration += " " + rng.choice(["INVOICE PAYMENT FOR RAW MATERIAL SUPPLY", "MONTHLY SERVICE CHARGES", "ADVANCE AGAINST ORDER"])
        credit = rng.random() < 0.42
        amount = round(rng.uniform(150, 150_000), 2)
        if not credit and amount > balance:
            amount = round(balance * rng.uniform(0.05, 0.5), 2)
        balance = round(balance + amount if credit else balance - amount, 2)
        rows.append({"date": day.isoformat(), "description": narration, "reference": ref, "debit": None if credit else amount, "credit": amount if credit else None, "balance": balance})
    return opening, rows


def wrap(text: str, width: int) -> list[str]:
    words, lines, current = text.split(), [], ""
    for word in words:
        if len(current) + len(word) + 1 > width and current:
            lines.append(current)
            current = word
        else:
            current = f"{current} {word}".strip()
    return lines + ([current] if current else [])


def draw_bank(pen: Pen, e: dict, layout: str, rng: random.Random, pages: int, truth_rows: list, meta: dict):
    start = date(2026, 4, 1)
    rows_per_page = 28
    opening, txs = make_transactions(rng, rows_per_page * pages - rng.randrange(0, 6), start)
    period_from, period_to = start, date.fromisoformat(txs[-1]["date"])
    meta["statementPeriod"] = f"{period_from.isoformat()}/{period_to.isoformat()}"
    meta["openingBalance"] = opening
    account_text = e["accountMasked"] if layout == "withdrawals" else e["account"]

    def header(first: bool, page_no: int):
        pen.text(50, 810, e["bankName"].upper(), 15, True)
        if first:
            pen.text(50, 788, "Statement of Account", 11, True)
            pen.text(50, 770, f"Account Holder : {e['legalName']}", 10)
            pen.text(50, 756, f"Account Number : {account_text}", 10)
            pen.text(50, 742, f"IFSC Code : {e['ifsc']}", 10)
            pen.text(330, 770, f"Statement Period : {period_from.strftime('%d/%m/%Y')} to {period_to.strftime('%d/%m/%Y')}", 9)
            pen.text(330, 756, f"Branch : {rng.choice(['Fort', 'Koramangala', 'T Nagar', 'Adajan'])}", 9)
        pen.text(W - 50, 30, f"Page {page_no} of {pages}", 8, False, "right")

    if layout == "debit_credit":
        cols = {"date": 50, "description": 105, "reference": 300, "debit": 410, "credit": 475, "balance": 545}
        heads = [("Date", "date", "left"), ("Narration", "description", "left"), ("Chq/Ref No.", "reference", "left"), ("Debit", "debit", "right"), ("Credit", "credit", "right"), ("Balance", "balance", "right")]
    elif layout == "withdrawals":
        cols = {"date": 50, "value": 100, "description": 150, "debit": 400, "credit": 470, "balance": 545}
        heads = [("Txn Date", "date", "left"), ("Value Date", "value", "left"), ("Description", "description", "left"), ("Withdrawals", "debit", "right"), ("Deposits", "credit", "right"), ("Balance", "balance", "right")]
    else:  # amount with Dr/Cr suffix
        cols = {"date": 50, "description": 120, "amount": 470, "balance": 545}
        heads = [("Date", "date", "left"), ("Particulars", "description", "left"), ("Amount", "amount", "right"), ("Balance", "balance", "right")]

    index = 0
    for page in range(pages):
        header(page == 0, page + 1)
        y = 715 if page == 0 else 780
        if page == 0 or layout != "withdrawals":  # one layout prints its header only on the first page
            for label, key, align in heads:
                pen.text(cols[key], y, label, 9, True, align)
            pen.line(48, y - 5, 548, y - 5)
            y -= 20
        if page == 0:
            pen.text(cols["description"], y, "Opening Balance", 9)
            pen.text(cols["balance"], y, inr(opening) + (" Cr" if layout == "amount_suffix" else ""), 9, False, "right")
            y -= 15
        while index < len(txs) and index < rows_per_page * (page + 1) and y > 60:
            tx = txs[index]
            d = date.fromisoformat(tx["date"])
            lines = wrap(tx["description"], 34)
            first = True
            for fragment in lines:
                if first:
                    pen.text(cols["date"], y, d.strftime("%d/%m/%Y"), 8.5)
                    if "value" in cols:
                        pen.text(cols["value"], y, d.strftime("%d/%m/%Y"), 8.5)
                    pen.text(cols["description"], y, fragment, 8.5)
                    if layout == "debit_credit":
                        pen.text(cols["reference"], y, tx["reference"], 8.5)
                    if layout == "amount_suffix":
                        pen.text(cols["amount"], y, inr(tx["debit"] or tx["credit"]) + (" Cr" if tx["credit"] else " Dr"), 8.5, False, "right")
                    else:
                        if tx["debit"] is not None:
                            pen.text(cols["debit"], y, inr(tx["debit"]), 8.5, False, "right")
                        if tx["credit"] is not None:
                            pen.text(cols["credit"], y, inr(tx["credit"]), 8.5, False, "right")
                    pen.text(cols["balance"], y, inr(tx["balance"]) + (" Cr" if layout == "amount_suffix" else ""), 8.5, False, "right")
                    first = False
                else:
                    pen.text(cols["description"], y, fragment, 8.5)
                y -= 12
            truth_rows.append({"page": page + 1, **tx})
            index += 1
            y -= 3
        if page == pages - 1:
            pen.text(cols["description"], y - 10, f"Closing Balance : {inr(txs[-1]['balance'])}", 9, True)
        if page < pages - 1:
            pen.new_page()


# ---------------------------------------------------------------------------------------------------------------- degradations
def pdf_from_pages(pages: list[bytes], sizes: list[tuple[float, float]], rotate: int = 0) -> bytes:
    doc = fitz.open()
    for data, (w, h) in zip(pages, sizes):
        page = doc.new_page(width=w, height=h)
        page.insert_image(page.rect, stream=data)
        if rotate:
            page.set_rotation(rotate)
    out = doc.tobytes(deflate=True, garbage=3)
    doc.close()
    return out


def degrade(img: Image.Image, rng: np.random.Generator, dpi: int, skew: float = 0.0, quality: int = 70, noise: float = 0.0) -> Image.Image:
    img = img.convert("L")
    if skew:
        img = img.rotate(skew, resample=Image.BICUBIC, fillcolor=255)
    if dpi <= 150:
        img = img.filter(ImageFilter.GaussianBlur(0.5 if dpi >= 150 else 0.8))
    if noise:
        arr = np.asarray(img).astype(np.float32) + rng.normal(0, noise, (img.height, img.width))
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    return img


def to_jpeg(img: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    img.save(buffer, "JPEG", quality=quality)
    return buffer.getvalue()


def rasterize(pdf_bytes: bytes, dpi: int, rng: np.random.Generator, skew=0.0, quality=70, noise=6.0, rotate_pixels=0) -> bytes:
    src = fitz.open(stream=pdf_bytes, filetype="pdf")
    datas, sizes = [], []
    for page in src:
        pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY, alpha=False)
        img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
        img = degrade(img, rng, dpi, skew, quality, noise)
        if rotate_pixels:
            img = img.rotate(-rotate_pixels, expand=True, fillcolor=255)  # clockwise
        datas.append(to_jpeg(img, quality))
        sizes.append((img.width * 72 / dpi, img.height * 72 / dpi))
    return pdf_from_pages(datas, sizes)


# ---------------------------------------------------------------------------------------------------------------- build cases
def build_base(kind: str, layout: str, entity: dict, font: tuple[str, str], rng: random.Random, pages: int = 1):
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    pen = Pen(c, font)
    rows: list = []
    meta: dict = {}
    if kind == "GST_CERTIFICATE":
        draw_gst(pen, entity, layout)
    elif kind == "UDYAM_CERTIFICATE":
        draw_udyam(pen, entity, layout)
    else:
        draw_bank(pen, entity, layout, rng, pages, rows, meta)
    pen.finish()
    return buffer.getvalue(), pen.page_lines, rows, meta


def truth_fields(kind: str, e: dict, meta: dict) -> dict:
    if kind == "GST_CERTIFICATE":
        return {"gstin": e["gstin"], "legalName": e["legalName"], "pan": e["pan"]}
    if kind == "UDYAM_CERTIFICATE":
        return {"udyamNumber": e["udyamNumber"], "enterpriseName": e["legalName"]}
    return {"accountHolderName": e["legalName"], "accountNumber": e["accountMasked"], "ifsc": e["ifsc"], "bankName": e["bankName"], "statementPeriod": meta.get("statementPeriod")}


def garbled_from_lines(lines: list[str], fontfile: str) -> bytes:
    """Draws lines with an Identity-H embedded font and strips its ToUnicode map: it renders correctly but the text layer is garbage."""
    doc = fitz.open()
    page = doc.new_page(width=W, height=H)
    page.insert_font(fontname="F0", fontfile=fontfile)
    y = 90
    for line in lines:
        page.insert_text((60, y), line, fontname="F0", fontsize=12)
        y += 26
    doc = fitz.open(stream=doc.tobytes(), filetype="pdf")
    for xref in range(1, doc.xref_length()):
        try:
            if "/ToUnicode" in doc.xref_object(xref, compressed=True):
                doc.xref_set_key(xref, "ToUnicode", "null")
        except Exception:
            continue
    return doc.tobytes()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--quick", action="store_true", help="fewer entities per layout")
    args = parser.parse_args()
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    rng = random.Random(args.seed)
    nprng = np.random.default_rng(args.seed)
    fonts = register_fonts()
    font_keys = list(fonts)
    cases: list[dict] = []
    counter = {"n": 0}

    def add(name: str, data: bytes, **info):
        counter["n"] += 1
        file = f"{counter['n']:03d}-{name}.pdf"
        (out / file).write_bytes(data)
        cases.append({"id": f"{counter['n']:03d}", "file": file, **info})

    plain_candidates: list = []
    layouts = {"GST_CERTIFICATE": ["numbered", "stacked", "two_column", "inline"], "UDYAM_CERTIFICATE": ["inline", "table", "stacked"], "BANK_STATEMENT": ["debit_credit", "withdrawals", "amount_suffix"]}
    per_layout = 1 if args.quick else 2
    entity_no = 0
    for kind, kind_layouts in layouts.items():
        for layout in kind_layouts:
            for variant in range(per_layout):
                entity_no += 1
                entity = make_entity(rng, entity_no)
                font_key = font_keys[(entity_no + variant) % len(font_keys)]
                pages = (1 + (variant + len(layout)) % 3) if kind == "BANK_STATEMENT" else 1
                pdf, page_lines, rows, meta = build_base(kind, layout, entity, fonts[font_key], rng, pages)
                common = {"docType": kind, "layout": layout, "font": font_key, "pages": len(page_lines), "truth": {"fields": truth_fields(kind, entity, meta), "rows": rows, "lines": page_lines}, "entity": {"legalName": entity["legalName"], "gstin": entity["gstin"], "pan": entity["pan"], "udyamNumber": entity["udyamNumber"]}}
                stem = f"{kind.split('_')[0].lower()}-{layout}-{font_key}"
                add(f"{stem}-text", pdf, category="text", variant="text", **common)
                if font_key in ("helvetica", "times", "courier"):
                    plain_candidates.append((stem, pdf, common))
                add(f"{stem}-scan300", rasterize(pdf, 300, nprng, skew=0.4, quality=75, noise=5), category="scan", variant="scan300", **common)
                add(f"{stem}-scan150", rasterize(pdf, 150, nprng, skew=-0.8, quality=60, noise=8), category="scan", variant="scan150", **common)
                if variant == 0:
                    for deg in (90, 180, 270):
                        rotated = fitz.open(stream=pdf, filetype="pdf")
                        for page in rotated:
                            page.set_rotation(deg)
                        add(f"{stem}-pdfrot{deg}", rotated.tobytes(), category="rotated", variant=f"pdf_rotate_{deg}", **common)
                    add(f"{stem}-scanrot90", rasterize(pdf, 200, nprng, quality=70, noise=5, rotate_pixels=90), category="rotated", variant="scan_pixels_rotated_90", **common)
                    add(f"{stem}-scanrot180", rasterize(pdf, 200, nprng, quality=70, noise=5, rotate_pixels=180), category="rotated", variant="scan_pixels_rotated_180", **common)
                    add(f"{stem}-lowres100", rasterize(pdf, 100, nprng, skew=0.6, quality=45, noise=10), category="lowres", variant="scan100", **common)
                    if kind != "BANK_STATEMENT" and "arial" in fonts:
                        arial_path = str(Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arial.ttf")
                        add(f"{stem}-garbledtext", garbled_from_lines(page_lines[0], arial_path), category="garbled_encoding", variant="identity_h_without_tounicode", **common)

                    if kind == "BANK_STATEMENT" and pages >= 2:
                        # Mixed: page 1 as vector text, the remaining pages scanned.
                        src = fitz.open(stream=pdf, filetype="pdf")
                        mixed = fitz.open()
                        mixed.insert_pdf(src, from_page=0, to_page=0)
                        scanned = fitz.open(stream=rasterize(pdf, 200, nprng, quality=70, noise=5), filetype="pdf")
                        mixed.insert_pdf(scanned, from_page=1)
                        add(f"{stem}-mixed", mixed.tobytes(), category="mixed", variant="text_then_scanned_pages", **common)
                    if kind != "BANK_STATEMENT":
                        # Mixed region: a vector page whose key facts live in an embedded scanned image.
                        scan_pdf = fitz.open(stream=rasterize(pdf, 200, nprng, quality=75, noise=4), filetype="pdf")
                        img_pix = scan_pdf[0].get_pixmap(dpi=160, clip=fitz.Rect(0, 80, W, 500))
                        page_doc = fitz.open()
                        page = page_doc.new_page(width=W, height=H)
                        page.insert_text((50, 60), "Form Copy - Facts Appear In Image", fontsize=11)
                        page.insert_image(fitz.Rect(30, 90, W - 30, 90 + (W - 60) * img_pix.height / img_pix.width), pixmap=img_pix)
                        add(f"{stem}-mixedregion", page_doc.tobytes(), category="mixed", variant="image_region_on_text_page", **common)
    # --------------------------------------------------------------------------------------------- adversarial
    def adv(name: str, data: bytes, expect: str, note: str):
        add(f"adv-{name}", data, category="adversarial", variant=name, docType="GST_CERTIFICATE", layout="n/a", font="n/a", pages=0, truth={"fields": {}, "rows": [], "lines": []}, expected=expect, note=note)

    base_gst, *_ = build_base("GST_CERTIFICATE", "inline", make_entity(rng, 999), fonts["helvetica"], rng)
    bomb_stream = zlib.compress(bytes(60 * 1024 * 1024), 9)
    bomb_head = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Filter /FlateDecode /Length " + str(len(bomb_stream)).encode() + b" >>\nstream\n"
    adv("flate-bomb", bomb_head + bomb_stream + b"\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF", "NO_EXTRACTION", "decompression bomb")
    doc = fitz.open(stream=base_gst, filetype="pdf")
    doc.set_metadata({})
    doc_js = fitz.open(stream=base_gst, filetype="pdf")
    xref = doc_js.get_new_xref()
    doc_js.update_object(xref, "<< /S /JavaScript /JS (app.alert\\('x'\\);) >>")
    doc_js.xref_set_key(doc_js.pdf_catalog(), "OpenAction", f"{xref} 0 R")
    adv("javascript-openaction", doc_js.tobytes(), "NO_EXTRACTION", "OpenAction JavaScript")
    doc_launch = fitz.open(stream=base_gst, filetype="pdf")
    lx = doc_launch.get_new_xref()
    doc_launch.update_object(lx, "<< /S /Launch /F (cmd.exe) >>")
    doc_launch.xref_set_key(doc_launch.pdf_catalog(), "OpenAction", f"{lx} 0 R")
    adv("launch-action", doc_launch.tobytes(), "NO_EXTRACTION", "Launch action")
    doc_att = fitz.open(stream=base_gst, filetype="pdf")
    doc_att.embfile_add("payload.exe", b"MZ" + bytes(2000))
    adv("embedded-file", doc_att.tobytes(), "NO_EXTRACTION", "embedded executable attachment")
    doc_enc = fitz.open(stream=base_gst, filetype="pdf")
    adv("encrypted", doc_enc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner"), "NO_EXTRACTION", "password protected")
    huge = fitz.open()
    huge_page = huge.new_page(width=14000, height=14000)
    huge_page.insert_text((100, 200), "Registration Number : 27ABCDE1234F1Z0", fontsize=200)
    adv("huge-page", huge.tobytes(), "NO_EXTRACTION", "14000x14000 pt page (pixel-limit probe; no text-based extraction expected)")
    adv("truncated", base_gst[: len(base_gst) // 2], "NO_EXTRACTION", "file cut in half")
    adv("garbage", bytes(rng.randrange(256) for _ in range(4000)), "NO_EXTRACTION", "random bytes")
    adv("polyglot", b"PK\x03\x04" + bytes(100) + b"\n" + base_gst, "ANY", "zip header before PDF header (header within first 1 KB)")
    adv("oversize", b"%PDF-1.4\n" + bytes(6 * 1024 * 1024), "NO_EXTRACTION", "6 MB padded file")
    many = fitz.open()
    for number in range(150):
        many.new_page().insert_text((72, 72), f"Page {number} Registration Number : 27ABCDE1234F1Z0", fontsize=11)
    adv("many-pages", many.tobytes(), "PARTIAL_OR_NONE", "150 pages (page cap probe)")
    big_image = Image.new("L", (18000, 18000), 255)
    buf = io.BytesIO()
    big_image.save(buf, "JPEG", quality=30)
    doc_big = fitz.open()
    big_page = doc_big.new_page(width=595, height=842)
    big_page.insert_image(big_page.rect, stream=buf.getvalue())
    adv("huge-pixel-image", doc_big.tobytes(), "NO_EXTRACTION", "18000x18000 px blank scan (pixel/time-limit probe)")
    other = fitz.open()
    other.new_page().insert_text((72, 100), "Chocolate cake recipe: 200 g flour, 100 g sugar, 3 eggs. Bake at 180 C.", fontsize=11)
    add("adv-wrong-document", other.tobytes(), category="adversarial", variant="wrong_document", docType="GST_CERTIFICATE", layout="n/a", font="n/a", pages=1, truth={"fields": {}, "rows": [], "lines": []}, expected="NO_EXTRACTION", note="not a GST certificate")
    # Baseline fairness: the original dependency-free parser reads only uncompressed/Flate streams with simple (standard) fonts,
    # so the same documents are also provided re-saved that way. Appended last so earlier case ids stay stable.
    for stem, source_pdf, common in plain_candidates:
        plain = fitz.open(stream=source_pdf, filetype="pdf").tobytes(expand=255, garbage=0, deflate=False, ascii=False)
        add(f"{stem}-plainstreams", plain, category="text", variant="text_plain_streams", **common)
    (out / "manifest.json").write_text(json.dumps({"seed": args.seed, "generator": "evidence_eval.generate_corpus", "cases": cases}, indent=1), encoding="utf8")
    print(f"wrote {len(cases)} cases to {out}")


if __name__ == "__main__":
    main()
