# continualfig for R: sourced by Analysis before a step runs. It sets the Continual theme and wraps ggsave so a
# plot is (1) drawn at a journal width in mm, (2) improved where its own structure says how (a recognised volcano
# gets thresholds, direct labels and the up/down colours; a colour scale with too many hues becomes grouped ramps; a
# legend that repeats the x axis is dropped; a title moves to the caption), and (3) saved with its figure record.
# The script itself is never edited. Set CONTINUALFIG=off to get the unstyled output.
suppressPackageStartupMessages(library(ggplot2))

cf <- new.env()
cf$ink <- "#141516"; cf$grey <- "#8b918c"; cf$null <- "#b9bdb9"
cf$palette <- c("#2f6f9f", "#b35a1f", "#5b8a3c", "#7a5195", "#b38a2e", "#3f8f8a")
cf$updown <- c(down = "#2f6f9f", ns = "#b9bdb9", none = "#b9bdb9", up = "#b35a1f")
cf$widths <- c(single = 89, onehalf = 120, double = 183)
cf$font <- Sys.getenv("CONTINUALFIG_FONT", "Arial")
# CONTINUALFIG: on = theme and rules (the research prototype), record = plot as written and only write the figure
# record (what Proof uses, so a model does every improvement), off = plot as written, nothing else.
cf$mode <- Sys.getenv("CONTINUALFIG", "on")
cf$on <- cf$mode == "on"
cf$records <- Sys.getenv("CONTINUALFIG_RECORDS", ".")
cf$notes <- character()
# Settings Proof's chat can change without touching the script.
cf$width_opt <- Sys.getenv("CONTINUALFIG_WIDTH", "")        # single | onehalf | double | a number in mm
cf$font_pt <- as.numeric(Sys.getenv("CONTINUALFIG_FONT_PT", "7"))
cf$n_labels <- as.integer(Sys.getenv("CONTINUALFIG_LABELS", "6"))

theme_continual <- function(base_size = cf$font_pt, base_family = cf$font) {
  theme_classic(base_size = base_size, base_family = base_family) %+replace% theme(
    text = element_text(colour = cf$ink, family = base_family, size = base_size),
    axis.line = element_line(linewidth = 0.5 / .pt, colour = cf$ink),
    axis.ticks = element_line(linewidth = 0.5 / .pt, colour = cf$ink),
    axis.ticks.length = unit(1, "mm"),
    axis.text = element_text(size = base_size - 1, colour = cf$ink),
    axis.title = element_text(size = base_size, colour = cf$ink),
    legend.key.size = unit(3, "mm"), legend.title = element_text(size = base_size - 1),
    legend.text = element_text(size = base_size - 1), legend.background = element_blank(),
    strip.background = element_blank(), strip.text = element_text(face = "bold", hjust = 0),
    panel.grid = element_blank(), plot.title = element_blank(),
    plot.background = element_rect(fill = "white", colour = NA),
    plot.margin = margin(2, 2, 2, 2, "mm")
  )
}

cf$aes_name <- function(plot, what) {
  m <- plot$mapping[[what]]
  if (is.null(m)) for (l in plot$layers) if (!is.null(l$mapping[[what]])) { m <- l$mapping[[what]]; break }
  if (is.null(m)) return("") else rlang::as_label(m)
}

# A volcano: x reads as a fold change and y as -log10 of a p-value.
cf$is_volcano <- function(plot) {
  x <- cf$aes_name(plot, "x"); y <- cf$aes_name(plot, "y")
  grepl("fold|lfc|log2fc", x, ignore.case = TRUE) && grepl("log10", y) && grepl("p", y)
}

# Greedy labels for the strongest points: skip one that would sit on top of another.
cf$labels_for <- function(df, x, y, n = 6) {
  df <- df[order(-df[[y]]), ][seq_len(min(nrow(df), n * 3)), ]
  keep <- c(); pos <- list()
  for (i in seq_len(nrow(df))) {
    if (length(keep) >= n) break
    xi <- df[[x]][i]; yi <- df[[y]][i]
    if (any(vapply(pos, function(p) abs(p[1] - xi) < 1.2 && abs(p[2] - yi) < 4, logical(1)))) next
    keep <- c(keep, i); pos[[length(pos) + 1]] <- c(xi, yi)
  }
  df[keep, , drop = FALSE]
}

cf$improve <- function(plot) {
  notes <- character()
  original <- list(x = cf$aes_name(plot, "x"), y = cf$aes_name(plot, "y"), colour = cf$aes_name(plot, "colour"), fill = cf$aes_name(plot, "fill"))
  if (!is.null(plot$labels$title)) { notes <- c(notes, paste0("Title moved to the caption: \"", plot$labels$title, "\"")); plot$labels$title <- NULL }
  built <- ggplot_build(plot)
  colour_var <- cf$aes_name(plot, "colour"); fill_var <- cf$aes_name(plot, "fill"); x_var <- cf$aes_name(plot, "x")

  if (cf$is_volcano(plot)) {
    d <- built$data[[1]]
    lab_df <- plot$data
    lab_df$.x <- d$x; lab_df$.y <- d$y
    gene_col <- intersect(c("gene", "symbol", "Gene", "gene_name"), names(lab_df))[1]
    # Recognised volcano: thresholds, up/down colours, ns drawn first and small, direct labels, clear axis titles.
    plot$layers <- list()
    ns <- lab_df[!(abs(lab_df$.x) > 1 & lab_df$.y > -log10(0.05)), ]
    hit <- lab_df[abs(lab_df$.x) > 1 & lab_df$.y > -log10(0.05), ]
    hit$.dir <- ifelse(hit$.x > 0, "up", "down")
    plot <- ggplot(lab_df, aes(.x, .y)) +
      geom_vline(xintercept = c(-1, 1), linewidth = 0.5 / .pt, linetype = "22", colour = cf$grey) +
      geom_hline(yintercept = -log10(0.05), linewidth = 0.5 / .pt, linetype = "22", colour = cf$grey) +
      geom_point(data = ns, colour = cf$null, size = 0.35, stroke = 0) +
      geom_point(data = hit, aes(colour = .dir), size = 0.55, stroke = 0) +
      scale_colour_manual(values = cf$updown, guide = "none") +
      labs(x = quote(log[2]~fold~change), y = quote(-log[10]~italic(p))) +
      annotate("text", x = Inf, y = -log10(0.05) + 1.5, label = paste(sum(hit$.dir == "up"), "up"), hjust = 1.05, vjust = 0, size = 6 / .pt, colour = cf$updown[["up"]], family = cf$font) +
      annotate("text", x = -Inf, y = -log10(0.05) + 1.5, label = paste(sum(hit$.dir == "down"), "down"), hjust = -0.1, vjust = 0, size = 6 / .pt, colour = cf$updown[["down"]], family = cf$font)
    if (!is.na(gene_col)) {
      labs_df <- cf$labels_for(hit, ".x", ".y", cf$n_labels)
      plot <- plot + geom_text(data = labs_df, aes(label = .data[[gene_col]], hjust = ifelse(.x > 0, -0.15, 1.15)), size = 6 / .pt, fontface = "italic", family = cf$font, colour = cf$ink)
    }
    notes <- c(notes, "Recognised a volcano: added FDR 0.05 and |log2FC| 1 thresholds, up/down colours, counts and labels for the strongest genes")
  } else {
    y_var <- cf$aes_name(plot, "y")
    xdat <- tryCatch(rlang::eval_tidy(plot$mapping$x, plot$data), error = function(e) NULL)
    # MA plot: mean expression on x (spans decades), fold change on y.
    if (grepl("basemean|mean|^a$", x_var, ignore.case = TRUE) && grepl("fold|lfc|log2fc", y_var, ignore.case = TRUE) && is.numeric(xdat)) {
      hitv <- tryCatch(as.logical(rlang::eval_tidy(plot$mapping$colour, plot$data)), error = function(e) rep(FALSE, nrow(plot$data)))
      d <- plot$data; d$.x <- xdat; d$.y <- rlang::eval_tidy(plot$mapping$y, plot$data)
      d$.dir <- ifelse(hitv %in% TRUE, ifelse(d$.y > 0, "up", "down"), "ns")
      plot <- ggplot(d, aes(.x, .y)) + geom_hline(yintercept = 0, linewidth = 0.5 / .pt, colour = cf$grey) +
        geom_point(data = d[d$.dir == "ns", ], colour = cf$null, size = 0.35, stroke = 0) +
        geom_point(data = d[d$.dir != "ns", ], aes(colour = .dir), size = 0.55, stroke = 0) +
        scale_colour_manual(values = cf$updown, guide = "none") + scale_x_log10(labels = function(x) format(x, big.mark = ",", scientific = FALSE, trim = TRUE)) +
        labs(x = "mean of normalised counts", y = quote(log[2]~fold~change)) +
        annotate("text", x = Inf, y = Inf, label = paste(sum(d$.dir == "up"), "up"), hjust = 1.05, vjust = 1.5, size = 6 / .pt, colour = cf$updown[["up"]], family = cf$font) +
        annotate("text", x = Inf, y = -Inf, label = paste(sum(d$.dir == "down"), "down"), hjust = 1.05, vjust = -0.8, size = 6 / .pt, colour = cf$updown[["down"]], family = cf$font)
      notes <- c(notes, "Recognised an MA plot: mean on a log axis, a line at 0, up/down colours and counts; hits follow the script's own rule (padj < 0.05)")
      return(list(plot = plot + theme_continual(), notes = notes, original = original, categories = 0))
    }
    # Dose or concentration spanning decades: a log axis, so every dose gets its own place.
    if (is.numeric(xdat) && all(xdat > 0, na.rm = TRUE) && max(xdat, na.rm = TRUE) / min(xdat, na.rm = TRUE) >= 100 && grepl("conc|dose|um|nm|mm|mg", x_var, ignore.case = TRUE)) {
      plot <- plot + scale_x_log10(labels = function(x) format(x, scientific = FALSE, drop0trailing = TRUE, trim = TRUE))
      unit <- regmatches(x_var, regexpr("(uM|nM|mM|mg)", x_var, ignore.case = TRUE))
      plot$labels$x <- if (length(unit)) paste0("concentration (", sub("uM", "µM", unit), ", log scale)") else paste(x_var, "(log scale)")
      for (i in seq_along(plot$layers)) if (inherits(plot$layers[[i]]$geom, "GeomSmooth")) { plot$layers[[i]]$aes_params$colour <- cf$ink; plot$layers[[i]]$aes_params$linewidth <- 0.75 / .pt }
      notes <- c(notes, sprintf("Doses span %s-fold: x axis made logarithmic", format(max(xdat) / min(xdat), big.mark = ",")))
      notes <- c(notes, "A smooth is not a dose-response fit: suggest a 4-parameter logistic with the IC50 marked")
    }
    # Histogram with default bins: bins from the data (Freedman-Diaconis), grey, thin white edges.
    for (i in seq_along(plot$layers)) if (inherits(plot$layers[[i]]$stat, "StatBin") && is.numeric(xdat)) {
      iq <- stats::IQR(xdat, na.rm = TRUE); nn <- sum(!is.na(xdat))
      bw <- if (iq > 0) 2 * iq / nn^(1 / 3) else diff(range(xdat)) / 10
      plot$layers[[i]]$stat_params$binwidth <- signif(bw, 2); plot$layers[[i]]$stat_params$bins <- NULL
      plot$layers[[i]]$aes_params$fill <- "#c9ccc8"; plot$layers[[i]]$aes_params$colour <- "white"; plot$layers[[i]]$aes_params$linewidth <- 0.3 / .pt
      if (x_var %in% names(plot$data) && grepl("_M$", x_var)) plot$labels$x <- sub("_M$", " (million)", x_var)
      plot$labels$y <- "libraries"
      plot <- plot + scale_y_continuous(breaks = function(l) unique(floor(pretty(l))), expand = expansion(mult = c(0, 0.05)))
      notes <- c(notes, sprintf("Histogram: bin width %s from the data instead of 30 default bins; grey fill", signif(bw, 2)))
      lo <- xdat[xdat < stats::quantile(xdat, 0.25) - 1.5 * iq]
      if (length(lo)) notes <- c(notes, sprintf("%d value(s) far below the rest (%s): check them before plotting", length(lo), paste(round(lo, 1), collapse = ", ")))
    }
    # Many clusters: label each at its centre instead of a legend of 12 hues.
    if (colour_var != "" && colour_var %in% names(plot$data)) {
      lv <- levels(factor(plot$data[[colour_var]]))
      fams <- unique(sub(" .*", "", lv))
      if (length(lv) > length(cf$palette) && (length(fams) == 1 || length(fams) == length(lv)) && is.numeric(xdat)) {
        d <- plot$data; d$.x <- xdat; d$.y <- rlang::eval_tidy(plot$mapping$y, plot$data); d$.g <- d[[colour_var]]
        cen <- aggregate(cbind(.x, .y) ~ .g, d, stats::median)
        cen$.lab <- sub("^cluster ", "", as.character(cen$.g))
        vals <- rep(c(cf$palette, grDevices::colorRampPalette(c("#ffffff", cf$palette[1]))(4)[3], "#9c6b8e", "#6f7d3a", "#b0706a", "#5f8fb3", "#8a7a4f"), length.out = length(lv))
        plot <- plot + scale_colour_manual(values = vals, guide = "none") +
          geom_text(data = cen, aes(.x, .y, label = .lab), inherit.aes = FALSE, size = 7 / .pt, fontface = "bold", family = cf$font, colour = cf$ink)
        for (i in seq_along(plot$layers)) if (inherits(plot$layers[[i]]$geom, "GeomPoint")) { plot$layers[[i]]$aes_params$size <- 0.3; plot$layers[[i]]$aes_params$stroke <- 0 }
        plot$labels$x <- sub("_", " ", x_var); plot$labels$y <- sub("_", " ", y_var)
        plot <- plot + theme(axis.text = element_blank(), axis.ticks = element_blank())
        notes <- c(notes, sprintf("%d clusters labelled at their centres instead of a legend; UMAP axes carry no units, so ticks were removed", length(lv)))
        return(list(plot = plot + theme_continual() + theme(axis.text = element_blank(), axis.ticks = element_blank()), notes = notes, original = original, categories = 0))
      }
    }
    # Order categories the way a scientist reads them: the control first, then time or dose ascending.
    if (x_var != "" && x_var %in% names(plot$data) && !is.numeric(plot$data[[x_var]])) {
      lv <- unique(as.character(plot$data[[x_var]]))
      base <- grepl("^(control|ctrl|normoxia|untreated|vehicle|wt|wild.?type|mock|baseline|0 ?h)$", lv, ignore.case = TRUE)
      num <- suppressWarnings(as.numeric(sub("^[^0-9]*([0-9.]+).*$", "\\1", lv)))
      num[is.na(num)] <- Inf
      ordered <- lv[order(!base, sub(" *[0-9.]+.*$", "", lv), num)]
      if (!identical(ordered, sort(lv)) || !identical(ordered, lv)) {
        plot$data[[x_var]] <- factor(plot$data[[x_var]], levels = ordered)
        if (!identical(ordered, sort(lv))) notes <- c(notes, paste0("Categories ordered control first, then by time: ", paste(ordered, collapse = ", ")))
      }
    }
    # Too many hues: group levels by their first word ("N 6h" -> N) and give each group a ramp of one hue.
    for (aes_name in c("colour", "fill")) {
      var <- if (aes_name == "colour") colour_var else fill_var
      if (var == "" || !(var %in% names(plot$data))) next
      levels <- unique(as.character(plot$data[[var]]))
      if (aes_name == "fill" && var == x_var) {
        plot <- plot + guides(fill = "none") + scale_fill_manual(values = rep("#d9dcd8", length(levels)))
        notes <- c(notes, paste0("The fill repeated the x axis (", var, "): legend removed, bars made neutral"))
        next
      }
      if (length(levels) > length(cf$palette)) {
        family <- sub(" .*", "", levels)
        fams <- unique(family)
        base <- cf$palette[c(1, 2, 3, 4)][seq_along(fams)]
        vals <- setNames(character(length(levels)), levels)
        for (k in seq_along(fams)) {
          ls <- levels[family == fams[k]]
          ramp <- grDevices::colorRampPalette(c("#ffffff", base[k]))(length(ls) + 2)[-(1:2)]  # lightest step still readable on white
          vals[ls] <- ramp
        }
        sc <- if (aes_name == "colour") scale_colour_manual(values = vals, breaks = levels) else scale_fill_manual(values = vals, breaks = levels)
        plot <- plot + sc
        notes <- c(notes, paste0(length(levels), " hues on ", var, " became ", length(fams), " ramps, one per group (", paste(fams, collapse = ", "), ")"))
      } else if (length(levels) > 1) {
        sc <- if (aes_name == "colour") scale_colour_manual(values = cf$palette) else scale_fill_manual(values = cf$palette)
        plot <- plot + sc
      }
    }
    if (any(vapply(plot$layers, function(l) inherits(l$geom, "GeomCol") || inherits(l$geom, "GeomBar"), logical(1))) &&
        any(vapply(plot$layers, function(l) inherits(l$geom, "GeomErrorbar"), logical(1)))) {
      notes <- c(notes, "Bars of means with error bars: the points are not in the data, so they cannot be shown. Suggest plotting the samples with the median")
      for (i in seq_along(plot$layers)) {
        if (inherits(plot$layers[[i]]$geom, "GeomErrorbar")) { plot$layers[[i]]$aes_params$linewidth <- 0.5 / .pt; plot$layers[[i]]$geom_params$width <- 0.15 }
        if (inherits(plot$layers[[i]]$geom, "GeomCol") || inherits(plot$layers[[i]]$geom, "GeomBar")) plot$layers[[i]]$geom_params$width <- 0.55
      }
    }
    ylab <- plot$labels$y
    for (ax in list(plot$labels$x, ylab)) {
      if (is.null(ax) || is.function(ax)) next
      if (grepl("^PC[0-9]+$", ax)) notes <- c(notes, paste0("Axis \"", ax, "\": add the share of variance it explains"))
      else if (identical(ax, ylab) && !grepl("\\(|log|%|count|libraries|fold", ax)) notes <- c(notes, paste0("Axis \"", ax, "\" has no unit"))
    }
    for (i in seq_along(plot$layers)) if (inherits(plot$layers[[i]]$geom, "GeomPoint") && !is.null(plot$layers[[i]]$aes_params$size)) plot$layers[[i]]$aes_params$size <- 1.4
  }
  x_levels <- tryCatch(length(unique(ggplot_build(plot)$layout$panel_params[[1]]$x$get_labels())), error = function(e) 0)
  discrete_x <- tryCatch(inherits(ggplot_build(plot)$layout$panel_scales_x[[1]], "ScaleDiscrete"), error = function(e) FALSE)
  list(plot = plot + theme_continual(), notes = notes, original = original, categories = if (discrete_x) x_levels else 0)
}

cf$record <- function(plot, file, width_mm, height_mm, notes, script, original = list()) {
  # Rows of data the plot draws from: the plot's own data plus any data given to a single layer, each data frame
  # once, so moving the data from ggplot() into geom_*(data = ...) does not look like a change.
  plotted_rows <- function(p) {
    frames <- c(list(p$data), lapply(p$layers, function(l) l$data))
    frames <- Filter(function(d) is.data.frame(d) && nrow(d) > 0, frames)
    if (!length(frames)) return(0)
    sum(vapply(unique(frames), nrow, integer(1)))
  }
  b <- ggplot_build(plot)
  layers <- lapply(seq_along(plot$layers), function(i) list(
    geom = class(plot$layers[[i]]$geom)[1], stat = class(plot$layers[[i]]$stat)[1],
    mapping = vapply(plot$layers[[i]]$mapping, rlang::as_label, character(1)),
    rows = nrow(b$data[[i]])))
  rec <- list(file = basename(file), tool = "ggplot2", script = script, width_mm = width_mm, height_mm = height_mm,
              mapping = Filter(nzchar, original),
              labels = lapply(plot$labels, function(x) if (is.character(x)) x else if (is.call(x) || is.name(x)) paste(deparse(x), collapse = "") else NULL),
              layers = layers, data_rows = plotted_rows(plot),
              data_columns = if (is.data.frame(plot$data)) names(plot$data) else character(), changes = notes)
  jsonlite::write_json(rec, file.path(cf$records, sub("\\.[a-z]+$", ".json", basename(file))), auto_unbox = TRUE, pretty = TRUE)
}

ggsave <- function(filename, plot = last_plot(), width = NA, height = NA, units = "in", ...) {
  script <- Sys.getenv("CONTINUALFIG_SCRIPT", "")
  if (cf$mode == "record") {
    out <- ggplot2::ggsave(filename, plot, width = width, height = height, units = units, device = grDevices::svg, ...)
    to_mm <- c(`in` = 25.4, cm = 10, mm = 1, px = 25.4 / 96)[[units]]
    size <- if (is.na(width) || is.na(height)) grDevices::dev.size("in") * 25.4 else c(width, height) * to_mm
    orig <- list(x = cf$aes_name(plot, "x"), y = cf$aes_name(plot, "y"), colour = cf$aes_name(plot, "colour"), fill = cf$aes_name(plot, "fill"))
    cf$record(plot, filename, round(size[1]), round(size[2]), character(), script, orig)
    return(invisible(out))
  }
  if (!cf$on) return(ggplot2::ggsave(filename, plot, width = width, height = height, units = units, device = grDevices::svg, ...))
  better <- cf$improve(plot)
  aspect <- if (is.na(width) || is.na(height)) 0.68 else height / width
  # The smallest width that fits: a categorical plot needs about 16 mm per category.
  w <- if (better$categories > 0) min(cf$widths[["single"]], 18 + 16 * better$categories) else cf$widths[["single"]]
  if (nzchar(cf$width_opt)) w <- if (cf$width_opt %in% names(cf$widths)) cf$widths[[cf$width_opt]] else as.numeric(cf$width_opt)
  h <- if (better$categories > 0) round(w * 0.8) else round(min(170, w * aspect))
  ggplot2::ggsave(filename, better$plot, width = w, height = h, units = "mm", device = grDevices::svg)
  cf$record(better$plot, filename, w, h, better$notes, script, better$original)
  invisible(filename)
}
if (cf$on) theme_set(theme_continual())
