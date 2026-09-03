import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

interface SynchronizeInstallerOptions {
  sourcePath?: string;
  targetPath?: string;
  check?: boolean;
  log?: (message: string) => void;
}

interface SynchronizeInstallerResult {
  updated: boolean;
  sha256: string;
}

const require = createRequire(import.meta.url);
const { synchronizeInstaller } = require(
  path.join(
    process.cwd(),
    "npm",
    "seqdesk",
    "scripts",
    "sync-installer.js",
  ),
) as {
  synchronizeInstaller: (
    options?: SynchronizeInstallerOptions,
  ) => SynchronizeInstallerResult;
};

const temporaryDirectories: string[] = [];

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "seqdesk-installer-sync-"));
  temporaryDirectories.push(root);
  const sourcePath = path.join(root, "scripts", "install-dist.sh");
  const targetPath = path.join(
    root,
    "npm",
    "seqdesk",
    "installer",
    "install.sh",
  );
  mkdirSync(path.dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, "#!/usr/bin/env bash\necho canonical\n", {
    mode: 0o755,
  });
  return { sourcePath, targetPath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("npm installer synchronization", () => {
  it("ships the generated file and checks it before every package build", () => {
    const packageJson = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "npm", "seqdesk", "package.json"),
        "utf8",
      ),
    ) as {
      files: string[];
      scripts: Record<string, string>;
    };

    expect(packageJson.files).toContain("installer/install.sh");
    expect(packageJson.scripts["sync-version"]).toContain(
      "scripts/sync-installer.js",
    );
    expect(packageJson.scripts.prepack).toContain(
      "node ./scripts/sync-version.js --check",
    );
    expect(packageJson.scripts.prepack).toContain(
      "node ./scripts/sync-installer.js --check",
    );
  });

  it("generates an executable byte-for-byte copy of the canonical installer", () => {
    const fixture = makeFixture();
    const result = synchronizeInstaller({
      ...fixture,
      log: () => undefined,
    });

    expect(result.updated).toBe(true);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(fixture.targetPath)).toEqual(
      readFileSync(fixture.sourcePath),
    );
    expect(statSync(fixture.targetPath).mode & 0o111).not.toBe(0);
  });

  it("fails the check instead of silently packaging a stale copy", () => {
    const fixture = makeFixture();
    synchronizeInstaller({ ...fixture, log: () => undefined });
    writeFileSync(fixture.sourcePath, "#!/usr/bin/env bash\necho changed\n");

    expect(() =>
      synchronizeInstaller({
        ...fixture,
        check: true,
        log: () => undefined,
      }),
    ).toThrow("bundled npm installer is missing or stale");
    expect(readFileSync(fixture.targetPath, "utf8")).toContain("canonical");
  });

  it("also rejects a matching copy whose executable mode was lost", () => {
    const fixture = makeFixture();
    synchronizeInstaller({ ...fixture, log: () => undefined });
    chmodSync(fixture.targetPath, 0o644);

    expect(() =>
      synchronizeInstaller({
        ...fixture,
        check: true,
        log: () => undefined,
      }),
    ).toThrow("bundled npm installer is missing or stale");
  });

  it("keeps the repository's generated installer aligned", () => {
    expect(
      existsSync(
        path.join(process.cwd(), "npm", "seqdesk", "installer", "install.sh"),
      ),
    ).toBe(true);
    expect(() =>
      synchronizeInstaller({ check: true, log: () => undefined }),
    ).not.toThrow();
  });
});
