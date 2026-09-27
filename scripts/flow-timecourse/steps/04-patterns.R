# Step 4 - Group the significant genes into temporal response patterns.
#
# Inputs:  lrt_results (step 3), vst (step 2), samples_qc (step 1)
# Params:  max_genes   at most this many significant genes (smallest padj first) are clustered
#          n_patterns  number of patterns (clusters) cut from the tree
#          method      hclust linkage on 1 - Pearson correlation of the gene profiles
#          seed        fixed random seed (hclust is deterministic; the seed covers tie-breaking in ordering)
# Outputs: gene_patterns (gene_id, pattern, padj), pattern_profiles (pattern x dose x time mean z-score),
#          figure pattern_profiles.
# Metrics: n_clustered, n_patterns, largest_pattern_size, smallest_pattern_size.
# Packages: base seqdesk-explore-r (ggplot2); no extras.
suppressPackageStartupMessages({ library(ggplot2) })

lrt <- sx$input("lrt_results")
vst <- sx$input("vst")
samples <- sx$input("samples_qc")
samples <- samples[tolower(as.character(samples$kept)) %in% c("true", "1"), , drop = FALSE]
max_genes <- as.integer(sx$param("max_genes", 2000))
k <- as.integer(sx$param("n_patterns", 6))
linkage <- as.character(sx$param("method", "ward.D2"))
set.seed(as.integer(sx$param("seed", 1)))

sig <- lrt[tolower(as.character(lrt$significant)) %in% c("true", "1"), , drop = FALSE]
sig <- head(sig[order(sig$padj, -sig$stat), , drop = FALSE], max_genes)
v <- as.matrix(vst[match(sig$gene_id, vst$gene_id), samples$sample, drop = FALSE])
rownames(v) <- sig$gene_id

dose_levels <- levels(factor(samples$dose_f, levels = unique(samples$dose_f[order(samples$dose_ng_mL)])))
time_levels <- levels(factor(samples$time_f, levels = unique(samples$time_f[order(samples$time)])))
groups <- as.vector(outer(dose_levels, time_levels, paste, sep = "_"))
means <- sapply(groups, function(g) rowMeans(v[, samples$group == g, drop = FALSE]))
z <- t(scale(t(means)))
z[!is.finite(z)] <- 0
tree <- hclust(as.dist(1 - cor(t(z))), method = linkage)
pattern <- cutree(tree, k = k)
# Number patterns by size, largest first, so pattern 1 is always the biggest.
rank <- order(-tabulate(pattern, k), seq_len(k))
pattern <- match(pattern, rank)
genes <- data.frame(gene_id = rownames(z), pattern = paste0("P", pattern), padj = sig$padj, check.names = FALSE)
invisible(sx$output("gene_patterns", genes[order(genes$pattern, genes$padj), ], title = sprintf("%d genes in %d temporal patterns", nrow(genes), k)))

profiles <- do.call(rbind, lapply(seq_len(k), function(p) {
  m <- colMeans(z[pattern == p, , drop = FALSE])
  data.frame(pattern = paste0("P", p), n_genes = sum(pattern == p), group = names(m), mean_z = unname(m))
}))
profiles$dose <- factor(sub("_.*", "", profiles$group), levels = dose_levels)
profiles$time <- factor(sub(".*_", "", profiles$group), levels = time_levels)
invisible(sx$output("pattern_profiles", profiles[, c("pattern", "n_genes", "dose", "time", "mean_z")], title = "Mean z-score per pattern, dose and time"))

profiles$label <- sprintf("%s (%d genes)", profiles$pattern, profiles$n_genes)
profiles$label <- factor(profiles$label, levels = unique(profiles$label[order(profiles$pattern)]))
plot <- ggplot(profiles, aes(time, mean_z, group = dose, colour = dose)) + geom_line(linewidth = 0.8) + geom_point(size = 1.4) +
  facet_wrap(~ label, ncol = 3) + scale_colour_grey(start = 0.8, end = 0.1) + geom_hline(yintercept = 0, linetype = "dotted") +
  labs(x = "Time after exposure", y = "Mean z-score of VST", colour = "TGF-b1", title = "Temporal response patterns") + theme_minimal()
invisible(sx$figure("pattern_profiles", plot, title = "Pattern profiles", width = 9, height = 5.5))

sizes <- tabulate(pattern, k)
pattern_method <- sprintf("hclust %s on 1 - correlation of dose x time mean z-scores, cut into %d", linkage, k)
sx$metric("n_clustered", nrow(genes), label = sprintf("Significant genes clustered (at most %d)", max_genes),
  definition = list(what = "Significant LRT genes clustered", filters = list(list(param = "max_genes", op = "<=", value = max_genes, column = "rank by padj")), method = pattern_method))
sx$metric("n_patterns", k, label = "Temporal patterns", definition = list(what = "Temporal patterns", filters = list(list(param = "n_patterns", op = "=", value = k)), method = pattern_method))
sx$metric("largest_pattern_size", max(sizes), label = "Genes in the largest pattern (P1)", definition = list(what = "Genes in the largest pattern", method = pattern_method))
sx$metric("smallest_pattern_size", min(sizes), label = "Genes in the smallest pattern", definition = list(what = "Genes in the smallest pattern", method = pattern_method))
sx$note(sprintf("%d genes in %d patterns (%s linkage on 1 - correlation of dose x time mean z-scores); sizes %s.", nrow(genes), k, linkage, paste(sizes, collapse = ", ")))
sx$finish()
