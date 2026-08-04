"use strict";

const fs = require("node:fs");
const path = require("node:path");

const defaultLauncherPkgPath = path.resolve(__dirname, "..", "package.json");
const defaultRepositoryRoot = path.resolve(__dirname, "..", "..", "..");
const defaultRootPkgPath = path.join(defaultRepositoryRoot, "package.json");
const defaultCitationPath = path.join(defaultRepositoryRoot, "CITATION.cff");

function readSingleYamlScalar(content, field) {
  const expression = new RegExp(`^${field}:\\s*(.+?)\\s*$`, "gm");
  const matches = [...content.matchAll(expression)];
  if (matches.length !== 1) {
    throw new Error(
      `[sync-version] CITATION.cff must contain exactly one ${field} field.`,
    );
  }
  const rawValue = matches[0][1].trim();
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

function replaceSingleYamlField(content, field, renderedValue) {
  const expression = new RegExp(`^${field}:\\s*.+?\\s*$`, "gm");
  const matches = [...content.matchAll(expression)];
  if (matches.length !== 1) {
    throw new Error(
      `[sync-version] CITATION.cff must contain exactly one ${field} field.`,
    );
  }
  return content.replace(expression, `${field}: ${renderedValue}`);
}

function synchronizeVersionMetadata({
  launcherPkgPath = defaultLauncherPkgPath,
  rootPkgPath = defaultRootPkgPath,
  citationPath = defaultCitationPath,
  releaseDate = new Date().toISOString().slice(0, 10),
  log = console.log,
} = {}) {
  const launcherPkg = JSON.parse(fs.readFileSync(launcherPkgPath, "utf8"));
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
  const citation = fs.readFileSync(citationPath, "utf8");

  if (typeof rootPkg.version !== "string" || !rootPkg.version.trim()) {
    throw new Error("[sync-version] Root package.json has no version field.");
  }

  const citationVersion = readSingleYamlScalar(citation, "version");
  const citationReleaseDate = readSingleYamlScalar(citation, "date-released");
  const launcherUpdated = launcherPkg.version !== rootPkg.version;
  const citationUpdated = citationVersion !== rootPkg.version;

  let nextCitation = citation;
  if (citationUpdated) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
      throw new Error(
        `[sync-version] Release date must use YYYY-MM-DD format: ${releaseDate}`,
      );
    }
    nextCitation = replaceSingleYamlField(
      nextCitation,
      "version",
      rootPkg.version,
    );
    nextCitation = replaceSingleYamlField(
      nextCitation,
      "date-released",
      `"${releaseDate}"`,
    );
  }

  // Validate every input and render every update before changing either file.
  // This prevents a malformed CITATION.cff from leaving the launcher half-synced.
  if (launcherUpdated) {
    launcherPkg.version = rootPkg.version;
    fs.writeFileSync(
      launcherPkgPath,
      `${JSON.stringify(launcherPkg, null, 2)}\n`,
    );
    log(`[sync-version] Updated npm/seqdesk version to ${rootPkg.version}`);
  } else {
    log(`[sync-version] npm/seqdesk already at ${rootPkg.version}`);
  }

  if (citationUpdated) {
    fs.writeFileSync(citationPath, nextCitation, "utf8");
    log(
      `[sync-version] Updated CITATION.cff to ${rootPkg.version} (${releaseDate})`,
    );
  } else {
    log(`[sync-version] CITATION.cff already at ${rootPkg.version}`);
  }

  return {
    version: rootPkg.version,
    launcherUpdated,
    citationUpdated,
    citationReleaseDate: citationUpdated ? releaseDate : citationReleaseDate,
  };
}

if (require.main === module) {
  try {
    synchronizeVersionMetadata();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = { synchronizeVersionMetadata };
