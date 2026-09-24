import { createHash } from "node:crypto";
import type { ExploreEditRecord } from "./edits";
/** Includes overlays as well as the immutable base version. */
export function inputToken(versionId: string, edits: ExploreEditRecord[]): string {
  return createHash("sha256").update(JSON.stringify([versionId, edits])).digest("hex");
}
