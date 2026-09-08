"""Self-test: run the kit on its test data and check the manifest against expected.json."""
from __future__ import annotations

import json
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


NUMERIC_COLUMNS = {"age", "weight_kg", "score", "read_count"}


def test_kit_matches_expected(tmp_path):
    result = run_kit(KIT_DIR, tmp_path)
    assert_expected(result)

    summary = result.read_table("summary")
    assert len(summary) == 9, "one summary row per input column"
    by_column = {row["column"]: row for row in summary}
    assert set(by_column) >= NUMERIC_COLUMNS
    assert by_column["score"]["n"] == "35" and by_column["score"]["n_missing"] == "5"
    assert by_column["sample_id"]["n_unique"] == "40" and by_column["sample_id"]["role"] == "sample"
    assert by_column["condition"]["top_count"] == "20"
    for key in NUMERIC_COLUMNS:
        assert by_column[key]["mean"] != "" and by_column[key]["sd"] != "", key
    assert by_column["notes"]["mean"] == "" and by_column["notes"]["top_value"] != ""

    figure = result.artifact_path("distributions", "figure", "plotly-json")
    document = json.loads(figure.read_text(encoding="utf-8"))
    histogram_traces = [trace for trace in document["data"] if trace.get("type") == "histogram"]
    assert len(histogram_traces) == 4 * 2, "4 numeric columns x 2 groups"


def test_max_columns_limits_panels(tmp_path):
    result = run_kit(KIT_DIR, tmp_path, params={"max_columns": 2})
    assert_expected(result)
    document = json.loads(result.artifact_path("distributions", "figure", "plotly-json").read_text(encoding="utf-8"))
    assert len([trace for trace in document["data"] if trace.get("type") == "histogram"]) == 2 * 2
    assert any("max_columns" in entry for entry in result.notes)
