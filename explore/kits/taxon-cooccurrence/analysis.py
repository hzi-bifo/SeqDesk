#!/usr/bin/env python3
"""Taxon co-occurrence: which taxa are found together and which exclude each other.

For the most prevalent taxa of a long profile table every pair is scored on
presence across samples: the phi coefficient (the correlation of two binary
variables), the lift (observed over expected co-occurrence) and Fisher's exact
test, with Benjamini-Hochberg control over all pairs. The heatmap orders taxa by
hierarchical clustering of 1 - phi so blocks of taxa that travel together show.
"""
from __future__ import annotations

import math
from itertools import combinations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from scipy import stats
from scipy.cluster.hierarchy import leaves_list, linkage
from scipy.spatial.distance import squareform

import seqdesk_explore as sx
from seqdesk_explore.profiles import bh_fdr, emit_notes, marked_label, prepare_profile

POSITIVE = "#4C72B0"
NEGATIVE = "#C44E52"


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def stop(n_samples: int, n_taxa: int, message: str) -> None:
    sx.note(message)
    sx.metric("n_samples", n_samples)
    sx.metric("n_taxa_tested", n_taxa)
    sx.metric("n_pairs", 0)
    sx.metric("n_significant", 0)
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
    top_n = int(clamp(int(sx.param("top_n", 30) or 30), 2, 80))
    min_prevalence = clamp(float(sx.param("min_prevalence_pct", 10) or 0), 0.0, 100.0)
    q_threshold = clamp(float(sx.param("q_threshold", 0.05) or 0.05), 1e-4, 1.0)
    group_value = str(sx.param("group", "") or "").strip()

    relative = prepared.relative
    if group_value:
        if prepared.group_col:
            labels = prepared.meta[prepared.group_col].astype(object).map(lambda value: "" if value is None else str(value))
            keep = labels.index[labels == group_value]
            if len(keep) == 0:
                sx.note(f'No sample has {prepared.group_col} = "{group_value}" (present: {", ".join(sorted(set(labels)))}); every sample was used.')
            else:
                relative = relative.loc[keep]
                sx.note(f'Restricted to the {len(keep)} samples with {prepared.group_col} = "{group_value}".')
        else:
            sx.note("The group parameter is set but the table maps no group role; every sample was used.")
    presence = relative > 0
    n_samples = int(len(presence))
    if n_samples < 4:
        stop(n_samples, 0, "At least four samples are needed to score co-occurrence.")
        return

    prevalence = 100.0 * presence.mean(axis=0)
    counts = presence.sum(axis=0)
    eligible = prevalence[(prevalence >= min_prevalence) & (counts > 0) & (counts < n_samples)].sort_values(ascending=False, kind="stable")
    taxa = eligible.index[:top_n].tolist()
    n_always = int((counts == n_samples).sum())
    if n_always:
        sx.note(f"{n_always} taxa present in every sample carry no co-occurrence signal and were left out.")
    if len(taxa) < 2:
        stop(n_samples, len(taxa), "Fewer than two taxa pass the prevalence threshold; nothing to compare.")
        return

    # ------------------------------------------------------------------ #
    #  Pairs: 2x2 presence tables, phi, lift, Fisher
    # ------------------------------------------------------------------ #
    matrix = presence[taxa].to_numpy(dtype=bool)
    rows = []
    for i, j in combinations(range(len(taxa)), 2):
        both = int(np.sum(matrix[:, i] & matrix[:, j]))
        a_only = int(np.sum(matrix[:, i] & ~matrix[:, j]))
        b_only = int(np.sum(~matrix[:, i] & matrix[:, j]))
        neither = n_samples - both - a_only - b_only
        denominator = math.sqrt((both + a_only) * (b_only + neither) * (both + b_only) * (a_only + neither))
        phi = (both * neither - a_only * b_only) / denominator if denominator > 0 else float("nan")
        expected = (both + a_only) * (both + b_only) / n_samples
        _, p_value = stats.fisher_exact([[both, a_only], [b_only, neither]])
        rows.append(
            {
                "taxon_a": taxa[i],
                "taxon_b": taxa[j],
                "n_both": both,
                "n_a_only": a_only,
                "n_b_only": b_only,
                "n_neither": neither,
                "prevalence_a_pct": finite(prevalence[taxa[i]]),
                "prevalence_b_pct": finite(prevalence[taxa[j]]),
                "phi": finite(phi),
                "lift": finite(both / expected) if expected > 0 else None,
                "p_value": finite(p_value),
            }
        )
    table = pd.DataFrame(rows)
    table["phi"] = pd.to_numeric(table["phi"])
    table["q_value"] = bh_fdr(table["p_value"].to_numpy(dtype=float))
    table["significant"] = table["q_value"] < q_threshold
    signs = table["phi"].fillna(0.0)
    table["relation"] = np.where(signs > 0, "co-occur", np.where(signs < 0, "exclude", "independent"))
    table["curated_role_a"] = table["taxon_a"].map(sx.curated_role)
    table["curated_role_b"] = table["taxon_b"].map(sx.curated_role)
    table = table.sort_values(["q_value", "p_value"], kind="stable", na_position="last").reset_index(drop=True)
    sx.save_table(
        table,
        "cooccurrence_pairs",
        title="Co-occurrence of taxon pairs",
        description=f"Every pair of the {len(taxa)} compared taxa: how many samples hold both, one or neither, phi, lift (observed over expected co-occurrence), Fisher's exact p and BH q, and the curation lists.",
        roles={"value": "phi"},
    )

    # ------------------------------------------------------------------ #
    #  Heatmap, taxa clustered by 1 - phi
    # ------------------------------------------------------------------ #
    phi_values = np.full((len(taxa), len(taxa)), np.nan)
    np.fill_diagonal(phi_values, 1.0)
    phi_matrix = pd.DataFrame(phi_values, index=taxa, columns=taxa)
    for taxon_a, taxon_b, phi in zip(table["taxon_a"], table["taxon_b"], table["phi"]):
        phi_matrix.at[taxon_a, taxon_b] = phi
        phi_matrix.at[taxon_b, taxon_a] = phi
    if len(taxa) >= 3:
        distance = 1.0 - phi_matrix.fillna(0.0).to_numpy()
        distance = (distance + distance.T) / 2.0
        np.fill_diagonal(distance, 0.0)
        order = leaves_list(linkage(squareform(distance, checks=False), method="average"))
        ordered = [taxa[index] for index in order]
    else:
        ordered = list(taxa)
    labels = [marked_label(taxon) for taxon in ordered]
    fig = go.Figure(
        go.Heatmap(
            z=phi_matrix.loc[ordered, ordered].to_numpy(),
            x=labels,
            y=labels,
            zmin=-1,
            zmax=1,
            zmid=0,
            colorscale="RdBu",
            colorbar=dict(title="phi", thickness=12),
            hovertemplate="%{y}<br>%{x}<br>phi %{z:.2f}<extra></extra>",
        )
    )
    fig.update_layout(
        title=f"Co-occurrence of the {len(ordered)} most prevalent taxa (phi over {n_samples} samples)",
        xaxis=dict(tickangle=-60, tickfont=dict(size=9)),
        yaxis=dict(autorange="reversed", tickfont=dict(size=9)),
        margin=dict(l=200, r=20, t=60, b=200),
        height=max(480, 18 * len(ordered) + 300),
    )
    sx.save_figure(
        fig,
        "cooccurrence_heatmap",
        title="Co-occurrence heatmap",
        description="Phi coefficient for every pair of the compared taxa; blue pairs are found together, red pairs exclude each other. Taxa are ordered by average-linkage clustering of 1 - phi; markers show curation lists.",
    )

    # ------------------------------------------------------------------ #
    #  Strongest pairs
    # ------------------------------------------------------------------ #
    shown = table[table["significant"]].head(20)
    if shown.empty:
        shown = table.head(20)
        subtitle = "the 20 pairs with the smallest p; none reaches significance"
    else:
        subtitle = f"{len(shown)} pairs with q below {q_threshold:g}"
    shown = shown.iloc[::-1]
    fig2 = go.Figure(
        go.Bar(
            x=shown["phi"].fillna(0.0),
            y=[f"{a} & {b}" for a, b in zip(shown["taxon_a"], shown["taxon_b"])],
            orientation="h",
            marker_color=[POSITIVE if value > 0 else NEGATIVE for value in shown["phi"].fillna(0.0)],
            customdata=shown[["n_both", "q_value"]].to_numpy(),
            hovertemplate="%{y}<br>phi %{x:.2f}<br>together in %{customdata[0]} samples<br>q %{customdata[1]:.3g}<extra></extra>",
        )
    )
    fig2.update_layout(
        title=f"Strongest pairs ({subtitle})",
        xaxis_title="phi (negative: exclude each other, positive: found together)",
        margin=dict(l=340, r=20, t=60, b=50),
        height=max(320, 22 * len(shown) + 140),
    )
    fig2.add_vline(x=0, line_color="#999", line_width=1)
    sx.save_figure(fig2, "strongest_pairs", title="Strongest pairs", description="Phi of the pairs with the smallest q: blue bars are taxa found together, red bars taxa that exclude each other.")

    # ------------------------------------------------------------------ #
    #  Metrics
    # ------------------------------------------------------------------ #
    significant = table[table["significant"]]
    sx.metric("n_samples", n_samples)
    sx.metric("n_taxa_tested", len(taxa))
    sx.metric("n_pairs", int(len(table)))
    sx.metric("n_significant", int(len(significant)))
    sx.metric("n_cooccur_significant", int((significant["relation"] == "co-occur").sum()))
    sx.metric("n_exclude_significant", int((significant["relation"] == "exclude").sum()))
    sx.metric("strongest_pair", f"{table.at[0, 'taxon_a']} & {table.at[0, 'taxon_b']}" if len(table) else None)
    sx.metric("min_prevalence_pct", min_prevalence)
    sx.metric("group", group_value or None)
    sx.finish()


if __name__ == "__main__":
    main()
