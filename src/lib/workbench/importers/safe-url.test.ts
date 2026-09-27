import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { checkUrlShape, hostListsFromEnv, isPrivateAddress, publicAddresses, safeFetch, type RequestOnce } from "./safe-url";

const lookupTo = (...addresses: string[]) => vi.fn(async () => addresses.map(address => ({ address, family: address.includes(":") ? 6 : 4 })));
const answer = (status: number, headers: Record<string, string> = {}): Awaited<ReturnType<RequestOnce>> => {
  const body = new PassThrough();
  body.end();
  return { status, headers, body, url: "" };
};

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "192.0.2.1", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::10.0.0.1", "2001:db8::1", "not an address",
  ])("refuses %s", address => expect(isPrivateAddress(address)).toBe(true));
  it.each(["8.8.8.8", "130.14.29.110", "172.32.0.1", "100.128.0.1", "2a00:1450:4001::200e", "::ffff:8.8.8.8"])("accepts %s", address => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("checkUrlShape", () => {
  it.each([
    ["file:///etc/passwd", "Only https://"],
    ["http://example.org/data.csv", "Only https://"],
    ["ftp://ftp.example.org/x", "Only https://"],
    ["data:text/plain,hi", "Only https://"],
    ["https://user:pw@example.org/x", "user name or password"],
    ["https://example.org:8080/x", "non-standard port"],
    ["https://localhost/x", "local network names"],
    ["https://intranet/x", "local network names"],
    ["https://files.corp.internal/x", "local network names"],
    ["https://127.0.0.1/x", "private or local"],
    ["https://[::1]/x", "private or local"],
    ["https://169.254.169.254/latest/meta-data", "private or local"],
    ["https://[::ffff:10.0.0.1]/x", "private or local"],
    ["not a url", "not a web address"],
  ])("refuses %s", (url, words) => expect(() => checkUrlShape(url)).toThrow(words));

  it("accepts a public https link", () => {
    expect(checkUrlShape("https://example.org/data.csv").hostname).toBe("example.org");
  });

  it("applies the server's allow and deny lists to hosts and their subdomains", () => {
    const lists = hostListsFromEnv({ SEQDESK_URL_IMPORT_ALLOW_HOSTS: "example.org, data.gov", SEQDESK_URL_IMPORT_DENY_HOSTS: "bad.example.org" } as unknown as NodeJS.ProcessEnv);
    expect(checkUrlShape("https://files.example.org/x", lists).hostname).toBe("files.example.org");
    expect(() => checkUrlShape("https://bad.example.org/x", lists)).toThrow("refused sites");
    expect(() => checkUrlShape("https://x.bad.example.org/x", lists)).toThrow("refused sites");
    expect(() => checkUrlShape("https://example.com/x", lists)).toThrow("not on this server's list of allowed");
    expect(() => checkUrlShape("https://notexample.org/x", lists)).toThrow("not on this server's list of allowed");
  });
});

describe("publicAddresses", () => {
  it("refuses a name that resolves to a private address, even alongside public ones", async () => {
    await expect(publicAddresses("rebind.example", lookupTo("10.0.0.5"))).rejects.toThrow("private or local");
    await expect(publicAddresses("mixed.example", lookupTo("93.184.216.34", "127.0.0.1"))).rejects.toThrow("private or local");
    await expect(publicAddresses("public.example", lookupTo("93.184.216.34"))).resolves.toHaveLength(1);
  });
  it("says when a name cannot be found", async () => {
    await expect(publicAddresses("missing.example", vi.fn(async () => { throw new Error("ENOTFOUND"); }))).rejects.toThrow("could not be found");
  });
});

describe("safeFetch", () => {
  it("follows a redirect only after checking the next hop", async () => {
    const requestOnce = vi.fn<RequestOnce>()
      .mockResolvedValueOnce(answer(302, { location: "https://cdn.example.org/file.csv" }))
      .mockResolvedValueOnce(answer(200, { "content-length": "12" }));
    const response = await safeFetch("https://example.org/file", { lookup: lookupTo("93.184.216.34"), requestOnce });
    expect(response.status).toBe(200);
    expect(response.url).toBe("https://cdn.example.org/file.csv");
    expect(requestOnce).toHaveBeenCalledTimes(2);
  });

  it("refuses redirects to metadata endpoints, plain http, other schemes and private names", async () => {
    for (const location of ["https://169.254.169.254/latest/meta-data/", "http://example.org/file", "file:///etc/passwd", "https://localhost/admin"]) {
      const requestOnce = vi.fn<RequestOnce>().mockResolvedValueOnce(answer(301, { location }));
      await expect(safeFetch("https://example.org/file", { lookup: lookupTo("93.184.216.34"), requestOnce })).rejects.toThrow("redirected to an address that is refused");
      expect(requestOnce).toHaveBeenCalledTimes(1);
    }
    const lookup = vi.fn(async (host: string) => [{ address: host === "inside.example.org" ? "192.168.0.10" : "93.184.216.34", family: 4 }]);
    const requestOnce = vi.fn<RequestOnce>().mockResolvedValueOnce(answer(307, { location: "https://inside.example.org/x" }));
    await expect(safeFetch("https://example.org/file", { lookup, requestOnce })).rejects.toThrow("private or local");
    expect(requestOnce).toHaveBeenCalledTimes(1);
  });

  it("stops after five redirects", async () => {
    const requestOnce = vi.fn<RequestOnce>().mockImplementation(async () => answer(302, { location: "https://example.org/again" }));
    await expect(safeFetch("https://example.org/file", { lookup: lookupTo("93.184.216.34"), requestOnce })).rejects.toThrow("more than 5 times");
    expect(requestOnce).toHaveBeenCalledTimes(6);
  });

  it("never connects when the first host is private", async () => {
    const requestOnce = vi.fn<RequestOnce>();
    await expect(safeFetch("https://example.org/file", { lookup: lookupTo("127.0.0.1"), requestOnce })).rejects.toThrow("private or local");
    await expect(safeFetch("https://10.0.0.1/file", { lookup: lookupTo("93.184.216.34"), requestOnce })).rejects.toThrow("private or local");
    expect(requestOnce).not.toHaveBeenCalled();
  });

  it("refuses to reach localhost for real (the socket's own lookup check)", async () => {
    await expect(safeFetch("https://localhost.localdomain.example/x", { lookup: lookupTo("127.0.0.1") })).rejects.toThrow("private or local");
  });
});
