# Step 3 - DESeq2 contrast, treated vs untreated.
#
# Inputs:  counts_filtered, samples_qc (from step 1)
# Params:  design           model formula over sample-sheet columns (airway: ~ cell + dex)
#          factor           the contrast factor (dex)
#          numerator        level tested (trt)
#          denominator      reference level (untrt)
#          padj_cutoff      a gene is DE when padj <  padj_cutoff ...
#          lfc_cutoff       ... and |log2FoldChange| >= lfc_cutoff (unshrunken MLE, post-hoc)
# Outputs: de_results (every gene of counts_filtered; padj empty where DESeq2
#          set it NA), de_definition (one row: how n_tested/n_de/n_up/n_down
#          are defined), figure volcano.
# Metrics: n_tested = rows with a non-missing padj
#          n_de     = rows with padj < padj_cutoff and |log2FoldChange| >= lfc_cutoff
#          n_up     = n_de with log2FoldChange > 0 (higher in numerator)
#          n_down   = n_de with log2FoldChange < 0
#          plus padj_cutoff and lfc_cutoff echoed as metrics, so a cited value
#          carries its definition in the same run record.
# Packages: base seqdesk-explore-r (DESeq2, ggplot2); no extras.
suppressPackageStartupMessages({ library(DESeq2); library(ggplot2) })

counts <- sx$input("counts_filtered")
samples <- sx$input("samples_qc")
samples <- samples[tolower(as.character(samples$kept)) %in% c("true", "1"), , drop = FALSE]
design_text <- as.character(sx$param("design", "~ cell + dex"))
factor_name <- as.character(sx$param("factor", "dex"))
numerator <- as.character(sx$param("numerator", "trt"))
denominator <- as.character(sx$param("denominator", "untrt"))
padj_cutoff <- as.numeric(sx$param("padj_cutoff", 0.05))
lfc_cutoff <- as.numeric(sx$param("lfc_cutoff", 1))

mat <- round(as.matrix(counts[, samples$sample, drop = FALSE]))
rownames(mat) <- counts$gene_id
design <- stats::as.formula(design_text)
coldata <- data.frame(row.names = samples$sample, samples[, all.vars(design), drop = FALSE])
for (column in names(coldata)) coldata[[column]] <- factor(coldata[[column]])
coldata[[factor_name]] <- relevel(coldata[[factor_name]], ref = denominator)

dds <- DESeq(DESeqDataSetFromMatrix(mat, coldata, design = design), quiet = TRUE)
res <- results(dds, contrast = c(factor_name, numerator, denominator), alpha = padj_cutoff)
out <- data.frame(gene_id = rownames(res), baseMean = res$baseMean, log2FoldChange = res$log2FoldChange, lfcSE = res$lfcSE, stat = res$stat, pvalue = res$pvalue, padj = res$padj, check.names = FALSE)
is_de <- !is.na(out$padj) & out$padj < padj_cutoff & abs(out$log2FoldChange) >= lfc_cutoff
out$direction <- ifelse(is_de & out$log2FoldChange > 0, "up", ifelse(is_de & out$log2FoldChange < 0, "down", "ns"))
out <- out[order(out$padj, na.last = TRUE), ]
invisible(sx$output("de_results", out, title = sprintf("DESeq2 %s: %s vs %s", factor_name, numerator, denominator)))

contrast_text <- sprintf("%s: %s vs %s", factor_name, numerator, denominator)
definition <- data.frame(
  contrast = contrast_text, design = design_text, test = "DESeq2 Wald, BH-adjusted (independent filtering on), lfcThreshold 0",
  padj_rule = sprintf("padj < %s", padj_cutoff), lfc_rule = sprintf("|log2FoldChange| >= %s (MLE, unshrunken)", lfc_cutoff),
  n_tested_rule = "padj not missing", deseq2_version = as.character(packageVersion("DESeq2")),
  padj_cutoff = padj_cutoff, lfc_cutoff = lfc_cutoff)
invisible(sx$output("de_definition", definition, title = "Definition of the DE counts"))

n_tested <- sum(!is.na(out$padj))
n_up <- sum(out$direction == "up")
n_down <- sum(out$direction == "down")
short <- sprintf("%s vs %s, padj<%s, |LFC|>=%s", numerator, denominator, padj_cutoff, lfc_cutoff)
sx$metric("n_tested", n_tested, label = sprintf("Genes tested (padj defined), %s", contrast_text))
sx$metric("n_de", n_up + n_down, label = paste("DE genes,", short))
sx$metric("n_up", n_up, label = paste("Up in", numerator, "-", short))
sx$metric("n_down", n_down, label = paste("Down in", numerator, "-", short))
sx$metric("padj_cutoff", padj_cutoff, label = "padj cutoff used for n_de")
sx$metric("lfc_cutoff", lfc_cutoff, label = "|log2FC| cutoff used for n_de")

plot_data <- out[!is.na(out$padj), ]
plot <- ggplot(plot_data, aes(log2FoldChange, -log10(pmax(padj, 1e-300)), colour = direction)) + geom_point(size = 0.6, alpha = 0.6) +
  geom_vline(xintercept = c(-lfc_cutoff, lfc_cutoff), linetype = "dashed") + geom_hline(yintercept = -log10(padj_cutoff), linetype = "dashed") +
  scale_colour_manual(values = c(up = "firebrick", down = "grey20", ns = "grey75")) +
  labs(x = sprintf("log2 fold change (%s / %s)", numerator, denominator), y = "-log10 padj", title = sprintf("%s: %d up, %d down", contrast_text, n_up, n_down)) + theme_minimal()
invisible(sx$figure("volcano", plot, title = "Volcano plot"))
sx$note(sprintf("%d of %d tested genes are DE (%s): %d up, %d down.", n_up + n_down, n_tested, short, n_up, n_down))
sx$finish()
