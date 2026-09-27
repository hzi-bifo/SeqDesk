# Step 6 - Heatmap of the pattern genes over dose and time.
#
# Inputs:  gene_patterns (step 4), vst (step 2), samples_qc (step 1)
# Params:  per_pattern  at most this many genes per pattern (smallest padj first) in the heatmap
# Outputs: figure pattern_heatmap (row z-scores of the dose x time mean VST, rows split by pattern).
# Metrics: n_heatmap_genes.
# Packages: base seqdesk-explore-r (pheatmap); no extras.
suppressPackageStartupMessages({ library(pheatmap) })

genes <- sx$input("gene_patterns")
vst <- sx$input("vst")
samples <- sx$input("samples_qc")
samples <- samples[tolower(as.character(samples$kept)) %in% c("true", "1"), , drop = FALSE]
per_pattern <- as.integer(sx$param("per_pattern", 60))

genes <- genes[order(genes$pattern, genes$padj), , drop = FALSE]
genes <- do.call(rbind, lapply(split(genes, genes$pattern), function(d) head(d, per_pattern)))
v <- as.matrix(vst[match(genes$gene_id, vst$gene_id), samples$sample, drop = FALSE])
ord <- order(samples$time, samples$dose_ng_mL)
groups <- unique(samples$group[ord])
means <- sapply(groups, function(g) rowMeans(v[, samples$group == g, drop = FALSE]))
rownames(means) <- genes$gene_id
z <- t(scale(t(means)))
z[!is.finite(z)] <- 0
col_annotation <- data.frame(row.names = groups, time = samples$time_f[match(groups, samples$group)], dose = samples$dose_f[match(groups, samples$group)])
row_annotation <- data.frame(row.names = genes$gene_id, pattern = genes$pattern)
gaps <- cumsum(table(genes$pattern))
sx$figure("pattern_heatmap", function() pheatmap(z, cluster_rows = FALSE, cluster_cols = FALSE, gaps_row = gaps[-length(gaps)], gaps_col = which(diff(as.integer(factor(col_annotation$time))) != 0),
  annotation_col = col_annotation, annotation_row = row_annotation, show_rownames = FALSE, color = colorRampPalette(c("#2b2b2b", "#f7f7f7", "#b2182b"))(99),
  main = sprintf("Pattern genes (top %d per pattern), row z-score of mean VST", per_pattern), silent = FALSE), title = "Pattern heatmap", width = 7.5, height = 8)
sx$metric("n_heatmap_genes", nrow(genes), label = sprintf("Genes in the heatmap (at most %d per pattern)", per_pattern),
  definition = list(what = "Genes in the heatmap", filters = list(list(param = "per_pattern", op = "<=", value = per_pattern, column = "genes per pattern, by padj")), method = "pheatmap, row z-score of mean VST"))
sx$finish()
