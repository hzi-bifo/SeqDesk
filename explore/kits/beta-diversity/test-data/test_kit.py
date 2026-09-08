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
    coordinates = result.read_table("pcoa_coordinates")
    assert len(coordinates) == 12
    assert {"PC1", "PC2"} <= set(coordinates[0].keys())
    permanova = result.read_table("permanova")
    factors = {row["factor"] for row in permanova}
    assert "sampletype" in factors
    for row in permanova:
        assert 0 <= float(row["R2"]) <= 1
        assert 0 < float(row["p_value"]) <= 1
    metrics = result.manifest["metrics"]
    assert metrics["pc1_variance_pct"] >= metrics["pc2_variance_pct"]


def test_jaccard_distance_runs(tmp_path):
    result = run_kit(KIT_DIR, tmp_path, params={"metric": "jaccard", "permutations": 0})
    assert result.manifest["metrics"]["metric"] == "jaccard"
    permanova = result.read_table("permanova")
    assert all(row["p_value"] in ("", "nan", "None") for row in permanova), "no permutations, no p-value"
