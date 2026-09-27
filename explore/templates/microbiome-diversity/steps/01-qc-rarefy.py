# Step 1 - Sample QC, then rarefy (or relative abundance).
#
# Inputs:  counts   (wide: feature_id + one integer column per sample)
#          samples  (one row per sample: sample, body_site, subject, ...)
# Params:  sample_column  sample-sheet column with the sample ids (the count column names)
#          feature_column counts column naming the features
#          subject_column optional sample-sheet column saying who a sample came from
#          group_column   sample-sheet column that defines the groups
#          group_levels   the two (or more) levels to compare; others are left out
#          min_depth      drop samples with fewer reads than this
#          normalise      "rarefy" (subsample every sample to min_depth reads) or "relative"
#          seed           random seed of the rarefaction
# Outputs: counts_qc (feature_id + kept samples), samples_qc (sheet + depth + kept),
#          figure read_depth.
# Packages: base seqdesk-explore-python (numpy, pandas, matplotlib); no extras.
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import seqdesk_explore as sx

counts = sx.input("counts")
samples = sx.input("samples")
sample_column = str(sx.param("sample_column", "sample"))
feature_column = str(sx.param("feature_column", "feature_id"))
subject_column = str(sx.param("subject_column", "") or "")


def canonical(frame, source, target):
    """The person's own id column becomes the name the later steps read (sample, feature_id)."""
    if source not in frame.columns:
        raise ValueError(f"Column {source} is not in the table; it has {', '.join(map(str, frame.columns[:8]))}")
    if source == target:
        return frame
    return frame.rename(columns={target: f"{target}_original"} if target in frame.columns else {}).rename(columns={source: target})


samples = canonical(samples, sample_column, "sample")
samples["sample"] = samples["sample"].astype(str)
counts = canonical(counts, feature_column, "feature_id")
group_column = str(sx.param("group_column", "body_site"))
levels = [str(level) for level in sx.param("group_levels", ["gut", "tongue"])]
min_depth = int(sx.param("min_depth", 1103))
normalise = str(sx.param("normalise", "rarefy"))
seed = int(sx.param("seed", 42))
if normalise not in ("rarefy", "relative"):
    raise ValueError('normalise must be "rarefy" or "relative"')

ids = [str(s) for s in samples["sample"]]
missing = [s for s in ids if s not in counts.columns]
if missing:
    raise ValueError("Samples without a counts column: " + ", ".join(missing))
matrix = counts.set_index("feature_id")[ids].astype("float64").fillna(0)

samples = samples.copy()
samples["depth"] = [int(matrix[s].sum()) for s in ids]
in_groups = samples[group_column].astype(str).isin(levels)
deep = samples["depth"] >= min_depth
samples["kept"] = in_groups & deep
other = samples[~in_groups]
if len(other):
    sx.drop(other, f"{group_column} not in {', '.join(levels)}", input="samples")
shallow = samples[in_groups & ~deep]
if len(shallow):
    sx.drop(shallow, f"fewer than {min_depth:,} reads", input="samples")
kept = samples.loc[samples["kept"], "sample"].astype(str).tolist()
if len(kept) < 4:
    raise ValueError("Fewer than 4 samples pass QC.")

rng = np.random.default_rng(seed)
table = matrix[kept]
if normalise == "rarefy":
    # Subsample without replacement, sample by sample in sheet order.
    rarefied = {s: rng.multivariate_hypergeometric(table[s].to_numpy().astype(np.int64), min_depth) for s in kept}
    table = table.assign(**rarefied).astype("int64")
else:
    table = table / table.sum(axis=0)
present = table.sum(axis=1) > 0
sx.drop(int((~present).sum()), "features with no reads in the kept samples" + (" after rarefaction" if normalise == "rarefy" else ""), input="counts")
table = table[present]

out = table.reset_index()
sx.output("counts_qc", out, title="Counts after QC", description=f"{len(kept)} samples, {'rarefied to ' + format(min_depth, ',') + ' reads' if normalise == 'rarefy' else 'relative abundance'}.")
roles = {"sample": "sample", "group": group_column}
if subject_column and subject_column in samples.columns:
    roles["subject"] = subject_column
sx.output("samples_qc", samples, title="Samples after QC", roles=roles)

order = samples.sort_values("depth")
fig, ax = plt.subplots(figsize=(6, max(4, len(order) * 0.12)))
ax.barh(order["sample"].astype(str), order["depth"], color=["#595959" if k else "#b22222" for k in order["kept"]])
ax.axvline(min_depth, linestyle="--", color="black", linewidth=1)
ax.set_xscale("log")
ax.set_xlabel("Reads per sample (log scale)")
ax.set_title("Read depth; dashed line = min_depth, red = left out")
ax.tick_params(axis="y", labelsize=5)
fig.tight_layout()
sx.figure("read_depth", fig, title="Read depth per sample")

sx.metric("n_samples", len(samples), label="Samples in the sheet")
sx.metric("n_samples_kept", len(kept), label=f"Samples kept ({', '.join(levels)}; >= {min_depth:,} reads)")
sx.metric("n_features_in", int(matrix.shape[0]), label="Features in the table")
sx.metric("n_features_kept", int(table.shape[0]), label="Features with reads after QC")
sx.metric("min_depth", min_depth, label="Read-depth threshold")
sx.note(f"{len(kept)} of {len(samples)} samples kept; {table.shape[0]} of {matrix.shape[0]} features remain ({normalise}, seed {seed}).")
sx.finish()
