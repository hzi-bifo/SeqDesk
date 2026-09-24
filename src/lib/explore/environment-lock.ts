/**
 * The environment a run used, pinned (FLOW-GAPS D18): name, spec hash, the
 * digest of the explicit lock (`conda list --explicit --md5`), the language
 * version and the host. The lock digest is cached per spec hash on the
 * environment record, so it is computed once per build.
 */
import { execFile } from "child_process";
import crypto from "crypto";
import os from "os";
import path from "path";
import { db } from "@/lib/db";
import { resolveCondaExecutable } from "./environments";

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

/** "Python 3.12.4" / "R version 4.4.1 (2024-06-14) ..." -> "3.12.4" / "4.4.1". */
export function parseLanguageVersion(output: string | null): string | null {
  if (!output) return null;
  const match = /(?:Python|R version|R scripting front-end version)\s+(\d+\.\d+(?:\.\d+)?)/.exec(output);
  return match ? match[1] : null;
}

export function environmentLabel(language: string, languageVersion: string | null, lockDigest: string | null): string {
  const name = language === "r" ? "R" : "Python";
  return [languageVersion ? `${name} ${languageVersion}` : name, lockDigest ? `lock ${lockDigest.slice(0, 6)}` : null].filter(Boolean).join(" · ");
}

/** The pin of a ready environment; never throws (an unknown lock is null). */
export async function pinEnvironment(name: string, language: string): Promise<EnvironmentPin | null> {
  const record = await db.exploreEnvironment.findUnique({ where: { name } });
  if (!record || record.status !== "ready" || !record.prefixPath) return null;
  let lockDigest = record.lockSpecHash === record.specHash ? record.lockDigest : null;
  let languageVersion = record.lockSpecHash === record.specHash ? record.languageVersion : null;
  if (record.lockSpecHash !== record.specHash) {
    const conda = await resolveCondaExecutable().catch(() => "conda");
    const lock = await run(conda, ["list", "--explicit", "--md5", "-p", record.prefixPath]);
    lockDigest = lock && /@EXPLICIT/.test(lock) ? crypto.createHash("sha256").update(lock).digest("hex") : null;
    const binary = language === "r" ? path.join(record.prefixPath, "bin", "R") : path.join(record.prefixPath, "bin", "python");
    languageVersion = parseLanguageVersion(await run(binary, ["--version"], 20000));
    await db.exploreEnvironment.update({ where: { name }, data: { lockDigest, languageVersion, lockSpecHash: record.specHash } }).catch(() => undefined);
  }
  return { name, specHash: record.specHash, lockDigest, label: environmentLabel(language, languageVersion, lockDigest), language, languageVersion, host: os.hostname() };
}
