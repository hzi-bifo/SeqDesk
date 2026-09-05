# Community stability

How much a subject's community changes from one sample to the next, and whether
longer gaps mean larger change, compared with how different two subjects are.

## Method

1. Rows are cleaned like every profile kit (shared `seqdesk_explore.profiles`):
   one taxonomic rank when a `rank` role is mapped, non-detections dropped,
   curated `artifact` taxa removed, relative abundance renormalised per sample.
2. Each subject's samples are ordered by the numeric `timepoint`; with
   `within_group_only` (default) only samples sharing the `group` value are
   paired, so a urine sample is not compared with an ascites sample.
3. Every pair of a subject's samples gets its time gap and its dissimilarity:
   **Bray-Curtis** on relative abundance or **Jaccard** on presence. Consecutive
   pairs are flagged; `max_gap` drops pairs further apart.
4. The **between-subject baseline** is the dissimilarity of sample pairs from
   different subjects (same group when `within_group_only`), all pairs or a
   fixed-seed sample of 4000.
5. `turnover_vs_gap`: consecutive-pair dissimilarity against the gap, coloured
   by group, with running medians over gap bins and the baseline median as a
   dotted line; `stability_by_group`: within-subject next to between-subject
   dissimilarity per group. Spearman's rank correlation of gap and
   dissimilarity is recorded as a metric.

## Input

`profiles`, a `taxon-profile-long` table with `sample`, `taxon`, `count`,
`subject` and `timepoint` roles; `group` keeps comparisons within a group.

## Parameters

`metric` (braycurtis, jaccard), `within_group_only`, `max_gap`, `rank`,
`min_reads`, `remove_artifacts`.

## Outputs

`sample_pairs` and `subject_stability` are tables (`subject` and `value`
roles); the two figures are Plotly. Metrics: subjects, pairs, median
within-subject and between-subject dissimilarity, Spearman rho and p of gap
against dissimilarity.

## Test data

Twelve urine and stool samples of four subjects over time (`test-data/`).
`pytest explore/kits/community-stability`.

## Citation

Built with pandas (McKinney 2010; The pandas development team, https://pandas.pydata.org), NumPy (Harris et al. 2020, https://numpy.org), SciPy (Virtanen et al. 2020, https://scipy.org) and Plotly (Plotly Technologies Inc., https://plotly.com/python/). Bray and Curtis (1957) dissimilarity, Jaccard (1901) index, Spearman (1904) rank correlation.
