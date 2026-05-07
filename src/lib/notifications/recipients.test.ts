import { describe, expect, it } from "vitest";

import {
  canNotifyRecipient,
  getRecipientName,
  isRealNotificationEmail,
} from "./recipients";

describe("getRecipientName", () => {
  it("returns first + last name when both are present", () => {
    expect(
      getRecipientName({ firstName: "Ada", lastName: "Lovelace" }),
    ).toBe("Ada Lovelace");
  });

  it("returns just the first name when last name is missing", () => {
    expect(getRecipientName({ firstName: "Ada", lastName: null })).toBe("Ada");
  });

  it("returns just the last name when first name is missing", () => {
    expect(getRecipientName({ firstName: null, lastName: "Lovelace" })).toBe(
      "Lovelace",
    );
  });

  it("trims whitespace-only parts before composing the full name", () => {
    expect(getRecipientName({ firstName: "  ", lastName: "Lovelace" })).toBe(
      "Lovelace",
    );
  });

  it("falls back to the `name` field when first/last are blank", () => {
    expect(getRecipientName({ firstName: null, lastName: null, name: "Ada" })).toBe(
      "Ada",
    );
  });

  it("trims a whitespace-padded name", () => {
    expect(getRecipientName({ name: "  Ada  " })).toBe("Ada");
  });

  it("falls back to the local-part of the email when no name is available", () => {
    expect(getRecipientName({ email: "ada@example.org" })).toBe("ada");
  });

  it("returns undefined when nothing is available", () => {
    expect(getRecipientName({})).toBeUndefined();
  });

  it("returns undefined when only a whitespace name is provided and no email", () => {
    expect(getRecipientName({ name: "   " })).toBeUndefined();
  });
});

describe("isRealNotificationEmail (additional cases)", () => {
  it("rejects an empty or whitespace-only email", () => {
    expect(isRealNotificationEmail("")).toBe(false);
    expect(isRealNotificationEmail("   ")).toBe(false);
    expect(isRealNotificationEmail(null)).toBe(false);
    expect(isRealNotificationEmail(undefined)).toBe(false);
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(isRealNotificationEmail("  Researcher@Example.ORG  ")).toBe(true);
  });

  it("rejects placeholder seqdesk.local addresses", () => {
    expect(isRealNotificationEmail("a@seqdesk.local")).toBe(false);
  });
});

describe("canNotifyRecipient (additional cases)", () => {
  const prefs = { orders: true, support: true };

  it("rejects demo recipients", () => {
    expect(
      canNotifyRecipient(
        { email: "ada@example.org", role: "user", isDemo: true },
        "order.submitted",
        prefs,
      ),
    ).toBe(false);
  });

  it("rejects placeholder emails", () => {
    expect(
      canNotifyRecipient(
        { email: "admin@example.com", role: "admin" },
        "order.submitted",
        prefs,
      ),
    ).toBe(false);
  });

  it("respects per-recipient preferences when provided", () => {
    expect(
      canNotifyRecipient(
        {
          email: "ada@example.org",
          role: "user",
          preferences: JSON.stringify({ orders: false, support: true }),
        },
        "order.submitted",
        prefs,
      ),
    ).toBe(false);

    expect(
      canNotifyRecipient(
        {
          email: "ada@example.org",
          role: "user",
          preferences: JSON.stringify({ orders: false, support: true }),
        },
        "ticket.reply",
        prefs,
      ),
    ).toBe(true);
  });

  it("falls back to admin defaults when recipient has no preferences", () => {
    expect(
      canNotifyRecipient(
        { email: "ada@example.org", role: "user" },
        "order.submitted",
        { orders: false, support: true },
      ),
    ).toBe(false);
  });
});
