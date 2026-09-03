import { describe, expect, it } from "vitest";

import { isActiveSession } from "./auth-session";

function session(authorizationValid?: boolean) {
  return {
    user: {
      id: "user-1",
      authorizationValid,
    },
  } as never;
}

describe("isActiveSession", () => {
  it("accepts current and legacy active sessions", () => {
    expect(isActiveSession(session(true))).toBe(true);
    expect(isActiveSession(session())).toBe(true);
  });

  it("rejects invalidated and incomplete sessions", () => {
    expect(isActiveSession(session(false))).toBe(false);
    expect(isActiveSession(null)).toBe(false);
    expect(isActiveSession({ user: {} } as never)).toBe(false);
  });
});
