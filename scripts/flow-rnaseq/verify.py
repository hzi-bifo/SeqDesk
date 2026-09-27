#!/usr/bin/env python3
"""Independent check of the DESeq2 step's counts. Standard library only; no
SeqDesk code, no R.

It reads the step's stored parameters (inputs.json of the run folder), the
de_results table it wrote and the metrics it recorded (outputs/manifest.json),
recomputes n_tested / n_de / n_up / n_down from the table with the rules

    n_tested = rows with a non-empty padj
    n_de     = padj < padj_cutoff and |log2FoldChange| >= lfc_cutoff
    n_up     = n_de with log2FoldChange > 0;  n_down = with < 0

and compares. With --cite KEY=VALUE (repeatable) it also checks that a value a
report shows for this run (e.g. the n_de citation pinned to the run) equals
the recomputed number.

  python3 verify.py --run-dir <run folder of the DESeq2 step> [--cite n_de=925]
  python3 verify.py --params inputs.json --results de_results.tsv --manifest manifest.json

Exit code 0 when everything matches, 1 otherwise.
"""
import argparse, csv, json, math, sys
from pathlib import Path


def number(text):
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir")
    parser.add_argument("--params", help="inputs.json of the run (holds params)")
    parser.add_argument("--results", help="de_results table (TSV or CSV)")
    parser.add_argument("--manifest", help="outputs/manifest.json, or a JSON object of recorded metrics")
    parser.add_argument("--cite", action="append", default=[], help="KEY=VALUE shown in a report for this run")
    args = parser.parse_args()
    if args.run_dir:
        run = Path(args.run_dir)
        args.params = args.params or run / "inputs.json"
        args.results = args.results or run / "outputs" / "de_results.tsv"
        args.manifest = args.manifest or run / "outputs" / "manifest.json"
    if not (args.params and args.results and args.manifest):
        parser.error("give --run-dir or all of --params, --results, --manifest")

    params = json.loads(Path(args.params).read_text())
    params = params.get("params", params)
    padj_cutoff = float(params.get("padj_cutoff", 0.05))
    lfc_cutoff = float(params.get("lfc_cutoff", 1))

    text = Path(args.results).read_text()
    delimiter = "\t" if "\t" in text.splitlines()[0] else ","
    rows = list(csv.DictReader(text.splitlines(), delimiter=delimiter))
    n_tested = n_up = n_down = 0
    for row in rows:
        padj, lfc = number(row.get("padj")), number(row.get("log2FoldChange"))
        if padj is None:
            continue
        n_tested += 1
        if padj < padj_cutoff and lfc is not None and abs(lfc) >= lfc_cutoff:
            if lfc > 0:
                n_up += 1
            elif lfc < 0:
                n_down += 1
    recomputed = {"n_tested": n_tested, "n_de": n_up + n_down, "n_up": n_up, "n_down": n_down}

    recorded = json.loads(Path(args.manifest).read_text())
    recorded = recorded.get("metrics", recorded)
    print(f"rows in de_results: {len(rows)}; rule: padj < {padj_cutoff} and |log2FoldChange| >= {lfc_cutoff}")
    ok = True
    for key in ("padj_cutoff", "lfc_cutoff"):
        if key in recorded and float(recorded[key]) != float(params.get(key)):
            print(f"MISMATCH {key}: recorded {recorded[key]} but params say {params.get(key)}"); ok = False
    for key, value in recomputed.items():
        got = recorded.get(key)
        same = got is not None and int(got) == value
        ok &= same
        print(f"{'ok      ' if same else 'MISMATCH'} {key}: recomputed {value}, recorded {got}")
    for cite in args.cite:
        key, _, shown = cite.partition("=")
        value = number(shown.replace(",", "").strip())
        same = key in recomputed and value is not None and int(value) == recomputed[key]
        ok &= same
        print(f"{'ok      ' if same else 'MISMATCH'} cited {key}: report shows {shown}, recomputed {recomputed.get(key)}")
    print("VERIFIED" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
