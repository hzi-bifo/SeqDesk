#!/usr/bin/env python3

import csv
import re
import sys
from pathlib import Path


EXPECTED_HEADER = ["Metrics", "dataset"]
REQUIRED_METRICS = [
    "number_of_reads",
    "number_of_bases",
    "mean_read_length",
    "median_read_length",
    "n50",
    "mean_qual",
]
POSITIVE_FIXED_ONE_DECIMAL = {
    "number_of_bases",
    "mean_read_length",
    "median_read_length",
    "n50",
}


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"Invalid NanoPlot NanoStats TSV: {message}")


def read_required_metrics(stats_path: Path) -> dict[str, str]:
    try:
        handle = stats_path.open("r", encoding="utf-8", newline="")
    except OSError as error:
        fail(f"could not open {stats_path}: {error}")

    with handle:
        reader = csv.reader(handle, delimiter="\t", strict=True)
        try:
            header = next(reader)
        except StopIteration:
            fail("file is empty")
        except csv.Error as error:
            fail(f"malformed header: {error}")
        if header != EXPECTED_HEADER:
            fail(
                f"header must be exactly {EXPECTED_HEADER!r}, found {header!r}"
            )

        observed: dict[str, str] = {}
        try:
            for row_number, row in enumerate(reader, start=2):
                if len(row) != 2:
                    fail(
                        f"row {row_number} must contain exactly two columns"
                    )
                key, value = row
                if key not in REQUIRED_METRICS:
                    continue
                if key in observed:
                    fail(f"metric {key!r} occurs more than once")
                observed[key] = value
        except csv.Error as error:
            fail(f"malformed row: {error}")

    missing = [key for key in REQUIRED_METRICS if key not in observed]
    if missing:
        fail(f"missing required metrics: {', '.join(missing)}")

    read_count = observed["number_of_reads"]
    if not re.fullmatch(r"[1-9][0-9]*", read_count):
        fail("number_of_reads must be a positive integer")

    for key in REQUIRED_METRICS[1:]:
        value = observed[key]
        if not re.fullmatch(r"[0-9]+\.[0-9]", value):
            fail(f"{key} must use NanoMath's fixed one-decimal format")
        parsed = float(value)
        if key in POSITIVE_FIXED_ONE_DECIMAL and parsed <= 0:
            fail(f"{key} must be positive")
        if key == "mean_qual" and parsed < 0:
            fail("mean_qual must be non-negative")

    for key in ("number_of_bases", "n50"):
        if not float(observed[key]).is_integer():
            fail(f"{key} must describe an integer value")

    return observed


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(
            "Usage: build_nanoplot_summary.py <NanoStats.txt> <sample_id>"
        )
    sample_id = sys.argv[2]
    if not sample_id or any(character in sample_id for character in "\t\r\n"):
        fail("sample_id must be non-empty and TSV-safe")

    metrics = read_required_metrics(Path(sys.argv[1]))
    writer = csv.writer(
        sys.stdout,
        delimiter="\t",
        lineterminator="\n",
    )
    writer.writerow(
        [
            "sample_id",
            "num_reads",
            "total_bases",
            "mean_length",
            "median_length",
            "read_n50",
            "mean_quality",
        ]
    )
    writer.writerow(
        [
            sample_id,
            metrics["number_of_reads"],
            metrics["number_of_bases"],
            metrics["mean_read_length"],
            metrics["median_read_length"],
            metrics["n50"],
            metrics["mean_qual"],
        ]
    )


if __name__ == "__main__":
    main()
