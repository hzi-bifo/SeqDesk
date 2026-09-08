# Table summary

Column-level summary statistics and distribution plots for any Explore table.
Use it as a first look at a dataset before a more specific analysis.

## Input

| Alias | Table kind | Required roles | Optional roles |
| --- | --- | --- | --- |
| `table` | any | none | `sample`, `group`, `value`, `count` |

A mapped `group` role colours the histograms by group; a mapped `sample` role
adds a distinct-sample count to the metrics.

## Parameters

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `max_columns` | integer | 12 | at most this many numeric columns (in table order) get a histogram panel |

## Outputs

| Name | Kind | Content |
| --- | --- | --- |
| `summary` | table | one row per column: `column`, `label`, `type`, `role`, `n`, `n_missing`, `n_unique`, and for numeric columns `mean`, `sd` (sample standard deviation), `min`, `median`, `max`; for other columns `top_value` and `top_count` |
| `distributions` | figure | small-multiple histograms of the numeric columns, overlaid per group when a group role is mapped |

Metrics: `n_rows`, `n_columns`, `n_numeric_columns`, `n_text_columns`,
`n_missing_cells`, plus `n_samples` and `n_groups` when the roles are mapped.

Numeric columns without any value are listed in the notes instead of being
plotted; a table without numeric columns still produces the summary table.

## Test data

`test-data/` holds a synthetic 40-row table with numeric, boolean, date and
text columns and a `condition` group role. Run the self-test with

```
python3 -m pytest explore/kits/table-summary/test-data -q
```

## Citation

This kit only uses general-purpose open-source libraries. If you report
results from it, cite the libraries:

- **pandas** — McKinney W. *Data Structures for Statistical Computing in Python*. Proceedings of the 9th Python in Science Conference, 2010, 56-61. https://doi.org/10.25080/Majora-92bf1922-00a ; software: The pandas development team, *pandas-dev/pandas: Pandas*, https://pandas.pydata.org
- **NumPy** — Harris CR, Millman KJ, van der Walt SJ, et al. *Array programming with NumPy*. Nature 585, 357-362 (2020). https://doi.org/10.1038/s41586-020-2649-2
- **Plotly** — Plotly Technologies Inc. *Collaborative data science*. Montreal, QC, 2015. https://plotly.com/python/ (the project lists no paper; cite the software and URL)
- **SeqDesk** — the Explore runner and this kit. https://seqdesk.org
