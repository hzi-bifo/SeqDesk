import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { siteSettings: { findUnique } } }));

import { encryptSecret } from "@/lib/security/secret-store";
import { ncbiApiKey, ncbiRequestsPerSecond, ncbiSlot, resetNcbiApiKeyCache, resetNcbiLimiter } from "./ncbi-client";

beforeEach(() => { resetNcbiApiKeyCache(); resetNcbiLimiter(); findUnique.mockReset(); findUnique.mockResolvedValue(null); vi.stubEnv("NEXTAUTH_SECRET", "test-secret-for-ncbi-key"); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("NCBI client", () => {
  it("prefers the encrypted settings key over the environment and ignores malformed keys", async () => {
    vi.stubEnv("NCBI_API_KEY", "envkey0123456789abcdef");
    expect(await ncbiApiKey()).toMatchObject({ value: "envkey0123456789abcdef", source: "environment" });
    resetNcbiApiKeyCache();
    findUnique.mockResolvedValue({ extraSettings: JSON.stringify({ ncbi: { apiKey: encryptSecret("settingskey0123456789ab") } }) });
    expect(await ncbiApiKey()).toMatchObject({ value: "settingskey0123456789ab", source: "settings" });
    resetNcbiApiKeyCache();
    findUnique.mockResolvedValue(null);
    vi.stubEnv("NCBI_API_KEY", "not a key");
    expect(await ncbiApiKey()).toMatchObject({ value: null, source: null });
  });

  it("spaces requests to 3 a second without a key and 10 with one", async () => {
    expect(ncbiRequestsPerSecond(false)).toBe(3);
    expect(ncbiRequestsPerSecond(true)).toBe(10);
    let clock = 1_000_000;
    const now = () => clock;
    vi.useFakeTimers();
    const started: number[] = [];
    const slots = [0, 1, 2, 3].map(() => ncbiSlot(false, now).then(() => started.push(clock)));
    // The first slot is immediate; the others wait 334 ms apart.
    for (let step = 0; step < 4; step += 1) { await vi.advanceTimersByTimeAsync(334); clock += 334; }
    await Promise.all(slots);
    expect(started).toHaveLength(4);
    resetNcbiLimiter();
    clock = 2_000_000;
    const first = ncbiSlot(true, now);
    const second = ncbiSlot(true, now);
    let secondDone = false;
    void second.then(() => { secondDone = true; });
    await first;
    await vi.advanceTimersByTimeAsync(99);
    expect(secondDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(secondDone).toBe(true);
  });
});

describe("ncbiRequestScope", () => {
  it("counts the NCBI requests made inside a scope", async () => {
    const { ncbiRequestScope, ncbiJson } = await import("./ncbi-client");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const scope = { count: 0 };
    await ncbiRequestScope.run(scope, async () => { await ncbiJson("https://api.ncbi.nlm.nih.gov/datasets/v2/x", { source: "NCBI" }); await ncbiJson("https://api.ncbi.nlm.nih.gov/datasets/v2/y", { source: "NCBI" }); });
    expect(scope.count).toBe(2);
    vi.unstubAllGlobals();
  });
});
