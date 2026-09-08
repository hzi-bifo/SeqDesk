#!/usr/bin/env python3
"""Community signatures: recurring taxon combinations by non-negative matrix factorisation.

The samples-by-taxa relative-abundance matrix is factorised into a small number
of non-negative signatures (taxon loadings) and per-sample signature shares,
the way mutational signatures are extracted in cancer genomics. Signatures
summarise a cohort's community types without a hard clustering: every sample
is a mixture.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.colors import qualitative
from sklearn.decomposition import NMF

import seqdesk_explore as sx
from seqdesk_explore.profiles import emit_notes, marked_label, prepare_profile

TRANSFORMS = ("sqrt", "log", "none")


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def stop(message: str, n_samples: int, n_taxa: int) -> None:
    sx.note(message)
    sx.metric("n_signatures", 0)
    sx.metric("n_samples", n_samples)
    sx.metric("n_taxa", n_taxa)
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
    k_requested = int(clamp(int(sx.param("n_signatures", 5) or 5), 2, 20))
    top_taxa = int(clamp(int(sx.param("top_taxa", 12) or 12), 3, 40))
    min_prevalence = clamp(float(sx.param("min_prevalence_pct", 5) or 0), 0.0, 100.0)
    transform = str(sx.param("transform", "sqrt") or "sqrt")
    if transform not in TRANSFORMS:
        sx.note(f'Unknown transform "{transform}"; using sqrt.')
        transform = "sqrt"
    seed = int(sx.param("seed", 0) or 0)

    relative = prepared.relative
    prevalence = 100.0 * (relative > 0).mean(axis=0) if len(relative) else pd.Series(dtype=float)
    taxa = prevalence[prevalence >= min_prevalence].index.tolist()
    n_samples = int(len(relative))
    if n_samples < 3 or len(taxa) < 3:
        stop("At least three samples and three taxa are needed to extract signatures.", n_samples, len(taxa))
        return
    dropped = int(relative.shape[1] - len(taxa))
    if dropped:
        sx.note(f"Left out {dropped} taxa below {min_prevalence:g} % prevalence; {len(taxa)} taxa enter the factorisation.")

    values = relative[taxa].to_numpy(dtype=float) / 100.0
    if transform == "sqrt":
        values = np.sqrt(values)
    elif transform == "log":
        values = np.log1p(values * 100.0)
    k = min(k_requested, n_samples - 1, len(taxa) - 1)
    if k < k_requested:
        sx.note(f"Reduced the number of signatures from {k_requested} to {k} for {n_samples} samples and {len(taxa)} taxa.")
    if k < 2:
        stop("Too few samples or taxa for two signatures.", n_samples, len(taxa))
        return

    # ------------------------------------------------------------------ #
    #  Factorise: X ~ W H; loadings per signature sum to 1, shares per sample sum to 1
    # ------------------------------------------------------------------ #
    model = NMF(n_components=k, init="nndsvda", max_iter=800, random_state=seed, tol=1e-5)
    weights = model.fit_transform(values)
    components = model.components_
    scale = components.sum(axis=1)
    scale[scale == 0] = 1.0
    loadings = components / scale[:, None]
    contributions = weights * scale[None, :]
    totals = contributions.sum(axis=1)
    shares = np.divide(contributions, totals[:, None], out=np.full_like(contributions, np.nan), where=totals[:, None] > 0)
    order = np.argsort(-np.nanmean(shares, axis=0), kind="stable")
    loadings = loadings[order]
    shares = shares[:, order]
    names = [f"S{index + 1}" for index in range(k)]
    labels = []
    for index in range(k):
        top = np.argsort(-loadings[index], kind="stable")[:2]
        labels.append(f"{names[index]}: " + " / ".join(taxa[t] for t in top))

    # ------------------------------------------------------------------ #
    #  Tables
    # ------------------------------------------------------------------ #
    rows = []
    for index in range(k):
        top = np.argsort(-loadings[index], kind="stable")[:top_taxa]
        for rank, t in enumerate(top, start=1):
            rows.append({"signature": names[index], "signature_label": labels[index], "taxon": taxa[t], "loading": finite(loadings[index, t]), "rank": rank, "curated_role": sx.curated_role(taxa[t])})
    signature_table = pd.DataFrame(rows)
    sx.save_table(
        signature_table,
        "signature_taxa",
        title="Taxa behind each signature",
        description=f"The {top_taxa} highest-loading taxa of each of the {k} signatures; loadings of a signature sum to 1 over all taxa.",
        roles={"taxon": "taxon", "value": "loading"},
    )

    sample_table = pd.DataFrame(index=relative.index)
    for column in prepared.meta_cols:
        sample_table[column] = prepared.meta[column]
    for index in range(k):
        sample_table[f"{names[index]}_share"] = shares[:, index]
    has_share = ~np.isnan(shares).all(axis=1)
    dominant = np.where(has_share, np.nanargmax(np.nan_to_num(shares, nan=-1.0), axis=1), -1)
    sample_table["dominant_signature"] = [names[d] if d >= 0 else None for d in dominant]
    sample_table["dominant_share"] = [finite(shares[i, d]) if d >= 0 else None for i, d in enumerate(dominant)]
    sample_table.index.name = prepared.sample_col
    sample_table = sample_table.reset_index()
    sample_roles = {"sample": prepared.sample_col, "value": "dominant_share"}
    for role, column in (("group", prepared.group_col), ("subject", prepared.subject_col), ("timepoint", prepared.time_col)):
        if column:
            sample_roles[role] = column
    sx.save_table(
        sample_table,
        "sample_signatures",
        title="Signature shares per sample",
        description="One row per sample: the share of each signature (summing to 1), the dominant signature and its share, plus group, subject and timepoint.",
        roles=sample_roles,
    )

    # ------------------------------------------------------------------ #
    #  Figures
    # ------------------------------------------------------------------ #
    union = list(dict.fromkeys(taxa[t] for index in range(k) for t in np.argsort(-loadings[index], kind="stable")[:top_taxa]))
    column_of = {taxon: position for position, taxon in enumerate(taxa)}
    z = [[float(loadings[index, column_of[taxon]]) for index in range(k)] for taxon in union]
    fig = go.Figure(
        go.Heatmap(
            z=z,
            x=names,
            y=[marked_label(taxon) for taxon in union],
            colorscale="Blues",
            colorbar=dict(title="loading", thickness=12),
            hovertemplate="%{y}<br>%{x}: %{z:.3f}<extra></extra>",
        )
    )
    fig.update_layout(
        title=f"Taxon loadings of {k} signatures ({transform} transform, {n_samples} samples)",
        yaxis=dict(autorange="reversed", tickfont=dict(size=9)),
        margin=dict(l=240, r=20, t=60, b=40),
        height=max(420, 16 * len(union) + 180),
    )
    sx.save_figure(fig, "signature_taxa_heatmap", title="Taxa per signature", description="Loading of the top taxa in each signature; " + "; ".join(labels) + ". Markers show curation lists.")

    colors = list(qualitative.Set2) + list(qualitative.Dark24)
    fig2 = go.Figure()
    if prepared.group_col:
        groups = prepared.meta[prepared.group_col].astype(object).map(lambda value: "(none)" if value is None else str(value))
        group_order = groups.value_counts().index.tolist()
        x_labels = [f"{group} (n={int((groups == group).sum())})" for group in group_order]
        for index in range(k):
            means = [finite(np.nanmean(shares[(groups == group).to_numpy(), index])) for group in group_order]
            fig2.add_trace(go.Bar(x=x_labels, y=means, name=labels[index], marker_color=colors[index % len(colors)], hovertemplate="%{x}<br>%{fullData.name}: %{y:.2f}<extra></extra>"))
        fig2.update_layout(xaxis_title=prepared.group_col)
    else:
        for index in range(k):
            fig2.add_trace(go.Bar(x=[f"all samples (n={n_samples})"], y=[finite(np.nanmean(shares[:, index]))], name=labels[index], marker_color=colors[index % len(colors)]))
    fig2.update_layout(
        title="Mean signature share per group",
        barmode="stack",
        yaxis=dict(title="Mean share", range=[0, 1.02]),
        legend=dict(orientation="h", y=-0.3, font=dict(size=10)),
        margin=dict(l=60, r=20, t=60, b=140),
        height=480,
    )
    sx.save_figure(fig2, "signatures_by_group", title="Signatures per group", description="Mean share of each signature in the samples of every group; shares of a sample sum to 1.")

    # ------------------------------------------------------------------ #
    #  Metrics
    # ------------------------------------------------------------------ #
    dominant_shares = np.array([value for value in sample_table["dominant_share"] if value is not None], dtype=float)
    sx.metric("n_signatures", k)
    sx.metric("n_signatures_requested", k_requested)
    sx.metric("n_samples", n_samples)
    sx.metric("n_taxa", len(taxa))
    sx.metric("transform", transform)
    sx.metric("reconstruction_error", finite(model.reconstruction_err_))
    sx.metric("n_iterations", int(model.n_iter_))
    sx.metric("median_dominant_share", finite(np.median(dominant_shares)) if dominant_shares.size else None)
    sx.metric("signatures", "; ".join(labels))
    sx.finish()


if __name__ == "__main__":
    main()
