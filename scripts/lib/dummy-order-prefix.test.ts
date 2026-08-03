import { describe, expect, it } from "vitest";

import { buildDummyOrderOwnerPrefix } from "./dummy-order-prefix.mjs";

describe("buildDummyOrderOwnerPrefix", () => {
  it("keeps the owner prefix readable while including the complete user id", () => {
    expect(buildDummyOrderOwnerPrefix("admin-user-123")).toBe(
      "ADMI1SB3MGH0FT3OFF"
    );
  });

  it("avoids collisions for ids that share the same readable prefix", () => {
    expect(buildDummyOrderOwnerPrefix("administrator-one")).not.toBe(
      buildDummyOrderOwnerPrefix("administrator-two")
    );
  });

  it("uses a stable fallback for an empty owner id", () => {
    expect(buildDummyOrderOwnerPrefix("")).toBe("USER");
  });
});
