import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const installDistPath = path.join(repoRoot, "scripts/install-dist.sh");
const installDistSource = readFileSync(installDistPath, "utf8");

const parserStart = installDistSource.indexOf("parse_release_version_info() {");
const parserEnd = installDistSource.indexOf("\nupdate_pm2_display_cmd() {");

if (parserStart === -1 || parserEnd === -1) {
  throw new Error("Could not locate parse_release_version_info in scripts/install-dist.sh");
}

const parserFunction = installDistSource.slice(parserStart, parserEnd).trim();

function runInstallerParser(payload: unknown) {
  return spawnSync(
    "bash",
    [
      "-lc",
      `set -euo pipefail
${parserFunction}
parse_release_version_info "$PAYLOAD"`,
    ],
    {
      env: {
        ...process.env,
        PAYLOAD: JSON.stringify(payload),
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
}

function parseInstallerFields(output: string) {
  const [version, downloadUrl, checksum, size, endMarker] = output.split("\x1f");

  return {
    version,
    downloadUrl,
    checksum,
    size,
    endMarker,
  };
}

describe("install-dist release parser", () => {
  it("parses direct release payloads", () => {
    const result = runInstallerParser({
      version: "1.2.3",
      downloadUrl: "https://downloads.seqdesk.com/seqdesk-1.2.3.tar.gz",
      checksum: "sha256:deadbeef",
      size: 1048576,
    });

    expect(result.status).toBe(0);
    expect(
      parseInstallerFields(result.stdout)
    ).toEqual({
      version: "1.2.3",
      downloadUrl: "https://downloads.seqdesk.com/seqdesk-1.2.3.tar.gz",
      checksum: "sha256:deadbeef",
      size: "1048576",
      endMarker: "__SEQDESK_VERSION_INFO_END__",
    });
  });

  it("parses update-check payloads that wrap the release in latest", () => {
    const result = runInstallerParser({
      updateAvailable: false,
      currentVersion: null,
      latest: {
        version: "1.1.79",
        channel: "stable",
        releaseDate: "2026-03-04",
        downloadUrl:
          "https://hrvwvo4zhyhlyy73.public.blob.vercel-storage.com/releases/seqdesk-1.1.79.tar.gz",
        checksum: "sha256:4685e8669750ff3a9b250a2f7d1ffa15155fa0d73c3273201d284aab7af7d190",
        releaseNotes:
          "This release removes repository-tracked env-file setup references and aligns runtime/release tooling around JSON config usage.",
        minNodeVersion: "18.0.0",
      },
    });

    expect(result.status).toBe(0);
    expect(
      parseInstallerFields(result.stdout)
    ).toEqual({
      version: "1.1.79",
      downloadUrl:
        "https://hrvwvo4zhyhlyy73.public.blob.vercel-storage.com/releases/seqdesk-1.1.79.tar.gz",
      checksum: "sha256:4685e8669750ff3a9b250a2f7d1ffa15155fa0d73c3273201d284aab7af7d190",
      size: "",
      endMarker: "__SEQDESK_VERSION_INFO_END__",
    });
  });

  it("rejects payloads without release metadata", () => {
    const result = runInstallerParser({
      updateAvailable: false,
      currentVersion: null,
      latest: null,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/version must be a non-empty string/i);
  });
});
