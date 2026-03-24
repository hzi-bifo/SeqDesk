import { afterEach, describe, expect, it, vi } from "vitest";

const originalServerFlag = process.env.SEQDESK_ENABLE_PUBLIC_DEMO;
const originalClientFlag = process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO;

async function loadConfigModule() {
  vi.resetModules();
  return import("./config");
}

afterEach(() => {
  if (originalServerFlag === undefined) {
    delete process.env.SEQDESK_ENABLE_PUBLIC_DEMO;
  } else {
    process.env.SEQDESK_ENABLE_PUBLIC_DEMO = originalServerFlag;
  }

  if (originalClientFlag === undefined) {
    delete process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO;
  } else {
    process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO = originalClientFlag;
  }
});

describe("demo config", () => {
  it("disables the public demo when no env flags are enabled", async () => {
    delete process.env.SEQDESK_ENABLE_PUBLIC_DEMO;
    delete process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO;

    const config = await loadConfigModule();

    expect(config.PUBLIC_DEMO_FLAG).toBe(false);
    expect(config.isPublicDemoEnabled()).toBe(false);
  });

  it("enables the public demo from the server-side env flag", async () => {
    process.env.SEQDESK_ENABLE_PUBLIC_DEMO = "true";
    delete process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO;

    const config = await loadConfigModule();

    expect(config.PUBLIC_DEMO_FLAG).toBe(true);
    expect(config.isPublicDemoEnabled()).toBe(true);
  });

  it("enables the public demo from the client env flag", async () => {
    delete process.env.SEQDESK_ENABLE_PUBLIC_DEMO;
    process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO = "true";

    const config = await loadConfigModule();

    expect(config.PUBLIC_DEMO_FLAG).toBe(true);
    expect(config.isPublicDemoEnabled()).toBe(true);
  });
});
