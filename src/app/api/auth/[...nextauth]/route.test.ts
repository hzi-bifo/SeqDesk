import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  NextAuth: vi.fn(),
  authOptions: { session: { strategy: "jwt" } },
}));

const handler = vi.fn();

vi.mock("next-auth", () => ({
  default: mocks.NextAuth,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: mocks.authOptions,
}));

describe("auth route handler", () => {
  it("reuses the same NextAuth handler for GET and POST", async () => {
    vi.resetModules();
    mocks.NextAuth.mockReset();
    mocks.NextAuth.mockReturnValue(handler);

    const routeModule = await import("./route");

    expect(mocks.NextAuth).toHaveBeenCalledWith(mocks.authOptions);
    expect(routeModule.GET).toBe(handler);
    expect(routeModule.POST).toBe(handler);
  });
});
