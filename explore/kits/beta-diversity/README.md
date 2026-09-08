# Beta diversity (PCoA)

How different the samples of a long taxon profile table are from each other,
drawn as a principal coordinates ordination and tested with PERMANOVA.

## Method

1. Rows are cleaned like every profile kit (shared `seqdesk_explore.profiles`):
   one taxonomic rank when a `rank` role is mapped, non-detections dropped,
   curated `artifact` taxa removed, relative abundance renormalised per sample,
   samples below `min_reads` dropped.
2. Distances between samples: **Bray-Curtis** on relative abundance, or
   **Jaccard** on presence/absence (`metric`).
3. **PCoA**: eigendecomposition of the double-centred squared distance matrix;
   coordinates are eigenvectors scaled by the square root of the positive
   eigenvalues; the share of each axis is its eigenvalue over the sum of the
   positive ones.
4. **PERMANOVA** (Anderson 2001) for the `group` role and, when mapped, the
   `subject` role: pseudo-F, R² and a permutation p-value from `permutations`
   label shuffles (a factor needs at least two levels and more samples than
   levels). The implementation follows the INDIVO Explorer ordination page.

## Outputs

`pcoa` is a Plotly figure (first two coordinates, one trace per group);
`pcoa_coordinates` (roles: sample, group, subject, timepoint) and `permanova`
are tables. Metrics: samples, taxa, variance share of the first two axes, and
the group PERMANOVA p and R².

## Citation

Built with pandas (McKinney 2010; The pandas development team, https://pandas.pydata.org), NumPy (Harris et al. 2020, https://numpy.org), SciPy (Virtanen et al. 2020, https://scipy.org) and Plotly (Plotly Technologies Inc., https://plotly.com/python/). Bray and Curtis (1957) dissimilarity; Jaccard (1912); principal coordinates after Gower (1966); PERMANOVA after Anderson (2001), implemented as in the INDIVO Explorer ordination page (https://github.com/hzi-bifo/indivo-explorer).
