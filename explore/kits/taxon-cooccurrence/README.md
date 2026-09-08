# Taxon co-occurrence

Which taxa of a long profile table are found together and which exclude each
other, across the samples of a cohort or of one group.

## Method

1. Rows are cleaned like every profile kit (shared `seqdesk_explore.profiles`):
   one taxonomic rank when a `rank` role is mapped, non-detections dropped,
   curated `artifact` taxa removed, relative abundance renormalised per sample.
2. Optionally only the samples of one value of the `group` role are kept.
3. The `top_n` most prevalent taxa with at least `min_prevalence_pct` prevalence
   enter the comparison; taxa present in every sample carry no signal and are
   left out.
4. For every pair the 2x2 presence table over samples gives the **phi
   coefficient** (Yule 1912; the Pearson correlation of two binary variables),
   the **lift** (samples with both over the count expected under independence)
   and **Fisher's exact test**; Benjamini-Hochberg q-values control the false
   discovery rate over all pairs.
5. `cooccurrence_heatmap` orders the taxa by average-linkage clustering of
   `1 - phi`; `strongest_pairs` shows the pairs with the smallest q.

## Input

`profiles`, a `taxon-profile-long` table with `sample`, `taxon` and `count`
roles; `group` enables the restriction, `rank` the rank filter.

## Parameters

`top_n`, `min_prevalence_pct`, `group`, `q_threshold`, `rank`, `min_reads`,
`remove_artifacts`.

## Outputs

`cooccurrence_pairs` (one row per pair with the four counts, prevalences, phi,
lift, p, q, `relation`, `curated_role_a`, `curated_role_b`) is a table; the two
figures are Plotly. Metrics: samples, taxa compared, pairs, significant pairs
split into co-occurring and excluding, the strongest pair.

## Test data

Twelve urine and stool samples of four subjects, with genus rows, an artifact
and non-detections (`test-data/`). `pytest explore/kits/taxon-cooccurrence`.

## Citation

Built with pandas (McKinney 2010; The pandas development team, https://pandas.pydata.org), NumPy (Harris et al. 2020, https://numpy.org), SciPy (Virtanen et al. 2020, https://scipy.org) and Plotly (Plotly Technologies Inc., https://plotly.com/python/). Phi coefficient (Yule 1912), Fisher's exact test (Fisher 1922), Benjamini and Hochberg (1995), average-linkage hierarchical clustering (Sokal and Michener 1958).
