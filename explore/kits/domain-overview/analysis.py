#!/usr/bin/env python3
"""Domain overview: how reads split between bacteria, viruses, fungi and other domains.

A superkingdom (domain, kingdom) column of the long profile table assigns every
taxon to a domain. Per sample the share of reads and the number of taxa per
domain are summarised, compared between groups, and the most prevalent taxa of
the smaller domains are listed, so a virome or mycobiome check needs no extra
table.
"""
from __future__ import annotations

import math
import re

import pandas as pd
import plotly.graph_objects as go
from plotly.colors import qualitative

import seqdesk_explore as sx
from seqdesk_explore.profiles import emit_notes, marked_label, prepare_profile

DOMAIN_COLUMNS = ("superkingdom", "domain", "kingdom")
UNCLASSIFIED = "Unclassified"


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_") or "unclassified"


def palette(n: int) -> list[str]:
    colors = list(qualitative.Set2) + list(qualitative.D3)
    return [colors[index % len(colors)] for index in range(n)]


def main() -> None:
    df = sx.load_dataset("profiles")
    taxon_col = sx.role_column(df, "taxon")
    wanted = str(sx.param("domain_column", "auto") or "auto").strip()
    top_n = int(clamp(int(sx.param("top_n", 10) or 10), 3, 50))
    if wanted and wanted != "auto" and wanted in df.columns:
        domain_col = wanted
    else:
        if wanted and wanted != "auto":
            sx.note(f'Column "{wanted}" is not in the table; looked for a superkingdom, domain or kingdom column instead.')
        domain_col = next((column for column in df.columns if str(column).strip().lower() in DOMAIN_COLUMNS), None)
    if not domain_col:
        sx.note("The table has no superkingdom, domain or kingdom column; nothing to summarise. Name the column with the domain_column parameter.")
        sx.metric("n_domains", 0)
        sx.metric("n_samples", 0)
        sx.finish()
        return
    labelled = df[[taxon_col, domain_col]].dropna()
    labelled = labelled.assign(**{domain_col: labelled[domain_col].astype(str).str.strip()})
    labelled = labelled[labelled[domain_col] != ""]
    domain_of = labelled.groupby(taxon_col)[domain_col].agg(lambda values: values.value_counts().idxmax()).to_dict()

    prepared = prepare_profile(
        df,
        rank=str(sx.param("rank", "species") or ""),
        min_reads=float(sx.param("min_reads", 0) or 0),
        remove_artifacts=bool(sx.param("remove_artifacts", True)),
    )
    emit_notes(prepared)
    relative = prepared.relative
    if relative.empty:
        sx.note("No samples left after filtering; nothing to summarise.")
        sx.metric("n_domains", 0)
        sx.metric("n_samples", 0)
        sx.finish()
        return

    domains = pd.Series([str(domain_of.get(taxon, UNCLASSIFIED)) for taxon in relative.columns], index=relative.columns)
    n_unclassified = int((domains == UNCLASSIFIED).sum())
    if n_unclassified:
        sx.note(f"{n_unclassified} taxa have no value in {domain_col} and are counted as {UNCLASSIFIED}.")
    share = relative.T.groupby(domains).sum().T
    n_taxa_by_domain = (relative > 0).T.groupby(domains).sum().T
    order = share.mean(axis=0).sort_values(ascending=False, kind="stable").index.tolist()
    share = share[order]
    n_taxa_by_domain = n_taxa_by_domain[order]
    groups = prepared.meta[prepared.group_col].astype(object).map(lambda value: "(none)" if value is None else str(value)) if prepared.group_col else pd.Series("all", index=relative.index)
    groups = groups.reindex(relative.index)
    group_order = groups.value_counts().index.tolist()

    # ------------------------------------------------------------------ #
    #  Tables
    # ------------------------------------------------------------------ #
    per_sample = pd.DataFrame(index=relative.index)
    for column in prepared.meta_cols:
        per_sample[column] = prepared.meta[column]
    for domain in order:
        per_sample[f"{slug(domain)}_pct"] = share[domain]
        per_sample[f"{slug(domain)}_taxa"] = n_taxa_by_domain[domain].astype(int)
    per_sample["dominant_domain"] = share.idxmax(axis=1)
    per_sample.index.name = prepared.sample_col
    per_sample = per_sample.reset_index()
    sample_roles = {"sample": prepared.sample_col, "value": f"{slug(order[0])}_pct"}
    for role, column in (("group", prepared.group_col), ("subject", prepared.subject_col), ("timepoint", prepared.time_col)):
        if column:
            sample_roles[role] = column
    sx.save_table(
        per_sample,
        "domain_per_sample",
        title="Domains per sample",
        description=f"Per sample: share of reads (percent) and number of taxa for each domain of {domain_col}, and the dominant domain.",
        roles=sample_roles,
    )

    group_label = prepared.group_col or "group"
    rows = []
    for group in group_order:
        members = share.index[(groups == group).to_numpy()]
        for domain in order:
            part = share.loc[members, domain]
            rows.append(
                {
                    group_label: group,
                    "domain": domain,
                    "n_samples": int(len(part)),
                    "n_samples_present": int((part > 0).sum()),
                    "mean_pct": finite(part.mean()),
                    "median_pct": finite(part.median()),
                    "max_pct": finite(part.max()),
                    "n_taxa": int((relative.loc[members, domains.index[domains == domain]] > 0).any(axis=0).sum()),
                }
            )
    by_group = pd.DataFrame(rows)
    sx.save_table(by_group, "domain_by_group", title="Domains per group", description="Per group and domain: samples, samples where the domain has reads, mean, median and maximum share, taxa seen.", roles={"group": group_label, "value": "mean_pct"})

    prevalence = 100.0 * (relative > 0).mean(axis=0)
    mean_ra = relative.mean(axis=0)
    max_ra = relative.max(axis=0)
    rows = []
    for domain in order:
        members = domains.index[domains == domain]
        top = prevalence[members].sort_values(ascending=False, kind="stable").head(top_n)
        for rank, (taxon, value) in enumerate(top.items(), start=1):
            rows.append(
                {
                    "domain": domain,
                    "taxon": taxon,
                    "rank": rank,
                    "prevalence_pct": finite(value),
                    "mean_relative_abundance_pct": finite(mean_ra[taxon]),
                    "max_relative_abundance_pct": finite(max_ra[taxon]),
                    "curated_role": sx.curated_role(taxon),
                }
            )
    top_table = pd.DataFrame(rows)
    sx.save_table(top_table, "top_taxa_per_domain", title="Most prevalent taxa per domain", description=f"The {top_n} most prevalent taxa of every domain with prevalence, mean and maximum relative abundance and the curation lists.", roles={"taxon": "taxon", "value": "prevalence_pct"})

    # ------------------------------------------------------------------ #
    #  Figures
    # ------------------------------------------------------------------ #
    colors = palette(len(order))
    fig = go.Figure()
    x_labels = groups.map(lambda group: f"{group} (n={int((groups == group).sum())})")
    for index, domain in enumerate(order):
        fig.add_trace(go.Box(x=x_labels.tolist(), y=share[domain].tolist(), name=domain, marker_color=colors[index], boxpoints="outliers", marker_size=3))
    fig.update_layout(
        title=f"Share of reads per domain ({domain_col})",
        boxmode="group",
        yaxis=dict(title="Share of reads (%)", range=[0, 102]),
        xaxis_title=prepared.group_col or "",
        legend=dict(orientation="h", y=-0.25),
        margin=dict(l=60, r=20, t=60, b=90),
        height=460,
    )
    sx.save_figure(fig, "domain_shares", title="Reads per domain", description="Share of each sample's reads per domain as box plots, one box per domain and group.")

    minor = order[1:]
    minor_rows = top_table[top_table["domain"].isin(minor)].copy()
    fig2 = go.Figure()
    if minor_rows.empty:
        fig2.add_annotation(text=f"Only one domain ({order[0]}) has reads", showarrow=False, x=0.5, y=0.5, xref="paper", yref="paper")
        fig2.update_layout(height=240)
    else:
        minor_rows = minor_rows.sort_values(["domain", "prevalence_pct"], ascending=[True, True], kind="stable")
        for index, domain in enumerate(minor):
            part = minor_rows[minor_rows["domain"] == domain]
            if part.empty:
                continue
            fig2.add_trace(
                go.Bar(
                    x=part["prevalence_pct"],
                    y=[marked_label(taxon) for taxon in part["taxon"]],
                    orientation="h",
                    name=domain,
                    marker_color=colors[order.index(domain)],
                    customdata=part[["mean_relative_abundance_pct", "max_relative_abundance_pct"]].to_numpy(),
                    hovertemplate="%{y}<br>present in %{x:.1f} % of samples<br>mean RA %{customdata[0]:.3f} %, max %{customdata[1]:.2f} %<extra>" + domain + "</extra>",
                )
            )
        fig2.update_layout(
            title="Most prevalent taxa of the smaller domains",
            xaxis=dict(title="Prevalence (% of samples)", range=[0, 100]),
            yaxis=dict(tickfont=dict(size=9)),
            legend=dict(orientation="h", y=-0.15),
            margin=dict(l=240, r=20, t=60, b=70),
            height=max(320, 18 * len(minor_rows) + 160),
        )
    sx.save_figure(fig2, "minor_domain_taxa", title="Taxa of the smaller domains", description="The most prevalent taxa of every domain other than the largest one, by share of samples where they occur; markers show curation lists.")

    # ------------------------------------------------------------------ #
    #  Metrics
    # ------------------------------------------------------------------ #
    sx.metric("domain_column", domain_col)
    sx.metric("n_samples", int(len(relative)))
    sx.metric("n_domains", len(order))
    sx.metric("domains", "; ".join(order))
    sx.metric("dominant_domain", order[0])
    sx.metric("n_taxa", int(relative.shape[1]))
    for domain in order:
        sx.metric(f"{slug(domain)}_mean_pct", finite(share[domain].mean()))
        sx.metric(f"{slug(domain)}_n_taxa", int((relative.loc[:, domains.index[domains == domain]] > 0).any(axis=0).sum()))
    for domain in minor:
        sx.metric(f"n_samples_with_{slug(domain)}", int((share[domain] > 0).sum()))
    sx.finish()


if __name__ == "__main__":
    main()
