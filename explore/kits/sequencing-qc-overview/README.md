# Sequencing QC overview

Reads per sample, read quality per run and per-sample / per-run QC tables for a
sequencing table such as the built-in **Sequencing** dataset (one row per
sample per sequencing run).

## Input

| Alias | Table kind | Required roles | Optional roles |
| --- | --- | --- | --- |
| `sequencing` | `sample-summary` | `sample` | `group`, `date` |

Beyond the sample role the kit looks for well-known column keys and degrades
gracefully when they are absent (each skipped panel is listed in the notes):

| Column | Used for |
| --- | --- |
| `read_count_1`, `read_count_2` | reads per sample (rows of one sample are summed) |
| `avg_quality_1`, `avg_quality_2` | mean read quality per sample and per run |
| `q30_score` | Q30 per run |
| `run_id` | stacking by run, the quality-by-run figure and the runs table |
| `platform`, `instrument`, `run_name`, `run_date`, `cluster_density`, `pass_filter_pct`, `run_total_reads`, `run_total_bases` | columns of the runs table |
| `sample_id` | human-readable sample labels (the sample role usually maps to the opaque `sample_db_id`) |

## Parameters

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `low_read_threshold` | integer | 10000 | samples with fewer total reads are flagged `low_yield` |

## Outputs

| Name | Kind | Content |
| --- | --- | --- |
| `reads_per_sample` | figure | bar chart of total reads per sample, stacked by run when `run_id` exists, with the low-yield threshold line |
| `quality_by_run` | figure | box plots of mean read quality per run and a bar of Q30 per run (needs `run_id` plus a quality column) |
| `qc_table` | table (`sample-summary`) | per sample: label, rows, runs, platforms, reads per mate, `total_reads`, mean qualities, `q30_score`, `no_reads`, `low_yield` |
| `runs` | table | per run: samples, rows, platform, instrument, dates, Q30, assigned reads, mean qualities |

Metrics: `n_samples`, `n_rows`, `n_runs`, `total_reads`,
`median_reads_per_sample`, `n_low_yield`, `n_samples_without_reads`,
`low_read_threshold`, `mean_q30`, `mean_avg_quality_1`, `mean_avg_quality_2`
(each only when the columns exist).

## Test data

`test-data/` is a synthetic sequencing table with 18 samples on 3 runs (two
samples sequenced twice, one run without a Q30 score, one sample without read
counts, two low-yield samples). Run the self-test with

```
python3 -m pytest explore/kits/sequencing-qc-overview/test-data -q
```

## Citation

This kit only uses general-purpose open-source libraries. If you report
results from it, cite the libraries:

- **pandas** — McKinney W. *Data Structures for Statistical Computing in Python*. Proceedings of the 9th Python in Science Conference, 2010, 56-61. https://doi.org/10.25080/Majora-92bf1922-00a ; software: The pandas development team, *pandas-dev/pandas: Pandas*, https://pandas.pydata.org
- **NumPy** — Harris CR, Millman KJ, van der Walt SJ, et al. *Array programming with NumPy*. Nature 585, 357-362 (2020). https://doi.org/10.1038/s41586-020-2649-2
- **Plotly** — Plotly Technologies Inc. *Collaborative data science*. Montreal, QC, 2015. https://plotly.com/python/ (the project lists no paper; cite the software and URL)
- **SeqDesk** — the Explore runner and this kit. https://seqdesk.org
