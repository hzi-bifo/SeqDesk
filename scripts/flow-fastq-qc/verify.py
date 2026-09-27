#!/usr/bin/env python3
"""Independent check of the FASTQ QC flow (scripts/flow-fastq-qc). Standard library only; no SeqDesk code, no fastp,
no seqkit. It reads the FASTQ files the steps read (staged in the step's run folder as inputs/files/<alias>/) with
gzip and recomputes:

  source    each file's MD5 is the one ENA publishes for ERR10419931 (recipe.json)
  fastp     reads_in (records in both mates), pct_q30 and the before-filtering Q20/Q30 shares (Phred+33 bases >= 20/30
            over all bases), gc_pct (G+C over all bases), mean_quality (mean Phred over all bases); read_qc.tsv's
            before row; reads_out and pct_reads_kept agree with its after row
  lengths   n_reads, mean_length, n_lengths and every read_stats.tsv count and every length_histogram.tsv row
  summary   pct_kept = reads after / reads before (read_qc), modal_length and pct_full_length from the lengths

  python3 verify.py --fastp DIR --lengths DIR --summary DIR [--cite reads_in=N]

Prints VERIFIED and exits 0 when everything matches, 1 otherwise.
"""
import argparse, collections, csv, gzip, hashlib, json, sys
from pathlib import Path

OK = True
HERE = Path(__file__).resolve().parent


def check(label, recomputed, recorded, tolerance=1e-9):
    global OK
    same = recorded is not None and abs(float(recorded) - float(recomputed)) <= tolerance
    OK &= same
    print(f"{'ok      ' if same else 'MISMATCH'} {label}: recomputed {recomputed}, recorded {recorded}")


def claim(label, condition, detail=""):
    global OK
    OK &= bool(condition)
    print(f"{'ok      ' if condition else 'MISMATCH'} {label}{': ' + detail if detail else ''}")


def manifest(folder):
    return json.loads((Path(folder) / "outputs" / "manifest.json").read_text())


def table(folder, name):
    with open(Path(folder) / "outputs" / name, newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def staged(folder, alias):
    inputs = json.loads((Path(folder) / "inputs.json").read_text())
    return Path(folder) / inputs["files"][alias]["path"]


def scan(path):
    """Records, bases, G+C, Q20/Q30 bases, Phred sum and the length histogram of one gzip FASTQ file."""
    out = {"reads": 0, "bases": 0, "gc": 0, "q20": 0, "q30": 0, "qsum": 0, "lengths": collections.Counter()}
    with gzip.open(path, "rb") as handle:
        while True:
            header = handle.readline()
            if not header:
                break
            seq = handle.readline().rstrip(b"\r\n")
            handle.readline()
            qual = handle.readline().rstrip(b"\r\n")
            assert header.startswith(b"@") and len(seq) == len(qual), f"malformed record in {path}"
            out["reads"] += 1
            out["bases"] += len(seq)
            out["lengths"][len(seq)] += 1
            out["gc"] += seq.count(b"G") + seq.count(b"C") + seq.count(b"g") + seq.count(b"c")
            for q in qual:
                phred = q - 33
                out["qsum"] += phred
                out["q20"] += phred >= 20
                out["q30"] += phred >= 30
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for key in ("fastp", "lengths", "summary"):
        parser.add_argument(f"--{key}", required=True)
    parser.add_argument("--cite", action="append", default=[])
    args = parser.parse_args()
    recipe = json.loads((HERE / "recipe.json").read_text())

    mates = {}
    for alias, spec in recipe["files"].items():
        path = staged(args.fastp, alias)
        md5 = hashlib.md5(path.read_bytes()).hexdigest()
        check_md5 = md5 == spec["md5"]
        claim(f"{alias} is {spec['file']} as ENA publishes it", check_md5 and path.name == spec["file"], f"md5 {md5}")
        claim(f"{alias}: the lengths step read the same bytes", hashlib.md5(staged(args.lengths, alias).read_bytes()).hexdigest() == md5)
        mates[alias] = scan(path)
    total = {key: sum(m[key] for m in mates.values()) for key in ("reads", "bases", "gc", "q20", "q30", "qsum")}
    lengths = collections.Counter()
    for m in mates.values():
        lengths.update(m["lengths"])
    print(f"FASTQ: {total['reads']} reads, {total['bases']} bases in {len(mates)} files")

    # fastp step (shell): values and the before row of read_qc.tsv.
    fastp = manifest(args.fastp)["metrics"]
    qc = {row["stage"]: row for row in table(args.fastp, "read_qc.tsv")}
    before, after = qc["before_filtering"], qc["after_filtering"]
    check("fastp reads_in", total["reads"], fastp.get("reads_in"))
    check("read_qc before reads", total["reads"], before["reads"])
    check("read_qc before bases", total["bases"], before["bases"])
    check("fastp pct_q30 (2 dp)", round(100 * total["q30"] / total["bases"], 2), fastp.get("pct_q30"))
    check("read_qc before q30_pct", 100 * total["q30"] / total["bases"], before["q30_pct"], 1e-3)
    check("read_qc before q20_pct", 100 * total["q20"] / total["bases"], before["q20_pct"], 1e-3)
    check("fastp gc_pct (2 dp)", round(100 * total["gc"] / total["bases"], 2), fastp.get("gc_pct"))
    check("fastp mean_quality (4 dp)", round(total["qsum"] / total["bases"], 4), fastp.get("mean_quality"))
    check("fastp reads_out = read_qc after reads", float(after["reads"]), fastp.get("reads_out"))
    check("fastp pct_reads_kept", round(100 * float(after["reads"]) / total["reads"], 2), fastp.get("pct_reads_kept"))
    claim("fastp kept at most the reads it read", 0 < float(after["reads"]) <= total["reads"])

    # lengths step (shell): seqkit statistics and the histogram.
    stats = manifest(args.lengths)["metrics"]
    check("lengths n_reads", total["reads"], stats.get("n_reads"))
    check("lengths mean_length (4 dp)", round(total["bases"] / total["reads"], 4), stats.get("mean_length"))
    check("lengths n_lengths", len(lengths), stats.get("n_lengths"))
    for row, (alias, m) in zip(table(args.lengths, "read_stats.tsv"), mates.items()):
        check(f"read_stats {row['mate']} num_seqs", m["reads"], row["num_seqs"])
        check(f"read_stats {row['mate']} sum_len", m["bases"], row["sum_len"])
        check(f"read_stats {row['mate']} GC_pct (2 dp)", round(100 * m["gc"] / m["bases"], 2), row["GC_pct"], 0.006)
    histogram = collections.Counter()
    for row in table(args.lengths, "length_histogram.tsv"):
        mate = "reads_1" if row["mate"] == "R1" else "reads_2"
        claim(f"histogram {row['mate']} length {row['length']}", mates[mate]["lengths"][int(row["length"])] == int(row["reads"]), f"{row['reads']} reads")
        histogram[int(row["length"])] += int(row["reads"])
    claim("histogram covers every read", sum(histogram.values()) == total["reads"])

    # summary step (Python): from the two shell steps' tables.
    summary = manifest(args.summary)["metrics"]
    check("summary pct_kept", round(100 * float(after["reads"]) / total["reads"], 2), summary.get("pct_kept"))
    modal = max(sorted(lengths), key=lambda length: lengths[length])
    check("summary modal_length", modal, summary.get("modal_length"))
    check("summary pct_full_length", round(100 * lengths[max(lengths)] / total["reads"], 2), summary.get("pct_full_length"))

    for entry in args.cite:
        key, value = entry.split("=", 1)
        check(f"citation {key}", fastp.get(key), value)

    print("VERIFIED" if OK else "NOT VERIFIED")
    return 0 if OK else 1


if __name__ == "__main__":
    sys.exit(main())
