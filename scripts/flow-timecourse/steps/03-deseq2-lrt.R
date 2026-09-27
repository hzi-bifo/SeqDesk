# Step 3 - DESeq2 likelihood-ratio test: does the TGF-b1 dose response change over time?
#
# Inputs:  counts_filtered, samples_qc (step 1)
# Params:  full         full model over samples_qc columns (~ dose_f + time_f + dose_f:time_f)
#          reduced      reduced model (~ dose_f + time_f): the LRT tests the terms the reduced model drops
#          padj_cutoff  a gene is significant when padj < padj_cutoff
#          fixed_size_factors  true: the input is already size-factor normalised, so size factors are set to 1
# Outputs: lrt_results (every tested gene: baseMean, LRT stat, pvalue, padj, significant), lrt_definition,
#          figure pvalue_histogram.
# Metrics: n_tested (padj defined), n_significant (padj < padj_cutoff), padj_cutoff echoed.
# Packages: base seqdesk-explore-r (DESeq2, ggplot2); no extras.
# Limitation: the Zenodo matrix holds normalised (non-integer) counts; they are rounded. The authors' raw counts
# are not in the record, so dispersion estimates are approximate and the step says so in its definition.
suppressPackageStartupMessages({ library(DESeq2); library(ggplot2) })

counts <- sx$input("counts_filtered")
samples <- sx$input("samples_qc")
samples <- samples[tolower(as.character(samples$kept)) %in% c("true", "1"), , drop = FALSE]
full_text <- as.character(sx$param("full", "~ dose_f + time_f + dose_f:time_f"))
reduced_text <- as.character(sx$param("reduced", "~ dose_f + time_f"))
padj_cutoff <- as.numeric(sx$param("padj_cutoff", 0.01))
fixed <- isTRUE(as.logical(sx$param("fixed_size_factors", TRUE)))

mat <- round(as.matrix(counts[, samples$sample, drop = FALSE]))
rownames(mat) <- counts$gene_id
full <- stats::as.formula(full_text)
reduced <- stats::as.formula(reduced_text)
coldata <- data.frame(row.names = samples$sample, samples[, unique(c(all.vars(full), all.vars(reduced))), drop = FALSE])
for (column in names(coldata)) coldata[[column]] <- factor(coldata[[column]], levels = unique(as.character(samples[[column]][order(as.numeric(sub("\\D+$", "", as.character(samples[[column]]))))])))
dds <- DESeqDataSetFromMatrix(mat, coldata, design = full)
if (fixed) sizeFactors(dds) <- rep(1, ncol(dds))
dds <- DESeq(dds, test = "LRT", reduced = reduced, quiet = TRUE)
res <- results(dds, alpha = padj_cutoff)
out <- data.frame(gene_id = rownames(res), baseMean = res$baseMean, stat = res$stat, pvalue = res$pvalue, padj = res$padj, check.names = FALSE)
out$significant <- !is.na(out$padj) & out$padj < padj_cutoff
out <- out[order(out$padj, -out$stat, na.last = TRUE), ]
invisible(sx$output("lrt_results", out, title = sprintf("DESeq2 LRT %s vs %s", full_text, reduced_text)))

n_tested <- sum(!is.na(out$padj))
n_sig <- sum(out$significant)
method <- paste("DESeq2", as.character(packageVersion("DESeq2")))
invisible(sx$output("lrt_definition", data.frame(full = full_text, reduced = reduced_text, test = "DESeq2 LRT, BH-adjusted (independent filtering on)",
  padj_rule = sprintf("padj < %s", padj_cutoff), size_factors = if (fixed) "fixed at 1 (input already normalised; values rounded)" else "DESeq2 median of ratios",
  deseq2_version = as.character(packageVersion("DESeq2")), padj_cutoff = padj_cutoff), title = "Definition of the LRT counts"))
test_words <- sprintf("LRT %s vs %s", full_text, reduced_text)
sx$metric("n_tested", n_tested, label = "Genes tested (padj defined)", definition = list(what = "Genes tested (padj defined)", test = test_words, method = method))
sx$metric("n_significant", n_sig, label = sprintf("Genes with a time-dependent dose response (LRT padj < %s)", padj_cutoff),
  definition = list(what = "Genes whose TGF-b1 dose response changes with time", contrast = "dose x time interaction",
    filters = list(list(param = "padj_cutoff", op = "<", value = padj_cutoff, column = "padj")), test = test_words, method = method))
sx$metric("padj_cutoff", padj_cutoff, label = "padj cutoff used for n_significant")

plot <- ggplot(out[!is.na(out$pvalue), ], aes(pvalue)) + geom_histogram(breaks = seq(0, 1, 0.02), fill = "grey40") +
  labs(x = "LRT p-value", y = "Genes", title = sprintf("%d of %d genes significant (padj < %s)", n_sig, n_tested, padj_cutoff)) + theme_minimal()
invisible(sx$figure("pvalue_histogram", plot, title = "LRT p-value histogram"))
sx$note(sprintf("%d of %d tested genes change their TGF-b1 dose response over time (%s, padj < %s).", n_sig, n_tested, test_words, padj_cutoff))
sx$finish()
