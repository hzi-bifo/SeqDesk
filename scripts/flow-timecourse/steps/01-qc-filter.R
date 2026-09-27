# Step 1 - Match samples to the matrix, drop low-RIN samples, filter genes.
#
# Inputs:  counts  (Zenodo 15152686 normalized_counts_TGFB1: row_name = Ensembl gene, one column per sample TR1..TR48;
#                   the authors' size-factor-normalised counts, so values are not integers)
#          samples (Phenodata_TGFB1: sample_ID, dose_ng_mL, time, replicates, condition, RIN)
# Params:  sample_column   sample-sheet column naming the matrix columns
#          min_rin         drop samples with RNA integrity below this
#          min_count       edgeR::filterByExpr min.count (applied to the normalised values)
#          min_total_count edgeR::filterByExpr min.total.count
# Outputs: samples_qc (sheet + dose_f, time_f, group, in_matrix, kept, reason), counts_filtered (gene_id + kept samples),
#          figure sample_depth.
# Metrics: n_samples_sheet, n_samples_kept, n_genes_input, n_genes_kept.
# Packages: base seqdesk-explore-r (edgeR, ggplot2); no extras.
suppressPackageStartupMessages({ library(edgeR); library(ggplot2) })

counts <- sx$input("counts")
samples <- sx$input("samples")
sample_column <- as.character(sx$param("sample_column", "sample_ID"))
min_rin <- as.numeric(sx$param("min_rin", 7))
min_count <- as.numeric(sx$param("min_count", 10))
min_total <- as.numeric(sx$param("min_total_count", 15))

gene_column <- if ("row_name" %in% names(counts)) "row_name" else names(counts)[1]
samples$sample <- as.character(samples[[sample_column]])
samples <- samples[order(as.numeric(sub("\\D+", "", samples$sample))), , drop = FALSE]
samples$dose_f <- factor(paste0(samples$dose_ng_mL, "ng"), levels = paste0(sort(unique(samples$dose_ng_mL)), "ng"))
samples$time_f <- factor(paste0(samples$time, "h"), levels = paste0(sort(unique(samples$time)), "h"))
samples$group <- paste(samples$dose_f, samples$time_f, sep = "_")
samples$in_matrix <- samples$sample %in% names(counts)
samples$kept <- samples$in_matrix & samples$RIN >= min_rin
samples$reason <- ifelse(!samples$in_matrix, "not in the count matrix", ifelse(samples$RIN < min_rin, sprintf("RIN %.1f < %s", samples$RIN, min_rin), ""))

kept <- samples[samples$kept, , drop = FALSE]
mat <- as.matrix(counts[, kept$sample, drop = FALSE])
storage.mode(mat) <- "double"
rownames(mat) <- counts[[gene_column]]
mat[is.na(mat)] <- 0
keep <- filterByExpr(DGEList(mat), group = kept$group, min.count = min_count, min.total.count = min_total)
filtered <- data.frame(gene_id = rownames(mat)[keep], mat[keep, , drop = FALSE], check.names = FALSE)
samples$depth <- NA_real_
samples$depth[samples$kept] <- colSums(mat)

invisible(sx$output("samples_qc", samples[, c("sample", "dose_ng_mL", "time", "replicates", "condition", "RIN", "dose_f", "time_f", "group", "in_matrix", "kept", "reason", "depth")],
  title = "Sample sheet after QC", roles = list(sample = "sample", group = "group")))
invisible(sx$output("counts_filtered", filtered, title = sprintf("%d genes x %d samples after filterByExpr", nrow(filtered), nrow(kept))))

plot_data <- samples[samples$kept, , drop = FALSE]
plot <- ggplot(plot_data, aes(reorder(sample, depth), depth / 1e6, fill = dose_f)) + geom_col() + facet_grid(~ time_f, scales = "free_x", space = "free_x") +
  scale_fill_grey(start = 0.8, end = 0.2) + labs(x = NULL, y = "Sum of normalised counts (millions)", fill = "TGF-b1", title = "Normalised depth per sample") +
  theme_minimal() + theme(axis.text.x = element_text(angle = 90, size = 6))
invisible(sx$figure("sample_depth", plot, title = "Depth per sample", width = 9))

sx$metric("n_samples_sheet", nrow(samples), label = "Samples in the sample sheet",
  definition = list(what = "Samples in the sample sheet", method = "rows of Phenodata_TGFB1.xlsx"))
sx$metric("n_samples_kept", nrow(kept), label = sprintf("Samples kept (in the matrix, RIN >= %s)", min_rin),
  definition = list(what = "Samples kept", filters = list(list(param = "min_rin", op = ">=", value = min_rin, column = "RIN")), method = "present as a matrix column"))
sx$metric("n_genes_input", nrow(mat), label = "Genes in the downloaded matrix",
  definition = list(what = "Genes in the downloaded matrix", method = "rows of normalized_counts_TGFB1.txt"))
sx$metric("n_genes_kept", nrow(filtered), label = "Genes kept by filterByExpr",
  definition = list(what = "Genes kept", filters = list(list(param = "min_count", op = ">=", value = min_count, column = "count"), list(param = "min_total_count", op = ">=", value = min_total, column = "total count")),
    method = paste("edgeR", as.character(packageVersion("edgeR")), "filterByExpr, group = dose x time")))
dropped <- samples[!samples$kept, , drop = FALSE]
sx$note(sprintf("%d of %d samples kept%s; %d of %d genes pass filterByExpr.", nrow(kept), nrow(samples),
  if (nrow(dropped)) paste0(" (dropped: ", paste(sprintf("%s, %s", dropped$sample, dropped$reason), collapse = "; "), ")") else "", nrow(filtered), nrow(mat)))
sx$finish()
