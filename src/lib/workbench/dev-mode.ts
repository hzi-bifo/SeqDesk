import { isWorkbenchAppSurface } from "@/lib/app-surface";

export function isWorkbenchOnlyDevMode(): boolean {
  return isWorkbenchAppSurface();
}
