import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  bootstrapRuntimeEnv: vi.fn(),
  authorizeDemoWorkspaceToken: vi.fn(),
  normalizeDemoExperience: vi.fn(),
  db: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
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
    mocks.db.user.findMany.mockReset();
    mocks.db.user.findMany.mockResolvedValue([]);
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
      systemRole: "MEMBER",
      facilityWorkflowRole: "REQUESTER",
      isActive: true,
      isDemo: false,
    });
    mocks.compare.mockResolvedValue(true);

    const credentialsProvider = authOptions.providers[0] as unknown as {
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
      systemRole: "MEMBER",
      facilityWorkflowRole: "REQUESTER",
      isDemo: false,
      demoExperience: undefined,
    });
    expect(mocks.compare).toHaveBeenCalledWith("user", "hashed-password");
  });

  it("keeps legacy mixed-case email rows sign-in capable", async () => {
    mocks.db.user.findUnique.mockResolvedValue(null);
    mocks.db.user.findMany.mockResolvedValue([
      {
        id: "legacy-1",
        email: "Legacy.User@Example.COM",
        password: "hashed-password",
        firstName: "Legacy",
        lastName: "User",
        role: "RESEARCHER",
        systemRole: "MEMBER",
        facilityWorkflowRole: "REQUESTER",
        isActive: true,
        isDemo: false,
      },
    ]);
    mocks.compare.mockResolvedValue(true);

    const credentialsProvider = authOptions.providers[0] as unknown as {
      authorize: (credentials?: Record<string, string>) => Promise<unknown>;
    };
    const result = await credentialsProvider.authorize({
      email: "legacy.user@example.com",
      password: "valid-password",
    });

    expect(result).toMatchObject({ id: "legacy-1" });
    expect(mocks.db.user.findMany).toHaveBeenCalledWith({
      where: {
        email: {
          equals: "legacy.user@example.com",
          mode: "insensitive",
        },
      },
      take: 2,
    });
  });

  it("rejects an ambiguous case-insensitive login without merging legacy rows", async () => {
    mocks.db.user.findUnique.mockResolvedValue(null);
    mocks.db.user.findMany.mockResolvedValue([
      { id: "one", email: "User@example.com", password: "one" },
      { id: "two", email: "user@EXAMPLE.com", password: "two" },
    ]);

    const credentialsProvider = authOptions.providers[0] as unknown as {
      authorize: (credentials?: Record<string, string>) => Promise<unknown>;
    };

    await expect(
      credentialsProvider.authorize({
        email: "USER@example.COM",
        password: "any-password",
      }),
    ).rejects.toThrow("Invalid email or password");
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("rejects missing or invalid credentials", async () => {
    const credentialsProvider = authOptions.providers[0] as unknown as {
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

  it("rejects valid credentials for a deactivated account", async () => {
    mocks.db.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      password: "hashed-password",
      firstName: "Test",
      lastName: "Researcher",
      role: "RESEARCHER",
      systemRole: "MEMBER",
      isActive: false,
      isDemo: false,
    });

    const credentialsProvider = authOptions.providers[0] as unknown as {
      authorize: (credentials?: Record<string, string>) => Promise<unknown>;
    };

    await expect(
      credentialsProvider.authorize({
        email: "user@example.com",
        password: "correct-password",
      })
    ).rejects.toThrow("Invalid email or password");
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("authorizes demo workspace users through the demo token helper", async () => {
    mocks.authorizeDemoWorkspaceToken.mockResolvedValue({
      id: "demo-1",
      email: "demo@example.com",
      firstName: "Demo",
      lastName: "User",
      role: "RESEARCHER",
      facilityWorkflowRole: "REQUESTER",
      isDemo: true,
      demoExperience: "facility",
    });

    const demoProvider = authOptions.providers[1] as unknown as {
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
      systemRole: "MEMBER",
      facilityWorkflowRole: "REQUESTER",
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

    const demoProvider = authOptions.providers[1] as unknown as {
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
        token: {} as never,
        user: {
          id: "user-1",
          role: "FACILITY_ADMIN",
          systemRole: "ADMIN",
          facilityWorkflowRole: "REQUESTER",
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
      systemRole: "ADMIN",
      facilityWorkflowRole: "REQUESTER",
      isDemo: true,
      demoExperience: "facility",
      authorizationValid: true,
    });

    await expect(
      authOptions.callbacks?.session?.({
        session: { user: {} } as never,
        token: {
          id: "user-1",
          role: "FACILITY_ADMIN",
          systemRole: "ADMIN",
          facilityWorkflowRole: "REQUESTER",
          isDemo: true,
          demoExperience: "facility",
          authorizationValid: true,
        } as never,
      } as never)
    ).resolves.toEqual({
      user: {
        id: "user-1",
        role: "FACILITY_ADMIN",
        systemRole: "ADMIN",
        facilityWorkflowRole: "REQUESTER",
        isDemo: true,
        authorizationValid: true,
        demoExperience: "facility",
      },
    });

    await expect(
      authOptions.callbacks?.session?.({
        session: { user: {} } as never,
        token: {
          id: "user-2",
          role: "RESEARCHER",
          systemRole: "MEMBER",
          facilityWorkflowRole: "REQUESTER",
          isDemo: true,
          demoExperience: "researcher",
          authorizationValid: true,
        } as never,
      } as never)
    ).resolves.toEqual({
      user: {
        id: "user-2",
        role: "RESEARCHER",
        systemRole: "MEMBER",
        facilityWorkflowRole: "REQUESTER",
        isDemo: true,
        authorizationValid: true,
        demoExperience: "researcher",
      },
    });
  });

  it("refreshes authorization from the database for an existing JWT", async () => {
    mocks.db.user.findUnique.mockResolvedValue({
      role: "RESEARCHER",
      systemRole: "MEMBER",
      facilityWorkflowRole: "OPERATOR",
      isActive: true,
      isDemo: false,
    });

    await expect(
      authOptions.callbacks?.jwt?.({
        token: {
          id: "user-1",
          role: "FACILITY_ADMIN",
          systemRole: "ADMIN",
          isDemo: false,
          authorizationValid: true,
        } as never,
        user: undefined as never,
        account: null,
        profile: undefined,
        trigger: undefined,
        isNewUser: false,
        session: undefined,
      })
    ).resolves.toEqual({
      id: "user-1",
      role: "RESEARCHER",
      systemRole: "MEMBER",
      facilityWorkflowRole: "OPERATOR",
      isDemo: false,
      authorizationValid: true,
    });
    expect(mocks.db.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        role: true,
        systemRole: true,
        facilityWorkflowRole: true,
        isActive: true,
        isDemo: true,
      },
    });
  });

  it("invalidates an existing JWT immediately when its account is deactivated", async () => {
    mocks.db.user.findUnique.mockResolvedValue({
      role: "FACILITY_ADMIN",
      systemRole: "ADMIN",
      facilityWorkflowRole: "REQUESTER",
      isActive: false,
      isDemo: false,
    });

    await expect(
      authOptions.callbacks?.jwt?.({
        token: {
          id: "admin-1",
          role: "FACILITY_ADMIN",
          systemRole: "ADMIN",
          isDemo: false,
          authorizationValid: true,
        } as never,
        user: undefined as never,
        account: null,
        profile: undefined,
        trigger: undefined,
        isNewUser: false,
        session: undefined,
      })
    ).resolves.toMatchObject({
      id: "admin-1",
      role: "DISABLED",
      systemRole: "DISABLED",
      authorizationValid: false,
    });
  });

  it("invalidates the JWT when its user no longer exists", async () => {
    mocks.db.user.findUnique.mockResolvedValue(null);

    await expect(
      authOptions.callbacks?.jwt?.({
        token: {
          id: "deleted-user",
          role: "FACILITY_ADMIN",
          systemRole: "ADMIN",
          isDemo: false,
        } as never,
        user: undefined as never,
        account: null,
        profile: undefined,
        trigger: undefined,
        isNewUser: false,
        session: undefined,
      })
    ).resolves.toMatchObject({
      id: "deleted-user",
      role: "DISABLED",
      systemRole: "DISABLED",
      authorizationValid: false,
    });
  });
});
