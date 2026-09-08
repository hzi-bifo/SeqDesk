#!/usr/bin/env python3
"""Community stability: how much a subject's community changes between its samples.

Within-subject dissimilarity between consecutive samples (Bray-Curtis on
relative abundance or Jaccard on presence) is set against the time gap between
them and against the dissimilarity between different subjects, so drift,
resilience and the effect of time become visible per group.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.colors import qualitative
from scipy import stats

import seqdesk_explore as sx
from seqdesk_explore.profiles import emit_notes, prepare_profile

METRICS = {"braycurtis": "Bray-Curtis dissimilarity", "jaccard": "Jaccard distance"}
BASELINE_COLOR = "#B0B7C3"
MAX_BASELINE_PAIRS = 4000


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def dissimilarity(x: np.ndarray, y: np.ndarray, metric: str) -> float:
    if metric == "jaccard":
        px, py = x > 0, y > 0
        union = int(np.sum(px | py))
        return float(1.0 - np.sum(px & py) / union) if union else 0.0
    total = float(np.sum(x + y))
    return float(np.sum(np.abs(x - y)) / total) if total > 0 else 0.0


def palette(n: int) -> list[str]:
    colors = list(qualitative.D3) + list(qualitative.Set2)
    return [colors[index % len(colors)] for index in range(n)]


def stop(message: str) -> None:
    sx.note(message)
    sx.metric("n_subjects", 0)
    sx.metric("n_pairs", 0)
    sx.metric("n_consecutive_pairs", 0)
    sx.finish()


def main() -> None:
    df = sx.load_dataset("profiles")
    prepared = prepare_profile(
        df,
        rank=str(sx.param("rank", "species") or ""),
        min_reads=float(sx.param("min_reads", 0) or 0),
        remove_artifacts=bool(sx.param("remove_artifacts", True)),
    )
    emit_notes(prepared)
    metric = str(sx.param("metric", "braycurtis") or "braycurtis")
    if metric not in METRICS:
        sx.note(f'Unknown dissimilarity "{metric}"; using braycurtis.')
        metric = "braycurtis"
    within_group = bool(sx.param("within_group_only", True))
    max_gap = max(0.0, float(sx.param("max_gap", 0) or 0))
    subject_col, time_col, group_col = prepared.subject_col, prepared.time_col, prepared.group_col
    if not subject_col or not time_col:
        stop("Subject and timepoint roles are needed to follow a subject over time.")
        return

    meta = prepared.meta.copy()
    meta["_time"] = pd.to_numeric(meta[time_col], errors="coerce")
    missing = int(meta["_time"].isna().sum())
    if missing:
        sx.note(f"Dropped {missing} sample(s) without a numeric timepoint.")
    meta = meta[meta["_time"].notna()]
    if len(meta) < 2:
        stop("Fewer than two samples with a timepoint; nothing to compare.")
        return
    relative = prepared.relative.loc[meta.index]
    matrix = relative.to_numpy(dtype=float) / 100.0
    position = {sample: index for index, sample in enumerate(relative.index)}
    meta["_group"] = meta[group_col].astype(object).map(lambda value: "(none)" if value is None else str(value)) if group_col else "all"
    meta["_subject"] = meta[subject_col].astype(str)
    pair_within_group = bool(group_col) and within_group

    # ------------------------------------------------------------------ #
    #  Within-subject pairs
    # ------------------------------------------------------------------ #
    rows = []
    keys = ["_subject"] + (["_group"] if pair_within_group else [])
    for _, part in meta.groupby(keys, sort=False):
        part = part.sort_values("_time", kind="stable")
        samples = part.index.tolist()
        if len(samples) < 2:
            continue
        for i in range(len(samples)):
            for j in range(i + 1, len(samples)):
                a, b = samples[i], samples[j]
                gap = float(part.at[b, "_time"] - part.at[a, "_time"])
                if max_gap > 0 and gap > max_gap:
                    continue
                row = {subject_col: part.at[a, "_subject"]}
                if group_col:
                    row["group_a"] = part.at[a, "_group"]
                    row["group_b"] = part.at[b, "_group"]
                row.update(
                    {
                        "sample_a": a,
                        "sample_b": b,
                        "time_a": float(part.at[a, "_time"]),
                        "time_b": float(part.at[b, "_time"]),
                        "gap": gap,
                        "dissimilarity": dissimilarity(matrix[position[a]], matrix[position[b]], metric),
                        "consecutive": j == i + 1,
                    }
                )
                rows.append(row)
    pairs = pd.DataFrame(rows)
    if pairs.empty:
        stop("No subject has two samples to compare" + (" within one group" if pair_within_group else "") + ".")
        return
    pairs = pairs.sort_values([subject_col, "time_a", "time_b"], kind="stable").reset_index(drop=True)
    roles = {"subject": subject_col, "value": "dissimilarity"}
    if group_col:
        roles["group"] = "group_a"
    sx.save_table(
        pairs,
        "sample_pairs",
        title="Sample pairs within subjects",
        description=f"Every pair of samples of one subject{' and group' if pair_within_group else ''}: their timepoints, the gap, the {METRICS[metric]} and whether they are consecutive.",
        roles=roles,
    )
    consecutive = pairs[pairs["consecutive"]].copy()
    consecutive["_plot_group"] = consecutive["group_a"] if group_col else "all"

    # ------------------------------------------------------------------ #
    #  Between-subject baseline: random pairs of different subjects
    # ------------------------------------------------------------------ #
    rng = np.random.default_rng(0)
    n = len(relative)
    subjects = meta["_subject"].to_numpy()
    groups = meta["_group"].to_numpy()
    n_possible = n * (n - 1) // 2
    baseline_rows = []
    if n_possible <= MAX_BASELINE_PAIRS:
        candidates = [(i, j) for i in range(n) for j in range(i + 1, n)]
    else:
        drawn = set()
        while len(drawn) < MAX_BASELINE_PAIRS:
            i, j = (int(value) for value in rng.integers(0, n, 2))
            if i != j:
                drawn.add((min(i, j), max(i, j)))
        candidates = sorted(drawn)
    for i, j in candidates:
        if subjects[i] == subjects[j]:
            continue
        if pair_within_group and groups[i] != groups[j]:
            continue
        baseline_rows.append({"group": groups[i] if group_col else "all", "dissimilarity": dissimilarity(matrix[i], matrix[j], metric)})
    baseline = pd.DataFrame(baseline_rows, columns=["group", "dissimilarity"])

    # ------------------------------------------------------------------ #
    #  Per-subject summary
    # ------------------------------------------------------------------ #
    summary_keys = [subject_col] + (["group_a"] if group_col else [])
    stability = (
        consecutive.groupby(summary_keys, sort=False)
        .agg(
            n_pairs=("dissimilarity", "size"),
            median_dissimilarity=("dissimilarity", "median"),
            max_dissimilarity=("dissimilarity", "max"),
            median_gap=("gap", "median"),
            first_time=("time_a", "min"),
            last_time=("time_b", "max"),
        )
        .reset_index()
    )
    stability.insert(len(summary_keys), "n_samples", stability["n_pairs"] + 1)
    stability = stability.sort_values("median_dissimilarity", ascending=False, kind="stable").reset_index(drop=True)
    stability_roles = {"subject": subject_col, "value": "median_dissimilarity"}
    if group_col:
        stability_roles["group"] = "group_a"
    sx.save_table(
        stability,
        "subject_stability",
        title="Stability per subject",
        description=f"Per subject{' and group' if group_col else ''}: samples, consecutive pairs, median and maximum {METRICS[metric]} between consecutive samples, median gap, first and last timepoint.",
        roles=stability_roles,
    )

    # ------------------------------------------------------------------ #
    #  Figures
    # ------------------------------------------------------------------ #
    group_order = consecutive["_plot_group"].value_counts().index.tolist()
    colors = palette(len(group_order))
    fig = go.Figure()
    for index, group in enumerate(group_order):
        part = consecutive[consecutive["_plot_group"] == group]
        fig.add_trace(
            go.Scatter(
                x=part["gap"],
                y=part["dissimilarity"],
                mode="markers",
                name=f"{group} (n={len(part)})" if group_col else f"consecutive pairs (n={len(part)})",
                marker=dict(size=6, color=colors[index], opacity=0.65),
                text=part[subject_col].astype(str) + ": " + part["sample_a"].astype(str) + " to " + part["sample_b"].astype(str),
                hovertemplate="%{text}<br>gap %{x:g}<br>dissimilarity %{y:.2f}<extra></extra>",
            )
        )
        if len(part) >= 8 and np.ptp(part["gap"].to_numpy()) > 0:
            bins = pd.qcut(part["gap"].rank(method="first"), q=min(8, len(part) // 4), labels=False)
            medians = part.groupby(bins).agg(x=("gap", "median"), y=("dissimilarity", "median")).sort_values("x")
            fig.add_trace(go.Scatter(x=medians["x"], y=medians["y"], mode="lines", line=dict(color=colors[index], width=2), showlegend=False, hovertemplate="running median %{y:.2f}<extra></extra>"))
        base = baseline[baseline["group"] == group]["dissimilarity"] if group_col else baseline["dissimilarity"]
        if len(base):
            fig.add_hline(y=float(base.median()), line_dash="dot", line_color=colors[index], annotation_text=f"{group}: between subjects" if group_col else "between subjects", annotation_position="top left", annotation_font_size=9)
    fig.update_layout(
        title=f"Turnover between consecutive samples of a subject ({METRICS[metric]})",
        xaxis_title=f"Time gap ({time_col})",
        yaxis=dict(title=METRICS[metric], range=[0, 1.04]),
        legend=dict(orientation="h", y=-0.2),
        margin=dict(l=60, r=20, t=60, b=80),
        height=480,
    )
    sx.save_figure(
        fig,
        "turnover_vs_gap",
        title="Turnover against time gap",
        description=f"{METRICS[metric]} between consecutive samples of one subject against the time between them, coloured by group, with running medians; dotted lines mark the median dissimilarity between different subjects.",
    )

    fig2 = go.Figure()
    for index, group in enumerate(group_order):
        within = consecutive[consecutive["_plot_group"] == group]["dissimilarity"]
        base = baseline[baseline["group"] == group]["dissimilarity"] if group_col else baseline["dissimilarity"]
        fig2.add_trace(go.Box(x=[group] * len(within), y=within, name="within subject, consecutive", marker_color="#4C72B0", legendgroup="within", showlegend=index == 0, boxpoints="all", jitter=0.4, pointpos=0, marker_size=3))
        fig2.add_trace(go.Box(x=[group] * len(base), y=base, name="between subjects", marker_color=BASELINE_COLOR, legendgroup="between", showlegend=index == 0, boxpoints=False))
    fig2.update_layout(
        title="Within-subject change against the between-subject baseline",
        boxmode="group",
        yaxis=dict(title=METRICS[metric], range=[0, 1.04]),
        xaxis_title=group_col or "",
        legend=dict(orientation="h", y=-0.2),
        margin=dict(l=60, r=20, t=60, b=80),
        height=440,
    )
    sx.save_figure(fig2, "stability_by_group", title="Stability per group", description=f"{METRICS[metric]} between consecutive samples of one subject next to the dissimilarity between samples of different subjects, per group.")

    # ------------------------------------------------------------------ #
    #  Metrics
    # ------------------------------------------------------------------ #
    rho, p_value = (None, None)
    if len(consecutive) >= 5 and np.ptp(consecutive["gap"].to_numpy()) > 0 and np.ptp(consecutive["dissimilarity"].to_numpy()) > 0:
        statistic, p = stats.spearmanr(consecutive["gap"], consecutive["dissimilarity"])
        rho, p_value = finite(statistic), finite(p)
    sx.metric("metric", metric)
    sx.metric("n_samples", int(n))
    sx.metric("n_subjects", int(consecutive[subject_col].nunique()))
    sx.metric("n_pairs", int(len(pairs)))
    sx.metric("n_consecutive_pairs", int(len(consecutive)))
    sx.metric("median_within_consecutive", finite(consecutive["dissimilarity"].median()))
    sx.metric("median_between_subjects", finite(baseline["dissimilarity"].median()) if len(baseline) else None)
    sx.metric("n_baseline_pairs", int(len(baseline)))
    sx.metric("spearman_gap_rho", rho)
    sx.metric("spearman_gap_p", p_value)
    sx.finish()


if __name__ == "__main__":
    main()
