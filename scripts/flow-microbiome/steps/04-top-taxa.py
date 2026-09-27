# Step 4 - Differentially abundant taxa (Mann-Whitney per feature, BH FDR).
#
# Inputs:  counts_qc, samples_qc (from step 1), taxonomy (feature_id, taxon, confidence)
# Params:  group_column   the two groups to compare
#          min_prevalence keep features present in at least this fraction of samples
#          fdr            BH-adjusted p-value cutoff
#          n_top          rows in the top table and the figure
# Outputs: top_taxa (feature_id, taxon, mean relative abundance per group,
#          log2 ratio, p, q), figure top_taxa.
# Packages: base seqdesk-explore-python (scipy, statsmodels, matplotlib).
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import scipy
from scipy import stats
from statsmodels.stats.multitest import multipletests
import seqdesk_explore as sx

counts = sx.input("counts_qc").set_index("feature_id").astype("float64")
samples = sx.input("samples_qc")
taxonomy = sx.input("taxonomy").set_index("feature_id")
group_column = str(sx.param("group_column", "body_site"))
min_prevalence = float(sx.param("min_prevalence", 0.1))
fdr = float(sx.param("fdr", 0.05))
n_top = int(sx.param("n_top", 15))

samples = samples[samples["kept"].astype(bool)]
ids = samples["sample"].astype(str).tolist()
levels = sorted(samples[group_column].astype(str).unique())
if len(levels) != 2:
    raise ValueError(f"{group_column} must have exactly two groups here, found {', '.join(levels)}")
rel = counts[ids] / counts[ids].sum(axis=0)
prevalent = (rel > 0).mean(axis=1) >= min_prevalence
sx.drop(int((~prevalent).sum()), f"features in fewer than {min_prevalence:.0%} of samples", input="counts_qc")
rel = rel[prevalent]
group = samples.set_index("sample").loc[ids, group_column].astype(str)
a, b = (rel.loc[:, group == level] for level in levels)
pvalues = np.array([stats.mannwhitneyu(a.loc[f], b.loc[f], alternative="two-sided").pvalue for f in rel.index])
qvalues = multipletests(pvalues, method="fdr_bh")[1]
pseudo = 1e-6
table = pd.DataFrame({
    "feature_id": rel.index,
    "taxon": [str(taxonomy["taxon"].get(f, "Unassigned")) for f in rel.index],
    f"mean_{levels[0]}": a.mean(axis=1).to_numpy(),
    f"mean_{levels[1]}": b.mean(axis=1).to_numpy(),
    "log2_ratio": np.log2((b.mean(axis=1) + pseudo) / (a.mean(axis=1) + pseudo)).to_numpy(),
    "p": pvalues,
    "q": qvalues,
}).sort_values(["q", "p", "feature_id"]).reset_index(drop=True)
top = table.head(n_top)
sx.output("top_taxa", top, title=f"Top {n_top} taxa, {levels[1]} vs {levels[0]}")
sx.output("all_taxa", table, title="All tested taxa")

def short(taxon):
    parts = [p.strip() for p in taxon.split(";") if p.strip() and not p.strip().endswith("__")]
    return parts[-1] if parts else taxon

fig, ax = plt.subplots(figsize=(6, 0.3 * len(top) + 1.2))
ax.barh([f"{short(t)} {f[:6]}" for t, f in zip(top["taxon"], top["feature_id"])][::-1], top["log2_ratio"][::-1], color="#555555")
ax.axvline(0, color="black", linewidth=0.8)
ax.set_xlabel(f"log2 mean relative abundance, {levels[1]} / {levels[0]}")
ax.set_title(f"Top {len(top)} taxa by q-value")
ax.tick_params(axis="y", labelsize=7)
fig.tight_layout()
sx.figure("top_taxa", fig, title="Top differentially abundant taxa")

n_sig = int((table["q"] < fdr).sum())
prevalence_filter = {"param": "min_prevalence", "op": ">=", "value": min_prevalence, "column": "prevalence"}
significance = {"contrast": f"{levels[1]} vs {levels[0]}", "test": "Mann-Whitney U per feature, BH FDR", "method": f"scipy {scipy.__version__}"}
sx.metric("n_tested", len(table), label=f"Features tested (prevalence >= {min_prevalence:.0%})",
          definition={"what": "Features tested", "filters": [prevalence_filter]})
sx.metric("n_significant", n_sig, label=f"Features with BH q < {fdr}",
          definition={"what": "Significant features", **significance, "filters": [prevalence_filter, {"param": "fdr", "op": "<", "value": fdr, "column": "q"}]})
sx.metric("n_higher_" + levels[1], int(((table["q"] < fdr) & (table["log2_ratio"] > 0)).sum()), label=f"Significant, higher in {levels[1]}")
sx.note(f"Mann-Whitney U per feature on relative abundance, BH FDR; {n_sig} of {len(table)} features with q < {fdr}.")
sx.finish()
