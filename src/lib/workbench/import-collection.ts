import { z } from "zod";

// Shared destination contract, not repository metadata. The key identifies a
// draft across module selections/reloads; publication scopes it to the owner.
export const importCollectionSchema = z.object({
  key: z.string().uuid(),
  name: z.string().trim().min(1).max(500),
}).strict();
export type ImportCollection = z.infer<typeof importCollectionSchema>;
