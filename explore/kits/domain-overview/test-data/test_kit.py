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


def test_kit_matches_expected(tmp_path):
    result = run_kit(KIT_DIR, tmp_path)
    assert_expected(result)
    metrics = result.manifest["metrics"]
    domains = metrics["domains"].split("; ")
    assert domains[0] == "Bacteria" and len(domains) == metrics["n_domains"] >= 2
    per_sample = result.read_table("domain_per_sample")
    assert len(per_sample) == metrics["n_samples"]
    for row in per_sample:
        total = sum(float(row[f"{domain.lower()}_pct"]) for domain in domains)
        assert abs(total - 100.0) < 1e-6, "domain shares of a sample sum to 100"
        assert row["dominant_domain"] in domains
    assert "homo sapiens" not in {row["taxon"].lower() for row in result.read_table("top_taxa_per_domain")}, "artifacts are removed before summarising"
    by_group = result.read_table("domain_by_group")
    assert {row["sampletype"] for row in by_group} == {"Urine", "Stool"}
    assert len(by_group) == 2 * metrics["n_domains"]


def test_explicit_and_missing_domain_column(tmp_path):
    result = run_kit(KIT_DIR, tmp_path, params={"domain_column": "superkingdom", "top_n": 3})
    top = result.read_table("top_taxa_per_domain")
    assert max(int(row["rank"]) for row in top) <= 3
    missing = run_kit(KIT_DIR, tmp_path / "missing", params={"domain_column": "not_a_column"})
    assert missing.manifest["metrics"]["domain_column"] == "superkingdom", "falls back to the detected column"
    assert any("not in the table" in note for note in missing.notes)
