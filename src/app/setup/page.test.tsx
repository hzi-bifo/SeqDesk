// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SetupPage from "./page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

type SetupStatus = {
  exists: boolean;
  configured: boolean;
  error?: string;
  phase:
    | "ready"
    | "database-config"
    | "database-unreachable"
    | "schema-missing"
    | "seeding"
    | "seed-failed"
    | "unknown-error";
  steps: Array<{
    id: string;
    label: string;
    status: "complete" | "active" | "pending" | "error";
    description: string;
    command?: string;
  }>;
  nextAction: {
    label: string;
    description: string;
    href?: string;
    command?: string;
  } | null;
  database: {
    engine: "postgresql" | "sqlite" | "unknown";
    hosting: "neon" | "self-hosted-postgres" | "unknown";
    usesPooler: boolean;
    directUrlConfigured: boolean;
  };
  install: {
    mode: "managed" | "self-hosted";
    usesDefaultBootstrapCredentials: boolean;
    profile?: {
      id?: string;
      name?: string;
      version?: string;
      appliedAt?: string;
      source: "database" | "config";
    };
  };
};

function makeStatus(overrides: Partial<SetupStatus> = {}): SetupStatus {
  return {
    exists: true,
    configured: true,
    phase: "ready",
    steps: [
      {
        id: "database",
        label: "PostgreSQL database",
        status: "complete",
        description: "SeqDesk needs a reachable PostgreSQL database connection.",
      },
      {
        id: "schema",
        label: "Database schema",
        status: "complete",
        description: "Prisma migrations create the SeqDesk tables.",
      },
      {
        id: "seed",
        label: "Initial data",
        status: "complete",
        description: "Users, site settings, and default forms are available.",
      },
      {
        id: "login",
        label: "Admin login",
        status: "complete",
        description: "Setup is complete. Continue to the login screen.",
      },
    ],
    nextAction: {
      label: "Continue to login",
      description: "Setup is complete and SeqDesk is ready for admins.",
      href: "/login",
    },
    database: {
      engine: "postgresql",
      hosting: "self-hosted-postgres",
      usesPooler: false,
      directUrlConfigured: true,
    },
    install: {
      mode: "self-hosted",
      usesDefaultBootstrapCredentials: true,
    },
    ...overrides,
  };
}

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

describe("SetupPage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows ready state and default credentials for plain self-hosted installs", async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeStatus()));

    render(<SetupPage />);

    expect(await screen.findByText("SeqDesk is ready")).toBeTruthy();
    expect(screen.getByText("Self-hosted install")).toBeTruthy();
    expect(screen.getByText("Continue to login")).toBeTruthy();
    expect(screen.getByText("Default Login Credentials")).toBeTruthy();
    expect(screen.getByText("admin@example.com")).toBeTruthy();
  });

  it("shows managed profile context and hides default credentials", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeStatus({
          install: {
            mode: "managed",
            usesDefaultBootstrapCredentials: false,
            profile: {
              id: "twincore",
              name: "TWINCORE",
              version: "1.0.0",
              source: "database",
            },
          },
          steps: [
            ...makeStatus().steps,
            {
              id: "hosted-profile",
              label: "Hosted profile",
              status: "complete",
              description: "Managed configuration from SeqDesk admin has been applied.",
            },
          ],
        })
      )
    );

    render(<SetupPage />);

    expect(await screen.findByText("TWINCORE")).toBeTruthy();
    expect(screen.getByText("Profile 1.0.0")).toBeTruthy();
    expect(screen.getByText("Admin Access")).toBeTruthy();
    expect(screen.queryByText("admin@example.com")).toBeNull();
  });

  it("shows Neon pooler DIRECT_URL guidance", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeStatus({
          exists: false,
          configured: false,
          phase: "database-config",
          steps: [
            {
              id: "database",
              label: "Neon database",
              status: "complete",
              description: "SeqDesk can identify the configured Neon connection without exposing it.",
            },
            {
              id: "direct-url",
              label: "Migration connection",
              status: "error",
              description: "Pooled Neon URLs need a non-pooled DIRECT_URL before migrations can run.",
            },
          ],
          nextAction: {
            label: "Add DIRECT_URL",
            description:
              "Use the non-pooled Neon connection string as DIRECT_URL, then restart SeqDesk and rerun migrations.",
          },
          database: {
            engine: "postgresql",
            hosting: "neon",
            usesPooler: true,
            directUrlConfigured: false,
          },
        })
      )
    );

    render(<SetupPage />);

    expect(await screen.findByText("Database configuration needs attention")).toBeTruthy();
    expect(screen.getByText("Add DIRECT_URL")).toBeTruthy();
    expect(screen.getByText("Neon")).toBeTruthy();
    expect(screen.getByText("Missing")).toBeTruthy();
  });

  it("shows seeding progress", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeStatus({
          configured: false,
          phase: "seeding",
          steps: [
            {
              id: "seed",
              label: "Initial data",
              status: "active",
              description: "SeqDesk is creating the initial admin data and form configuration.",
            },
          ],
          nextAction: {
            label: "Seeding initial data",
            description: "Keep this page open while SeqDesk creates initial users and settings.",
          },
        })
      )
    );

    render(<SetupPage />);

    expect(await screen.findByText("Creating initial data")).toBeTruthy();
    // Use an async query: the page polls /api/setup/status, and a refetch can
    // transiently swap in a spinner, so a synchronous getByText here is racy.
    expect(await screen.findByText("Seeding initial data")).toBeTruthy();
  });

  it("shows seed failure command", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeStatus({
          configured: false,
          error: "Seed failed",
          phase: "seed-failed",
          steps: [
            {
              id: "seed",
              label: "Initial data",
              status: "error",
              description: "Seed failed",
              command: "npm run db:seed",
            },
          ],
          nextAction: {
            label: "Run seed",
            description: "Seed failed",
            command: "npm run db:seed",
          },
        })
      )
    );

    render(<SetupPage />);

    expect(await screen.findByText("Initial data setup failed")).toBeTruthy();
    expect(screen.getAllByText("npm run db:seed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Seed failed").length).toBeGreaterThan(0);
  });
});
