"""Stacked bars: the share of each answer, per question."""
import pandas as pd
import seqdesk_explore as sx

responses = sx.input("responses")
items = list(sx.param("items", []))

# ---
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

shares = pd.DataFrame({item: pd.to_numeric(responses[item], errors="coerce").value_counts(normalize=True).reindex([1, 2, 3, 4, 5], fill_value=0) for item in items}).T
fig, ax = plt.subplots(figsize=(7, 0.45 * max(len(items), 2) + 1))
left = pd.Series(0.0, index=shares.index)
greys = ["#b2182b", "#ef8a62", "#d9d9d9", "#67a9cf", "#2166ac"]
for answer, colour in zip([1, 2, 3, 4, 5], greys):
    ax.barh(shares.index, shares[answer], left=left, color=colour, label=str(answer))
    left += shares[answer]
ax.set_xlim(0, 1)
ax.set_xlabel("Share of answers")
ax.legend(title="Answer", ncols=5, loc="lower center", bbox_to_anchor=(0.5, 1.0), frameon=False)

# ---
sx.figure("answers", fig, title="Answers per question")
sx.finish()
