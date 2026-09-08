"""Regression fixtures only; not a scientific CAMI benchmark."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

KIT = Path(__file__).resolve().parents[1]
HELPER = KIT.parents[1] / "lib" / "python"
sys.path.insert(0, str(HELPER))
from seqdesk_explore.testing import assert_expected, prepare_run_dir, run_kit

pytest.importorskip("pandas")
pytest.importorskip("plotly")


def test_percentages_are_not_counts_or_renormalised(tmp_path):
    result = run_kit(KIT, tmp_path)
    assert_expected(result)
    assert "count" not in result.artifact("composition")["table"]["roles"]
    rows = result.read_table("composition")
    assert {row["RANK"] for row in rows} == {"species"}
    assert sum(float(row["PERCENTAGE"]) for row in rows if row["sample_db_id"] == "case-db") == 90
    figure = json.loads(result.artifact_path("composition_plot", "figure", "plotly-json").read_text())
    remainder = figure["data"][-1]
    assert remainder["name"] == "Other / unreported"
    assert remainder["y"] == [10.0, 10.0]


@pytest.mark.parametrize("invalid", ["-1", "NaN", "inf", "101"])
def test_rejects_invalid_percentages(tmp_path, invalid):
    run = prepare_run_dir(KIT, tmp_path / "invalid")
    table = run / "inputs" / "profiles.tsv"
    table.write_text(table.read_text().replace("\t60\tcase", f"\t{invalid}\tcase"))
    process = subprocess.run([sys.executable, str(KIT / "analysis.py"), "--run-dir", str(run)],
                             env={**os.environ, "PYTHONPATH": str(HELPER)}, capture_output=True, text=True)
    assert process.returncode != 0
    assert "Relative abundances must be finite percentages" in process.stderr


def test_absent_rank_does_not_fall_back_silently(tmp_path):
    with pytest.raises(AssertionError, match="No rows of rank"):
        run_kit(KIT, tmp_path, params={"rank": "family"})


def test_duplicate_profiles_are_rejected(tmp_path):
    run = prepare_run_dir(KIT, tmp_path / "duplicate")
    table = run / "inputs" / "profiles.tsv"
    table.write_text(table.read_text() + table.read_text().splitlines()[1] + "\n")
    process = subprocess.run([sys.executable, str(KIT / "analysis.py"), "--run-dir", str(run)],
                             env={**os.environ, "PYTHONPATH": str(HELPER)}, capture_output=True, text=True)
    assert process.returncode != 0
    assert "Duplicate sample/taxon" in process.stderr
