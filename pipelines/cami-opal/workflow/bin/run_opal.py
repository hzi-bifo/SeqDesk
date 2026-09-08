"""Validate, snapshot and benchmark real CAMI profiles with pinned OPAL."""
import base64
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import zipfile

VERSION = "1.0.12"
RANKS = "superkingdom phylum class order family genus species strain".split()
MAX_BYTES = 64 * 1024 * 1024


def read_profile(path):
    path = Path(path)
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("CAMI profile is missing, empty or exceeds 64 MiB: " + path.name)
    profiles, current, columns = {}, None, None
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        if line.startswith("@SampleID:"):
            sample = line.partition(":")[2].strip()
            if not sample or any(ord(c) < 32 for c in sample) or sample in profiles:
                raise ValueError("Missing or duplicate CAMI SampleID")
            current = {"metadata": {}, "rows": []}
            profiles[sample] = current
            columns = None
        elif current is None:
            raise ValueError("Expected @SampleID before profile data")
        elif line.startswith("@@"):
            columns = line[2:].split("\t")
            if len(set(columns)) != len(columns) or not {"TAXID", "RANK", "TAXPATH", "PERCENTAGE"}.issubset(columns):
                raise ValueError("Not a CAMI taxonomic profile: missing required columns")
        elif line.startswith("@"):
            key, sep, value = line[1:].partition(":")
            if not sep or key in current["metadata"]:
                raise ValueError("Invalid or duplicate CAMI metadata")
            current["metadata"][key] = value.strip()
        else:
            values = line.split("\t")
            if columns is None or len(values) != len(columns):
                raise ValueError("Invalid CAMI profile row")
            row = dict(zip(columns, values))
            taxon_pattern = r"[1-9][0-9]*(?:\.[0-9]+)?" if row["RANK"] == "strain" else r"[1-9][0-9]*"
            if row["RANK"] not in RANKS or not re.fullmatch(taxon_pattern, row["TAXID"]):
                raise ValueError("Benchmark requires NCBI numeric taxon IDs and CAMI ranks; no implicit SGB/GTDB conversion")
            lineage = row["TAXPATH"].split("|")
            if lineage[-1] != row["TAXID"] or len(lineage) != RANKS.index(row["RANK"]) + 1:
                raise ValueError("Taxon ID, rank and lineage disagree")
            if any(part and not re.fullmatch(taxon_pattern if i == 7 else r"[1-9][0-9]*", part) for i, part in enumerate(lineage)):
                raise ValueError("Invalid numeric taxonomic lineage")
            value = float(row["PERCENTAGE"])
            if not math.isfinite(value) or not 0 <= value <= 100:
                raise ValueError("Abundance must be a finite percentage between 0 and 100")
            current["rows"].append(row)
    if not profiles:
        raise ValueError("No CAMI samples found")
    for profile in profiles.values():
        if not profile["metadata"].get("Version") or not profile["metadata"].get("Ranks") or not profile["rows"]:
            raise ValueError("Incomplete or content-free CAMI profile")
        seen, totals = set(), {}
        for row in profile["rows"]:
            key = (row["RANK"], row["TAXID"])
            if key in seen:
                raise ValueError("Duplicate taxon within a sample/rank")
            seen.add(key)
            totals[row["RANK"]] = totals.get(row["RANK"], 0) + float(row["PERCENTAGE"])
        if any(value > 100.1 for value in totals.values()):
            raise ValueError("Abundance sum exceeds 100% within a rank")
    return profiles


def write_profile(path, profiles):
    columns = ["TAXID", "RANK", "TAXPATH", "TAXPATHSN", "PERCENTAGE"]
    if any(not any(row["RANK"] != "strain" for row in profile["rows"]) for profile in profiles.values()):
        raise ValueError("Profile has no predictions or reference taxa in the evaluated ranks (superkingdom through species)")
    with Path(path).open("w", encoding="utf-8") as handle:
        for sample, profile in profiles.items():
            handle.write("@SampleID:" + sample + "\n")
            for key, value in profile["metadata"].items():
                if key == "Ranks":
                    value = "|".join(RANKS[:-1])
                handle.write("@" + key + ":" + value + "\n")
            handle.write("@@" + "\t".join(columns) + "\n")
            for row in profile["rows"]:
                # MetaPhlAn's CAMI export has no strain predictions. Preserve
                # the original reference hash, but explicitly evaluate only
                # superkingdom through species, not false missing strains.
                if row["RANK"] == "strain":
                    continue
                handle.write("\t".join(row.get(key, "") for key in columns) + "\n")
            handle.write("\n")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def prepare(request):
    if request.get("taxonomy_confirmed") is not True or not str(request.get("taxonomy_note", "")).strip():
        raise ValueError("Confirm taxonomy compatibility and document the reference version first")
    if type(request.get("normalize", False)) is not bool:
        raise ValueError("Invalid normalization policy")
    with Path(request["input"]).open(newline="") as handle:
        samples = [row.get("sample_id", "").strip() for row in csv.DictReader(handle)]
    if not samples or any(not s for s in samples) or len(set(samples)) != len(samples):
        raise ValueError("Study sample codes must be nonempty and unique; overlapping CAMI collections need distinct codes")
    mapping = json.loads(request.get("sample_map", "{}"))
    if not isinstance(mapping, dict) or set(mapping) != set(samples):
        raise ValueError("Provide exactly one Ground Truth mapping for every selected SeqDesk sample code")
    if any(not isinstance(v, str) or not v or any(ord(c) < 32 for c in v) for v in mapping.values()):
        raise ValueError("Invalid Ground Truth sample ID")
    if len(set(mapping.values())) != len(mapping):
        raise ValueError("Two samples cannot silently map to the same Ground Truth sample")
    truth = read_profile(request["ground_truth"])
    if not set(mapping.values()).issubset(truth):
        raise ValueError("Mapped samples are absent from the Ground Truth; check challenge, dataset and read technology")
    raw_run_ids = request.get("prediction_run_ids", "")
    if not isinstance(raw_run_ids, str):
        raise ValueError("Prediction run IDs must be comma-separated text")
    run_ids = [value.strip() for value in raw_run_ids.split(",") if value.strip()]
    if len(set(run_ids)) != len(run_ids) or any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value) for value in run_ids):
        raise ValueError("Invalid or duplicate prediction run ID")
    root = Path(request["profiles_dir"]).resolve()
    files = sorted(root.glob("metaphlan/*/*/*.cami.profile"))
    available = {p.relative_to(root).parts[1] for p in files}
    if not run_ids:
        if len(available) != 1:
            raise ValueError("Select explicit prediction run IDs: expected exactly one available run, found " + str(len(available)))
        run_ids = sorted(available)
    if not set(run_ids).issubset(available):
        raise ValueError("Selected prediction run is not among the completed, same-study staged profiles")
    source_provenance = {}
    for path in sorted(root.glob("metaphlan/*/*/*.provenance.json")):
        run = path.relative_to(root).parts[1]
        if run not in run_ids:
            continue
        if path.is_symlink() or root not in path.resolve().parents or path.stat().st_size > MAX_BYTES:
            raise ValueError("Invalid staged provenance file")
        data = json.loads(path.read_text())
        key = (run, data.get("sampleId"))
        if key in source_provenance:
            raise ValueError("Duplicate prediction provenance")
        source_provenance[key] = data
    predictions, inventory = {run: {} for run in run_ids}, []
    for path in files:
        run = path.relative_to(root).parts[1]
        if run not in predictions:
            continue
        if path.is_symlink() or root not in path.resolve().parents:
            raise ValueError("Prediction escapes the staged input directory")
        profiles = read_profile(path)
        if len(profiles) != 1:
            raise ValueError("Expected a per-sample MetaPhlAn artifact")
        sample, profile = next(iter(profiles.items()))
        if sample not in mapping:
            continue  # same study, but not selected for this benchmark
        if sample in predictions[run]:
            raise ValueError("Ambiguous duplicate prediction for sample " + sample + " in run " + run)
        provenance = source_provenance.get((run, sample))
        if not provenance or not provenance.get("databaseIndex") or not provenance.get("databaseMetadataSha256"):
            raise ValueError("Missing database provenance for sample " + sample + " in run " + run)
        predictions[run][sample] = profile
        inventory.append({"runId": run, "sampleId": sample, "groundTruthSampleId": mapping[sample],
                          "artifact": str(path.relative_to(root)), "sha256": sha256(path),
                          "profilingProvenance": provenance})
    # Exact coverage: no silent intersection, missing samples or zero-filled predictions.
    for run, profiles in predictions.items():
        if set(profiles) != set(samples):
            raise ValueError("Prediction run " + run + " does not cover every selected sample")
        for sample, profile in profiles.items():
            expected = {r["TAXID"]: r for r in truth[mapping[sample]]["rows"]}
            for row in profile["rows"]:
                match = expected.get(row["TAXID"])
                if match and (match["RANK"] != row["RANK"] or match["TAXPATH"] != row["TAXPATH"]):
                    raise ValueError("Conflicting taxonomy for shared taxon " + row["TAXID"] + "; reconcile reference versions")
    inputs = Path("benchmark-inputs")
    inputs.mkdir(exist_ok=False)
    reference = inputs / "ground-truth.profile"
    write_profile(reference, {mapping[s]: truth[mapping[s]] for s in samples})
    profile_paths, labels = [], []
    for i, run in enumerate(run_ids, 1):
        dest = inputs / ("prediction-" + str(i) + ".profile")
        write_profile(dest, {mapping[s]: predictions[run][s] for s in samples})
        profile_paths.append(str(dest))
        labels.append("MetaPhlAn-" + run)
    provenance = {"schemaVersion": 1, "tool": "OPAL", "version": VERSION,
                  "groundTruthSha256": sha256(request["ground_truth"]),
                  "referenceSubsetSha256": sha256(reference), "sampleMapping": mapping,
                  "predictionArtifacts": inventory, "taxonomyNote": request["taxonomy_note"],
                  "normalize": request.get("normalize", False),
                  "evaluatedRanks": RANKS[:-1], "excludedRanks": ["strain"],
                  "referenceSamplesExcluded": sorted(set(truth) - set(mapping.values())),
                  "caveat": "Metrics describe the selected samples and taxonomy. Novel species, taxonomy drift, relative-abundance definitions and subsampling affect accuracy; successful execution is not a quality threshold."}
    command = ["opal.py", "-g", str(reference), "-o", "opal", "-r", "superkingdom,species", "-l", ",".join(labels)]
    if request.get("normalize", False):
        command.append("--normalize")
    command += profile_paths
    provenance["command"] = command
    Path("benchmark-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    return command


def main(request):
    command = prepare(request)
    version = subprocess.check_output(["opal.py", "--version"], text=True).strip()
    if not re.search(r"(?<![\d.])" + re.escape(VERSION) + r"(?![\d.])", version):
        raise ValueError("Expected OPAL " + VERSION + "; got " + version)
    subprocess.run(command, check=True)
    for filename in ("opal/results.html", "opal/results.tsv"):
        if not Path(filename).is_file() or not Path(filename).stat().st_size:
            raise ValueError("OPAL produced no " + filename)
    # Preserve HTML dependencies and exact normalized input snapshots for download.
    with zipfile.ZipFile("benchmark.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for directory in (Path("opal"), Path("benchmark-inputs")):
            for path in sorted(directory.rglob("*")):
                if path.is_file() and not path.is_symlink():
                    archive.write(path, str(path))
        archive.write("benchmark-provenance.json")


if __name__ == "__main__":
    try:
        main(json.loads(base64.b64decode(sys.argv[1], validate=True)))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
