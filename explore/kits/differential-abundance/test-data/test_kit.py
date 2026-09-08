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
    table = result.read_table("differential_abundance")
    metrics = result.manifest["metrics"]
    assert len(table) == metrics["n_taxa_tested"] > 0
    qs = [float(row["q_value"]) for row in table if row["q_value"] not in ("", "nan")]
    assert qs == sorted(qs), "sorted by q"
    for row in table:
        if row["p_value"] not in ("", "nan"):
            assert float(row["q_value"]) >= float(row["p_value"]) - 1e-12
    assert {row["higher_in"] for row in table} <= {metrics["group_a"], metrics["group_b"], "neither"}


def test_explicit_groups_are_respected(tmp_path):
    result = run_kit(KIT_DIR, tmp_path, params={"group_a": "Stool", "group_b": "Urine"})
    assert result.manifest["metrics"]["group_a"] == "Stool"
    assert result.manifest["metrics"]["group_b"] == "Urine"
