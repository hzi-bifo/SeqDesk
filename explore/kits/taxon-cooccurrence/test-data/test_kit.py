"""Self-test: run the kit on its test data and check the manifest against expected.json."""
from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

KIT_DIR = Path(__file__).resolve().parents[1]
HELPER_LIB = KIT_DIR.parents[1] / "lib" / "python"
if str(HELPER_LIB) not in sys.path:
    sys.path.insert(0, str(HELPER_LIB))

from seqdesk_explore.testing import assert_expected, run_kit  # noqa: E402

pytest.importorskip("pandas")
pytest.importorskip("plotly")
pytest.importorskip("scipy")


def test_kit_matches_expected(tmp_path):
    result = run_kit(KIT_DIR, tmp_path)
    assert_expected(result)
    pairs = result.read_table("cooccurrence_pairs")
    metrics = result.manifest["metrics"]
    n = metrics["n_taxa_tested"]
    assert len(pairs) == metrics["n_pairs"] == n * (n - 1) // 2 > 0
    for row in pairs:
        counts = [int(row[key]) for key in ("n_both", "n_a_only", "n_b_only", "n_neither")]
        assert sum(counts) == metrics["n_samples"], "the four presence counts partition the samples"
        if row["phi"] not in ("", "nan"):
            assert -1 <= float(row["phi"]) <= 1
    qs = [float(row["q_value"]) for row in pairs if row["q_value"] not in ("", "nan")]
    assert qs == sorted(qs), "sorted by q"
    assert {row["relation"] for row in pairs} <= {"co-occur", "exclude", "independent"}
    assert metrics["n_significant"] == metrics["n_cooccur_significant"] + metrics["n_exclude_significant"]


def test_group_restriction_and_threshold(tmp_path):
    result = run_kit(KIT_DIR, tmp_path, params={"group": "Urine", "min_prevalence_pct": 0, "top_n": 8})
    metrics = result.manifest["metrics"]
    assert metrics["group"] == "Urine"
    assert metrics["n_samples"] < 12
    assert metrics["n_taxa_tested"] <= 8
    assert any("Restricted" in note for note in result.notes)
    missing = run_kit(KIT_DIR, tmp_path / "missing", params={"group": "Nowhere"})
    assert missing.manifest["metrics"]["n_samples"] == 12
    assert any("every sample was used" in note for note in missing.notes)
    assert math.isfinite(float(missing.manifest["metrics"]["min_prevalence_pct"]))
