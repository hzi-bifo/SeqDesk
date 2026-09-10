#!/usr/bin/env python3
"""Descriptive QC from saved FastQC summaries; never reopen the FASTQs."""
from __future__ import annotations

import math

import pandas as pd
import plotly.graph_objects as go

import seqdesk_explore as sx

FIELDS = {"read_count": "read_count", "avg_quality": "mean_quality", "pass": "passed_checks", "warn": "warnings", "fail": "failed_checks"}
COLORS = {"passed_checks": "#0d9488", "warnings": "#d97706", "failed_checks": "#dc2626"}
NOTES = (
    "Reads are counted separately for R1 and R2, not as read pairs. Missing mates and values are not zero-filled.",
    "Mean quality is the saved mean per-sequence Phred score, not Q30 or a per-base quality profile.",
    "WARN / FAIL are FastQC check flags, not pipeline execution failures. Inspect the original HTML reports before deciding whether to clean or exclude reads.",
    "This is a descriptive QC overview, not a benchmark accuracy or case-control analysis. No ground truth is compared.",
)


def number(value, column):
    if value is None or pd.isna(value) or str(value).strip() == "":
        return None
    try:
        parsed = float(value)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"{column} contains a non-numeric value.") from exc
    if not math.isfinite(parsed) or parsed < 0 or (not column.endswith("avg_quality") and not parsed.is_integer()):
        raise ValueError(f"{column} must contain finite, non-negative {'numbers' if column.endswith('avg_quality') else 'integer counts'}.")
    return parsed if column.endswith("avg_quality") else int(parsed)


def prepare_qc(df: pd.DataFrame, sample_col: str) -> pd.DataFrame:
    missing = [key for key in (sample_col, *(f"r1_{suffix}" for suffix in FIELDS)) if key not in df.columns]
    if missing:
        raise ValueError("Choose the FastQC quality summary table. Missing columns: " + ", ".join(missing))
    if df[sample_col].isna().any() or df[sample_col].astype(str).str.strip().eq("").any():
        raise ValueError("Every QC row must have a sample identity.")
    if df[sample_col].duplicated().any():
        raise ValueError("The QC input has duplicate samples. Choose one FastQC result per sample instead of combining repeated runs.")
    rows = []
    for _, row in df.iterrows():
        before = len(rows)
        for mate in ("r1", "r2"):
            values = {target: number(row.get(f"{mate}_{suffix}"), f"{mate}_{suffix}") for suffix, target in FIELDS.items()}
            # A wholly missing R2 is a single-end/missing mate, not a zero-read file.
            if all(value is None for value in values.values()):
                continue
            checks = [values[key] for key in COLORS]
            if (values["failed_checks"] or 0) > 0:
                status = "Failed checks"
            elif (values["warnings"] or 0) > 0:
                status = "Warnings"
            elif all(value is not None for value in checks) and sum(checks) > 0:
                status = "Passed checks"
            else:
                status = "Unknown"
            label = row.get("sample_id")
            rows.append({
                "sample_db_id": str(row[sample_col]),
                "sample_id": str(label) if label is not None and not pd.isna(label) else str(row[sample_col]),
                "read_end": mate.upper(), **values,
                "review_status": status,
                "pipeline_run": row.get("pipeline_run"),
            })
        if len(rows) == before:
            raise ValueError("A sample in the FastQC summary has no measured reads or quality checks. Review the source table before reporting.")
    if not rows:
        raise ValueError("The FastQC summary has no measured reads or quality checks to report.")
    return pd.DataFrame(rows)


def main():
    source = sx.load_dataset("qc")
    qc = prepare_qc(source, sx.role_column(source, "sample"))
    sx.save_table(qc, "qc_by_mate", title="FastQC results by mate", table_kind="sample-summary", roles={"sample": "sample_db_id"},
                  schema_id="seqdesk.fastqc-by-mate", schema_version="1", row_entity="read-mate",
                  columns={
                      "sample_id": {"type": "string", "label": "Sample"},
                      "read_end": {"type": "string", "label": "Read mate"},
                      "read_count": {"type": "number", "label": "Reads", "unit": "reads"},
                      "mean_quality": {"type": "number", "label": "Mean quality", "unit": "Phred"},
                      "passed_checks": {"type": "number", "label": "Passed checks", "unit": "checks"},
                      "warnings": {"type": "number", "label": "Warnings", "unit": "checks"},
                      "failed_checks": {"type": "number", "label": "Failed checks", "unit": "checks"},
                  },
                  description="Saved FastQC measurements and check counts. Missing cells are unknown, not zero. Pipeline run identifies the source of each row.")
    labels = (qc["sample_id"] + " · " + qc["read_end"]).tolist()
    # Distinct samples may share an alias; do not merge their chart categories.
    if len(set(labels)) != len(labels):
        labels = [f"{label} [{index + 1}]" for index, label in enumerate(labels)]
    for column, name, title, unit in [
        ("read_count", "read_counts", "Reads per mate", "Reads (not pairs)"),
        ("mean_quality", "mean_quality", "Mean read quality", "Mean Phred quality"),
    ]:
        if qc[column].notna().any():
            fig = go.Figure(go.Bar(x=labels, y=qc[column].where(qc[column].notna(), None).tolist(),
                                   marker_color=["#0d9488" if end == "R1" else "#6366f1" for end in qc["read_end"]]))
            fig.update_layout(title=title, xaxis_title="Sample · mate", yaxis_title=unit, template="plotly_white", height=400)
            fig.update_xaxes(type="category")
            # This lightweight kit needs no server-side Chrome/PNG renderer.
            # Plotly remains interactive in the report.
            sx.save_figure(fig, name, title=title, png=False)
        else:
            sx.note(f"Skipped {name}: no values were provided.")
    fig = go.Figure()
    for column, color in COLORS.items():
        fig.add_trace(go.Bar(x=labels, y=qc[column].where(qc[column].notna(), None).tolist(), name={"passed_checks": "PASS", "warnings": "WARN", "failed_checks": "FAIL"}[column], marker_color=color))
    fig.update_layout(title="FastQC checks by mate", barmode="stack", xaxis_title="Sample · mate", yaxis_title="Checks (not reads)", template="plotly_white", height=400)
    fig.update_xaxes(type="category")
    sx.save_figure(fig, "check_status", title="FastQC checks by mate", png=False, description="Counts of check flags. Missing check counts remain unknown; open the original HTML reports for details.")
    sx.metric("n_samples", int(qc["sample_db_id"].nunique()))
    sx.metric("n_read_files", len(qc))
    total_reads = qc["read_count"].sum(min_count=1)
    sx.metric("total_reads", None if qc["read_count"].isna().any() else int(total_reads))
    sx.metric("files_with_warnings", None if qc["warnings"].isna().any() else int((qc["warnings"] > 0).sum()))
    sx.metric("files_with_failed_checks", None if qc["failed_checks"].isna().any() else int((qc["failed_checks"] > 0).sum()))
    incomplete = int(qc[list(FIELDS.values())].isna().any(axis=1).sum())
    sx.metric("files_with_missing_values", incomplete)
    if incomplete:
        sx.note(f"{incomplete} read file(s) have missing values. Affected totals are unknown, not partial sums or zero.")
    for note in NOTES:
        sx.note(note)
    if qc["sample_db_id"].nunique() == 1:
        sx.note("Only one sample is present. The plots compare mates, not independent biological replicates.")
    sx.finish()


if __name__ == "__main__":
    main()
