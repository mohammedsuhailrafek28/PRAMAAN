"""Extraction worker CLI.

    python -m evidence_worker.worker --input <file.pdf> [limits...]

Prints exactly one JSON object on stdout. Diagnostics go to stderr and never contain document content. The caller owns
the file (an isolated temporary copy), the timeout and the process lifetime; this process opens nothing else.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

from .limits import LimitExceeded, apply_hard_limits, block_network, peak_working_set_mb


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--kind", choices=["pdf", "png", "jpeg"], default="pdf")
    parser.add_argument("--max-bytes", type=int, default=5 * 1024 * 1024)
    parser.add_argument("--max-pages", type=int, default=40)
    parser.add_argument("--max-ocr-pages", type=int, default=12)
    parser.add_argument("--max-pixels", type=int, default=12_000_000)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--time-budget", type=float, default=80.0)
    parser.add_argument("--max-memory-mb", type=int, default=1500)
    args = parser.parse_args(argv)

    started = time.monotonic()
    import fitz

    fitz.TOOLS.mupdf_display_errors(False)  # MuPDF otherwise prints parser diagnostics onto the output streams
    fitz.TOOLS.mupdf_display_warnings(False)
    block_network()
    enforced = apply_hard_limits(args.max_memory_mb, int(args.time_budget * 2))
    from .pipeline import Limits, process, process_image
    from . import ocr

    limits = Limits(max_bytes=args.max_bytes, max_pages=args.max_pages, max_ocr_pages=args.max_ocr_pages, max_pixels=args.max_pixels, dpi=args.dpi,
                    time_budget=args.time_budget, max_memory_mb=args.max_memory_mb)
    def empty(status: str, reason: str) -> dict:
        return {"schema": 1, "status": status, "reason": reason, "pageCount": 0, "processedPages": 0, "activeContent": [], "pages": [], "tables": [], "ocrPages": 0, "notes": []}

    try:
        if os.path.getsize(args.input) > args.max_bytes:
            result = empty("REJECTED", "TOO_LARGE")
        elif args.kind != "pdf":
            result = process_image(args.input, args.kind, limits, started)
        else:
            with open(args.input, "rb") as handle:
                is_pdf = handle.read(1024).find(b"%PDF-") != -1
            result = process(args.input, limits, started) if is_pdf else empty("UNSUPPORTED", "NOT_A_PDF")
    except LimitExceeded as exceeded:
        result = empty("REJECTED", exceeded.reason)
    except MemoryError:
        result = empty("REJECTED", "MEMORY_LIMIT")
    except Exception as error:  # never echo content; the class name is enough for operators
        print(f"worker error: {type(error).__name__}", file=sys.stderr)
        result = empty("UNREADABLE", "PARSE_ERROR")
    result["engine"] = {"pymupdf": fitz.VersionBind, "ocr": ocr.engine_version() if ocr.available() else None, "python": sys.version.split()[0]}
    result["metrics"] = {"elapsedMs": int((time.monotonic() - started) * 1000), "peakWorkingSetMb": round(peak_working_set_mb(), 1), "enforced": enforced}
    sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
