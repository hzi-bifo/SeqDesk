import type {
  OrderDataFilesLinkRequest,
  OrderDataFilesProcessing,
  OrderDataFilesSample,
} from "./data-files-types";

export interface MatchingFile {
  path: string;
  name: string;
  size: number | null;
  /** Present only for uploads selected in the browser. */
  upload?: File;
}

export interface ReadSetDraft {
  id: string;
  files: MatchingFile[];
  sampleId: string;
  newSampleIdentifier: string;
  newSampleTitle: string;
  layout: "paired" | "single";
  read1: string;
  read2: string;
  included: boolean;
  saved: boolean;
  ambiguous: boolean;
}

export function isReadFile(name: string): boolean {
  return /\.(fastq|fq)(\.gz)?$/i.test(name);
}

export function readFileIdentity(name: string) {
  const stem = name.replace(/\.(fastq|fq)(\.gz)?$/i, "");
  const match = /^(.*?)[._-](?:R)?([12])(?:[._-]\d{3})?$/i.exec(stem);
  return { stem: match?.[1] ?? stem, role: match ? (`R${match[2]}` as "R1" | "R2") : null };
}

function sampleIdentifier(value: string) {
  return value.replace(/_S\d+(?=_L\d+$|$)/i, "").replace(/_L\d+$/i, "");
}

function sampleKey(value: string) {
  return sampleIdentifier(value).toLowerCase();
}

export function createReadSetDrafts(
  files: MatchingFile[],
  samples: OrderDataFilesSample[],
  preselectedSampleId?: string,
): ReadSetDraft[] {
  const groups = new Map<string, MatchingFile[]>();
  for (const file of files) {
    const identity = readFileIdentity(file.name);
    const directory = file.path.slice(0, Math.max(0, file.path.lastIndexOf("/") + 1));
    const key = identity.role ? `${directory}${identity.stem}` : file.path;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  return [...groups.entries()].map(([id, group]) => {
    const roles = group.map(file => ({ file, ...readFileIdentity(file.name) }));
    const first = roles.filter(file => file.role === "R1");
    const second = roles.filter(file => file.role === "R2");
    const paired = roles.some(file => file.role !== null);
    const matches = samples.filter(sample => sampleKey(sample.sampleId) === sampleKey(roles[0].stem));
    return {
      id,
      files: group,
      sampleId: preselectedSampleId ?? (matches.length === 1 ? matches[0].id : ""),
      newSampleIdentifier: sampleIdentifier(roles[0].stem),
      newSampleTitle: "",
      layout: paired ? "paired" : "single",
      read1: paired ? (first.length === 1 ? first[0].file.path : "") : group[0].path,
      read2: second.length === 1 ? second[0].file.path : "",
      included: true,
      saved: false,
      ambiguous: first.length > 1 || second.length > 1,
    };
  });
}

export function validateReadSetDraft(draft: ReadSetDraft): string[] {
  const errors: string[] = [];
  if (!draft.sampleId) errors.push("Choose a destination sample.");
  if (draft.sampleId === "new" && !draft.newSampleIdentifier.trim()) errors.push("Enter a new sample identifier.");
  if (draft.sampleId === "new" && draft.newSampleIdentifier.trim().length > 200) errors.push("Sample identifiers must be at most 200 characters.");
  if (!draft.read1) errors.push(draft.layout === "paired" ? "Choose the R1 file." : "Choose a read file.");
  if (draft.layout === "paired" && !draft.read2) errors.push("The R2 file is missing. Select its mate or explicitly choose single-end.");
  if (draft.layout === "paired" && draft.read1 && draft.read1 === draft.read2) errors.push("R1 and R2 must be different files.");
  if (draft.ambiguous) errors.push("Multiple files have the same read role. Go back and select one pair at a time.");
  const chosen = draft.layout === "paired" ? [draft.read1, draft.read2] : [draft.read1];
  if (draft.files.some(file => !chosen.includes(file.path))) errors.push("Some selected files are unmatched. Go back and adjust the selection.");
  if (draft.layout === "paired") {
    const first = draft.files.find(file => file.path === draft.read1);
    const second = draft.files.find(file => file.path === draft.read2);
    if (first && readFileIdentity(first.name).role === "R2") errors.push("The R1 selection is named as an R2 file.");
    if (second && readFileIdentity(second.name).role === "R1") errors.push("The R2 selection is named as an R1 file.");
    if (first && second) {
      const one = readFileIdentity(first.name);
      const two = readFileIdentity(second.name);
      if (one.role && two.role && one.stem !== two.stem) errors.push("R1 and R2 filenames identify different read sets.");
    }
  }
  return errors;
}

export function readSetLinkRequest(
  draft: ReadSetDraft,
  processing: OrderDataFilesProcessing,
  processingNote: string,
): OrderDataFilesLinkRequest {
  return {
    ...(draft.sampleId === "new"
      ? { newSample: { sampleId: draft.newSampleIdentifier.trim(), ...(draft.newSampleTitle.trim() ? { sampleTitle: draft.newSampleTitle.trim() } : {}) } }
      : { sampleId: draft.sampleId }),
    read1: draft.read1,
    ...(draft.layout === "paired" ? { read2: draft.read2 } : {}),
    processing,
    ...(processingNote.trim() ? { processingNote: processingNote.trim() } : {}),
  };
}
