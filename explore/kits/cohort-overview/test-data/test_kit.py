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
    overview = result.read_table("overview")
    labels = [row["group"] for row in overview]
    assert labels[-1] == "All", "the total row comes last"
    total = overview[-1]
    assert int(total["n_samples"]) == sum(int(row["n_samples"]) for row in overview[:-1])
    subjects = result.read_table("subjects")
    assert len(subjects) == int(total["n_subjects"])
    assert all(float(row["last_timepoint"]) >= float(row["first_timepoint"]) for row in subjects)
