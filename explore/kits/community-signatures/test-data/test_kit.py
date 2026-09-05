"""Self-test: run the kit on its test data and check the manifest against expected.json."""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

import pytest

KIT_DIR = Path(__file__).resolve().parents[1]
HELPER_LIB = KIT_DIR.parents[1] / "lib" / "python"
if str(HELPER_LIB) not in sys.path:
    sys.path.insert(0, str(HELPER_LIB))

from seqdesk_explore.testing import assert_expected, run_kit  # noqa: E402

pytest.importorskip("pandas")
pytest.importorskip("plotly")
pytest.importorskip("sklearn")


def test_kit_matches_expected(tmp_path):
    result = run_kit(KIT_DIR, tmp_path)
    assert_expected(result)
    metrics = result.manifest["metrics"]
    k = metrics["n_signatures"]
    signature_taxa = result.read_table("signature_taxa")
    per_signature = defaultdict(list)
    for row in signature_taxa:
        per_signature[row["signature"]].append(float(row["loading"]))
    assert set(per_signature) == {f"S{index + 1}" for index in range(k)}
    for loadings in per_signature.values():
        assert len(loadings) == 8, "top_taxa rows per signature"
        assert loadings == sorted(loadings, reverse=True), "ranked by loading"
        assert sum(loadings) <= 1.0 + 1e-9
    samples = result.read_table("sample_signatures")
    assert len(samples) == metrics["n_samples"]
    for row in samples:
        shares = [float(row[f"S{index + 1}_share"]) for index in range(k)]
        assert abs(sum(shares) - 1.0) < 1e-6, "shares of a sample sum to 1"
        assert row["dominant_signature"] == f"S{shares.index(max(shares)) + 1}"
        assert abs(float(row["dominant_share"]) - max(shares)) < 1e-9
    assert metrics["reconstruction_error"] >= 0
    assert metrics["signatures"].startswith("S1: ")


def test_signature_count_is_capped_and_seeded(tmp_path):
    result = run_kit(KIT_DIR, tmp_path, params={"n_signatures": 20, "transform": "none"})
    metrics = result.manifest["metrics"]
    assert metrics["n_signatures_requested"] == 20
    assert metrics["n_signatures"] < 20
    assert any("Reduced" in note for note in result.notes)
    again = run_kit(KIT_DIR, tmp_path / "again", params={"n_signatures": 20, "transform": "none"})
    assert again.manifest["metrics"]["signatures"] == metrics["signatures"], "the same seed gives the same signatures"
