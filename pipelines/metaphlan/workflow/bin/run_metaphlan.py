"""SeqDesk's pinned MetaPhlAn runner. No shell commands and no DB downloads."""
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

VERSION = "4.2.5"


def validate_request(request):
    sample = request.get("sample_id", "")
    if not isinstance(sample, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}", sample):
        raise ValueError("Unsafe or missing sample code")
    index = request.get("db_index", "")
    if not isinstance(index, str) or not re.fullmatch(r"mpa_[A-Za-z0-9._-]+", index):
        raise ValueError("An exact installed mpa_ database index is required, not latest")
    db = Path(request.get("db_dir") or "").resolve()
    metadata = db / (index + ".pkl")
    suffixes = ["1", "2", "3", "4", "rev.1", "rev.2"]
    if not metadata.is_file() or not metadata.stat().st_size:
        raise ValueError("MetaPhlAn database metadata is missing; ask an administrator to install the pinned DB")
    if not all((db / (index + "." + s + ".bt2l")).is_file() and
               (db / (index + "." + s + ".bt2l")).stat().st_size > 0 for s in suffixes):
        raise ValueError("The complete six-file large Bowtie2 (.bt2l) index is required by MetaPhlAn 4.2.5; automatic DB installation is disabled")
    reads = request.get("reads")
    if not isinstance(reads, list) or not 1 <= len(reads) <= 2:
        raise ValueError("Exactly one or two FASTQ files are required")
    if any(not isinstance(p, str) or not Path(p).is_file() or not Path(p).stat().st_size for p in reads):
        raise ValueError("Missing or empty input FASTQ")
    if len({str(Path(p).resolve()) for p in reads}) != len(reads):
        raise ValueError("Paired inputs must be distinct files")
    if type(request.get("skip_unclassified_estimation", False)) is not bool:
        raise ValueError("Invalid normalization policy")
    cpus = request.get("cpus", 1)
    if type(cpus) is not int or not 1 <= cpus <= 256:
        raise ValueError("Invalid CPU count")
    return sample, db, index, metadata, reads, cpus


def commands(request, staged_reads):
    sample = request["sample_id"]
    common = ["--db_dir", str(Path(request["db_dir"]).resolve()), "--index", request["db_index"],
              "--offline", "--sample_id", sample]
    if request.get("skip_unclassified_estimation", False):
        common.append("--skip_unclassified_estimation")
    return [
        ["metaphlan", ",".join(staged_reads), "--input_type", "fastq", "--nproc", str(request.get("cpus", 1)),
         "--mapout", "mapping.bz2", "-o", sample + ".metaphlan.tsv", *common],
        # 4.2.5 requires a nonexisting --mapout even when reading an existing
        # mapout. This destination is unused in mapout mode; never pass the
        # existing input here or use --force (which would delete that input).
        ["metaphlan", "mapping.bz2", "--input_type", "mapout", "--mapout", "unused-export-mapout.bz2", "--CAMI_format_output",
         "-o", sample + ".cami.profile", *common],
    ]


def main(request):
    sample, db, index, metadata, reads, _ = validate_request(request)
    version = subprocess.check_output(["metaphlan", "--version"], text=True).strip()
    if not re.search(r"(?<![\d.])" + re.escape(VERSION) + r"(?![\d.])", version):
        raise ValueError("Expected MetaPhlAn " + VERSION + "; got " + version)
    # Fixed input names avoid commas, spaces and metacharacters in the tool's
    # comma-delimited input syntax. They link only to SeqDesk-selected reads.
    staged_reads = []
    for i, raw in enumerate(reads, 1):
        source = Path(raw).resolve()
        dest = Path("input_R" + str(i) + (".fastq.gz" if source.suffix == ".gz" else ".fastq"))
        dest.symlink_to(source)
        staged_reads.append(str(dest))
    executed = commands(request, staged_reads)
    for command in executed:
        subprocess.run(command, check=True)
    for suffix in (".metaphlan.tsv", ".cami.profile"):
        if not Path(sample + suffix).is_file() or not Path(sample + suffix).stat().st_size:
            raise ValueError("MetaPhlAn produced no " + suffix + " output")
    with metadata.open("rb") as handle:
        digest = hashlib.sha256()
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    Path(sample + ".provenance.json").write_text(json.dumps({
        "schemaVersion": 1, "tool": "MetaPhlAn", "version": version,
        "sampleId": sample, "databaseIndex": index, "databaseDirectory": str(db),
        "databaseMetadataSha256": digest.hexdigest(), "inputFiles": [str(Path(p).resolve()) for p in reads],
        "normalization": "classified-taxa" if request.get("skip_unclassified_estimation") else "unclassified-estimation",
        "commands": executed, "cleaningPerformed": False,
        "benchmarkCaveat": "CAMI export uses the database's taxonomy and omits SGB-level rows. Check taxonomic coverage and reference compatibility before OPAL.",
    }, indent=2) + "\n")


if __name__ == "__main__":
    try:
        main(json.loads(base64.b64decode(sys.argv[1], validate=True)))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
