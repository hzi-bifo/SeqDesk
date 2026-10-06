# seqdesk.explore: the R helper for SeqDesk Flow steps.
#
# A step runs inside a prepared run folder:
#
#     Rscript analysis.R --run-dir <runDir>
#
# The folder holds inputs.json (the attached tables, their roles, the
# parameters), one TSV plus one schema file per input under inputs/, and
# receives everything the step writes under outputs/. This file reads the
# first half of that contract and writes the second half
# (outputs/manifest.json), exactly like the Python helper seqdesk_explore:
#
#     counts <- sx$input("counts")
#     keep <- counts[counts$reads >= sx$param("min_count", 10), ]
#     sx$drop(counts[counts$reads < sx$param("min_count", 10), ], "fewer than 10 reads")
#     sx$output("filtered", keep)
#     sx$metric("n_kept", nrow(keep), label = "Genes kept")
#     sx$figure("volcano", plot)   # a ggplot, a recorded plot or a function that draws
#
# The manifest is also written when R exits, so a script that never calls
# sx$finish() still leaves one behind. Only jsonlite is required; ggplot2
# and svglite are used when the figure needs them.

seqdesk_explore <- function() {
  version <- "0.2.0"
  manifest_version <- 1L
  roles_known <- c("sample", "subject", "timepoint", "group", "taxon", "taxon_id", "rank", "value", "count", "date")
  key_roles <- c("taxon_id", "taxon", "sample", "subject")
  max_drop_keys <- 20L
  max_drops <- 200L

  state <- new.env(parent = emptyenv())
  reset <- function() {
    state$run_dir <- NULL
    state$inputs <- NULL
    state$artifacts <- list()
    state$notes <- character(0)
    state$metrics <- list()
    state$metric_meta <- list()
    state$drops <- list()
    state$finished <- FALSE
    state$dirty <- FALSE
    invisible(NULL)
  }
  reset()

  fail <- function(...) stop(paste0(...), call. = FALSE)

  run_dir_from_args <- function(args) {
    for (index in seq_along(args)) {
      arg <- args[[index]]
      if (identical(arg, "--run-dir") && index < length(args)) return(args[[index + 1]])
      if (startsWith(arg, "--run-dir=")) return(substring(arg, nchar("--run-dir=") + 1))
    }
    NULL
  }

  set_run_dir <- function(path) {
    reset()
    resolved <- normalizePath(path, mustWork = FALSE)
    if (!dir.exists(resolved)) fail("Run directory does not exist: ", resolved)
    state$run_dir <- resolved
    invisible(resolved)
  }

  run_dir <- function() {
    if (!is.null(state$run_dir)) return(state$run_dir)
    candidate <- run_dir_from_args(commandArgs(trailingOnly = TRUE))
    if (is.null(candidate) && nzchar(Sys.getenv("SEQDESK_EXPLORE_RUN_DIR"))) candidate <- Sys.getenv("SEQDESK_EXPLORE_RUN_DIR")
    if (is.null(candidate) && file.exists("inputs.json")) candidate <- getwd()
    if (is.null(candidate)) fail("No run directory: pass --run-dir <dir>, set SEQDESK_EXPLORE_RUN_DIR, or run from a directory that contains inputs.json")
    resolved <- normalizePath(candidate, mustWork = FALSE)
    if (!dir.exists(resolved)) fail("Run directory does not exist: ", resolved)
    state$run_dir <- resolved
    resolved
  }

  load_inputs <- function() {
    if (!is.null(state$inputs)) return(state$inputs)
    path <- file.path(run_dir(), "inputs.json")
    if (!file.exists(path)) fail("inputs.json not found in run directory ", run_dir())
    data <- jsonlite::fromJSON(path, simplifyVector = FALSE)
    if (!is.list(data)) fail("inputs.json must contain a JSON object")
    if (is.null(data$inputs)) data$inputs <- list()
    state$inputs <- data
    data
  }

  input_info <- function(alias) {
    entries <- load_inputs()$inputs
    entry <- entries[[alias]]
    if (is.null(entry)) {
      known <- if (length(entries)) paste(sort(names(entries)), collapse = ", ") else "none"
      fail('Input "', alias, '" is not attached to this run (attached: ', known, ")")
    }
    entry
  }

  params <- function() {
    value <- load_inputs()$params
    if (is.list(value)) value else list()
  }

  param <- function(name, default = NULL) {
    value <- params()[[name]]
    if (is.null(value)) default else value
  }

  inside_run <- function(relative, alias, what) {
    if (!is.character(relative) || !nzchar(relative)) fail('inputs.json: input "', alias, '" has no ', what)
    base <- run_dir()
    path <- normalizePath(file.path(base, relative), mustWork = FALSE)
    if (!startsWith(path, paste0(base, .Platform$file.sep))) fail("inputs.json: ", what, ' of "', alias, '" points outside the run directory')
    if (!file.exists(path)) fail(what, ' of input "', alias, '" not found: ', path)
    path
  }

  file_path <- function(alias) {
    files <- load_inputs()$files
    entry <- if (is.list(files)) files[[alias]] else NULL
    if (is.null(entry)) fail('No file input named "', alias, '" is attached to this analysis')
    inside_run(entry$path, alias, "file path")
  }

  schema_columns <- function(alias) {
    entry <- input_info(alias)
    document <- jsonlite::fromJSON(inside_run(entry$schemaPath, alias, "schema file"), simplifyVector = FALSE)
    columns <- if (!is.null(document$schema$columns)) document$schema$columns else document$columns
    if (is.null(columns)) list() else columns
  }

  as_type <- function(values, type) {
    values[is.na(values)] <- ""
    if (identical(type, "number")) {
      out <- suppressWarnings(as.numeric(ifelse(values == "", NA, values)))
      return(out)
    }
    if (identical(type, "boolean")) {
      lowered <- tolower(trimws(values))
      out <- rep(NA, length(values))
      out[lowered %in% c("true", "1", "yes")] <- TRUE
      out[lowered %in% c("false", "0", "no")] <- FALSE
      return(as.logical(out))
    }
    out <- values
    out[out == ""] <- NA_character_
    out
  }

  input <- function(alias, parse_dates = FALSE) {
    entry <- input_info(alias)
    path <- inside_run(entry$path, alias, "table file")
    df <- utils::read.delim(path, sep = "\t", quote = "", colClasses = "character", na.strings = character(0),
      check.names = FALSE, comment.char = "", encoding = "UTF-8", stringsAsFactors = FALSE)
    types <- list()
    for (column in schema_columns(alias)) if (!is.null(column$key)) types[[column$key]] <- if (is.null(column$type)) "string" else column$type
    for (key in names(df)) {
      type <- if (is.null(types[[key]])) "string" else types[[key]]
      df[[key]] <- as_type(df[[key]], type)
      if (parse_dates && identical(type, "date")) df[[key]] <- as.POSIXct(df[[key]], tz = "UTC", tryFormats = c("%Y-%m-%dT%H:%M:%OSZ", "%Y-%m-%dT%H:%M:%OS", "%Y-%m-%d"), optional = TRUE)
    }
    roles <- if (is.list(entry$roles)) entry$roles[vapply(entry$roles, function(value) is.character(value) && nzchar(value), logical(1))] else list()
    attr(df, "sx_alias") <- alias
    attr(df, "sx_roles") <- roles
    attr(df, "sx_dataset_id") <- entry$datasetId
    attr(df, "sx_version_id") <- entry$versionId
    df
  }

  roles_of <- function(df) {
    roles <- attr(df, "sx_roles")
    if (is.null(roles) && !is.null(attr(df, "sx_alias"))) roles <- input_info(attr(df, "sx_alias"))$roles
    if (is.list(roles)) roles else list()
  }

  role_column <- function(df, role, required = TRUE) {
    column <- roles_of(df)[[role]]
    if (!is.null(column) && column %in% names(df)) return(column)
    if (!required) return(NULL)
    if (!is.null(column)) fail('Role "', role, '" is mapped to column "', column, '", which is not in the table')
    fail('Required role "', role, '" is not mapped for input "', if (is.null(attr(df, "sx_alias"))) "?" else attr(df, "sx_alias"), '"')
  }

  output_dir <- function() {
    base <- run_dir()
    configured <- tryCatch({ value <- load_inputs()$outputDir; if (is.character(value) && nzchar(trimws(value))) trimws(value) else "outputs" }, error = function(e) "outputs")
    target <- normalizePath(file.path(base, configured), mustWork = FALSE)
    if (identical(target, base) || !startsWith(target, paste0(base, .Platform$file.sep))) fail('outputDir "', configured, '" must be a directory inside the run directory')
    inputs_dir <- normalizePath(file.path(base, "inputs"), mustWork = FALSE)
    if (identical(target, inputs_dir) || startsWith(target, paste0(inputs_dir, .Platform$file.sep))) fail('outputDir must not be the "inputs" directory')
    dir.create(target, recursive = TRUE, showWarnings = FALSE)
    target
  }

  slug <- function(name) {
    value <- gsub("[^A-Za-z0-9._-]+", "_", trimws(name))
    value <- gsub("_+", "_", value)
    value <- gsub("^[._-]+|[._-]+$", "", value)
    value <- substr(value, 1, 80)
    if (nzchar(value)) value else "artifact"
  }

  humanize <- function(name) {
    text <- trimws(gsub("[_-]+", " ", name))
    if (!nzchar(text)) return(name)
    paste0(toupper(substr(text, 1, 1)), substr(text, 2, nchar(text)))
  }

  check_name <- function(name) {
    if (!is.character(name) || length(name) != 1 || !nzchar(trimws(name))) fail("artifact name must be a non-empty string")
    trimws(name)
  }

  target_path <- function(name, suffix) file.path(output_dir(), paste0(slug(name), suffix))

  relative_output <- function(path) {
    base <- run_dir()
    full <- normalizePath(path, mustWork = FALSE)
    substring(full, nchar(base) + 2)
  }

  register <- function(name, kind, format, path, title, description, extra = NULL) {
    artifact <- list(name = name, kind = kind, format = format, path = relative_output(path),
      title = if (is.null(title) || !nzchar(title)) humanize(name) else title,
      description = if (is.null(description) || !nzchar(description)) NULL else description)
    if (!is.null(extra)) artifact <- c(artifact, extra)
    keep <- Filter(function(existing) !(identical(existing$name, name) && identical(existing$kind, kind) && identical(existing$format, format)), state$artifacts)
    state$artifacts <- c(keep, list(artifact))
    state$dirty <- TRUE
    artifact
  }

  output <- function(name, df, title = NULL, description = NULL, table_kind = NULL, roles = NULL) {
    name <- check_name(name)
    if (!is.data.frame(df)) fail("sx$output() expects a data.frame")
    role_map <- if (is.null(roles)) list() else as.list(roles)
    missing <- names(role_map)[!vapply(role_map, function(column) column %in% names(df), logical(1))]
    if (length(missing)) fail("sx$output('", name, "'): role columns not in table: ", paste(missing, collapse = ", "))
    unknown <- setdiff(names(role_map), roles_known)
    if (length(unknown)) note(paste0('Table "', name, '" uses roles the app does not know: ', paste(sort(unknown), collapse = ", ")))
    out <- df
    for (column in names(out)) {
      values <- out[[column]]
      if (is.logical(values)) out[[column]] <- ifelse(is.na(values), NA, ifelse(values, "true", "false"))
      else if (is.factor(values)) out[[column]] <- as.character(values)
      if (is.character(out[[column]])) out[[column]] <- gsub("[\t\r\n]+", " ", out[[column]])
    }
    path <- target_path(name, ".tsv")
    utils::write.table(out, path, sep = "\t", quote = FALSE, row.names = FALSE, na = "", fileEncoding = "UTF-8")
    register(name, "table", "tsv", path, title, description,
      list(table = list(tableKind = table_kind, roles = if (length(role_map)) role_map else structure(list(), names = character(0)),
        rowCount = nrow(out), colCount = ncol(out))))
  }

  # The figure hook (lib/figure/continualfig): CONTINUALFIG=record writes a figure record next to each figure,
  # CONTINUALFIG=on (the "style" run setting) also applies the style. The hook is loaded once, when needed.
  figure_hook <- function() {
    if (!Sys.getenv("CONTINUALFIG", "off") %in% c("record", "on")) return(NULL)
    if (!is.null(state$continualfig)) return(if (isFALSE(state$continualfig)) NULL else state$continualfig)
    state$continualfig <- FALSE
    found <- tryCatch({
      if ("continualfig" %in% search()) get("cf", envir = as.environment("continualfig")) else {
        file <- file.path(Sys.getenv("CONTINUALFIG_HOME"), "r", "continualfig.R")
        env <- new.env(parent = globalenv())
        sys.source(file, envir = env)
        env$cf
      }
    }, error = function(e) { message("figure record hook not available (", conditionMessage(e), ")"); NULL })
    if (!is.null(found)) state$continualfig <- found
    found
  }

  data_summary <- function(df) {
    if (!is.data.frame(df)) return(NULL)
    numeric <- Filter(is.numeric, df)
    list(rows = nrow(df), columns = lapply(numeric, function(v) {
      v <- v[is.finite(v)]
      list(n = length(v), sum = signif(sum(v), 10), min = if (length(v)) signif(min(v), 10) else NULL, max = if (length(v)) signif(max(v), 10) else NULL)
    }))
  }

  # The plot's own data plus each layer's own data (a layer given data= no longer shows in plot$data).
  plot_data_summary <- function(plot) {
    summary <- data_summary(plot$data)
    if (is.null(summary)) summary <- list(rows = 0L, columns = list())
    layers <- lapply(plot$layers, function(layer) data_summary(layer$data))
    layers <- lapply(layers, function(entry) if (is.null(entry)) list(rows = NA_integer_, columns = list(), inherited = TRUE) else entry)
    summary$layers <- layers
    summary
  }

  write_figure_record <- function(name, plot, file, width, height) {
    tryCatch({
      cf <- figure_hook()
      record <- NULL
      if (inherits(plot, "ggplot") && !is.null(cf)) {
        original <- list(x = cf$aes_name(plot, "x"), y = cf$aes_name(plot, "y"), colour = cf$aes_name(plot, "colour"), fill = cf$aes_name(plot, "fill"))
        cf$record(plot, file, round(width * 25.4), round(height * 25.4), character(), "analysis.R", original)
        written <- file.path(cf$records, sub("\\.[a-z]+$", ".json", basename(file)))
        if (file.exists(written)) record <- jsonlite::fromJSON(written, simplifyVector = FALSE)
      }
      if (is.null(record)) record <- list(file = basename(file), tool = if (inherits(plot, "ggplot")) "ggplot2" else "grDevices", width_mm = round(width * 25.4), height_mm = round(height * 25.4), changes = list())
      record$figure <- name
      record$data_summary <- if (inherits(plot, "ggplot")) plot_data_summary(plot) else NULL
      jsonlite::write_json(record, target_path(name, ".figure.json"), auto_unbox = TRUE, pretty = TRUE, digits = NA, null = "null")
    }, error = function(e) message("figure record not written for ", name, " (", conditionMessage(e), ")"))
    invisible(NULL)
  }

  figure <- function(name, plot, title = NULL, description = NULL, width = 7, height = 5, dpi = 150) {
    name <- check_name(name)
    registered <- list()
    png_path <- target_path(name, ".png")
    svg_path <- target_path(name, ".svg")
    on.exit(if (!is.null(figure_hook())) write_figure_record(name, plot, svg_path, width, height), add = TRUE)
    if (inherits(plot, "ggplot") && identical(Sys.getenv("CONTINUALFIG"), "on") && !is.null(cf <- figure_hook())) {
      plot <- tryCatch(cf$improve(plot)$plot, error = function(e) plot)
    }
    if (inherits(plot, "ggplot")) {
      ggplot2::ggsave(png_path, plot, width = width, height = height, dpi = dpi, device = "png")
      registered[[length(registered) + 1]] <- register(name, "figure", "png", png_path, title, description)
      if (requireNamespace("svglite", quietly = TRUE)) {
        ggplot2::ggsave(svg_path, plot, width = width, height = height, device = "svg")
        registered[[length(registered) + 1]] <- register(name, "figure", "svg", svg_path, title, description)
      }
      return(invisible(registered))
    }
    draw <- if (inherits(plot, "recordedPlot")) function() grDevices::replayPlot(plot) else if (is.function(plot)) plot else NULL
    if (is.null(draw)) fail("sx$figure() expects a ggplot, a recorded plot or a function that draws, got ", class(plot)[1])
    grDevices::png(png_path, width = width, height = height, units = "in", res = dpi)
    tryCatch(draw(), finally = grDevices::dev.off())
    registered[[length(registered) + 1]] <- register(name, "figure", "png", png_path, title, description)
    if (isTRUE(capabilities("cairo"))) {
      grDevices::svg(svg_path, width = width, height = height)
      tryCatch(draw(), finally = grDevices::dev.off())
      registered[[length(registered) + 1]] <- register(name, "figure", "svg", svg_path, title, description)
    }
    invisible(registered)
  }

  save_report_markdown <- function(text, name, title = NULL, description = NULL) {
    name <- check_name(name)
    path <- target_path(name, ".md")
    writeLines(enc2utf8(as.character(text)), path, useBytes = TRUE)
    register(name, "report", "md", path, title, description)
  }

  note <- function(text) {
    message <- trimws(paste(as.character(text), collapse = " "))
    if (nzchar(message)) {
      state$notes <- c(state$notes, message)
      state$dirty <- TRUE
    }
    invisible(NULL)
  }

  json_value <- function(value) {
    if (is.null(value)) return(NULL)
    if (is.factor(value)) value <- as.character(value)
    if (length(value) == 1 && is.atomic(value)) {
      if (is.numeric(value) && !is.finite(value)) return(NULL)
      if (is.na(value)) return(NULL)
      if (inherits(value, "Date") || inherits(value, "POSIXt")) return(format(value, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"))
      return(unname(value))
    }
    if (is.atomic(value)) return(I(lapply(unname(as.list(value)), json_value)))
    if (is.list(value)) return(lapply(value, json_value))
    as.character(value)
  }

  # A structured definition of what a metric counts: list(what =, contrast =, test =, method =, unit =, label =,
  # filters = list(list(param = "padj_cutoff", op = "<", value = 0.05, column = "padj"), ...)).
  metric_definition <- function(definition) {
    if (is.null(definition)) return(NULL)
    if (!is.list(definition)) fail("metric definition must be a list")
    scalar_text <- function(x, max = 160) {
      if (is.null(x) || length(x) != 1 || is.na(x)) return(NULL)
      text <- trimws(as.character(x))
      if (!nzchar(text)) NULL else substr(text, 1, max)
    }
    out <- list()
    for (name in c("label", "unit", "what", "contrast", "test", "method")) {
      text <- scalar_text(definition[[name]])
      if (!is.null(text)) out[[name]] <- text
    }
    filters <- definition$filters
    if (!is.null(filters) && !is.null(names(filters)) && !is.null(filters$param)) filters <- list(filters)
    out$filters <- unname(lapply(Filter(Negate(is.null), filters %||% list()), function(filter) {
      if (!is.list(filter) || is.null(scalar_text(filter$param)) || is.null(scalar_text(filter$op))) fail("each metric filter needs param, op and value")
      value <- filter$value
      if (is.null(value) || length(value) != 1) fail("each metric filter needs one value")
      entry <- list(param = scalar_text(filter$param, 80), op = scalar_text(filter$op, 8), value = if (is.numeric(value)) unname(value) else scalar_text(value, 80))
      if (!is.null(scalar_text(filter$column))) entry$column <- scalar_text(filter$column, 80)
      entry
    }))
    out$filters <- I(out$filters)
    out
  }
  `%||%` <- function(a, b) if (is.null(a)) b else a

  metric <- function(key, value, label = NULL, unit = NULL, definition = NULL) {
    if (!is.character(key) || length(key) != 1 || !nzchar(trimws(key))) fail("metric key must be a non-empty string")
    key <- trimws(key)
    state$metrics[[key]] <- json_value(value)
    if (is.null(state$metrics[[key]])) state$metrics[key] <- list(NULL)
    meta <- list()
    if (!is.null(label) && nzchar(trimws(label))) meta$label <- substr(trimws(label), 1, 80)
    if (!is.null(unit) && nzchar(trimws(unit))) meta$unit <- substr(trimws(unit), 1, 80)
    if (!is.null(definition)) meta$definition <- metric_definition(definition)
    if (length(meta)) state$metric_meta[[key]] <- meta
    state$dirty <- TRUE
    for (hint in metric_hints(key, meta$label, meta$definition)) message("[seqdesk.explore] ", hint)
    invisible(NULL)
  }

  filter_param_pattern <- "(cutoff|threshold|thresh|^min_|^max_|_min$|_max$|fdr|padj|alpha|pvalue|p_value|qvalue|lfc|fold)"
  param_stop_words <- c("cutoff", "threshold", "thresh", "min", "max", "value", "level")

  # Numeric parameters of the run that look like filters (padj_cutoff, min_depth, fdr...).
  numeric_filter_params <- function() {
    chosen <- tryCatch(params(), error = function(e) list())
    keep <- Filter(function(name) {
      value <- chosen[[name]]
      is.numeric(value) && length(value) == 1 && grepl(filter_param_pattern, name, ignore.case = TRUE)
    }, names(chosen))
    chosen[keep]
  }

  # Run-log hints for a value without a label, or one that mentions a filter but has no definition.
  metric_hints <- function(key, label = NULL, definition = NULL, filter_params = NULL) {
    hints <- character(0)
    if (is.null(label) || !nzchar(label)) hints <- c(hints, sprintf('value "%s" has no label; pass label = so readers know what it counts', key))
    if (!is.null(definition)) return(hints)
    candidates <- if (is.null(filter_params)) numeric_filter_params() else filter_params
    words <- setdiff(strsplit(tolower(paste(key, label %||% "")), "[^a-z0-9]+")[[1]], "")
    mentioned <- Filter(function(name) {
      if (identical(tolower(name), tolower(key))) return(FALSE)  # the value is the cutoff itself
      tokens <- setdiff(strsplit(tolower(name), "[^a-z0-9]+")[[1]], c("", param_stop_words))
      length(intersect(tokens, words)) > 0
    }, names(candidates))
    if (length(mentioned)) {
      filters <- paste(vapply(mentioned, function(name) sprintf('list(param = "%s", op = "<", value = %s)', name, format(candidates[[name]])), ""), collapse = ", ")
      hints <- c(hints, sprintf('value "%s" mentions %s but has no definition; suggested: definition = list(what = "%s", filters = list(%s))',
        key, paste(mentioned, collapse = ", "), label %||% key, filters))
    }
    hints
  }

  drop_keys <- function(rows, axis) {
    alias <- attr(rows, "sx_alias")
    if (is.data.frame(rows)) {
      if (identical(axis, "columns")) return(list(count = ncol(rows), keys = utils::head(names(rows), max_drop_keys), alias = alias))
      roles <- roles_of(rows)
      column <- NULL
      for (role in key_roles) if (!is.null(roles[[role]]) && roles[[role]] %in% names(rows)) { column <- roles[[role]]; break }
      keys <- if (!is.null(column)) rows[[column]] else if (!identical(rownames(rows), as.character(seq_len(nrow(rows)))) && nrow(rows)) rownames(rows) else if (ncol(rows)) rows[[1]] else character(0)
      return(list(count = nrow(rows), keys = utils::head(as.character(keys), max_drop_keys), alias = alias))
    }
    if (is.logical(rows) && length(rows) != 1) {
      picked <- which(rows %in% TRUE)
      keys <- if (!is.null(names(rows))) names(rows)[picked] else character(0)
      return(list(count = length(picked), keys = utils::head(keys, max_drop_keys), alias = alias))
    }
    if (is.logical(rows)) fail("sx$drop() expects the dropped rows, their keys or a count, not TRUE/FALSE")
    if (is.numeric(rows) && length(rows) == 1) return(list(count = max(0L, as.integer(rows)), keys = character(0), alias = alias))
    values <- as.character(unlist(rows))
    list(count = length(values), keys = utils::head(values, max_drop_keys), alias = alias)
  }

  drop <- function(rows, reason, input = NULL, axis = c("rows", "columns")) {
    axis <- match.arg(axis)
    text <- trimws(paste(as.character(reason), collapse = " "))
    if (!nzchar(text)) fail("sx$drop() needs a reason")
    found <- drop_keys(rows, axis)
    name <- if (!is.null(input)) input else found$alias
    if (is.null(name)) {
      attached <- names(load_inputs()$inputs)
      if (length(attached) == 1) name <- attached
    }
    entry <- list(input = name, count = as.integer(found$count), reason = substr(text, 1, 280), axis = axis, keys = I(as.character(found$keys)))
    if (length(state$drops) < max_drops) state$drops[[length(state$drops) + 1]] <- entry
    state$dirty <- TRUE
    invisible(entry)
  }

  empty_object <- function() structure(list(), names = character(0))

  manifest_document <- function() {
    list(manifestVersion = manifest_version, helperVersion = version, language = "r",
      artifacts = unname(state$artifacts),
      notes = I(state$notes),
      metrics = if (length(state$metrics)) state$metrics else empty_object(),
      metricMeta = if (length(state$metric_meta)) state$metric_meta else empty_object(),
      drops = unname(state$drops))
  }

  finish <- function() {
    directory <- output_dir()
    path <- file.path(directory, "manifest.json")
    tmp <- file.path(directory, "manifest.json.tmp")
    writeLines(jsonlite::toJSON(manifest_document(), auto_unbox = TRUE, null = "null", na = "null", digits = NA, pretty = TRUE), tmp, useBytes = TRUE)
    file.rename(tmp, path)
    state$finished <- TRUE
    state$dirty <- FALSE
    invisible(path)
  }

  write_at_exit <- function(env) {
    if (isTRUE(state$finished) && !isTRUE(state$dirty)) return(invisible(NULL))
    has_content <- length(state$artifacts) || length(state$notes) || length(state$metrics) || length(state$drops)
    if (is.null(state$run_dir) && !has_content) return(invisible(NULL))
    tryCatch(finish(), error = function(e) message("[seqdesk.explore] could not write manifest at exit: ", conditionMessage(e)))
  }
  reg.finalizer(state, write_at_exit, onexit = TRUE)

  helpers <- list(
    version = version, reset = reset, set_run_dir = set_run_dir, run_dir = run_dir, load_inputs = load_inputs,
    input_info = input_info, params = params, param = param, file_path = file_path, input = input,
    role_column = role_column, output_dir = output_dir, output = output, figure = figure,
    save_report_markdown = save_report_markdown, note = note, metric = metric, metric_hints = metric_hints,
    metrics = function() state$metrics, drop = drop, drops = function() state$drops,
    artifacts = function() state$artifacts, finish = finish
  )
  list2env(helpers, envir = new.env(parent = emptyenv()))
}

# The installed package exposes one ready helper; the run profile creates its own.
sx <- seqdesk_explore()
