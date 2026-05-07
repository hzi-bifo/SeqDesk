import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendViaSeqDeskRelay } from "./relay";
import type { NotificationDispatchInput } from "./types";

const baseInput = (
  overrides: Partial<NotificationDispatchInput> = {},
): NotificationDispatchInput => ({
  event: "order.submitted",
  recipient: {
    email: "researcher@example.org",
    name: "Researcher",
    role: "user",
  },
  context: {
    orderNumber: "ORD-1",
    orderName: "Test order",
    linkPath: "/orders/abc",
  },
  ...overrides,
});

const installation = {
  siteName: "SeqDesk",
  baseUrl: "https://lab.example.org",
  profileId: "ci-runner",
};

describe("sendViaSeqDeskRelay", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("posts to the relay URL with the bearer token and recipient details", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, id: "msg-1" }),
    });

    const result = await sendViaSeqDeskRelay({
      ...baseInput(),
      relayUrl: "https://relay.example/api",
      relayToken: "secret-token",
      installation,
    });

    expect(result).toEqual({ ok: true, id: "msg-1" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://relay.example/api");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("order.submitted");
    expect(body.recipient).toEqual({
      email: "researcher@example.org",
      name: "Researcher",
      role: "user",
    });
    expect(body.installation).toEqual(installation);
    expect(body.context.orderNumber).toBe("ORD-1");
    expect(body.context.orderName).toBe("Test order");
    expect(body.context.linkUrl).toBe("https://lab.example.org/orders/abc");
  });

  it("strips empty/whitespace-only context fields", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await sendViaSeqDeskRelay({
      ...baseInput({
        context: {
          orderNumber: "ORD-2",
          orderName: "  ", // whitespace-only — should be dropped
          ticketSubject: "",
          statusFrom: null,
          statusTo: undefined,
          snippet: "",
          actorName: "Alice",
          linkPath: null,
        },
      }),
      relayUrl: "https://relay.example/api",
      relayToken: "x",
      installation,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.context).toEqual({
      orderNumber: "ORD-2",
      actorName: "Alice",
    });
    expect(body.context).not.toHaveProperty("orderName");
    expect(body.context).not.toHaveProperty("linkUrl");
  });

  it("truncates long snippets to 240 characters with ellipsis", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const long = "a".repeat(500);
    await sendViaSeqDeskRelay({
      ...baseInput({
        context: { snippet: long },
      }),
      relayUrl: "https://relay.example/api",
      relayToken: "x",
      installation,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.context.snippet.length).toBe(240);
    expect(body.context.snippet.endsWith("...")).toBe(true);
  });

  it("preserves a snippet shorter than the limit untrimmed", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await sendViaSeqDeskRelay({
      ...baseInput({
        context: { snippet: "  short message  " },
      }),
      relayUrl: "https://relay.example/api",
      relayToken: "x",
      installation,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.context.snippet).toBe("short message");
  });

  it("omits linkUrl when baseUrl is not provided", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await sendViaSeqDeskRelay({
      ...baseInput({
        context: { linkPath: "/orders/abc" },
      }),
      relayUrl: "https://relay.example/api",
      relayToken: "x",
      installation: { profileId: "x" },
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.context).not.toHaveProperty("linkUrl");
  });

  it("omits linkUrl when linkPath is invalid for URL construction", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await sendViaSeqDeskRelay({
      ...baseInput({
        context: { linkPath: "://no-scheme" },
      }),
      relayUrl: "https://relay.example/api",
      relayToken: "x",
      installation: { baseUrl: "not a real url" },
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.context).not.toHaveProperty("linkUrl");
  });

  it("includes replyTo when provided", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await sendViaSeqDeskRelay({
      ...baseInput({ replyTo: "support@example.org" }),
      relayUrl: "https://relay.example/api",
      relayToken: "x",
      installation,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.replyTo).toBe("support@example.org");
  });

  it("omits replyTo when not provided", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await sendViaSeqDeskRelay({
      ...baseInput(),
      relayUrl: "https://relay.example/api",
      relayToken: "x",
      installation,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty("replyTo");
  });

  it("strips a recipient name when blank", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await sendViaSeqDeskRelay({
      ...baseInput({
        recipient: { email: "r@example.org", name: "", role: "user" },
      }),
      relayUrl: "https://relay.example/api",
      relayToken: "x",
      installation,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.recipient.name).toBeUndefined();
  });

  it("throws with the response status and text when the relay rejects", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });

    await expect(
      sendViaSeqDeskRelay({
        ...baseInput(),
        relayUrl: "https://relay.example/api",
        relayToken: "x",
        installation,
      }),
    ).rejects.toThrow(/500.*internal error/);
  });

  it("throws with empty text body when text() also fails", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => {
        throw new Error("read failed");
      },
    });

    await expect(
      sendViaSeqDeskRelay({
        ...baseInput(),
        relayUrl: "https://relay.example/api",
        relayToken: "x",
        installation,
      }),
    ).rejects.toThrow(/502/);
  });

  it("returns { ok: true } when JSON parsing of a 2xx response fails", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    });

    const result = await sendViaSeqDeskRelay({
      ...baseInput(),
      relayUrl: "https://relay.example/api",
      relayToken: "x",
      installation,
    });

    expect(result).toEqual({ ok: true });
  });
});
