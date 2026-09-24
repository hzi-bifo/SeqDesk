"""Test every gene between the two groups (Welch's t-test on log CPM, Benjamini-Hochberg FDR)."""
import numpy as np
import pandas as pd
from scipy import stats
import seqdesk_explore as sx

data = sx.input("normalised")
gene = sx.param("gene")
control = [column for column in sx.param("control", []) if column in data.columns]
treated = [column for column in sx.param("treated", []) if column in data.columns]
fdr_limit = float(sx.param("fdr", 0.05))
min_lfc = float(sx.param("min_lfc", 1))

# ---
if len(control) < 2 or len(treated) < 2:
    raise ValueError("Each group needs at least two samples")
a = data[control].astype(float).to_numpy()
b = data[treated].astype(float).to_numpy()
lfc = b.mean(axis=1) - a.mean(axis=1)
_, p = stats.ttest_ind(b, a, axis=1, equal_var=False)
p = np.where(np.isnan(p), 1.0, p)

# ---
order = np.argsort(p)
ranked = p[order] * len(p) / (np.arange(len(p)) + 1)
fdr = np.empty_like(p)
fdr[order] = np.minimum.accumulate(ranked[::-1])[::-1].clip(max=1)

# ---
results = pd.DataFrame({gene: data[gene].values, "log2fc": lfc, "p_value": p, "fdr": fdr})
results["called"] = (results["fdr"] < fdr_limit) & (results["log2fc"].abs() >= min_lfc)
sx.output("results", results, title="Test results", roles={"taxon_id": gene})
sx.metric("n_called", int(results["called"].sum()), label="DE genes")
sx.finish()
