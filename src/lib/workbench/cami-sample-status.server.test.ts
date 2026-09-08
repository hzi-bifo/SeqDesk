import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), jobs: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { read: { findMany: mocks.read }, workbenchImportJob: { findMany: mocks.jobs } } }));
import { getCamiSampleStatuses } from "./cami-sample-status.server";
import { scientificRecordId } from "./scientific-publication";
const query = { collection: "00e55dcb-9697-4b89-af56-af51bd557a17", dataset: "cami2-marine" as const, technology: "short" as const };
const job = (sample: number, status: string, changes = {}) => ({ id: "job-" + sample, status, request: JSON.stringify({ collection: { key: query.collection }, dataset: query.dataset, technology: query.technology, sample, ...changes }), phase: "downloading", progress: 25, error: null });
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue([]); mocks.jobs.mockResolvedValue([]); });
it("returns every sample and scopes both reads and jobs to the owner", async () => {
  const statuses = await getCamiSampleStatuses("owner", query);
  expect(statuses).toHaveLength(10);
  expect(statuses.every(sample => sample.status === "available")).toBe(true);
  expect(mocks.read.mock.calls[0][0].where.sample).toEqual({ orderId: scientificRecordId("data", "owner", "collection", query.collection), order: { userId: "owner", dataOrigin: "import" } });
  for (const [args] of mocks.jobs.mock.calls) expect(args.where).toMatchObject({ createdById: "owner", workspace: { ownerId: "owner" }, providerId: "cami-benchmark", request: { contains: query.collection } });
  expect(mocks.jobs.mock.calls[0][0].take).toBeUndefined(); // Never truncate active transfers.
});
it("uses durable reads for imported status even with no recent successful job", async () => {
  mocks.read.mockResolvedValue([{ id: scientificRecordId("read", "owner", "collection", query.collection, "cami-benchmark", query.dataset, "sample_2", "short") }]);
  mocks.jobs.mockResolvedValueOnce([job(2, "running"), job(3, "queued")]).mockResolvedValueOnce([job(2, "error"), job(3, "error"), job(4, "cancelled")]);
  const statuses = await getCamiSampleStatuses("owner", query);
  expect(statuses[2]).toMatchObject({ status: "imported", orderId: expect.stringContaining("imported-data-") });
  expect(statuses[3].status).toBe("queued");
  expect(statuses[4].status).toBe("cancelled");
});
it("ignores malformed and mismatched job selections, including other technologies", async () => {
  mocks.jobs.mockResolvedValueOnce([
    job(0, "running", { technology: "long" }), job(1, "queued", { dataset: "cami3-toy-human-gut" }),
    job(2, "running", { collection: { key: "someone-else" } }), job(30, "queued"),
    { request: "invalid" }, { request: "null" }, job(3.2, "queued"),
  ]);
  expect((await getCamiSampleStatuses("owner", query)).every(sample => sample.status === "available")).toBe(true);
});
it("supports all twenty CAMI III samples", async () => {
  expect(await getCamiSampleStatuses("owner", { ...query, dataset: "cami3-toy-human-gut" })).toHaveLength(20);
});
