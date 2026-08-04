import { describe, expect, it } from "vitest";
import { isRetryableDemoDatabaseError } from "./bootstrap-errors";

describe("isRetryableDemoDatabaseError", () => {
  it.each(["P1001", "P1002", "P1008", "P1017", "P2024"])(
    "recognizes Prisma error code %s",
    (errorCode) => {
      expect(isRetryableDemoDatabaseError({ errorCode })).toBe(true);
    }
  );

  it.each(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"])(
    "recognizes transport error code %s",
    (code) => {
      expect(isRetryableDemoDatabaseError({ code })).toBe(true);
    }
  );

  it("recognizes the reachability message returned by Prisma", () => {
    expect(
      isRetryableDemoDatabaseError(
        new Error(
          "Invalid prisma.demoWorkspace.findUnique() invocation: Can't reach database server at db.example.test:5432"
        )
      )
    ).toBe(true);
  });

  it("does not classify application or schema failures as database wake-ups", () => {
    expect(isRetryableDemoDatabaseError(new Error("Failed to create demo session"))).toBe(
      false
    );
    expect(
      isRetryableDemoDatabaseError(new Error('relation "DemoWorkspace" does not exist'))
    ).toBe(false);
  });
});
