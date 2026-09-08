# Relative abundance composition

For percentage profiles, including the **MetaPhlAn relative abundance (CAMI
profile)** table declared by the SeqDesk pipeline manifest. In a sequencing
data entry or study, open Reports, add that pipeline table, and choose this kit.
Its figure and table can be added to the report page.

This kit deliberately does not expose a count role: MetaPhlAn percentages are
not observed read counts. Count-based diversity and differential-abundance
kits keep their existing input requirements.

Choose one taxonomic rank and one profiling result per sample. Duplicate taxa,
missing identities, non-finite/negative values, and sample totals above 100%
(allowing 0.01 percentage points for rounding) are rejected. An absent rank is
an error rather than silently switching to a different rank.

Values are not renormalised. The grey **Other / unreported** segment includes
taxa outside the selected top N and the portion not reported at this rank.
It does not claim that the remainder represents a specific organism.

The self-test data are internal software fixtures, not public CAMI data or
scientific benchmark results.

## Citation

This kit uses pandas and Plotly to display supplied percentages. Cite the
original profiling pipeline, its reference database version and the source
dataset; this visualisation is not an independent taxonomic method or a
scientific validation of the profiling result.
