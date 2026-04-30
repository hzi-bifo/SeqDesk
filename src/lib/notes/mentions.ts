export const NOTE_MENTION_SCHEME = "seqdesk-mention://";

export const NOTE_MENTION_GROUPS = [
  { key: "samples", label: "Samples" },
  { key: "studies-orders", label: "Orders/Studies" },
  { key: "files", label: "Files" },
  { key: "assemblies", label: "Assemblies" },
  { key: "bins", label: "Bins" },
  { key: "pipeline-runs", label: "Pipeline runs" },
  { key: "artifacts", label: "Artifacts" },
] as const;

export type NoteMentionGroupKey = (typeof NOTE_MENTION_GROUPS)[number]["key"];

export type NoteMentionType =
  | "sample"
  | "order"
  | "study"
  | "file"
  | "assembly"
  | "bin"
  | "pipeline-run"
  | "sequencing-artifact"
  | "pipeline-artifact";

export interface NoteMentionItem {
  type: NoteMentionType;
  id: string;
  label: string;
  detail: string | null;
  group: NoteMentionGroupKey;
  href: string | null;
  status?: "available" | "missing" | "deleted";
}

export interface NoteMentionGroup {
  key: NoteMentionGroupKey;
  label: string;
  items: NoteMentionItem[];
}

export interface ParsedNoteMention {
  type: NoteMentionType;
  id: string;
  href: string;
}

const VALID_NOTE_MENTION_TYPES = new Set<NoteMentionType>([
  "sample",
  "order",
  "study",
  "file",
  "assembly",
  "bin",
  "pipeline-run",
  "sequencing-artifact",
  "pipeline-artifact",
]);

export function makeNoteMentionHref(type: NoteMentionType, id: string): string {
  const encodedId = encodeURIComponent(id).replace(/[()]/g, (value) =>
    `%${value.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${NOTE_MENTION_SCHEME}${type}/${encodedId}`;
}

export function parseNoteMentionHref(href: string): ParsedNoteMention | null {
  if (!href.startsWith(NOTE_MENTION_SCHEME)) {
    return null;
  }

  const rest = href.slice(NOTE_MENTION_SCHEME.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) {
    return null;
  }

  const type = rest.slice(0, slashIndex) as NoteMentionType;
  if (!VALID_NOTE_MENTION_TYPES.has(type)) {
    return null;
  }

  const encodedId = rest.slice(slashIndex + 1);
  if (!encodedId) {
    return null;
  }

  try {
    return {
      type,
      id: decodeURIComponent(encodedId),
      href,
    };
  } catch {
    return null;
  }
}

export function extractNoteMentionHrefs(markdown: string): string[] {
  const hrefs = new Set<string>();
  const mentionLinkPattern = /\[[^\]]*]\((seqdesk-mention:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = mentionLinkPattern.exec(markdown)) !== null) {
    hrefs.add(match[1]);
  }

  return Array.from(hrefs);
}

export function buildUnavailableMentionLabel(type: NoteMentionType): string {
  switch (type) {
    case "sample":
      return "Deleted sample";
    case "order":
      return "Unavailable order";
    case "study":
      return "Unavailable study";
    case "file":
      return "Missing file";
    case "assembly":
      return "Deleted assembly";
    case "bin":
      return "Deleted bin";
    case "pipeline-run":
      return "Deleted pipeline run";
    case "sequencing-artifact":
    case "pipeline-artifact":
      return "Unavailable artifact";
  }
}
