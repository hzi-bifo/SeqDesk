/**
 * Import a TSV, CSV or Excel file as an Explore table from the command line,
 * the same way the import page does it, for large files or scripted setups.
 *
 *   npx tsx scripts/explore-import-file.ts --scope project:<id> --user <userId> \
 *     --file /path/table.xlsx --name "Taxon profiles" --table-kind taxon-profile-long \
 *     [--sheet Sheet1] [--roles sample=A-ID,taxon=taxonName,count=numReads] \
 *     [--id-grammar indivo --id-column A-ID --sample-type-column sample \
 *      --depletion-column depletion --isolate-column isIsolate] [--sensitivity pseudonymous]
 *
 * DATABASE_URL must point at the SeqDesk database (the runtime config is read
 * like the app does). Nothing is uploaded anywhere: the rows go into the
 * database and the dataset folder, like an import through the browser.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";
import { createDataset, getDatasetRecord, serializeDatasetSummary, writeDatasetVersion } from "../src/lib/explore/datasets";
import { getTableKind } from "../src/lib/explore/dataset-kinds";
import { parseImportFile, prepareImport } from "../src/lib/explore/importers/file";
import { parseRoles } from "../src/lib/explore/schema";
import { isValidTargetKey } from "../src/lib/explore/target-key";
import { EXPLORE_SENSITIVITIES, type ExploreSensitivity } from "../src/lib/explore/types";

function readArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const targetKey = args.scope ?? "";
  const userId = args.user ?? "";
  const filePath = args.file ?? "";
  if (!isValidTargetKey(targetKey) || !userId || !filePath) {
    throw new Error("--scope <targetKey>, --user <userId> and --file <path> are required");
  }
  const tableKind = args["table-kind"] ?? null;
  if (tableKind && !getTableKind(tableKind)) throw new Error(`Unknown table kind ${tableKind}`);
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new Error(`No user with id ${userId}`);

  const buffer = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  const idGrammar = args["id-grammar"] === "indivo" && args["id-column"] ? { kind: "indivo" as const, idColumn: args["id-column"], sampleTypeColumn: args["sample-type-column"] ?? null, depletionColumn: args["depletion-column"] ?? null, isolateColumn: args["isolate-column"] ?? null } : null;
  const parsed = await parseImportFile(buffer, { fileName, sheet: args.sheet ?? null, idGrammar });
  if (parsed.rows.length === 0) throw new Error("The file has no data rows");
  for (const warning of parsed.warnings) console.warn(`warning: ${warning}`);

  const roleOverrides = args.roles
    ? parseRoles(JSON.stringify(Object.fromEntries(args.roles.split(",").map((pair) => pair.split("=").map((part) => part.trim()) as [string, string]))))
    : {};
  const prepared = prepareImport(parsed, { tableKind, roles: roleOverrides, fileName, checksum });
  for (const warning of prepared.warnings) console.warn(`warning: ${warning}`);
  const requested = args.sensitivity as ExploreSensitivity | undefined;
  const sensitivity = requested && EXPLORE_SENSITIVITIES.includes(requested) ? requested : prepared.sensitivity;

  const created = await createDataset({
    targetKey,
    kind: "external",
    tableKind,
    name: args.name ?? fileName.replace(/\.[^.]+$/, ""),
    description: `Imported from ${fileName}`,
    sensitivity,
    roles: prepared.roles,
    sourceConfig: { builder: "import", fileName, checksum, idGrammar: idGrammar?.kind ?? null, idColumn: idGrammar?.idColumn ?? null },
    createdById: userId,
  });
  const version = await writeDatasetVersion({
    datasetId: created.id,
    schema: prepared.schema,
    rows: prepared.rows,
    provenance: prepared.provenance,
    buildSource: "import",
    createdById: userId,
    keys: prepared.keys,
  });
  const record = await getDatasetRecord(created.id);
  console.log(JSON.stringify({ dataset: record ? serializeDatasetSummary(record) : { id: created.id }, version: { number: version.number, rowCount: version.rowCount }, roles: prepared.roles }, null, 2));
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await db.$disconnect();
    process.exit(1);
  });
