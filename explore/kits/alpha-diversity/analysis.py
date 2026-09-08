#!/usr/bin/env python3
"""Alpha diversity per sample: richness, Shannon, Simpson, evenness; groups and time."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.colors import qualitative
from scipy import stats

import seqdesk_explore as sx
from seqdesk_explore.profiles import bh_fdr, emit_notes, prepare_profile, shannon

METRICS = {"shannon": "Shannon index", "richness": "Richness (taxa)", "simpson": "Simpson index", "evenness": "Pielou evenness"}


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def main() -> None:
    df = sx.load_dataset("profiles")
    metric = str(sx.param("metric", "shannon") or "shannon")
    if metric not in METRICS:
        sx.note(f'Unknown index "{metric}"; using shannon.')
        metric = "shannon"
    prepared = prepare_profile(
        df,
        rank=str(sx.param("rank", "species") or ""),
        min_reads=float(sx.param("min_reads", 0) or 0),
        remove_artifacts=bool(sx.param("remove_artifacts", True)),
    )
    emit_notes(prepared)
    if prepared.relative.empty:
        sx.note("No samples left after filtering; no diversity was computed.")
        sx.metric("n_samples", 0)
        sx.finish()
        return

    fractions = prepared.relative.to_numpy(dtype=float) / 100.0
    alpha = pd.DataFrame(index=prepared.relative.index)
    alpha["richness"] = (fractions > 0).sum(axis=1)
    alpha["shannon"] = [shannon(row) for row in fractions]
    alpha["simpson"] = 1.0 - (fractions**2).sum(axis=1)
    alpha["evenness"] = [h / math.log(s) if s > 1 else np.nan for h, s in zip(alpha["shannon"], alpha["richness"])]
    alpha["reads"] = prepared.counts.sum(axis=1)
    for column in prepared.meta_cols:
        alpha[column] = prepared.meta[column]
    group_col, subject_col, time_col = prepared.group_col, prepared.subject_col, prepared.time_col
    time_numeric = prepared.numeric_time()

    table = alpha.reset_index().rename(columns={"index": prepared.sample_col})
    roles = {"sample": prepared.sample_col, "value": metric}
    for role, column in (("group", group_col), ("subject", subject_col), ("timepoint", time_col)):
        if column:
            roles[role] = column
    sx.save_table(table, "alpha_diversity", title="Alpha diversity per sample", description="Richness, Shannon, Simpson and Pielou evenness per sample after artifact removal.", roles=roles)

    # ------------------------------------------------------------------ #
    #  Tests: groups (Kruskal-Wallis) and time (Spearman), BH within family
    # ------------------------------------------------------------------ #
    tests: list[dict] = []
    groups = alpha[group_col].astype(object).where(alpha[group_col].notna(), "(none)").astype(str) if group_col else None
    group_order = groups.value_counts().index.tolist() if groups is not None else []
    for index in METRICS:
        values = alpha[index]
        if groups is not None and len(group_order) >= 2:
            samples = [values[groups == label].dropna().to_numpy() for label in group_order]
            samples = [part for part in samples if len(part) >= 2]
            if len(samples) >= 2 and any(np.ptp(part) > 0 for part in samples):
                try:
                    statistic, p = stats.kruskal(*samples)
                    tests.append({"test": "kruskal-wallis", "scope": "groups", "index": index, "n": int(sum(len(part) for part in samples)), "statistic": finite(statistic), "p_value": finite(p)})
                except ValueError:
                    pass
        if time_numeric is not None:
            scopes = [("all", alpha.index)] + ([(label, alpha.index[groups == label]) for label in group_order] if groups is not None else [])
            for label, members in scopes:
                pair = pd.DataFrame({"time": time_numeric.loc[members], "value": values.loc[members]}).dropna()
                if len(pair) >= 8 and np.ptp(pair["time"]) > 0 and np.ptp(pair["value"]) > 0:
                    rho, p = stats.spearmanr(pair["time"], pair["value"])
                    tests.append({"test": "spearman-time", "scope": label, "index": index, "n": int(len(pair)), "statistic": finite(rho), "p_value": finite(p)})
    tests_table = pd.DataFrame(tests, columns=["test", "scope", "index", "n", "statistic", "p_value"])
    if not tests_table.empty:
        tests_table["q_value"] = np.nan
        for family in tests_table["test"].unique():
            mask = tests_table["test"] == family
            tests_table.loc[mask, "q_value"] = bh_fdr(tests_table.loc[mask, "p_value"].to_numpy(dtype=float))
    sx.save_table(tests_table, "alpha_tests", title="Alpha diversity tests", description="Kruskal-Wallis across groups and Spearman correlation with time per index; q-values by Benjamini-Hochberg within each test family.")

    # ------------------------------------------------------------------ #
    #  Figures
    # ------------------------------------------------------------------ #
    palette = list(qualitative.Set2) + list(qualitative.Dark24)
    colour_of = {label: palette[index % len(palette)] for index, label in enumerate(group_order)}
    label = METRICS[metric]
    fig = go.Figure()
    if groups is not None:
        for name in group_order:
            part = alpha[groups == name]
            fig.add_trace(go.Box(y=part[metric], name=name, boxpoints="all", jitter=0.4, pointpos=0, marker=dict(size=5, color=colour_of[name]), line=dict(color=colour_of[name]), hovertext=part.index.astype(str), hoverinfo="y+text"))
        kw = tests_table[(tests_table["test"] == "kruskal-wallis") & (tests_table["index"] == metric)] if not tests_table.empty else pd.DataFrame()
        subtitle = f"Kruskal-Wallis p = {kw['p_value'].iloc[0]:.3g}" if len(kw) else ""
        fig.update_layout(title=f"{label} per {group_col}" + (f" ({subtitle})" if subtitle else ""), xaxis_title=group_col, showlegend=False)
    else:
        fig.add_trace(go.Histogram(x=alpha[metric], nbinsx=30, marker_color="#4C72B0"))
        fig.update_layout(title=f"{label} across samples", xaxis_title=label)
    fig.update_layout(yaxis_title=label if groups is not None else "Samples", margin=dict(l=50, r=20, t=50, b=60), height=420)
    sx.save_figure(fig, "alpha_by_group", title=f"{label} per group", description="Box plots per group with every sample as a point." if groups is not None else "Distribution of the index across samples.")

    if time_numeric is not None:
        fig = go.Figure()
        frame = pd.DataFrame({"time": time_numeric, "value": alpha[metric], "group": groups if groups is not None else "all", "subject": alpha[subject_col].astype(str) if subject_col else alpha.index.astype(str)}).dropna(subset=["time", "value"])
        scopes = group_order if groups is not None else ["all"]
        for name in scopes:
            part = frame[frame["group"] == name].sort_values("time")
            if part.empty:
                continue
            colour = colour_of.get(name, "#4C72B0")
            fig.add_trace(go.Scatter(x=part["time"], y=part["value"], mode="markers", name=name, marker=dict(size=6, color=colour, opacity=0.7), text=part["subject"], hovertemplate="%{text}<br>%{x}: %{y:.3f}<extra>" + name + "</extra>"))
            if len(part) >= 8:
                bins = min(8, max(2, len(part) // 6))
                edges = np.quantile(part["time"], np.linspace(0, 1, bins + 1))
                centres, medians = [], []
                for low, high in zip(edges[:-1], edges[1:]):
                    chunk = part[(part["time"] >= low) & (part["time"] <= high)]
                    if len(chunk):
                        centres.append(float(chunk["time"].median()))
                        medians.append(float(chunk["value"].median()))
                fig.add_trace(go.Scatter(x=centres, y=medians, mode="lines", name=f"{name} median", line=dict(color=colour, width=2), showlegend=False, hoverinfo="skip"))
        fig.update_layout(title=f"{label} over time", xaxis_title=time_col, yaxis_title=label, legend_title_text=group_col or "", margin=dict(l=50, r=20, t=50, b=60), height=420)
        sx.save_figure(fig, "alpha_over_time", title=f"{label} over time", description="Every sample against its timepoint with a running median per group.")
    else:
        sx.note("No numeric timepoint role mapped; the time plot was not drawn.")

    # ------------------------------------------------------------------ #
    #  Metrics
    # ------------------------------------------------------------------ #
    sx.metric("n_samples", int(len(alpha)))
    sx.metric("n_taxa", int(prepared.relative.shape[1]))
    sx.metric("index", metric)
    sx.metric(f"median_{metric}", finite(alpha[metric].median()))
    sx.metric("median_richness", finite(alpha["richness"].median()))
    sx.metric("median_shannon", finite(alpha["shannon"].median()))
    kw = tests_table[(tests_table["test"] == "kruskal-wallis") & (tests_table["index"] == metric)] if not tests_table.empty else pd.DataFrame()
    sx.metric("kruskal_p_group", finite(kw["p_value"].iloc[0]) if len(kw) else None)
    sx.metric("n_groups", len(group_order))
    sx.finish()


if __name__ == "__main__":
    main()
