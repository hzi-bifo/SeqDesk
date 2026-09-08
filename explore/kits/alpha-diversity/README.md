# Alpha diversity

Within-sample diversity of a long taxon profile table: how many taxa a sample
holds and how evenly its reads are spread over them, compared between groups
and over the study timeline.

## Method

1. Rows are cleaned like every profile kit (shared `seqdesk_explore.profiles`):
   one taxonomic rank when a `rank` role is mapped, non-detections dropped,
   curated `artifact` taxa removed, relative abundance renormalised per sample,
   samples below `min_reads` dropped.
2. Per sample: **richness** (taxa with reads), **Shannon** entropy
   `H = -sum(p ln p)`, **Simpson** index `1 - sum(p^2)` and **Pielou evenness**
   `J = H / ln(S)` (undefined for one taxon).
3. `alpha_by_group`: the chosen index per value of the `group` role as box plots
   with all points; a histogram when no group is mapped.
4. `alpha_over_time`: the chosen index against a numeric `timepoint`, coloured by
   group, with a running median per group over time bins.
5. `alpha_tests`: Kruskal-Wallis across groups and Spearman rank correlation with
   time (overall and per group, at least eight samples), for every index, with
   Benjamini-Hochberg q-values within each test family, as in the INDIVO
   Explorer temporal-trends page.

## Outputs

`alpha_diversity` (one row per sample, `value` role on the chosen index) and
`alpha_tests` are tables; the two figures are Plotly. Metrics: samples, median
of the chosen index, Kruskal-Wallis p across groups.

## Citation

Built with pandas (McKinney 2010; The pandas development team, https://pandas.pydata.org), NumPy (Harris et al. 2020, https://numpy.org), SciPy (Virtanen et al. 2020, https://scipy.org) and Plotly (Plotly Technologies Inc., https://plotly.com/python/). Shannon (1948) entropy, Simpson (1949) index and Pielou (1966) evenness; Kruskal and Wallis (1952); Spearman (1904); Benjamini and Hochberg (1995). The test layout follows the INDIVO Explorer temporal-trends page (https://github.com/hzi-bifo/indivo-explorer).
