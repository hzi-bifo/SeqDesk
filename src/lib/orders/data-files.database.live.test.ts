// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

const state = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/db", async () => {
  const url = process.env.SEQDESK_BETA_DATABASE_URL;
  if (!url) return { db: null };
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || !/^\/seqdesk_beta_[a-zA-Z0-9_]*test_[a-zA-Z0-9_]+$/.test(parsed.pathname)) {
    throw new Error("File integration tests require an explicitly named isolated local beta test database");
  }
  const { PrismaClient } = await import("@prisma/client");
  return { db: new PrismaClient({ datasourceUrl: url }) };
});
vi.mock("@/lib/deployment-profile/server", () => ({ getServerDeploymentProfile: () => getDeploymentProfileDefinition("research-workbench") }));
vi.mock("@/lib/files/data-base-path", () => ({ getResolvedDataBasePath: async () => ({ dataBasePath: state.root }) }));
vi.mock("@/lib/minknow/config", () => ({ loadMinknowConfig: async () => ({ enabled: false, outputRoot: "" }) }));
vi.mock("@/lib/modules/input-modules.server", () => ({ inputModuleEnabled: async () => true }));

import { db } from "@/lib/db";
import { addDataFilesReadSet, authorizeDataFiles, getDataFilesInventory, uploadDataFiles } from "./data-files.server";

describe.runIf(Boolean(process.env.SEQDESK_BETA_DATABASE_URL))("real PostgreSQL file association invariants", () => {
  const createdUsers: string[] = [];
  beforeAll(async () => {
    state.root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-files-db-")));
    // Read-only compatibility probe. This test never creates or migrates a database.
    await db.order.findFirst({ select: { dataOrigin: true } });
  });
  afterAll(async () => {
    try {
      if (createdUsers.length) {
        await db.order.deleteMany({ where: { userId: { in: createdUsers } } });
        await db.user.deleteMany({ where: { id: { in: createdUsers } } });
      }
    } finally {
      await db.$disconnect();
      if (state.root) await fs.rm(state.root, { recursive: true, force: true });
    }
  });
  it("persists independent reads, preserves selected provenance, uploads bytes, and rejects invalid associations atomically", async () => {
    const key = randomUUID();
    const user = await db.user.create({ data: { email: `files-${key}@local-test.invalid`, password: "not-a-login-hash", firstName: "Internal", lastName: "Files fixture" } });
    createdUsers.push(user.id);
    const session = { user: { id: user.id, role: "RESEARCHER", authorizationValid: true }, expires: "2099-01-01" } as Session;
    const order = await db.order.create({ data: { orderNumber: `FILES-${key}`, userId: user.id, dataOrigin: "import", status: "COMPLETED", name: "Internal file integration fixture" } });
    const foreignOrder = await db.order.create({ data: { orderNumber: `FILES-other-${key}`, userId: user.id, dataOrigin: "import", status: "COMPLETED" } });
    const sample = await db.sample.create({ data: { orderId: order.id, sampleId: "sample", facilityStatus: "NOT_APPLICABLE" } });
    const foreignSample = await db.sample.create({ data: { orderId: foreignOrder.id, sampleId: "foreign", facilityStatus: "NOT_APPLICABLE" } });
    const root = path.join("_uploads", "orders", order.id);
    await fs.mkdir(path.join(state.root, root), { recursive: true });
    const files = ["original.fastq", "new.fastq", "another.fastq"];
    for (const [index, name] of files.entries()) await fs.writeFile(path.join(state.root, root, name), `@internal-${index}\nACGT\n+\nIIII\n`);
    const provenance = JSON.stringify({ sourceType: "original_internal_fixture", preserved: true });
    const selected = await db.read.create({ data: { sampleId: sample.id, file1: path.join(root, files[0]), isActive: true, dataClass: "cleaned", pipelineSources: provenance } });
    const access = await authorizeDataFiles(session, order.id, true);
    const linkRequest = { requestId: randomUUID(), sampleId: sample.id, read1: path.join(root, files[1]) };
    const linked = await addDataFilesReadSet(access, linkRequest);
    expect(await addDataFilesReadSet(access, linkRequest)).toEqual(linked);
    expect(await db.read.findUniqueOrThrow({ where: { id: linked.readId } })).toMatchObject({ isActive: false, dataClass: "unknown", sampleId: sample.id });
    expect(await db.read.findUniqueOrThrow({ where: { id: selected.id } })).toMatchObject({ isActive: true, pipelineSources: provenance, file1: path.join(root, files[0]) });
    const form = new FormData();
    form.set("requestId", randomUUID());
    form.set("newSample", JSON.stringify({ sampleId: "uploaded", sampleTitle: "Internal uploaded sample" }));
    form.set("file1", new File(["@uploaded-internal\nTGCA\n+\nIIII\n"], "upload.fastq"));
    const uploaded = await uploadDataFiles(access, new Request("http://localhost/upload", { method: "POST", body: form }));
    // The same new-sample request can be retried after a lost success response.
    expect(await uploadDataFiles(access, new Request("http://localhost/upload", { method: "POST", body: form }))).toEqual(uploaded);
    expect(await fs.readdir(path.join(state.root, root, "linked"))).toHaveLength(1);
    const storedUpload = await db.read.findUniqueOrThrow({ where: { id: uploaded.readId } });
    expect(storedUpload.isActive).toBe(false);
    expect(await fs.readFile(path.join(state.root, storedUpload.file1!), "utf8")).toContain("@uploaded-internal");
    const inventory = await getDataFilesInventory(access);
    expect(inventory.readSets.map(read => read.id).sort()).toEqual([selected.id, linked.readId, uploaded.readId].sort());
    expect(inventory.readSets.every(read => read.files.every(file => file.exists))).toBe(true);
    const sampleCount = await db.sample.count({ where: { orderId: order.id } });
    const readCount = await db.read.count({ where: { sample: { orderId: order.id } } });
    await expect(addDataFilesReadSet(access, { sampleId: foreignSample.id, read1: path.join(root, files[2]) })).rejects.toMatchObject({ status: 400 });
    await expect(addDataFilesReadSet(access, { newSample: { sampleId: "must-not-exist" }, read1: path.join(root, files[1]) })).rejects.toMatchObject({ status: 409 });
    expect(await db.sample.count({ where: { orderId: order.id } })).toBe(sampleCount);
    expect(await db.read.count({ where: { sample: { orderId: order.id } } })).toBe(readCount);
    expect(await db.read.count({ where: { sampleId: sample.id, isActive: true } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).sequencingFilesPublishedAt).toBeNull();
  });
});
