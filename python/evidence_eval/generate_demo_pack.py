"""One FICTIONAL business with a consistent three-document pack, for a manual or browser walk-through of the evidence review.

    python -m evidence_eval.generate_demo_pack --out <dir> [--seed 11]

Writes gst-certificate.pdf (text), udyam-certificate.pdf (scanned) and bank-statement.pdf (2 pages, scanned), plus pack.json with
the entity's values to declare in the business profile. Like the evaluation corpus, nothing here is a real document.
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np

from .generate_corpus import build_base, make_entity, rasterize, register_fonts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    nprng = np.random.default_rng(args.seed)
    font = register_fonts()["helvetica"]
    entity = make_entity(rng, 1)

    gst, _, _, _ = build_base("GST_CERTIFICATE", "numbered", entity, font, rng)
    udyam, _, _, _ = build_base("UDYAM_CERTIFICATE", "inline", entity, font, rng)
    bank, _, rows, meta = build_base("BANK_STATEMENT", "debit_credit", entity, font, rng, pages=2)

    (out / "gst-certificate.pdf").write_bytes(gst)
    (out / "udyam-certificate.pdf").write_bytes(rasterize(udyam, 200, nprng, skew=0.3, quality=75, noise=4))
    (out / "bank-statement.pdf").write_bytes(rasterize(bank, 200, nprng, skew=-0.4, quality=70, noise=4))
    (out / "pack.json").write_text(json.dumps({
        "legalName": entity["legalName"], "gstin": entity["gstin"], "pan": entity["pan"], "udyamNumber": entity["udyamNumber"],
        "address": entity["address"], "accountLast4": entity["account"][-4:], "bankRows": len(rows), "statementPeriod": meta.get("statementPeriod"),
    }, indent=2))
    print(f"wrote demo pack for {entity['legalName']} to {out}")


if __name__ == "__main__":
    main()
