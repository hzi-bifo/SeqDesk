# testthat tests for the R helper. Run with:
#   Rscript -e 'testthat::test_dir("explore/lib/r/tests")'
library(testthat)

# testthat runs tests from their own directory; the repository root works too.
candidates <- c(file.path("..", "seqdesk.explore", "R", "sx.R"), file.path("explore", "lib", "r", "seqdesk.explore", "R", "sx.R"))
helper_file <- normalizePath(Filter(file.exists, candidates)[[1]], mustWork = TRUE)
source(helper_file, local = TRUE)

write_run <- function(dir, alias = "counts") {
  dir.create(file.path(dir, "inputs"), recursive = TRUE)
  writeLines(c("gene\tsample_1\treads\tpassed", "g1\t1\t5\ttrue", "g2\t2\t50\tfalse", "g3\t\t500\t"), file.path(dir, "inputs", paste0(alias, ".tsv")))
  schema <- list(schema = list(columns = list(
    list(key = "gene", label = "Gene", type = "string"),
    list(key = "sample_1", label = "Sample 1", type = "number"),
    list(key = "reads", label = "Reads", type = "number"),
    list(key = "passed", label = "Passed", type = "boolean"))))
  jsonlite::write_json(schema, file.path(dir, "inputs", paste0(alias, ".schema.json")), auto_unbox = TRUE)
  inputs <- list(inputs = setNames(list(list(path = paste0("inputs/", alias, ".tsv"), schemaPath = paste0("inputs/", alias, ".schema.json"),
    roles = list(taxon_id = "gene"), datasetId = "ds1", versionId = "v1", rowCount = 3)), alias),
    params = list(min_count = 10), outputDir = "outputs")
  jsonlite::write_json(inputs, file.path(dir, "inputs.json"), auto_unbox = TRUE)
  dir
}

new_run <- function() {
  dir <- tempfile("sxrun")
  dir.create(dir)
  write_run(dir)
  helper <- seqdesk_explore()
  helper$set_run_dir(dir)
  list(dir = dir, sx = helper)
}

test_that("input reads types and roles from the schema", {
  run <- new_run()
  df <- run$sx$input("counts")
  expect_equal(nrow(df), 3)
  expect_true(is.numeric(df$reads))
  expect_equal(df$passed, c(TRUE, FALSE, NA))
  expect_true(is.na(df$sample_1[3]))
  expect_equal(run$sx$role_column(df, "taxon_id"), "gene")
  expect_equal(run$sx$param("min_count", 1), 10)
  expect_equal(run$sx$param("absent", "x"), "x")
})

test_that("output, drop, metric and note write the same manifest as the Python helper", {
  run <- new_run()
  sx <- run$sx
  counts <- sx$input("counts")
  low <- counts[counts$reads < sx$param("min_count"), ]
  entry <- sx$drop(low, "fewer than 10 reads", input = "counts")
  expect_equal(entry$count, 1L)
  sx$drop(c("sample_1"), "not needed", input = "counts", axis = "columns")
  sx$drop(5, "counted")
  kept <- counts[counts$reads >= 10, ]
  artifact <- sx$output("filtered", kept, title = "Filtered", roles = list(taxon_id = "gene"))
  expect_equal(artifact$path, "outputs/filtered.tsv")
  expect_equal(artifact$table$rowCount, 2)
  expect_equal(artifact$table$colCount, 4)
  sx$metric("n_kept", nrow(kept), label = "Genes kept")
  sx$metric("fdr", 0.05)
  sx$note("hello")
  sx$save_report_markdown("# Done", "summary")
  sx$finish()
  manifest <- jsonlite::fromJSON(file.path(run$dir, "outputs", "manifest.json"), simplifyVector = FALSE)
  expect_equal(manifest$manifestVersion, 1)
  expect_equal(manifest$language, "r")
  expect_equal(vapply(manifest$artifacts, function(a) a$name, ""), c("filtered", "summary"))
  expect_equal(manifest$metrics$n_kept, 2)
  expect_equal(manifest$metricMeta$n_kept$label, "Genes kept")
  expect_equal(manifest$notes, list("hello"))
  expect_equal(length(manifest$drops), 3)
  expect_equal(manifest$drops[[1]]$keys, list("g1"))
  expect_equal(manifest$drops[[1]]$reason, "fewer than 10 reads")
  expect_equal(manifest$drops[[2]]$axis, "columns")
  expect_equal(manifest$drops[[3]]$input, "counts")
  lines <- readLines(file.path(run$dir, "outputs", "filtered.tsv"))
  expect_equal(lines[1], "gene\tsample_1\treads\tpassed")
  expect_equal(lines[2], "g2\t2\t50\tfalse")
  expect_equal(lines[3], "g3\t\t500\t")
})

test_that("figures from a drawing function become PNG files", {
  run <- new_run()
  figures <- run$sx$figure("hist", function() graphics::plot(1:3))
  expect_true(length(figures) >= 1)
  expect_true(file.exists(file.path(run$dir, "outputs", "hist.png")))
  expect_error(run$sx$figure("bad", 42), "expects a ggplot")
})

test_that("an empty metric object and empty drops serialise as {} and []", {
  run <- new_run()
  run$sx$finish()
  text <- paste(readLines(file.path(run$dir, "outputs", "manifest.json")), collapse = "\n")
  expect_match(text, '"metrics": \\{\\}')
  expect_match(text, '"drops": \\[\\]')
})

test_that("drop refuses empty reasons and bare booleans", {
  run <- new_run()
  expect_error(run$sx$drop(1, "  "), "needs a reason")
  expect_error(run$sx$drop(TRUE, "x"), "not TRUE/FALSE")
})

test_that("the manifest is written when R exits without finish()", {
  skip_if(Sys.which("Rscript") == "", "Rscript is not installed")
  dir <- tempfile("sxexit")
  dir.create(dir)
  write_run(dir)
  script <- file.path(dir, "analysis.R")
  writeLines(c("sx$metric('n', 3)", "sx$output('t', sx$input('counts'))"), script)
  lib <- normalizePath(file.path(dirname(helper_file), "..", ".."))
  status <- system2("Rscript", c(script, "--run-dir", dir), env = c(paste0("R_PROFILE_USER=", file.path(lib, "profile.R")), paste0("SEQDESK_EXPLORE_R_LIB=", lib)), stdout = TRUE, stderr = TRUE)
  manifest <- jsonlite::fromJSON(file.path(dir, "outputs", "manifest.json"), simplifyVector = FALSE)
  expect_equal(manifest$metrics$n, 3)
  expect_equal(manifest$artifacts[[1]]$name, "t")
})

test_that("a metric can carry a structured definition", {
  run <- new_run()
  sx <- run$sx
  sx$metric("n_de", 925, label = "DE genes", definition = list(what = "DE genes", contrast = "trt vs untrt", method = "DESeq2 1.50.2",
    filters = list(list(param = "padj_cutoff", op = "<", value = 0.05, column = "padj"), list(param = "lfc_cutoff", op = "|x| >=", value = 1))))
  sx$metric("one", 1, definition = list(filters = list(param = "fdr", op = "<", value = 0.1)))
  expect_error(sx$metric("bad", 1, definition = list(filters = list(list(param = "x")))), "param, op and value")
  sx$finish()
  manifest <- jsonlite::fromJSON(file.path(run$dir, "outputs", "manifest.json"), simplifyVector = FALSE)
  definition <- manifest$metricMeta$n_de$definition
  expect_equal(definition$contrast, "trt vs untrt")
  expect_equal(length(definition$filters), 2)
  expect_equal(definition$filters[[2]]$op, "|x| >=")
  expect_equal(definition$filters[[1]]$value, 0.05)
  expect_equal(length(manifest$metricMeta$one$definition$filters), 1)
  expect_equal(manifest$metricMeta$one$definition$filters[[1]]$param, "fdr")
})

test_that("metric warns about a missing label and suggests a definition for filter params", {
  run <- new_run()
  sx <- run$sx
  expect_message(sx$metric("n_min_count", 3), 'has no label')
  expect_message(sx$metric("n_kept", 3, label = "Genes over min count"), 'mentions min_count')
  expect_silent(sx$metric("n_kept2", 3, label = "Genes kept", definition = list(what = "Genes")))
  hints <- sx$metric_hints("n_de", "DE genes by padj", NULL, list(padj_cutoff = 0.05, lfc_cutoff = 1))
  expect_length(hints, 1)
  expect_match(hints, 'param = "padj_cutoff", op = "<", value = 0.05', fixed = TRUE)
  expect_false(grepl("lfc_cutoff", hints))
})

test_that("a value that is the cutoff itself gets no definition hint", {
  sx <- seqdesk_explore()
  expect_length(sx$metric_hints("padj_cutoff", "padj cutoff used", NULL, list(padj_cutoff = 0.05)), 0)
})
