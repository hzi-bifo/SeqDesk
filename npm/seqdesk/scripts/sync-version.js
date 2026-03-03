"use strict";

const fs = require("node:fs");
const path = require("node:path");

const launcherPkgPath = path.resolve(__dirname, "..", "package.json");
const rootPkgPath = path.resolve(__dirname, "..", "..", "..", "package.json");

const launcherPkg = JSON.parse(fs.readFileSync(launcherPkgPath, "utf8"));
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));

if (!rootPkg.version) {
  console.error("[sync-version] Root package.json has no version field.");
  process.exit(1);
}

if (launcherPkg.version !== rootPkg.version) {
  launcherPkg.version = rootPkg.version;
  fs.writeFileSync(launcherPkgPath, `${JSON.stringify(launcherPkg, null, 2)}\n`);
  console.log(`[sync-version] Updated npm/seqdesk version to ${rootPkg.version}`);
} else {
  console.log(`[sync-version] npm/seqdesk already at ${rootPkg.version}`);
}
