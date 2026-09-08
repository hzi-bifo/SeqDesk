"""Self-test: run the kit on its test data and check the manifest against expected.json."""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import pytest

KIT_DIR = Path(__file__).resolve().parents[1]
HELPER_LIB = KIT_DIR.parents[1] / "lib" / "python"
if str(HELPER_LIB) not in sys.path:
    sys.path.insert(0, str(HELPER_LIB))

from seqdesk_explore.testing import assert_expected, assert_manifest_shape, run_kit  # noqa: E402

pytest.importorskip("pandas")
pytest.importorskip("plotly")


ARTIFACTS = {"homo sapiens", "pseudomonas phage phikz"}


def test_kit_matches_expected(tmp_path):
    result = run_kit(KIT_DIR, tmp_path)
    assert_expected(result)

    composition = result.read_table("composition")
    taxa = {row["speciesName"].casefold() for row in composition}
    assert not (taxa & ARTIFACTS), "artifact taxa must be removed"
    assert not ({"escherichia", "bacteroides"} & taxa), "genus-level rows must be filtered out by the rank parameter"
    totals = defaultdict(float)
    for row in composition:
        totals[row["sample_db_id"]] += float(row["relative_abundance_pct"])
    assert len(totals) == 12
    assert all(abs(total - 100.0) < 1e-6 for total in totals.values()), "renormalised abundances sum to 100 per sample"
    table = result.artifact("composition")["table"]
    assert table["tableKind"] == "taxon-profile-long"
    assert table["roles"] == {
        "sample": "sample_db_id",
        "taxon": "speciesName",
        "count": "numReads",
        "value": "relative_abundance_pct",
        "group": "sampletype",
        "subject": "subject",
        "timepoint": "relDay",
        "taxon_id": "speciesTaxID",
    }
    order = []
    for row in composition:
        key = (row["sampletype"], row["subject"], float(row["relDay"]))
        if not order or order[-1] != key:
            order.append(key)
    assert order == sorted(order), "samples ordered by group, subject, timepoint"

    prevalence = result.read_table("prevalence")
    assert prevalence[0]["is_top"] == "true"
    means = [float(row["mean_relative_abundance_pct"]) for row in prevalence]
    assert means == sorted(means, reverse=True)
    assert abs(sum(means) - 100.0) < 1e-6, "mean relative abundances over all taxa sum to 100"
    assert sum(row["is_top"] == "true" for row in prevalence) == 15

    figure = json.loads(result.artifact_path("composition_plot", "figure", "plotly-json").read_text(encoding="utf-8"))
    bars = [trace for trace in figure["data"] if trace.get("type") == "bar"]
    assert len(bars) == 16 and bars[-1]["name"] == "Other"
    assert any("artifact" in entry.lower() for entry in result.notes)


def test_top_n_and_min_abundance(tmp_path):
    result = run_kit(KIT_DIR, tmp_path, params={"top_n": 5, "min_relative_abundance_pct": 5})
    assert_manifest_shape(result.manifest, result.run_dir)
    assert result.metric("top_n_effective") == 5
    assert result.metric("n_rows_below_min_ra") > 0
    composition = result.read_table("composition")
    assert all(float(row["relative_abundance_pct"]) >= 5 for row in composition)
    figure = json.loads(result.artifact_path("composition_plot", "figure", "plotly-json").read_text(encoding="utf-8"))
    assert len([trace for trace in figure["data"] if trace.get("type") == "bar"]) == 6
