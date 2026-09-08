import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";
const m = vi.hoisted(() => ({ session: vi.fn(), profile: vi.fn(), order: vi.fn(), summary: vi.fn(),
  txOrder: vi.fn(), read: vi.fn(), update: vi.fn(), updateMany: vi.fn(), lock: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: m.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/deployment-profile/server", () => ({ getServerDeploymentProfile: m.profile }));
vi.mock("@/lib/sequencing/workspace", () => ({ getOrderSequencingSummary: m.summary }));
vi.mock("@/lib/db", () => ({ db: {
  order: { findFirst: m.order },
  $transaction: (cb: (tx: unknown) => unknown) => cb({ order: { findFirst: m.txOrder },
    read: { findFirst: m.read, update: m.update, updateMany: m.updateMany }, $queryRaw: m.lock }),
} }));
import { GET, PUT } from "./route";
const params = { params: Promise.resolve({ id: "order-1" }) };
const request = (body: unknown = { sampleId: "s1", readId: "r1" }) => new Request("http://localhost/api/orders/order-1/pipeline-input", { method: "PUT", body: JSON.stringify(body) });
describe("owned, source-neutral pipeline read selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.session.mockResolvedValue({ user: { id: "owner", role: "RESEARCHER" } });
    m.profile.mockReturnValue(getDeploymentProfileDefinition("research-workbench"));
    m.order.mockResolvedValue({ id: "order-1", dataOrigin: "import" });
    m.txOrder.mockResolvedValue({ dataOrigin: "import" });
    m.read.mockResolvedValue({ id: "r1", file1: "/validated/reads.fastq.gz" });
    m.summary.mockResolvedValue({ summary: { readsLinkedSamples: 1 }, samples: [{ id: "s1", hasReads: true, read: { id: "r1", file1: "reads.fastq.gz", isActive: false } }] });
  });
  it("never presents an inactive fallback read as pipeline-ready", async () => {
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.samples[0].read).toBeNull();
    expect(body.samples[0].hasReads).toBe(false);
    expect(body.summary.readsLinkedSamples).toBe(0);
    expect(m.order).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "order-1", userId: "owner" } }));
  });
  it("selects only a nonsuperseded read of this sample and order, under an owner recheck", async () => {
    expect((await PUT(request(), params)).status).toBe(200);
    expect(m.txOrder).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "order-1", userId: "owner" } }));
    expect(m.read).toHaveBeenCalledWith({ where: { id: "r1", sampleId: "s1", sample: { orderId: "order-1" }, supersededByReadId: null } });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { isActive: true } });
  });
  it("does not leak another owner's summary", async () => {
    m.order.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(404);
    expect(m.summary).not.toHaveBeenCalled();
  });
  it("rejects ownership changes before mutation", async () => {
    m.txOrder.mockResolvedValue(null);
    expect((await PUT(request(), params)).status).toBe(404);
    expect(m.updateMany).not.toHaveBeenCalled();
  });
  it("rejects foreign or superseded read IDs without changing the current input", async () => {
    m.read.mockResolvedValue(null);
    expect((await PUT(request(), params)).status).toBe(404);
    expect(m.updateMany).not.toHaveBeenCalled();
  });
  it("keeps facility read promotion in sequencing management", async () => {
    m.order.mockResolvedValue({ id: "order-1", dataOrigin: "facility" });
    expect((await PUT(request(), params)).status).toBe(403);
    expect(m.read).not.toHaveBeenCalled();
  });
  it("blocks public-demo mutations", async () => {
    m.session.mockResolvedValue({ user: { id: "owner", role: "RESEARCHER", isDemo: true } });
    expect((await PUT(request(), params)).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    m.session.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(401);
  });
  it("does not accept caller-supplied file paths", async () => {
    expect((await PUT(request({ sampleId: "s1", readId: "r1", file1: "/etc/passwd" }), params)).status).toBe(400);
    expect(m.read).not.toHaveBeenCalled();
  });
});
