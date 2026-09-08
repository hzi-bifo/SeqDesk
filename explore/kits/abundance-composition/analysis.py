#!/usr/bin/env python3
"""Percentage profiles are not read counts; preserve their original scale."""
from __future__ import annotations

import math
import pandas as pd
import plotly.graph_objects as go
import seqdesk_explore as sx


def main() -> None:
    frame = sx.load_dataset("profiles")
    sample = sx.role_column(frame, "sample")
    taxon = sx.role_column(frame, "taxon")
    value = sx.role_column(frame, "value")
    rank = sx.role_column(frame, "rank")
    group = sx.role_column(frame, "group", required=False)
    taxon_id = sx.role_column(frame, "taxon_id", required=False)
    requested_rank = str(sx.param("rank", "species")).strip().casefold()
    top_n = max(1, min(60, int(sx.param("top_n", 15))))
    work = frame[frame[rank].astype(str).str.strip().str.casefold() == requested_rank].copy()
    if work.empty:
        raise ValueError(f"No rows of rank '{requested_rank}'. Choose a rank present in the profile.")
    if work[[sample, taxon]].isna().any().any():
        raise ValueError("Every percentage row needs a sample and taxon.")
    work[value] = pd.to_numeric(work[value], errors="coerce").astype(float)
    valid = work[value].map(math.isfinite) & work[value].between(0, 100)
    if not valid.all():
        raise ValueError("Relative abundances must be finite percentages between 0 and 100.")
    identity = taxon_id or taxon
    if work.duplicated([sample, identity]).any():
        raise ValueError("Duplicate sample/taxon rows: select one profiling result per sample.")
    totals = work.groupby(sample)[value].sum()
    if (totals > 100.01).any():
        raise ValueError("Taxon percentages exceed 100 per sample. Do not mix ranks or profiling runs.")
    samples = sorted(work[sample].unique(), key=str)
    top_taxa = work.groupby(taxon)[value].sum().nlargest(top_n).index.tolist()
    matrix = work.pivot_table(index=sample, columns=taxon, values=value, aggfunc="sum", fill_value=0)
    matrix = matrix.reindex(index=samples, columns=top_taxa, fill_value=0)
    labels = [str(entry) for entry in samples]
    if "sample_id" in work.columns:
        names = work.groupby(sample)["sample_id"].first()
        labels = [str(names.get(entry) or entry) for entry in samples]
        if len(set(labels)) != len(labels):
            labels = [f"{label} ({entry})" for label, entry in zip(labels, samples)]
    if group:
        groups = work.groupby(sample)[group].first()
        labels = [f"{label} · {groups.get(entry)}" if pd.notna(groups.get(entry)) else label
                  for label, entry in zip(labels, samples)]
    figure = go.Figure()
    for entry in top_taxa:
        figure.add_bar(name=str(entry).split("|")[-1], x=labels, y=matrix[entry].tolist())
    remainder = (100 - matrix.sum(axis=1)).clip(lower=0)
    figure.add_bar(name="Other / unreported", x=labels, y=remainder.tolist(), marker_color="#b8b8b8")
    figure.update_layout(
        barmode="stack", yaxis_title="Relative abundance (%)", yaxis_range=[0, 100],
        title=f"Taxonomic composition · {requested_rank}", height=520,
    )
    figure.update_xaxes(type="category")
    roles = {"sample": sample, "taxon": taxon, "value": value, "rank": rank}
    if group:
        roles["group"] = group
    if taxon_id:
        roles["taxon_id"] = taxon_id
    sx.save_table(work, "composition", title="Relative abundance composition",
                  table_kind="taxon-abundance-long", roles=roles,
                  description="Source percentages at one rank. Not read counts; not renormalised.")
    sx.save_figure(figure, "composition_plot", title="Relative abundance composition")
    sx.note("Uses source percentages, not read counts. Other / unreported includes omitted taxa and any unreported abundance; it is not an identification of that remainder.")
    sx.note(f"Kept rank {requested_rank}; discarded {len(frame) - len(work)} rows of other ranks.")
    sx.metric("n_samples", len(samples))
    sx.metric("n_taxa", int(work[taxon].nunique()))
    sx.metric("n_rows", len(work))
    sx.finish()


if __name__ == "__main__":
    main()
