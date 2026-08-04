import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface SynchronizeResult {
  version: string;
  launcherUpdated: boolean;
  citationUpdated: boolean;
  citationReleaseDate: string;
}

interface SynchronizeOptions {
  launcherPkgPath: string;
  rootPkgPath: string;
  citationPath: string;
  releaseDate: string;
  log: (message: string) => void;
}

const require = createRequire(import.meta.url);
const { synchronizeVersionMetadata } = require(
  path.join(process.cwd(), "npm", "seqdesk", "scripts", "sync-version.js"),
) as {
  synchronizeVersionMetadata: (
    options: SynchronizeOptions,
  ) => SynchronizeResult;
};

const temporaryDirectories: string[] = [];

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "seqdesk-version-sync-"));
  temporaryDirectories.push(root);
  const launcherDirectory = path.join(root, "npm", "seqdesk");
  mkdirSync(launcherDirectory, { recursive: true });
  const rootPkgPath = path.join(root, "package.json");
  const launcherPkgPath = path.join(launcherDirectory, "package.json");
  const citationPath = path.join(root, "CITATION.cff");
  writeFileSync(
    rootPkgPath,
    `${JSON.stringify({ name: "seqdesk", version: "2.0.0" }, null, 2)}\n`,
  );
  writeFileSync(
    launcherPkgPath,
    `${JSON.stringify({ name: "seqdesk", version: "1.9.0" }, null, 2)}\n`,
  );
  writeFileSync(
    citationPath,
    [
      "cff-version: 1.2.0",
      "title: SeqDesk",
      "version: 1.9.0",
      'date-released: "2026-07-01"',
      "",
    ].join("\n"),
  );
  return { rootPkgPath, launcherPkgPath, citationPath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("release version synchronization", () => {
  it("updates the npm launcher and citation version/date together", () => {
    const fixture = makeFixture();

    expect(
      synchronizeVersionMetadata({
        ...fixture,
        releaseDate: "2026-08-04",
        log: () => undefined,
      }),
    ).toEqual({
      version: "2.0.0",
      launcherUpdated: true,
      citationUpdated: true,
      citationReleaseDate: "2026-08-04",
    });
    expect(
      JSON.parse(readFileSync(fixture.launcherPkgPath, "utf8")).version,
    ).toBe("2.0.0");
    expect(readFileSync(fixture.citationPath, "utf8")).toContain(
      "version: 2.0.0\ndate-released: \"2026-08-04\"",
    );
  });

  it("does not move an existing release date when the version is already current", () => {
    const fixture = makeFixture();
    synchronizeVersionMetadata({
      ...fixture,
      releaseDate: "2026-08-04",
      log: () => undefined,
    });

    expect(
      synchronizeVersionMetadata({
        ...fixture,
        releaseDate: "2026-09-10",
        log: () => undefined,
      }),
    ).toMatchObject({
      launcherUpdated: false,
      citationUpdated: false,
      citationReleaseDate: "2026-08-04",
    });
    expect(readFileSync(fixture.citationPath, "utf8")).toContain(
      'date-released: "2026-08-04"',
    );
  });

  it("validates citation metadata before changing the launcher", () => {
    const fixture = makeFixture();
    writeFileSync(
      fixture.citationPath,
      "cff-version: 1.2.0\ntitle: SeqDesk\nversion: 1.9.0\n",
    );

    expect(() =>
      synchronizeVersionMetadata({
        ...fixture,
        releaseDate: "2026-08-04",
        log: () => undefined,
      }),
    ).toThrow(
      "CITATION.cff must contain exactly one date-released field",
    );
    expect(
      JSON.parse(readFileSync(fixture.launcherPkgPath, "utf8")).version,
    ).toBe("1.9.0");
  });
});
