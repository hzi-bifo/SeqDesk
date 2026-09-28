import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// scripts/backup.sh finds the Explore storage the way Compute does: SEQDESK_EXPLORE_DIR, else
// <SEQDESK_DATA_PATH>/explore (the Linux kit's compute.env sets only the data path). A stub psql
// stops the run right after that check, so no database is needed.
const script = path.join(__dirname, "backup.sh");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function run(env: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "backup-sh-"));
  dirs.push(root);
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "psql"), "#!/bin/sh\necho stub-psql >&2\nexit 3\n");
  chmodSync(path.join(bin, "psql"), 0o755);
  const data = path.join(root, "data");
  mkdirSync(path.join(data, "explore", "datasets"), { recursive: true });
  const result = spawnSync("bash", [script, "--out", path.join(root, "out")], {
    encoding: "utf8",
    env: { PATH: `${bin}:/usr/bin:/bin`, DATABASE_URL: "postgresql://seqdesk@127.0.0.1:1/seqdesk?schema=public",
      ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replace("@DATA@", data)])) },
  });
  return result;
}

describe("backup.sh Explore storage", () => {
  it("uses <SEQDESK_DATA_PATH>/explore when SEQDESK_EXPLORE_DIR is not set", () => {
    const result = run({ SEQDESK_DATA_PATH: "@DATA@/" });
    expect(result.stderr).not.toContain("Set SEQDESK_EXPLORE_DIR");
    expect(result.stdout).toContain("[backup] database");
    expect(result.stderr).toContain("stub-psql");
  });

  it("still asks for the storage root when neither variable names one", () => {
    const result = run({});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Set SEQDESK_EXPLORE_DIR (or SEQDESK_DATA_PATH)");
  });
});
