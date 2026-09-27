# Step 2 - Normalise (DESeq2 VST, plus edgeR TMM factors for reference) and PCA.
#
# Inputs:  counts_filtered, samples_qc (from step 1)
# Params:  colour_by, shape_by   sample-sheet columns for the PCA plot
#          n_top_genes           most variable genes used for the PCA
# Outputs: pca (sample coordinates), size_factors, figure pca.
# Packages: base seqdesk-explore-r (DESeq2, edgeR, ggplot2); no extras.
suppressPackageStartupMessages({ library(DESeq2); library(edgeR); library(ggplot2) })

counts <- sx$input("counts_filtered")
samples <- sx$input("samples_qc")
samples <- samples[tolower(as.character(samples$kept)) %in% c("true", "1"), , drop = FALSE]
colour_by <- as.character(sx$param("colour_by", "dex"))
shape_by <- as.character(sx$param("shape_by", "cell"))
annot <- unique(c(colour_by, shape_by)[nzchar(c(colour_by, shape_by))])
n_top <- as.integer(sx$param("n_top_genes", 500))

mat <- round(as.matrix(counts[, samples$sample, drop = FALSE]))
rownames(mat) <- counts$gene_id
dds <- DESeqDataSetFromMatrix(mat, data.frame(row.names = samples$sample, samples[, annot, drop = FALSE]), design = ~ 1)
vsd <- vst(dds, blind = TRUE)
tmm <- calcNormFactors(DGEList(mat), method = "TMM")

v <- assay(vsd)
top <- head(order(apply(v, 1, var), decreasing = TRUE), n_top)
pc <- prcomp(t(v[top, ]))
pct <- round(100 * pc$sdev^2 / sum(pc$sdev^2), 1)
coords <- data.frame(sample = rownames(pc$x), PC1 = pc$x[, 1], PC2 = pc$x[, 2], samples[match(rownames(pc$x), samples$sample), annot, drop = FALSE], check.names = FALSE)
invisible(sx$output("pca", coords, title = "PCA coordinates", roles = list(sample = "sample")))
invisible(sx$output("size_factors", data.frame(sample = colnames(mat), deseq2_size_factor = sizeFactors(estimateSizeFactors(dds)), tmm_norm_factor = tmm$samples$norm.factors), title = "Normalisation factors", roles = list(sample = "sample")))

mapping <- if (nzchar(shape_by)) aes(PC1, PC2, colour = .data[[colour_by]], shape = .data[[shape_by]]) else aes(PC1, PC2, colour = .data[[colour_by]])
plot <- ggplot(coords, mapping) + geom_point(size = 3) +
  labs(x = sprintf("PC1 (%.1f%%)", pct[1]), y = sprintf("PC2 (%.1f%%)", pct[2]), title = sprintf("PCA of VST counts, top %d variable genes", n_top)) + theme_minimal()
invisible(sx$figure("pca", plot, title = "PCA"))
sx$metric("pc1_variance_pct", pct[1], label = "Variance explained by PC1", unit = "%")
sx$metric("pc2_variance_pct", pct[2], label = "Variance explained by PC2", unit = "%")
sx$finish()
