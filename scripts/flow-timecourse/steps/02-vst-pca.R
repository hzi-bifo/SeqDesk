# Step 2 - Variance-stabilise and look at the samples: do they order by dose, by time, or both?
#
# Inputs:  counts_filtered, samples_qc (step 1)
# Params:  n_top_genes  most variable genes used for the PCA
# Outputs: vst (gene_id + one VST column per kept sample; reused by the pattern and heatmap steps),
#          pca (sample coordinates), figure pca.
# Metrics: pc1_variance_pct, pc2_variance_pct.
# Packages: base seqdesk-explore-r (DESeq2, ggplot2); no extras.
# The matrix is already size-factor normalised by the authors, so the VST uses size factors fixed at 1.
suppressPackageStartupMessages({ library(DESeq2); library(ggplot2) })

counts <- sx$input("counts_filtered")
samples <- sx$input("samples_qc")
samples <- samples[tolower(as.character(samples$kept)) %in% c("true", "1"), , drop = FALSE]
n_top <- as.integer(sx$param("n_top_genes", 500))

mat <- round(as.matrix(counts[, samples$sample, drop = FALSE]))
rownames(mat) <- counts$gene_id
dds <- DESeqDataSetFromMatrix(mat, data.frame(row.names = samples$sample, x = rep(1, nrow(samples))), design = ~ 1)
sizeFactors(dds) <- rep(1, ncol(dds))
v <- assay(vst(dds, blind = TRUE))
invisible(sx$output("vst", data.frame(gene_id = rownames(v), round(v, 5), check.names = FALSE), title = "VST values (size factors 1)"))

top <- head(order(apply(v, 1, var), decreasing = TRUE), n_top)
pc <- prcomp(t(v[top, ]))
pct <- round(100 * pc$sdev^2 / sum(pc$sdev^2), 1)
meta <- samples[match(rownames(pc$x), samples$sample), ]
coords <- data.frame(sample = rownames(pc$x), PC1 = pc$x[, 1], PC2 = pc$x[, 2], dose = meta$dose_f, time = meta$time_f, check.names = FALSE)
invisible(sx$output("pca", coords, title = "PCA coordinates", roles = list(sample = "sample")))

plot <- ggplot(coords, aes(PC1, PC2, colour = dose, shape = time)) + geom_point(size = 2.6) +
  scale_colour_grey(start = 0.8, end = 0.1) +
  labs(x = sprintf("PC1 (%.1f%%)", pct[1]), y = sprintf("PC2 (%.1f%%)", pct[2]), colour = "TGF-b1", shape = "Time", title = sprintf("PCA of VST values, top %d variable genes", n_top)) + theme_minimal()
invisible(sx$figure("pca", plot, title = "PCA"))
pca_definition <- function(pc) list(what = sprintf("Variance explained by %s", pc), filters = list(list(param = "n_top_genes", op = "<=", value = n_top, column = "rank by VST variance")),
  method = paste("DESeq2", as.character(packageVersion("DESeq2")), "vst; prcomp"))
sx$metric("pc1_variance_pct", pct[1], label = "Variance explained by PC1", unit = "%", definition = pca_definition("PC1"))
sx$metric("pc2_variance_pct", pct[2], label = "Variance explained by PC2", unit = "%", definition = pca_definition("PC2"))
sx$finish()
