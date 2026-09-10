import { normalizeReadDataClass } from "@/lib/sequencing/constants";

type PipelineInputRead = {
  id?: string;
  file1?: string | null;
  file2?: string | null;
  isActive?: boolean | null;
  dataClass?: string | null;
};

const READ_DATA_CLASS_RANK = {
  cleaned: 0,
  raw: 1,
  unknown: 2,
} as const;

/** Select the same active read record used by declarative pipeline samplesheets. */
export function selectPipelineInputRead<T extends PipelineInputRead>(
  reads: T[],
  filters?: Record<string, unknown>
): T | null {
  const paired = typeof filters?.paired === "boolean" ? filters.paired : undefined;
  const requestedDataClasses = [
    ...(typeof filters?.dataClass === "string" ? [filters.dataClass] : []),
    ...(Array.isArray(filters?.dataClassIn)
      ? filters.dataClassIn.filter((value): value is string => typeof value === "string")
      : []),
  ].map((value) => normalizeReadDataClass(value));
  const activeReads = reads.filter((read) => read.isActive !== false);
  const candidates = requestedDataClasses.length > 0
    ? activeReads.filter((read) => requestedDataClasses.includes(normalizeReadDataClass(read.dataClass)))
    : activeReads;
  const sortedReads = [...candidates].sort((a, b) => {
    const classDifference =
      READ_DATA_CLASS_RANK[normalizeReadDataClass(a.dataClass)] -
      READ_DATA_CLASS_RANK[normalizeReadDataClass(b.dataClass)];
    if (classDifference !== 0) return classDifference;
    if (a.id !== undefined && b.id !== undefined) {
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
    }
    return 0;
  });

  if (paired === true) {
    return sortedReads.find((read) => read.file1 && read.file2) || null;
  }

  if (paired === false) {
    return sortedReads.find((read) => read.file1 && !read.file2) || null;
  }

  return sortedReads.find((read) => read.file1 && read.file2)
    || sortedReads.find((read) => read.file1)
    || null;
}
