import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { GET, PUT } from "./route";

describe("/api/admin/settings/access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("returns admin access settings from extraSettings", async () => {
      mocks.getServerSession.mockResolvedValue({
        user: {
          id: "admin-1",
          role: "FACILITY_ADMIN",
        },
      });
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({
          departmentSharing: true,
          allowDeleteSubmittedOrders: true,
          allowUserAssemblyDownload: false,
        }),
        postSubmissionInstructions: "Ship on dry ice",
      });

      const response = await GET();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        departmentSharing: true,
        allowDeleteSubmittedOrders: true,
        allowUserAssemblyDownload: false,
        orderNotesEnabled: true,
        postSubmissionInstructions: "Ship on dry ice",
      });
    });

    it("returns researcher-safe subset only", async () => {
      mocks.getServerSession.mockResolvedValue({
        user: {
          id: "user-1",
          role: "RESEARCHER",
        },
      });
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({
          allowDeleteSubmittedOrders: true,
          allowUserAssemblyDownload: true,
        }),
        postSubmissionInstructions: "Ignored for researchers",
      });

      const response = await GET();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        allowUserAssemblyDownload: true,
      });
    });

    it("falls back to defaults when extraSettings JSON is invalid", async () => {
      mocks.getServerSession.mockResolvedValue({
        user: {
          id: "admin-1",
          role: "FACILITY_ADMIN",
        },
      });
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: "{bad-json",
        postSubmissionInstructions: null,
      });

      const response = await GET();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        departmentSharing: false,
        allowDeleteSubmittedOrders: false,
        allowUserAssemblyDownload: false,
        orderNotesEnabled: true,
        postSubmissionInstructions: null,
      });
    });
  });

  describe("PUT", () => {
    it("rejects non-admin updates", async () => {
      mocks.getServerSession.mockResolvedValue({
        user: {
          id: "user-1",
          role: "RESEARCHER",
        },
      });

      const response = await PUT(
        new NextRequest("http://localhost:3000/api/admin/settings/access", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ allowDeleteSubmittedOrders: true }),
        }),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
      expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
    });

    it("persists allowDeleteSubmittedOrders and preserves unrelated settings", async () => {
      mocks.getServerSession.mockResolvedValue({
        user: {
          id: "admin-1",
          role: "FACILITY_ADMIN",
        },
      });
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({
          departmentSharing: true,
          allowUserAssemblyDownload: false,
          orderNotesEnabled: false,
          unrelated: { keep: true },
        }),
      });
      mocks.db.siteSettings.upsert.mockResolvedValue({});

      const response = await PUT(
        new NextRequest("http://localhost:3000/api/admin/settings/access", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            allowDeleteSubmittedOrders: true,
            postSubmissionInstructions: "Updated instructions",
          }),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });

      const args = mocks.db.siteSettings.upsert.mock.calls[0][0] as {
        update: { extraSettings: string; postSubmissionInstructions?: string };
        create: { id: string; extraSettings: string; postSubmissionInstructions?: string };
      };
      const merged = JSON.parse(args.update.extraSettings);

      expect(merged).toEqual({
        departmentSharing: true,
        allowUserAssemblyDownload: false,
        allowDeleteSubmittedOrders: true,
        orderNotesEnabled: false,
        unrelated: { keep: true },
      });
      expect(args.update.postSubmissionInstructions).toBe("Updated instructions");
      expect(args.create.id).toBe("singleton");
    });

    it("recovers from invalid extraSettings JSON during save", async () => {
      mocks.getServerSession.mockResolvedValue({
        user: {
          id: "admin-1",
          role: "FACILITY_ADMIN",
        },
      });
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: "{bad-json",
      });
      mocks.db.siteSettings.upsert.mockResolvedValue({});

      const response = await PUT(
        new NextRequest("http://localhost:3000/api/admin/settings/access", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            allowDeleteSubmittedOrders: false,
            allowUserAssemblyDownload: true,
          }),
        }),
      );

      expect(response.status).toBe(200);
      const args = mocks.db.siteSettings.upsert.mock.calls[0][0] as {
        update: { extraSettings: string };
      };
      expect(JSON.parse(args.update.extraSettings)).toEqual({
        allowDeleteSubmittedOrders: false,
        allowUserAssemblyDownload: true,
      });
    });

    it("persists orderNotesEnabled while preserving unrelated settings", async () => {
      mocks.getServerSession.mockResolvedValue({
        user: {
          id: "admin-1",
          role: "FACILITY_ADMIN",
        },
      });
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({
          departmentSharing: true,
          unrelated: { keep: true },
        }),
      });
      mocks.db.siteSettings.upsert.mockResolvedValue({});

      const response = await PUT(
        new NextRequest("http://localhost:3000/api/admin/settings/access", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orderNotesEnabled: false,
          }),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });

      const args = mocks.db.siteSettings.upsert.mock.calls[0][0] as {
        update: { extraSettings: string };
      };
      expect(JSON.parse(args.update.extraSettings)).toEqual({
        departmentSharing: true,
        orderNotesEnabled: false,
        unrelated: { keep: true },
      });
    });
  });
});
