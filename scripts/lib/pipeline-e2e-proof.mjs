import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  formatHalfEvenBinary64,
  formatSeqkit28RoundedBinary64,
} from "./decimal-rounding.mjs";
import { resolveFastqcMeanSequenceQualityForEncoding } from "./fastq-ground-truth.mjs";

// Shared-storage metadata and negative-entry caches can outlive scheduler
// accounting by tens of seconds. Every SLURM E2E harness uses this same named,
// bounded window and still fails closed if required proof is not visible.
export const SLURM_PROOF_VISIBILITY_TIMEOUT_MS = 90_000;
export const SLURM_PROOF_VISIBILITY_POLL_INTERVAL_MS = 1_000;
export const FASTQC_INPUT_EVIDENCE_BASENAME =
  ".seqdesk-e2e-fastqc-input-evidence-v1.json";
export const FASTQC_INPUT_EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const FASTQC_INPUT_EVIDENCE_SCHEMA = "seqdesk-fastqc-input-evidence";

const SLURM_TERMINAL_STATES = new Set([
  "BOOT_FAIL",
  "CANCELLED",
  "CANCELED",
  "COMPLETED",
  "DEADLINE",
  "FAILED",
  "NODE_FAIL",
  "OUT_OF_MEMORY",
  "PREEMPTED",
  "REVOKED",
  "TIMEOUT",
]);

function fail(message, details) {
  throw new Error(details ? `${message}\n${details}` : message);
}

const RUNTIME_WRITEBACK_KINDS = new Set([
  "artifacts",
  "checksum",
  "completes",
  "replace",
]);

export function createUniqueProofRecord(entries, context) {
  if (!Array.isArray(entries)) {
    fail(`${context} declarations must be an array`);
  }

  const record = {};
  for (const entry of entries) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      entry[0].trim().length === 0
    ) {
      fail(`${context} contains an invalid key/value declaration`);
    }
    const [key, value] = entry;
    if (Object.hasOwn(record, key)) {
      fail(`${context} declares duplicate key ${key}`);
    }
    record[key] = value;
  }
  return Object.freeze(record);
}

/**
 * Validate the runtime harness' proof declarations before it creates a run.
 * Object-literal duplicate keys are legal JavaScript and silently keep only
 * the last value, so this guard deliberately checks the effective runtime
 * shape rather than trusting source-level string assertions.
 */
export function assertRuntimeProofContracts({
  writebackSpec,
  artifactContentMarkers,
}) {
  if (
    !writebackSpec ||
    typeof writebackSpec !== "object" ||
    Array.isArray(writebackSpec)
  ) {
    fail("Runtime writeback proof contract must be an object");
  }
  if (
    !artifactContentMarkers ||
    typeof artifactContentMarkers !== "object" ||
    Array.isArray(artifactContentMarkers)
  ) {
    fail("Runtime artifact marker contract must be an object");
  }

  const artifactOutputsByPipeline = new Map();
  for (const [pipelineId, spec] of Object.entries(writebackSpec)) {
    if (!pipelineId || !spec || typeof spec !== "object" || Array.isArray(spec)) {
      fail(
        `Runtime writeback proof for ${pipelineId || "<empty>"} must be an object`,
      );
    }
    if (!RUNTIME_WRITEBACK_KINDS.has(spec.kind)) {
      fail(
        `Runtime writeback proof for ${pipelineId} has unsupported or missing kind`,
        JSON.stringify({ kind: spec.kind ?? null }, null, 2),
      );
    }

    if (spec.kind !== "artifacts") continue;
    const outputIds = Array.isArray(spec.requiredOutputIds)
      ? spec.requiredOutputIds
      : [];
    const validOutputIds = outputIds.filter(
      (outputId) => typeof outputId === "string" && outputId.trim().length > 0,
    );
    if (
      validOutputIds.length === 0 ||
      validOutputIds.length !== outputIds.length ||
      new Set(validOutputIds).size !== validOutputIds.length
    ) {
      fail(
        `Runtime artifact proof for ${pipelineId} needs unique non-empty requiredOutputIds`,
        JSON.stringify({ requiredOutputIds: outputIds }, null, 2),
      );
    }
    artifactOutputsByPipeline.set(pipelineId, new Set(validOutputIds));
  }

  for (const [pipelineId, outputMarkers] of Object.entries(
    artifactContentMarkers,
  )) {
    const declaredOutputs = artifactOutputsByPipeline.get(pipelineId);
    if (!declaredOutputs) {
      fail(
        `Runtime content markers for ${pipelineId} require an artifacts writeback proof`,
      );
    }
    if (
      !outputMarkers ||
      typeof outputMarkers !== "object" ||
      Array.isArray(outputMarkers)
    ) {
      fail(`Runtime content markers for ${pipelineId} must be an object`);
    }

    for (const [outputId, markerSpec] of Object.entries(outputMarkers)) {
      if (!declaredOutputs.has(outputId)) {
        fail(
          `Runtime content marker ${pipelineId}/${outputId} is not a declared required artifact`,
        );
      }
      const markers =
        markerSpec && typeof markerSpec === "object" && !Array.isArray(markerSpec)
          ? markerSpec.markers
          : null;
      if (
        !Array.isArray(markers) ||
        markers.length === 0 ||
        markers.some(
          (marker) => typeof marker !== "string" || marker.trim().length === 0,
        )
      ) {
        fail(
          `Runtime content marker ${pipelineId}/${outputId} needs non-empty string markers`,
        );
      }
    }
  }

  return {
    pipelineCount: Object.keys(writebackSpec).length,
    contentMarkerPipelineCount: Object.keys(artifactContentMarkers).length,
  };
}

export function normalizeSlurmState(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)[0]
    .replace(/\+$/, "")
    .toUpperCase();
}

export function expectedSeqDeskJobName(runId) {
  const safeRunId = String(runId || "")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 48);
  return `seqdesk-${safeRunId}`;
}

function canonicalPathForComparison(value) {
  const resolved = path.resolve(value);
  let existingAncestor = resolved;
  const missingSegments = [];
  while (true) {
    try {
      const canonicalAncestor = fs.realpathSync.native(existingAncestor);
      return path.join(canonicalAncestor, ...missingSegments);
    } catch {
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        // Extremely defensive fallback for an inaccessible filesystem root.
        return resolved;
      }
      missingSegments.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

export function pathsReferToSameLocation(candidate, expected) {
  if (!candidate || !expected) return false;
  return (
    canonicalPathForComparison(candidate) ===
    canonicalPathForComparison(expected)
  );
}

export function pathIsWithin(candidate, expectedRoot) {
  if (!candidate || !expectedRoot) return false;
  const relative = path.relative(
    canonicalPathForComparison(expectedRoot),
    canonicalPathForComparison(candidate),
  );
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/**
 * Validate the write-once evidence captured while a FastQC run's raw inputs
 * still exist. Later pipeline steps may legitimately replace and remove those
 * FASTQs, so MultiQC must prove its historical inputs from this record plus
 * the preserved FastQC ZIP rather than silently binding to a newer active Read.
 */
export function assertFastqcInputEvidenceSnapshot({
  snapshot,
  expectedRunId,
  expectedOrderId,
  expectedRunFolder,
  expectedSamplesheetPath,
  expectedSamplesheetSha256,
  expectedInputs,
  dataBasePath,
  requireExistingInputs = false,
  context,
}) {
  const label =
    typeof context === "string" && context.trim()
      ? context.trim()
      : "FastQC input evidence";
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    snapshot.schema !== FASTQC_INPUT_EVIDENCE_SCHEMA ||
    snapshot.version !== 1 ||
    typeof expectedRunId !== "string" ||
    !expectedRunId ||
    typeof expectedOrderId !== "string" ||
    !expectedOrderId ||
    typeof expectedRunFolder !== "string" ||
    !path.isAbsolute(expectedRunFolder) ||
    typeof expectedSamplesheetPath !== "string" ||
    !path.isAbsolute(expectedSamplesheetPath) ||
    !SHA256_HEX.test(String(expectedSamplesheetSha256 || "")) ||
    !Array.isArray(expectedInputs) ||
    expectedInputs.length === 0 ||
    typeof dataBasePath !== "string" ||
    !path.isAbsolute(dataBasePath)
  ) {
    fail(`${label}: snapshot contract is invalid`);
  }
  let canonicalDataBasePath;
  try {
    canonicalDataBasePath = fs.realpathSync.native(path.resolve(dataBasePath));
    if (!fs.statSync(canonicalDataBasePath).isDirectory()) {
      fail(`${label}: sequencing storage root is not a directory`);
    }
  } catch (error) {
    fail(
      `${label}: sequencing storage root is inaccessible`,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (
    snapshot.runId !== expectedRunId ||
    snapshot.orderId !== expectedOrderId ||
    snapshot?.samplesheet?.path !== expectedSamplesheetPath ||
    snapshot?.samplesheet?.sha256 !== expectedSamplesheetSha256
  ) {
    fail(
      `${label}: snapshot run, order, or samplesheet binding does not match`,
      JSON.stringify(
        {
          expectedRunId,
          snapshotRunId: snapshot.runId ?? null,
          expectedOrderId,
          snapshotOrderId: snapshot.orderId ?? null,
          expectedSamplesheetPath,
          snapshotSamplesheetPath: snapshot?.samplesheet?.path ?? null,
          expectedSamplesheetSha256,
          snapshotSamplesheetSha256: snapshot?.samplesheet?.sha256 ?? null,
        },
        null,
        2,
      ),
    );
  }

  const expectedByIdentity = new Map();
  for (const expected of expectedInputs) {
    const identity =
      typeof expected?.identity === "string" ? expected.identity.trim() : "";
    const sampleId =
      typeof expected?.sampleId === "string" ? expected.sampleId.trim() : "";
    const sampleRecordId =
      typeof expected?.sampleRecordId === "string"
        ? expected.sampleRecordId.trim()
        : "";
    const mate = expected?.mate;
    const inputPath =
      typeof expected?.inputPath === "string" ? expected.inputPath : "";
    if (
      !identity ||
      identity !== `${sampleId}/${mate}` ||
      !sampleRecordId ||
      !["R1", "R2"].includes(mate) ||
      !path.isAbsolute(inputPath) ||
      expectedByIdentity.has(identity)
    ) {
      fail(`${label}: expected input declarations are invalid or duplicated`);
    }
    expectedByIdentity.set(identity, {
      identity,
      sampleId,
      sampleRecordId,
      mate,
      inputPath,
    });
  }

  if (!Array.isArray(snapshot.inputs)) {
    fail(`${label}: snapshot inputs must be an array`);
  }
  assertExactSampleCoverage({
    expectedSampleIds: Array.from(expectedByIdentity.keys()),
    observedSampleIds: snapshot.inputs.map((entry) => entry?.identity),
    context: `${label} input coverage`,
    unit: "sample/mate input",
  });

  const entriesByIdentity = new Map();
  for (const entry of snapshot.inputs) {
    const expected = expectedByIdentity.get(entry?.identity);
    const storageRelativePath =
      typeof entry?.storageRelativePath === "string"
        ? entry.storageRelativePath
        : "";
    const reconstructedCanonicalInputPath = storageRelativePath
      ? path.resolve(canonicalDataBasePath, storageRelativePath)
      : "";
    const fastqc = entry?.fastqc;
    if (
      !expected ||
      entry.sampleId !== expected.sampleId ||
      entry.sampleRecordId !== expected.sampleRecordId ||
      entry.mate !== expected.mate ||
      typeof entry.readRecordId !== "string" ||
      !entry.readRecordId ||
      entry.inputPath !== expected.inputPath ||
      typeof entry.inputCanonicalPath !== "string" ||
      !path.isAbsolute(entry.inputCanonicalPath) ||
      entry.inputBasename !== path.basename(expected.inputPath) ||
      !storageRelativePath ||
      path.isAbsolute(storageRelativePath) ||
      storageRelativePath === ".." ||
      storageRelativePath.startsWith(`..${path.sep}`) ||
      path.normalize(entry.inputCanonicalPath) !==
        reconstructedCanonicalInputPath ||
      (requireExistingInputs &&
        (!pathsReferToSameLocation(
          entry.inputPath,
          entry.inputCanonicalPath,
        ) ||
          !pathIsWithin(entry.inputCanonicalPath, dataBasePath))) ||
      !Number.isSafeInteger(entry.inputSize) ||
      entry.inputSize <= 0 ||
      !SHA256_HEX.test(String(entry.inputSha256 || "")) ||
      !Number.isSafeInteger(entry.readCount) ||
      entry.readCount <= 0 ||
      !fastqc ||
      typeof fastqc !== "object" ||
      Array.isArray(fastqc) ||
      typeof fastqc.artifactId !== "string" ||
      !fastqc.artifactId ||
      typeof fastqc.artifactPath !== "string" ||
      !path.isAbsolute(fastqc.artifactPath) ||
      !pathIsWithin(fastqc.artifactPath, expectedRunFolder) ||
      fastqc.artifactBasename !== path.basename(fastqc.artifactPath) ||
      !Number.isSafeInteger(fastqc.artifactSize) ||
      fastqc.artifactSize <= 0 ||
      !SHA256_HEX.test(String(fastqc.artifactSha256 || "")) ||
      fastqc.filename !== entry.inputBasename ||
      !Number.isSafeInteger(fastqc.totalSequences) ||
      fastqc.totalSequences !== entry.readCount ||
      !Number.isSafeInteger(fastqc.meanSequenceQualityNumerator) ||
      fastqc.meanSequenceQualityNumerator < 0 ||
      !Number.isSafeInteger(fastqc.meanSequenceQualityDenominator) ||
      fastqc.meanSequenceQualityDenominator !== fastqc.totalSequences
    ) {
      fail(
        `${label}: snapshot entry is malformed or does not match ${entry?.identity ?? "<unknown>"}`,
        JSON.stringify(entry ?? null, null, 2),
      );
    }
    entriesByIdentity.set(entry.identity, entry);
  }

  if (entriesByIdentity.size !== expectedByIdentity.size) {
    fail(
      `${label}: snapshot input identities are not unique`,
    );
  }
  return {
    entriesByIdentity,
    inputCount: entriesByIdentity.size,
  };
}

export function writeFastqcInputEvidenceSnapshotFile({
  filePath,
  snapshot,
  context,
}) {
  const label =
    typeof context === "string" && context.trim()
      ? context.trim()
      : "FastQC input evidence";
  if (
    typeof filePath !== "string" ||
    !path.isAbsolute(filePath) ||
    path.basename(filePath) !== FASTQC_INPUT_EVIDENCE_BASENAME
  ) {
    fail(`${label}: evidence path is invalid`);
  }
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  const bytes = Buffer.byteLength(body);
  if (bytes <= 0 || bytes > FASTQC_INPUT_EVIDENCE_MAX_BYTES) {
    fail(`${label}: evidence exceeds the allowed size`);
  }

  const assertExistingMatches = () => {
    let existing;
    try {
      const stat = fs.lstatSync(filePath);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.size <= 0 ||
        stat.size > FASTQC_INPUT_EVIDENCE_MAX_BYTES
      ) {
        fail(`${label}: existing evidence is not a safe regular file`);
      }
      existing = fs.readFileSync(filePath, "utf8");
    } catch (readError) {
      fail(
        `${label}: could not validate existing evidence`,
        readError instanceof Error ? readError.message : String(readError),
      );
    }
    if (existing !== body) {
      fail(`${label}: refusing to overwrite different existing evidence`);
    }
  };

  let handle;
  let created = false;
  try {
    // O_EXCL is supported on the shared run filesystem and guarantees that a
    // second proof process cannot replace evidence from the first one. MultiQC
    // runs only after this FastQC process exits, so fsync-before-close also
    // keeps a partially written file from being accepted by a consumer.
    handle = fs.openSync(filePath, "wx", 0o400);
    fs.writeFileSync(handle, body, { encoding: "utf8" });
    fs.fsyncSync(handle);
    created = true;
  } catch (error) {
    if (error?.code === "EEXIST") {
      assertExistingMatches();
    } else {
      fail(
        `${label}: could not create write-once evidence`,
        error instanceof Error ? error.message : String(error),
      );
    }
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
  if (created) {
    fs.chmodSync(filePath, 0o444);
  }
  assertExistingMatches();

  return {
    path: filePath,
    bytes,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
}

export function assertExactSampleCoverage({
  expectedSampleIds,
  observedSampleIds,
  context,
  unit = "target sample",
}) {
  if (!Array.isArray(expectedSampleIds) || !Array.isArray(observedSampleIds)) {
    fail(`${context}: expected and observed ${unit} IDs must be arrays`);
  }
  const expected = [...expectedSampleIds];
  const observed = [...observedSampleIds];
  const invalidExpected = expected.flatMap((sampleId, index) =>
    typeof sampleId === "string" && sampleId.trim().length > 0
      ? []
      : [{ index, value: sampleId ?? null }],
  );
  const invalidObserved = observed.flatMap((sampleId, index) =>
    typeof sampleId === "string" && sampleId.trim().length > 0
      ? []
      : [{ index, value: sampleId ?? null }],
  );
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  const missing = expected.filter((sampleId) => !observedSet.has(sampleId));
  const unexpected = observed.filter((sampleId) => !expectedSet.has(sampleId));
  const duplicateExpected = expected.length !== expectedSet.size;
  const duplicateObserved = observed.length !== observedSet.size;
  if (
    expected.length === 0 ||
    invalidExpected.length > 0 ||
    invalidObserved.length > 0 ||
    missing.length > 0 ||
    unexpected.length > 0 ||
    duplicateExpected ||
    duplicateObserved ||
    observed.length !== expected.length
  ) {
    fail(
      `${context}: output does not cover every ${unit} exactly once`,
      JSON.stringify(
        {
          expectedSampleIds: expected,
          observedSampleIds: observed,
          invalidExpected,
          invalidObserved,
          missing,
          unexpected,
          duplicateExpected,
          duplicateObserved,
        },
        null,
        2,
      ),
    );
  }
  return {
    expectedSampleCount: expected.length,
    observedSampleCount: observed.length,
    sampleIds: expected,
  };
}

export function assertExactAttributedReadSampleCoverage({
  expectedSampleIds,
  attributedReads,
  context,
}) {
  if (!Array.isArray(attributedReads)) {
    fail(`${context}: attributed reads must be an array`);
  }
  return assertExactSampleCoverage({
    expectedSampleIds,
    observedSampleIds: attributedReads.map((read) => read?.sampleId),
    context,
  });
}

export function assertExactActiveRunAttributedReadCoverage({
  expectedSampleIds,
  activeReads,
  runId,
  context,
}) {
  if (!Array.isArray(activeReads)) {
    fail(`${context}: active reads must be an array`);
  }
  if (typeof runId !== "string" || runId.length === 0) {
    fail(`${context}: run ID is required for active Read attribution`);
  }
  const notAttributed = activeReads.filter(
    (read) => read?.pipelineRunId !== runId,
  );
  if (notAttributed.length > 0) {
    fail(
      `${context}: every active Read must be attributed to run ${runId}`,
      JSON.stringify(
        {
          runId,
          notAttributed: notAttributed.map((read) => ({
            id: read?.id ?? null,
            sampleId: read?.sampleId ?? null,
            pipelineRunId: read?.pipelineRunId ?? null,
          })),
        },
        null,
        2,
      ),
    );
  }
  return assertExactAttributedReadSampleCoverage({
    expectedSampleIds,
    attributedReads: activeReads,
    context,
  });
}

export function assertStudyDemoSummaryRows({
  samplesheetHeader,
  samplesheetRows,
  summaryHeader,
  summaryRows,
  expectedSampleIds,
  studyId,
  studyTitle,
  context,
}) {
  const expectedInputHeader = ["sample_id", "study_id", "study_title"];
  const expectedOutputHeader = [...expectedInputHeader, "row_number"];
  if (
    !Array.isArray(samplesheetHeader) ||
    samplesheetHeader.length !== expectedInputHeader.length ||
    samplesheetHeader.some(
      (value, index) => value !== expectedInputHeader[index],
    )
  ) {
    fail(
      `${context}: samplesheet header is not the exact study-demo contract`,
      JSON.stringify({ samplesheetHeader, expectedInputHeader }, null, 2),
    );
  }
  if (
    !Array.isArray(summaryHeader) ||
    summaryHeader.length !== expectedOutputHeader.length ||
    summaryHeader.some(
      (value, index) => value !== expectedOutputHeader[index],
    )
  ) {
    fail(
      `${context}: summary header is not the exact study-demo contract`,
      JSON.stringify({ summaryHeader, expectedOutputHeader }, null, 2),
    );
  }
  if (!Array.isArray(samplesheetRows) || !Array.isArray(summaryRows)) {
    fail(`${context}: samplesheet and summary rows must be arrays`);
  }
  if (
    typeof studyId !== "string" ||
    !studyId ||
    typeof studyTitle !== "string" ||
    !studyTitle
  ) {
    fail(`${context}: expected study ID and title must be non-empty`);
  }

  const parsedInputs = samplesheetRows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== expectedInputHeader.length) {
      fail(`${context}: samplesheet row ${index + 1} has the wrong width`);
    }
    const [sampleId, rowStudyId, rowStudyTitle] = row;
    if (
      typeof sampleId !== "string" ||
      !sampleId ||
      rowStudyId !== studyId ||
      rowStudyTitle !== studyTitle
    ) {
      fail(
        `${context}: samplesheet row ${index + 1} does not match the target study`,
        JSON.stringify(
          {
            row,
            expectedStudyId: studyId,
            expectedStudyTitle: studyTitle,
          },
          null,
          2,
        ),
      );
    }
    return { sampleId, studyId: rowStudyId, studyTitle: rowStudyTitle };
  });
  const parsedOutputs = summaryRows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== expectedOutputHeader.length) {
      fail(`${context}: summary row ${index + 1} has the wrong width`);
    }
    return row;
  });

  const inputCoverage = assertExactSampleCoverage({
    expectedSampleIds,
    observedSampleIds: parsedInputs.map((row) => row.sampleId),
    context: `${context} samplesheet`,
  });
  const outputCoverage = assertExactSampleCoverage({
    expectedSampleIds,
    observedSampleIds: parsedOutputs.map((row) => row[0]),
    context: `${context} summary`,
  });
  if (parsedInputs.length !== parsedOutputs.length) {
    fail(`${context}: samplesheet and summary row counts differ`);
  }
  for (let index = 0; index < parsedInputs.length; index += 1) {
    const input = parsedInputs[index];
    const expectedRow = [
      input.sampleId,
      input.studyId,
      input.studyTitle,
      String(index + 1),
    ];
    const actualRow = parsedOutputs[index];
    if (
      actualRow.length !== expectedRow.length ||
      actualRow.some((value, column) => value !== expectedRow[column])
    ) {
      fail(
        `${context}: summary row ${index + 1} does not exactly preserve samplesheet order and study fields`,
        JSON.stringify({ actualRow, expectedRow }, null, 2),
      );
    }
  }

  return {
    sampleCount: inputCoverage.expectedSampleCount,
    samplesheetRowsChecked: inputCoverage.observedSampleCount,
    summaryRowsChecked: outputCoverage.observedSampleCount,
    studyId,
    studyTitle,
  };
}

function requireUniqueColumns(header, requiredColumns, context) {
  if (!Array.isArray(header)) {
    fail(`${context}: summary header must be an array`);
  }
  const columns = new Map();
  for (const name of requiredColumns) {
    const matches = header.flatMap((value, index) =>
      value === name ? [index] : [],
    );
    if (matches.length !== 1) {
      fail(
        `${context}: summary must contain exactly one ${name} column`,
        JSON.stringify({ header, column: name, matches }, null, 2),
      );
    }
    columns.set(name, matches[0]);
  }
  return columns;
}

function parsePositiveSummaryInteger(value, { field, identity, context }) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) {
    fail(
      `${context}: ${field} is not an integer for ${identity}`,
      JSON.stringify({ identity, field, value: value ?? null }, null, 2),
    );
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail(
      `${context}: ${field} is not a positive safe integer for ${identity}`,
      JSON.stringify({ identity, field, value }, null, 2),
    );
  }
  return parsed;
}

function parseNonNegativeSummaryNumber(value, {
  field,
  identity,
  context,
  max,
}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    fail(
      `${context}: ${field} is not a non-negative decimal for ${identity}`,
      JSON.stringify({ identity, field, value: value ?? null }, null, 2),
    );
  }
  const parsed = Number(text);
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    (Number.isFinite(max) && parsed > max)
  ) {
    fail(
      `${context}: ${field} is outside the expected range for ${identity}`,
      JSON.stringify({ identity, field, value, max: max ?? null }, null, 2),
    );
  }
  return { parsed, text };
}

function normalizeGroundTruthByIdentity({
  groundTruthByIdentity,
  expectedIdentities,
  context,
}) {
  if (groundTruthByIdentity == null) return null;
  const entries =
    groundTruthByIdentity instanceof Map
      ? Array.from(groundTruthByIdentity.entries())
      : groundTruthByIdentity &&
          typeof groundTruthByIdentity === "object" &&
          !Array.isArray(groundTruthByIdentity)
        ? Object.entries(groundTruthByIdentity)
        : null;
  if (!entries) {
    fail(`${context}: FASTQ ground truth must be supplied as a Map or object`);
  }
  assertExactSampleCoverage({
    expectedSampleIds: expectedIdentities,
    observedSampleIds: entries.map(([identity]) => identity),
    context: `${context} FASTQ ground truth`,
    unit: "target sample/read-end metric set",
  });
  const normalized = new Map();
  for (const [identity, metrics] of entries) {
    if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
      fail(`${context}: FASTQ ground truth is malformed for ${identity}`);
    }
    normalized.set(identity, metrics);
  }
  return normalized;
}

function assertExactGroundTruthInteger({
  actual,
  expected,
  field,
  identity,
  context,
}) {
  if (!Number.isSafeInteger(expected) || expected <= 0 || actual !== expected) {
    fail(
      `${context}: ${field} does not match independent FASTQ ground truth for ${identity}`,
      JSON.stringify({ identity, field, summary: actual, groundTruth: expected ?? null }, null, 2),
    );
  }
}

function assertFixedPrecisionGroundTruthNumber({
  actualText,
  expected,
  expectedText: expectedTextOverride,
  decimalPlaces,
  tool,
  field,
  identity,
  context,
}) {
  if (!Number.isFinite(expected)) {
    fail(`${context}: independent FASTQ ${field} is invalid for ${identity}`);
  }
  if (!Number.isSafeInteger(decimalPlaces) || decimalPlaces < 0) {
    fail(`${context}: ${field} has no valid expected output precision`);
  }
  const fixedPattern =
    decimalPlaces === 0
      ? /^\d+$/
      : new RegExp(`^\\d+\\.\\d{${decimalPlaces}}$`);
  if (typeof expectedTextOverride !== "string") {
    fail(
      `${context}: ${tool} expected ${field} formatting semantics were not supplied for ${identity}`,
    );
  }
  const expectedText = expectedTextOverride;
  if (!fixedPattern.test(expectedText)) {
    fail(
      `${context}: ${tool} produced an invalid expected ${field} representation for ${identity}`,
    );
  }
  if (!fixedPattern.test(actualText) || actualText !== expectedText) {
    fail(
      `${context}: ${field} does not match ${tool} fixed-precision FASTQ ground truth for ${identity}`,
      JSON.stringify(
        {
          identity,
          field,
          summary: actualText,
          groundTruth: expected,
          expectedText,
          tool,
          decimalPlaces,
        },
        null,
        2,
      ),
    );
  }
}

function assertSummaryEqualsWriteback({
  actual,
  expected,
  field,
  identity,
  context,
}) {
  const expectedNumber = Number(expected);
  if (!Number.isFinite(expectedNumber) || actual !== expectedNumber) {
    fail(
      `${context}: summary ${field} does not match the Read writeback for ${identity}`,
      JSON.stringify(
        {
          identity,
          field,
          summary: actual,
          readWriteback: expected ?? null,
        },
        null,
        2,
      ),
    );
  }
}

const READS_QC_REQUIRED_COLUMNS = [
  "sample_id",
  "read_end",
  "num_reads",
  "total_bases",
  "min_len",
  "avg_len",
  "max_len",
  "avg_quality",
  "gc_content",
  "q20_pct",
  "q30_pct",
  "n50",
];

/**
 * Prove reads-QC output and DB writeback together. A paired selected Read must
 * contribute one R1 and one R2 row; a single-end Read contributes only R1.
 */
export function assertReadsQcSummaryRows({
  header,
  rows,
  expectedSamples,
  groundTruthByIdentity,
  context,
}) {
  if (!Array.isArray(rows)) {
    fail(`${context}: reads-QC summary rows must be an array`);
  }
  if (!Array.isArray(expectedSamples) || expectedSamples.length === 0) {
    fail(`${context}: no selected Reads were supplied for reads-QC verification`);
  }
  const column = requireUniqueColumns(
    header,
    READS_QC_REQUIRED_COLUMNS,
    context,
  );

  const expectedByIdentity = new Map();
  for (const sample of expectedSamples) {
    const sampleId = sample?.sampleId;
    if (typeof sampleId !== "string" || sampleId.trim().length === 0) {
      fail(`${context}: selected Read has an invalid sample ID`);
    }
    const readEnds = sample?.pairedEnd ? ["R1", "R2"] : ["R1"];
    for (const readEnd of readEnds) {
      const identity = JSON.stringify([sampleId, readEnd]);
      if (expectedByIdentity.has(identity)) {
        fail(`${context}: selected Reads contain duplicate ${sampleId}/${readEnd}`);
      }
      expectedByIdentity.set(identity, { sample, sampleId, readEnd });
    }
  }

  const parsedRows = rows.map((row, index) => {
    if (!Array.isArray(row)) {
      fail(`${context}: reads-QC summary contains a non-array row at index ${index}`);
    }
    const sampleId = row[column.get("sample_id")];
    const readEnd = row[column.get("read_end")];
    if (typeof sampleId !== "string" || sampleId.trim().length === 0) {
      fail(`${context}: reads-QC summary contains an invalid sample_id at row ${index + 1}`);
    }
    if (readEnd !== "R1" && readEnd !== "R2") {
      fail(
        `${context}: reads-QC summary has invalid read_end for sample ${sampleId}`,
        JSON.stringify({ sampleId, readEnd: readEnd ?? null }, null, 2),
      );
    }
    return {
      row,
      sampleId,
      readEnd,
      identity: JSON.stringify([sampleId, readEnd]),
    };
  });

  const coverage = assertExactSampleCoverage({
    expectedSampleIds: Array.from(expectedByIdentity.keys()),
    observedSampleIds: parsedRows.map((entry) => entry.identity),
    context,
    unit: "target sample/read-end",
  });
  const groundTruth = normalizeGroundTruthByIdentity({
    groundTruthByIdentity,
    expectedIdentities: Array.from(expectedByIdentity.keys()).map((identity) => {
      const [sampleId, readEnd] = JSON.parse(identity);
      return `${sampleId}/${readEnd}`;
    }),
    context,
  });

  for (const entry of parsedRows) {
    const expected = expectedByIdentity.get(entry.identity);
    if (!expected) {
      fail(`${context}: reads-QC summary contains unexpected ${entry.sampleId}/${entry.readEnd}`);
    }
    const identity = `${entry.sampleId}/${entry.readEnd}`;
    const count = parsePositiveSummaryInteger(entry.row[column.get("num_reads")], {
      field: "num_reads",
      identity,
      context,
    });
    const totalBases = parsePositiveSummaryInteger(entry.row[column.get("total_bases")], {
      field: "total_bases",
      identity,
      context,
    });
    const minLength = parsePositiveSummaryInteger(entry.row[column.get("min_len")], {
      field: "min_len",
      identity,
      context,
    });
    const averageLength = parseNonNegativeSummaryNumber(
      entry.row[column.get("avg_len")],
      { field: "avg_len", identity, context },
    );
    const maxLength = parsePositiveSummaryInteger(entry.row[column.get("max_len")], {
      field: "max_len",
      identity,
      context,
    });
    const qualityMetric = parseNonNegativeSummaryNumber(
      entry.row[column.get("avg_quality")],
      { field: "avg_quality", identity, context, max: 100 },
    );
    const gcContent = parseNonNegativeSummaryNumber(
      entry.row[column.get("gc_content")],
      { field: "gc_content", identity, context, max: 100 },
    );
    const q20Percent = parseNonNegativeSummaryNumber(
      entry.row[column.get("q20_pct")],
      { field: "q20_pct", identity, context, max: 100 },
    );
    const q30Percent = parseNonNegativeSummaryNumber(
      entry.row[column.get("q30_pct")],
      { field: "q30_pct", identity, context, max: 100 },
    );
    const n50 = parsePositiveSummaryInteger(entry.row[column.get("n50")], {
      field: "n50",
      identity,
      context,
    });
    const quality = qualityMetric.parsed;

    const suffix = entry.readEnd === "R1" ? "1" : "2";
    assertSummaryEqualsWriteback({
      actual: count,
      expected: expected.sample?.readMetrics?.[`readCount${suffix}`],
      field: "num_reads",
      identity,
      context,
    });
    assertSummaryEqualsWriteback({
      actual: quality,
      expected: expected.sample?.readMetrics?.[`avgQuality${suffix}`],
      field: "avg_quality",
      identity,
      context,
    });

    if (groundTruth) {
      const metrics = groundTruth.get(identity);
      if (
        !Number.isSafeInteger(
          metrics?.seqkitPerReadGcHundredthsTotal,
        ) ||
        metrics.seqkitPerReadGcHundredthsTotal < 0 ||
        !Number.isFinite(metrics?.seqkitPerReadGcBinary64Total) ||
        metrics.seqkitPerReadGcBinary64Total < 0 ||
        !Number.isSafeInteger(metrics?.seqkitGcReadCount) ||
        metrics.seqkitGcReadCount <= 0 ||
        metrics?.seqkitMeanPerReadGcPercent !==
          metrics.seqkitPerReadGcBinary64Total /
            metrics.seqkitGcReadCount
      ) {
        fail(
          `${context}: independent FASTQ SeqKit GC rounding evidence is invalid for ${identity}`,
        );
      }
      const seqkitGcExpectedText = formatHalfEvenBinary64(
        metrics.seqkitPerReadGcBinary64Total /
          metrics.seqkitGcReadCount,
        2,
      );
      assertExactGroundTruthInteger({
        actual: count,
        expected: metrics?.readCount,
        field: "num_reads",
        identity,
        context,
      });
      assertExactGroundTruthInteger({
        actual: totalBases,
        expected: metrics?.totalBases,
        field: "total_bases",
        identity,
        context,
      });
      assertExactGroundTruthInteger({
        actual: minLength,
        expected: metrics?.minReadLength,
        field: "min_len",
        identity,
        context,
      });
      assertExactGroundTruthInteger({
        actual: maxLength,
        expected: metrics?.maxReadLength,
        field: "max_len",
        identity,
        context,
      });
      assertExactGroundTruthInteger({
        actual: n50,
        expected: metrics?.n50,
        field: "n50",
        identity,
        context,
      });
      for (const comparison of [
        {
          actual: averageLength,
          expected: metrics?.meanReadLength,
          expectedText: formatSeqkit28RoundedBinary64(
            metrics?.meanReadLength,
            1,
          ),
          field: "avg_len",
          decimalPlaces: 1,
          tool: "SeqKit 2.8.0 stats -T",
        },
        {
          actual: qualityMetric,
          expected: metrics?.meanErrorProbabilityQuality,
          expectedText: formatSeqkit28RoundedBinary64(
            metrics?.meanErrorProbabilityQuality,
            2,
          ),
          field: "avg_quality",
          decimalPlaces: 2,
          tool: "SeqKit 2.8.0 stats -T",
        },
        {
          actual: gcContent,
          expected: metrics?.seqkitMeanPerReadGcPercent,
          expectedText: seqkitGcExpectedText,
          field: "gc_content",
          decimalPlaces: 2,
          tool: "seqkit fx2tab -g plus awk",
        },
        {
          actual: q20Percent,
          expected: metrics?.q20Percent,
          expectedText: formatSeqkit28RoundedBinary64(
            metrics?.q20Percent,
            2,
          ),
          field: "q20_pct",
          decimalPlaces: 2,
          tool: "SeqKit 2.8.0 stats -T",
        },
        {
          actual: q30Percent,
          expected: metrics?.q30Percent,
          expectedText: formatSeqkit28RoundedBinary64(
            metrics?.q30Percent,
            2,
          ),
          field: "q30_pct",
          decimalPlaces: 2,
          tool: "SeqKit 2.8.0 stats -T",
        },
      ]) {
        assertFixedPrecisionGroundTruthNumber({
          actualText: comparison.actual.text,
          expected: comparison.expected,
          expectedText: comparison.expectedText,
          decimalPlaces: comparison.decimalPlaces,
          tool: comparison.tool,
          field: comparison.field,
          identity,
          context,
        });
      }
    }
  }

  return {
    expectedSampleCount: expectedSamples.length,
    expectedReadEnds: coverage.expectedSampleCount,
    observedReadEnds: coverage.observedSampleCount,
    checkedRows: parsedRows.length,
    pairedSamples: expectedSamples.filter((sample) => sample?.pairedEnd).length,
    singleEndSamples: expectedSamples.filter((sample) => !sample?.pairedEnd).length,
    groundTruthChecked: groundTruth !== null,
  };
}

/**
 * Bind one persisted reads-QC per-sample TSV to its basename/FK-selected
 * sample. The workflow emits this exact header and only that sample's R1/R2
 * rows; reuse the full raw-FASTQ/writeback proof for the file-local rows.
 */
export function assertReadsQcSampleArtifactRows({
  header,
  rows,
  expectedSample,
  groundTruthByIdentity,
  context,
}) {
  if (
    !Array.isArray(header) ||
    header.length !== READS_QC_REQUIRED_COLUMNS.length ||
    header.some(
      (column, index) => column !== READS_QC_REQUIRED_COLUMNS[index],
    )
  ) {
    fail(
      `${context}: per-sample reads-QC TSV header is not exact`,
      JSON.stringify(
        {
          expectedHeader: READS_QC_REQUIRED_COLUMNS,
          observedHeader: header ?? null,
        },
        null,
        2,
      ),
    );
  }
  if (!expectedSample || typeof expectedSample !== "object") {
    fail(`${context}: expected sample is missing for per-sample reads-QC TSV`);
  }
  return assertReadsQcSummaryRows({
    header,
    rows,
    expectedSamples: [expectedSample],
    groundTruthByIdentity,
    context,
  });
}

const NANOPLOT_REQUIRED_COLUMNS = [
  "sample_id",
  "num_reads",
  "total_bases",
  "mean_length",
  "median_length",
  "read_n50",
  "mean_quality",
];

export function assertNanoplotSummaryRows({
  header,
  rows,
  expectedSamples,
  groundTruthByIdentity,
  context,
}) {
  if (!Array.isArray(rows)) {
    fail(`${context}: NanoPlot summary rows must be an array`);
  }
  if (!Array.isArray(expectedSamples) || expectedSamples.length === 0) {
    fail(`${context}: no selected Reads were supplied for NanoPlot verification`);
  }
  const column = requireUniqueColumns(
    header,
    NANOPLOT_REQUIRED_COLUMNS,
    context,
  );
  const expectedSampleIds = expectedSamples.map((sample) => sample?.sampleId);
  const coverage = assertExactSampleCoverage({
    expectedSampleIds,
    observedSampleIds: rows.map((row) =>
      Array.isArray(row) ? row[column.get("sample_id")] : undefined,
    ),
    context,
  });
  const groundTruth = normalizeGroundTruthByIdentity({
    groundTruthByIdentity,
    expectedIdentities: expectedSampleIds.map((sampleId) => `${sampleId}/R1`),
    context,
  });

  for (const row of rows) {
    if (!Array.isArray(row)) {
      fail(`${context}: NanoPlot summary contains a non-array row`);
    }
    const sampleId = row[column.get("sample_id")];
    const identity = `${sampleId}/R1`;
    const count = parsePositiveSummaryInteger(row[column.get("num_reads")], {
      field: "num_reads",
      identity,
      context,
    });
    const totalBasesMetric = parseNonNegativeSummaryNumber(
      row[column.get("total_bases")],
      { field: "total_bases", identity, context },
    );
    const meanLength = parseNonNegativeSummaryNumber(
      row[column.get("mean_length")],
      { field: "mean_length", identity, context },
    );
    const medianLength = parseNonNegativeSummaryNumber(
      row[column.get("median_length")],
      { field: "median_length", identity, context },
    );
    const n50Metric = parseNonNegativeSummaryNumber(
      row[column.get("read_n50")],
      { field: "read_n50", identity, context },
    );
    const meanQuality = parseNonNegativeSummaryNumber(
      row[column.get("mean_quality")],
      { field: "mean_quality", identity, context, max: 100 },
    );

    if (!groundTruth) continue;
    const metrics = groundTruth.get(identity);
    assertExactGroundTruthInteger({
      actual: count,
      expected: metrics?.readCount,
      field: "num_reads",
      identity,
      context,
    });
    for (const [field, actualMetric, expected] of [
      ["total_bases", totalBasesMetric, metrics?.totalBases],
      ["read_n50", n50Metric, metrics?.nanomathN50],
    ]) {
      if (
        !Number.isSafeInteger(actualMetric.parsed) ||
        actualMetric.parsed <= 0
      ) {
        fail(`${context}: ${field} is not a positive integer value for ${identity}`);
      }
      assertExactGroundTruthInteger({
        actual: actualMetric.parsed,
        expected,
        field,
        identity,
        context,
      });
      assertFixedPrecisionGroundTruthNumber({
        actualText: actualMetric.text,
        expected,
        expectedText: formatHalfEvenBinary64(expected, 1),
        decimalPlaces: 1,
        tool: "NanoMath TSV stats",
        field,
        identity,
        context,
      });
    }
    for (const comparison of [
      {
        actual: meanLength,
        expected: metrics?.meanReadLength,
        expectedText: formatHalfEvenBinary64(
          metrics?.totalBases / metrics?.readCount,
          1,
        ),
        field: "mean_length",
      },
      {
        actual: medianLength,
        expected: metrics?.medianReadLength,
        expectedText: formatHalfEvenBinary64(
          metrics?.medianReadLength,
          1,
        ),
        field: "median_length",
      },
      {
        actual: meanQuality,
        expected: metrics?.nanomathMeanReadQuality,
        expectedText: formatHalfEvenBinary64(
          metrics?.nanomathMeanReadQuality,
          1,
        ),
        field: "mean_quality",
      },
    ]) {
      assertFixedPrecisionGroundTruthNumber({
        actualText: comparison.actual.text,
        expected: comparison.expected,
        expectedText: comparison.expectedText,
        decimalPlaces: 1,
        tool: "NanoMath TSV stats",
        field: comparison.field,
        identity,
        context,
      });
    }
  }

  return {
    expectedSampleCount: coverage.expectedSampleCount,
    observedSampleCount: coverage.observedSampleCount,
    checkedRows: rows.length,
    groundTruthChecked: groundTruth !== null,
  };
}

const SIMULATE_READS_REQUIRED_COLUMNS = [
  "sample_id",
  "mode",
  "simulation_mode_requested",
  "simulation_mode_used",
  "quality_profile",
  "insert_mean",
  "insert_std_dev",
  "seed",
  "template_label",
  "template_dir",
  "file1",
  "file2",
  "checksum1",
  "checksum2",
  "read_count1",
  "read_count2",
  "read_length",
];

/**
 * Prove the simulation summary describes the exact active replacement Read
 * persisted for every target sample, including both mates in paired mode.
 */
export function assertSimulateReadsSummaryRows({
  header,
  rows,
  expectedReads,
  groundTruthByIdentity,
  config,
  context,
}) {
  if (!Array.isArray(rows)) {
    fail(`${context}: simulation summary rows must be an array`);
  }
  if (!Array.isArray(expectedReads) || expectedReads.length === 0) {
    fail(`${context}: no replacement Reads were supplied for simulation verification`);
  }
  const column = requireUniqueColumns(
    header,
    SIMULATE_READS_REQUIRED_COLUMNS,
    context,
  );
  const expectedMode = config?.mode;
  const pairedEnd = expectedMode === "shortReadPaired";
  if (typeof expectedMode !== "string" || expectedMode.length === 0) {
    fail(`${context}: simulation mode is missing from the effective run config`);
  }

  const expectedBySampleId = new Map();
  for (const read of expectedReads) {
    const sampleId = read?.sampleId;
    if (typeof sampleId !== "string" || sampleId.trim().length === 0) {
      fail(`${context}: replacement Read has an invalid sample ID`);
    }
    if (expectedBySampleId.has(sampleId)) {
      fail(`${context}: replacement Reads contain duplicate sample ${sampleId}`);
    }
    if (
      typeof read.file1 !== "string" ||
      read.file1.length === 0 ||
      typeof read.checksum1 !== "string" ||
      !/^[0-9a-f]{32}$/.test(read.checksum1) ||
      !(Number(read.readCount1) > 0)
    ) {
      fail(
        `${context}: replacement Read is incomplete for sample ${sampleId}`,
        JSON.stringify(
          {
            sampleId,
            file1: read.file1 ?? null,
            checksum1: read.checksum1 ?? null,
            readCount1: read.readCount1 ?? null,
          },
          null,
          2,
        ),
      );
    }
    expectedBySampleId.set(sampleId, read);
  }
  const groundTruth = normalizeGroundTruthByIdentity({
    groundTruthByIdentity,
    expectedIdentities: expectedReads.flatMap((read) => [
      `${read.sampleId}/R1`,
      ...(pairedEnd ? [`${read.sampleId}/R2`] : []),
    ]),
    context,
  });

  const parsedRows = rows.map((row, index) => {
    if (!Array.isArray(row)) {
      fail(`${context}: simulation summary contains a non-array row at index ${index}`);
    }
    return {
      row,
      sampleId: row[column.get("sample_id")],
    };
  });
  const coverage = assertExactSampleCoverage({
    expectedSampleIds: Array.from(expectedBySampleId.keys()),
    observedSampleIds: parsedRows.map((entry) => entry.sampleId),
    context,
  });

  for (const { row, sampleId } of parsedRows) {
    const expected = expectedBySampleId.get(sampleId);
    if (!expected) {
      fail(`${context}: simulation summary contains unexpected sample ${sampleId}`);
    }
    const assertText = (field, expectedValue) => {
      const actual = row[column.get(field)];
      const expectedText = expectedValue == null ? "" : String(expectedValue);
      if (actual !== expectedText) {
        fail(
          `${context}: ${field} does not match for sample ${sampleId}`,
          JSON.stringify({ sampleId, field, summary: actual ?? null, expected: expectedText }, null, 2),
        );
      }
      return actual;
    };

    assertText("mode", expectedMode);
    const requestedSimulationMode = assertText(
      "simulation_mode_requested",
      config?.simulationMode,
    );
    const usedSimulationMode = row[column.get("simulation_mode_used")];
    if (
      !["synthetic", "template"].includes(usedSimulationMode) ||
      (requestedSimulationMode !== "auto" &&
        usedSimulationMode !== requestedSimulationMode)
    ) {
      fail(
        `${context}: simulation_mode_used is inconsistent for sample ${sampleId}`,
        JSON.stringify(
          { sampleId, requestedSimulationMode, usedSimulationMode: usedSimulationMode ?? null },
          null,
          2,
        ),
      );
    }
    assertText("quality_profile", config?.qualityProfile);
    assertText("insert_mean", config?.insertMean);
    assertText("insert_std_dev", config?.insertStdDev);
    assertText("seed", config?.seed);
    if (usedSimulationMode === "synthetic") {
      assertText("template_label", "");
      assertText("template_dir", "");
    }

    assertText("file1", path.basename(expected.file1));
    assertText("checksum1", expected.checksum1);
    const count1 = parsePositiveSummaryInteger(row[column.get("read_count1")], {
      field: "read_count1",
      identity: sampleId,
      context,
    });
    assertSummaryEqualsWriteback({
      actual: count1,
      expected: expected.readCount1,
      field: "read_count1",
      identity: sampleId,
      context,
    });
    if (groundTruth) {
      const r1Metrics = groundTruth.get(`${sampleId}/R1`);
      assertExactGroundTruthInteger({
        actual: count1,
        expected: r1Metrics?.readCount,
        field: "read_count1",
        identity: `${sampleId}/R1`,
        context,
      });
    }

    const readLength = parsePositiveSummaryInteger(row[column.get("read_length")], {
      field: "read_length",
      identity: sampleId,
      context,
    });
    if (groundTruth) {
      const r1Metrics = groundTruth.get(`${sampleId}/R1`);
      const roundedMeanReadLength = Math.round(r1Metrics?.meanReadLength);
      if (
        !Number.isSafeInteger(roundedMeanReadLength) ||
        readLength !== roundedMeanReadLength
      ) {
        fail(
          `${context}: read_length does not match independent FASTQ ground truth for ${sampleId}/R1`,
          JSON.stringify(
            {
              sampleId,
              summary: readLength,
              fastqMeanReadLength: r1Metrics?.meanReadLength ?? null,
              expectedRoundedMean: Number.isFinite(roundedMeanReadLength)
                ? roundedMeanReadLength
                : null,
            },
            null,
            2,
          ),
        );
      }
      if (
        usedSimulationMode === "synthetic" &&
        expectedMode !== "longRead" &&
        (r1Metrics?.minReadLength !== Number(config?.readLength) ||
          r1Metrics?.maxReadLength !== Number(config?.readLength))
      ) {
        fail(
          `${context}: synthetic short-read R1 lengths do not match the effective config for ${sampleId}`,
        );
      }
    }
    if (
      usedSimulationMode === "synthetic" &&
      expectedMode !== "longRead" &&
      readLength !== Number(config?.readLength)
    ) {
      fail(
        `${context}: read_length does not match the effective config for sample ${sampleId}`,
        JSON.stringify(
          { sampleId, summary: readLength, configured: config?.readLength ?? null },
          null,
          2,
        ),
      );
    }
    if (
      usedSimulationMode === "synthetic" &&
      count1 !== Number(config?.readCount)
    ) {
      fail(
        `${context}: read_count1 does not match the effective config for sample ${sampleId}`,
        JSON.stringify(
          { sampleId, summary: count1, configured: config?.readCount ?? null },
          null,
          2,
        ),
      );
    }

    if (pairedEnd) {
      if (
        typeof expected.file2 !== "string" ||
        expected.file2.length === 0 ||
        typeof expected.checksum2 !== "string" ||
        !/^[0-9a-f]{32}$/.test(expected.checksum2) ||
        !(Number(expected.readCount2) > 0)
      ) {
        fail(
          `${context}: paired replacement Read is incomplete for sample ${sampleId}`,
          JSON.stringify(
            {
              sampleId,
              file2: expected.file2 ?? null,
              checksum2: expected.checksum2 ?? null,
              readCount2: expected.readCount2 ?? null,
            },
            null,
            2,
          ),
        );
      }
      assertText("file2", path.basename(expected.file2));
      assertText("checksum2", expected.checksum2);
      const count2 = parsePositiveSummaryInteger(row[column.get("read_count2")], {
        field: "read_count2",
        identity: sampleId,
        context,
      });
      assertSummaryEqualsWriteback({
        actual: count2,
        expected: expected.readCount2,
        field: "read_count2",
        identity: sampleId,
        context,
      });
      if (groundTruth) {
        const r2Metrics = groundTruth.get(`${sampleId}/R2`);
        assertExactGroundTruthInteger({
          actual: count2,
          expected: r2Metrics?.readCount,
          field: "read_count2",
          identity: `${sampleId}/R2`,
          context,
        });
        if (
          usedSimulationMode === "synthetic" &&
          expectedMode !== "longRead" &&
          (r2Metrics?.minReadLength !== Number(config?.readLength) ||
            r2Metrics?.maxReadLength !== Number(config?.readLength))
        ) {
          fail(
            `${context}: synthetic short-read R2 lengths do not match the effective config for ${sampleId}`,
          );
        }
      }
      if (
        usedSimulationMode === "synthetic" &&
        count2 !== Number(config?.readCount)
      ) {
        fail(
          `${context}: read_count2 does not match the effective config for sample ${sampleId}`,
          JSON.stringify(
            { sampleId, summary: count2, configured: config?.readCount ?? null },
            null,
            2,
          ),
        );
      }
    } else {
      assertText("file2", "");
      assertText("checksum2", "");
      assertText("read_count2", "");
    }
  }

  return {
    expectedSampleCount: coverage.expectedSampleCount,
    observedSampleCount: coverage.observedSampleCount,
    checkedRows: rows.length,
    mode: expectedMode,
    pairedEnd,
    groundTruthChecked: groundTruth !== null,
  };
}

const FASTQC_REQUIRED_COLUMNS = [
  "sample_id",
  "r1_pass",
  "r1_warn",
  "r1_fail",
  "r1_read_count",
  "r1_avg_quality",
  "r2_pass",
  "r2_warn",
  "r2_fail",
  "r2_read_count",
  "r2_avg_quality",
];

function parseFastqcInteger(value, { field, sampleId, positive, context }) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) {
    fail(
      `${context}: ${field} is not an integer for sample ${sampleId}`,
      JSON.stringify({ sampleId, field, value: value ?? null }, null, 2),
    );
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || (positive ? parsed <= 0 : parsed < 0)) {
    fail(
      `${context}: ${field} is not a ${positive ? "positive" : "non-negative"} safe integer for sample ${sampleId}`,
      JSON.stringify({ sampleId, field, value }, null, 2),
    );
  }
  return parsed;
}

function parseFastqcQuality(value, { field, sampleId, context }) {
  const text = typeof value === "string" ? value.trim() : "";
  const parsed = text === "" ? Number.NaN : Number(text);
  // FastQC can report up to Q93 for printable Phred+33 input (and Q62 for
  // Phred+64). The encoding-aware raw/ZIP comparison below supplies the exact
  // bound; this preliminary parser must not reject those valid bins.
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 93) {
    fail(
      `${context}: ${field} is outside the plausible Phred range for sample ${sampleId}`,
      JSON.stringify({ sampleId, field, value: value ?? null }, null, 2),
    );
  }
  return parsed;
}

function assertFastqcWritebackMetric({
  actual,
  expected,
  field,
  sampleId,
  context,
}) {
  const expectedNumber = Number(expected);
  if (!Number.isFinite(expectedNumber) || actual !== expectedNumber) {
    fail(
      `${context}: summary ${field} does not match the Read writeback for sample ${sampleId}`,
      JSON.stringify(
        {
          sampleId,
          field,
          summary: actual,
          readWriteback: expected ?? null,
        },
        null,
        2,
      ),
    );
  }
}

/**
 * Prove that a FastQC summary describes every target sample exactly once and
 * that single/paired metrics agree with the selected input Read. Callers may
 * additionally require equal R1/R2 counts for deterministic paired fixtures.
 */
export function assertFastqcSummaryRows({
  header,
  rows,
  expectedSamples,
  groundTruthByIdentity,
  requireBalancedPairs = false,
  context,
}) {
  if (!Array.isArray(header) || !Array.isArray(rows)) {
    fail(`${context}: FastQC summary must expose header and row arrays`);
  }
  if (!Array.isArray(expectedSamples) || expectedSamples.length === 0) {
    fail(`${context}: no target samples were supplied for FastQC verification`);
  }

  const column = new Map();
  for (const name of FASTQC_REQUIRED_COLUMNS) {
    const indexes = [];
    for (let index = 0; index < header.length; index += 1) {
      if (header[index] === name) indexes.push(index);
    }
    if (indexes.length !== 1) {
      fail(
        `${context}: FastQC summary must contain exactly one ${name} column`,
        JSON.stringify({ header, column: name, indexes }, null, 2),
      );
    }
    column.set(name, indexes[0]);
  }

  const expectedById = new Map();
  for (const sample of expectedSamples) {
    const sampleId =
      typeof sample?.sampleId === "string" ? sample.sampleId : "";
    if (!sampleId || expectedById.has(sampleId)) {
      fail(
        `${context}: target sample declarations need unique non-empty sample IDs`,
        JSON.stringify(
          {
            sampleId: sampleId || null,
            expectedSampleIds: expectedSamples.map(
              (candidate) => candidate?.sampleId ?? null,
            ),
          },
          null,
          2,
        ),
      );
    }
    expectedById.set(sampleId, sample);
  }
  const expectedMateIdentities = expectedSamples.flatMap((sample) => [
    `${sample.sampleId}/R1`,
    ...(sample?.pairedEnd ? [`${sample.sampleId}/R2`] : []),
  ]);
  const groundTruth = normalizeGroundTruthByIdentity({
    groundTruthByIdentity,
    expectedIdentities: expectedMateIdentities,
    context,
  });

  const assertMateGroundTruth = ({
    identity,
    summaryCount,
    summaryQualityText,
  }) => {
    if (!groundTruth) return;
    const metrics = groundTruth.get(identity);
    const fastqcData = metrics?.fastqcData;
    assertExactGroundTruthInteger({
      actual: summaryCount,
      expected: metrics?.readCount,
      field: "read_count",
      identity,
      context,
    });
    if (
      !fastqcData ||
      typeof fastqcData !== "object" ||
      !Number.isSafeInteger(fastqcData.totalSequences) ||
      fastqcData.totalSequences !== metrics?.readCount
    ) {
      fail(
        `${context}: FastQC ZIP Total Sequences does not match independent FASTQ ground truth for ${identity}`,
        JSON.stringify(
          {
            identity,
            fastqReadCount: metrics?.readCount ?? null,
            fastqcTotalSequences: fastqcData?.totalSequences ?? null,
          },
          null,
          2,
        ),
      );
    }
    if (
      typeof metrics?.inputBasename !== "string" ||
      !metrics.inputBasename ||
      fastqcData.filename !== metrics.inputBasename
    ) {
      fail(
        `${context}: FastQC ZIP Filename does not match the exact input for ${identity}`,
        JSON.stringify(
          {
            identity,
            inputBasename: metrics?.inputBasename ?? null,
            fastqcFilename: fastqcData?.filename ?? null,
          },
          null,
          2,
        ),
      );
    }
    if (
      !Number.isSafeInteger(fastqcData.meanSequenceQualityNumerator) ||
      fastqcData.meanSequenceQualityNumerator < 0 ||
      !Number.isSafeInteger(fastqcData.meanSequenceQualityDenominator) ||
      fastqcData.meanSequenceQualityDenominator !==
        fastqcData.totalSequences ||
      fastqcData.meanSequenceQuality !==
        fastqcData.meanSequenceQualityNumerator /
          fastqcData.meanSequenceQualityDenominator
    ) {
      fail(
        `${context}: FastQC ZIP quality ratio is malformed for ${identity}`,
        JSON.stringify(
          {
            identity,
            numerator:
              fastqcData?.meanSequenceQualityNumerator ?? null,
            denominator:
              fastqcData?.meanSequenceQualityDenominator ?? null,
            totalSequences: fastqcData?.totalSequences ?? null,
            meanSequenceQuality:
              fastqcData?.meanSequenceQuality ?? null,
          },
          null,
          2,
        ),
      );
    }
    assertFixedPrecisionGroundTruthNumber({
      actualText: summaryQualityText,
      expected: fastqcData.meanSequenceQuality,
      expectedText: formatHalfEvenBinary64(
        fastqcData.meanSequenceQualityNumerator /
          fastqcData.meanSequenceQualityDenominator,
        1,
      ),
      decimalPlaces: 1,
      tool: "FastQC summary awk",
      field: "avg_quality (FastQC ZIP)",
      identity,
      context,
    });
    let rawFastqcMeanSequenceQuality;
    try {
      rawFastqcMeanSequenceQuality =
        resolveFastqcMeanSequenceQualityForEncoding(
          metrics,
          fastqcData.encoding,
        );
    } catch (error) {
      fail(
        `${context}: FastQC Encoding cannot be resolved against raw FASTQ qualities for ${identity}`,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (
      !Number.isFinite(fastqcData.meanSequenceQuality) ||
      rawFastqcMeanSequenceQuality !== fastqcData.meanSequenceQuality
    ) {
      fail(
        `${context}: FastQC integer-binned mean quality does not match independent FASTQ ground truth for ${identity}`,
        JSON.stringify(
          {
            identity,
            fastqcEncoding: fastqcData?.encoding ?? null,
            fastqcQualityOffset: fastqcData?.qualityOffset ?? null,
            fastqIntegerBinnedMeanSequenceQuality:
              rawFastqcMeanSequenceQuality ?? null,
            fastqcMeanSequenceQuality:
              fastqcData?.meanSequenceQuality ?? null,
          },
          null,
          2,
        ),
      );
    }
  };

  const sampleColumn = column.get("sample_id");
  const observedSampleIds = rows.map((row) =>
    Array.isArray(row) ? row[sampleColumn] : undefined,
  );
  const coverage = assertExactSampleCoverage({
    expectedSampleIds: Array.from(expectedById.keys()),
    observedSampleIds,
    context,
  });

  let pairedSamples = 0;
  let singleEndSamples = 0;
  for (const row of rows) {
    if (!Array.isArray(row)) {
      fail(`${context}: FastQC summary contains a non-array row`);
    }
    const sampleId = row[sampleColumn];
    const expected = expectedById.get(sampleId);
    if (!expected) {
      // Exact coverage above normally reports this first. Keep the guard here so
      // later refactors cannot accidentally dereference an unknown sample.
      fail(`${context}: FastQC summary contains unexpected sample ${sampleId}`);
    }

    const metric = (name) => row[column.get(name)];
    const r1Pass = parseFastqcInteger(metric("r1_pass"), {
      field: "r1_pass",
      sampleId,
      positive: false,
      context,
    });
    const r1Warn = parseFastqcInteger(metric("r1_warn"), {
      field: "r1_warn",
      sampleId,
      positive: false,
      context,
    });
    const r1Fail = parseFastqcInteger(metric("r1_fail"), {
      field: "r1_fail",
      sampleId,
      positive: false,
      context,
    });
    if (r1Pass + r1Warn + r1Fail === 0) {
      fail(`${context}: FastQC reported no R1 module results for sample ${sampleId}`);
    }
    const r1ReadCount = parseFastqcInteger(metric("r1_read_count"), {
      field: "r1_read_count",
      sampleId,
      positive: true,
      context,
    });
    const r1AverageQuality = parseFastqcQuality(metric("r1_avg_quality"), {
      field: "r1_avg_quality",
      sampleId,
      context,
    });
    assertMateGroundTruth({
      identity: `${sampleId}/R1`,
      summaryCount: r1ReadCount,
      summaryQualityText: String(metric("r1_avg_quality")).trim(),
    });

    const readMetrics = expected?.readMetrics;
    if (readMetrics) {
      assertFastqcWritebackMetric({
        actual: r1ReadCount,
        expected: readMetrics.readCount1,
        field: "r1_read_count",
        sampleId,
        context,
      });
      assertFastqcWritebackMetric({
        actual: r1AverageQuality,
        expected: readMetrics.avgQuality1,
        field: "r1_avg_quality",
        sampleId,
        context,
      });
    }

    const r2FieldNames = [
      "r2_pass",
      "r2_warn",
      "r2_fail",
      "r2_read_count",
      "r2_avg_quality",
    ];
    if (expected.pairedEnd === true) {
      pairedSamples += 1;
      const r2Pass = parseFastqcInteger(metric("r2_pass"), {
        field: "r2_pass",
        sampleId,
        positive: false,
        context,
      });
      const r2Warn = parseFastqcInteger(metric("r2_warn"), {
        field: "r2_warn",
        sampleId,
        positive: false,
        context,
      });
      const r2Fail = parseFastqcInteger(metric("r2_fail"), {
        field: "r2_fail",
        sampleId,
        positive: false,
        context,
      });
      if (r2Pass + r2Warn + r2Fail === 0) {
        fail(
          `${context}: FastQC reported no R2 module results for paired sample ${sampleId}`,
        );
      }
      const r2ReadCount = parseFastqcInteger(metric("r2_read_count"), {
        field: "r2_read_count",
        sampleId,
        positive: true,
        context,
      });
      const r2AverageQuality = parseFastqcQuality(metric("r2_avg_quality"), {
        field: "r2_avg_quality",
        sampleId,
        context,
      });
      assertMateGroundTruth({
        identity: `${sampleId}/R2`,
        summaryCount: r2ReadCount,
        summaryQualityText: String(metric("r2_avg_quality")).trim(),
      });
      if (requireBalancedPairs && r2ReadCount !== r1ReadCount) {
        fail(
          `${context}: deterministic paired fixture has unequal R1/R2 counts for sample ${sampleId}`,
          JSON.stringify({ sampleId, r1ReadCount, r2ReadCount }, null, 2),
        );
      }
      if (readMetrics) {
        assertFastqcWritebackMetric({
          actual: r2ReadCount,
          expected: readMetrics.readCount2,
          field: "r2_read_count",
          sampleId,
          context,
        });
        assertFastqcWritebackMetric({
          actual: r2AverageQuality,
          expected: readMetrics.avgQuality2,
          field: "r2_avg_quality",
          sampleId,
          context,
        });
      }
    } else {
      singleEndSamples += 1;
      const populatedR2Fields = r2FieldNames.filter(
        (name) => String(metric(name) ?? "").trim() !== "",
      );
      if (populatedR2Fields.length > 0) {
        fail(
          `${context}: single-end sample ${sampleId} unexpectedly has R2 metrics`,
          JSON.stringify({ sampleId, populatedR2Fields }, null, 2),
        );
      }
    }
  }

  return {
    ...coverage,
    checkedRows: rows.length,
    pairedSamples,
    singleEndSamples,
    requireBalancedPairs,
    groundTruthChecked: groundTruth !== null,
  };
}

function normalizeMultiqcSampleName(value) {
  if (typeof value !== "string" || value.trim().length === 0) return "";
  let normalized = path.basename(value.trim());
  normalized = normalized.replace(/\.(?:gz|bz2|xz|zip)$/i, "");
  normalized = normalized.replace(/\.(?:fastq|fq)$/i, "");
  normalized = normalized.replace(/_fastqc$/i, "");
  return normalized;
}

export function deriveMultiqcExpectedSamplesFromSourceInputs({
  candidateSamples,
  sourceInputSamples,
  context,
}) {
  if (!Array.isArray(candidateSamples) || candidateSamples.length === 0) {
    fail(`${context}: no selected MultiQC study samples were supplied`);
  }
  if (!Array.isArray(sourceInputSamples) || sourceInputSamples.length === 0) {
    fail(`${context}: no samplesheet-bound FastQC source inputs were supplied`);
  }

  const candidatesById = new Map();
  for (const candidate of candidateSamples) {
    const sampleId =
      typeof candidate?.sampleId === "string" ? candidate.sampleId.trim() : "";
    const sampleRecordId =
      typeof candidate?.sampleRecordId === "string"
        ? candidate.sampleRecordId.trim()
        : "";
    if (
      !sampleId ||
      !sampleRecordId ||
      candidatesById.has(sampleId) ||
      Array.from(candidatesById.values()).some(
        (existing) => existing.sampleRecordId === sampleRecordId,
      )
    ) {
      fail(
        `${context}: selected MultiQC samples need unique IDs and persisted IDs`,
      );
    }
    candidatesById.set(sampleId, {
      ...candidate,
      sampleId,
      sampleRecordId,
    });
  }

  const layoutsBySampleId = new Map();
  for (const source of sourceInputSamples) {
    const sampleId =
      typeof source?.sampleId === "string" ? source.sampleId.trim() : "";
    const candidate = candidatesById.get(sampleId);
    const sampleRecordId =
      typeof source?.sampleRecordId === "string"
        ? source.sampleRecordId.trim()
        : "";
    const file1 = typeof source?.file1 === "string" ? source.file1.trim() : "";
    const file2 = typeof source?.file2 === "string" ? source.file2.trim() : "";
    if (
      !candidate ||
      sampleRecordId !== candidate.sampleRecordId ||
      !file1 ||
      !path.isAbsolute(file1) ||
      (file2 && !path.isAbsolute(file2))
    ) {
      fail(
        `${context}: FastQC source input is not exactly bound to a selected study sample`,
        JSON.stringify(
          {
            sampleId: sampleId || null,
            sampleRecordId: sampleRecordId || null,
            file1: file1 || null,
            file2: file2 || null,
          },
          null,
          2,
        ),
      );
    }
    const layoutKey = `${file1}\u0000${file2}`;
    const layouts = layoutsBySampleId.get(sampleId) || new Map();
    layouts.set(layoutKey, { file1, file2: file2 || null });
    layoutsBySampleId.set(sampleId, layouts);
  }

  assertExactSampleCoverage({
    expectedSampleIds: Array.from(candidatesById.keys()),
    observedSampleIds: Array.from(layoutsBySampleId.keys()),
    context: `${context} source-input sample coverage`,
    unit: "selected study sample",
  });

  return Array.from(candidatesById.values()).map((candidate) => {
    const layouts = layoutsBySampleId.get(candidate.sampleId);
    if (layouts.size !== 1) {
      fail(
        `${context}: FastQC source runs disagree on the exact Read layout for ${candidate.sampleId}`,
        JSON.stringify(
          {
            sampleId: candidate.sampleId,
            layouts: Array.from(layouts.values()),
          },
          null,
          2,
        ),
      );
    }
    const [{ file1, file2 }] = Array.from(layouts.values());
    return {
      ...candidate,
      file1,
      file2,
      pairedEnd: Boolean(file2),
    };
  });
}

function buildExpectedFastqcMateIndex(expectedSamples, context) {
  if (!Array.isArray(expectedSamples) || expectedSamples.length === 0) {
    fail(`${context}: no expected FastQC samples were supplied`);
  }

  const samples = new Set();
  const persistedSamples = new Set();
  const byIdentity = new Map();
  const byArtifactBasename = new Map();
  const multiqcAliasToIdentity = new Map();

  for (const sample of expectedSamples) {
    const sampleId =
      typeof sample?.sampleId === "string" ? sample.sampleId.trim() : "";
    const sampleRecordId =
      typeof sample?.sampleRecordId === "string"
        ? sample.sampleRecordId.trim()
        : "";
    const file1 = typeof sample?.file1 === "string" ? sample.file1.trim() : "";
    const file2 = typeof sample?.file2 === "string" ? sample.file2.trim() : "";
    if (
      !sampleId ||
      !sampleRecordId ||
      !file1 ||
      samples.has(sampleId) ||
      persistedSamples.has(sampleRecordId)
    ) {
      fail(
        `${context}: expected FastQC samples need unique IDs, persisted IDs, and R1 inputs`,
        JSON.stringify(
          {
            sampleId: sampleId || null,
            sampleRecordId: sampleRecordId || null,
            file1: file1 || null,
          },
          null,
          2,
        ),
      );
    }
    samples.add(sampleId);
    persistedSamples.add(sampleRecordId);

    const mates = [
      { mate: "R1", inputPath: file1 },
      ...(file2 ? [{ mate: "R2", inputPath: file2 }] : []),
    ];
    for (const { mate, inputPath } of mates) {
      const identity = `${sampleId}/${mate}`;
      const entry = {
        identity,
        sampleId,
        sampleRecordId,
        mate,
        inputPath,
      };
      byIdentity.set(identity, entry);
      for (const format of ["html", "zip"]) {
        byArtifactBasename.set(
          `${sampleId}_${mate}_fastqc.${format}`,
          { ...entry, format },
        );
      }

      const aliases = new Set([
        `${sampleId}_${mate}`,
        normalizeMultiqcSampleName(inputPath),
      ]);
      for (const alias of aliases) {
        if (!alias) continue;
        const existing = multiqcAliasToIdentity.get(alias);
        if (existing && existing !== identity) {
          fail(
            `${context}: MultiQC sample alias '${alias}' is ambiguous`,
            JSON.stringify({ alias, identities: [existing, identity] }, null, 2),
          );
        }
        multiqcAliasToIdentity.set(alias, identity);
      }
    }
  }

  return {
    byIdentity,
    byArtifactBasename,
    multiqcAliasToIdentity,
  };
}

const SAMPLE_BOUND_QC_ARTIFACTS = new Map([
  [
    "nanoplot",
    new Map([
      ["sample_report", (sampleId) => `${sampleId}_NanoPlot-report.html`],
      ["sample_stats", (sampleId) => `${sampleId}_NanoStats.txt`],
    ]),
  ],
  [
    "reads-qc",
    new Map([
      ["sample_stats", (sampleId) => `${sampleId}.tsv`],
    ]),
  ],
]);

/**
 * Prove the closed set of sample-scoped artifact rows for QC pipelines whose
 * summary and Read writeback checks otherwise only validate file contents.
 * Every expected sample/output pair must exist exactly once, with the exact
 * deterministic basename and persisted sample foreign key.
 */
export function assertSampleBoundQcArtifactCoverage({
  pipelineId,
  artifacts,
  expectedSamples,
  context,
}) {
  const outputContracts = SAMPLE_BOUND_QC_ARTIFACTS.get(pipelineId);
  if (!outputContracts) {
    fail(`${context}: no sample-bound artifact contract exists for ${pipelineId}`);
  }
  if (!Array.isArray(artifacts)) {
    fail(`${context}: pipeline artifacts must be an array`);
  }
  if (!Array.isArray(expectedSamples) || expectedSamples.length === 0) {
    fail(`${context}: no samplesheet-bound samples were supplied`);
  }

  const expectedByArtifact = new Map();
  const expectedIdentities = [];
  const seenSampleIds = new Set();
  const seenRecordIds = new Set();
  for (const sample of expectedSamples) {
    const sampleId =
      typeof sample?.sampleId === "string" ? sample.sampleId.trim() : "";
    const sampleRecordId =
      typeof sample?.sampleRecordId === "string"
        ? sample.sampleRecordId.trim()
        : "";
    if (
      !sampleId ||
      !sampleRecordId ||
      seenSampleIds.has(sampleId) ||
      seenRecordIds.has(sampleRecordId)
    ) {
      fail(
        `${context}: expected samples need unique sample IDs and persisted IDs`,
      );
    }
    seenSampleIds.add(sampleId);
    seenRecordIds.add(sampleRecordId);
    for (const [outputId, basenameForSample] of outputContracts) {
      const basename = basenameForSample(sampleId);
      const identity = `${sampleId}/${outputId}`;
      expectedIdentities.push(identity);
      expectedByArtifact.set(`${outputId}\u0000${basename}`, {
        identity,
        sampleId,
        sampleRecordId,
        outputId,
        basename,
      });
    }
  }

  const relevantArtifacts = artifacts.filter((artifact) =>
    outputContracts.has(artifact?.outputId),
  );
  const observedIdentities = [];
  for (const artifact of relevantArtifacts) {
    const artifactPath =
      typeof artifact?.path === "string" ? artifact.path.trim() : "";
    const basename = artifactPath ? path.basename(artifactPath) : "";
    const expected = expectedByArtifact.get(
      `${artifact?.outputId ?? ""}\u0000${basename}`,
    );
    if (!expected) {
      fail(
        `${context}: sample-bound artifact has an unexpected output or basename`,
        JSON.stringify(
          {
            outputId: artifact?.outputId ?? null,
            path: artifactPath || null,
            basename: basename || null,
          },
          null,
          2,
        ),
      );
    }
    if (artifact?.sampleId !== expected.sampleRecordId) {
      fail(
        `${context}: sample-bound artifact points at the wrong persisted sample`,
        JSON.stringify(
          {
            identity: expected.identity,
            expectedSampleRecordId: expected.sampleRecordId,
            artifactSampleId: artifact?.sampleId ?? null,
            path: artifactPath,
          },
          null,
          2,
        ),
      );
    }
    observedIdentities.push(expected.identity);
  }

  const coverage = assertExactSampleCoverage({
    expectedSampleIds: expectedIdentities,
    observedSampleIds: observedIdentities,
    context: `${context} closed sample-bound artifact coverage`,
    unit: "target sample/output artifact",
  });
  return {
    pipelineId,
    expectedArtifacts: coverage.expectedSampleCount,
    persistedArtifacts: coverage.observedSampleCount,
    expectedSamples: expectedSamples.length,
  };
}

/**
 * Prove that the PipelineArtifact rows persisted for FastQC contain exactly
 * one HTML report and one ZIP data bundle for every selected sample/mate.
 * The sample foreign key must agree with the filename-derived sample.
 */
export function assertFastqcArtifactCoverage({
  artifacts,
  expectedSamples,
  context,
}) {
  if (!Array.isArray(artifacts)) {
    fail(`${context}: FastQC artifacts must be an array`);
  }
  const expected = buildExpectedFastqcMateIndex(expectedSamples, context);
  const outputFormats = new Map([
    ["sample_qc_reports", "html"],
    ["sample_qc_data", "zip"],
  ]);
  const expectedArtifactIdentities = [];
  for (const entry of expected.byIdentity.values()) {
    expectedArtifactIdentities.push(
      `${entry.identity}/html`,
      `${entry.identity}/zip`,
    );
  }

  const relevant = artifacts.filter((artifact) =>
    outputFormats.has(artifact?.outputId),
  );
  const observedArtifactIdentities = [];
  for (const artifact of relevant) {
    const expectedFormat = outputFormats.get(artifact.outputId);
    const artifactPath =
      typeof artifact?.path === "string" ? artifact.path.trim() : "";
    if (!artifactPath) {
      fail(
        `${context}: persisted FastQC artifact has no path`,
        JSON.stringify({ artifact }, null, 2),
      );
    }

    const basename = path.basename(artifactPath);
    const matched = expected.byArtifactBasename.get(basename);
    if (!matched || matched.format !== expectedFormat) {
      fail(
        `${context}: persisted FastQC artifact is unexpected or has the wrong output type`,
        JSON.stringify(
          {
            outputId: artifact.outputId,
            path: artifactPath,
            basename,
            expectedFormat,
          },
          null,
          2,
        ),
      );
    }
    if (artifact?.sampleId !== matched.sampleRecordId) {
      fail(
        `${context}: persisted FastQC artifact points at the wrong sample`,
        JSON.stringify(
          {
            path: artifactPath,
            expectedSampleRecordId: matched.sampleRecordId,
            persistedSampleId: artifact?.sampleId ?? null,
          },
          null,
          2,
        ),
      );
    }
    observedArtifactIdentities.push(`${matched.identity}/${matched.format}`);
  }

  const coverage = assertExactSampleCoverage({
    expectedSampleIds: expectedArtifactIdentities,
    observedSampleIds: observedArtifactIdentities,
    context: `${context} persisted HTML/ZIP artifact coverage`,
  });
  return {
    expectedSampleMates: expected.byIdentity.size,
    expectedArtifacts: coverage.expectedSampleCount,
    persistedArtifacts: coverage.observedSampleCount,
  };
}

function decodeFastqcXmlText(value, context) {
  if (typeof value !== "string" || value.includes("<")) {
    fail(`${context}: FastQC Filename cell contains invalid nested markup`);
  }
  const entityPattern =
    /&(amp|lt|gt|quot|apos|#39|#\d+|#x[0-9a-fA-F]+);/g;
  if (value.replace(entityPattern, "").includes("&")) {
    fail(`${context}: FastQC Filename cell contains an invalid XML entity`);
  }
  try {
    return value.replace(entityPattern, (entity, token) => {
      if (token === "amp") return "&";
      if (token === "lt") return "<";
      if (token === "gt") return ">";
      if (token === "quot") return '"';
      if (token === "apos" || token === "#39") return "'";
      const codePoint = token.startsWith("#x")
        ? Number.parseInt(token.slice(2), 16)
        : Number.parseInt(token.slice(1), 10);
      if (
        !Number.isSafeInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        fail(`${context}: FastQC Filename cell has an invalid code point`);
      }
      return String.fromCodePoint(codePoint);
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(context)) {
      throw error;
    }
    fail(
      `${context}: FastQC Filename cell could not be decoded`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Bind a FastQC 0.12.1 HTML report to the exact raw input basename recorded
 * in its Basic Statistics table. The report filename itself is insufficient:
 * SeqDesk renames it after FastQC exits.
 */
export function assertFastqcHtmlInputFilename({
  html,
  expectedInputBasename,
  context,
}) {
  if (typeof html !== "string" || html.length === 0) {
    fail(`${context}: FastQC HTML is empty`);
  }
  if (
    typeof expectedInputBasename !== "string" ||
    expectedInputBasename.length === 0 ||
    path.basename(expectedInputBasename) !== expectedInputBasename
  ) {
    fail(`${context}: expected FastQC input basename is invalid`);
  }
  const matches = Array.from(
    html.matchAll(/<td>Filename<\/td><td>([^<]*)<\/td>/g),
  );
  if (matches.length !== 1) {
    fail(
      `${context}: FastQC HTML must contain exactly one Basic Statistics Filename row`,
      JSON.stringify({ filenameRows: matches.length }, null, 2),
    );
  }
  const observedInputBasename = decodeFastqcXmlText(matches[0][1], context);
  if (observedInputBasename !== expectedInputBasename) {
    fail(
      `${context}: FastQC HTML Filename does not match the exact raw input basename`,
      JSON.stringify(
        { expectedInputBasename, observedInputBasename },
        null,
        2,
      ),
    );
  }
  return { observedInputBasename };
}

/**
 * Bind the selected Read's FastQC report fields to the exact persisted HTML
 * artifact for each sample/mate. ZIP and run-scoped artifacts are irrelevant
 * here; every sample_qc_reports artifact is treated as part of the closed set.
 */
export function assertFastqcReportWritebackCoverage({
  artifacts,
  expectedSamples,
  context,
}) {
  if (!Array.isArray(artifacts)) {
    fail(`${context}: FastQC artifacts must be an array`);
  }
  const expected = buildExpectedFastqcMateIndex(expectedSamples, context);
  const sampleById = new Map(
    expectedSamples.map((sample) => [sample?.sampleId, sample]),
  );
  const expectedReportIdentities = Array.from(expected.byIdentity.keys());
  const reportPathByIdentity = new Map();
  const observedReportIdentities = [];

  for (const artifact of artifacts.filter(
    (candidate) => candidate?.outputId === "sample_qc_reports",
  )) {
    const artifactPath =
      typeof artifact?.path === "string" ? artifact.path.trim() : "";
    if (!artifactPath) {
      fail(
        `${context}: persisted FastQC HTML artifact has no path`,
        JSON.stringify({ artifact }, null, 2),
      );
    }
    const basename = path.basename(artifactPath);
    const matched = expected.byArtifactBasename.get(basename);
    if (!matched || matched.format !== "html") {
      fail(
        `${context}: persisted FastQC HTML artifact is unexpected`,
        JSON.stringify(
          {
            outputId: artifact?.outputId ?? null,
            path: artifactPath,
            basename,
          },
          null,
          2,
        ),
      );
    }
    if (artifact?.sampleId !== matched.sampleRecordId) {
      fail(
        `${context}: persisted FastQC HTML artifact points at the wrong sample`,
        JSON.stringify(
          {
            identity: matched.identity,
            path: artifactPath,
            expectedSampleRecordId: matched.sampleRecordId,
            persistedSampleId: artifact?.sampleId ?? null,
          },
          null,
          2,
        ),
      );
    }
    observedReportIdentities.push(matched.identity);
    reportPathByIdentity.set(matched.identity, artifactPath);
  }

  const coverage = assertExactSampleCoverage({
    expectedSampleIds: expectedReportIdentities,
    observedSampleIds: observedReportIdentities,
    context: `${context} persisted FastQC HTML report coverage`,
    unit: "target sample/mate report",
  });

  let pairedSamples = 0;
  let singleEndSamples = 0;
  for (const entry of expected.byIdentity.values()) {
    const sample = sampleById.get(entry.sampleId);
    const field = entry.mate === "R1" ? "fastqcReport1" : "fastqcReport2";
    const writtenPath = sample?.[field];
    const artifactPath = reportPathByIdentity.get(entry.identity);
    if (
      typeof writtenPath !== "string" ||
      writtenPath.length === 0 ||
      writtenPath !== artifactPath
    ) {
      fail(
        `${context}: Read ${field} does not match the persisted HTML artifact for ${entry.identity}`,
        JSON.stringify(
          {
            identity: entry.identity,
            field,
            readWriteback: writtenPath ?? null,
            artifactPath: artifactPath ?? null,
          },
          null,
          2,
        ),
      );
    }
  }

  for (const sample of expectedSamples) {
    const pairedEnd =
      typeof sample?.file2 === "string" && sample.file2.trim().length > 0;
    if (pairedEnd) {
      pairedSamples += 1;
      continue;
    }
    singleEndSamples += 1;
    if (
      sample?.fastqcReport2 !== null &&
      !(
        typeof sample?.fastqcReport2 === "string" &&
        sample.fastqcReport2.trim().length === 0
      )
    ) {
      fail(
        `${context}: single-end sample ${sample?.sampleId ?? "<unknown>"} has a non-empty fastqcReport2 writeback`,
        JSON.stringify(
          {
            sampleId: sample?.sampleId ?? null,
            fastqcReport2: sample?.fastqcReport2 ?? null,
          },
          null,
          2,
        ),
      );
    }
  }

  return {
    expectedSampleMates: expected.byIdentity.size,
    persistedHtmlReports: coverage.observedSampleCount,
    boundReadWritebacks: coverage.expectedSampleCount,
    pairedSamples,
    singleEndSamples,
  };
}

/**
 * Prove that MultiQC received a FastQC ZIP for every selected study
 * sample/mate and that every one of those identities appears in MultiQC's
 * parsed FastQC sample names. MultiQC 1.21 can emit an empty general-statistics
 * table for otherwise valid reports, so use the module's saved raw data instead.
 * Multiple completed FastQC runs may contribute duplicate staged ZIPs, so staged
 * duplicates are counted but do not hide missing identities.
 */
export function assertMultiqcFastqcCoverage({
  expectedSamples,
  generalStatsData,
  fastqcData,
  stagedFastqcArtifacts,
  expectedSequenceCountsByIdentity,
  context,
}) {
  const expected = buildExpectedFastqcMateIndex(expectedSamples, context);
  if (!Array.isArray(stagedFastqcArtifacts) || stagedFastqcArtifacts.length === 0) {
    fail(`${context}: no staged FastQC ZIP inputs were supplied`);
  }
  const parsedData =
    fastqcData && typeof fastqcData === "object" && !Array.isArray(fastqcData)
      ? [fastqcData]
      : generalStatsData;
  if (!Array.isArray(parsedData) || parsedData.length === 0) {
    fail(`${context}: MultiQC FastQC parsed data is missing`);
  }

  const stagedCounts = new Map();
  for (const artifact of stagedFastqcArtifacts) {
    const pipelineRunId =
      typeof artifact?.pipelineRunId === "string"
        ? artifact.pipelineRunId.trim()
        : "";
    const artifactId =
      typeof artifact?.artifactId === "string" ? artifact.artifactId.trim() : "";
    const sourcePath =
      typeof artifact?.sourcePath === "string" ? artifact.sourcePath.trim() : "";
    const stagedPath =
      typeof artifact?.stagedPath === "string" ? artifact.stagedPath.trim() : "";
    const sourceBasename = path.basename(sourcePath);
    const stagedBasename = path.basename(stagedPath);
    const matched = expected.byArtifactBasename.get(stagedBasename);
    if (
      !pipelineRunId ||
      !artifactId ||
      artifact?.pipelineId !== "fastqc" ||
      artifact?.outputId !== "sample_qc_data" ||
      !sourcePath ||
      !stagedPath ||
      sourceBasename !== stagedBasename ||
      !matched ||
      matched.format !== "zip" ||
      !Number.isSafeInteger(artifact?.size) ||
      artifact.size <= 0
    ) {
      fail(
        `${context}: staged FastQC input is malformed or unexpected`,
        JSON.stringify({ artifact }, null, 2),
      );
    }
    stagedCounts.set(
      matched.identity,
      (stagedCounts.get(matched.identity) || 0) + 1,
    );
  }

  const missingStaged = Array.from(expected.byIdentity.keys()).filter(
    (identity) => !stagedCounts.has(identity),
  );
  if (missingStaged.length > 0) {
    fail(
      `${context}: staged FastQC ZIPs do not cover every expected study sample/mate`,
      JSON.stringify(
        {
          expected: Array.from(expected.byIdentity.keys()),
          staged: Array.from(stagedCounts.keys()),
          missing: missingStaged,
        },
        null,
        2,
      ),
    );
  }

  let expectedSequenceCounts = null;
  if (expectedSequenceCountsByIdentity != null) {
    const entries =
      expectedSequenceCountsByIdentity instanceof Map
        ? Array.from(expectedSequenceCountsByIdentity.entries())
        : expectedSequenceCountsByIdentity &&
            typeof expectedSequenceCountsByIdentity === "object" &&
            !Array.isArray(expectedSequenceCountsByIdentity)
          ? Object.entries(expectedSequenceCountsByIdentity)
          : null;
    if (!entries) {
      fail(
        `${context}: expected sequence counts must be supplied as a Map or object`,
      );
    }
    assertExactSampleCoverage({
      expectedSampleIds: Array.from(expected.byIdentity.keys()),
      observedSampleIds: entries.map(([identity]) => identity),
      context: `${context} expected sequence-count ground truth`,
      unit: "target sample/mate sequence count",
    });
    expectedSequenceCounts = new Map();
    for (const [identity, count] of entries) {
      if (!Number.isSafeInteger(count) || count <= 0) {
        fail(
          `${context}: expected total_sequences is not a positive safe integer for ${identity}`,
          JSON.stringify({ identity, total_sequences: count ?? null }, null, 2),
        );
      }
      expectedSequenceCounts.set(identity, count);
    }
  }

  const parsedSampleNames = new Set();
  const parsedIdentities = new Set();
  const sequenceCountEvidence = new Map();
  for (const section of parsedData) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      fail(`${context}: MultiQC general-statistics section is malformed`);
    }
    for (const [sampleName, metrics] of Object.entries(section)) {
      if (!sampleName.trim()) continue;
      parsedSampleNames.add(sampleName);
      const identity = expected.multiqcAliasToIdentity.get(
        normalizeMultiqcSampleName(sampleName),
      );
      if (!identity) continue;
      parsedIdentities.add(identity);
      if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
        fail(
          `${context}: MultiQC metrics are malformed for ${identity}`,
          JSON.stringify({ identity, sampleName, metrics: metrics ?? null }, null, 2),
        );
      }
      if (Object.keys(metrics).length === 0) {
        fail(
          `${context}: MultiQC metrics are empty for ${identity}`,
          JSON.stringify({ identity, sampleName }, null, 2),
        );
      }
      const totalSequences = Object.prototype.hasOwnProperty.call(
        metrics,
        "total_sequences",
      )
        ? metrics.total_sequences
        : metrics["Total Sequences"];
      if (totalSequences == null) {
        continue;
      }
      if (!Number.isSafeInteger(totalSequences) || totalSequences <= 0) {
        fail(
          `${context}: total_sequences is not a positive safe integer for ${identity}`,
          JSON.stringify(
            { identity, sampleName, total_sequences: totalSequences ?? null },
            null,
            2,
          ),
        );
      }
      const evidence = sequenceCountEvidence.get(identity) || [];
      evidence.push({ sampleName, totalSequences });
      sequenceCountEvidence.set(identity, evidence);
    }
  }
  const unmatchedParsedSampleNames = [];
  for (const sampleName of parsedSampleNames) {
    const identity = expected.multiqcAliasToIdentity.get(
      normalizeMultiqcSampleName(sampleName),
    );
    if (!identity) {
      unmatchedParsedSampleNames.push(sampleName);
    }
  }
  const missingParsed = Array.from(expected.byIdentity.keys()).filter(
    (identity) => !parsedIdentities.has(identity),
  );
  if (missingParsed.length > 0) {
    fail(
      `${context}: MultiQC general statistics do not cover every expected study sample/mate`,
      JSON.stringify(
        {
          expected: Array.from(expected.byIdentity.keys()),
          parsedSampleNames: Array.from(parsedSampleNames),
          missing: missingParsed,
          unmatchedParsedSampleNames,
        },
        null,
        2,
      ),
    );
  }

  const missingSequenceCounts = Array.from(expected.byIdentity.keys()).filter(
    (identity) => !sequenceCountEvidence.has(identity),
  );
  if (missingSequenceCounts.length > 0) {
    fail(
      `${context}: MultiQC general statistics lack total_sequences for expected study sample/mates`,
      JSON.stringify(
        {
          expected: Array.from(expected.byIdentity.keys()),
          withSequenceCounts: Array.from(sequenceCountEvidence.keys()),
          missing: missingSequenceCounts,
        },
        null,
        2,
      ),
    );
  }

  const sequenceCounts = new Map();
  for (const [identity, evidence] of sequenceCountEvidence) {
    if (evidence.length !== 1) {
      const distinctCounts = new Set(
        evidence.map((entry) => entry.totalSequences),
      );
      fail(
        `${context}: MultiQC has ${
          distinctCounts.size > 1 ? "conflicting" : "duplicate"
        } total_sequences evidence for ${identity}`,
        JSON.stringify({ identity, evidence }, null, 2),
      );
    }
    sequenceCounts.set(identity, evidence[0].totalSequences);
  }

  if (expectedSequenceCounts) {
    for (const [identity, expectedCount] of expectedSequenceCounts) {
      const observedCount = sequenceCounts.get(identity);
      if (observedCount !== expectedCount) {
        fail(
          `${context}: MultiQC total_sequences does not match ground truth for ${identity}`,
          JSON.stringify(
            {
              identity,
              expected: expectedCount,
              observed: observedCount ?? null,
            },
            null,
            2,
          ),
        );
      }
    }
  }

  return {
    expectedSampleMates: expected.byIdentity.size,
    parsedSampleNames: parsedSampleNames.size,
    sequenceCountsByIdentity: Object.fromEntries(sequenceCounts),
    sequenceCountsGroundTruthChecked: expectedSequenceCounts !== null,
    stagedFastqcInputs: stagedFastqcArtifacts.length,
    stagedDuplicateInputs:
      stagedFastqcArtifacts.length - stagedCounts.size,
    unmatchedParsedSampleNames,
  };
}

const NANOPLOT_NANOSTATS_KEYS = [
  "number_of_reads",
  "number_of_bases",
  "median_read_length",
  "mean_read_length",
  "n50",
  "mean_qual",
];

const NANOPLOT_MULTIQC_FIELDS = new Map([
  ["number_of_reads", "Number of reads_fastq"],
  ["number_of_bases", "Total bases_fastq"],
  ["median_read_length", "Median read length_fastq"],
  ["mean_read_length", "Mean read length_fastq"],
  ["n50", "Read length N50_fastq"],
  ["mean_qual", "Mean read quality_fastq"],
]);

/**
 * Parse the exact NanoPlot 1.42 `--tsv_stats` contract. This deliberately does
 * not accept the older human-readable `Label: value` layout: MultiQC and the
 * runtime proof must consume the same machine-readable source artifact.
 */
export function parseNanoplotNanoStatsTsv({ text, context }) {
  if (typeof text !== "string" || text.length === 0) {
    fail(`${context}: NanoStats content is empty`);
  }
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== "Metrics\tdataset") {
    fail(
      `${context}: NanoStats must use the exact NanoPlot 1.42 TSV layout`,
      JSON.stringify({ header: lines[0] ?? null }, null, 2),
    );
  }

  const metrics = {};
  for (const line of lines.slice(1)) {
    const columns = line.split("\t");
    if (columns.length !== 2) {
      fail(`${context}: NanoStats rows must contain exactly two TSV columns`);
    }
    const [key, rawValue] = columns;
    // NanoMath 1.4 writes many additional two-column metrics (stdev,
    // median quality, Top-5 values, reads above Q thresholds). The workflow's
    // Python summary builder intentionally ignores those. Mirror that contract
    // here while keeping the six consumed metrics exact and fail-closed.
    if (!NANOPLOT_NANOSTATS_KEYS.includes(key)) continue;
    if (Object.prototype.hasOwnProperty.call(metrics, key)) {
      fail(
        `${context}: NanoStats contains a duplicate required metric`,
        JSON.stringify({ key }, null, 2),
      );
    }

    if (key === "number_of_reads") {
      if (!/^[1-9]\d*$/.test(rawValue)) {
        fail(`${context}: NanoStats number_of_reads must be a positive integer`);
      }
    } else if (!/^(?:0|[1-9]\d*)\.\d$/.test(rawValue)) {
      fail(
        `${context}: NanoStats ${key} must use NanoPlot's fixed one-decimal representation`,
      );
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) {
      fail(`${context}: NanoStats ${key} is not a finite non-negative number`);
    }
    if (
      (key === "number_of_bases" || key === "n50") &&
      (!Number.isSafeInteger(value) || value <= 0)
    ) {
      fail(`${context}: NanoStats ${key} must represent a positive safe integer`);
    }
    if (
      ["number_of_reads", "median_read_length", "mean_read_length"].includes(key) &&
      value <= 0
    ) {
      fail(`${context}: NanoStats ${key} must be positive`);
    }
    if (key === "number_of_reads" && !Number.isSafeInteger(value)) {
      fail(`${context}: NanoStats number_of_reads must be a positive safe integer`);
    }
    if (key === "mean_qual" && value > 100) {
      fail(`${context}: NanoStats mean_qual exceeds the supported Phred range`);
    }
    metrics[key] = value;
  }

  const missing = NANOPLOT_NANOSTATS_KEYS.filter(
    (key) => !Object.prototype.hasOwnProperty.call(metrics, key),
  );
  if (missing.length > 0) {
    fail(
      `${context}: NanoStats is missing required metrics`,
      JSON.stringify({ missing }, null, 2),
    );
  }
  return metrics;
}

/**
 * Bind one NanoStats artifact to the raw FASTQ selected for the sample named
 * by its exact artifact basename and persisted sample FK.
 */
export function assertNanoplotNanoStatsGroundTruth({
  sampleId,
  metrics,
  groundTruth,
  context,
}) {
  if (typeof sampleId !== "string" || sampleId.trim().length === 0) {
    fail(`${context}: NanoStats sample ID is invalid`);
  }
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    fail(`${context}: parsed NanoStats metrics are invalid for ${sampleId}`);
  }
  if (
    !groundTruth ||
    typeof groundTruth !== "object" ||
    Array.isArray(groundTruth)
  ) {
    fail(`${context}: raw FASTQ ground truth is missing for ${sampleId}/R1`);
  }

  const expected = {
    number_of_reads: groundTruth.readCount,
    number_of_bases: groundTruth.totalBases,
    mean_read_length: Number(
      formatHalfEvenBinary64(
        groundTruth.totalBases / groundTruth.readCount,
        1,
      ),
    ),
    median_read_length: Number(
      formatHalfEvenBinary64(groundTruth.medianReadLength, 1),
    ),
    n50: groundTruth.nanomathN50,
    mean_qual: Number(
      formatHalfEvenBinary64(
        groundTruth.nanomathMeanReadQuality,
        1,
      ),
    ),
  };
  for (const key of NANOPLOT_NANOSTATS_KEYS) {
    if (
      !Number.isFinite(metrics[key]) ||
      !Number.isFinite(expected[key]) ||
      metrics[key] !== expected[key]
    ) {
      fail(
        `${context}: NanoStats ${key} does not match raw FASTQ ground truth for ${sampleId}/R1`,
        JSON.stringify(
          {
            sampleId,
            key,
            nanoStats: metrics[key] ?? null,
            groundTruth: expected[key] ?? null,
          },
          null,
          2,
        ),
      );
    }
  }
  return {
    sampleId,
    checkedMetrics: NANOPLOT_NANOSTATS_KEYS.length,
  };
}

/**
 * Prove that every staged NanoPlot NanoStats artifact was parsed by MultiQC's
 * NanoStat module and that the serialized values in `multiqc_data.json` equal
 * the independently parsed source TSV values exactly.
 */
export function assertMultiqcNanoplotMetrics({
  expectedStats,
  multiqcNanostatData,
  context,
}) {
  if (!Array.isArray(expectedStats) || expectedStats.length === 0) {
    fail(`${context}: no NanoPlot NanoStats ground truth was supplied`);
  }
  if (
    !multiqcNanostatData ||
    typeof multiqcNanostatData !== "object" ||
    Array.isArray(multiqcNanostatData)
  ) {
    fail(`${context}: multiqc_data.json has no multiqc_nanostat object`);
  }

  const expectedBySampleId = new Map();
  for (const entry of expectedStats) {
    const sampleId =
      typeof entry?.sampleId === "string" ? entry.sampleId.trim() : "";
    const metrics = entry?.metrics;
    if (
      !sampleId ||
      !metrics ||
      typeof metrics !== "object" ||
      Array.isArray(metrics)
    ) {
      fail(`${context}: NanoPlot ground-truth entry is malformed`);
    }
    const previous = expectedBySampleId.get(sampleId);
    if (previous) {
      for (const key of NANOPLOT_NANOSTATS_KEYS) {
        if (previous[key] !== metrics[key]) {
          fail(
            `${context}: duplicate NanoStats artifacts disagree for ${sampleId}`,
            JSON.stringify(
              { key, previous: previous[key] ?? null, current: metrics[key] ?? null },
              null,
              2,
            ),
          );
        }
      }
    } else {
      expectedBySampleId.set(sampleId, metrics);
    }
  }

  const observedSampleIds = [];
  for (const [sampleName, metrics] of Object.entries(multiqcNanostatData)) {
    const sampleId = sampleName.trim();
    if (!sampleId || sampleId !== sampleName) {
      fail(
        `${context}: MultiQC NanoStat sample name is invalid`,
        JSON.stringify({ sampleName }, null, 2),
      );
    }
    const expected = expectedBySampleId.get(sampleId);
    if (!expected) {
      fail(
        `${context}: MultiQC contains NanoStat metrics without staged ground truth`,
        JSON.stringify({ sampleName }, null, 2),
      );
    }
    if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
      fail(`${context}: MultiQC NanoStat metrics are malformed for ${sampleId}`);
    }
    for (const [sourceKey, multiqcKey] of NANOPLOT_MULTIQC_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(metrics, multiqcKey)) {
        fail(
          `${context}: MultiQC NanoStat metrics are missing ${multiqcKey} for ${sampleId}`,
        );
      }
      const observed = metrics[multiqcKey];
      if (!Number.isFinite(observed) || observed !== expected[sourceKey]) {
        fail(
          `${context}: MultiQC NanoStat metric does not match NanoStats ground truth for ${sampleId}`,
          JSON.stringify(
            {
              sourceKey,
              multiqcKey,
              expected: expected[sourceKey] ?? null,
              observed: observed ?? null,
            },
            null,
            2,
          ),
        );
      }
    }
    observedSampleIds.push(sampleId);
  }

  const coverage = assertExactSampleCoverage({
    expectedSampleIds: Array.from(expectedBySampleId.keys()),
    observedSampleIds,
    context: `${context} MultiQC NanoStat sample coverage`,
    unit: "NanoPlot sample",
  });
  return {
    expectedNanoPlotSamples: coverage.expectedSampleCount,
    parsedNanoPlotSamples: coverage.observedSampleCount,
    stagedNanoStatsArtifacts: expectedStats.length,
    stagedDuplicateNanoStats: expectedStats.length - expectedBySampleId.size,
  };
}

const MD5_HEX_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Validate the evidence produced by independent checksum recomputation. Every
 * file the harness resolved as readable must have been hashed; deterministic
 * fixtures can additionally require every configured file to be readable.
 */
export function assertChecksumVerificationCoverage({
  targets,
  requireEveryConfiguredFile = false,
  context,
}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    fail(`${context}: no checksum file targets were supplied`);
  }

  const identities = new Set();
  const counts = {
    configuredR1: 0,
    configuredR2: 0,
    readableR1: 0,
    readableR2: 0,
    verifiedR1: 0,
    verifiedR2: 0,
  };
  const unresolved = [];

  for (const target of targets) {
    const mate = target?.mate;
    const readId =
      typeof target?.readId === "string" && target.readId
        ? target.readId
        : "<unknown>";
    if (!["R1", "R2"].includes(mate)) {
      fail(
        `${context}: checksum target ${readId} has invalid mate`,
        JSON.stringify(target, null, 2),
      );
    }
    const identity = `${readId}:${mate}`;
    if (identities.has(identity)) {
      fail(`${context}: duplicate checksum target ${identity}`);
    }
    identities.add(identity);
    counts[`configured${mate}`] += 1;

    const readable =
      typeof target?.onDiskPath === "string" && target.onDiskPath.length > 0;
    if (!readable) {
      unresolved.push({
        readId,
        sampleId: target?.sampleId ?? null,
        mate,
        configuredPath: target?.configuredPath ?? null,
        error: target?.error ?? "not readable on this host",
      });
      if (target?.computedChecksum != null) {
        fail(`${context}: unresolved checksum target ${identity} has computed evidence`);
      }
      continue;
    }
    counts[`readable${mate}`] += 1;

    if (typeof target?.computedChecksum !== "string") {
      fail(
        `${context}: readable checksum target ${identity} was not independently recomputed`,
        JSON.stringify(
          {
            readId,
            sampleId: target?.sampleId ?? null,
            mate,
            onDiskPath: target.onDiskPath,
            error: target?.error ?? null,
          },
          null,
          2,
        ),
      );
    }
    if (
      !MD5_HEX_PATTERN.test(target.computedChecksum) ||
      !MD5_HEX_PATTERN.test(target?.storedChecksum ?? "")
    ) {
      fail(
        `${context}: checksum target ${identity} has invalid md5 evidence`,
        JSON.stringify(target, null, 2),
      );
    }
    if (target.computedChecksum !== target.storedChecksum) {
      fail(
        `${context}: stored checksum does not match independently recomputed md5 for ${identity}`,
        JSON.stringify(
          {
            readId,
            sampleId: target?.sampleId ?? null,
            mate,
            configuredPath: target?.configuredPath ?? null,
            onDiskPath: target.onDiskPath,
            stored: target.storedChecksum,
            computed: target.computedChecksum,
          },
          null,
          2,
        ),
      );
    }
    counts[`verified${mate}`] += 1;
  }

  if (counts.configuredR1 === 0 || counts.verifiedR1 === 0) {
    fail(
      `${context}: no R1 file was independently verified`,
      JSON.stringify({ counts, unresolved }, null, 2),
    );
  }
  if (requireEveryConfiguredFile && unresolved.length > 0) {
    fail(
      `${context}: deterministic fixture requires every configured R1/R2 file to be readable and verified`,
      JSON.stringify({ counts, unresolved }, null, 2),
    );
  }

  return {
    ...counts,
    requireEveryConfiguredFile,
    unresolved,
  };
}

export function assertFastqChecksumSummaryRows({
  header,
  rows,
  targets,
  context,
}) {
  const expectedHeader = ["sample_id", "checksum1", "checksum2"];
  if (
    !Array.isArray(header) ||
    header.length !== expectedHeader.length ||
    header.some((value, index) => value !== expectedHeader[index])
  ) {
    fail(
      `${context}: checksum summary header is not the exact workflow contract`,
      JSON.stringify({ header, expectedHeader }, null, 2),
    );
  }
  if (!Array.isArray(rows) || !Array.isArray(targets) || targets.length === 0) {
    fail(`${context}: checksum summary rows and independent targets are required`);
  }

  const targetsBySample = new Map();
  const identities = new Set();
  for (const target of targets) {
    const sampleId =
      typeof target?.sampleId === "string" ? target.sampleId : "";
    const readId = typeof target?.readId === "string" ? target.readId : "";
    const mate = target?.mate;
    const identity = `${sampleId}/${mate}`;
    if (
      !sampleId ||
      !readId ||
      !["R1", "R2"].includes(mate) ||
      identities.has(identity)
    ) {
      fail(
        `${context}: independent checksum targets have an invalid or duplicate sample/mate identity`,
        JSON.stringify({ identity, target }, null, 2),
      );
    }
    identities.add(identity);
    if (
      typeof target?.configuredPath !== "string" ||
      !target.configuredPath ||
      typeof target?.onDiskPath !== "string" ||
      !path.isAbsolute(target.onDiskPath) ||
      !MD5_HEX_PATTERN.test(target?.computedChecksum ?? "") ||
      !MD5_HEX_PATTERN.test(target?.storedChecksum ?? "") ||
      target.computedChecksum !== target.storedChecksum
    ) {
      fail(
        `${context}: ${identity} lacks exact path-bound independent checksum evidence`,
        JSON.stringify(target, null, 2),
      );
    }
    const sample = targetsBySample.get(sampleId) ?? {};
    sample[mate] = target;
    targetsBySample.set(sampleId, sample);
  }
  for (const [sampleId, sample] of targetsBySample) {
    if (!sample.R1) {
      fail(`${context}: sample ${sampleId} has no independently verified R1`);
    }
    if (sample.R2 && sample.R2.readId !== sample.R1.readId) {
      fail(`${context}: sample ${sampleId} R1/R2 targets do not belong to the same Read`);
    }
  }

  const parsedRows = rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== expectedHeader.length) {
      fail(`${context}: checksum summary row ${index + 1} has the wrong width`);
    }
    const [sampleId, checksum1, checksum2] = row;
    if (typeof sampleId !== "string" || !sampleId) {
      fail(`${context}: checksum summary row ${index + 1} has an invalid sample_id`);
    }
    return { sampleId, checksum1, checksum2 };
  });
  const coverage = assertExactSampleCoverage({
    expectedSampleIds: Array.from(targetsBySample.keys()),
    observedSampleIds: parsedRows.map((row) => row.sampleId),
    context,
  });

  let pairedSamples = 0;
  for (const row of parsedRows) {
    const expected = targetsBySample.get(row.sampleId);
    if (
      row.checksum1 !== expected.R1.computedChecksum ||
      !MD5_HEX_PATTERN.test(row.checksum1)
    ) {
      fail(
        `${context}: checksum1 does not match independently recomputed R1 md5 for ${row.sampleId}`,
        JSON.stringify(
          {
            summary: row.checksum1,
            computed: expected.R1.computedChecksum,
            configuredPath: expected.R1.configuredPath,
            onDiskPath: expected.R1.onDiskPath,
          },
          null,
          2,
        ),
      );
    }
    if (expected.R2) {
      pairedSamples += 1;
      if (
        row.checksum2 !== expected.R2.computedChecksum ||
        !MD5_HEX_PATTERN.test(row.checksum2)
      ) {
        fail(
          `${context}: checksum2 does not match independently recomputed R2 md5 for ${row.sampleId}`,
        );
      }
    } else if (row.checksum2 !== "") {
      fail(`${context}: single-end sample ${row.sampleId} has a non-empty checksum2`);
    }
  }

  return {
    expectedSampleCount: coverage.expectedSampleCount,
    checkedRows: coverage.observedSampleCount,
    independentlyVerifiedFiles: targets.length,
    pairedSamples,
    singleEndSamples: targetsBySample.size - pairedSamples,
  };
}

export function assertRequiredRelativeOutput({
  runFolder,
  relativePath,
  requiredContent,
  context,
}) {
  if (typeof runFolder !== "string" || !path.isAbsolute(runFolder)) {
    fail(
      `${context}: cannot verify required output without an absolute run folder`,
      JSON.stringify({ runFolder: runFolder ?? null }, null, 2),
    );
  }
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    fail(`${context}: required output path must be a non-empty relative path`);
  }

  const normalizedRelativePath = relativePath.trim();
  if (path.isAbsolute(normalizedRelativePath)) {
    fail(
      `${context}: required output path must be relative to the run folder`,
      normalizedRelativePath,
    );
  }

  const absolutePath = path.resolve(runFolder, normalizedRelativePath);
  if (
    absolutePath === path.resolve(runFolder) ||
    !pathIsWithin(absolutePath, runFolder)
  ) {
    fail(
      `${context}: required output path escapes the run folder`,
      JSON.stringify({ runFolder, relativePath: normalizedRelativePath }, null, 2),
    );
  }
  if (!fs.existsSync(absolutePath)) {
    fail(
      `${context}: required pipeline output is missing`,
      JSON.stringify({ relativePath: normalizedRelativePath, absolutePath }, null, 2),
    );
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isFile() || stat.size <= 0) {
    fail(
      `${context}: required pipeline output is not a non-empty regular file`,
      JSON.stringify(
        {
          relativePath: normalizedRelativePath,
          absolutePath,
          isFile: stat.isFile(),
          size: stat.size,
        },
        null,
        2,
      ),
    );
  }

  const marker =
    typeof requiredContent === "string" && requiredContent.length > 0
      ? requiredContent
      : undefined;
  if (marker !== undefined) {
    const content = fs.readFileSync(absolutePath, "utf8");
    if (!content.includes(marker)) {
      fail(
        `${context}: required pipeline output does not contain the expected content`,
        JSON.stringify(
          {
            relativePath: normalizedRelativePath,
            absolutePath,
            requiredContent: marker,
            size: stat.size,
          },
          null,
          2,
        ),
      );
    }
  }

  return {
    relativePath: normalizedRelativePath,
    absolutePath,
    size: stat.size,
    ...(marker !== undefined ? { requiredContent: marker } : {}),
  };
}

/**
 * Atomically move a set of fixture files aside and return a strict restore.
 * Validation happens for every file before the first rename, and a partial
 * staging failure rolls back already moved files. Restore failures are fatal:
 * an E2E gate must not report green after damaging the shared seeded dataset.
 */
export function stageFilesMissing({
  root,
  filePaths,
  stashSuffix = ".seqdesk-e2e.bak",
}) {
  const uniquePaths = Array.from(new Set(filePaths.map((value) => path.resolve(value))));
  if (uniquePaths.length === 0) fail("No fixture files were provided for sabotage");

  const planned = uniquePaths.map((absolute) => {
    if (!pathIsWithin(absolute, root)) {
      fail(
        "Refusing to move a fixture file outside the configured root",
        JSON.stringify({ root, absolute }, null, 2),
      );
    }
    if (!fs.existsSync(absolute)) {
      fail(
        "E2E fixture file is already missing before sabotage",
        JSON.stringify({ root, absolute }, null, 2),
      );
    }
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size <= 0) {
      fail(
        "E2E fixture input is not a non-empty regular file",
        JSON.stringify({ absolute, size: stat.size, isFile: stat.isFile() }, null, 2),
      );
    }
    const stashed = `${absolute}${stashSuffix}`;
    if (fs.existsSync(stashed)) {
      fail(
        "E2E found a stale fixture stash and will not overwrite it",
        JSON.stringify({ absolute, stashed }, null, 2),
      );
    }
    return { absolute, stashed, size: stat.size };
  });

  const moved = [];
  try {
    for (const entry of planned) {
      fs.renameSync(entry.absolute, entry.stashed);
      moved.push(entry);
    }
  } catch (error) {
    const restoreErrors = [];
    for (const entry of [...moved].reverse()) {
      try {
        if (fs.existsSync(entry.stashed)) fs.renameSync(entry.stashed, entry.absolute);
      } catch (restoreError) {
        restoreErrors.push(
          `${entry.absolute}: ${
            restoreError instanceof Error ? restoreError.message : String(restoreError)
          }`,
        );
      }
    }
    fail(
      `Failed to stage missing-file sabotage: ${
        error instanceof Error ? error.message : String(error)
      }`,
      restoreErrors.length > 0
        ? `Rollback also failed:\n${restoreErrors.join("\n")}`
        : undefined,
    );
  }

  return {
    moved,
    restore() {
      const errors = [];
      for (const entry of moved) {
        try {
          if (!fs.existsSync(entry.stashed)) {
            errors.push(`${entry.absolute}: stash ${entry.stashed} is missing`);
            continue;
          }
          fs.renameSync(entry.stashed, entry.absolute);
          const restored = fs.statSync(entry.absolute);
          if (!restored.isFile() || restored.size !== entry.size) {
            errors.push(
              `${entry.absolute}: restored file shape changed (expected ${entry.size} bytes, got ${restored.size})`,
            );
          }
          if (fs.existsSync(entry.stashed)) {
            errors.push(`${entry.absolute}: stash still exists after restore`);
          }
        } catch (error) {
          errors.push(
            `${entry.absolute}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (errors.length > 0) {
        fail("E2E could not restore all sabotaged fixture files exactly", errors.join("\n"));
      }
      return {
        restoredCount: moved.length,
        restoredPaths: moved.map((entry) => entry.absolute),
      };
    },
  };
}

export function parsePrimarySacctRecord(stdout, jobId) {
  const expectedJobId = String(jobId || "");
  const row = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|"))
    .find(([rowJobId]) => rowJobId === expectedJobId);

  if (!row) return null;
  const [rowJobId, jobName, rawState, exitCode, workDir, nodeList] = row;
  return {
    jobId: String(rowJobId || "").trim(),
    jobName: String(jobName || "").trim(),
    state: normalizeSlurmState(rawState),
    rawState: String(rawState || "").trim(),
    exitCode: String(exitCode || "").trim(),
    workDir: String(workDir || "").trim(),
    nodeList: String(nodeList || "").trim(),
  };
}

export function parsePrimarySqueueRecord(stdout, jobId) {
  const expectedJobId = String(jobId || "");
  const row = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|"))
    .find(([rowJobId]) => rowJobId === expectedJobId);
  if (!row) return null;
  const [rowJobId, jobName, rawState, workDir, nodeList] = row;
  return {
    jobId: String(rowJobId || "").trim(),
    jobName: String(jobName || "").trim(),
    state: normalizeSlurmState(rawState),
    rawState: String(rawState || "").trim(),
    exitCode: "",
    workDir: String(workDir || "").trim(),
    nodeList: String(nodeList || "").trim(),
  };
}

function exitCodeIsZero(value) {
  return String(value || "").trim() === "0:0";
}

function exitCodeIsNonZero(value) {
  const match = String(value || "").trim().match(/^(\d+):(\d+)$/);
  return Boolean(match && (Number(match[1]) !== 0 || Number(match[2]) !== 0));
}

export function assertSlurmLaunchIdentity({
  runId,
  jobId,
  run,
  startPayload,
}) {
  const expectedJobId = String(jobId || "");
  if (!/^[1-9]\d*$/.test(expectedJobId)) {
    fail(
      "SLURM launch did not expose a positive numeric job id",
      JSON.stringify({ runId, jobId, startPayload }, null, 2),
    );
  }
  if (startPayload?.executionMode !== "slurm") {
    fail(
      "SLURM start response did not resolve to executionMode=slurm",
      JSON.stringify({ runId, startPayload }, null, 2),
    );
  }
  if (run?.executionMode !== "slurm") {
    fail(
      "PipelineRun did not persist executionMode=slurm",
      JSON.stringify({ runId, executionMode: run?.executionMode ?? null }, null, 2),
    );
  }
  if (String(run?.queueJobId || "") !== expectedJobId) {
    fail(
      "PipelineRun queueJobId does not match the job returned by start",
      JSON.stringify(
        {
          runId,
          expectedJobId,
          queueJobId: run?.queueJobId ?? null,
        },
        null,
        2,
      ),
    );
  }
  if (typeof run?.runFolder !== "string" || !path.isAbsolute(run.runFolder)) {
    fail(
      "SLURM PipelineRun did not persist an absolute runFolder",
      JSON.stringify({ runId, runFolder: run?.runFolder ?? null }, null, 2),
    );
  }
  return {
    jobId: expectedJobId,
    runFolder: run.runFolder,
    expectedJobName: expectedSeqDeskJobName(runId),
  };
}

export function assertSlurmAccountingIdentity(
  record,
  { runId, jobId, runFolder },
) {
  if (!record) {
    fail(
      `SLURM accounting has no primary record for job ${jobId}`,
      JSON.stringify({ runId, jobId, runFolder }, null, 2),
    );
  }
  if (record.jobId !== String(jobId)) {
    fail(
      "SLURM accounting record belongs to a different job",
      JSON.stringify({ expectedJobId: String(jobId), record }, null, 2),
    );
  }

  const expectedJobName = expectedSeqDeskJobName(runId);
  if (record.jobName !== expectedJobName) {
    fail(
      "SLURM accounting job name does not match the exact PipelineRun identity",
      JSON.stringify({ expectedJobName, record }, null, 2),
    );
  }
  if (
    !record.workDir ||
    !pathIsWithin(record.workDir, runFolder) ||
    !pathsReferToSameLocation(record.workDir, runFolder)
  ) {
    fail(
      "SLURM accounting WorkDir is outside the PipelineRun folder or not its exact canonical path",
      JSON.stringify({ expectedRunFolder: runFolder, record }, null, 2),
    );
  }
  return record;
}

export function assertSlurmAccountingRecord(
  record,
  {
    runId,
    jobId,
    runFolder,
    expectedOutcome,
    requireAllocatedNode = expectedOutcome === "success",
  },
) {
  assertSlurmAccountingIdentity(record, { runId, jobId, runFolder });

  if (expectedOutcome === "success") {
    if (record.state !== "COMPLETED") {
      fail(
        `SLURM allocation ${jobId} ended in ${record.state || "<unknown>"}, expected COMPLETED`,
        JSON.stringify(record, null, 2),
      );
    }
    if (!exitCodeIsZero(record.exitCode)) {
      fail(
        "SLURM accounting reported a non-zero allocation exit",
        JSON.stringify(record, null, 2),
      );
    }
  } else if (expectedOutcome === "failure") {
    if (!SLURM_TERMINAL_STATES.has(record.state)) {
      fail(
        `SLURM allocation ${jobId} is not terminal (${record.state || "<unknown>"})`,
        JSON.stringify(record, null, 2),
      );
    }
    if (record.state !== "FAILED") {
      fail(
        `Deliberately broken pipeline allocation ended in ${record.state}, expected FAILED`,
        JSON.stringify(record, null, 2),
      );
    }
    if (!exitCodeIsNonZero(record.exitCode)) {
      fail(
        "Deliberately broken pipeline did not produce a non-zero SLURM allocation exit",
        JSON.stringify(record, null, 2),
      );
    }
  } else if (expectedOutcome === "cancelled") {
    if (record.state !== "CANCELLED" && record.state !== "CANCELED") {
      fail(
        `SLURM allocation ${jobId} ended in ${record.state || "<unknown>"}, expected CANCELLED`,
        JSON.stringify(record, null, 2),
      );
    }
  } else {
    fail(`Unsupported expected SLURM outcome: ${expectedOutcome}`);
  }

  if (
    requireAllocatedNode &&
    (!record.nodeList ||
      /^(?:none|unknown|n\/a|\(null\)|none assigned)$/i.test(record.nodeList))
  ) {
    fail(
      "SLURM accounting did not record an allocated compute node",
      JSON.stringify(record, null, 2),
    );
  }
  return record;
}

const SLURM_COMPLETION_ATTESTATION_KEYS = [
  "schema_version",
  "run_id",
  "slurm_job_id",
  "host",
  "phase",
  "exit_code",
];

export function slurmCompletionAttestationPath(runFolder, jobId) {
  if (typeof runFolder !== "string" || !path.isAbsolute(runFolder)) {
    fail("SLURM completion attestation requires an absolute run folder");
  }
  const normalizedJobId = String(jobId || "");
  if (!/^[1-9]\d*$/.test(normalizedJobId)) {
    fail("SLURM completion attestation requires a positive numeric job id");
  }
  return path.join(
    runFolder,
    "logs",
    `slurm-${normalizedJobId}.attestation`,
  );
}

export function parseSlurmCompletionAttestation(
  contents,
  context = "SLURM completion attestation",
) {
  if (typeof contents !== "string" || contents.trim().length === 0) {
    fail(`${context}: attestation file is empty`);
  }
  const values = {};
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    if (rawLine === "") continue;
    const separator = rawLine.indexOf("=");
    if (separator <= 0) {
      fail(`${context}: invalid line ${index + 1}`, rawLine);
    }
    const key = rawLine.slice(0, separator);
    const value = rawLine.slice(separator + 1);
    if (!SLURM_COMPLETION_ATTESTATION_KEYS.includes(key)) {
      fail(`${context}: unknown field ${key}`);
    }
    if (Object.hasOwn(values, key)) {
      fail(`${context}: duplicate field ${key}`);
    }
    if (value.length === 0 || value !== value.trim()) {
      fail(`${context}: invalid value for ${key}`);
    }
    values[key] = value;
  }
  const missing = SLURM_COMPLETION_ATTESTATION_KEYS.filter(
    (key) => !Object.hasOwn(values, key),
  );
  if (missing.length > 0) {
    fail(`${context}: missing required fields`, missing.join(", "));
  }

  return {
    schemaVersion: values.schema_version,
    runId: values.run_id,
    jobId: values.slurm_job_id,
    host: values.host,
    phase: values.phase,
    exitCode: values.exit_code,
  };
}

function normalizeHost(value) {
  return String(value || "")
    .trim()
    .replace(/\.+$/, "")
    .toLowerCase();
}

function hostsReferToSameNode(left, right) {
  const normalizedLeft = normalizeHost(left);
  const normalizedRight = normalizeHost(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const leftIsFqdn = normalizedLeft.includes(".");
  const rightIsFqdn = normalizedRight.includes(".");
  if (leftIsFqdn && rightIsFqdn) {
    // Never collapse two distinct fully-qualified hosts to their first label.
    // That would accept node01.domain-a as evidence for node01.domain-b.
    return false;
  }
  return normalizedLeft.split(".")[0] === normalizedRight.split(".")[0];
}

export function assertSlurmCompletionAttestation({
  contents,
  runId,
  jobId,
  nodeHosts,
  context,
}) {
  const label = context || `SLURM allocation ${jobId}`;
  const attestation = parseSlurmCompletionAttestation(contents, label);
  const expectedJobId = String(jobId || "");
  if (
    attestation.schemaVersion !== "1" ||
    attestation.runId !== runId ||
    attestation.jobId !== expectedJobId ||
    attestation.phase !== "completed" ||
    attestation.exitCode !== "0"
  ) {
    fail(
      `${label}: attestation does not prove successful completion of the requested run`,
      JSON.stringify(
        {
          expected: {
            schemaVersion: "1",
            runId,
            jobId: expectedJobId,
            phase: "completed",
            exitCode: "0",
          },
          attestation,
        },
        null,
        2,
      ),
    );
  }
  if (!Array.isArray(nodeHosts) || nodeHosts.length === 0) {
    fail(`${label}: scheduler node host list is empty`);
  }
  if (
    !nodeHosts.some((nodeHost) =>
      hostsReferToSameNode(attestation.host, nodeHost),
    )
  ) {
    fail(
      `${label}: attested host is not part of the scheduler allocation`,
      JSON.stringify(
        { attestedHost: attestation.host, schedulerNodeHosts: nodeHosts },
        null,
        2,
      ),
    );
  }
  return {
    ...attestation,
    schedulerNodeHosts: [...nodeHosts],
  };
}

export function readCanonicalPipelineExit(logText) {
  const matches = Array.from(
    String(logText || "").matchAll(/Pipeline completed with exit code:\s*(\d+)/gi),
  );
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}

export function assertPipelineExitMarker(logText, { expectedOutcome, context }) {
  const exitCode = readCanonicalPipelineExit(logText);
  if (exitCode === null) {
    fail(
      `${context}: canonical pipeline exit marker is missing`,
      String(logText || "").slice(-2000),
    );
  }
  if (expectedOutcome === "success" && exitCode !== 0) {
    fail(`${context}: pipeline wrapper exited ${exitCode}, expected 0`);
  }
  if (expectedOutcome === "failure" && exitCode === 0) {
    fail(`${context}: deliberately broken pipeline wrapper exited 0`);
  }
  if (!["success", "failure"].includes(expectedOutcome)) {
    fail(`Unsupported expected pipeline exit outcome: ${expectedOutcome}`);
  }
  return exitCode;
}

/**
 * Bind a fetched PipelineRun to the exact pipeline and target requested by the
 * E2E client. Output assertions deliberately derive their expected samples from
 * the fetched run, so accepting a different order/study here would otherwise
 * make a mis-targeted run look internally consistent.
 */
export function assertRunIdentity({
  run,
  pipelineId,
  targetType,
  orderId,
  studyId,
  context,
}) {
  const label = context || "Pipeline run identity";
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    fail(`${label}: fetched run is not an object`, JSON.stringify(run ?? null));
  }
  if (typeof pipelineId !== "string" || pipelineId.length === 0) {
    fail(`${label}: expected pipelineId must be a non-empty string`);
  }
  if (!["order", "study"].includes(targetType)) {
    fail(`${label}: expected targetType must be order or study`);
  }

  const expectedOrderId = targetType === "order" ? orderId : null;
  const expectedStudyId = targetType === "study" ? studyId : null;
  if (
    (targetType === "order" &&
      (typeof expectedOrderId !== "string" || expectedOrderId.length === 0)) ||
    (targetType === "study" &&
      (typeof expectedStudyId !== "string" || expectedStudyId.length === 0))
  ) {
    fail(`${label}: expected target id is missing`);
  }
  if (
    (targetType === "order" && studyId != null) ||
    (targetType === "study" && orderId != null)
  ) {
    fail(`${label}: exactly one expected orderId/studyId must be supplied`);
  }

  const actual = {
    pipelineId: run.pipelineId ?? null,
    targetType: run.targetType ?? null,
    orderId: run.orderId ?? null,
    studyId: run.studyId ?? null,
    orderRelationId: run.order?.id ?? null,
    studyRelationId: run.study?.id ?? null,
    orderRelation: run.order === null ? null : run.order ? "present" : "missing",
    studyRelation: run.study === null ? null : run.study ? "present" : "missing",
  };
  const expected = {
    pipelineId,
    targetType,
    orderId: expectedOrderId,
    studyId: expectedStudyId,
    orderRelationId: expectedOrderId,
    studyRelationId: expectedStudyId,
    orderRelation: targetType === "order" ? "present" : null,
    studyRelation: targetType === "study" ? "present" : null,
  };

  if (
    actual.pipelineId !== expected.pipelineId ||
    actual.targetType !== expected.targetType ||
    actual.orderId !== expected.orderId ||
    actual.studyId !== expected.studyId ||
    actual.orderRelationId !== expected.orderRelationId ||
    actual.studyRelationId !== expected.studyRelationId ||
    actual.orderRelation !== expected.orderRelation ||
    actual.studyRelation !== expected.studyRelation
  ) {
    fail(
      `${label}: fetched run does not match the requested pipeline target`,
      JSON.stringify({ runId: run.id ?? null, expected, actual }, null, 2),
    );
  }

  return { runId: run.id ?? null, ...expected };
}

function parseShellWords(line, context) {
  const words = [];
  let word = "";
  let wordStarted = false;
  let quote = null;

  const finishWord = () => {
    if (!wordStarted) return;
    words.push(word);
    word = "";
    wordStarted = false;
  };

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === "'") {
      if (character === "'") {
        quote = null;
      } else {
        word += character;
      }
      continue;
    }
    if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else if (character === "\\") {
        index += 1;
        if (index >= line.length) {
          fail(`${context}: dangling escape in generated run script`);
        }
        word += line[index];
      } else {
        word += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      wordStarted = true;
      continue;
    }
    if (character === "\\") {
      wordStarted = true;
      index += 1;
      if (index >= line.length) {
        fail(`${context}: dangling escape in generated run script`);
      }
      word += line[index];
      continue;
    }
    if (/\s/.test(character)) {
      finishWord();
      continue;
    }
    if (character === "#" && !wordStarted) {
      break;
    }
    wordStarted = true;
    word += character;
  }

  if (quote !== null) {
    fail(`${context}: unterminated quote in generated run script`);
  }
  finishWord();
  return words;
}

/**
 * Parse the generated shell script without executing it and return the single
 * target passed to SeqDesk's NEXTFLOW_RUNNER array.
 */
export function parseNextflowRunTarget(runScript, context = "Pipeline run target") {
  if (typeof runScript !== "string" || runScript.length === 0) {
    fail(`${context}: generated run script is empty`);
  }
  const logicalLines = runScript.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  const targets = [];
  for (const line of logicalLines) {
    const words = parseShellWords(line, context);
    if (
      words.length >= 3 &&
      words[0] === "${NEXTFLOW_RUNNER[@]}" &&
      words[1] === "run"
    ) {
      targets.push(words[2]);
    }
  }
  if (targets.length !== 1 || !targets[0]) {
    fail(
      `${context}: expected exactly one NEXTFLOW_RUNNER run target`,
      JSON.stringify({ targets }, null, 2),
    );
  }
  return targets[0];
}

export function assertExactNextflowRunTarget({
  runScript,
  runFolder,
  expectedTarget,
  context,
}) {
  const label = context || "Pipeline run target";
  if (typeof runFolder !== "string" || !path.isAbsolute(runFolder)) {
    fail(`${label}: runFolder must be absolute`);
  }
  if (typeof expectedTarget !== "string" || !path.isAbsolute(expectedTarget)) {
    fail(`${label}: expected Nextflow target must be absolute`);
  }

  const parsedTarget = parseNextflowRunTarget(runScript, label);
  const actualTarget = path.isAbsolute(parsedTarget)
    ? parsedTarget
    : path.resolve(runFolder, parsedTarget);
  if (!pathsReferToSameLocation(actualTarget, expectedTarget)) {
    fail(
      `${label}: generated Nextflow target does not match the expected packaged workflow`,
      JSON.stringify(
        {
          parsedTarget,
          actualTarget,
          expectedTarget,
          canonicalActualTarget: canonicalPathForComparison(actualTarget),
          canonicalExpectedTarget: canonicalPathForComparison(expectedTarget),
        },
        null,
        2,
      ),
    );
  }

  return {
    parsedTarget,
    actualTarget,
    expectedTarget,
    canonicalTarget: canonicalPathForComparison(actualTarget),
  };
}

export function resolveLocalManifestPipelineTarget({
  pipelinesRoot,
  pipelineId,
  context,
}) {
  const label = context || `Pipeline package ${pipelineId}`;
  if (typeof pipelinesRoot !== "string" || !path.isAbsolute(pipelinesRoot)) {
    fail(`${label}: pipelines root must be absolute`);
  }
  if (
    typeof pipelineId !== "string" ||
    pipelineId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pipelineId) ||
    pipelineId.includes(".__tmp-") ||
    pipelineId.includes(".__backup-")
  ) {
    fail(`${label}: pipeline ID is not a valid package directory name`);
  }

  const packageRoot = path.resolve(pipelinesRoot, pipelineId);
  if (
    packageRoot === path.resolve(pipelinesRoot) ||
    !pathIsWithin(packageRoot, pipelinesRoot)
  ) {
    fail(`${label}: package root escapes the expected pipelines root`);
  }
  const manifestPath = path.join(packageRoot, "manifest.json");
  let manifest;
  try {
    const stat = fs.lstatSync(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`${label}: manifest.json is not a regular file`, manifestPath);
    }
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(
      `${label}: cannot read a valid manifest.json`,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (manifest?.package?.id !== pipelineId) {
    fail(
      `${label}: manifest package ID does not match the requested pipeline`,
      JSON.stringify(
        { expectedPipelineId: pipelineId, manifestPipelineId: manifest?.package?.id ?? null },
        null,
        2,
      ),
    );
  }
  const configuredTarget = manifest?.execution?.pipeline;
  if (
    typeof configuredTarget !== "string" ||
    configuredTarget.trim().length === 0 ||
    configuredTarget !== configuredTarget.trim() ||
    (!configuredTarget.startsWith("./") &&
      !configuredTarget.startsWith("../"))
  ) {
    fail(
      `${label}: manifest execution.pipeline must be an explicit local relative path`,
      JSON.stringify({ configuredTarget: configuredTarget ?? null }, null, 2),
    );
  }
  const expectedTarget = path.resolve(packageRoot, configuredTarget);
  if (
    expectedTarget === packageRoot ||
    !pathIsWithin(expectedTarget, packageRoot)
  ) {
    fail(
      `${label}: manifest execution.pipeline escapes the package root`,
      JSON.stringify({ packageRoot, configuredTarget, expectedTarget }, null, 2),
    );
  }
  let targetStat;
  try {
    targetStat = fs.statSync(expectedTarget);
  } catch (error) {
    fail(
      `${label}: manifest execution.pipeline does not exist`,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!targetStat.isFile() && !targetStat.isDirectory()) {
    fail(
      `${label}: manifest execution.pipeline is not a file or directory`,
      expectedTarget,
    );
  }

  return {
    pipelinesRoot: canonicalPathForComparison(pipelinesRoot),
    packageRoot: canonicalPathForComparison(packageRoot),
    manifestPath: canonicalPathForComparison(manifestPath),
    configuredTarget,
    expectedTarget: canonicalPathForComparison(expectedTarget),
  };
}
