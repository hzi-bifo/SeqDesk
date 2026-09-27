#!/usr/bin/env python3
"""Independent check of the TGF-b1 time-course flow (scripts/flow-timecourse). Standard library only; no SeqDesk
code, no R. It reads each step's run folder (inputs.json with params and input tables, outputs/*.tsv and
outputs/manifest.json with the recorded metrics) and recomputes what can be recomputed without re-fitting models:

  qc        n_samples_sheet, n_samples_kept (sample in the matrix and RIN >= min_rin), n_genes_input,
            n_genes_kept (= rows of counts_filtered); the source table is the one imported from Zenodo
  lrt       n_tested (padj present), n_significant (padj < padj_cutoff) from lrt_results; flags agree
  patterns  the clustered genes are exactly the max_genes significant genes with the smallest padj;
            n_clustered, n_patterns, largest/smallest pattern sizes; P1 is the largest
  go        the GO BP gene sets are the go_sets input (Data > Resources, go-bp-human reference table): every enriched
            row's size and overlap are recomputed from that table, the universe and the pattern genes;
            n_sets_tested = sets with min_size..max_size universe genes;
            every enriched row's p-value is the exact hypergeometric upper tail
            P(X >= overlap | universe N = genes tested, K = set size, n = pattern genes); BH padj < cutoff;
            n_enriched_terms, n_patterns_with_terms
  heatmap   n_heatmap_genes = sum over patterns of min(size, per_pattern)

  python3 verify.py --qc DIR --pca DIR --lrt DIR --patterns DIR --go DIR --heatmap DIR [--cite n_significant=N]

Exit code 0 when everything matches, 1 otherwise.
"""
import argparse, csv, json, math, sys
from pathlib import Path

OK = True


def check(label, recomputed, recorded):
    global OK
    same = recorded is not None and (abs(float(recorded) - float(recomputed)) < 1e-9)
    OK &= same
    print(f"{'ok      ' if same else 'MISMATCH'} {label}: recomputed {recomputed}, recorded {recorded}")


def claim(label, condition, detail=""):
    global OK
    OK &= bool(condition)
    print(f"{'ok      ' if condition else 'MISMATCH'} {label}{': ' + detail if detail else ''}")


def number(text):
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def table(path):
    lines = Path(path).read_text().splitlines()
    return list(csv.DictReader(lines, delimiter="\t"))


def run(folder):
    folder = Path(folder)
    inputs = json.loads((folder / "inputs.json").read_text())
    manifest = json.loads((folder / "outputs" / "manifest.json").read_text())
    return folder, inputs.get("params", {}), inputs.get("inputs", {}), manifest.get("metrics", {})


def truthy(value):
    return str(value).strip().lower() in ("true", "1")


def hypergeom_upper(k, N, K, n):
    """P(X >= k), X ~ Hypergeometric(population N, successes K, draws n), exact with integers."""
    total = math.comb(N, n)
    tail = sum(math.comb(K, i) * math.comb(N - K, n - i) for i in range(k, min(K, n) + 1))
    return tail / total


def main():
    parser = argparse.ArgumentParser()
    for key in ("qc", "pca", "lrt", "patterns", "go", "heatmap"):
        parser.add_argument(f"--{key}", required=True, help=f"run folder of the {key} step")
    parser.add_argument("--cite", action="append", default=[], help="KEY=VALUE shown in a report for this run")
    args = parser.parse_args()

    # qc
    folder, params, inputs, metrics = run(args.qc)
    print(f"== qc ({folder.name}); counts from dataset {inputs['counts']['name']} v{inputs['counts'].get('versionNumber')}")
    sheet = table(folder / inputs["samples"]["path"])
    with open(folder / inputs["counts"]["path"]) as handle:
        header = handle.readline().rstrip("\n").split("\t")
        n_genes_input = sum(1 for line in handle if line.strip())
    column = params.get("sample_column", "sample_ID")
    min_rin = float(params.get("min_rin", 7))
    kept = [row for row in sheet if row[column] in header and float(row["RIN"]) >= min_rin]
    check("n_samples_sheet", len(sheet), metrics.get("n_samples_sheet"))
    check("n_samples_kept", len(kept), metrics.get("n_samples_kept"))
    check("n_genes_input", n_genes_input, metrics.get("n_genes_input"))
    filtered = table(folder / "outputs" / "counts_filtered.tsv")
    check("n_genes_kept", len(filtered), metrics.get("n_genes_kept"))
    claim("counts_filtered has exactly the kept samples", set(filtered[0].keys()) - {"gene_id"} == {row[column] for row in kept})

    # lrt
    folder, params, _, metrics = run(args.lrt)
    print(f"== lrt ({folder.name}); {params.get('full')} vs {params.get('reduced')}")
    cutoff = float(params.get("padj_cutoff", 0.01))
    rows = table(folder / "outputs" / "lrt_results.tsv")
    tested = [row for row in rows if number(row["padj"]) is not None]
    significant = [row for row in tested if number(row["padj"]) < cutoff]
    check("n_tested", len(tested), metrics.get("n_tested"))
    check("n_significant", len(significant), metrics.get("n_significant"))
    sig_ids = {row["gene_id"] for row in significant}
    claim("significant flags agree with padj", all(truthy(row["significant"]) == (row["gene_id"] in sig_ids) for row in rows))
    universe = {row["gene_id"] for row in tested}

    # patterns
    folder, params, _, metrics = run(args.patterns)
    print(f"== patterns ({folder.name})")
    max_genes, k = int(params.get("max_genes", 2000)), int(params.get("n_patterns", 6))
    genes = table(folder / "outputs" / "gene_patterns.tsv")
    ranked = sorted(significant, key=lambda row: (number(row["padj"]), -(number(row["stat"]) or 0)))[:max_genes]
    claim("clustered genes = most significant genes", {row["gene_id"] for row in genes} == {row["gene_id"] for row in ranked}, f"{len(genes)} genes")
    sizes = {}
    for row in genes:
        sizes[row["pattern"]] = sizes.get(row["pattern"], 0) + 1
    check("n_clustered", len(genes), metrics.get("n_clustered"))
    check("n_patterns", len(sizes), metrics.get("n_patterns"))
    check("largest_pattern_size", max(sizes.values()), metrics.get("largest_pattern_size"))
    check("smallest_pattern_size", min(sizes.values()), metrics.get("smallest_pattern_size"))
    claim("P1 is the largest pattern", sizes.get("P1") == max(sizes.values()), json.dumps(dict(sorted(sizes.items()))))

    # go
    folder, params, go_inputs, metrics = run(args.go)
    print(f"== go ({folder.name})")
    go_cutoff = float(params.get("padj_cutoff", 0.05))
    enriched = table(folder / "outputs" / "go_enrichment.tsv")
    if "go_sets" in go_inputs:
        source = go_inputs["go_sets"]
        print(f"   gene sets from dataset {source.get('name')} v{source.get('versionNumber')}")
        claim("GO sets come from the go-bp-human reference table", str(source.get("name", "")).startswith("go-bp-human"), str(source.get("name")))
        csv.field_size_limit(1 << 30)
        sets = {row["term"]: set(row["genes"].split()) & universe for row in table(folder / source["path"])}
        lo, hi = int(params.get("min_size", 15)), int(params.get("max_size", 500))
        check("n_sets_tested", sum(1 for members in sets.values() if lo <= len(members) <= hi), metrics.get("n_sets_tested"))
        members_of = {}
        for row in genes:
            if row["gene_id"] in universe:
                members_of.setdefault(row["pattern"], set()).add(row["gene_id"])
        wrong = [row["term"] for row in enriched if len(sets.get(row["term"], ())) != int(row["size"]) or len(sets.get(row["term"], set()) & members_of[row["pattern"]]) != int(row["overlap"])]
        claim("enriched sizes and overlaps recomputed from the reference table", not wrong, f"{len(enriched)} rows" + (f", first mismatch {wrong[0]}" if wrong else ""))
    in_universe = {}
    for row in genes:
        if row["gene_id"] in universe:
            in_universe[row["pattern"]] = in_universe.get(row["pattern"], 0) + 1
    worst = 0.0
    for row in enriched:
        p = hypergeom_upper(int(row["overlap"]), len(universe), int(row["size"]), in_universe[row["pattern"]])
        worst = max(worst, abs(p - float(row["pval"])) / max(p, 1e-300))
    claim("enriched p-values are the exact hypergeometric tail", worst < 1e-6, f"{len(enriched)} rows, worst relative difference {worst:.2e}")
    claim(f"every enriched row has padj < {go_cutoff}", all(float(row["padj"]) < go_cutoff for row in enriched))
    check("n_enriched_terms", len(enriched), metrics.get("n_enriched_terms"))
    check("n_patterns_with_terms", len({row["pattern"] for row in enriched}), metrics.get("n_patterns_with_terms"))
    for pattern in sorted({row["pattern"] for row in enriched}):
        top = min((row for row in enriched if row["pattern"] == pattern), key=lambda row: float(row["padj"]))
        print(f"   {pattern}: {top['name']} ({top['overlap']}/{top['size']}, padj {float(top['padj']):.2g})")

    # heatmap
    folder, params, _, metrics = run(args.heatmap)
    print(f"== heatmap ({folder.name})")
    per = int(params.get("per_pattern", 60))
    check("n_heatmap_genes", sum(min(size, per) for size in sizes.values()), metrics.get("n_heatmap_genes"))

    for cite in args.cite:
        key, _, shown = cite.partition("=")
        value = {"n_significant": len(significant), "n_tested": len(tested), "n_samples_kept": len(kept)}.get(key)
        claim(f"cited {key}", value is not None and number(shown) == value, f"report shows {shown}, recomputed {value}")
    print("VERIFIED" if OK else "FAILED")
    sys.exit(0 if OK else 1)


if __name__ == "__main__":
    main()
