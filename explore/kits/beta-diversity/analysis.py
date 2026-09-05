#!/usr/bin/env python3
"""Beta diversity: sample distances, PCoA and PERMANOVA from a long profile table."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.colors import qualitative
from scipy.spatial.distance import pdist, squareform

import seqdesk_explore as sx
from seqdesk_explore.profiles import emit_notes, prepare_profile


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def pcoa(distance: np.ndarray, axes: int = 3) -> tuple[np.ndarray, np.ndarray]:
    """Principal coordinates: eigendecomposition of the double-centred squared distances.

    Returns the coordinates on the first `axes` positive axes and the variance
    share (percent) of every positive axis.
    """
    n = distance.shape[0]
    centre = np.eye(n) - np.ones((n, n)) / n
    b = -0.5 * centre @ (distance**2) @ centre
    values, vectors = np.linalg.eigh(b)
    order = np.argsort(values)[::-1]
    values, vectors = values[order], vectors[:, order]
    positive = values > 1e-10 * max(abs(values[0]), 1.0)
    values_pos, vectors_pos = values[positive], vectors[:, positive]
    coordinates = vectors_pos[:, :axes] * np.sqrt(values_pos[:axes])
    share = 100.0 * values_pos / values_pos.sum() if values_pos.sum() > 0 else np.zeros_like(values_pos)
    return coordinates, share


def permanova(distance: np.ndarray, labels: np.ndarray, permutations: int, seed: int = 0) -> dict | None:
    """PERMANOVA (Anderson 2001): pseudo-F, R2 and a permutation p-value."""
    groups, codes = np.unique(labels, return_inverse=True)
    n, a = distance.shape[0], len(groups)
    if a < 2 or n - a < 1:
        return None
    d2 = distance**2
    ss_total = d2.sum() / (2.0 * n)
    counts = np.bincount(codes, minlength=a)
    multi = counts > 1

    def within(code_rows: np.ndarray) -> np.ndarray:
        k = code_rows.shape[0]
        onehot = np.zeros((n, k * a))
        onehot[np.arange(n)[None, :], np.arange(k)[:, None] * a + code_rows] = 1.0
        blocks = np.einsum("ij,ij->j", onehot, d2 @ onehot).reshape(k, a)
        return (blocks[:, multi] / (2.0 * counts[multi])).sum(axis=1)

    sw = float(within(codes[None, :])[0])
    if sw <= 0 or ss_total <= 0:
        return None
    pseudo_f = (ss_total - sw) / (a - 1) / (sw / (n - a))
    r2 = (ss_total - sw) / ss_total
    p = None
    if permutations > 0:
        rng = np.random.RandomState(seed)
        perms = np.stack([rng.permutation(codes) for _ in range(permutations)])
        swp = np.concatenate([within(perms[start : start + 128]) for start in range(0, permutations, 128)])
        f_perm = np.zeros(permutations)
        positive = swp > 0
        f_perm[positive] = (ss_total - swp[positive]) / (a - 1) / (swp[positive] / (n - a))
        p = (1 + int((f_perm >= pseudo_f).sum())) / (permutations + 1)
    return {"n_samples": int(n), "n_levels": int(a), "pseudo_F": finite(pseudo_f), "R2": finite(r2), "p_value": finite(p) if p is not None else None, "permutations": int(permutations)}


def main() -> None:
    df = sx.load_dataset("profiles")
    metric = str(sx.param("metric", "bray-curtis") or "bray-curtis")
    if metric not in ("bray-curtis", "jaccard"):
        sx.note(f'Unknown distance "{metric}"; using bray-curtis.')
        metric = "bray-curtis"
    permutations = int(max(0, min(int(sx.param("permutations", 999) or 0), 9999)))
    prepared = prepare_profile(
        df,
        rank=str(sx.param("rank", "species") or ""),
        min_reads=float(sx.param("min_reads", 0) or 0),
        remove_artifacts=bool(sx.param("remove_artifacts", True)),
    )
    emit_notes(prepared)
    relative = prepared.relative
    if len(relative) < 3:
        sx.note("Fewer than three samples left after filtering; no ordination was computed.")
        sx.metric("n_samples", int(len(relative)))
        sx.finish()
        return

    matrix = relative.to_numpy(dtype=float) / 100.0
    if metric == "jaccard":
        condensed = pdist(matrix > 0, metric="jaccard")
    else:
        condensed = pdist(matrix, metric="braycurtis")
    condensed = np.nan_to_num(condensed, nan=0.0)
    distance = squareform(condensed)
    coordinates, share = pcoa(distance)
    axes = coordinates.shape[1]

    meta = prepared.meta
    group_col, subject_col, time_col = prepared.group_col, prepared.subject_col, prepared.time_col
    groups = meta[group_col].astype(object).where(meta[group_col].notna(), "(none)").astype(str) if group_col else None
    group_order = groups.value_counts().index.tolist() if groups is not None else []

    # ------------------------------------------------------------------ #
    #  Coordinates table
    # ------------------------------------------------------------------ #
    table = pd.DataFrame(index=relative.index)
    for column in prepared.meta_cols:
        table[column] = meta[column]
    for axis in range(axes):
        table[f"PC{axis + 1}"] = coordinates[:, axis]
    table["reads"] = prepared.counts.sum(axis=1)
    table = table.reset_index().rename(columns={"index": prepared.sample_col})
    roles = {"sample": prepared.sample_col}
    for role, column in (("group", group_col), ("subject", subject_col), ("timepoint", time_col)):
        if column:
            roles[role] = column
    sx.save_table(table, "pcoa_coordinates", title="PCoA coordinates", description=f"Principal coordinates of the {metric} distances between samples.", roles=roles)

    # ------------------------------------------------------------------ #
    #  PERMANOVA per factor
    # ------------------------------------------------------------------ #
    rows = []
    for factor, series in ((group_col, groups), (subject_col, meta[subject_col].astype(str) if subject_col else None)):
        if factor is None or series is None:
            continue
        result = permanova(distance, series.to_numpy(), permutations)
        if result is None:
            sx.note(f"PERMANOVA for {factor} was skipped: it needs at least two levels and more samples than levels.")
            continue
        rows.append({"factor": factor, **result})
    permanova_table = pd.DataFrame(rows, columns=["factor", "n_samples", "n_levels", "pseudo_F", "R2", "p_value", "permutations"])
    sx.save_table(permanova_table, "permanova", title="PERMANOVA", description="Does the factor explain the distances between samples? Pseudo-F, R2 and a permutation p-value per factor.")
    group_test = permanova_table[permanova_table["factor"] == group_col] if group_col and not permanova_table.empty else pd.DataFrame()

    # ------------------------------------------------------------------ #
    #  Ordination figure
    # ------------------------------------------------------------------ #
    palette = list(qualitative.Set2) + list(qualitative.Dark24)
    fig = go.Figure()
    labels = relative.index.astype(str)
    hover = labels
    if subject_col:
        hover = [f"{sample}<br>{subject_col}: {subject}" for sample, subject in zip(labels, meta[subject_col].astype(str))]
    if time_col:
        hover = [f"{text}<br>{time_col}: {time}" for text, time in zip(hover, meta[time_col].astype(object).where(meta[time_col].notna(), "").astype(str))]
    x = coordinates[:, 0]
    y = coordinates[:, 1] if axes > 1 else np.zeros(len(x))
    if groups is not None:
        for index, name in enumerate(group_order):
            mask = (groups == name).to_numpy()
            fig.add_trace(go.Scatter(x=x[mask], y=y[mask], mode="markers", name=name, marker=dict(size=8, color=palette[index % len(palette)], opacity=0.8, line=dict(width=0.5, color="#333")), text=[hover[i] for i in np.flatnonzero(mask)], hovertemplate="%{text}<extra>" + name + "</extra>"))
    else:
        fig.add_trace(go.Scatter(x=x, y=y, mode="markers", name="samples", marker=dict(size=8, color="#4C72B0", opacity=0.8), text=list(hover), hovertemplate="%{text}<extra></extra>"))
    subtitle = f"{metric} distance"
    if len(group_test) and group_test["p_value"].iloc[0] is not None and not pd.isna(group_test["p_value"].iloc[0]):
        subtitle += f"; PERMANOVA by {group_col}: R2 = {group_test['R2'].iloc[0]:.3f}, p = {group_test['p_value'].iloc[0]:.3g}"
    fig.update_layout(
        title=f"PCoA ({subtitle})",
        xaxis_title=f"PC1 ({share[0]:.1f} %)" if len(share) else "PC1",
        yaxis_title=f"PC2 ({share[1]:.1f} %)" if len(share) > 1 else "PC2",
        legend_title_text=group_col or "",
        margin=dict(l=60, r=20, t=60, b=60),
        height=520,
    )
    fig.update_yaxes(scaleanchor="x", scaleratio=1)
    sx.save_figure(fig, "pcoa", title="Sample ordination (PCoA)", description=f"Principal coordinates of {metric} distances; each point is a sample, coloured by {group_col or 'nothing'}.")

    # ------------------------------------------------------------------ #
    #  Metrics
    # ------------------------------------------------------------------ #
    sx.metric("n_samples", int(len(relative)))
    sx.metric("n_taxa", int(relative.shape[1]))
    sx.metric("metric", metric)
    sx.metric("pc1_variance_pct", finite(share[0]) if len(share) else None)
    sx.metric("pc2_variance_pct", finite(share[1]) if len(share) > 1 else None)
    sx.metric("permanova_group_p", finite(group_test["p_value"].iloc[0]) if len(group_test) else None)
    sx.metric("permanova_group_R2", finite(group_test["R2"].iloc[0]) if len(group_test) else None)
    sx.finish()


if __name__ == "__main__":
    main()
