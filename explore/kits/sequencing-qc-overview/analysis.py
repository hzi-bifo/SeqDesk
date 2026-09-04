#!/usr/bin/env python3
"""Sequencing QC overview: reads per sample, quality per run, QC tables.

Works on the built-in Sequencing dataset (one row per sample per run) and on
any sample-summary table with a mapped sample role. Every panel that needs a
column the table does not have is skipped and listed in the run notes.
"""
from __future__ import annotations

import math

import pandas as pd
import plotly.graph_objects as go
from plotly.colors import qualitative
from plotly.subplots import make_subplots

import seqdesk_explore as sx

READ_COUNT_COLUMNS = ("read_count_1", "read_count_2")
QUALITY_COLUMNS = ("avg_quality_1", "avg_quality_2")
Q30_COLUMN = "q30_score"
RUN_COLUMN = "run_id"
LABEL_COLUMN = "sample_id"
RUN_INFO_COLUMNS = ("run_name", "platform", "instrument", "run_date", "cluster_density", "pass_filter_pct", "run_total_reads", "run_total_bases")


def present(df: pd.DataFrame, *columns: str) -> list[str]:
    return [column for column in columns if column in df.columns]


def numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").astype(float)


def first_text(series: pd.Series):
    values = series.dropna()
    return str(values.iloc[0]) if len(values) else None


def joined_text(series: pd.Series) -> str | None:
    values = sorted({str(value) for value in series.dropna()})
    return "; ".join(values) if values else None


def optional_float(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def main() -> None:
    df = sx.load_dataset("sequencing")
    sample_col = sx.role_column(df, "sample")
    threshold = int(sx.param("low_read_threshold", 10000) or 0)
    threshold = max(0, threshold)

    df = df[df[sample_col].notna()].copy()
    if df.empty:
        sx.note("The table has no rows with a sample; nothing to summarise.")
        sx.metric("n_samples", 0)
        sx.metric("n_rows", 0)
        sx.finish()
        return

    label_col = LABEL_COLUMN if LABEL_COLUMN in df.columns and LABEL_COLUMN != sample_col else None
    df["_label"] = df[label_col].astype(object).where(df[label_col].notna(), df[sample_col]) if label_col else df[sample_col]
    df["_label"] = df["_label"].astype(str)

    run_col = RUN_COLUMN if RUN_COLUMN in df.columns else None
    read_cols = present(df, *READ_COUNT_COLUMNS)
    quality_cols = present(df, *QUALITY_COLUMNS)
    q30_col = Q30_COLUMN if Q30_COLUMN in df.columns else None
    skipped: list[str] = []

    for column in read_cols + quality_cols + ([q30_col] if q30_col else []):
        df[column] = numeric(df[column])
    if read_cols:
        df["_row_reads"] = df[read_cols].sum(axis=1, min_count=1)
    else:
        df["_row_reads"] = float("nan")

    # ------------------------------------------------------------------ #
    #  Per-sample QC table
    # ------------------------------------------------------------------ #
    grouped = df.groupby(sample_col, sort=True)
    qc = pd.DataFrame({sample_col: list(grouped.groups.keys())}).set_index(sample_col)
    qc["sample_label"] = grouped["_label"].first()
    qc["n_rows"] = grouped.size()
    if run_col:
        qc["n_runs"] = grouped[run_col].nunique()
        qc["run_ids"] = grouped[run_col].agg(joined_text)
    if "platform" in df.columns:
        qc["platforms"] = grouped["platform"].agg(joined_text)
    for column in read_cols:
        qc[f"reads_{column.rsplit('_', 1)[-1]}"] = grouped[column].sum(min_count=1)
    if read_cols:
        qc["total_reads"] = grouped["_row_reads"].sum(min_count=1)
    for column in quality_cols:
        qc[f"mean_{column}"] = grouped[column].mean()
    if q30_col:
        qc[Q30_COLUMN] = grouped[q30_col].mean()
    if read_cols:
        qc["no_reads"] = qc["total_reads"].isna()
        qc["low_yield"] = qc["total_reads"].notna() & (qc["total_reads"] < threshold)
    qc = qc.reset_index()
    for column in ("reads_1", "reads_2", "total_reads"):
        if column in qc.columns:
            qc[column] = qc[column].round().astype("Int64")
    roles = {"sample": sample_col}
    if "total_reads" in qc.columns:
        roles["count"] = "total_reads"
    sx.save_table(
        qc,
        "qc_table",
        title="Per-sample QC",
        description="Read totals, mean read quality, runs and low-yield flags per sample.",
        table_kind="sample-summary",
        roles=roles,
    )

    # ------------------------------------------------------------------ #
    #  Per-run table
    # ------------------------------------------------------------------ #
    if run_col:
        by_run = df[df[run_col].notna()].groupby(run_col, sort=True)
        runs = pd.DataFrame({run_col: list(by_run.groups.keys())}).set_index(run_col)
        runs["n_samples"] = by_run[sample_col].nunique()
        runs["n_rows"] = by_run.size()
        for column in present(df, *RUN_INFO_COLUMNS):
            runs[column] = by_run[column].first()
        if q30_col:
            runs[Q30_COLUMN] = by_run[q30_col].mean()
        if read_cols:
            runs["assigned_reads"] = by_run["_row_reads"].sum(min_count=1).round().astype("Int64")
        for column in quality_cols:
            runs[f"mean_{column}"] = by_run[column].mean()
        runs = runs.reset_index()
        sx.save_table(runs, "runs", title="Per-run summary", description="Platform, sample count, Q30 and read totals per sequencing run.")
    else:
        skipped.append("runs table (no run_id column)")

    # ------------------------------------------------------------------ #
    #  Reads per sample
    # ------------------------------------------------------------------ #
    if read_cols:
        order = qc.sort_values(["total_reads", "sample_label"], ascending=[False, True], na_position="last")
        labels = order["sample_label"].tolist()
        fig = go.Figure()
        if run_col:
            per_run = df[df[run_col].notna()].groupby([sample_col, run_col])["_row_reads"].sum(min_count=1).reset_index()
            label_of = dict(zip(qc[sample_col], qc["sample_label"]))
            palette = qualitative.D3
            for index, run_id in enumerate(sorted(per_run[run_col].astype(str).unique())):
                subset = per_run[per_run[run_col].astype(str) == run_id]
                values = dict(zip(subset[sample_col].map(label_of), subset["_row_reads"]))
                fig.add_trace(go.Bar(x=labels, y=[values.get(label) for label in labels], name=str(run_id), marker_color=palette[index % len(palette)]))
            fig.update_layout(barmode="stack", legend_title_text="Run")
        else:
            totals = dict(zip(order["sample_label"], order["total_reads"].astype(float)))
            fig.add_trace(go.Bar(x=labels, y=[totals.get(label) for label in labels], name="Reads", marker_color=qualitative.D3[0]))
        if threshold > 0:
            fig.add_hline(y=threshold, line_dash="dash", line_color="#888", annotation_text=f"low-yield threshold ({threshold:,})", annotation_position="top right")
        fig.update_layout(title="Reads per sample", xaxis_title="Sample", yaxis_title="Reads", margin=dict(l=50, r=20, t=60, b=80), height=460)
        fig.update_xaxes(type="category", tickangle=-45)
        sx.save_figure(fig, "reads_per_sample", title="Reads per sample", description="Total reads per sample" + (", stacked by run." if run_col else "."))
    else:
        skipped.append("reads_per_sample figure (no read_count_1/read_count_2 column)")

    # ------------------------------------------------------------------ #
    #  Quality by run
    # ------------------------------------------------------------------ #
    if run_col and (quality_cols or q30_col):
        run_rows = df[df[run_col].notna()].copy()
        run_rows[run_col] = run_rows[run_col].astype(str)
        run_ids = sorted(run_rows[run_col].unique())
        panels = ([("Average read quality per run", "box")] if quality_cols else []) + ([("Q30 per run", "bar")] if q30_col else [])
        fig = make_subplots(rows=1, cols=len(panels), subplot_titles=[title for title, _ in panels])
        col = 1
        if quality_cols:
            for index, column in enumerate(quality_cols):
                fig.add_trace(go.Box(x=run_rows[run_col], y=run_rows[column], name=column, marker_color=qualitative.D3[index % len(qualitative.D3)], boxpoints="all", jitter=0.3, pointpos=0), row=1, col=col)
            fig.update_yaxes(title_text="Mean Phred quality", row=1, col=col)
            fig.update_layout(boxmode="group")
            col += 1
        if q30_col:
            q30 = run_rows.groupby(run_col)[q30_col].mean().reindex(run_ids)
            fig.add_trace(go.Bar(x=run_ids, y=q30.tolist(), name="Q30 (%)", marker_color=qualitative.D3[2], showlegend=False), row=1, col=col)
            fig.update_yaxes(title_text="Q30 (%)", row=1, col=col)
            missing_q30 = [run_id for run_id in run_ids if pd.isna(q30.get(run_id))]
            if missing_q30:
                sx.note(f"No Q30 score for run(s): {', '.join(missing_q30)}.")
        fig.update_layout(title="Read quality by run", margin=dict(l=50, r=20, t=70, b=60), height=440)
        fig.update_xaxes(type="category")
        sx.save_figure(fig, "quality_by_run", title="Read quality by run", description="Per-run distribution of mean read quality and the run Q30 score.")
    else:
        reason = "no run_id column" if not run_col else "no avg_quality_1/avg_quality_2/q30_score column"
        skipped.append(f"quality_by_run figure ({reason})")

    # ------------------------------------------------------------------ #
    #  Metrics and notes
    # ------------------------------------------------------------------ #
    sx.metric("n_samples", int(len(qc)))
    sx.metric("n_rows", int(len(df)))
    if run_col:
        sx.metric("n_runs", int(df[run_col].dropna().nunique()))
    if read_cols:
        totals = qc["total_reads"].astype(float)
        sx.metric("total_reads", optional_float(totals.sum(skipna=True)))
        sx.metric("median_reads_per_sample", optional_float(totals.median(skipna=True)))
        sx.metric("n_low_yield", int(qc["low_yield"].sum()))
        sx.metric("n_samples_without_reads", int(qc["no_reads"].sum()))
        sx.metric("low_read_threshold", threshold)
    if q30_col:
        sx.metric("mean_q30", optional_float(df.drop_duplicates(subset=[run_col] if run_col else None)[q30_col].mean()))
    for column in quality_cols:
        sx.metric(f"mean_{column}", optional_float(df[column].mean()))
    for item in skipped:
        sx.note(f"Skipped {item}.")
    sx.finish()


if __name__ == "__main__":
    main()
