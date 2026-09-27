#!/usr/bin/env python3
"""Run the Moving Pictures recipe outside SeqDesk, with the real run-folder contract.

Each step gets its own run folder (inputs.json, inputs/<alias>.tsv plus a
schema, outputs/) and runs as `python <step>.py --run-dir <dir>` with
explore/lib/python on PYTHONPATH, as the SeqDesk runner does.
Step outputs (outputs/manifest.json tables) feed the steps that bind them.

  python3 scripts/flow-microbiome/run-standalone.py \
      --data /Users/pmu15/testdata/explore/microbiome-moving-pictures \
      --python <seqdesk-explore-python env>/bin/python \
      --out /Users/pmu15/testdata/explore/microbiome-moving-pictures/standalone-run
"""
import argparse, csv, hashlib, json, os, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent


def is_number(text):
    if text == "":
        return True
    try:
        float(text)
        return True
    except ValueError:
        return False


def write_input(src, delimiter, dest_dir, alias, roles):
    with open(src, newline="") as handle:
        rows = list(csv.reader(handle, delimiter=delimiter))
    header, body = rows[0], rows[1:]
    def kind(i):
        values = {row[i].lower() for row in body}
        if values <= {"true", "false", ""}:
            return "boolean"
        return "number" if all(is_number(row[i]) for row in body) else "string"
    types = [kind(i) for i in range(len(header))]
    (dest_dir / "inputs").mkdir(parents=True, exist_ok=True)
    with open(dest_dir / "inputs" / f"{alias}.tsv", "w", newline="") as handle:
        csv.writer(handle, delimiter="\t", lineterminator="\n").writerows(rows)
    role_of = {column: role for role, column in roles.items()}
    columns = [{"key": key, "label": key, "type": kind, **({"role": role_of[key]} if key in role_of else {})} for key, kind in zip(header, types)]
    (dest_dir / "inputs" / f"{alias}.schema.json").write_text(json.dumps({"schema": {"columns": columns}}, indent=1))
    return {"path": f"inputs/{alias}.tsv", "schemaPath": f"inputs/{alias}.schema.json", "roles": roles, "rowCount": len(body), "name": alias,
            "datasetId": f"standalone:{alias}", "versionId": hashlib.sha256(Path(src).read_bytes()).hexdigest()[:16]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--python", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    recipe = json.loads((HERE / "recipe.json").read_text())
    data, out = Path(args.data), Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    produced = {}  # (step key, output name) -> (tsv path, roles)
    env = {**os.environ, "PYTHONPATH": str(REPO / "explore/lib/python"), "MPLBACKEND": "Agg"}
    for number, step in enumerate(recipe["steps"], start=1):
        run_dir = out / f"{number:02d}-{step['key']}"
        (run_dir / "outputs").mkdir(parents=True)
        inputs = {}
        for alias, source in step["inputs"].items():
            if "table" in source:
                table = recipe["tables"][source["table"]]
                path = data / table["file"]
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                if digest != table["sha256"]:
                    sys.exit(f"{path}: sha256 {digest} does not match recipe.json")
                inputs[alias] = write_input(path, ",", run_dir, alias, table["roles"])
            else:
                path, roles = produced[(source["step"], source["output"])]
                inputs[alias] = write_input(path, "\t", run_dir, alias, roles)
        (run_dir / "inputs.json").write_text(json.dumps({"inputs": inputs, "params": step["params"], "outputDir": "outputs",
            "run": {"id": f"standalone-{step['key']}", "runNumber": f"STANDALONE-{number}", "analysisId": step["key"], "revision": 1}}, indent=1))
        shutil.copy(HERE / step["file"], run_dir / "analysis.py")
        print(f"== step {number}: {step['name']}", flush=True)
        result = subprocess.run([args.python, "analysis.py", "--run-dir", str(run_dir)], cwd=run_dir, env=env)
        if result.returncode != 0:
            sys.exit(f"step {step['key']} failed ({result.returncode})")
        manifest = json.loads((run_dir / "outputs/manifest.json").read_text())
        for artifact in manifest["artifacts"]:
            if artifact.get("kind") == "table":
                produced[(step["key"], artifact["name"])] = (run_dir / artifact["path"], artifact.get("table", {}).get("roles") or {})
        print(json.dumps(manifest["metrics"]), flush=True)


if __name__ == "__main__":
    main()
