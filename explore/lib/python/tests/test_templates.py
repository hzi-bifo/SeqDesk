"""Run the Flow templates' steps end to end on small synthetic tables.

Each step runs as the app runs it (``python step.py --run-dir <dir>``), and
the table a step writes is staged as the next step's input, as the runner does.
"""
from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

pytest.importorskip("pandas")
pytest.importorskip("scipy")
pytest.importorskip("matplotlib")

EXPLORE = Path(__file__).resolve().parents[3]
LIB = EXPLORE / "lib" / "python"
TEMPLATES = EXPLORE / "templates"


def column_type(values: list[str]) -> str:
    present = [value for value in values if value != ""]
    if present and all(value in ("true", "false") for value in present):
        return "boolean"
    if present and all(re.fullmatch(r"[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?", value) for value in present):
        return "number"
    return "string"


def stage(run: Path, alias: str, rows: list[dict[str, str]], columns: list[str], roles: dict[str, str] | None = None) -> None:
    (run / "inputs").mkdir(parents=True, exist_ok=True)
    with open(run / "inputs" / f"{alias}.tsv", "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n", quoting=csv.QUOTE_NONE, escapechar="\\")
        writer.writerow(columns)
        for row in rows:
            writer.writerow([row.get(column, "") for column in columns])
    schema = {"schema": {"columns": [{"key": column, "label": column, "type": column_type([row.get(column, "") for row in rows])} for column in columns]}}
    (run / "inputs" / f"{alias}.schema.json").write_text(json.dumps(schema), encoding="utf-8")


def read_tsv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with open(path, encoding="utf-8") as handle:
        reader = csv.DictReader(handle, delimiter="\t", quoting=csv.QUOTE_NONE)
        rows = list(reader)
        return list(reader.fieldnames or []), rows


def substitute(value, slots):
    if isinstance(value, str):
        match = re.fullmatch(r"\{\{([a-z_]+(?:\+[a-z_]+)*)\}\}", value)
        if match:
            parts = [slots[key] for key in match.group(1).split("+")]
            if len(parts) == 1:
                return parts[0]
            return [item for part in parts for item in (part if isinstance(part, list) else [part])]
    return value


def run_template(template_id: str, table: tuple[list[str], list[dict[str, str]]], slots: dict, tmp_path: Path) -> dict[str, dict]:
    template = json.loads((TEMPLATES / template_id / "template.json").read_text(encoding="utf-8"))
    columns, rows = table
    outputs: dict[str, tuple[list[str], list[dict[str, str]]]] = {}
    manifests: dict[str, dict] = {}
    for step in template["steps"]:
        run = tmp_path / step["key"]
        for binding in step["inputs"]:
            if binding.get("source") == "dataset":
                stage(run, binding["alias"], rows, columns)
            else:
                source = binding["from"]
                out_columns, out_rows = outputs[f'{source["step"]}.{source["output"]}']
                stage(run, binding["alias"], out_rows, out_columns)
        params = {key: substitute(value, slots) for key, value in step["params"].items()}
        inputs = {binding["alias"]: {"path": f'inputs/{binding["alias"]}.tsv', "schemaPath": f'inputs/{binding["alias"]}.schema.json', "roles": {}} for binding in step["inputs"]}
        (run / "inputs.json").write_text(json.dumps({"inputs": inputs, "params": params, "outputDir": "outputs"}), encoding="utf-8")
        env = {**os.environ, "PYTHONPATH": str(LIB), "MPLBACKEND": "Agg"}
        result = subprocess.run([sys.executable, str(TEMPLATES / template_id / step["codeFile"]), "--run-dir", str(run)], env=env, capture_output=True, text=True, timeout=120)
        assert result.returncode == 0, f'{step["key"]} failed: {result.stderr}'
        manifest = json.loads((run / "outputs" / "manifest.json").read_text(encoding="utf-8"))
        manifests[step["key"]] = manifest
        for artifact in manifest["artifacts"]:
            if artifact["kind"] == "table":
                outputs[f'{step["key"]}.{artifact["name"]}'] = read_tsv(run / artifact["path"])
        declared = {output["name"] for output in step["outputs"]}
        written = {artifact["name"] for artifact in manifest["artifacts"]} | set(manifest["metrics"])
        assert declared <= written, f'{step["key"]} did not write {declared - written}'
    return manifests


def test_rnaseq_de_template(tmp_path):
    control = ["c1", "c2", "c3"]
    treated = ["t1", "t2", "t3"]
    rows = []
    for index in range(310):
        base = 2 if index < 10 else 200  # the first ten genes are too low to test
        up = index in range(10, 20)
        row = {"gene": f"g{index}"}
        for column_index, sample in enumerate(control + treated):
            value = base + (column_index % 3) * 3
            if up and sample in treated:
                value *= 8
            row[sample] = str(value)
        rows.append(row)
    manifests = run_template("rnaseq-de", (["gene", *control, *treated], rows), {"gene": "gene", "control": control, "treated": treated}, tmp_path)
    assert manifests["filter"]["metrics"]["n_kept"] == 300
    assert manifests["filter"]["drops"][0]["count"] == 10
    assert manifests["filter"]["drops"][0]["reason"] == "fewer than 10 reads in at least 2 samples"
    assert manifests["test"]["metrics"]["n_called"] == 10
    assert manifests["test"]["metricMeta"]["n_called"]["label"] == "DE genes"
    assert [artifact["format"] for artifact in manifests["volcano"]["artifacts"]] == ["png", "svg"]


def test_survey_likert_template(tmp_path):
    rows = []
    for index in range(40):
        group = "day" if index % 2 else "night"
        rows.append({"respondent": f"r{index}", "shift": group, "q_sleep": "5" if group == "day" else "1", "q_team": str(index % 5 + 1), "q_pay": "9" if index == 0 else "3"})
    manifests = run_template("survey-likert", (["respondent", "shift", "q_sleep", "q_team", "q_pay"], rows), {"items": ["q_sleep", "q_team", "q_pay"], "group": "shift"}, tmp_path)
    assert manifests["summary"]["metrics"]["n_respondents"] == 40
    assert manifests["summary"]["drops"][0]["reason"] == "q_pay: answers outside 1 to 5"
    assert manifests["compare"]["metrics"]["n_different"] == 1
    assert manifests["compare"]["notes"] == ["2 groups found: day, night"]
