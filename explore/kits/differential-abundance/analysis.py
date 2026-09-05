#!/usr/bin/env python3
"""Differential abundance between two groups: Mann-Whitney U per taxon with BH control."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from scipy import stats

import seqdesk_explore as sx
from seqdesk_explore.profiles import bh_fdr, emit_notes, prepare_profile

PSEUDO_COUNT_PCT = 0.001


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def main() -> None:
    df = sx.load_dataset("profiles")
    prepared = prepare_profile(df, rank=str(sx.param("rank", "species") or ""), remove_artifacts=bool(sx.param("remove_artifacts", True)))
    emit_notes(prepared)
    group_col = prepared.group_col
    if not group_col:
        sx.note("The table maps no group role; two groups are needed to compare.")
        sx.metric("n_taxa_tested", 0)
        sx.finish()
        return
    groups = prepared.meta[group_col].astype(object).where(prepared.meta[group_col].notna(), "(none)").astype(str)
    order = groups.value_counts().index.tolist()
    group_a = str(sx.param("group_a", "") or "").strip() or (order[0] if order else "")
    group_b = str(sx.param("group_b", "") or "").strip() or (order[1] if len(order) > 1 else "")
    if group_a not in order or group_b not in order or group_a == group_b:
        sx.note(f'Groups "{group_a}" and "{group_b}" are not two distinct values of {group_col} (present: {", ".join(order)}).')
        sx.metric("n_taxa_tested", 0)
        sx.finish()
        return
    min_prevalence = max(0.0, min(float(sx.param("min_prevalence_pct", 10) or 0), 100.0))
    q_threshold = max(1e-4, min(float(sx.param("q_threshold", 0.05) or 0.05), 1.0))

    relative = prepared.relative
    a_idx = groups.index[groups == group_a]
    b_idx = groups.index[groups == group_b]
    ra_a = relative.loc[a_idx]
    ra_b = relative.loc[b_idx]
    prevalence_a = 100.0 * (ra_a > 0).mean(axis=0)
    prevalence_b = 100.0 * (ra_b > 0).mean(axis=0)
    tested = relative.columns[(prevalence_a >= min_prevalence) | (prevalence_b >= min_prevalence)]
    if len(a_idx) < 2 or len(b_idx) < 2:
        sx.note(f"Each group needs at least two samples ({group_a}: {len(a_idx)}, {group_b}: {len(b_idx)}).")
        tested = relative.columns[:0]

    rows = []
    for taxon in tested:
        x = ra_a[taxon].to_numpy(dtype=float)
        y = ra_b[taxon].to_numpy(dtype=float)
        statistic, p = (np.nan, np.nan)
        if np.ptp(np.concatenate([x, y])) > 0:
            statistic, p = stats.mannwhitneyu(x, y, alternative="two-sided")
        mean_a, mean_b = float(x.mean()), float(y.mean())
        rows.append(
            {
                prepared.taxon_col: taxon,
                f"prevalence_{group_a}_pct": finite(prevalence_a[taxon]),
                f"prevalence_{group_b}_pct": finite(prevalence_b[taxon]),
                f"mean_ra_{group_a}_pct": finite(mean_a),
                f"mean_ra_{group_b}_pct": finite(mean_b),
                "log2_fold_change": finite(math.log2((mean_a + PSEUDO_COUNT_PCT) / (mean_b + PSEUDO_COUNT_PCT))),
                "mwu_statistic": finite(statistic),
                "p_value": finite(p),
            }
        )
    table = pd.DataFrame(rows)
    if table.empty:
        sx.note("No taxon met the prevalence threshold in either group.")
        table = pd.DataFrame(columns=[prepared.taxon_col, "log2_fold_change", "p_value", "q_value", "significant", "higher_in"])
    else:
        table["q_value"] = bh_fdr(table["p_value"].to_numpy(dtype=float))
        table["significant"] = table["q_value"] < q_threshold
        table["higher_in"] = np.where(table["log2_fold_change"] > 0, group_a, np.where(table["log2_fold_change"] < 0, group_b, "neither"))
        if prepared.taxon_id_col:
            ids = prepared.long.drop_duplicates(prepared.taxon_col).set_index(prepared.taxon_col)[prepared.taxon_id_col]
            table.insert(1, prepared.taxon_id_col, table[prepared.taxon_col].map(ids))
        table = table.sort_values(["q_value", "p_value"], kind="stable", na_position="last").reset_index(drop=True)
    roles = {"taxon": prepared.taxon_col, "value": "log2_fold_change"}
    if prepared.taxon_id_col and prepared.taxon_id_col in table.columns:
        roles["taxon_id"] = prepared.taxon_id_col
    sx.save_table(table, "differential_abundance", title=f"Differential abundance: {group_a} versus {group_b}", description=f"Per taxon: prevalence and mean relative abundance in {group_a} and {group_b}, log2 fold change (A over B), Mann-Whitney U, p and BH q.", roles=roles)

    # ------------------------------------------------------------------ #
    #  Volcano
    # ------------------------------------------------------------------ #
    fig = go.Figure()
    if not table.empty and table["p_value"].notna().any():
        plotted = table[table["p_value"].notna()].copy()
        plotted["neg_log10_p"] = -np.log10(plotted["p_value"].clip(lower=1e-300))
        for flag, colour, name in ((False, "#B0B7C3", "not significant"), (True, "#C44E52", f"q < {q_threshold:g}")):
            part = plotted[plotted["significant"] == flag]
            if part.empty:
                continue
            fig.add_trace(
                go.Scatter(
                    x=part["log2_fold_change"],
                    y=part["neg_log10_p"],
                    mode="markers",
                    name=name,
                    marker=dict(size=7, color=colour, opacity=0.85),
                    text=part[prepared.taxon_col],
                    customdata=part[["q_value"]].to_numpy(),
                    hovertemplate="%{text}<br>log2 FC: %{x:.2f}<br>p: %{y:.2f} (-log10)<br>q: %{customdata[0]:.3g}<extra></extra>",
                )
            )
        top = plotted[plotted["significant"]].nsmallest(8, "q_value")
        for _, row in top.iterrows():
            fig.add_annotation(x=row["log2_fold_change"], y=row["neg_log10_p"], text=str(row[prepared.taxon_col]), showarrow=False, yshift=10, font=dict(size=9))
        fig.add_vline(x=0, line_color="#999", line_width=1, line_dash="dot")
    else:
        fig.add_annotation(text="Nothing to test", showarrow=False, x=0.5, y=0.5, xref="paper", yref="paper")
    fig.update_layout(
        title=f"{group_a} versus {group_b}: which taxa differ",
        xaxis_title=f"log2 fold change (higher in {group_a} to the right)",
        yaxis_title="-log10 p (Mann-Whitney U)",
        margin=dict(l=60, r=20, t=60, b=60),
        height=480,
    )
    sx.save_figure(fig, "volcano", title="Volcano plot", description=f"Every tested taxon: log2 fold change of the mean relative abundance ({group_a} over {group_b}) against -log10 p; red when q below {q_threshold:g}.")

    # ------------------------------------------------------------------ #
    #  Metrics
    # ------------------------------------------------------------------ #
    sx.metric("group_a", group_a)
    sx.metric("group_b", group_b)
    sx.metric("n_samples_a", int(len(a_idx)))
    sx.metric("n_samples_b", int(len(b_idx)))
    sx.metric("n_taxa_tested", int(len(table)) if not table.empty else 0)
    sx.metric("n_significant", int(table["significant"].sum()) if not table.empty and "significant" in table else 0)
    sx.finish()


if __name__ == "__main__":
    main()
