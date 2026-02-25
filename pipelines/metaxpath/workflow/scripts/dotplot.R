#!/usr/bin/env Rscript
#  *
#  * File: dotplot.R
#  * Author: ZL Deng <dawnmsg(at)gmail.com>
#  * File Created:  2024-03-19 19:17:58
#  * Last Modified: 2024-04-05 18:20:58
#  * Description:   Visualize MetaX taxonomy report
#  *
#

library(tidyverse)
library(optparse)

# Define the command line options
option_list <- list(
  make_option(c("-p", "--profile"),
    type = "character", default = NULL,
    help = "The MetaX taxonomy simple report", metavar = "character"
  ),
  make_option(c("-o", "--out"),
    type = "character", default = NULL,
    help = "The output figure file name", metavar = "character"
  )
)
opt_parser <- OptionParser(option_list = option_list)
opt <- parse_args(opt_parser)

if (is.null(opt$profile) || is.null(opt$out)) {
  print_help(opt_parser)
  stop("The report file and output file must be specified", call. = FALSE)
}

df <- read_tsv(opt$profile)

# Check if the header contains 'speciesName'
if ("speciesName" %in% names(df)) {
  # Filter out the 'AMR' column and rename 'speciesName' to 'taxonName'
  df <- df %>%
    select(-AMRs) %>%           # Remove 'AMR' column
    rename(taxonName = speciesName)  # Rename 'speciesName' to 'taxonName'
}

# read_tsv(opt$profile) %>%
#   select(-AMRs) %>%
df %>%
  filter(!taxonName %in% c("Cutibacterium acnes", "Toxoplasma gondii", "Homo sapiens")) %>%
  # group_by(sampleName) %>%
  # slice_max(order_by = depth, n = 5, with_ties = FALSE) %>%
  # ungroup() %>%
  filter(
    case_when(
      grepl("Ascites", sampleName, ignore.case = TRUE) ~ depth > 0.005,
      grepl("Urine", sampleName, ignore.case = TRUE) ~ depth > 0.1,
      TRUE ~ TRUE  # Keep all rows for other sample types
    )
  ) %>%
  separate(sampleName, c("subject", "depletion", "material", "date", "barcode"), sep = "_") %>%
  unite(sample, c(subject, material, date, barcode), sep = "_", remove = F) %>%
  mutate(sample = sub("_+$", "", sample)) %>%
  mutate(sample = sub("_barcode", "_b", sample)) %>%
  mutate(material=ifelse(is.na(crossContamination), material, "CC")) %>%
  ggplot(aes(sample, taxonName,
    shape = material,
    size = abundance, color = log10(numReads)
  )) +
  geom_point(stroke = 0.1, stat = "identity") + # Apply stroke where applicable
  theme_classic(base_size = 15) +
  coord_cartesian(ylim = c(NA, NA), clip = "off") +
  scale_color_continuous(type = "viridis") +
  theme(
    panel.grid.minor = element_line(linewidth = 0.7),
    panel.grid.major = element_line(linewidth = 0.7),
    axis.text.x = element_text(angle = 60, hjust = 1),
    plot.margin = margin(t = 40, r = 20, b = 20, l = 20)
  ) +
  ylab("") +
  xlab("") +
  labs(size = "abundance", color = "log10 reads") +
  guides(shape = guide_legend(override.aes = list(size = 5))) -> p

ggsave(p, filename = opt$out, width = 8, height = 10)
