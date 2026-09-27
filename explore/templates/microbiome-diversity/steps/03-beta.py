# Step 3 - Beta diversity: Bray-Curtis, PCoA and PERMANOVA (scikit-bio).
#
# Inputs:  counts_qc, samples_qc (from step 1)
# Params:  group_column   grouping tested by PERMANOVA and used to colour the PCoA
#          metric         beta-diversity metric passed to skbio (braycurtis)
#          permutations   PERMANOVA permutations
#          seed           random seed of the permutations
# Outputs: pcoa_coordinates (sample, group, PC1, PC2, PC3), figure pcoa.
# Metrics: pseudo-F, p-value, permutations, variance explained by PC1 and PC2.
# Packages: base seqdesk-explore-python (scikit-bio, matplotlib).
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from skbio.diversity import beta_diversity
from skbio.stats.distance import permanova
from skbio.stats.ordination import pcoa
import seqdesk_explore as sx

counts = sx.input("counts_qc").set_index("feature_id").astype("float64")
samples = sx.input("samples_qc")
group_column = str(sx.param("group_column", "body_site"))
metric = str(sx.param("metric", "braycurtis"))
permutations = int(sx.param("permutations", 999))
seed = int(sx.param("seed", 42))

samples = samples[samples["kept"].astype(bool)]
ids = samples["sample"].astype(str).tolist()
dm = beta_diversity(metric, counts[ids].T.to_numpy().astype("float64"), ids=ids)
grouping = samples.set_index("sample").loc[ids, group_column].astype(str)
result = permanova(dm, grouping, permutations=permutations, seed=seed)
ordination = pcoa(dm)
explained = ordination.proportion_explained

coords = ordination.samples.iloc[:, :3].copy()
coords.columns = ["PC1", "PC2", "PC3"]
coords.insert(0, group_column, grouping.loc[coords.index].to_numpy())
coords.insert(0, "sample", coords.index.astype(str))
sx.output("pcoa_coordinates", coords.reset_index(drop=True), title="PCoA coordinates", roles={"sample": "sample", "group": group_column})

fig, ax = plt.subplots(figsize=(5, 4.2))
shades = ["#222222", "#9a9a9a", "#555555", "#cccccc"]
for i, level in enumerate(sorted(grouping.unique())):
    part = coords[coords[group_column] == level]
    ax.scatter(part["PC1"], part["PC2"], s=22, color=shades[i % len(shades)], edgecolor="black", linewidth=0.4, label=f"{level} (n={len(part)})")
ax.set_xlabel(f"PC1 ({explained.iloc[0] * 100:.1f}%)")
ax.set_ylabel(f"PC2 ({explained.iloc[1] * 100:.1f}%)")
ax.set_title(f"PCoA, {metric}: pseudo-F {result['test statistic']:.2f}, p = {result['p-value']:.3g}")
ax.legend(frameon=False)
fig.tight_layout()
sx.figure("pcoa", fig, title=f"PCoA of {metric} distances")

sx.metric("pseudo_f", round(float(result["test statistic"]), 4), label=f"PERMANOVA pseudo-F ({group_column})")
sx.metric("p_permanova", float(result["p-value"]), label=f"PERMANOVA p-value ({permutations} permutations, seed {seed})")
sx.metric("permutations", int(result["number of permutations"]), label="Permutations")
sx.metric("pc1_explained", round(float(explained.iloc[0]) * 100, 2), label="PC1 variance explained", unit="%")
sx.metric("pc2_explained", round(float(explained.iloc[1]) * 100, 2), label="PC2 variance explained", unit="%")
sx.note(f"{metric} on {len(ids)} samples; PERMANOVA by {group_column}: pseudo-F {result['test statistic']:.3f}, p {result['p-value']:.3g}.")
sx.finish()
