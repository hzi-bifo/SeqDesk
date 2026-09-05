# Differential abundance

Which taxa are more abundant in one group of samples than in another, for a
long taxon profile table with a `group` role (specimen type, arm, site, ...).

## Method

1. Rows are cleaned like every profile kit (shared `seqdesk_explore.profiles`):
   one taxonomic rank when a `rank` role is mapped, non-detections dropped,
   curated `artifact` taxa removed, relative abundance renormalised per sample.
2. The two groups come from `group_a` and `group_b`; when empty, the two most
   frequent values of the group role are compared.
3. Taxa present in at least `min_prevalence_pct` of the samples of either group
   are tested with a two-sided **Mann-Whitney U** on relative abundance, zeros
   included, so absence counts as low abundance rather than missing data.
4. **Benjamini-Hochberg** q-values across the tested taxa; taxa below
   `q_threshold` are marked significant. The effect is the log2 ratio of the
   mean relative abundances with a small pseudo-count.
5. `volcano`: log2 fold change against -log10 p; significant taxa are coloured
   and the strongest ones labelled.

This mirrors the INDIVO Explorer's Urine-versus-Ascites comparison. It is a
descriptive screen: samples of one subject are treated as independent.

## Outputs

`differential_abundance` (roles: taxon, taxon_id) is a table sorted by q; the
volcano plot is a Plotly figure. Metrics: the two groups and their sizes, taxa
tested and taxa significant.

## Citation

Built with pandas (McKinney 2010; The pandas development team, https://pandas.pydata.org), NumPy (Harris et al. 2020, https://numpy.org), SciPy (Virtanen et al. 2020, https://scipy.org) and Plotly (Plotly Technologies Inc., https://plotly.com/python/). Mann and Whitney (1947) U test; Benjamini and Hochberg (1995) false discovery rate. Mirrors the INDIVO Explorer differential-abundance comparison (https://github.com/hzi-bifo/indivo-explorer).
