"""Compares the default PyMuPDF backend with the experimental pdfium backend: line text and box positions (centres, x-extents) on text and /Rotate pages.

    python -m evidence_eval.compare_coordinates <corpus dir>
"""
import os, sys, json, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
C = sys.argv[1].rstrip("/\\") + "/"  # corpus directory written by generate_corpus
cases = json.load(open(C + "manifest.json"))["cases"]
from evidence_worker import pipeline
def run(b, path):
    os.environ["EVIDENCE_PDF_BACKEND"] = b
    return pipeline.process(path, pipeline.Limits(), time.monotonic())
def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1])); i = ix * iy
    u = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - i
    return i / u if u else 0
rows = []
for c in cases:
    if c["variant"] not in ("text", "pdf_rotate_90", "pdf_rotate_180", "pdf_rotate_270", "text_plain_streams"): continue
    p = C + c["file"]
    a, b = run("pymupdf", p), run("pdfium", p)
    la = [l for pg in a["pages"] for l in pg["lines"]]; lb = [l for pg in b["pages"] for l in pg["lines"]]
    # match lines by text
    by = {}
    for l in lb: by.setdefault(l["text"], []).append(l)
    ious = []
    for l in la:
        m = by.get(l["text"])
        if m: o=m.pop(0)["bbox"]; q=l["bbox"]; ious.append(max(abs((q[0]+q[2])/2-(o[0]+o[2])/2),abs((q[1]+q[3])/2-(o[1]+o[3])/2),abs(q[0]-o[0]),abs(q[2]-o[2])))
    same_text = sum(1 for l in la if any(l["text"] == x["text"] for x in lb))
    dims = (a["pages"][0]["width"], a["pages"][0]["height"], b["pages"][0]["width"], b["pages"][0]["height"]) if a["pages"] and b["pages"] else None
    rows.append((c["id"], c["variant"], len(la), len(lb), same_text, round(max(ious), 2) if ious else None, round(sum(ious)/len(ious), 2) if ious else None, dims))
for r in rows: print(r)
bad = [r for r in rows if r[5] is None or r[5] > 3.0]
print("cases", len(rows), "with differences", len(bad))
for r in bad: print("DIFF", r)
