/**
 * The environment a run used, pinned (FLOW-GAPS D18): name, spec hash, the
 * digest of the explicit lock (`conda list --explicit --md5`), the language
 * version and the host. The lock digest is cached per spec hash on the
 * environment record, so it is computed once per build.
 */
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { db } from "@/lib/db";
import { stripChannelCredentials } from "./conda-credentials";
import { resolveCondaExecutable } from "./environments";

export { stripChannelCredentials };

export interface EnvironmentPin {
  name: string;
  specHash: string;
  lockDigest: string | null;
  label: string;
  language: string;
  languageVersion: string | null;
  host: string;
}

function run(command: string, args: string[], timeoutMs = 60000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return resolve(null);
      resolve(`${stdout}${stderr}`);
    });
  });
}

interface CondaMetaRecord {
  name?: string;
  url?: string;
  md5?: string;
  channel?: string;
  subdir?: string;
  fn?: string;
}

/**
 * The explicit lock of a prefix read straight from conda-meta/*.json, the
 * record conda, mamba and micromamba all write: one `url#md5` line per
 * package, sorted by name, credentials stripped. No conda executable is
 * needed, so the lock is the same whichever tool built the prefix. Null when
 * the prefix has no package records.
 */
export async function readExplicitLock(prefix: string): Promise<string | null> {
  const metaDir = path.join(prefix, "conda-meta");
  let entries: string[];
  try {
    entries = (await fs.readdir(metaDir)).filter((entry) => entry.endsWith(".json"));
  } catch {
    return null;
  }
  const lines: Array<{ name: string; line: string }> = [];
  for (const entry of entries) {
    try {
      const record = JSON.parse(await fs.readFile(path.join(metaDir, entry), "utf8")) as CondaMetaRecord;
      const url = record.url ?? (record.channel && record.subdir && record.fn ? `${record.channel.replace(/\/$/, "")}/${record.subdir}/${record.fn}` : null);
      if (!url) continue;
      lines.push({ name: record.name ?? entry, line: `${stripChannelCredentials(url)}${record.md5 ? `#${record.md5}` : ""}` });
    } catch {
      // a half-written record: skip it
    }
  }
  if (lines.length === 0) return null;
  lines.sort((a, b) => a.name.localeCompare(b.name) || a.line.localeCompare(b.line));
  return `@EXPLICIT\n${lines.map((entry) => entry.line).join("\n")}\n`;
}

/** The lock text of a prefix: conda-meta first, then `conda list --explicit --md5`; always credential-free. */
export async function explicitLockText(prefix: string, conda?: string): Promise<string | null> {
  const fromMeta = await readExplicitLock(prefix);
  if (fromMeta) return fromMeta;
  const executable = conda ?? (await resolveCondaExecutable().catch(() => "conda"));
  const listed = await run(executable, ["list", "--explicit", "--md5", "-p", prefix]);
  return listed && /@EXPLICIT/.test(listed) ? stripChannelCredentials(listed) : null;
}

export function lockDigestOf(lock: string | null): string | null {
  return lock ? crypto.createHash("sha256").update(lock).digest("hex") : null;
}

/** "Python 3.12.4" / "R version 4.4.1 (2024-06-14) ..." -> "3.12.4" / "4.4.1". */
export function parseLanguageVersion(output: string | null): string | null {
  if (!output) return null;
  const match = /(?:Python|R version|R scripting front-end version)\s+(\d+\.\d+(?:\.\d+)?)/.exec(output);
  return match ? match[1] : null;
}

export function environmentLabel(language: string, languageVersion: string | null, lockDigest: string | null): string {
  // Shell steps run bash with the environment's tools; its Python only runs the sx helper.
  if (language === "shell") return ["Shell", languageVersion ? `(Python ${languageVersion})` : null].filter(Boolean).join(" ") + (lockDigest ? ` · lock ${lockDigest.slice(0, 6)}` : "");
  const name = language === "r" ? "R" : "Python";
  return [languageVersion ? `${name} ${languageVersion}` : name, lockDigest ? `lock ${lockDigest.slice(0, 6)}` : null].filter(Boolean).join(" · ");
}

/** The pin of a ready environment; never throws (an unknown lock is null). */
export async function pinEnvironment(name: string, language: string): Promise<EnvironmentPin | null> {
  const record = await db.exploreEnvironment.findUnique({ where: { name } });
  if (!record || record.status !== "ready" || !record.prefixPath) return null;
  let lockDigest = record.lockSpecHash === record.specHash ? record.lockDigest : null;
  let languageVersion = record.lockSpecHash === record.specHash ? record.languageVersion : null;
  // A null digest is retried: an earlier attempt may have failed (no conda on PATH, micromamba).
  if (record.lockSpecHash !== record.specHash || !lockDigest) {
    lockDigest = lockDigestOf(await explicitLockText(record.prefixPath));
    const binary = language === "r" ? path.join(record.prefixPath, "bin", "R") : path.join(record.prefixPath, "bin", "python");
    languageVersion = parseLanguageVersion(await run(binary, ["--version"], 20000));
    await db.exploreEnvironment.update({ where: { name }, data: { lockDigest, languageVersion, lockSpecHash: record.specHash } }).catch(() => undefined);
  }
  return { name, specHash: record.specHash, lockDigest, label: environmentLabel(language, languageVersion, lockDigest), language, languageVersion, host: os.hostname() };
}
