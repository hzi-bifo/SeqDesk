# Loaded by Rscript through R_PROFILE_USER when SeqDesk runs an R step: makes
# `sx` available without installing the package (it is attached as
# "seqdesk.explore", so rm(list = ls()) in a step does not remove it).
local({
  lib <- Sys.getenv("SEQDESK_EXPLORE_R_LIB")
  helper <- file.path(lib, "seqdesk.explore", "R", "sx.R")
  if (nzchar(lib) && file.exists(helper)) {
    env <- attach(NULL, name = "seqdesk.explore")
    sys.source(helper, envir = env)
  }
})
