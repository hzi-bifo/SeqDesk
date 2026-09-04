"""Test support for Explore kits.

Every kit ships ``test-data/`` with a synthetic run (``inputs.json`` plus the
input tables) and ``expected.json`` describing what the kit must produce.
The helpers here turn that into a pytest check::

    from seqdesk_explore.testing import run_kit, assert_expected

    def test_kit(tmp_path):
        result = run_kit(KIT_DIR, tmp_path)
        assert_expected(result)

``expected.json`` format::

    {
      "artifacts": [{"name": "summary", "kind": "table", "format": "tsv"}, ...],
      "metrics": {
        "n_rows": 40,                                  # exact (floats: relative 1e-6)
        "mean_reads": {"approx": 12345.6, "tol": 0.5}, # absolute tolerance
        "coverage_pct": {"min": 90, "max": 100}        # inclusive range
      },
      "notes_contain": ["kaleido"],                    # case-insensitive substrings
      "notes_absent": ["skipped"]
    }
"""
from __future__ import annotations

import csv
import json
import math
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

HELPER_LIB_DIR = Path(__file__).resolve().parents[1]


@dataclass
class KitRunResult:
    kit_dir: Path
    run_dir: Path
    manifest: dict[str, Any]
    expected: dict[str, Any]
    process: subprocess.CompletedProcess[str]
    notes: list[str] = field(init=False)

    def __post_init__(self) -> None:
        self.notes = [str(entry) for entry in self.manifest.get("notes") or []]

    def artifact(self, name: str, kind: str | None = None, fmt: str | None = None) -> dict[str, Any]:
        for entry in self.manifest.get("artifacts") or []:
            if entry.get("name") != name:
                continue
            if kind is not None and entry.get("kind") != kind:
                continue
            if fmt is not None and entry.get("format") != fmt:
                continue
            return entry
        raise AssertionError(f"artifact {name!r} (kind={kind}, format={fmt}) not in manifest")

    def artifact_path(self, name: str, kind: str | None = None, fmt: str | None = None) -> Path:
        return self.run_dir / self.artifact(name, kind, fmt)["path"]

    def read_table(self, name: str) -> list[dict[str, str]]:
        """Rows of a TSV artifact as dicts of strings (empty string = null)."""
        path = self.artifact_path(name, "table", "tsv")
        with path.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t", quoting=csv.QUOTE_NONE)
            return [dict(row) for row in reader]

    def metric(self, key: str) -> Any:
        metrics = self.manifest.get("metrics") or {}
        assert key in metrics, f"metric {key!r} missing (have: {sorted(metrics)})"
        return metrics[key]


def prepare_run_dir(kit_dir: Path, run_dir: Path) -> Path:
    """Copy the kit's ``test-data`` run (inputs.json and inputs/) into ``run_dir``."""
    test_data = kit_dir / "test-data"
    inputs_json = test_data / "inputs.json"
    if not inputs_json.is_file():
        raise FileNotFoundError(f"{inputs_json} not found")
    run_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(inputs_json, run_dir / "inputs.json")
    inputs_dir = test_data / "inputs"
    if inputs_dir.is_dir():
        shutil.copytree(inputs_dir, run_dir / "inputs", dirs_exist_ok=True)
    return run_dir


def kit_manifest(kit_dir: Path) -> dict[str, Any]:
    return json.loads((kit_dir / "kit.json").read_text(encoding="utf-8"))


def run_kit(
    kit_dir: str | os.PathLike[str],
    tmp_path: str | os.PathLike[str],
    *,
    python: str | None = None,
    params: dict[str, Any] | None = None,
    timeout: float = 600,
) -> KitRunResult:
    """Execute the kit's entrypoint on its test data in a fresh run folder.

    ``params`` overrides entries of ``inputs.json``'s ``params`` for this run.
    Fails the test when the process exits non-zero or writes no manifest.
    """
    kit_dir = Path(kit_dir).resolve()
    run_dir = prepare_run_dir(kit_dir, Path(tmp_path) / "run")
    if params:
        inputs_path = run_dir / "inputs.json"
        document = json.loads(inputs_path.read_text(encoding="utf-8"))
        document["params"] = {**(document.get("params") or {}), **params}
        inputs_path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    manifest = kit_manifest(kit_dir)
    entrypoint = kit_dir / manifest.get("entrypoint", "analysis.py")
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(HELPER_LIB_DIR), env.get("PYTHONPATH")]))
    env["SEQDESK_EXPLORE_RUN_DIR"] = str(run_dir)
    env.setdefault("MPLBACKEND", "Agg")
    process = subprocess.run(
        [python or sys.executable, str(entrypoint), "--run-dir", str(run_dir)],
        cwd=str(run_dir),
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    assert process.returncode == 0, (
        f"{entrypoint.name} exited with {process.returncode}\n--- stdout ---\n{process.stdout}\n--- stderr ---\n{process.stderr}"
    )
    manifest_path = run_dir / "outputs" / "manifest.json"
    assert manifest_path.is_file(), f"no manifest written\n--- stderr ---\n{process.stderr}"
    result_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_path = kit_dir / "test-data" / "expected.json"
    expected = json.loads(expected_path.read_text(encoding="utf-8")) if expected_path.is_file() else {}
    return KitRunResult(kit_dir=kit_dir, run_dir=run_dir, manifest=result_manifest, expected=expected, process=process)


def _check_artifact_file(path: Path, fmt: str) -> None:
    assert path.is_file(), f"artifact file missing: {path}"
    assert path.stat().st_size > 0, f"artifact file is empty: {path}"
    if fmt == "plotly-json":
        document = json.loads(path.read_text(encoding="utf-8"))
        assert isinstance(document, dict) and "data" in document, f"{path} is not a plotly figure"
    elif fmt == "tsv":
        header = path.read_text(encoding="utf-8").splitlines()[0]
        assert header.strip(), f"{path} has no header"
    elif fmt == "md":
        assert path.read_text(encoding="utf-8").strip(), f"{path} is empty"


def _check_metric(key: str, actual: Any, spec: Any) -> None:
    if isinstance(spec, dict):
        if "approx" in spec:
            tol = float(spec.get("tol", 1e-6))
            assert actual is not None and abs(float(actual) - float(spec["approx"])) <= tol, (
                f"metric {key}: {actual!r} not within {tol} of {spec['approx']}"
            )
        if "min" in spec:
            assert actual is not None and float(actual) >= float(spec["min"]), f"metric {key}: {actual!r} < {spec['min']}"
        if "max" in spec:
            assert actual is not None and float(actual) <= float(spec["max"]), f"metric {key}: {actual!r} > {spec['max']}"
        if "equals" in spec:
            assert actual == spec["equals"], f"metric {key}: {actual!r} != {spec['equals']!r}"
        return
    if isinstance(spec, bool) or spec is None or isinstance(spec, str):
        assert actual == spec, f"metric {key}: {actual!r} != {spec!r}"
        return
    if isinstance(spec, (int, float)):
        assert actual is not None, f"metric {key} is null, expected {spec}"
        assert math.isclose(float(actual), float(spec), rel_tol=1e-6, abs_tol=1e-9), f"metric {key}: {actual!r} != {spec!r}"
        return
    assert actual == spec, f"metric {key}: {actual!r} != {spec!r}"


def assert_manifest_shape(manifest: dict[str, Any], run_dir: Path) -> None:
    """Structural checks every manifest must pass, independent of the kit."""
    assert manifest.get("manifestVersion") == 1, "manifestVersion must be 1"
    assert isinstance(manifest.get("artifacts"), list), "artifacts must be a list"
    assert isinstance(manifest.get("notes"), list), "notes must be a list"
    assert isinstance(manifest.get("metrics"), dict), "metrics must be an object"
    seen: set[tuple[str, str, str]] = set()
    for entry in manifest["artifacts"]:
        for key in ("name", "kind", "format", "path"):
            assert isinstance(entry.get(key), str) and entry[key], f"artifact {entry!r}: missing {key}"
        assert entry["kind"] in ("figure", "table", "report"), f"artifact {entry['name']}: bad kind {entry['kind']}"
        assert not entry["path"].startswith("/") and ".." not in entry["path"].split("/"), f"artifact path must be relative: {entry['path']}"
        assert entry["path"].startswith("outputs/"), f"artifact path must live under outputs/: {entry['path']}"
        key = (entry["name"], entry["kind"], entry["format"])
        assert key not in seen, f"duplicate artifact {key}"
        seen.add(key)
        _check_artifact_file(run_dir / entry["path"], entry["format"])
        if entry["kind"] == "table":
            table = entry.get("table")
            assert isinstance(table, dict) and isinstance(table.get("roles"), dict), f"table artifact {entry['name']} needs table.roles"


def assert_expected(result: KitRunResult) -> None:
    """Check a run against the kit's ``expected.json``."""
    assert_manifest_shape(result.manifest, result.run_dir)
    expected = result.expected
    for wanted in expected.get("artifacts") or []:
        entry = result.artifact(wanted["name"], wanted.get("kind"), wanted.get("format"))
        _check_artifact_file(result.run_dir / entry["path"], entry["format"])
    metrics = result.manifest.get("metrics") or {}
    for key, spec in (expected.get("metrics") or {}).items():
        assert key in metrics, f"metric {key!r} missing (have: {sorted(metrics)})"
        _check_metric(key, metrics[key], spec)
    notes_text = "\n".join(result.notes).lower()
    for needle in expected.get("notes_contain") or []:
        assert str(needle).lower() in notes_text, f"expected a note containing {needle!r}; notes: {result.notes}"
    for needle in expected.get("notes_absent") or []:
        assert str(needle).lower() not in notes_text, f"unexpected note containing {needle!r}; notes: {result.notes}"
