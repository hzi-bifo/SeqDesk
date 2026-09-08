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
    alpha = result.read_table("alpha_diversity")
    assert len(alpha) == 12
    for row in alpha:
        richness = int(row["richness"])
        shannon = float(row["shannon"])
        assert 0 <= shannon <= math.log(max(richness, 1)) + 1e-9, "Shannon is bounded by ln(richness)"
        assert 0 <= float(row["simpson"]) < 1
    tests = result.read_table("alpha_tests")
    assert any(row["test"] == "kruskal-wallis" for row in tests)
    assert all(float(row["q_value"]) >= float(row["p_value"]) - 1e-12 for row in tests if row["q_value"] not in ("", "nan"))


def test_richness_metric_switches_the_figures(tmp_path):
    result = run_kit(KIT_DIR, tmp_path, params={"metric": "richness"})
    assert result.manifest["metrics"]["index"] == "richness"
    assert result.artifact("alpha_diversity")["table"]["roles"]["value"] == "richness"
