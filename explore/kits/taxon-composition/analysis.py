#!/usr/bin/env python3
"""Taxon composition: relative abundance per sample from a long profile table.

Steps (mirroring the INDIVO Explorer reference ``microbiome()``):

1. keep rows of the requested rank (when a rank role is mapped),
2. drop non-detections (count <= 0),
3. drop taxa listed on curation lists with the ``artifact`` role,
4. relative abundance = 100 * count / sum(count) per sample (renormalised
   after the artifact removal),
5. top_n taxa by mean relative abundance plus "Other" as stacked bars.
"""
from __future__ import annotations

import math

import pandas as pd
import plotly.graph_objects as go
from plotly.colors import qualitative

import seqdesk_explore as sx

RA_COLUMN = "relative_abundance_pct"
OTHER_LABEL = "Other"
OTHER_COLOR = "#B8B8B8"
LABEL_COLUMN = "sample_id"


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def sort_key(series: pd.Series) -> pd.Series:
    """Numeric order when every present value is numeric, else text order."""
    numbers = pd.to_numeric(series, errors="coerce")
    if series.notna().any() and numbers.notna().sum() == series.notna().sum():
        return numbers.astype(float)
    return series.astype(object).map(lambda value: "" if value is None else str(value))


def palette(n: int) -> list[str]:
    colors = list(qualitative.Dark24) + list(qualitative.Light24)
    return [colors[index % len(colors)] for index in range(n)]


def main() -> None:
    df = sx.load_dataset("profiles")
    sample_col = sx.role_column(df, "sample")
    taxon_col = sx.role_column(df, "taxon")
    count_col = sx.role_column(df, "count")
    group_col = sx.role_column(df, "group", required=False)
    subject_col = sx.role_column(df, "subject", required=False)
    time_col = sx.role_column(df, "timepoint", required=False)
    taxon_id_col = sx.role_column(df, "taxon_id", required=False)
    rank_col = sx.role_column(df, "rank", required=False)

    top_n = int(clamp(int(sx.param("top_n", 15) or 15), 1, 60))
    min_ra = clamp(float(sx.param("min_relative_abundance_pct", 0) or 0), 0, 100)
    rank_param = str(sx.param("rank", "species") or "").strip()

    n_rows_input = int(len(df))
    work = df[df[sample_col].notna() & df[taxon_col].notna()].copy()
    work[count_col] = pd.to_numeric(work[count_col], errors="coerce").astype(float)
    work[taxon_col] = work[taxon_col].astype(str).str.strip()

    # ------------------------------------------------------------------ #
    #  Rank filter
    # ------------------------------------------------------------------ #
    if rank_col and rank_param:
        ranks = work[rank_col].astype(object).map(lambda value: None if value is None else str(value).strip().casefold())
        available = ranks.dropna().unique().tolist()
        wanted = rank_param.casefold()
        if wanted in available:
            work = work[ranks == wanted]
            if len(available) > 1:
                sx.note(f'Kept {len(work)} rows of rank "{rank_param}" (ranks present: {", ".join(sorted(available))}).')
        elif len(available) > 1:
            most_common = ranks.value_counts().idxmax()
            work = work[ranks == most_common]
            sx.note(f'Rank "{rank_param}" is not present; used the most frequent rank "{most_common}" instead.')
        elif available:
            sx.note(f'Rank "{rank_param}" is not present; the table only has rank "{available[0]}", which was used.')

    # ------------------------------------------------------------------ #
    #  Non-detections and artifacts
    # ------------------------------------------------------------------ #
    positive = work[count_col] > 0
    n_nondetections = int((~positive).sum())
    work = work[positive]
    if n_nondetections:
        sx.note(f"Dropped {n_nondetections} rows with a missing or non-positive count.")

    artifact_names = sx.curated_names("artifact")
    artifact_keys = {sx.taxon_key(name) for name in artifact_names}
    total_reads_before = float(work[count_col].sum())
    is_artifact = work[taxon_col].map(sx.taxon_key).isin(artifact_keys)
    removed = work[is_artifact]
    removed_taxa = sorted(removed[taxon_col].unique().tolist())
    artifact_reads = float(removed[count_col].sum())
    work = work[~is_artifact]
    if removed_taxa:
        shown = ", ".join(removed_taxa[:10]) + (f" and {len(removed_taxa) - 10} more" if len(removed_taxa) > 10 else "")
        sx.note(f"Removed {len(removed_taxa)} artifact taxa from the curation lists before renormalising: {shown}.")
    elif artifact_names:
        sx.note("No taxon of the table matched the artifact curation lists.")
    else:
        sx.note("No artifact curation list attached; all taxa were kept.")

    samples_before = set(df[sample_col].dropna().unique().tolist())
    samples_after = set(work[sample_col].unique().tolist())
    n_dropped_samples = len(samples_before - samples_after)
    if n_dropped_samples:
        sx.note(f"{n_dropped_samples} sample(s) had no reads left after filtering and were dropped.")

    if work.empty:
        sx.note("No rows left after filtering; no composition was computed.")
        sx.metric("n_samples", 0)
        sx.metric("n_taxa", 0)
        sx.metric("n_rows_input", n_rows_input)
        sx.metric("n_artifact_taxa_removed", len(removed_taxa))
        sx.finish()
        return

    # ------------------------------------------------------------------ #
    #  Relative abundance (aggregate duplicates, renormalise per sample)
    # ------------------------------------------------------------------ #
    keep_cols = [column for column in (group_col, subject_col, time_col, taxon_id_col) if column]
    label_col = LABEL_COLUMN if LABEL_COLUMN in work.columns and LABEL_COLUMN != sample_col else None
    aggregations = {count_col: "sum"}
    for column in keep_cols + ([label_col] if label_col else []):
        aggregations[column] = "first"
    work = work.groupby([sample_col, taxon_col], sort=False, as_index=False).agg(aggregations)
    totals = work.groupby(sample_col)[count_col].transform("sum")
    work[RA_COLUMN] = 100.0 * work[count_col] / totals
    integral_counts = bool((work[count_col] % 1 == 0).all())
    if integral_counts:
        work[count_col] = work[count_col].round().astype("Int64")  # keep read counts integral in the output tables

    n_below = 0
    if min_ra > 0:
        below = work[RA_COLUMN] < min_ra
        n_below = int(below.sum())
        work = work[~below]
        sx.note(f"Dropped {n_below} taxon rows below {min_ra:g}% relative abundance; their share stays in Other in the figure.")

    # ------------------------------------------------------------------ #
    #  Sample order and labels
    # ------------------------------------------------------------------ #
    meta_cols = [column for column in (group_col, subject_col, time_col) if column]
    samples = work.groupby(sample_col, sort=False).agg({**{column: "first" for column in meta_cols}, **({label_col: "first"} if label_col else {})}).reset_index()
    samples["_label"] = samples[label_col].astype(object).where(samples[label_col].notna(), samples[sample_col]) if label_col else samples[sample_col]
    samples["_label"] = samples["_label"].astype(str)
    if samples["_label"].duplicated().any():
        samples["_label"] = samples["_label"] + " (" + samples[sample_col].astype(str) + ")"
    for column in meta_cols:
        samples[f"_sort_{column}"] = sort_key(samples[column])
    samples = samples.sort_values([f"_sort_{column}" for column in meta_cols] + ["_label"], kind="stable").reset_index(drop=True)
    sample_order = samples[sample_col].tolist()
    label_of = dict(zip(samples[sample_col], samples["_label"]))

    # ------------------------------------------------------------------ #
    #  Top taxa and figure
    # ------------------------------------------------------------------ #
    n_samples = len(sample_order)
    mean_ra = (work.groupby(taxon_col)[RA_COLUMN].sum() / n_samples).sort_values(ascending=False, kind="stable")
    top_taxa = mean_ra.index[:top_n].tolist()
    matrix = work.pivot_table(index=sample_col, columns=taxon_col, values=RA_COLUMN, aggfunc="sum", fill_value=0.0).reindex(sample_order).fillna(0.0)
    shown = matrix[top_taxa].sum(axis=1) if top_taxa else pd.Series(0.0, index=matrix.index)
    other = (100.0 - shown).clip(lower=0.0)

    hover_parts = [f"{column}=%{{customdata[{index}]}}" for index, column in enumerate(meta_cols)]
    customdata = samples[meta_cols].astype(object).where(samples[meta_cols].notna(), "").values.tolist() if meta_cols else None
    hovertemplate = "<b>%{x}</b><br>" + ("<br>".join(hover_parts) + "<br>" if hover_parts else "") + "%{fullData.name}: %{y:.2f}%<extra></extra>"
    labels = [label_of[sample] for sample in sample_order]
    fig = go.Figure()
    colors = palette(len(top_taxa))
    for index, taxon in enumerate(top_taxa):
        fig.add_trace(go.Bar(x=labels, y=matrix[taxon].tolist(), name=taxon, marker_color=colors[index], customdata=customdata, hovertemplate=hovertemplate))
    fig.add_trace(go.Bar(x=labels, y=other.tolist(), name=OTHER_LABEL, marker_color=OTHER_COLOR, customdata=customdata, hovertemplate=hovertemplate))
    subtitle = f"top {len(top_taxa)} taxa by mean relative abundance" + (", artifacts removed" if removed_taxa else "")
    fig.update_layout(
        title=f"Taxon composition ({subtitle})",
        barmode="stack",
        xaxis_title="Sample",
        yaxis_title="Relative abundance (%)",
        yaxis_range=[0, 100],
        legend_title_text="Taxon",
        legend_traceorder="normal",
        margin=dict(l=50, r=20, t=60, b=100),
        height=520,
    )
    fig.update_xaxes(type="category", tickangle=-45)
    if group_col:
        boundaries = samples[group_col].astype(object).map(lambda value: "" if value is None else str(value)).tolist()
        for index in range(1, len(boundaries)):
            if boundaries[index] != boundaries[index - 1]:
                fig.add_vline(x=index - 0.5, line_color="#666", line_width=1, line_dash="dot")
    sx.save_figure(
        fig,
        "composition_plot",
        title="Taxon composition",
        description=f"Stacked relative abundance of the {subtitle}; samples ordered by " + (", ".join(meta_cols) if meta_cols else "sample") + ".",
    )

    # ------------------------------------------------------------------ #
    #  Tables
    # ------------------------------------------------------------------ #
    composition = work.copy()
    composition["_order"] = composition[sample_col].map({sample: index for index, sample in enumerate(sample_order)})
    composition = composition.sort_values(["_order", RA_COLUMN], ascending=[True, False], kind="stable").drop(columns=["_order"])
    ordered_columns = [sample_col] + ([label_col] if label_col else []) + meta_cols + [taxon_col] + ([taxon_id_col] if taxon_id_col else []) + [count_col, RA_COLUMN]
    composition = composition[ordered_columns].reset_index(drop=True)
    composition_roles = {"sample": sample_col, "taxon": taxon_col, "count": count_col, "value": RA_COLUMN}
    for role, column in (("group", group_col), ("subject", subject_col), ("timepoint", time_col), ("taxon_id", taxon_id_col)):
        if column:
            composition_roles[role] = column
    sx.save_table(
        composition,
        "composition",
        title="Composition (long)",
        description="Sample x taxon rows with read count and relative abundance renormalised after artifact removal.",
        table_kind="taxon-profile-long",
        roles=composition_roles,
    )

    by_taxon = work.groupby(taxon_col, sort=False)
    prevalence = pd.DataFrame(
        {
            taxon_col: list(by_taxon.groups.keys()),
        }
    ).set_index(taxon_col)
    if taxon_id_col:
        prevalence[taxon_id_col] = by_taxon[taxon_id_col].first()
    prevalence["n_samples_present"] = by_taxon[sample_col].nunique()
    prevalence["prevalence_pct"] = 100.0 * prevalence["n_samples_present"] / n_samples
    prevalence["mean_relative_abundance_pct"] = by_taxon[RA_COLUMN].sum() / n_samples
    prevalence["mean_relative_abundance_when_present_pct"] = by_taxon[RA_COLUMN].mean()
    prevalence["max_relative_abundance_pct"] = by_taxon[RA_COLUMN].max()
    prevalence["total_reads"] = by_taxon[count_col].sum()
    prevalence["is_top"] = prevalence.index.isin(top_taxa)
    prevalence = prevalence.sort_values(["mean_relative_abundance_pct", "prevalence_pct"], ascending=[False, False], kind="stable").reset_index()
    prevalence_roles = {"taxon": taxon_col, "value": "mean_relative_abundance_pct"}
    if taxon_id_col:
        prevalence_roles["taxon_id"] = taxon_id_col
    sx.save_table(
        prevalence,
        "prevalence",
        title="Taxon prevalence",
        description="Per taxon: number and share of samples where it is present, mean and maximum relative abundance, total reads.",
        roles=prevalence_roles,
    )

    # ------------------------------------------------------------------ #
    #  Metrics
    # ------------------------------------------------------------------ #
    sx.metric("n_samples", n_samples)
    sx.metric("n_taxa", int(work[taxon_col].nunique()))
    sx.metric("n_rows_input", n_rows_input)
    sx.metric("n_rows_retained", int(len(work)))
    sx.metric("n_nondetections_dropped", n_nondetections)
    sx.metric("n_artifact_taxa_removed", len(removed_taxa))
    sx.metric("artifact_reads_pct", finite(100.0 * artifact_reads / total_reads_before) if total_reads_before > 0 else None)
    sx.metric("n_samples_dropped_empty", n_dropped_samples)
    sx.metric("n_rows_below_min_ra", n_below)
    sx.metric("top_n_effective", len(top_taxa))
    sx.metric("mean_top_n_coverage_pct", finite(shown.mean()))
    if group_col:
        sx.metric("n_groups", int(samples[group_col].dropna().nunique()))
    if subject_col:
        sx.metric("n_subjects", int(samples[subject_col].dropna().nunique()))
    sx.finish()


if __name__ == "__main__":
    main()
