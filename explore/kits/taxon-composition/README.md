# Taxon composition

Relative abundance composition of a long taxon profile table: stacked bars of
the most abundant taxa per sample, the long composition table and a per-taxon
prevalence table. Works on MetaxPath sample profiles, Bracken reports and any
other `taxon-profile-long` dataset.

## Method

The steps follow the INDIVO Explorer reference implementation
(`microbiome()` in its `analysis.py`):

1. When a `rank` role is mapped, keep only rows of the requested `rank`
   (default `species`; falls back to the most frequent rank when the requested
   one is absent, and uses every row when no rank role is mapped).
2. Drop non-detections (missing or non-positive counts).
3. Drop taxa listed on the attached curation lists with role `artifact`
   (matched case-insensitively on the trimmed name). The removed taxa and the
   share of reads they carried are reported.
4. Relative abundance per sample = `100 * count / sum(count)`, computed after
   the artifact removal so the retained taxa sum to 100 % in every sample.
   Duplicate sample/taxon rows are summed first.
5. Optionally drop taxon rows below `min_relative_abundance_pct`; their share
   is not redistributed but stays visible as "Other" in the figure.
6. Rank taxa by mean relative abundance over the retained samples; the top
   `top_n` are drawn individually and the rest is summed into "Other".

Samples are ordered by `group`, then `subject`, then `timepoint` (numeric when
possible), then label; group boundaries are marked in the figure. With more
than 120 samples (`per_group` = `auto`), or when `per_group` = `group`, the
figure shows the mean composition per group instead of one bar per sample,
with the number of samples in each bar's label. Sample labels
come from a `sample_id` column when present, otherwise from the sample role.

## Input

| Alias | Table kind | Required roles | Optional roles |
| --- | --- | --- | --- |
| `profiles` | `taxon-profile-long` | `sample`, `taxon`, `count` | `group`, `subject`, `timepoint`, `taxon_id`, `rank` |

## Parameters

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `top_n` | integer | 15 | taxa drawn individually (1-60) |
| `min_relative_abundance_pct` | number | 0 | drop taxon rows below this per-sample relative abundance |
| `rank` | string | `species` | rank to keep when a rank role is mapped; empty keeps every row |

## Outputs

| Name | Kind | Content |
| --- | --- | --- |
| `composition_plot` | figure | stacked relative abundance bars per sample (top taxa plus Other) |
| `composition` | table (`taxon-profile-long`) | sample, metadata roles, taxon, taxon id, count and `relative_abundance_pct`; roles are carried over so the table can be attached as a new dataset |
| `prevalence` | table | per taxon: `n_samples_present`, `prevalence_pct`, `mean_relative_abundance_pct` (over all samples), `mean_relative_abundance_when_present_pct`, `max_relative_abundance_pct`, `total_reads`, `is_top` |

Metrics: `n_samples`, `n_taxa`, `n_rows_input`, `n_rows_retained`,
`n_nondetections_dropped`, `n_artifact_taxa_removed`, `artifact_reads_pct`,
`n_samples_dropped_empty`, `n_rows_below_min_ra`, `top_n_effective`,
`mean_top_n_coverage_pct`, plus `n_groups` and `n_subjects` when mapped.

## Test data

`test-data/` is a synthetic profile of 12 samples (4 subjects, 3 timepoints,
2 groups) with 20 species, host and phage reads listed on an artifact
curation list, a few genus-level rows and one non-detection. Taxon ids are
illustrative. Run the self-test with

```
python3 -m pytest explore/kits/taxon-composition/test-data -q
```

## Citation

If you report results from this kit, cite the libraries it is built on:

- **pandas** — McKinney W. *Data Structures for Statistical Computing in Python*. Proceedings of the 9th Python in Science Conference, 2010, 56-61. https://doi.org/10.25080/Majora-92bf1922-00a ; software: The pandas development team, *pandas-dev/pandas: Pandas*, https://pandas.pydata.org
- **NumPy** — Harris CR, Millman KJ, van der Walt SJ, et al. *Array programming with NumPy*. Nature 585, 357-362 (2020). https://doi.org/10.1038/s41586-020-2649-2
- **Plotly** — Plotly Technologies Inc. *Collaborative data science*. Montreal, QC, 2015. https://plotly.com/python/ (the project lists no paper; cite the software and URL)
- **SeqDesk** — the Explore runner and this kit. https://seqdesk.org

The artifact-removal and renormalisation logic follows the INDIVO Explorer
reference; cite the profiling tool that produced the input table (for example
MetaxPath or Kraken 2 / Bracken) as its own documentation asks.
