"""Self-test: run the kit on its test data and check the manifest against expected.json."""
from __future__ import annotations

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
    pairs = result.read_table("sample_pairs")
    metrics = result.manifest["metrics"]
    assert len(pairs) == metrics["n_pairs"] > 0
    consecutive = [row for row in pairs if row["consecutive"] == "true"]
    assert len(consecutive) == metrics["n_consecutive_pairs"] > 0
    for row in pairs:
        assert float(row["time_b"]) >= float(row["time_a"]), "pairs run forward in time"
        assert abs(float(row["gap"]) - (float(row["time_b"]) - float(row["time_a"]))) < 1e-9
        assert 0.0 <= float(row["dissimilarity"]) <= 1.0
        assert row["group_a"] == row["group_b"], "within_group_only pairs samples of one group"
    stability = result.read_table("subject_stability")
    assert {row["subject"] for row in stability} <= {row["subject"] for row in pairs}
    assert metrics["n_baseline_pairs"] > 0
    assert 0.0 <= metrics["median_between_subjects"] <= 1.0


def test_jaccard_and_cross_group_pairs(tmp_path):
    result = run_kit(KIT_DIR, tmp_path, params={"metric": "jaccard", "within_group_only": False})
    metrics = result.manifest["metrics"]
    assert metrics["metric"] == "jaccard"
    pairs = result.read_table("sample_pairs")
    assert len(pairs) == metrics["n_pairs"]
    restricted = run_kit(KIT_DIR, tmp_path / "restricted", params={"metric": "jaccard"})
    assert metrics["n_pairs"] >= restricted.manifest["metrics"]["n_pairs"], "lifting the group restriction never removes pairs"
    for row in pairs:
        assert 0.0 <= float(row["dissimilarity"]) <= 1.0
    capped = run_kit(KIT_DIR, tmp_path / "capped", params={"max_gap": 1})
    assert capped.manifest["metrics"]["n_pairs"] < metrics["n_pairs"]
