"""Real saved summary fixture, plus internal edge-case regression checks."""
import importlib.util
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

KIT_DIR = Path(__file__).resolve().parents[1]
HELPER_LIB = KIT_DIR.parents[1] / "lib" / "python"
sys.path.insert(0, str(HELPER_LIB))
from seqdesk_explore.testing import assert_expected, run_kit  # noqa: E402

spec = importlib.util.spec_from_file_location("fastqc_overview", KIT_DIR / "analysis.py")
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)


@pytest.fixture
def source():
    return pd.read_csv(KIT_DIR / "test-data/inputs/qc.tsv", sep="\t")


def test_saved_cami_summary(tmp_path):
    result = run_kit(KIT_DIR, tmp_path)
    assert_expected(result)
    rows = result.read_table("qc_by_mate")
    assert [row["read_end"] for row in rows] == ["R1", "R2"]
    assert [float(row["mean_quality"]) for row in rows] == [33.7, 31.9]
    assert rows[1]["review_status"] == "Failed checks"
    assert rows[0]["pipeline_run"] == "FASTQC-20260908-001"
    flags = json.loads(result.artifact_path("check_status", "figure", "plotly-json").read_text())
    assert [trace["name"] for trace in flags["data"]] == ["PASS", "WARN", "FAIL"]


@pytest.mark.parametrize("remove", [True, False])
def test_single_end_does_not_invent_r2(source, remove):
    r2 = [key for key in source if key.startswith("r2_")]
    if remove:
        source = source.drop(columns=r2)
    else:
        for key in r2:
            source[key] = None
    rows = kit.prepare_qc(source, "sample_db_id")
    assert rows["read_end"].tolist() == ["R1"]


def test_missing_quality_is_not_zero(source):
    source["r1_avg_quality"] = None
    assert pd.isna(kit.prepare_qc(source, "sample_db_id").iloc[0]["mean_quality"])


def test_incomplete_checks_are_not_passed(source):
    source["r1_pass"], source["r1_warn"], source["r1_fail"] = None, 0, 0
    assert kit.prepare_qc(source, "sample_db_id").iloc[0]["review_status"] == "Unknown"


@pytest.mark.parametrize("value", [-1, 0.5, "not-a-number", float("inf")])
def test_invalid_counts_are_rejected(source, value):
    source["r1_read_count"] = value
    with pytest.raises(ValueError, match="r1_read_count"):
        kit.prepare_qc(source, "sample_db_id")


def test_duplicate_samples_are_rejected(source):
    with pytest.raises(ValueError, match="duplicate samples"):
        kit.prepare_qc(pd.concat([source, source]), "sample_db_id")


def test_wrong_table_explains_required_source(source):
    with pytest.raises(ValueError, match="Choose the FastQC quality summary"):
        kit.prepare_qc(source.drop(columns=["r1_read_count"]), "sample_db_id")


def test_no_measured_values_are_rejected(source):
    for key in source:
        if key.startswith(("r1_", "r2_")):
            source[key] = None
    with pytest.raises(ValueError, match="no measured reads"):
        kit.prepare_qc(source, "sample_db_id")


def test_missing_sample_identity_is_rejected(source):
    source["sample_db_id"] = None
    with pytest.raises(ValueError, match="sample identity"):
        kit.prepare_qc(source, "sample_db_id")


def test_missing_values_do_not_make_partial_totals_look_complete(source, monkeypatch):
    source["r2_read_count"] = None
    source["r2_fail"] = None
    source.attrs["roles"] = {"sample": "sample_db_id"}
    metrics = {}
    monkeypatch.setattr(kit.sx, "load_dataset", lambda _: source)
    monkeypatch.setattr(kit.sx, "save_table", lambda *args, **kwargs: None)
    monkeypatch.setattr(kit.sx, "save_figure", lambda *args, **kwargs: None)
    monkeypatch.setattr(kit.sx, "metric", lambda key, value: metrics.update({key: value}))
    monkeypatch.setattr(kit.sx, "note", lambda _: None)
    monkeypatch.setattr(kit.sx, "finish", lambda: None)
    kit.main()
    assert metrics["total_reads"] is None
    assert metrics["files_with_failed_checks"] is None
    assert metrics["files_with_missing_values"] == 1


def test_unmeasured_sample_is_not_silently_dropped(source):
    empty = source.copy()
    empty["sample_db_id"] = "internal-empty-row"
    for key in empty:
        if key.startswith(("r1_", "r2_")):
            empty[key] = None
    with pytest.raises(ValueError, match="no measured reads"):
        kit.prepare_qc(pd.concat([source, empty]), "sample_db_id")
