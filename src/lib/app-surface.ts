export type SeqDeskAppSurface = "lab" | "workbench";

function normalizeSurface(value: string | undefined): SeqDeskAppSurface | null {
  if (value === "lab" || value === "workbench") {
    return value;
  }

  return null;
}

export function getSeqDeskAppSurface(): SeqDeskAppSurface {
  return (
    normalizeSurface(process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE) ??
    normalizeSurface(process.env.SEQDESK_APP_SURFACE) ??
    (process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY === "1" ? "workbench" : "lab")
  );
}

export function isWorkbenchAppSurface(): boolean {
  return getSeqDeskAppSurface() === "workbench";
}

export function isLabAppSurface(): boolean {
  return getSeqDeskAppSurface() === "lab";
}
