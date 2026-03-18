import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
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

describe("/api/user/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("rejects unauthenticated requests", async () => {
      mocks.getServerSession.mockResolvedValue(null);

      const response = await GET();

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    });

    it("returns the current user's profile", async () => {
      mocks.getServerSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      mocks.db.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        firstName: "Test",
        lastName: "Researcher",
      });

      const response = await GET();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "user-1",
        email: "user@example.com",
        firstName: "Test",
        lastName: "Researcher",
      });
      expect(mocks.db.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          researcherRole: true,
          institution: true,
          facilityName: true,
          department: {
            select: {
              id: true,
              name: true,
            },
          },
          createdAt: true,
        },
      });
    });

    it("returns 404 when the user does not exist", async () => {
      mocks.getServerSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      mocks.db.user.findUnique.mockResolvedValue(null);

      const response = await GET();

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "User not found" });
    });
  });

  describe("PUT", () => {
    it("rejects unauthenticated updates", async () => {
      mocks.getServerSession.mockResolvedValue(null);

      const response = await PUT(
        new NextRequest("http://localhost:3000/api/user/profile", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ firstName: "Test", lastName: "User" }),
        })
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    });

    it("validates required names before updating", async () => {
      mocks.getServerSession.mockResolvedValue({
        user: { id: "user-1" },
      });

      const missingFirstName = await PUT(
        new NextRequest("http://localhost:3000/api/user/profile", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ firstName: " ", lastName: "User" }),
        })
      );
      expect(missingFirstName.status).toBe(400);
      await expect(missingFirstName.json()).resolves.toEqual({
        error: "First name is required",
      });

      const missingLastName = await PUT(
        new NextRequest("http://localhost:3000/api/user/profile", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ firstName: "Test", lastName: " " }),
        })
      );
      expect(missingLastName.status).toBe(400);
      await expect(missingLastName.json()).resolves.toEqual({
        error: "Last name is required",
      });
    });

    it("trims values and clears empty optional fields", async () => {
      mocks.getServerSession.mockResolvedValue({
        user: { id: "user-1" },
      });
      mocks.db.user.update.mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        firstName: "Test",
        lastName: "Researcher",
        phone: null,
        institution: "HZI",
      });

      const response = await PUT(
        new NextRequest("http://localhost:3000/api/user/profile", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: " Test ",
            lastName: " Researcher ",
            phone: " ",
            institution: " HZI ",
          }),
        })
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "user-1",
        email: "user@example.com",
        firstName: "Test",
        lastName: "Researcher",
        phone: null,
        institution: "HZI",
      });
      expect(mocks.db.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          firstName: "Test",
          lastName: "Researcher",
          phone: null,
          institution: "HZI",
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          institution: true,
        },
      });
    });
  });
});
