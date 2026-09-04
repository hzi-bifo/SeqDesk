"""Unit tests for the seqdesk_explore helper (no plotly needed)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

import seqdesk_explore as sx

LIB_DIR = Path(sx.__file__).resolve().parents[1]

COLUMNS = [
    {"key": "sample_id", "label": "Sample", "type": "string", "role": "sample"},
    {"key": "reads", "label": "Reads", "type": "number"},
    {"key": "score", "label": "Score", "type": "number"},
    {"key": "passed", "label": "Passed", "type": "boolean"},
    {"key": "collected", "label": "Collected", "type": "date"},
    {"key": "extra", "label": "Extra", "type": "json"},
]

ROWS = [
    ["S1", "10", "1.5", "true", "2026-01-02", '{"a":1}'],
    ["S2", "", "2.25", "false", "", ""],
    ["S3", "30", "", "", "2026-01-04T10:00:00Z", "[1,2]"],
]


def write_run(
    tmp_path: Path,
    *,
    columns=COLUMNS,
    rows=ROWS,
    roles=None,
    params=None,
    curation=None,
    output_dir=None,
    alias="table",
) -> Path:
    run = tmp_path / "run"
    (run / "inputs").mkdir(parents=True)
    header = "\t".join(column["key"] for column in columns)
    body = "\n".join("\t".join(row) for row in rows)
    (run / "inputs" / f"{alias}.tsv").write_text(header + "\n" + body + ("\n" if body else ""), encoding="utf-8")
    (run / "inputs" / f"{alias}.schema.json").write_text(
        json.dumps({"schema": {"columns": columns}, "provenance": {"builtAt": "2026-09-04T00:00:00Z", "builder": "test", "sources": []}, "contentHash": "abc"}),
        encoding="utf-8",
    )
    document = {
        "inputs": {
            alias: {
                "path": f"inputs/{alias}.tsv",
                "schemaPath": f"inputs/{alias}.schema.json",
                "tableKind": "sample-summary",
                "roles": roles if roles is not None else {"sample": "sample_id"},
                "datasetId": "ds1",
                "versionId": "v1",
                "rowCount": len(rows),
                "name": "Unit test table",
            }
        },
        "params": params or {},
        "outputDir": output_dir or "outputs",
        "run": {"id": "run1", "runNumber": "EXP-20260904-001", "analysisId": "an1", "revision": 1},
        "curation": curation or {"lists": []},
    }
    (run / "inputs.json").write_text(json.dumps(document, indent=2), encoding="utf-8")
    return run


@pytest.fixture(autouse=True)
def _fresh_state():
    sx.reset()
    yield
    sx.reset()


# --------------------------------------------------------------------------- #
#  Locating the run
# --------------------------------------------------------------------------- #
def test_run_dir_from_argv(tmp_path, monkeypatch):
    run = write_run(tmp_path)
    monkeypatch.setattr(sys, "argv", ["analysis.py", "--run-dir", str(run)])
    monkeypatch.delenv(sx.RUN_DIR_ENV, raising=False)
    assert sx.run_dir() == run.resolve()


def test_run_dir_from_argv_equals_form(tmp_path, monkeypatch):
    run = write_run(tmp_path)
    monkeypatch.setattr(sys, "argv", ["analysis.py", f"--run-dir={run}"])
    assert sx.run_dir() == run.resolve()


def test_run_dir_from_env_and_cwd(tmp_path, monkeypatch):
    run = write_run(tmp_path)
    monkeypatch.setattr(sys, "argv", ["analysis.py"])
    monkeypatch.setenv(sx.RUN_DIR_ENV, str(run))
    assert sx.run_dir() == run.resolve()
    sx.reset()
    monkeypatch.delenv(sx.RUN_DIR_ENV)
    monkeypatch.chdir(run)
    assert sx.run_dir() == run.resolve()


def test_run_dir_missing_raises(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["analysis.py"])
    monkeypatch.delenv(sx.RUN_DIR_ENV, raising=False)
    monkeypatch.chdir(tmp_path)
    with pytest.raises(sx.ExploreInputError):
        sx.run_dir()
    with pytest.raises(sx.ExploreInputError):
        sx.set_run_dir(tmp_path / "does-not-exist")


def test_load_inputs_missing_file(tmp_path):
    sx.set_run_dir(tmp_path)
    with pytest.raises(sx.ExploreInputError, match="inputs.json"):
        sx.load_inputs()


# --------------------------------------------------------------------------- #
#  Reading inputs
# --------------------------------------------------------------------------- #
def test_load_dataset_dtypes_and_attrs(tmp_path):
    pd = pytest.importorskip("pandas")
    sx.set_run_dir(write_run(tmp_path))
    df = sx.load_dataset("table")
    assert list(df.columns) == [column["key"] for column in COLUMNS]
    assert len(df) == 3
    assert str(df["reads"].dtype) == "Int64"
    assert str(df["score"].dtype) == "float64"
    assert str(df["passed"].dtype) == "boolean"
    assert df["sample_id"].dtype == object
    assert df["reads"].tolist()[0] == 10 and pd.isna(df["reads"].iloc[1])
    assert df["score"].iloc[1] == 2.25 and pd.isna(df["score"].iloc[2])
    assert df["passed"].iloc[0] is True or bool(df["passed"].iloc[0]) is True
    assert pd.isna(df["passed"].iloc[2])
    assert df["collected"].iloc[1] is None
    assert df["extra"].iloc[0] == '{"a":1}'
    assert df.attrs["roles"] == {"sample": "sample_id"}
    assert df.attrs["tableKind"] == "sample-summary"
    assert df.attrs["name"] == "Unit test table"
    assert df.attrs["alias"] == "table"


def test_load_dataset_parse_dates(tmp_path):
    pd = pytest.importorskip("pandas")
    sx.set_run_dir(write_run(tmp_path))
    df = sx.load_dataset("table", parse_dates=True)
    assert pd.api.types.is_datetime64_any_dtype(df["collected"])
    assert pd.isna(df["collected"].iloc[1])
    assert df["collected"].iloc[0].year == 2026


def test_load_dataset_unknown_alias(tmp_path):
    pytest.importorskip("pandas")
    sx.set_run_dir(write_run(tmp_path))
    with pytest.raises(sx.ExploreInputError, match='"missing"'):
        sx.load_dataset("missing")


def test_role_column(tmp_path):
    pytest.importorskip("pandas")
    sx.set_run_dir(write_run(tmp_path, roles={"sample": "sample_id", "count": "not_there"}))
    df = sx.load_dataset("table")
    assert sx.role_column(df, "sample") == "sample_id"
    assert sx.role_column(df, "group", required=False) is None
    assert sx.role_column(df, "count", required=False) is None
    with pytest.raises(sx.ExploreInputError, match="group"):
        sx.role_column(df, "group")
    with pytest.raises(sx.ExploreInputError, match="not_there"):
        sx.role_column(df, "count")


def test_params_and_curation(tmp_path):
    curation = {
        "lists": [
            {"listId": "l1", "label": "Artifacts", "role": "artifact", "site": None, "tier": None, "color": None, "entries": ["Homo sapiens", " Phage X "]},
            {"listId": "l2", "label": "Urine pathogens", "role": "pathogen", "site": "Urine", "tier": "verified", "color": "#f00", "entries": ["Escherichia coli"]},
            {"listId": "l3", "label": "Stool pathogens", "role": "pathogen", "site": "Stool", "tier": None, "color": None, "entries": ["Clostridioides difficile"]},
        ]
    }
    sx.set_run_dir(write_run(tmp_path, params={"top_n": 5, "empty": None}, curation=curation))
    assert sx.params() == {"top_n": 5, "empty": None}
    assert sx.param("top_n", 15) == 5
    assert sx.param("empty", "fallback") == "fallback"
    assert sx.param("absent", 7) == 7
    assert len(sx.curation_lists()) == 3
    assert sx.curated_names("artifact") == {"Homo sapiens", "Phage X"}
    assert sx.curated_names("pathogen", site="Urine") == {"Escherichia coli"}
    assert sx.curated_names() == {"Homo sapiens", "Phage X", "Escherichia coli", "Clostridioides difficile"}
    assert sx.taxon_key("  Homo Sapiens ") == "homo sapiens"


# --------------------------------------------------------------------------- #
#  Writing outputs
# --------------------------------------------------------------------------- #
def test_save_table_and_finish(tmp_path):
    pd = pytest.importorskip("pandas")
    run = write_run(tmp_path)
    sx.set_run_dir(run)
    df = pd.DataFrame(
        {
            "sample_id": ["S1", "S2\tweird", "S3"],
            "reads": pd.array([10, None, 30], dtype="Int64"),
            "score": [1.5, float("nan"), 2.0],
            "passed": pd.array([True, False, None], dtype="boolean"),
        }
    )
    artifact = sx.save_table(df, "summary", title="Summary", description="Per sample", table_kind="sample-summary", roles={"sample": "sample_id", "count": "reads"})
    assert artifact["path"] == "outputs/summary.tsv"
    assert artifact["table"] == {"tableKind": "sample-summary", "roles": {"sample": "sample_id", "count": "reads"}, "rowCount": 3}
    lines = (run / "outputs" / "summary.tsv").read_text(encoding="utf-8").splitlines()
    assert lines[0] == "sample_id\treads\tscore\tpassed"
    assert lines[1] == "S1\t10\t1.5\ttrue"
    assert lines[2] == "S2 weird\t\t\tfalse"
    assert lines[3] == "S3\t30\t2.0\t"
    sx.note("hello")
    sx.metric("n_rows", len(df))
    manifest_path = sx.finish()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["manifestVersion"] == 1
    assert manifest["notes"] == ["hello"]
    assert manifest["metrics"] == {"n_rows": 3}
    assert [entry["name"] for entry in manifest["artifacts"]] == ["summary"]
    assert manifest["artifacts"][0]["kind"] == "table" and manifest["artifacts"][0]["format"] == "tsv"
    assert manifest["artifacts"][0]["title"] == "Summary"


def test_save_table_role_column_must_exist(tmp_path):
    pd = pytest.importorskip("pandas")
    sx.set_run_dir(write_run(tmp_path))
    with pytest.raises(ValueError, match="not in table"):
        sx.save_table(pd.DataFrame({"a": [1]}), "t", roles={"sample": "missing"})
    sx.save_table(pd.DataFrame({"a": [1]}), "t", roles={"mystery": "a"})
    assert any("mystery" in entry for entry in sx._state.notes)


def test_save_report_and_name_sanitization(tmp_path):
    run = write_run(tmp_path)
    sx.set_run_dir(run)
    artifact = sx.save_report_markdown("# Hi", "My Report/../weird name!", title="Report")
    path = run / artifact["path"]
    assert path.is_file() and path.parent == (run / "outputs")
    assert artifact["path"].startswith("outputs/") and "/" not in artifact["path"][len("outputs/") :]
    assert artifact["name"] == "My Report/../weird name!"
    assert artifact["kind"] == "report" and artifact["format"] == "md"
    html = sx.save_report_html("<p>x</p>", "page")
    assert html["format"] == "html" and (run / html["path"]).read_text(encoding="utf-8") == "<p>x</p>"
    with pytest.raises(ValueError):
        sx.save_report_markdown("x", "   ")


def test_save_same_name_replaces_entry(tmp_path):
    sx.set_run_dir(write_run(tmp_path))
    sx.save_report_markdown("one", "report")
    sx.save_report_markdown("two", "report")
    assert len(sx.artifacts()) == 1
    assert (sx.output_dir() / "report.md").read_text(encoding="utf-8") == "two"


def test_output_dir_guards(tmp_path):
    sx.set_run_dir(write_run(tmp_path, output_dir="inputs"))
    with pytest.raises(sx.ExploreInputError, match="inputs"):
        sx.output_dir()
    sx.set_run_dir(write_run(tmp_path / "b", output_dir="../elsewhere"))
    with pytest.raises(sx.ExploreInputError, match="inside"):
        sx.output_dir()
    sx.set_run_dir(write_run(tmp_path / "c", output_dir="results/nested"))
    assert sx.output_dir() == (tmp_path / "c" / "run" / "results" / "nested").resolve()
    assert sx.save_report_markdown("x", "r")["path"] == "results/nested/r.md"


def test_metric_json_safe(tmp_path):
    np = pytest.importorskip("numpy")
    sx.set_run_dir(write_run(tmp_path))
    sx.metric("i", np.int64(3))
    sx.metric("f", np.float64(2.5))
    sx.metric("nan", float("nan"))
    sx.metric("b", np.bool_(True))
    sx.metric("list", [np.int32(1), float("inf")])
    sx.metric("text", "ok")
    assert sx.metrics() == {"i": 3, "f": 2.5, "nan": None, "b": True, "list": [1, None], "text": "ok"}
    with pytest.raises(ValueError):
        sx.metric("", 1)
    manifest = json.loads(sx.finish().read_text(encoding="utf-8"))
    assert manifest["metrics"]["nan"] is None


def test_save_figure_matplotlib(tmp_path):
    matplotlib = pytest.importorskip("matplotlib")
    matplotlib.use("Agg")
    from matplotlib.figure import Figure

    sx.set_run_dir(write_run(tmp_path))
    fig = Figure(figsize=(2, 2))
    fig.add_subplot(111).plot([0, 1], [1, 0])
    entries = sx.save_figure(fig, "line plot", title="Line")
    assert [(entry["kind"], entry["format"], entry["path"]) for entry in entries] == [
        ("figure", "png", "outputs/line_plot.png"),
        ("figure", "svg", "outputs/line_plot.svg"),
    ]
    for entry in entries:
        assert (sx.run_dir() / entry["path"]).stat().st_size > 0


class FakePlotlyFigure:
    """Duck-typed stand-in so the plotly path is covered without plotly."""

    def to_plotly_json(self):
        return {"data": [], "layout": {}}

    def to_json(self):
        return json.dumps(self.to_plotly_json())

    def write_image(self, *args, **kwargs):
        raise RuntimeError("no chrome")


def test_save_figure_plotly_like_without_png(tmp_path):
    run = write_run(tmp_path)
    sx.set_run_dir(run)
    entries = sx.save_figure(FakePlotlyFigure(), "composition", description="Stacked bars")
    assert [(entry["format"], entry["path"]) for entry in entries] == [("plotly-json", "outputs/composition.plotly.json")]
    assert json.loads((run / "outputs" / "composition.plotly.json").read_text(encoding="utf-8")) == {"data": [], "layout": {}}
    assert entries[0]["title"] == "Composition" and entries[0]["description"] == "Stacked bars"
    assert any("PNG export" in entry for entry in sx._state.notes)
    sx.save_figure(FakePlotlyFigure(), "second")
    assert sum("PNG export" in entry for entry in sx._state.notes) == 1, "the kaleido note is given once"
    assert not (run / "outputs" / "composition.png").exists()


def test_save_figure_real_plotly(tmp_path):
    go = pytest.importorskip("plotly.graph_objects")
    run = write_run(tmp_path)
    sx.set_run_dir(run)
    fig = go.Figure(data=[go.Bar(x=["a", "b"], y=[1, 2])])
    entries = sx.save_figure(fig, "bars")
    document = json.loads((run / entries[0]["path"]).read_text(encoding="utf-8"))
    assert document["data"][0]["type"] == "bar"


def test_save_figure_rejects_other_objects(tmp_path):
    sx.set_run_dir(write_run(tmp_path))
    with pytest.raises(TypeError):
        sx.save_figure(object(), "nope")


# --------------------------------------------------------------------------- #
#  Exit behaviour (subprocess)
# --------------------------------------------------------------------------- #
def run_script(run: Path, body: str) -> subprocess.CompletedProcess:
    script = run / "script.py"
    script.write_text(textwrap.dedent(body), encoding="utf-8")
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(LIB_DIR), env.get("PYTHONPATH")]))
    env["SEQDESK_EXPLORE_RUN_DIR"] = str(run)
    env.pop("MPLBACKEND", None)
    return subprocess.run([sys.executable, str(script), "--run-dir", str(run)], cwd=str(run), env=env, capture_output=True, text=True, timeout=120)


def test_manifest_written_without_finish(tmp_path):
    run = write_run(tmp_path)
    process = run_script(
        run,
        """
        import seqdesk_explore as sx
        sx.note("forgot finish")
        sx.metric("answer", 42)
        sx.save_report_markdown("# done", "report")
        """,
    )
    assert process.returncode == 0, process.stderr
    manifest = json.loads((run / "outputs" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["notes"] == ["forgot finish"]
    assert manifest["metrics"] == {"answer": 42}
    assert manifest["artifacts"][0]["path"] == "outputs/report.md"


def test_uncaught_exception_keeps_nonzero_exit(tmp_path):
    run = write_run(tmp_path)
    process = run_script(
        run,
        """
        import seqdesk_explore as sx
        sx.note("before the crash")
        raise ValueError("boom")
        """,
    )
    assert process.returncode != 0
    assert "boom" in process.stderr
    manifest = json.loads((run / "outputs" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["notes"][0] == "before the crash"
    assert any("uncaught exception" in entry and "boom" in entry for entry in manifest["notes"])


def test_finish_after_error_before_helper_use_writes_nothing(tmp_path):
    run = write_run(tmp_path)
    process = run_script(
        run,
        """
        import seqdesk_explore as sx  # never used: no run dir resolved, nothing to write
        raise SystemExit(3)
        """,
    )
    assert process.returncode == 3
    assert not (run / "outputs").exists()
