import type { DemoExperience } from "./types";

export const DEMO_READY_MESSAGE = "seqdesk-demo-ready";
export const DEMO_LOADING_MESSAGE = "seqdesk-demo-loading";
export const DEMO_RESET_MESSAGE = "seqdesk-demo-reset";
export const DEMO_ERROR_MESSAGE = "seqdesk-demo-error";

export type DemoFrameMessageType =
  | typeof DEMO_READY_MESSAGE
  | typeof DEMO_LOADING_MESSAGE
  | typeof DEMO_RESET_MESSAGE
  | typeof DEMO_ERROR_MESSAGE;

export function isPublicDemoEnabledClient(): boolean {
  return process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO === "true";
}

export function isEmbeddedFrame(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function postDemoFrameMessage(
  type: DemoFrameMessageType,
  extra: Record<string, unknown> = {}
): void {
  if (typeof window === "undefined" || !isEmbeddedFrame()) {
    return;
  }

  try {
    window.parent.postMessage({ type, ...extra }, "*");
  } catch {
    // Cross-origin parent access should not break the embedded app.
  }
}

export function getDemoEntryPath(
  demoExperience: DemoExperience,
  embedded: boolean
): string {
  if (demoExperience === "facility") {
    return embedded ? "/demo/admin/embed" : "/demo/admin";
  }
  return embedded ? "/demo/embed" : "/demo";
}
