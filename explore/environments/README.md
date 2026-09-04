# Explore environments

Each file in this directory is a conda environment specification that a kit
can name in its `kit.json`:

```json
{ "language": "python", "environment": "seqdesk-explore-python" }
```

The value is the file name without `.yml`.

## Caching by spec hash

The app does not install environments by name but by content: it hashes the
specification file and keeps one environment per hash. The first run of a kit
that names a specification creates the environment (this can take minutes);
every later run reuses it. Changing anything in the file, even a comment,
produces a new hash and therefore a new environment on the next run, while the
previous one stays available for runs that were recorded against it. This
keeps old analysis runs reproducible: a run always records the hash it ran
with.

Consequences:

* Add packages by editing the specification, not by installing into a live
  environment; manual installs are lost as soon as the hash changes.
* Prefer loose version constraints that solve on `linux-64` and `osx-arm64`;
  pin only where behaviour matters.
* Keep one shared environment per language rather than one per kit. Kits that
  need something unusual should get their own specification file and name it.

## Helper library

The Python helper in `explore/lib/python` is not part of any environment. The
app puts that directory on `PYTHONPATH` when it starts a kit, so the helper is
always the one that ships with the app version that runs the kit.

## Static image export

`python-kaleido` 1.x renders PNGs of plotly figures with a Chrome or Chromium
binary that must exist on the host (`plotly_get_chrome` downloads one into the
environment). When no browser is available the helper still writes the
interactive `plotly-json` artifact and adds a note to the run; nothing fails.

## Files

| File | Used by | Notes |
| --- | --- | --- |
| `seqdesk-explore-python.yml` | Python kits | pandas, scipy, statsmodels, scikit-learn, plotly, kaleido, matplotlib |
| `seqdesk-explore-r.yml` | R kits | tidyverse, vegan, ggplot2, plotly, jsonlite, MaAsLin 2 (MaAsLin 3 needs R 4.5, see the file) |
