"""Shared preparation of long taxon profile tables (``taxon-profile-long``).

Every diversity or composition kit starts the same way: keep one taxonomic
rank, drop non-detections, remove curated artifacts, renormalise per sample.
This module does that once so kits agree on what a "sample" and a "taxon" are.
The steps follow the INDIVO Explorer reference implementation (``microbiome()``).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

import seqdesk_explore as sx

RA_COLUMN = "relative_abundance_pct"


@dataclass
class PreparedProfile:
    """A cleaned long profile plus the wide matrices kits compute on."""

    long: pd.DataFrame
    """Retained rows: sample, taxon, count, relative abundance and the mapped metadata columns."""
    sample_col: str
    taxon_col: str
    count_col: str
    group_col: str | None
    subject_col: str | None
    time_col: str | None
    taxon_id_col: str | None
    meta: pd.DataFrame
    """One row per retained sample (index = sample id) with the mapped metadata columns."""
    counts: pd.DataFrame
    """Samples x taxa read counts."""
    relative: pd.DataFrame
    """Samples x taxa relative abundance in percent, rows summing to 100."""
    n_rows_input: int = 0
    n_nondetections: int = 0
    artifact_taxa: list[str] = field(default_factory=list)
    artifact_reads_pct: float | None = None
    n_samples_dropped: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def meta_cols(self) -> list[str]:
        return [column for column in (self.group_col, self.subject_col, self.time_col) if column]

    def numeric_time(self) -> pd.Series | None:
        """The timepoint per sample as numbers, or None when it is not numeric."""
        if not self.time_col:
            return None
        values = pd.to_numeric(self.meta[self.time_col], errors="coerce")
        return values if values.notna().any() else None


def _rank_filter(work: pd.DataFrame, rank_col: str | None, rank_param: str, notes: list[str]) -> pd.DataFrame:
    if not rank_col or not rank_param:
        return work
    ranks = work[rank_col].astype(object).map(lambda value: None if value is None else str(value).strip().casefold())
    available = ranks.dropna().unique().tolist()
    wanted = rank_param.casefold()
    if wanted in available:
        if len(available) > 1:
            notes.append(f'Kept rows of rank "{rank_param}" (ranks present: {", ".join(sorted(available))}).')
        return work[ranks == wanted]
    if len(available) > 1:
        most_common = ranks.value_counts().idxmax()
        notes.append(f'Rank "{rank_param}" is not present; used the most frequent rank "{most_common}" instead.')
        return work[ranks == most_common]
    return work


def prepare_profile(
    df: pd.DataFrame,
    *,
    rank: str | None = "species",
    min_reads: float = 0,
    remove_artifacts: bool = True,
) -> PreparedProfile:
    """Clean a long profile table loaded with ``sx.load_dataset``.

    ``rank`` keeps one taxonomic rank when the table maps a rank role;
    ``min_reads`` drops samples with fewer retained reads; ``remove_artifacts``
    drops taxa on curation lists with the artifact role before renormalising.
    """
    notes: list[str] = []
    sample_col = sx.role_column(df, "sample")
    taxon_col = sx.role_column(df, "taxon")
    count_col = sx.role_column(df, "count")
    group_col = sx.role_column(df, "group", required=False)
    subject_col = sx.role_column(df, "subject", required=False)
    time_col = sx.role_column(df, "timepoint", required=False)
    taxon_id_col = sx.role_column(df, "taxon_id", required=False)
    rank_col = sx.role_column(df, "rank", required=False)

    n_rows_input = int(len(df))
    work = df[df[sample_col].notna() & df[taxon_col].notna()].copy()
    work[count_col] = pd.to_numeric(work[count_col], errors="coerce").astype(float)
    work[taxon_col] = work[taxon_col].astype(str).str.strip()
    work[sample_col] = work[sample_col].astype(str)
    work = _rank_filter(work, rank_col, str(rank or "").strip(), notes)

    positive = work[count_col] > 0
    n_nondetections = int((~positive).sum())
    work = work[positive]
    if n_nondetections:
        notes.append(f"Dropped {n_nondetections} rows with a missing or non-positive count.")

    artifact_taxa: list[str] = []
    artifact_reads_pct: float | None = None
    if remove_artifacts:
        artifact_keys = {sx.taxon_key(name) for name in sx.curated_names("artifact")}
        if artifact_keys:
            total_before = float(work[count_col].sum())
            is_artifact = work[taxon_col].map(sx.taxon_key).isin(artifact_keys)
            removed = work[is_artifact]
            artifact_taxa = sorted(removed[taxon_col].unique().tolist())
            if total_before > 0:
                artifact_reads_pct = float(100.0 * removed[count_col].sum() / total_before)
            work = work[~is_artifact]
            if artifact_taxa:
                shown = ", ".join(artifact_taxa[:10]) + (f" and {len(artifact_taxa) - 10} more" if len(artifact_taxa) > 10 else "")
                notes.append(f"Removed {len(artifact_taxa)} artifact taxa from the curation lists before renormalising: {shown}.")

    keep_cols = [column for column in (group_col, subject_col, time_col, taxon_id_col) if column]
    aggregations: dict[str, str] = {count_col: "sum"}
    for column in keep_cols:
        aggregations[column] = "first"
    work = work.groupby([sample_col, taxon_col], sort=False, as_index=False).agg(aggregations)

    totals = work.groupby(sample_col)[count_col].transform("sum")
    if min_reads > 0:
        thin = totals < min_reads
        n_thin = int(work.loc[thin, sample_col].nunique())
        if n_thin:
            notes.append(f"Dropped {n_thin} sample(s) with fewer than {min_reads:g} retained reads.")
        work = work[~thin]
        totals = work.groupby(sample_col)[count_col].transform("sum")
    work[RA_COLUMN] = 100.0 * work[count_col] / totals

    samples_before = set(df[sample_col].dropna().astype(str).unique().tolist())
    samples_after = set(work[sample_col].unique().tolist())
    n_samples_dropped = len(samples_before - samples_after)
    if n_samples_dropped and min_reads <= 0:
        notes.append(f"{n_samples_dropped} sample(s) had no reads left after filtering and were dropped.")

    meta_cols = [column for column in (group_col, subject_col, time_col) if column]
    meta = work.groupby(sample_col, sort=False).agg({column: "first" for column in meta_cols}) if meta_cols else pd.DataFrame(index=pd.Index(sorted(samples_after), name=sample_col))
    counts = work.pivot_table(index=sample_col, columns=taxon_col, values=count_col, aggfunc="sum", fill_value=0.0)
    counts = counts.reindex(meta.index) if len(meta) else counts
    relative = counts.div(counts.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0) * 100.0

    return PreparedProfile(
        long=work.reset_index(drop=True),
        sample_col=sample_col,
        taxon_col=taxon_col,
        count_col=count_col,
        group_col=group_col,
        subject_col=subject_col,
        time_col=time_col,
        taxon_id_col=taxon_id_col,
        meta=meta,
        counts=counts,
        relative=relative,
        n_rows_input=n_rows_input,
        n_nondetections=n_nondetections,
        artifact_taxa=artifact_taxa,
        artifact_reads_pct=artifact_reads_pct,
        n_samples_dropped=n_samples_dropped,
        notes=notes,
    )


def emit_notes(prepared: PreparedProfile) -> None:
    """Forward the preparation notes to the run log and record the shared metrics."""
    for note in prepared.notes:
        sx.note(note)
    sx.metric("n_rows_input", prepared.n_rows_input)
    sx.metric("n_rows_retained", int(len(prepared.long)))
    sx.metric("n_nondetections_dropped", prepared.n_nondetections)
    sx.metric("n_artifact_taxa_removed", len(prepared.artifact_taxa))
    sx.metric("n_samples_dropped", prepared.n_samples_dropped)


def marked_label(taxon: str) -> str:
    """The taxon with a marker in its curation-list colour, for legends and axis labels."""
    memberships = sx.curated_memberships(taxon)
    if not memberships:
        return taxon
    color = next((str(entry["color"]) for entry in memberships if entry.get("color")), None)
    return f'<span style="color:{color}">&#9679;</span> {taxon}' if color else f"{taxon} (curated)"


def shannon(row: np.ndarray) -> float:
    """Shannon entropy (natural log) of one sample's abundances."""
    p = np.asarray(row, float)
    p = p[p > 0]
    if p.sum() <= 0:
        return 0.0
    p = p / p.sum()
    return float(-(p * np.log(p)).sum())


def bh_fdr(pvals: np.ndarray) -> np.ndarray:
    """Benjamini-Hochberg q-values for a 1-D array of p-values (NaNs stay NaN)."""
    p = np.asarray(pvals, dtype=float)
    out = np.full(p.shape, np.nan)
    mask = np.isfinite(p)
    if not mask.any():
        return out
    values = p[mask]
    n = values.size
    order = np.argsort(values)
    ranked = values[order] * n / np.arange(1, n + 1)
    q = np.minimum.accumulate(ranked[::-1])[::-1]
    adjusted = np.empty(n)
    adjusted[order] = np.clip(q, 0.0, 1.0)
    out[mask] = adjusted
    return out
