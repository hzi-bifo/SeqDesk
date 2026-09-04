#!/usr/bin/env python3
"""Regenerate the subject-timeline golden fixtures from the INDIVO Explorer reference.

The TypeScript port in ``src/lib/explore/views/subject-timeline/`` is checked against
the Python reference implementation (``patients_table`` / ``patient_composition`` /
``patient_highlights`` in ``app/backend/analysis.py`` of the nasim-project checkout)
on a small, fully synthetic workbook produced by INDIVO's own generator
(``make_dummy_data.py``).  No real data is involved.

Everything is built in a temporary directory: the workbook, the SQLite database and
the curation state (seeded from the checkout's ``curation_seed.json``, never from a
locally edited ``curation.json``), so the checkout is left untouched.

Usage (from the SeqDesk repository root)::

    python3 src/lib/explore/__fixtures__/make_subject_timeline_fixture.py \
        --nasim ../nasim-project --seed 7 --samples 100

Outputs (``src/lib/explore/__fixtures__/subject-timeline/``):

    rows.json       the clinical subset (``analysis.clinical()``) as SubjectTimelineRow
                    records carrying RAW read counts (the port recomputes RA itself)
    curation.json   SubjectTimelineCuration: ``classification()`` memberships plus the
                    artifact names removed by ``microbiome()``
    expected.json   reference payloads: patients_table, compositions, highlights
    numeric.json    numpy / pandas / Python numeric-semantics probes for the helpers
    meta.json       provenance: CLI, library versions, counts, ordering caveats

Known ordering caveat (documented in meta.json as well): ``patient_highlights`` breaks
ties in ``pathogens``/``clinical_interest`` by the order of ``curation.pathogen_names()``
(list order, then entry order) and ties in ``flora`` by the iteration order of the
``flora_names()`` *set* (arbitrary per process).  The TypeScript contract only carries
``memberships`` (taxon -> memberships), so the port breaks ties by the insertion order
of the ``memberships`` keys.  This script therefore pins both reference orders to that
same key order (a pure re-ordering of identical name sets) before computing the
expected payloads, and records whether the pure ``pathogen_names()`` order would have
produced a different result for the selected subjects.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "subject-timeline"
REPO_ROOT = HERE.parents[3]
DEFAULT_NASIM = REPO_ROOT.parent / "nasim-project"

PRIMARY_GROUPS = ("Urine", "Ascites")
N_BOTH = 6
N_SINGLE = 2
N_EXTRA_MULTI_LIBRARY = 2
N_EXTRA_ZERO_RETAINED = 2

ROW_COLUMNS = [
    "id_mapped", "patient_clean", "relDay", "sampletype", "taxonName", "taxonID",
    "superkingdom", "numReads", "site", "depletion_code",
]


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--nasim", default=str(DEFAULT_NASIM),
                        help="path to the nasim-project checkout")
    parser.add_argument("--seed", type=int, default=7, help="make_dummy_data.py --seed")
    parser.add_argument("--samples", type=int, default=100,
                        help="make_dummy_data.py --samples")
    parser.add_argument("--out", default=str(OUT_DIR), help="fixture output directory")
    return parser.parse_args()


def import_reference(nasim: Path):
    backend = nasim / "app" / "backend"
    if not (backend / "analysis.py").exists():
        sys.exit(f"ERROR: {nasim} does not look like the nasim-project checkout")
    sys.dont_write_bytecode = True
    for entry in (str(backend), str(nasim)):
        if entry not in sys.path:
            sys.path.insert(0, entry)
    import analysis  # noqa: E402
    import curation  # noqa: E402
    import ingest  # noqa: E402
    return ingest, analysis, curation


# --------------------------------------------------------------------------- #
#  JSON helpers
# --------------------------------------------------------------------------- #
def _is_flat(value) -> bool:
    if isinstance(value, dict):
        return all(not isinstance(v, (dict, list)) for v in value.values())
    if isinstance(value, list):
        return all(not isinstance(v, (dict, list)) for v in value)
    return True


def render(value, indent: int = 0) -> str:
    """Compact-but-diffable JSON: scalar-only containers stay on one line."""
    if not isinstance(value, (dict, list)) or not value or _is_flat(value):
        return json.dumps(value, allow_nan=False, ensure_ascii=False)
    pad = " " * (indent + 1)
    if isinstance(value, dict):
        body = ",\n".join(
            f"{pad}{json.dumps(key, ensure_ascii=False)}: {render(item, indent + 1)}"
            for key, item in value.items()
        )
        return "{\n" + body + "\n" + " " * indent + "}"
    body = ",\n".join(f"{pad}{render(item, indent + 1)}" for item in value)
    return "[\n" + body + "\n" + " " * indent + "]"


def write_json(path: Path, value) -> int:
    text = render(value) + "\n"
    json.loads(text)  # must round-trip
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --------------------------------------------------------------------------- #
#  Row / curation export
# --------------------------------------------------------------------------- #
def scalar_text(value):
    import pandas as pd
    return None if pd.isna(value) else str(value)


def identifier(value):
    import numpy as np
    import pandas as pd
    if pd.isna(value):
        return None
    if isinstance(value, (bool, np.bool_)):
        return str(value)
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    if isinstance(value, (float, np.floating)) and math.isfinite(value) and float(value).is_integer():
        return str(int(value))
    text = str(value).strip()
    return text or None


def number(value):
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"non-finite count {value!r}")
    return int(result) if result.is_integer() and abs(result) < 2 ** 53 else result


def build_rows(clin):
    rows = []
    for record in clin[ROW_COLUMNS].itertuples(index=False, name=None):
        idm, patient, day, sampletype, taxon, taxon_id, superkingdom, reads, site, depletion = record
        rows.append({
            "sample": str(idm),
            "subject": str(patient),
            "timepoint": int(day),
            "group": str(sampletype),
            "taxon": str(taxon),
            "taxonId": identifier(taxon_id),
            "superkingdom": scalar_text(superkingdom),
            "count": number(reads),
            "site": scalar_text(site),
            "protocol": scalar_text(depletion),
        })
    return rows


def export_curation(curation):
    classification = curation.classification()
    memberships = {
        key: [
            {
                "listId": member["list_id"],
                "label": member["label"],
                "role": member["role"],
                "site": member["site"],
                "tier": member["tier"],
                "color": member["color"],
            }
            for member in members
        ]
        for key, members in classification.items()
    }
    return {"memberships": memberships, "artifacts": sorted(curation.artifact_names())}, classification


def pin_role_orders(curation, classification):
    """Make pathogen_names()/flora_names() iterate in classification key order.

    Both are pure re-orderings of the same name sets (asserted). See the module
    docstring for why the golden fixture needs this."""
    first_spelling = {}
    for entry_list in curation._lists():
        for entry in entry_list["entries"]:
            first_spelling.setdefault(curation._name_key(entry["name"]), entry["name"])

    def role_order(role):
        return [
            first_spelling[key]
            for key, members in classification.items()
            if any(member["role"] == role for member in members)
        ]

    pure = {"pathogen": list(curation.pathogen_names()), "flora": sorted(curation.flora_names())}
    pinned = {"pathogen": role_order("pathogen"), "flora": role_order("flora")}
    for role in pinned:
        pure_keys = {curation._name_key(name) for name in pure[role]}
        pinned_keys = {curation._name_key(name) for name in pinned[role]}
        assert pure_keys == pinned_keys, f"{role} name sets differ after pinning"
    curation.pathogen_names = lambda: list(pinned["pathogen"])
    curation.flora_names = lambda: list(pinned["flora"])
    return pure, pinned


# --------------------------------------------------------------------------- #
#  Subject selection
# --------------------------------------------------------------------------- #
def select_subjects(analysis, table):
    patients = table["patients"]
    both = [p["patient"] for p in patients if set(PRIMARY_GROUPS) <= set(p["sampletypes"])][:N_BOTH]
    single = [p["patient"] for p in patients if len(p["sampletypes"]) == 1][:N_SINGLE]
    chosen = list(dict.fromkeys(both + single))
    multi_library, zero_retained = [], []
    for p in patients:
        for sampletype in p["sampletypes"]:
            composition = analysis.patient_composition(p["patient"], sampletype)
            for support in composition["day_support"]:
                if support["n_libraries"] > 1:
                    multi_library.append(p["patient"])
                if support["n_profiled_libraries"] < support["n_libraries"]:
                    zero_retained.append(p["patient"])
    extra_multi = [p for p in dict.fromkeys(multi_library) if p not in chosen][:N_EXTRA_MULTI_LIBRARY]
    chosen += extra_multi
    extra_zero = [p for p in dict.fromkeys(zero_retained) if p not in chosen][:N_EXTRA_ZERO_RETAINED]
    return {
        "both_primary_groups": both,
        "single_group": single,
        "multi_library_day": extra_multi,
        "zero_retained_library_day": extra_zero,
    }


def expected_payloads(analysis, table, selected):
    subjects = list(dict.fromkeys(p for group in selected.values() for p in group))
    sampletypes = {p["patient"]: p["sampletypes"] for p in table["patients"]}
    compositions = {
        f"{subject}|{sampletype}": analysis.patient_composition(subject, sampletype)
        for subject in subjects
        for sampletype in sampletypes[subject]
    }
    highlights = {subject: analysis.patient_highlights(subject) for subject in subjects}
    return subjects, compositions, highlights


# --------------------------------------------------------------------------- #
#  Numeric-semantics probes (numpy pairwise sum, pandas Kahan, round variants)
# --------------------------------------------------------------------------- #
def numeric_probes(analysis):
    import numpy as np
    import pandas as pd

    rng = np.random.default_rng(20260904)

    def draw(n):
        return [float(v) for v in rng.normal(size=n) * 10.0 ** rng.integers(-3, 4, size=n)]

    numpy_sum = []
    for n in (1, 2, 3, 7, 8, 9, 15, 16, 17, 33, 64, 127, 128, 129, 200, 256, 257, 300, 1000, 1025):
        values = draw(n)
        numpy_sum.append({"values": values, "sum": float(np.asarray(values).sum())})
    numpy_sum.append({"values": [-0.0], "sum": float(np.asarray([-0.0]).sum())})

    kahan = []
    for n in (1, 2, 3, 4, 5, 8, 13, 21):
        values = draw(n)
        frame = pd.DataFrame({"key": "g", "value": values})
        kahan.append({
            "values": values,
            "sum": float(frame.groupby("key")["value"].transform("sum").iloc[0]),
            "mean": float(frame.groupby("key")["value"].mean().iloc[0]),
        })

    # The patient_composition pivot path: pivot_table(sum) -> groupby(level).mean()
    # -> sort_index() -> drop(columns) -> sum(axis=1), plus sum(axis=0) for the rank.
    daily_profiles = []
    for n_days, n_taxa in ((1, 3), (1, 9), (1, 20), (2, 9), (3, 12), (5, 30), (11, 16)):
        records = []
        for day in range(n_days):
            for library in range(int(rng.integers(1, 4))):
                for taxon in range(n_taxa):
                    if rng.random() < 0.15:
                        continue  # taxon absent from this library (fill_value=0.0)
                    records.append((day * 7, f"lib{library}", f"t{taxon:02d}",
                                    float(rng.random() * 10.0 ** rng.integers(-3, 3))))
                    if rng.random() < 0.1:
                        records.append((day * 7, f"lib{library}", f"t{taxon:02d}",
                                        float(rng.random())))  # duplicate cell -> aggfunc sum
        frame = pd.DataFrame(records, columns=["relDay", "id_mapped", "taxonName", "RA"])
        per_library = frame.pivot_table(
            index=["relDay", "id_mapped"], columns="taxonName", values="RA",
            aggfunc="sum", fill_value=0.0,
        )
        piv = per_library.groupby(level="relDay").mean().sort_index()
        dropped = [i for i, column in enumerate(piv.columns) if i % 3 == 0]
        other = piv.drop(columns=[piv.columns[i] for i in dropped], errors="ignore").sum(axis=1)
        daily_profiles.append({
            "records": [list(r) for r in records],
            "days": [int(d) for d in piv.index.tolist()],
            "taxa": list(piv.columns),
            "matrix": [[float(v) for v in piv.loc[d].tolist()] for d in piv.index],
            "n_libraries": per_library.groupby(level="relDay").size().astype(int).tolist(),
            "dropped": dropped,
            "other": [float(v) for v in other.tolist()],
            "column_totals": [float(v) for v in piv.sum(axis=0).tolist()],
        })

    values = [0.5, 1.5, 2.5, -0.5, -1.5, 0.125, 0.375, 0.625, 2.675, 1.005, 1.115, 0.45,
              0.55, 0.0078125, 0.0234375, 1e-7, 4.9999995e-7, 3.14159265, 12.3456785,
              0.2345675, 99.9999995, 100.0, 33.333333333333336, 66.66666666666667,
              0.30000000000000004, 1.0000005, 0.15, 0.25, 0.35, 5.55, 8.345, 0.000125]
    python_round = [[v, n, round(v, n)] for v in values for n in (0, 1, 2, 3, 4, 6)]
    numpy_round = [[v, n, float(np.round(v, n))] for v in values for n in (0, 1, 2, 3, 4, 6)]
    read_count = [
        [v, analysis._read_count(v)]
        for v in [123456.0, 1234.5, 0.30000000000000004, 2.5e-7, 123456789012345.6,
                  99999999999999.99, 1e15 + 0.5, 0.1 + 0.7]
    ]
    return {
        "numpy_sum": numpy_sum,
        "kahan": kahan,
        "daily_profiles": daily_profiles,
        "python_round": python_round,
        "numpy_round": numpy_round,
        "read_count": read_count,
    }


# --------------------------------------------------------------------------- #
#  Main
# --------------------------------------------------------------------------- #
def main():
    args = parse_args()
    nasim = Path(args.nasim).resolve()
    out_dir = Path(args.out).resolve()
    ingest, analysis, curation = import_reference(nasim)
    import numpy as np
    import pandas as pd

    with tempfile.TemporaryDirectory(prefix="subject-timeline-fixture-") as tmp:
        tmp_dir = Path(tmp)
        workbook = tmp_dir / "fixture.xlsx"
        generator_cli = [
            sys.executable, "-B", str(nasim / "make_dummy_data.py"),
            "--out", str(workbook), "--seed", str(args.seed), "--samples", str(args.samples),
        ]
        subprocess.run(generator_cli, cwd=str(nasim), check=True)

        db = tmp_dir / "fixture.db"
        ingest.run(workbook, db)

        # Deterministic curation state: seeds only, in a scratch file.
        curation.FILE = tmp_dir / "curation.json"
        curation._STATE = {"data": None, "version": 0}
        analysis.DB = db
        for cache in (analysis._CACHE, analysis._TOP_CACHE, analysis._SIG_CACHE):
            cache["token"] = None

        clin = analysis.clinical()
        rows = build_rows(clin)
        curation_payload, classification = export_curation(curation)

        table = analysis.patients_table()
        selected = select_subjects(analysis, table)
        subjects = list(dict.fromkeys(p for group in selected.values() for p in group))

        # Sensitivity of the pure reference ordering (see module docstring).
        pure_highlights = {}
        for subject in subjects:
            payload = analysis.patient_highlights(subject)
            payload.pop("flora")  # set-ordered in the pure reference: not comparable
            pure_highlights[subject] = payload
        pure, pinned = pin_role_orders(curation, classification)
        subjects, compositions, highlights = expected_payloads(analysis, table, selected)
        pathogen_order_sensitive = any(
            {k: v for k, v in highlights[s].items() if k != "flora"} != pure_highlights[s]
            for s in subjects
        )

        expected = {
            "patients_table": table,
            "compositions": compositions,
            "highlights": highlights,
        }
        numeric = numeric_probes(analysis)

        libraries = int(clin["id_mapped"].nunique())
        meta = {
            "generator": " ".join(["python3", "-B", "make_dummy_data.py", "--out", "<tmp>/fixture.xlsx",
                                   "--seed", str(args.seed), "--samples", str(args.samples)]),
            "fixture_script": " ".join(["python3", HERE.name + "/" + Path(__file__).name, "--nasim",
                                        "<nasim-project>", "--seed", str(args.seed),
                                        "--samples", str(args.samples)]),
            "seed": args.seed,
            "samples": args.samples,
            "python": platform.python_version(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "reference_sha256": {
                "analysis.py": sha256(nasim / "app" / "backend" / "analysis.py"),
                "curation.py": sha256(nasim / "app" / "backend" / "curation.py"),
                "curation_seed.json": sha256(nasim / "app" / "backend" / "curation_seed.json"),
                "ingest.py": sha256(nasim / "app" / "backend" / "ingest.py"),
                "indivo_common.py": sha256(nasim / "indivo_common.py"),
                "make_dummy_data.py": sha256(nasim / "make_dummy_data.py"),
            },
            "n_top_taxa": analysis.N_TOP_TAXA,
            "primary_groups": list(PRIMARY_GROUPS),
            "counts": {
                "clinical_rows": len(rows),
                "libraries": libraries,
                "subjects": len(table["patients"]),
                "artifact_rows": int(clin["likely_artifact"].sum()),
                "curated_names": len(classification),
            },
            "selected_subjects": selected,
            "ordering": {
                "pathogen_names_pinned_to_memberships_key_order": True,
                "flora_names_pinned_to_memberships_key_order": True,
                "pure_pathogen_order_changes_expected_payloads": pathogen_order_sensitive,
                "pure_pathogen_order": pure["pathogen"],
                "pinned_pathogen_order": pinned["pathogen"],
            },
        }

        out_dir.mkdir(parents=True, exist_ok=True)
        sizes = {
            "rows.json": write_json(out_dir / "rows.json", rows),
            "curation.json": write_json(out_dir / "curation.json", curation_payload),
            "expected.json": write_json(out_dir / "expected.json", expected),
            "numeric.json": write_json(out_dir / "numeric.json", numeric),
        }
        meta["fixture_bytes"] = sizes
        sizes["meta.json"] = write_json(out_dir / "meta.json", meta)

    total = sum(sizes.values())
    print(f"[fixture] wrote {out_dir}")
    for name, size in sizes.items():
        print(f"[fixture]   {name}: {size / 1024:.1f} KiB")
    print(f"[fixture] total {total / 1024:.1f} KiB; subjects {len(subjects)} "
          f"({', '.join(subjects)}); pathogen order sensitive: {pathogen_order_sensitive}")


if __name__ == "__main__":
    main()
