"""Compare each question between groups (Kruskal-Wallis, Benjamini-Hochberg FDR)."""
import numpy as np
import pandas as pd
from scipy import stats
import seqdesk_explore as sx

responses = sx.input("responses")
items = list(sx.param("items", []))
group = sx.param("group")
fdr_limit = float(sx.param("fdr", 0.05))

# ---
missing = responses[group].isna()
if missing.any():
    sx.drop(responses[missing], "no group given")
responses = responses[~missing]
groups = sorted(responses[group].astype(str).unique())
sx.note(f"{len(groups)} groups found: {', '.join(groups)}")

# ---
rows = []
for item in items:
    samples = [pd.to_numeric(part[item], errors="coerce").dropna() for _, part in responses.groupby(responses[group].astype(str))]
    samples = [sample for sample in samples if sample.size]
    p = float(stats.kruskal(*samples).pvalue) if len(samples) >= 2 and len({value for sample in samples for value in sample}) > 1 else 1.0
    rows.append({"item": item, "groups": len(samples), "p_value": p})
table = pd.DataFrame(rows)
order = np.argsort(table["p_value"].to_numpy())
ranked = table["p_value"].to_numpy()[order] * len(table) / (np.arange(len(table)) + 1)
fdr = np.empty(len(table))
fdr[order] = np.minimum.accumulate(ranked[::-1])[::-1].clip(max=1) if len(table) else []
table["fdr"] = fdr
table["called"] = table["fdr"] < fdr_limit

# ---
sx.output("group_comparison", table, title="Group comparison")
sx.metric("n_different", int(table["called"].sum()), label="Questions that differ")
sx.metric("n_groups", len(groups), label="Groups")
sx.finish()
