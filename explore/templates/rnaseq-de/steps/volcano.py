"""Volcano plot: fold change against significance."""
import numpy as np
import seqdesk_explore as sx

results = sx.input("results")

# ---
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(6, 4.5))
called = results["called"].fillna(False).astype(bool)
y = -np.log10(results["p_value"].astype(float).clip(lower=1e-300))
ax.scatter(results["log2fc"][~called], y[~called], s=6, color="#9a9a9a", linewidths=0)
ax.scatter(results["log2fc"][called], y[called], s=8, color="#2f5d8a", linewidths=0)
ax.set_xlabel("log2 fold change")
ax.set_ylabel("-log10 p")

# ---
sx.figure("volcano", fig, title="Volcano plot")
sx.finish()
