# Cohort overview

The first page of a cohort report: how many samples, subjects, specimen groups,
taxa and reads a long taxon profile table holds, and when the samples were
taken. Works on MetaxPath sample profiles, Bracken reports and any other
`taxon-profile-long` dataset.

## Method

1. Rows are cleaned like every profile kit (shared `seqdesk_explore.profiles`):
   one taxonomic rank when a `rank` role is mapped, non-detections dropped,
   taxa on curation lists with the `artifact` role removed.
2. `overview`: one row per value of the `group` role (specimen type, arm, ...)
   and a total row, with samples, subjects, taxa detected, total and median
   reads per sample, and the first and last timepoint.
3. `subjects` (needs the `subject` role): one row per subject with the groups it
   appears in, its samples, distinct timepoints, first and last timepoint and
   the span between them.
4. `samples_per_group`: samples and subjects per group.
5. `sampling_timeline` (needs `subject` and a numeric `timepoint`): subjects on
   the y axis, ordered by their first timepoint, one marker per sample, coloured
   by group. The overview's counterpart of the per-patient timeline.

## Outputs

`overview` and `subjects` are tables; `samples_per_group` and
`sampling_timeline` are Plotly figures. Metrics: samples, subjects, groups,
taxa, total reads, first and last timepoint.

## Citation

Built with pandas (McKinney 2010; The pandas development team, https://pandas.pydata.org) and Plotly (Plotly Technologies Inc., https://plotly.com/python/). The counts and the sampling timeline follow the INDIVO Explorer overview and per-patient timeline pages (https://github.com/hzi-bifo/indivo-explorer).
