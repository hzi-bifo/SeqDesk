import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  bootstrapRuntimeEnv: vi.fn(),
  authorizeDemoWorkspaceToken: vi.fn(),
  normalizeDemoExperience: vi.fn(),
  db: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: (config: unknown) => config,
}));

vi.mock("bcryptjs", () => ({
  compare: mocks.compare,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/config/runtime-env", () => ({
  bootstrapRuntimeEnv: mocks.bootstrapRuntimeEnv,
}));

vi.mock("@/lib/demo/server", () => ({
  authorizeDemoWorkspaceToken: mocks.authorizeDemoWorkspaceToken,
}));

vi.mock("@/lib/demo/types", () => ({
  normalizeDemoExperience: mocks.normalizeDemoExperience,
}));

import { authOptions } from "./auth";

describe("authOptions", () => {
  beforeEach(() => {
    mocks.compare.mockReset();
    mocks.authorizeDemoWorkspaceToken.mockReset();
    mocks.normalizeDemoExperience.mockReset();
    mocks.db.user.findUnique.mockReset();
    mocks.normalizeDemoExperience.mockImplementation((value) => value);
  });

  it("bootstraps runtime env on module load", () => {
    expect(mocks.bootstrapRuntimeEnv).toHaveBeenCalledTimes(1);
  });

  it("authorizes a valid credentials user", async () => {
    mocks.db.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      password: "hashed-password",
      firstName: "Test",
      lastName: "Researcher",
      role: "RESEARCHER",
      isDemo: false,
    });
    mocks.compare.mockResolvedValue(true);

    const credentialsProvider = authOptions.providers[0] as {
      authorize: (credentials?: Record<string, string>) => Promise<unknown>;
    };

    await expect(
      credentialsProvider.authorize({
        email: "user@example.com",
        password: "user",
      })
    ).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
      name: "Test Researcher",
      role: "RESEARCHER",
      isDemo: false,
      demoExperience: undefined,
    });
    expect(mocks.compare).toHaveBeenCalledWith("user", "hashed-password");
  });

  it("rejects missing or invalid credentials", async () => {
    const credentialsProvider = authOptions.providers[0] as {
      authorize: (credentials?: Record<string, string>) => Promise<unknown>;
    };

    await expect(credentialsProvider.authorize()).rejects.toThrow(
      "Email and password are required"
    );

    mocks.db.user.findUnique.mockResolvedValue(null);
    await expect(
      credentialsProvider.authorize({
        email: "user@example.com",
        password: "wrong",
      })
    ).rejects.toThrow("Invalid email or password");

    mocks.db.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      password: "hashed-password",
    });
    mocks.compare.mockResolvedValue(false);
    await expect(
      credentialsProvider.authorize({
        email: "user@example.com",
        password: "wrong",
      })
    ).rejects.toThrow("Invalid email or password");
  });

  it("authorizes demo workspace users through the demo token helper", async () => {
    mocks.authorizeDemoWorkspaceToken.mockResolvedValue({
      id: "demo-1",
      email: "demo@example.com",
      firstName: "Demo",
      lastName: "User",
      role: "RESEARCHER",
      isDemo: true,
      demoExperience: "facility",
    });

    const demoProvider = authOptions.providers[1] as {
      authorize: (credentials?: Record<string, string>) => Promise<unknown>;
    };

    await expect(
      demoProvider.authorize({
        token: "demo-token",
        demoExperience: "facility",
      })
    ).resolves.toEqual({
      id: "demo-1",
      email: "demo@example.com",
      name: "Demo User",
      role: "RESEARCHER",
      isDemo: true,
      demoExperience: "facility",
    });
    expect(mocks.normalizeDemoExperience).toHaveBeenCalledWith("facility");
    expect(mocks.authorizeDemoWorkspaceToken).toHaveBeenCalledWith(
      "demo-token",
      "facility"
    );
  });

  it("returns null when demo authorization fails", async () => {
    mocks.authorizeDemoWorkspaceToken.mockResolvedValue(null);

    const demoProvider = authOptions.providers[1] as {
      authorize: (credentials?: Record<string, string>) => Promise<unknown>;
    };

    await expect(
      demoProvider.authorize({
        token: "invalid",
      })
    ).resolves.toBeNull();
  });

  it("stores auth metadata in jwt and session callbacks", async () => {
    await expect(
      authOptions.callbacks?.jwt?.({
        token: {},
        user: {
          id: "user-1",
          role: "FACILITY_ADMIN",
          isDemo: true,
          demoExperience: "facility",
        } as never,
        account: null,
        profile: undefined,
        trigger: "signIn",
        isNewUser: false,
        session: undefined,
      })
    ).resolves.toEqual({
      id: "user-1",
      role: "FACILITY_ADMIN",
      isDemo: true,
      demoExperience: "facility",
    });

    await expect(
      authOptions.callbacks?.session?.({
        session: { user: {} } as never,
        token: {
          id: "user-1",
          role: "FACILITY_ADMIN",
          isDemo: true,
          demoExperience: "facility",
        } as never,
        user: undefined,
        newSession: undefined,
        trigger: undefined,
      })
    ).resolves.toEqual({
      user: {
        id: "user-1",
        role: "FACILITY_ADMIN",
        isDemo: true,
        demoExperience: "facility",
      },
    });

    await expect(
      authOptions.callbacks?.session?.({
        session: { user: {} } as never,
        token: {
          id: "user-2",
          role: "RESEARCHER",
          isDemo: true,
          demoExperience: "researcher",
        } as never,
        user: undefined,
        newSession: undefined,
        trigger: undefined,
      })
    ).resolves.toEqual({
      user: {
        id: "user-2",
        role: "RESEARCHER",
        isDemo: true,
        demoExperience: "researcher",
      },
    });
  });
});
