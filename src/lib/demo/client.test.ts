import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_ERROR_MESSAGE,
  DEMO_READY_MESSAGE,
  getDemoEntryPath,
  isEmbeddedFrame,
  isPublicDemoEnabledClient,
  postDemoFrameMessage,
} from "./client";

const globalWindow = globalThis as typeof globalThis & { window?: unknown };
const hadWindow = "window" in globalWindow;
const originalWindow = globalWindow.window;
const originalPublicDemoFlag = process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO;

function setWindow(value?: unknown): void {
  if (value === undefined) {
    delete globalWindow.window;
    return;
  }

  Object.defineProperty(globalWindow, "window", {
    configurable: true,
    value,
    writable: true,
  });
}

afterEach(() => {
  if (hadWindow) {
    setWindow(originalWindow);
  } else {
    delete globalWindow.window;
  }

  if (originalPublicDemoFlag === undefined) {
    delete process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO;
  } else {
    process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO = originalPublicDemoFlag;
  }
});

describe("demo client helpers", () => {
  it("reads the public demo flag from the client env", () => {
    process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO = "true";
    expect(isPublicDemoEnabledClient()).toBe(true);

    process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO = "false";
    expect(isPublicDemoEnabledClient()).toBe(false);
  });

  it("detects whether the app is running inside an embedded frame", () => {
    delete globalWindow.window;
    expect(isEmbeddedFrame()).toBe(false);

    const sameWindow = {};
    setWindow({ self: sameWindow, top: sameWindow });
    expect(isEmbeddedFrame()).toBe(false);

    setWindow({ self: {}, top: {} });
    expect(isEmbeddedFrame()).toBe(true);

    const blockedTopWindow = { self: {} };
    Object.defineProperty(blockedTopWindow, "top", {
      configurable: true,
      get() {
        throw new Error("cross-origin access denied");
      },
    });
    setWindow(blockedTopWindow);
    expect(isEmbeddedFrame()).toBe(true);
  });

  it("posts demo frame messages only when embedded", () => {
    const postMessage = vi.fn();
    setWindow({
      self: {},
      top: {},
      parent: {
        postMessage,
      },
    });

    postDemoFrameMessage(DEMO_READY_MESSAGE, { step: "boot" });

    expect(postMessage).toHaveBeenCalledWith(
      { type: DEMO_READY_MESSAGE, step: "boot" },
      "*"
    );

    const sameWindow = {};
    postMessage.mockClear();
    setWindow({
      self: sameWindow,
      top: sameWindow,
      parent: {
        postMessage,
      },
    });

    postDemoFrameMessage(DEMO_ERROR_MESSAGE, { reason: "ignored" });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("swallows postMessage errors from the parent frame", () => {
    setWindow({
      self: {},
      top: {},
      parent: {
        postMessage: vi.fn(() => {
          throw new Error("blocked");
        }),
      },
    });

    expect(() =>
      postDemoFrameMessage(DEMO_ERROR_MESSAGE, { reason: "cross-origin" })
    ).not.toThrow();
  });

  it("resolves the correct entry path for each demo mode", () => {
    expect(getDemoEntryPath("researcher", false)).toBe("/demo");
    expect(getDemoEntryPath("researcher", true)).toBe("/demo/embed");
    expect(getDemoEntryPath("facility", false)).toBe("/demo/admin");
    expect(getDemoEntryPath("facility", true)).toBe("/demo/admin/embed");
  });
});
