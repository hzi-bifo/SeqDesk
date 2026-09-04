# seqdesk_explore

Python helper for SeqDesk Explore kits. The app puts this directory on
`PYTHONPATH` when it runs a kit, so a kit only needs `import seqdesk_explore`.

```python
import seqdesk_explore as sx

df = sx.load_dataset("profiles")            # pandas DataFrame, dtypes from the schema
sample = sx.role_column(df, "sample")       # column key that plays a role
top_n = sx.param("top_n", 15)               # kit parameter with a default
artifacts = sx.curated_names("artifact")    # entries of the attached curation lists

sx.save_table(table, "summary", title="Summary", table_kind="sample-summary", roles={"sample": sample})
sx.save_figure(fig, "composition", title="Composition")   # plotly or matplotlib
sx.save_report_markdown("# Notes\n...", "report")
sx.note("Two taxa were removed as artifacts.")
sx.metric("n_samples", df[sample].nunique())
sx.finish()                                  # writes outputs/manifest.json
```

## Run folder contract

| Path | Written by | Content |
| --- | --- | --- |
| `inputs.json` | app | attached inputs (`path`, `schemaPath`, `tableKind`, `roles`, ...), `params`, `outputDir`, `run`, `curation.lists` |
| `inputs/<alias>.tsv` | app | header row of column keys, tab separated, empty cell = null, no quoting |
| `inputs/<alias>.schema.json` | app | `{"schema": {"columns": [{key, label, type, role?, group?}]}, "provenance": ..., "contentHash": ...}` |
| `outputs/manifest.json` | helper | `{"manifestVersion": 1, "artifacts": [...], "notes": [...], "metrics": {...}}` |

The run directory comes from `--run-dir`, else `SEQDESK_EXPLORE_RUN_DIR`, else
the working directory when it contains `inputs.json`.

## Data types

`load_dataset` converts columns by their schema type: `number` becomes the
nullable `Int64` dtype when every cell is an integer literal and `float64`
otherwise; `boolean` becomes the nullable `boolean` dtype; `string`, `date` and
`json` stay text (`object` dtype, `None` for empty cells). Pass
`parse_dates=True` to turn `date` columns into UTC timestamps.
`df.attrs` carries `alias`, `name`, `tableKind`, `roles`, `datasetId`,
`versionId` and the schema `columns`.

## Outputs

* `save_figure(fig, name)` writes `outputs/<name>.plotly.json` for plotly
  figures (plus a PNG when the `kaleido` package is installed and works; a
  missing kaleido is recorded as a note) and PNG + SVG for matplotlib figures.
* `save_table(df, name, table_kind=..., roles=...)` writes a TSV with the same
  conventions as the inputs. `table_kind` and `roles` tell the app how the
  table can be reused as a dataset; role columns must exist in the frame.
* `save_report_markdown` / `save_report_html` write reports.
* `note`, `metric` and `finish` fill the manifest. A manifest is also written
  from an `atexit` hook, so a script that forgets `finish()` still leaves one;
  an uncaught exception keeps its non-zero exit code.

File names are derived from artifact names (anything outside
`A-Za-z0-9._-` becomes `_`); artifact names themselves are kept verbatim in the
manifest. Everything is written under the output directory, which must be
inside the run folder and must not be `inputs/`.

## Testing kits

`seqdesk_explore.testing` runs a kit on its `test-data/` in a temporary run
folder and checks the manifest against `test-data/expected.json`; see the
`test_kit.py` of any kit under `explore/kits/`.

```
python3 -m pytest explore/lib/python/tests -q   # helper unit tests
python3 -m pytest explore/kits -q               # kit self-tests (need plotly)
```
