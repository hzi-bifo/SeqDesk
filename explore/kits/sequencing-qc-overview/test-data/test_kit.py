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



def test_kit_matches_expected(tmp_path):
    result = run_kit(KIT_DIR, tmp_path)
    assert_expected(result)

    qc = result.read_table("qc_table")
    assert len(qc) == 18
    by_sample = {row["sample_label"]: row for row in qc}
    assert by_sample["S011"]["n_runs"] == "2", "S011 was sequenced on two runs"
    assert by_sample["S018"]["no_reads"] == "true" and by_sample["S018"]["total_reads"] == ""
    assert by_sample["S018"]["low_yield"] == "false", "a sample without counts is not low yield"
    low = sorted(label for label, row in by_sample.items() if row["low_yield"] == "true")
    assert low == ["S005", "S014"]
    assert result.artifact("qc_table")["table"]["roles"] == {"sample": "sample_db_id", "count": "total_reads"}

    runs = result.read_table("runs")
    assert [row["run_id"] for row in runs] == ["RUN-2026-001", "RUN-2026-002", "RUN-2026-003"]
    assert runs[2]["q30_score"] == "", "run 3 has no Q30 score"
    assert any("RUN-2026-003" in entry for entry in result.notes)

    figure = json.loads(result.artifact_path("reads_per_sample", "figure", "plotly-json").read_text(encoding="utf-8"))
    assert len([trace for trace in figure["data"] if trace.get("type") == "bar"]) == 3, "one stacked trace per run"


def test_degrades_without_optional_columns(tmp_path):
    """Strip run and quality columns: the kit must still succeed and note the skipped panels."""
    from seqdesk_explore.testing import prepare_run_dir

    run_dir = prepare_run_dir(KIT_DIR, tmp_path / "stripped")
    table = run_dir / "inputs" / "sequencing.tsv"
    lines = table.read_text(encoding="utf-8").splitlines()
    header = lines[0].split("\t")
    drop = {"run_id", "avg_quality_1", "avg_quality_2", "q30_score"}
    keep = [index for index, key in enumerate(header) if key not in drop]
    table.write_text("\n".join("\t".join(line.split("\t")[index] for index in keep) for line in lines) + "\n", encoding="utf-8")
    schema_path = run_dir / "inputs" / "sequencing.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    schema["schema"]["columns"] = [column for column in schema["schema"]["columns"] if column["key"] not in drop]
    schema_path.write_text(json.dumps(schema), encoding="utf-8")

    import os
    import subprocess

    env = dict(os.environ, PYTHONPATH=str(HELPER_LIB), SEQDESK_EXPLORE_RUN_DIR=str(run_dir))
    process = subprocess.run([sys.executable, str(KIT_DIR / "analysis.py"), "--run-dir", str(run_dir)], cwd=run_dir, env=env, capture_output=True, text=True)
    assert process.returncode == 0, process.stderr
    manifest = json.loads((run_dir / "outputs" / "manifest.json").read_text(encoding="utf-8"))
    names = {(entry["name"], entry["format"]) for entry in manifest["artifacts"]}
    assert ("reads_per_sample", "plotly-json") in names and ("qc_table", "tsv") in names
    assert ("quality_by_run", "plotly-json") not in names and ("runs", "tsv") not in names
    notes = "\n".join(manifest["notes"])
    assert "quality_by_run" in notes and "runs table" in notes
    assert manifest["metrics"]["n_samples"] == 18 and "n_runs" not in manifest["metrics"]
