#!/usr/bin/env python3
"""Table summary: column statistics and distribution plots for any table."""
from __future__ import annotations

import math

import pandas as pd
import plotly.graph_objects as go
from plotly.colors import qualitative
from plotly.subplots import make_subplots

import seqdesk_explore as sx

MAX_GROUPS = 12
PANEL_COLUMNS = 3
PANEL_HEIGHT = 260


def is_numeric(series: pd.Series) -> bool:
    return pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series)


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def summarize_column(df: pd.DataFrame, key: str, schema: dict, role_of: dict[str, str]) -> dict:
    series = df[key]
    column = schema.get(key, {})
    non_null = series.dropna()
    row = {
        "column": key,
        "label": column.get("label") or key,
        "type": column.get("type") or ("number" if is_numeric(series) else "string"),
        "role": role_of.get(key),
        "n": int(non_null.shape[0]),
        "n_missing": int(series.shape[0] - non_null.shape[0]),
        "n_unique": int(non_null.nunique()),
        "mean": None,
        "sd": None,
        "min": None,
        "median": None,
        "max": None,
        "top_value": None,
        "top_count": None,
    }
    if is_numeric(series):
        values = non_null.astype(float)
        if len(values) > 0:
            row.update(
                mean=finite(values.mean()),
                sd=finite(values.std(ddof=1)) if len(values) > 1 else None,
                min=finite(values.min()),
                median=finite(values.median()),
                max=finite(values.max()),
            )
    elif len(non_null) > 0:
        if pd.api.types.is_bool_dtype(series):
            non_null = non_null.map(lambda value: "true" if bool(value) else "false")
        counts = non_null.astype(str).value_counts()
        row["top_value"] = str(counts.index[0])
        row["top_count"] = int(counts.iloc[0])
    return row


def distributions_figure(df: pd.DataFrame, columns: list[str], labels: dict[str, str], group_col: str | None) -> go.Figure:
    n_cols = min(PANEL_COLUMNS, len(columns))
    n_rows = math.ceil(len(columns) / n_cols)
    fig = make_subplots(rows=n_rows, cols=n_cols, subplot_titles=[labels[key] for key in columns], vertical_spacing=min(0.3, 0.9 / max(n_rows, 1)))
    palette = qualitative.D3
    groups: list = []
    if group_col:
        groups = sorted(df[group_col].dropna().astype(str).unique().tolist())
        if len(groups) > MAX_GROUPS:
            sx.note(f"Group role has {len(groups)} values; histograms are coloured by the first {MAX_GROUPS} only.")
            groups = groups[:MAX_GROUPS]
    for index, key in enumerate(columns):
        row, col = divmod(index, n_cols)
        row += 1
        col += 1
        if groups:
            group_values = df[group_col].astype(object).map(lambda value: None if value is None else str(value))
            for g_index, group in enumerate(groups):
                values = df.loc[group_values == group, key].dropna().astype(float)
                fig.add_trace(
                    go.Histogram(x=values, name=group, legendgroup=group, showlegend=index == 0, opacity=0.6, marker_color=palette[g_index % len(palette)]),
                    row=row,
                    col=col,
                )
        else:
            values = df[key].dropna().astype(float)
            fig.add_trace(go.Histogram(x=values, name=labels[key], showlegend=False, marker_color=palette[0]), row=row, col=col)
    fig.update_layout(
        title="Distributions of numeric columns",
        barmode="overlay",
        height=max(320, PANEL_HEIGHT * n_rows + 80),
        margin=dict(l=40, r=20, t=70, b=40),
        legend_title_text=labels.get(group_col, group_col) if group_col else None,
    )
    fig.update_yaxes(title_text="Rows")
    return fig


def main() -> None:
    df = sx.load_dataset("table")
    max_columns = int(sx.param("max_columns", 12) or 12)
    max_columns = max(1, min(max_columns, 64))
    schema = {column["key"]: column for column in df.attrs.get("columns", [])}
    role_of = {column: role for role, column in sx.roles(df).items()}
    labels = {key: (schema.get(key, {}).get("label") or key) for key in df.columns}
    sample_col = sx.role_column(df, "sample", required=False)
    group_col = sx.role_column(df, "group", required=False)

    summary = pd.DataFrame([summarize_column(df, key, schema, role_of) for key in df.columns])
    summary["top_count"] = summary["top_count"].astype("Int64")  # keep counts integral where some rows are empty
    sx.save_table(
        summary,
        "summary",
        title="Column summary",
        description="One row per column: type, non-missing count, distinct values and summary statistics.",
    )

    numeric_columns = [key for key in df.columns if is_numeric(df[key])]
    plottable = [key for key in numeric_columns if df[key].notna().any()]
    empty_numeric = sorted(set(numeric_columns) - set(plottable))
    if empty_numeric:
        sx.note(f"Numeric columns without values were not plotted: {', '.join(empty_numeric)}.")
    if len(plottable) > max_columns:
        sx.note(f"Only the first {max_columns} of {len(plottable)} numeric columns were plotted (max_columns).")
        plottable = plottable[:max_columns]
    if plottable:
        fig = distributions_figure(df, plottable, labels, group_col)
        sx.save_figure(
            fig,
            "distributions",
            title="Distributions of numeric columns",
            description="Histogram per numeric column" + (f", coloured by {labels.get(group_col, group_col)}." if group_col else "."),
        )
    else:
        sx.note("The table has no numeric column with values; the distributions figure was skipped.")

    sx.metric("n_rows", int(len(df)))
    sx.metric("n_columns", int(len(df.columns)))
    sx.metric("n_numeric_columns", len(numeric_columns))
    sx.metric("n_text_columns", int(len(df.columns) - len(numeric_columns)))
    sx.metric("n_missing_cells", int(df.isna().sum().sum()))
    if sample_col:
        sx.metric("n_samples", int(df[sample_col].dropna().nunique()))
    if group_col:
        sx.metric("n_groups", int(df[group_col].dropna().nunique()))
    sx.finish()


if __name__ == "__main__":
    main()
