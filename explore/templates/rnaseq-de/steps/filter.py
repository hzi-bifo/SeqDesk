"""Filter low counts: keep genes with enough reads in enough samples."""
import seqdesk_explore as sx

counts = sx.input("counts")
gene = sx.param("gene")
samples = list(sx.param("samples", []))
min_count = float(sx.param("min_count", 10))
min_samples = int(sx.param("min_samples", 2))

# ---
expressed = (counts[samples].fillna(0) >= min_count).sum(axis=1) >= min_samples
kept = counts[expressed]
sx.drop(counts[~expressed], f"fewer than {min_count:g} reads in at least {min_samples} samples")

# ---
sx.output("filtered", kept[[gene, *samples]], title="Filtered counts", roles={"taxon_id": gene})
sx.metric("n_kept", int(len(kept)), label="Genes kept")
sx.finish()
