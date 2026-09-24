"""Normalise counts to log2 counts per million."""
import numpy as np
import seqdesk_explore as sx

counts = sx.input("filtered")
gene = sx.param("gene")
samples = list(sx.param("samples", []))
prior = float(sx.param("prior", 1))

# ---
depth = counts[samples].fillna(0).sum(axis=0)
empty = [sample for sample in samples if depth[sample] == 0]
if empty:
    sx.drop(empty, "no reads at all", axis="columns")
samples = [sample for sample in samples if sample not in empty]
cpm = counts[samples].fillna(0).astype(float).div(depth[samples], axis=1) * 1e6
logcpm = np.log2(cpm + prior)

# ---
out = logcpm.copy()
out.insert(0, gene, counts[gene].values)
sx.output("normalised", out, title="log2 CPM", roles={"taxon_id": gene})
sx.metric("n_samples", len(samples), label="Samples")
sx.finish()
