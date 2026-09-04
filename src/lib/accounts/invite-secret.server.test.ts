import { describe, expect, it } from "vitest";

import {
  digestInviteCode,
  inviteCodeLookup,
  normalizeInviteCode,
} from "./invite-secret.server";

describe("invitation secret storage", () => {
  it("normalizes codes before hashing so typed casing does not matter", () => {
    expect(normalizeInviteCode("  m-AbC123  ")).toBe("M-ABC123");
    expect(digestInviteCode("m-abc123")).toBe(digestInviteCode("M-ABC123"));
  });

  it("uses a versioned SHA-256 digest without retaining the raw code", () => {
    const raw = "A-0123456789ABCDEF";
    const digest = digestInviteCode(raw);

    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(digest).not.toContain(raw);
  });

  it("looks up digested invitations first and legacy plaintext second", () => {
    const lookup = inviteCodeLookup(" m-member01 ");

    expect(lookup.normalizedCode).toBe("M-MEMBER01");
    expect(lookup.where).toEqual({
      OR: [
        { codeDigest: lookup.codeDigest },
        { code: "M-MEMBER01" },
      ],
    });
  });
});
