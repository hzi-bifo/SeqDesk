#!/usr/bin/env python3
"""Independent check of the Moving Pictures flow. Standard library only; no
SeqDesk code, no scikit-bio, no numpy.

From the run folders of the QC, alpha and beta steps it

  * recounts n_samples_kept from the QC step's *inputs* (the original counts
    and sample sheet it was given) and its params: group in group_levels and
    total reads >= min_depth; and n_features_kept from its counts_qc output;
  * recomputes Shannon (in the step's log base) and observed features per
    sample from counts_qc, and the median per group;
  * recomputes Bray-Curtis distances and the PERMANOVA pseudo-F
    (Anderson 2001) for the grouping, and checks the recorded p-value is a
    valid permutation p-value for the recorded number of permutations;

and compares everything with the metrics each step recorded
(outputs/manifest.json). With --cite KEY=VALUE (repeatable) it also checks a
value a report shows for the run against the recomputed number.

  python3 verify.py --qc <run dir> --alpha <run dir> --beta <run dir> [--cite pseudo_f=20.88]
  python3 verify.py --standalone <run-standalone.py --out folder>

Exit code 0 when everything matches, 1 otherwise.
"""
import argparse, csv, json, math, statistics, sys
from pathlib import Path


def read_table(path):
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def run_info(run_dir):
    run = Path(run_dir)
    inputs = json.loads((run / "inputs.json").read_text())
    manifest = json.loads((run / "outputs" / "manifest.json").read_text())
    return run, inputs, manifest


def output_path(run, manifest, name):
    for artifact in manifest["artifacts"]:
        if artifact.get("name") == name and artifact.get("kind") == "table":
            return run / artifact["path"]
    raise SystemExit(f"{run}: no table output {name}")


def counts_matrix(rows):
    samples = [key for key in rows[0] if key != "feature_id"]
    return samples, {row["feature_id"]: {s: float(row[s] or 0) for s in samples} for row in rows}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--qc"); parser.add_argument("--alpha"); parser.add_argument("--beta")
    parser.add_argument("--standalone", help="folder written by run-standalone.py")
    parser.add_argument("--cite", action="append", default=[])
    args = parser.parse_args()
    if args.standalone:
        root = Path(args.standalone)
        args.qc, args.alpha, args.beta = root / "01-qc", root / "02-alpha", root / "03-beta"
    if not (args.qc and args.alpha and args.beta):
        parser.error("give --qc, --alpha and --beta, or --standalone")
    ok = True
    recomputed = {}

    def check(key, value, recorded, tolerance=0.0):
        nonlocal ok
        same = recorded is not None and abs(float(recorded) - float(value)) <= tolerance
        ok &= same
        recomputed[key] = value
        print(f"{'ok      ' if same else 'MISMATCH'} {key}: recomputed {value}, recorded {recorded}")

    # --- QC: from the step's own inputs -------------------------------------
    run, inputs, manifest = run_info(args.qc)
    params = inputs["params"]
    group_column, levels, min_depth = params["group_column"], [str(x) for x in params["group_levels"]], int(params["min_depth"])
    raw = read_table(run / inputs["inputs"]["counts"]["path"])
    sheet = read_table(run / inputs["inputs"]["samples"]["path"])
    depth = {row["sample"]: sum(float(r[row["sample"]] or 0) for r in raw) for row in sheet}
    kept = [row["sample"] for row in sheet if row[group_column] in levels and depth[row["sample"]] >= min_depth]
    print(f"QC rule: {group_column} in {levels} and reads >= {min_depth}")
    check("n_samples_kept", len(kept), manifest["metrics"].get("n_samples_kept"))
    samples, counts = counts_matrix(read_table(output_path(run, manifest, "counts_qc")))
    if sorted(samples) != sorted(kept):
        print("MISMATCH counts_qc columns differ from the recounted kept samples"); ok = False
    if params.get("normalise", "rarefy") == "rarefy":
        bad = [s for s in samples if round(sum(c[s] for c in counts.values())) != min_depth]
        if bad:
            print(f"MISMATCH samples not rarefied to {min_depth}: {bad}"); ok = False
    check("n_features_kept", sum(1 for c in counts.values() if sum(c.values()) > 0), manifest["metrics"].get("n_features_kept"))
    group = {row["sample"]: row[group_column] for row in sheet}

    # --- alpha ---------------------------------------------------------------
    run, inputs, manifest = run_info(args.alpha)
    base = float(inputs["params"].get("log_base", 2))
    shannon, observed = {}, {}
    for s in samples:
        column = [c[s] for c in counts.values() if c[s] > 0]
        total = sum(column)
        shannon[s] = -sum((x / total) * math.log(x / total, base) for x in column)
        observed[s] = len(column)
    for name, values in (("shannon", shannon), ("observed_features", observed)):
        for level in sorted(set(group[s] for s in samples)):
            median = statistics.median(values[s] for s in samples if group[s] == level)
            key = f"median_{name}_{level}"
            check(key, round(median, 4), manifest["metrics"].get(key), tolerance=1e-4)

    # --- beta: Bray-Curtis + PERMANOVA pseudo-F -------------------------------
    run, inputs, manifest = run_info(args.beta)
    if inputs["params"].get("metric", "braycurtis") != "braycurtis":
        print("MISMATCH this verifier only recomputes braycurtis"); ok = False
    features = list(counts)
    vec = {s: [counts[f][s] for f in features] for s in samples}
    def bray(a, b):
        return sum(abs(x - y) for x, y in zip(a, b)) / sum(x + y for x, y in zip(a, b))
    n = len(samples)
    d2 = {(i, j): bray(vec[samples[i]], vec[samples[j]]) ** 2 for i in range(n) for j in range(i + 1, n)}
    levels_present = sorted(set(group[s] for s in samples))
    sst = sum(d2.values()) / n
    ssw = 0.0
    for level in levels_present:
        members = [i for i, s in enumerate(samples) if group[s] == level]
        ssw += sum(d2[(i, j)] for a, i in enumerate(members) for j in members[a + 1:]) / len(members)
    k = len(levels_present)
    pseudo_f = ((sst - ssw) / (k - 1)) / (ssw / (n - k))
    metrics = manifest["metrics"]
    check("pseudo_f", round(pseudo_f, 4), metrics.get("pseudo_f"), tolerance=1e-4)
    permutations = int(inputs["params"].get("permutations", 999))
    check("permutations", permutations, metrics.get("permutations"))
    p = float(metrics.get("p_permanova", -1))
    valid = 1 / (permutations + 1) - 1e-12 <= p <= 1 and abs(p * (permutations + 1) - round(p * (permutations + 1))) < 1e-6
    ok &= valid
    print(f"{'ok      ' if valid else 'MISMATCH'} p_permanova {p}: a valid permutation p-value for {permutations} permutations (seed {inputs['params'].get('seed')})")

    for cite in args.cite:
        key, _, shown = cite.partition("=")
        try:
            value = float(shown.replace(",", "").strip())
        except ValueError:
            value = None
        same = key in recomputed and value is not None and abs(value - float(recomputed[key])) <= 0.01 * max(1.0, abs(float(recomputed[key])))
        ok &= same
        print(f"{'ok      ' if same else 'MISMATCH'} cited {key}: report shows {shown}, recomputed {recomputed.get(key)}")
    print("VERIFIED" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
