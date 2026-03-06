export const DEMO_READY_MESSAGE = "seqdesk-demo-ready";
export const DEMO_LOADING_MESSAGE = "seqdesk-demo-loading";

export type DemoFrameMessageType =
  | typeof DEMO_READY_MESSAGE
  | typeof DEMO_LOADING_MESSAGE;

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
