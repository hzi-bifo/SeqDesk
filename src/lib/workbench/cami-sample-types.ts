import { z } from "zod";

export const camiSampleQuerySchema = z.object({
  collection: z.string().uuid(),
  dataset: z.enum(["cami2-marine", "cami3-toy-human-gut"]),
  technology: z.enum(["short", "long"]),
}).strict();
export type CamiSampleQuery = z.infer<typeof camiSampleQuerySchema>;
export interface CamiSampleStatus {
  sample: number;
  status: "available" | "imported" | "queued" | "running" | "error" | "cancelled";
  jobId?: string;
  progress?: number | null;
  phase?: string | null;
  error?: string | null;
  orderId?: string;
}

export function canSelectCamiSample(sample: CamiSampleStatus | undefined) {
  return sample?.status === "available" || sample?.status === "error" || sample?.status === "cancelled";
}
