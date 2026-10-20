"""Compares the default PyMuPDF backend with the experimental pdfium backend: outcomes and active-content findings on the adversarial files.

    python -m evidence_eval.compare_adversarial <corpus dir>
"""
import os, sys, json, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
C = sys.argv[1].rstrip("/\\") + "/"  # corpus directory written by generate_corpus
cases = json.load(open(C + "manifest.json"))["cases"]
from evidence_worker import pipeline
def run(b, path):
    os.environ["EVIDENCE_PDF_BACKEND"] = b
    try:
        r = pipeline.process(path, pipeline.Limits(), time.monotonic())
        return (r["status"], r["reason"], tuple(r["activeContent"]), sum(len(p["lines"]) for p in r["pages"]))
    except Exception as e:
        return ("EXC", type(e).__name__, (), 0)
bad = 0
for c in cases:
    if c["category"] != "adversarial": continue
    p = C + c["file"]
    a, b = run("pymupdf", p), run("pdfium", p)
    ok = a[:3] == b[:3]
    bad += not ok
    print("OK  " if ok else "DIFF", c["file"], "|", a, "|", b)
print("adversarial differences:", bad)
