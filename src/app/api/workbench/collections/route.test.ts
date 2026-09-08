import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const state = vi.hoisted(() => ({ allowed: true, save: vi.fn(), transaction: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({}) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/workbench/server", () => ({ authorizeWorkbenchRequest: () => state.allowed ? { allowed: true, userId: "owner" } : { allowed: false, response: NextResponse.json({}, { status: 401 }) } }));
vi.mock("@/lib/db", () => ({ db: { $transaction: state.transaction } }));
vi.mock("@/lib/workbench/import-jobs", () => ({ ensureQueuedCollection: state.save }));
import { POST } from "./route";
const collection = { key: "7ff57576-e5b8-4a00-94de-fa12814427de", name: "Test collection" };
const request = (body: unknown) => new NextRequest("http://localhost/api/workbench/collections", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); state.allowed = true; state.transaction.mockImplementation(fn => fn({})); state.save.mockResolvedValue({ id: "saved", name: collection.name }); });
it("saves an owner-scoped empty collection without requiring an import job", async () => {
  const response = await POST(request(collection));
  expect(response.status).toBe(201);
  expect(state.save).toHaveBeenCalledWith({}, "owner", { collection });
  expect(await response.json()).toEqual({ id: "saved", name: collection.name, collectionKey: collection.key });
});
it("rejects unauthorized collection creation", async () => {
  state.allowed = false;
  expect((await POST(request(collection))).status).toBe(401);
  expect(state.save).not.toHaveBeenCalled();
});
it("rejects invalid names and caller-supplied ownership", async () => {
  for (const input of [{ ...collection, name: " " }, { ...collection, userId: "other" }]) expect((await POST(request(input))).status).toBe(400);
  expect(state.save).not.toHaveBeenCalled();
});
