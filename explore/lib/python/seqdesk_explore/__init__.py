"""Helper library for SeqDesk Explore kits.

An Explore kit is a small script that the app executes inside a prepared run
folder::

    python analysis.py --run-dir <runDir>

The run folder holds ``inputs.json`` (which datasets were attached, their
column roles, the parameters and the curation lists), one TSV plus one schema
file per input under ``inputs/`` and receives everything the kit produces
under ``outputs/``.  This module reads the first half of that contract and
writes the second half (``outputs/manifest.json``) so a kit only has to do
the analysis::

    import seqdesk_explore as sx

    df = sx.load_dataset("profiles")
    sample = sx.role_column(df, "sample")
    ...
    sx.save_table(summary, "summary", title="Per-sample summary")
    sx.save_figure(fig, "composition", title="Composition")
    sx.metric("n_samples", df[sample].nunique())
    sx.finish()

The manifest is also written from an ``atexit`` hook, so a script that forgets
``finish()`` still leaves a manifest behind.  An uncaught exception keeps its
non-zero exit code; the app treats that as a failed run.

Third-party libraries are imported lazily: importing this module needs nothing
beyond the standard library, ``load_dataset``/``save_table`` need pandas, and
figure export only needs the library the figure was made with (plotly or
matplotlib; kaleido is optional for PNG export of plotly figures).
"""
from __future__ import annotations

import atexit
import importlib.util
import json
import math
import os
import re
import sys
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any, Iterable, Mapping

if TYPE_CHECKING:  # pragma: no cover - typing only
    import pandas as pd

__version__ = "0.1.0"

MANIFEST_VERSION = 1

#: Column roles known to the app (mirrors ``EXPLORE_ROLES`` in
#: ``src/lib/explore/types.ts``).  Unknown roles are accepted but noted.
EXPLORE_ROLES: tuple[str, ...] = (
    "sample",
    "subject",
    "timepoint",
    "group",
    "taxon",
    "taxon_id",
    "rank",
    "value",
    "count",
    "date",
)

ARTIFACT_KINDS = ("figure", "table", "report")
ARTIFACT_FORMATS = ("plotly-json", "png", "svg", "html", "tsv", "md")

RUN_DIR_ENV = "SEQDESK_EXPLORE_RUN_DIR"
RUN_DIR_FLAG = "--run-dir"

__all__ = [
    "ExploreInputError",
    "EXPLORE_ROLES",
    "MANIFEST_VERSION",
    "run_dir",
    "set_run_dir",
    "reset",
    "load_inputs",
    "input_info",
    "params",
    "param",
    "curation_lists",
    "curated_names",
    "taxon_key",
    "curated_memberships",
    "curated_role",
    "load_schema",
    "load_dataset",
    "role_column",
    "roles",
    "output_dir",
    "save_figure",
    "save_table",
    "save_report_markdown",
    "save_report_html",
    "note",
    "metric",
    "metrics",
    "artifacts",
    "log",
    "finish",
]


class ExploreInputError(RuntimeError):
    """Raised when the run folder or an input does not match the contract."""


# --------------------------------------------------------------------------- #
#  Run state
# --------------------------------------------------------------------------- #
class _State:
    def __init__(self) -> None:
        self.run_dir: Path | None = None
        self.inputs: dict[str, Any] | None = None
        self.artifacts: list[dict[str, Any]] = []
        self.notes: list[str] = []
        self.metrics: dict[str, Any] = {}
        self.finished = False
        self.dirty = False
        self.png_warning_given = False
        self.curation_index: dict[str, list[dict[str, Any]]] | None = None


_state = _State()


def reset() -> None:
    """Forget everything (run dir, registered artifacts, notes, metrics).

    Meant for tests and notebooks that drive several runs from one process.
    """
    global _state
    _state = _State()


def set_run_dir(path: str | os.PathLike[str]) -> Path:
    """Point the helper at ``path`` and start a fresh run state."""
    reset()
    resolved = Path(path).expanduser().resolve()
    if not resolved.is_dir():
        raise ExploreInputError(f"Run directory does not exist: {resolved}")
    _state.run_dir = resolved
    return resolved


def _run_dir_from_argv(argv: list[str]) -> str | None:
    for index, arg in enumerate(argv):
        if arg == RUN_DIR_FLAG and index + 1 < len(argv):
            return argv[index + 1]
        if arg.startswith(RUN_DIR_FLAG + "="):
            return arg[len(RUN_DIR_FLAG) + 1 :]
    return None


def run_dir() -> Path:
    """The run folder: ``--run-dir`` on the command line, else the
    ``SEQDESK_EXPLORE_RUN_DIR`` environment variable, else the working
    directory when it contains an ``inputs.json``."""
    if _state.run_dir is not None:
        return _state.run_dir
    candidate = _run_dir_from_argv(sys.argv[1:]) or os.environ.get(RUN_DIR_ENV, "").strip() or None
    if candidate is None and (Path.cwd() / "inputs.json").is_file():
        candidate = str(Path.cwd())
    if candidate is None:
        raise ExploreInputError(
            f"No run directory: pass {RUN_DIR_FLAG} <dir>, set {RUN_DIR_ENV}, "
            "or run from a directory that contains inputs.json"
        )
    resolved = Path(candidate).expanduser().resolve()
    if not resolved.is_dir():
        raise ExploreInputError(f"Run directory does not exist: {resolved}")
    _state.run_dir = resolved
    return resolved


# --------------------------------------------------------------------------- #
#  Reading the contract
# --------------------------------------------------------------------------- #
def load_inputs() -> dict[str, Any]:
    """The parsed ``inputs.json`` of the run (cached)."""
    if _state.inputs is not None:
        return _state.inputs
    path = run_dir() / "inputs.json"
    if not path.is_file():
        raise ExploreInputError(f"inputs.json not found in run directory {run_dir()}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ExploreInputError(f"inputs.json is not valid JSON: {error}") from error
    if not isinstance(data, dict):
        raise ExploreInputError("inputs.json must contain a JSON object")
    data.setdefault("inputs", {})
    if not isinstance(data["inputs"], dict):
        raise ExploreInputError('inputs.json: "inputs" must be an object keyed by alias')
    _state.inputs = data
    return data


def input_info(alias: str) -> dict[str, Any]:
    """The ``inputs.json`` entry of one input alias."""
    entries = load_inputs()["inputs"]
    entry = entries.get(alias)
    if entry is None:
        known = ", ".join(sorted(entries)) or "none"
        raise ExploreInputError(f'Input "{alias}" is not attached to this run (attached: {known})')
    if not isinstance(entry, dict):
        raise ExploreInputError(f'inputs.json: entry for "{alias}" must be an object')
    return entry


def params() -> dict[str, Any]:
    """The kit parameters chosen for this run (``{}`` when none)."""
    value = load_inputs().get("params")
    return dict(value) if isinstance(value, dict) else {}


def param(name: str, default: Any = None) -> Any:
    """One parameter, falling back to ``default`` when absent or null."""
    value = params().get(name)
    return default if value is None else value


def curation_lists() -> list[dict[str, Any]]:
    """The curation lists attached to the run (pathogen, flora, artifact...)."""
    curation = load_inputs().get("curation")
    lists = curation.get("lists") if isinstance(curation, dict) else None
    return [entry for entry in lists if isinstance(entry, dict)] if isinstance(lists, list) else []


def curated_names(role: str | None = None, *, site: str | None = None) -> set[str]:
    """Union of the entries of every curation list with the given ``role``
    (and ``site`` when given).  Names are returned as written; use
    :func:`taxon_key` to compare them with dataset values."""
    names: set[str] = set()
    for entry in curation_lists():
        if role is not None and entry.get("role") != role:
            continue
        if site is not None and entry.get("site") not in (None, site):
            continue
        for name in entry.get("entries") or []:
            if isinstance(name, str) and name.strip():
                names.add(name.strip())
    return names


def taxon_key(value: Any) -> str:
    """Canonical key for matching taxon names against curation lists
    (whitespace-trimmed, case-folded), as INDIVO does."""
    return str(value).strip().casefold()


_ROLE_ORDER = {"pathogen": 0, "flora": 1, "artifact": 2}


def _curation_index() -> dict[str, list[dict[str, Any]]]:
    """``taxon_key`` -> the lists that name it, built once per run."""
    if _state.curation_index is None:
        index: dict[str, list[dict[str, Any]]] = {}
        for entry in curation_lists():
            membership = {
                "listId": entry.get("listId"),
                "label": entry.get("label"),
                "role": entry.get("role"),
                "site": entry.get("site"),
                "tier": entry.get("tier"),
                "color": entry.get("color"),
            }
            for name in entry.get("entries") or []:
                if isinstance(name, str) and name.strip():
                    index.setdefault(taxon_key(name), []).append(membership)
        _state.curation_index = index
    return _state.curation_index


def curated_memberships(name: Any, *, site: str | None = None) -> list[dict[str, Any]]:
    """The curation lists ``name`` is on (matched with :func:`taxon_key`), each as
    ``{"listId", "label", "role", "site", "tier", "color"}``.  Pathogen lists come
    first, then flora, then artifact; with ``site`` given, lists for that site or
    for no site come before lists for other sites."""
    found = _curation_index().get(taxon_key(name), [])

    def order(item: dict[str, Any]) -> tuple[int, int, str]:
        other_site = 1 if site is not None and item.get("site") not in (None, site) else 0
        return (_ROLE_ORDER.get(str(item.get("role")), 9), other_site, str(item.get("label") or ""))

    return sorted(found, key=order)


def curated_role(name: Any, *, site: str | None = None) -> str | None:
    """The most relevant curated role of ``name`` (pathogen before flora before
    artifact), or None when it is on no list."""
    memberships = curated_memberships(name, site=site)
    role = memberships[0].get("role") if memberships else None
    return str(role) if role else None


def _resolve_input_file(entry_path: Any, alias: str, what: str) -> Path:
    if not isinstance(entry_path, str) or not entry_path.strip():
        raise ExploreInputError(f'inputs.json: input "{alias}" has no {what}')
    base = run_dir()
    path = (base / entry_path).resolve()
    if base not in path.parents and path != base:
        raise ExploreInputError(f'inputs.json: {what} of "{alias}" points outside the run directory')
    if not path.is_file():
        raise ExploreInputError(f'{what} of input "{alias}" not found: {path}')
    return path


def load_schema(alias: str) -> dict[str, Any]:
    """The dataset schema document (``{"schema": {"columns": [...]}, ...}``)."""
    entry = input_info(alias)
    path = _resolve_input_file(entry.get("schemaPath"), alias, "schema file")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ExploreInputError(f'schema of input "{alias}" is not valid JSON: {error}') from error
    if not isinstance(data, dict):
        raise ExploreInputError(f'schema of input "{alias}" must be a JSON object')
    return data


def _schema_columns(schema: Mapping[str, Any]) -> list[dict[str, Any]]:
    inner = schema.get("schema")
    columns = inner.get("columns") if isinstance(inner, dict) else schema.get("columns")
    if not isinstance(columns, list):
        return []
    return [column for column in columns if isinstance(column, dict) and isinstance(column.get("key"), str)]


_INTEGER_PATTERN = re.compile(r"[-+]?\d+")
_TRUE_VALUES = frozenset({"true", "1", "yes"})
_FALSE_VALUES = frozenset({"false", "0", "no"})


def _convert_column(series: "pd.Series", column_type: str) -> "pd.Series":
    import numpy as np
    import pandas as pd

    text = series.astype(object).map(lambda value: "" if value is None or (isinstance(value, float) and math.isnan(value)) else str(value))
    present = text[text != ""]
    if column_type == "number":
        if len(present) > 0 and present.str.fullmatch(_INTEGER_PATTERN).all():
            try:
                return pd.to_numeric(text.mask(text == "", None), errors="coerce").astype("Int64")
            except (OverflowError, TypeError, ValueError):
                pass
        numeric = pd.to_numeric(text.mask(text == "", np.nan), errors="coerce")
        return numeric.astype("float64")
    if column_type == "boolean":
        lowered = text.str.strip().str.lower()
        values = lowered.map(lambda value: True if value in _TRUE_VALUES else False if value in _FALSE_VALUES else None)
        return values.astype("boolean")
    # Build an object column explicitly: since pandas 3 a mapped string column
    # keeps the string dtype and turns None into a missing marker, but kits
    # expect plain ``None`` for empty cells.
    return pd.Series([value if value != "" else None for value in text.tolist()], index=series.index, dtype=object)


def load_dataset(alias: str, *, parse_dates: bool = False) -> "pd.DataFrame":
    """Read one input as a pandas DataFrame.

    Column dtypes follow the dataset schema: ``number`` becomes ``Int64`` when
    every value is an integer literal and ``float64`` otherwise, ``boolean``
    becomes the nullable ``boolean`` dtype and everything else stays text
    (``object`` with ``None`` for empty cells).  ``date`` columns stay ISO
    strings unless ``parse_dates`` is set.  ``df.attrs`` carries ``alias``,
    ``name``, ``tableKind``, ``roles``, ``datasetId``, ``versionId`` and the
    schema ``columns``.
    """
    import csv

    import pandas as pd

    entry = input_info(alias)
    path = _resolve_input_file(entry.get("path"), alias, "table file")
    schema = load_schema(alias)
    columns = _schema_columns(schema)
    df = pd.read_csv(
        path,
        sep="\t",
        dtype=str,
        keep_default_na=False,
        na_filter=False,
        quoting=csv.QUOTE_NONE,
        index_col=False,
        encoding="utf-8",
    )
    types = {column["key"]: str(column.get("type") or "string") for column in columns}
    for key in df.columns:
        column_type = types.get(key, "string")
        if parse_dates and column_type == "date":
            converted = _convert_column(df[key], "string")
            df[key] = pd.to_datetime(converted, errors="coerce", utc=True)
        else:
            df[key] = _convert_column(df[key], column_type)
    roles_value = entry.get("roles")
    df.attrs["alias"] = alias
    df.attrs["name"] = entry.get("name")
    df.attrs["tableKind"] = entry.get("tableKind")
    df.attrs["roles"] = {str(role): str(column) for role, column in roles_value.items() if column} if isinstance(roles_value, dict) else {}
    df.attrs["datasetId"] = entry.get("datasetId")
    df.attrs["versionId"] = entry.get("versionId")
    df.attrs["columns"] = columns
    return df


def roles(df: "pd.DataFrame") -> dict[str, str]:
    """The role map attached to a DataFrame by :func:`load_dataset`."""
    value = df.attrs.get("roles")
    return dict(value) if isinstance(value, dict) else {}


def role_column(df: "pd.DataFrame", role: str, required: bool = True) -> str | None:
    """The column key that plays ``role`` in ``df``.

    Returns ``None`` when the role is not mapped (or mapped to a column that is
    not in the table) and ``required`` is false; raises otherwise.
    """
    column = roles(df).get(role)
    if column and column in df.columns:
        return column
    if not required:
        return None
    if column:
        raise ExploreInputError(f'Role "{role}" is mapped to column "{column}", which is not in the table')
    raise ExploreInputError(f'Required role "{role}" is not mapped for input "{df.attrs.get("alias") or "?"}"')


# --------------------------------------------------------------------------- #
#  Writing outputs
# --------------------------------------------------------------------------- #
def output_dir() -> Path:
    """``<runDir>/<outputDir>`` (default ``outputs``), created on first use.

    The directory must live inside the run folder and must not be the
    ``inputs`` folder, so a kit can never overwrite what it was given.
    """
    base = run_dir()
    configured = "outputs"
    try:
        value = load_inputs().get("outputDir")
        if isinstance(value, str) and value.strip():
            configured = value.strip()
    except ExploreInputError:
        pass
    target = (base / configured).resolve()
    if target == base or base not in target.parents:
        raise ExploreInputError(f'outputDir "{configured}" must be a directory inside the run directory')
    inputs_dir = (base / "inputs").resolve()
    if target == inputs_dir or inputs_dir in target.parents:
        raise ExploreInputError('outputDir must not be the "inputs" directory')
    target.mkdir(parents=True, exist_ok=True)
    return target


_SLUG_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


def _slug(name: str) -> str:
    slug = _SLUG_PATTERN.sub("_", str(name).strip()).strip("._-")
    slug = re.sub(r"_+", "_", slug)
    return slug[:80] or "artifact"


def _check_name(name: Any) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ValueError("artifact name must be a non-empty string")
    return name.strip()


def _humanize(name: str) -> str:
    text = re.sub(r"[_\-]+", " ", name).strip()
    return text[:1].upper() + text[1:] if text else name


def _relative_output(path: Path) -> str:
    relative = path.resolve().relative_to(run_dir())
    return str(PurePosixPath(*relative.parts))


def _target_path(name: str, suffix: str) -> Path:
    directory = output_dir()
    path = (directory / f"{_slug(name)}{suffix}").resolve()
    if directory not in path.parents:
        raise ValueError(f"artifact name {name!r} resolves outside the output directory")
    return path


def _register(artifact: dict[str, Any]) -> dict[str, Any]:
    key = (artifact["name"], artifact["kind"], artifact["format"])
    _state.artifacts = [
        existing for existing in _state.artifacts if (existing["name"], existing["kind"], existing["format"]) != key
    ]
    _state.artifacts.append(artifact)
    _state.dirty = True
    return artifact


def _artifact(
    name: str,
    kind: str,
    fmt: str,
    path: Path,
    title: str | None,
    description: str | None,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    artifact: dict[str, Any] = {
        "name": name,
        "kind": kind,
        "format": fmt,
        "path": _relative_output(path),
        "title": title if title else _humanize(name),
        "description": description if description else None,
    }
    if extra:
        artifact.update(extra)
    return _register(artifact)


def _is_plotly_figure(fig: Any) -> bool:
    return hasattr(fig, "to_plotly_json") and hasattr(fig, "to_json")


def _is_matplotlib_figure(fig: Any) -> bool:
    return hasattr(fig, "savefig") and type(fig).__module__.startswith("matplotlib")


def _kaleido_available() -> bool:
    try:
        return importlib.util.find_spec("kaleido") is not None
    except (ImportError, ValueError):
        return False


def save_figure(
    fig: Any,
    name: str,
    title: str | None = None,
    description: str | None = None,
    *,
    png: bool = True,
    scale: float = 2.0,
) -> list[dict[str, Any]]:
    """Save a plotly or matplotlib figure and register it.

    Plotly figures become ``<name>.plotly.json`` (the interactive artifact the
    app renders) plus a PNG when kaleido is importable and works; a missing or
    failing kaleido is recorded as a note, never as an error.  Matplotlib
    figures become PNG and SVG.  Returns the registered artifact entries.
    """
    name = _check_name(name)
    registered: list[dict[str, Any]] = []
    if _is_plotly_figure(fig):
        json_path = _target_path(name, ".plotly.json")
        json_path.write_text(fig.to_json(), encoding="utf-8")
        registered.append(_artifact(name, "figure", "plotly-json", json_path, title, description))
        if png:
            png_path = _target_path(name, ".png")
            if not _kaleido_available():
                if not _state.png_warning_given:
                    note("PNG export of plotly figures skipped: the kaleido package is not installed in this environment.")
                    _state.png_warning_given = True
            else:
                try:
                    fig.write_image(str(png_path), format="png", scale=scale)
                    registered.append(_artifact(name, "figure", "png", png_path, title, description))
                except Exception as error:  # kaleido/chrome problems must not fail the run
                    if not _state.png_warning_given:
                        note(f"PNG export of plotly figures skipped: {type(error).__name__}: {error}")
                        _state.png_warning_given = True
                    if png_path.exists():
                        png_path.unlink()
        return registered
    if _is_matplotlib_figure(fig):
        png_path = _target_path(name, ".png")
        fig.savefig(str(png_path), format="png", dpi=150, bbox_inches="tight")
        registered.append(_artifact(name, "figure", "png", png_path, title, description))
        svg_path = _target_path(name, ".svg")
        fig.savefig(str(svg_path), format="svg", bbox_inches="tight")
        registered.append(_artifact(name, "figure", "svg", svg_path, title, description))
        return registered
    raise TypeError(f"save_figure() expects a plotly or matplotlib figure, got {type(fig).__name__}")


def _clean_text(value: Any) -> Any:
    if isinstance(value, str):
        return re.sub(r"[\t\r\n]+", " ", value)
    return value


def save_table(
    df: "pd.DataFrame",
    name: str,
    title: str | None = None,
    description: str | None = None,
    *,
    table_kind: str | None = None,
    roles: Mapping[str, str] | None = None,
    float_format: str | None = None,
) -> dict[str, Any]:
    """Write ``df`` as ``<name>.tsv`` (no index, empty cell for missing values,
    tabs and newlines inside cells replaced by spaces) and register it.

    ``table_kind`` and ``roles`` describe the table for the app so the result
    can be attached as a new dataset; role columns must exist in ``df``.
    """
    import pandas as pd

    name = _check_name(name)
    role_map = {str(role): str(column) for role, column in (roles or {}).items() if column}
    missing = [f"{role} -> {column}" for role, column in role_map.items() if column not in df.columns]
    if missing:
        raise ValueError(f"save_table({name!r}): role columns not in table: {', '.join(missing)}")
    unknown = sorted(role for role in role_map if role not in EXPLORE_ROLES)
    if unknown:
        note(f'Table "{name}" uses roles the app does not know: {", ".join(unknown)}')
    out = df.copy()
    for column in out.columns:
        series = out[column]
        if str(series.dtype) in ("bool", "boolean"):
            out[column] = series.map(lambda value: None if pd.isna(value) else ("true" if bool(value) else "false")).astype(object)
        elif series.dtype == object or pd.api.types.is_string_dtype(series):
            # Covers both the classic object columns and the pandas 3 string dtype.
            out[column] = pd.Series(
                [None if (value is None or value is pd.NA or (isinstance(value, float) and math.isnan(value))) else _clean_text(value) for value in series.tolist()],
                index=series.index,
                dtype=object,
            )
    path = _target_path(name, ".tsv")
    out.to_csv(path, sep="\t", index=False, na_rep="", float_format=float_format, lineterminator="\n", encoding="utf-8")
    return _artifact(
        name,
        "table",
        "tsv",
        path,
        title,
        description,
        {"table": {"tableKind": table_kind, "roles": role_map, "rowCount": int(len(out))}},
    )


def save_report_markdown(text: str, name: str, title: str | None = None, description: str | None = None) -> dict[str, Any]:
    """Write a Markdown report as ``<name>.md`` and register it."""
    name = _check_name(name)
    path = _target_path(name, ".md")
    path.write_text(str(text), encoding="utf-8")
    return _artifact(name, "report", "md", path, title, description)


def save_report_html(html: str, name: str, title: str | None = None, description: str | None = None) -> dict[str, Any]:
    """Write an HTML report as ``<name>.html`` and register it."""
    name = _check_name(name)
    path = _target_path(name, ".html")
    path.write_text(str(html), encoding="utf-8")
    return _artifact(name, "report", "html", path, title, description)


def note(text: str) -> None:
    """Record a note for the run (shown next to the results)."""
    message = str(text).strip()
    if message:
        _state.notes.append(message)
        _state.dirty = True


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if hasattr(value, "item") and not isinstance(value, (list, tuple, dict)):
        try:
            return _json_safe(value.item())
        except (TypeError, ValueError):
            pass
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except (TypeError, ValueError):
            pass
    try:
        if value != value:  # NaN-like objects (pd.NA compares unequal to itself only via isna)
            return None
    except (TypeError, ValueError):
        return None
    return str(value)


def metric(key: str, value: Any) -> None:
    """Record a headline number (or short value) for the run."""
    if not isinstance(key, str) or not key.strip():
        raise ValueError("metric key must be a non-empty string")
    _state.metrics[key.strip()] = _json_safe(value)
    _state.dirty = True


def metrics() -> dict[str, Any]:
    """The metrics recorded so far."""
    return dict(_state.metrics)


def artifacts() -> list[dict[str, Any]]:
    """The artifacts registered so far."""
    return [dict(entry) for entry in _state.artifacts]


def log(*parts: Any) -> None:
    """Print a progress line to stderr (stdout stays clean for the app)."""
    print("[seqdesk_explore]", *parts, file=sys.stderr, flush=True)


def _manifest_document() -> dict[str, Any]:
    return {
        "manifestVersion": MANIFEST_VERSION,
        "helperVersion": __version__,
        "artifacts": [dict(entry) for entry in _state.artifacts],
        "notes": list(_state.notes),
        "metrics": dict(_state.metrics),
    }


def finish() -> Path:
    """Write ``outputs/manifest.json`` and return its path.

    Safe to call more than once; artifacts registered after a call are picked
    up by the next call or by the exit hook.
    """
    directory = output_dir()
    path = directory / "manifest.json"
    tmp = directory / "manifest.json.tmp"
    tmp.write_text(json.dumps(_manifest_document(), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    _state.finished = True
    _state.dirty = False
    return path


def _uncaught_exception() -> BaseException | None:
    exc = getattr(sys, "last_exc", None)
    if exc is None:
        exc = getattr(sys, "last_value", None)
    return exc if isinstance(exc, BaseException) else None


def _write_manifest_at_exit() -> None:
    if _state.finished and not _state.dirty:
        return
    error = _uncaught_exception()
    has_content = bool(_state.artifacts or _state.notes or _state.metrics)
    if _state.run_dir is None and not has_content and error is None:
        return  # the helper was never used: nothing to report
    try:
        run_dir()  # resolve lazily: a script may only have called note()/metric()
        if error is not None:
            note(f"Script ended with an uncaught exception: {type(error).__name__}: {error}")
        finish()
    except Exception as failure:  # never mask the script's own outcome
        print(f"[seqdesk_explore] could not write manifest at exit: {failure}", file=sys.stderr)


atexit.register(_write_manifest_at_exit)
