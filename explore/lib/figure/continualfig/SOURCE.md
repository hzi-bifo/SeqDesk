# continualfig (vendored)

The Continual figure style hook, shipped as an Explore runtime helper. Copied
byte-for-byte from the mail2 repository (hzi-bifo/seqdesk-mail),
`figure-style/continualfig/` at commit ed5d9c9c ("Add the figure style study"):

- `python/continualfig.py`, `python/pyhook/sitecustomize.py` <- `continualfig.py`, `pyhook/sitecustomize.py`
- `r/continualfig.R` <- `continualfig.R`

Do not edit these files here; change them upstream and copy them again.

How runs use it (see `run-script.ts` and the `sx` helpers): the helper library,
this folder included, is staged into each run folder (`lib/figure/continualfig`),
so the sandbox sees it as part of the run and nothing outside. A run sets
`CONTINUALFIG=record|style|off` (flow steps default to `record`):

- `record`: figures are drawn exactly as the code says; `sx.figure` /
  `sx$figure` write the figure record next to each figure
  (`outputs/<name>.figure.json`) with a summary of the plotted data.
- `style`: the Continual style is applied as well (Python through the
  `pyhook/sitecustomize.py` on PYTHONPATH, R through `continualfig.R` sourced
  before the script).
- `off`: nothing is loaded.

Plotting packages (matplotlib, ggplot2, jsonlite) come from the step's own
environment; nothing is installed for the hook.
