# Domain overview

How the reads of every sample split between bacteria, viruses, fungi, archaea
and other domains, compared between groups, with the most prevalent taxa of the
smaller domains.

## Method

1. A column naming each taxon's domain is picked: `domain_column`, or the first
   of `superkingdom`, `domain`, `kingdom` (case-insensitive). Each taxon gets the
   most frequent value it carries; taxa without one count as `Unclassified`.
2. Rows are cleaned like every profile kit (shared `seqdesk_explore.profiles`):
   one taxonomic rank when a `rank` role is mapped, non-detections dropped,
   curated `artifact` taxa removed, relative abundance renormalised per sample.
3. Per sample: the share of reads and the number of taxa per domain, and the
   dominant domain. Domains are ordered by mean share.
4. Per group and domain: samples, samples where the domain has reads, mean,
   median and maximum share, taxa seen.
5. Per domain the `top_n` most prevalent taxa with mean and maximum relative
   abundance and curated role.
6. `domain_shares`: box plots per domain and group; `minor_domain_taxa`: the
   most prevalent taxa of every domain but the largest, so viruses and fungi are
   visible even when bacteria dominate.

## Input

`profiles`, a `taxon-profile-long` table with `sample`, `taxon` and `count`
roles and a domain column; `group`, `subject` and `timepoint` are carried
along.

## Parameters

`domain_column`, `top_n`, `rank`, `min_reads`, `remove_artifacts`.

## Outputs

`domain_per_sample` (`sample` and `value` roles), `domain_by_group` (`group`,
`value`) and `top_taxa_per_domain` (`taxon`, `value`) are tables; the two
figures are Plotly. Metrics: domain column, domains, dominant domain, mean share
and taxa per domain, samples with each smaller domain.

## Test data

Twelve urine and stool samples of four subjects with a `superkingdom` column
(`test-data/`). `pytest explore/kits/domain-overview`.

## Citation

Built with pandas (McKinney 2010; The pandas development team, https://pandas.pydata.org), NumPy (Harris et al. 2020, https://numpy.org) and Plotly (Plotly Technologies Inc., https://plotly.com/python/). Domains follow the superkingdom rank of the NCBI Taxonomy (Schoch et al. 2020, https://www.ncbi.nlm.nih.gov/taxonomy).
