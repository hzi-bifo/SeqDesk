"""QC summary from the two shell steps: share of reads kept and the read-length distribution."""
import matplotlib.pyplot as plt
from seqdesk_explore import load_dataset, metric, save_figure, save_table, finish

qc = load_dataset("read_qc").set_index("stage")
lengths = load_dataset("length_histogram")

before, after = qc.loc["before_filtering"], qc.loc["after_filtering"]
kept = 100 * float(after["reads"]) / float(before["reads"])
metric("pct_kept", round(kept, 2), label="Reads kept by fastp", unit="%", definition={"what": "reads after / reads before fastp filtering", "method": "fastp via shell step"})

by_length = lengths.groupby("length", as_index=False)["reads"].sum().sort_values("length")
modal = int(by_length.loc[by_length["reads"].idxmax(), "length"])
full = int(by_length["length"].max())
share_full = 100 * float(by_length.loc[by_length["length"] == full, "reads"].sum()) / float(by_length["reads"].sum())
metric("modal_length", modal, label="Most common read length", unit="bp")
metric("pct_full_length", round(share_full, 2), label="Reads at full length", unit="%", definition={"what": f"reads of the longest length ({full} bp), both mates"})
save_table(by_length, "length_totals", title="Reads per length, both mates")

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9, 3.4))
ax1.bar(["before", "after"], [before["reads"], after["reads"]], color="#555555")
ax1.set_ylabel("reads"); ax1.set_title("fastp filtering")
for mate, part in lengths.groupby("mate"):
    ax2.step(part["length"], part["reads"], where="mid", label=mate)
ax2.set_yscale("log"); ax2.set_xlabel("read length (bp)"); ax2.set_ylabel("reads"); ax2.set_title("Read lengths"); ax2.legend(frameon=False)
fig.tight_layout()
save_figure(fig, "qc_summary", title="Reads kept and read lengths")
finish()
