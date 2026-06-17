import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { READ_CLEANING_PIPELINE_ID } from "./simulate-reads-config";

// NOTE: server-only module. It touches the filesystem (existsSync/statSync), so
// it must NOT be imported from client-reachable code. The config helpers that
// client components use live in ./simulate-reads-config, which is kept fs-free.

const KRAKEN2_DB_FILES = ["hash.k2d", "opts.k2d", "taxo.k2d"] as const;

/**
 * Path-level validation for the read-cleaning classifier databases.
 *
 * In `local` mode the supplied paths live on the API host, so we stat them:
 * the Kraken2 database must be a .tar/.tar.gz archive (detaxizer's
 * KRAKEN2PREPARATION untars `--kraken2db`, so a directory fails), and the BBDuk
 * reference must be a readable file. A bogus path surfaces here as a blocking
 * issue instead of dying deep in the scheduler.
 *
 * In `slurm` (remote) mode the paths refer to a compute node we cannot stat, so
 * we only require them to be absolute and surface a non-blocking warning rather
 * than a false-negative failure.
 *
 * Returns `{ issues, warnings }`. `issues` block the run; `warnings` do not.
 * Non read-cleaning pipelines return empty arrays.
 */
export function getReadCleaningPathIssues(
  pipelineId: string,
  config: Record<string, unknown>,
  mode: "local" | "slurm",
): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (pipelineId !== READ_CLEANING_PIPELINE_ID) {
    return { issues, warnings };
  }

  const classificationKraken2 = config.classificationKraken2 !== false;
  const classificationBbduk = config.classificationBbduk === true;
  const kraken2Db =
    typeof config.kraken2Db === "string" ? config.kraken2Db.trim() : "";
  const bbdukReference =
    typeof config.bbdukReference === "string" ? config.bbdukReference.trim() : "";

  if (classificationKraken2 && kraken2Db) {
    if (mode === "local") {
      let stat: ReturnType<typeof statSync> | null = null;
      try {
        stat = existsSync(kraken2Db) ? statSync(kraken2Db) : null;
      } catch {
        stat = null;
      }
      if (!stat) {
        issues.push(
          `Kraken2 database path does not exist or is not readable: ${kraken2Db}`,
        );
      } else if (stat.isDirectory()) {
        // read-cleaning's detaxizer (KRAKEN2PREPARATION) runs `tar -xf "$kraken2db"` and then
        // finds *.k2d recursively, so --kraken2db must be a .tar/.tar.gz ARCHIVE — a directory
        // gives "tar: <db>: Is a directory" and the run dies in the scheduler. Reject it here
        // with the pack command. (This validation was previously inverted: it required a
        // directory and rejected the archive detaxizer actually needs.)
        const missing = KRAKEN2_DB_FILES.filter(
          (file) => !existsSync(join(kraken2Db, file)),
        );
        issues.push(
          `Kraken2 database for read-cleaning must be a .tar/.tar.gz archive, not a directory ` +
            `(detaxizer untars --kraken2db): ${kraken2Db}.` +
            (missing.length === 0
              ? ` Pack it with: tar -cf kraken2_db.tar -C ${kraken2Db} .`
              : ` (it is also missing ${missing.join(", ")})`),
        );
      } else if (!/\.(tar\.gz|tgz|tar)$/i.test(kraken2Db)) {
        issues.push(
          `Kraken2 database for read-cleaning must be a .tar/.tar.gz archive ` +
            `(detaxizer untars --kraken2db): ${kraken2Db}`,
        );
      }
      // else: a .tar/.tar.gz/.tgz archive — detaxizer's KRAKEN2PREPARATION untars it and
      // validates the .k2d contents at extraction time, so accept it here.
    } else if (!isAbsolute(kraken2Db)) {
      issues.push(
        `Kraken2 database path must be absolute for remote execution: ${kraken2Db}`,
      );
    } else {
      warnings.push(
        `Kraken2 database path ${kraken2Db} is assumed to exist on the compute node; it is not verified from this host.`,
      );
    }
  }

  if (classificationBbduk && bbdukReference) {
    if (mode === "local") {
      let stat: ReturnType<typeof statSync> | null = null;
      try {
        stat = existsSync(bbdukReference) ? statSync(bbdukReference) : null;
      } catch {
        stat = null;
      }
      if (!stat) {
        issues.push(
          `BBDuk reference FASTA does not exist or is not readable: ${bbdukReference}`,
        );
      } else if (!stat.isFile()) {
        issues.push(
          `BBDuk reference FASTA is not a file: ${bbdukReference}`,
        );
      }
    } else if (!isAbsolute(bbdukReference)) {
      issues.push(
        `BBDuk reference FASTA path must be absolute for remote execution: ${bbdukReference}`,
      );
    } else {
      warnings.push(
        `BBDuk reference FASTA ${bbdukReference} is assumed to exist on the compute node; it is not verified from this host.`,
      );
    }
  }

  return { issues, warnings };
}
