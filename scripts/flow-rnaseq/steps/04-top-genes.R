# Step 4 - Top DE genes table and heatmap.
#
# Inputs:  de_results (step 3), counts_filtered, samples_qc (step 1)
# Params:  n_top        number of genes (smallest padj among DE genes)
#          annotate_by  sample-sheet columns shown above the heatmap
# Outputs: top_genes, figure top_genes_heatmap (row-scaled VST values).
# Packages: base seqdesk-explore-r (DESeq2, pheatmap); no extras.
suppressPackageStartupMessages({ library(DESeq2); library(pheatmap) })

de <- sx$input("de_results")
counts <- sx$input("counts_filtered")
samples <- sx$input("samples_qc")
samples <- samples[tolower(as.character(samples$kept)) %in% c("true", "1"), , drop = FALSE]
n_top <- as.integer(sx$param("n_top", 30))
annotate_by <- unlist(sx$param("annotate_by", list("dex", "cell")))

de_only <- de[de$direction %in% c("up", "down"), , drop = FALSE]
de_only <- de_only[order(de_only$padj, -abs(de_only$log2FoldChange)), , drop = FALSE]
top <- head(de_only, n_top)
invisible(sx$output("top_genes", top, title = sprintf("Top %d DE genes by padj", nrow(top))))

mat <- round(as.matrix(counts[, samples$sample, drop = FALSE]))
rownames(mat) <- counts$gene_id
v <- assay(vst(DESeqDataSetFromMatrix(mat, data.frame(row.names = samples$sample, x = rep(1, nrow(samples))), design = ~ 1), blind = TRUE))
v <- v[top$gene_id, , drop = FALSE]
annotation <- data.frame(row.names = samples$sample, samples[, annotate_by, drop = FALSE])
sx$figure("top_genes_heatmap", function() pheatmap(v, scale = "row", annotation_col = annotation, show_rownames = TRUE, fontsize_row = 6,
  main = sprintf("Top %d DE genes (row-scaled VST)", nrow(top)), silent = FALSE), title = "Top DE genes heatmap", height = 7)
sx$metric("n_top_shown", nrow(top), label = "Genes in the heatmap")
sx$finish()
