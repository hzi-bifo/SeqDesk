# Community signatures

Recurring taxon combinations in a cohort, found without a hard clustering: every
sample is a mixture of a few signatures, each a weighted set of taxa.

## Method

1. Rows are cleaned like every profile kit (shared `seqdesk_explore.profiles`):
   one taxonomic rank when a `rank` role is mapped, non-detections dropped,
   curated `artifact` taxa removed, relative abundance renormalised per sample.
2. Taxa below `min_prevalence_pct` are left out; relative abundance is
   transformed (`sqrt` by default, `log` or `none`) to dampen dominant taxa.
3. **Non-negative matrix factorisation** (scikit-learn, NNDSVD initialisation,
   fixed seed) splits the samples-by-taxa matrix into `n_signatures` signatures:
   taxon loadings normalised to sum to 1 per signature, and per-sample shares
   normalised to sum to 1 per sample. The number is reduced when the table has
   fewer samples or taxa. Signatures are ordered by mean share and named after
   their two highest-loading taxa.
4. `signature_taxa_heatmap` shows the top taxa per signature,
   `signatures_by_group` the mean share per group as stacked bars.

## Input

`profiles`, a `taxon-profile-long` table with `sample`, `taxon` and `count`
roles; `group`, `subject` and `timepoint` are carried into the per-sample table.

## Parameters

`n_signatures`, `top_taxa`, `min_prevalence_pct`, `transform`, `seed`, `rank`,
`min_reads`, `remove_artifacts`.

## Outputs

`signature_taxa` (`taxon` and `value` roles) and `sample_signatures` (`sample`,
`group`, `subject`, `timepoint`, `value` on the dominant share) are tables; the
two figures are Plotly. Metrics: signatures extracted and requested, samples,
taxa, reconstruction error, iterations, median dominant share, the signature
labels.

## Test data

Twelve urine and stool samples of four subjects (`test-data/`).
`pytest explore/kits/community-signatures`.

## Citation

Built with scikit-learn (Pedregosa et al. 2011, https://scikit-learn.org), pandas (McKinney 2010; The pandas development team, https://pandas.pydata.org), NumPy (Harris et al. 2020, https://numpy.org) and Plotly (Plotly Technologies Inc., https://plotly.com/python/). Non-negative matrix factorisation after Lee and Seung (1999) with the NNDSVD initialisation of Boutsidis and Gallopoulos (2008); the signature framing follows Alexandrov et al. (2013) for mutational signatures.
