# Step 2 - Alpha diversity by group (scikit-bio).
#
# Inputs:  counts_qc, samples_qc (from step 1)
# Params:  group_column   groups to compare
#          log_base       logarithm base of the Shannon index (2 = bits, as QIIME 2)
# Outputs: alpha (sample, group, shannon, observed_features), figure alpha_by_group.
# Metrics: median Shannon and observed features per group; Mann-Whitney U
#          p-value (two groups) or Kruskal-Wallis p-value (more).
# Packages: base seqdesk-explore-python (scikit-bio, scipy, matplotlib).
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import stats
from skbio.diversity import alpha_diversity
import seqdesk_explore as sx

counts = sx.input("counts_qc").set_index("feature_id").astype("float64")
samples = sx.input("samples_qc")
group_column = str(sx.param("group_column", "body_site"))
base = float(sx.param("log_base", 2))

samples = samples[samples["kept"].astype(bool)]
ids = samples["sample"].astype(str).tolist()
data = counts[ids].T.to_numpy()
if not np.allclose(data, np.round(data)):
    raise ValueError("Alpha diversity needs counts: run step 1 with normalise = rarefy.")
data = np.round(data).astype(np.int64)
shannon = alpha_diversity("shannon", data, ids=ids, base=base)
observed = alpha_diversity("observed_features", data, ids=ids)
alpha = samples[["sample", group_column]].copy()
alpha["shannon"] = shannon.loc[ids].to_numpy()
alpha["observed_features"] = observed.loc[ids].to_numpy().astype(int)
sx.output("alpha", alpha, title="Alpha diversity", roles={"sample": "sample", "group": group_column})

levels = sorted(alpha[group_column].astype(str).unique())
fig, axes = plt.subplots(1, 2, figsize=(7, 3.6))
for ax, column, title in zip(axes, ["shannon", "observed_features"], [f"Shannon (log{base:g})", "Observed features"]):
    values = [alpha.loc[alpha[group_column] == level, column].to_numpy() for level in levels]
    ax.boxplot(values, showfliers=False)
    ax.set_xticks(range(1, len(levels) + 1), levels)
    for i, v in enumerate(values, start=1):
        ax.scatter(np.full(len(v), i) + np.linspace(-0.12, 0.12, len(v)), v, s=10, color="#333333", zorder=3)
    ax.set_title(title)
fig.tight_layout()
sx.figure("alpha_by_group", fig, title="Alpha diversity by group")

for column, label in [("shannon", "Shannon"), ("observed_features", "Observed features")]:
    groups = [alpha.loc[alpha[group_column] == level, column].to_numpy() for level in levels]
    for level, v in zip(levels, groups):
        sx.metric(f"median_{column}_{level}".replace(" ", "_"), round(float(np.median(v)), 4), label=f"Median {label}, {level} (n={len(v)})")
    if len(levels) == 2:
        test = stats.mannwhitneyu(groups[0], groups[1], alternative="two-sided")
        name = "Mann-Whitney U"
    else:
        test = stats.kruskal(*groups)
        name = "Kruskal-Wallis"
    sx.metric(f"p_{column}", float(f"{test.pvalue:.3g}"), label=f"{label}: {name} p-value ({' vs '.join(levels)})")
sx.note(f"Shannon (log base {base:g}) and observed features for {len(ids)} samples; groups {', '.join(levels)}.")
sx.finish()
