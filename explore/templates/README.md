# Flow templates

A template is a small recipe a person starts a flow from (FLOW-GAPS D33). The
person picks a table and answers the slot questions; SeqDesk creates the flow
with one step per entry in `steps`, binds the first step to the table and each
later step to the output its `inputs` names, and fills `{{slot}}` placeholders
in the params with the chosen columns (`{{a+b}}` joins two column lists).

`template.json`:

```json
{ "id": "rnaseq-de", "name": "...", "description": "...",
  "slots": [{ "key": "gene", "question": "Which column names the genes?", "kind": "column" }],
  "steps": [{ "key": "filter", "name": "Filter low counts", "purpose": "...", "language": "python",
              "codeFile": "steps/filter.py", "params": { "gene": "{{gene}}" },
              "inputs": [{ "alias": "counts", "source": "dataset" }],
              "outputs": [{ "name": "filtered", "kind": "table" }] }] }
```

A step may carry `"category"`: `summarise`, `filter`, `normalise`, `test` or `plot`
(optional; kits declare the same field in `kit.json`). The step picker groups methods by it.

Step code uses the helper (`sx.input`, `sx.output`, `sx.drop`, `sx.metric`,
`sx.figure`). The steps are tested in `explore/lib/python/tests/test_templates.py`.
