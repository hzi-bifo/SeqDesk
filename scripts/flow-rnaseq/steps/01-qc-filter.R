# Step 1 - Sample QC and low-count filter.
#
# Inputs:  counts  (wide: gene_id + one integer column per sample)
#          samples (one row per sample: sample, cell, dex, ...)
# Params:  min_library_size   drop samples whose total count is below this
#          group_column       sample-sheet column that defines the groups for filterByExpr
#          min_count          edgeR::filterByExpr min.count
#          min_total_count    edgeR::filterByExpr min.total.count
# Outputs: samples_qc (sample sheet + library_size + kept), counts_filtered,
#          figure library_sizes.
# Packages: base seqdesk-explore-r (edgeR, ggplot2, jsonlite); no extras.
suppressPackageStartupMessages({ library(edgeR); library(ggplot2) })

counts <- sx$input("counts")
samples <- sx$input("samples")
min_lib <- as.numeric(sx$param("min_library_size", 5e6))
group_column <- as.character(sx$param("group_column", "dex"))
min_count <- as.numeric(sx$param("min_count", 10))
min_total <- as.numeric(sx$param("min_total_count", 15))

sample_ids <- as.character(samples$sample)
missing <- setdiff(sample_ids, names(counts))
if (length(missing)) stop("Samples without a counts column: ", paste(missing, collapse = ", "))
mat <- as.matrix(counts[, sample_ids, drop = FALSE])
storage.mode(mat) <- "double"
rownames(mat) <- counts$gene_id

samples$library_size <- colSums(mat)
samples$kept <- samples$library_size >= min_lib
dropped <- samples[!samples$kept, , drop = FALSE]
if (nrow(dropped)) sx$drop(dropped$sample, sprintf("library size below %s reads", format(min_lib, big.mark = ",")), input = "samples")
kept_ids <- samples$sample[samples$kept]
if (length(kept_ids) < 4) stop("Fewer than 4 samples pass the library-size threshold.")

groups <- factor(samples[[group_column]][samples$kept])
keep <- filterByExpr(DGEList(mat[, kept_ids, drop = FALSE]), group = groups, min.count = min_count, min.total.count = min_total)
sx$drop(sum(!keep), sprintf("edgeR filterByExpr (min.count %s, min.total.count %s, group %s)", min_count, min_total, group_column), input = "counts")

filtered <- data.frame(gene_id = rownames(mat)[keep], mat[keep, kept_ids, drop = FALSE], check.names = FALSE)
invisible(sx$output("counts_filtered", filtered, title = "Filtered counts", description = "Genes passing filterByExpr, samples passing the library-size threshold."))
invisible(sx$output("samples_qc", samples, title = "Samples after QC", roles = list(sample = "sample", group = group_column)))

plot <- ggplot(samples, aes(x = reorder(sample, library_size), y = library_size / 1e6, fill = kept)) +
  geom_col() + geom_hline(yintercept = min_lib / 1e6, linetype = "dashed") + coord_flip() +
  scale_fill_manual(values = c(`TRUE` = "grey35", `FALSE` = "firebrick")) +
  labs(x = NULL, y = "Library size (million reads)", fill = "Kept", title = "Library sizes") + theme_minimal()
invisible(sx$figure("library_sizes", plot, title = "Library size per sample"))

sx$metric("n_samples", nrow(samples), label = "Samples in the sheet")
sx$metric("n_samples_kept", length(kept_ids), label = sprintf("Samples with library size >= %s", format(min_lib, scientific = FALSE)),
  definition = list(what = "Samples kept", filters = list(list(param = "min_library_size", op = ">=", value = min_lib, column = "library size"))))
sx$metric("n_genes_in", nrow(mat), label = "Genes in the counts table")
sx$metric("n_genes_kept", sum(keep), label = sprintf("Genes kept by filterByExpr (min.count %s)", min_count),
  definition = list(what = "Genes kept", method = paste("edgeR filterByExpr", as.character(packageVersion("edgeR"))),
    filters = list(list(param = "min_count", op = ">=", value = min_count, column = "min.count"), list(param = "min_total_count", op = ">=", value = min_total, column = "min.total.count"))))
sx$note(sprintf("%d of %d samples kept; %d of %d genes pass filterByExpr.", length(kept_ids), nrow(samples), sum(keep), nrow(mat)))
sx$finish()
