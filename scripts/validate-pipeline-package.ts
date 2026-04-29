import fs from "fs";
import path from "path";
import { lintPipelineDescriptor } from "../src/lib/pipelines/descriptor-linter";

async function run(): Promise<number> {
  const requestedPath = process.argv[2];
  const pipelinesDir = requestedPath
    ? path.resolve(requestedPath)
    : path.join(process.cwd(), "pipelines");

  if (!fs.existsSync(pipelinesDir)) {
    console.error("Pipeline path not found:", pipelinesDir);
    return 1;
  }

  const stat = fs.statSync(pipelinesDir);
  const packageDirs = stat.isDirectory() && fs.existsSync(path.join(pipelinesDir, "manifest.json"))
    ? [pipelinesDir]
    : fs.readdirSync(pipelinesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(pipelinesDir, entry.name))
        .filter((dir) => {
          const name = path.basename(dir);
          return !name.startsWith(".") && !name.startsWith("_");
        });

  const results = await Promise.all(
    packageDirs.map((packageDir) => lintPipelineDescriptor(packageDir))
  );
  const issues = results.flatMap((result) =>
    result.issues.map((issue) => ({ ...issue, packageId: result.packageId }))
  );
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");

  for (const issue of issues) {
    const prefix = issue.level === "error" ? "ERROR" : "WARN";
    const location = issue.file ? ` (${issue.file})` : "";
    console.log(`[${prefix}] ${issue.packageId}: ${issue.message}${location}`);
  }

  console.log(
    `Checked ${results.length} package(s): ${errors.length} error(s), ${warnings.length} warning(s)`
  );

  return errors.length > 0 ? 1 : 0;
}

run()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
