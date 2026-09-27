# Step 5 - What biology does each pattern carry? GO Biological Process over-representation per pattern.
#
# Inputs:  gene_patterns (step 4), lrt_results (step 3; every tested gene is the universe),
#          go_sets (Data > Resources: GO BP gene-set table go-bp-human, one row per term with its Ensembl genes,
#          ancestors included; built by SeqDesk from Bioconductor 3.22 org.Hs.eg.db/GO.db, CC BY 4.0, pinned version)
# Params:  min_size, max_size  GO sets (mapped to the universe) with this many genes are tested
#          padj_cutoff         a term is enriched when its BH padj < padj_cutoff
#          n_show              top terms per pattern in the figure
# Outputs: go_enrichment (pattern, term, name, overlap, size, pval, padj), figure go_dotplot.
# Metrics: n_sets_tested, n_enriched_terms (all patterns), n_patterns_with_terms.
# Packages: base seqdesk-explore-r (fgsea, ggplot2) only; the gene sets come in as a versioned Data table instead of
#           annotation packages resolved at run time.
suppressPackageStartupMessages({ library(fgsea); library(ggplot2) })

genes <- sx$input("gene_patterns")
lrt <- sx$input("lrt_results")
go <- sx$input("go_sets")
min_size <- as.integer(sx$param("min_size", 15))
max_size <- as.integer(sx$param("max_size", 500))
padj_cutoff <- as.numeric(sx$param("padj_cutoff", 0.05))
n_show <- as.integer(sx$param("n_show", 4))

universe <- unique(lrt$gene_id[!is.na(lrt$padj)])
# Each GO BP term's genes restricted to the universe (the same sets org.Hs.eg.db GOALL gives for these genes).
sets <- lapply(strsplit(go$genes, " ", fixed = TRUE), function(members) intersect(members, universe))
names(sets) <- go$term
sets <- sets[lengths(sets) > 0]
sizes <- lengths(sets)
sets <- sets[sizes >= min_size & sizes <= max_size]

patterns <- sort(unique(genes$pattern))
res <- do.call(rbind, lapply(patterns, function(p) {
  hits <- intersect(genes$gene_id[genes$pattern == p], universe)
  r <- fora(pathways = sets, genes = hits, universe = universe, minSize = min_size, maxSize = max_size)
  if (!nrow(r)) return(NULL)
  data.frame(pattern = p, term = r$pathway, overlap = r$overlap, size = r$size, pval = r$pval, padj = r$padj, check.names = FALSE)
}))
res$name <- go$name[match(res$term, go$term)]
res <- res[order(res$pattern, res$padj, res$pval), c("pattern", "term", "name", "overlap", "size", "pval", "padj")]
enriched <- res[res$padj < padj_cutoff, , drop = FALSE]
invisible(sx$output("go_enrichment", enriched, title = sprintf("GO BP terms enriched per pattern (padj < %s)", padj_cutoff)))

show <- do.call(rbind, lapply(split(enriched, enriched$pattern), function(d) head(d, n_show)))
if (!is.null(show) && nrow(show)) {
  show$label <- ifelse(nchar(show$name) > 48, paste0(substr(show$name, 1, 46), "..."), show$name)
  show$label <- factor(show$label, levels = rev(unique(show$label)))
  plot <- ggplot(show, aes(pattern, label, size = overlap, colour = -log10(padj))) + geom_point() +
    scale_colour_gradient(low = "grey70", high = "grey5") + labs(x = "Pattern", y = NULL, size = "Genes", colour = "-log10 padj",
      title = sprintf("Top %d GO BP terms per pattern (fora, padj < %s)", n_show, padj_cutoff)) + theme_minimal() + theme(axis.text.y = element_text(size = 7))
  invisible(sx$figure("go_dotplot", plot, title = "GO enrichment per pattern", width = 8.5, height = 6.5))
}

go_table <- sx$input_info("go_sets")
method <- paste0("fgsea ", as.character(packageVersion("fgsea")), " fora; GO BP table ", go_table$name, " v", go_table$versionNumber, " (", nrow(go), " terms)")
sx$metric("n_sets_tested", length(sets), label = sprintf("GO BP sets tested (%d-%d genes in the universe)", min_size, max_size),
  definition = list(what = "GO BP sets tested", filters = list(list(param = "min_size", op = ">=", value = min_size, column = "genes in the universe"), list(param = "max_size", op = "<=", value = max_size, column = "genes in the universe")), method = method))
sx$metric("n_enriched_terms", nrow(enriched), label = sprintf("Enriched GO BP terms, all patterns (padj < %s)", padj_cutoff),
  definition = list(what = "Enriched GO BP terms summed over patterns", filters = list(list(param = "padj_cutoff", op = "<", value = padj_cutoff, column = "padj")),
    test = "hypergeometric over-representation, BH within pattern", method = method))
sx$metric("n_patterns_with_terms", length(unique(enriched$pattern)), label = "Patterns with at least one enriched term",
  definition = list(what = "Patterns with at least one enriched GO BP term", filters = list(list(param = "padj_cutoff", op = "<", value = padj_cutoff, column = "padj")), test = "hypergeometric over-representation, BH within pattern", method = method))
top <- enriched[!duplicated(enriched$pattern), ]
sx$note(paste(sprintf("%s: %s (padj %.2g)", top$pattern, top$name, top$padj), collapse = "; "))
sx$finish()
