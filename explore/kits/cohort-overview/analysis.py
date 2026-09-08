#!/usr/bin/env python3
"""Cohort overview: samples, subjects, groups, taxa, reads and a sampling timeline."""
from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
from plotly.colors import qualitative

import seqdesk_explore as sx
from seqdesk_explore.profiles import emit_notes, prepare_profile


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def main() -> None:
    df = sx.load_dataset("profiles")
    prepared = prepare_profile(df, rank=str(sx.param("rank", "species") or ""), remove_artifacts=bool(sx.param("remove_artifacts", True)))
    emit_notes(prepared)
    long, meta = prepared.long, prepared.meta
    sample_col, taxon_col, count_col = prepared.sample_col, prepared.taxon_col, prepared.count_col
    group_col, subject_col, time_col = prepared.group_col, prepared.subject_col, prepared.time_col
    if long.empty:
        sx.note("No rows left after filtering; nothing to summarise.")
        sx.metric("n_samples", 0)
        sx.finish()
        return

    reads_per_sample = prepared.counts.sum(axis=1)
    time_numeric = prepared.numeric_time()
    groups = meta[group_col].astype(object).where(meta[group_col].notna(), "(none)").astype(str) if group_col else pd.Series("all", index=meta.index)

    # ------------------------------------------------------------------ #
    #  Overview table: one row per group and a total row
    # ------------------------------------------------------------------ #
    def summarise(label: str, samples: pd.Index) -> dict:
        rows = long[long[sample_col].isin(samples)]
        entry = {
            "group": label,
            "n_samples": int(len(samples)),
            "n_subjects": int(meta.loc[samples, subject_col].nunique()) if subject_col else None,
            "n_taxa": int(rows[taxon_col].nunique()),
            "total_reads": float(rows[count_col].sum()),
            "median_reads_per_sample": finite(reads_per_sample.loc[samples].median()) if len(samples) else None,
        }
        if time_numeric is not None:
            times = time_numeric.loc[samples].dropna()
            entry["first_timepoint"] = finite(times.min()) if len(times) else None
            entry["last_timepoint"] = finite(times.max()) if len(times) else None
        return entry

    order = groups.value_counts().index.tolist()
    overview_rows = [summarise(label, meta.index[groups == label]) for label in order]
    if len(order) > 1:
        overview_rows.append(summarise("All", meta.index))
    overview = pd.DataFrame(overview_rows)
    if not subject_col:
        overview = overview.drop(columns=["n_subjects"])
    sx.save_table(overview, "overview", title="Cohort overview", description="Samples, subjects, taxa and reads per group and in total.", roles={"group": "group"})

    # ------------------------------------------------------------------ #
    #  Subjects table
    # ------------------------------------------------------------------ #
    if subject_col:
        per_subject = meta.groupby(subject_col, sort=False)
        subjects = pd.DataFrame({subject_col: list(per_subject.groups.keys())}).set_index(subject_col)
        subjects["n_samples"] = per_subject.size()
        if group_col:
            subjects["groups"] = per_subject[group_col].agg(lambda values: ", ".join(sorted({str(v) for v in values.dropna()})))
        if time_numeric is not None:
            by_subject_time = time_numeric.groupby(meta[subject_col])
            subjects["n_timepoints"] = by_subject_time.nunique()
            subjects["first_timepoint"] = by_subject_time.min()
            subjects["last_timepoint"] = by_subject_time.max()
            subjects["span"] = subjects["last_timepoint"] - subjects["first_timepoint"]
            subjects = subjects.sort_values(["first_timepoint", "n_samples"], ascending=[True, False], kind="stable")
        else:
            subjects = subjects.sort_values("n_samples", ascending=False, kind="stable")
        subjects = subjects.reset_index()
        sx.save_table(subjects, "subjects", title="Subjects", description="One row per subject: groups, samples, timepoints and the span of the sampling.", roles={"subject": subject_col})

    # ------------------------------------------------------------------ #
    #  Figures
    # ------------------------------------------------------------------ #
    palette = list(qualitative.Set2) + list(qualitative.Dark24)
    colour_of = {label: palette[index % len(palette)] for index, label in enumerate(order)}

    fig = go.Figure()
    fig.add_trace(go.Bar(x=order, y=[int((groups == label).sum()) for label in order], name="Samples", marker_color=[colour_of[label] for label in order]))
    if subject_col:
        fig.add_trace(go.Bar(x=order, y=[int(meta.loc[groups == label, subject_col].nunique()) for label in order], name="Subjects", marker_color="#94A3B8"))
    fig.update_layout(title="Samples per group" if group_col else "Samples", barmode="group", xaxis_title=group_col or "", yaxis_title="Count", margin=dict(l=50, r=20, t=50, b=60), height=360)
    sx.save_figure(fig, "samples_per_group", title="Samples per group", description="Number of samples (and subjects) per group.")

    if subject_col and time_numeric is not None:
        timeline = pd.DataFrame({"subject": meta[subject_col].astype(str), "time": time_numeric, "group": groups, "reads": reads_per_sample})
        timeline = timeline.dropna(subset=["time"])
        first = timeline.groupby("subject")["time"].min().sort_values(kind="stable")
        subject_order = first.index.tolist()
        fig = go.Figure()
        for label in order:
            part = timeline[timeline["group"] == label]
            if part.empty:
                continue
            fig.add_trace(
                go.Scatter(
                    x=part["time"],
                    y=part["subject"],
                    mode="markers",
                    name=label,
                    marker=dict(size=8, color=colour_of[label], line=dict(width=0.5, color="#333")),
                    customdata=part[["reads"]].round(0).values.tolist(),
                    hovertemplate="%{y}<br>" + (f"{time_col}: " if time_col else "") + "%{x}<br>reads: %{customdata[0]}<extra>" + label + "</extra>",
                )
            )
        fig.update_layout(
            title="Sampling timeline",
            xaxis_title=time_col or "Timepoint",
            yaxis=dict(title=subject_col, categoryorder="array", categoryarray=subject_order, tickfont=dict(size=9)),
            legend_title_text=group_col or "",
            margin=dict(l=90, r=20, t=50, b=50),
            height=max(360, 14 * len(subject_order) + 120),
        )
        sx.save_figure(fig, "sampling_timeline", title="Sampling timeline", description="One marker per sample: subjects ordered by their first timepoint, coloured by group.")
    else:
        sx.note("No subject and numeric timepoint roles mapped; the sampling timeline was not drawn.")

    # ------------------------------------------------------------------ #
    #  Metrics
    # ------------------------------------------------------------------ #
    sx.metric("n_samples", int(len(meta)))
    sx.metric("n_subjects", int(meta[subject_col].nunique()) if subject_col else None)
    sx.metric("n_groups", int(len(order)) if group_col else 0)
    sx.metric("n_taxa", int(long[taxon_col].nunique()))
    sx.metric("total_reads", float(long[count_col].sum()))
    if time_numeric is not None:
        sx.metric("first_timepoint", finite(time_numeric.min()))
        sx.metric("last_timepoint", finite(time_numeric.max()))
    sx.finish()


if __name__ == "__main__":
    main()
