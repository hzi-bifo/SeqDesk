/**
 * SSRF-safe HTTPS requests for the "any DOI or link" connector: a person pastes an address and SeqDesk fetches it
 * from inside the lab network, so every hop is checked before a connection is made.
 *
 *  - https only, default port only, no user:password@, no file:/ftp:/data: or anything else;
 *  - the host name is resolved once per connection and every address it resolves to must be public (no loopback,
 *    private, link-local, CGNAT, multicast, unique-local, IPv4-mapped private, documentation or reserved ranges);
 *    the check runs inside the socket's own lookup, so a DNS answer cannot change between check and connect;
 *  - redirects are followed by hand, at most five, and each target passes the same checks;
 *  - optional host allow/deny lists (server settings), matched on the host name and its parent domains.
 */
import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import type { IncomingHttpHeaders } from "node:http";
import type { Readable } from "node:stream";

import { SOURCE_USER_AGENT } from "./public-record-download";

const MAX_REDIRECTS = 5;

export class UnsafeUrlError extends Error {
  constructor(message: string) { super(message); this.name = "UnsafeUrlError"; }
}

function v4Number(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** True for any address a public download must never reach. Unparseable input counts as private. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").split("%")[0];
  if (net.isIPv4(ip)) {
    const value = v4Number(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((value & mask) >>> 0) === ((v4Number(base) & mask) >>> 0);
    });
  }
  if (!net.isIPv6(ip)) return true;
  const lower = ip.toLowerCase();
  // IPv4-mapped / -compatible / NAT64 forms carry an IPv4 address: judge that one.
  const embedded = /^(?:::ffff:(?:0:)?|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (embedded) return isPrivateAddress(embedded[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16);
    return isPrivateAddress(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
  }
  if (lower === "::" || lower === "::1") return true;
  const first = parseInt(lower.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (lower.startsWith("2001:db8:") || lower.startsWith("2001:0db8:")) return true; // documentation
  if (lower.startsWith("100::")) return true; // discard
  return (first & 0xe000) !== 0x2000; // only 2000::/3 is global unicast
}

export interface HostLists { allow?: string[]; deny?: string[] }

function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase().replace(/^\*?\./, "");
  return Boolean(p) && (host === p || host.endsWith(`.${p}`));
}

/** Server settings: SEQDESK_URL_IMPORT_ALLOW_HOSTS / SEQDESK_URL_IMPORT_DENY_HOSTS (comma-separated domains). */
export function hostListsFromEnv(env: NodeJS.ProcessEnv = process.env): HostLists {
  const list = (value?: string) => (value ?? "").split(/[\s,]+/).map(item => item.trim().toLowerCase()).filter(Boolean);
  return { allow: list(env.SEQDESK_URL_IMPORT_ALLOW_HOSTS), deny: list(env.SEQDESK_URL_IMPORT_DENY_HOSTS) };
}

/** The shape checks every hop passes before any lookup. Returns the parsed URL or throws a plain sentence. */
export function checkUrlShape(raw: string, lists: HostLists = {}): URL {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new UnsafeUrlError("That is not a web address. Paste a link that starts with https://."); }
  if (url.protocol !== "https:") throw new UnsafeUrlError(`Only https:// links can be fetched (${url.protocol.replace(":", "")} links are refused).`);
  if (url.username || url.password) throw new UnsafeUrlError("Links with a user name or password in them are refused.");
  if (url.port && url.port !== "443") throw new UnsafeUrlError("Links to a non-standard port are refused.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("That link has no host.");
  const literal = host.replace(/^\[|\]$/g, "");
  if (net.isIP(literal)) {
    if (isPrivateAddress(literal)) throw new UnsafeUrlError("Links to private or local network addresses are refused.");
  } else if (!host.includes(".") || /\.(?:local|localhost|internal|intranet|lan|home\.arpa)$/.test(host) || host === "localhost") {
    throw new UnsafeUrlError("Links to local network names are refused.");
  }
  if (lists.deny?.some(pattern => hostMatches(host, pattern))) throw new UnsafeUrlError(`${host} is on this server's list of refused sites.`);
  if (lists.allow?.length && !lists.allow.some(pattern => hostMatches(host, pattern))) throw new UnsafeUrlError(`${host} is not on this server's list of allowed sites.`);
  return url;
}

type LookupAll = (host: string) => Promise<{ address: string; family: number }[]>;
const systemLookup: LookupAll = host => dns.promises.lookup(host, { all: true, verbatim: true });

/** Resolve a host and refuse it when any of its addresses is private (a name that points inside is never "partly" safe). */
export async function publicAddresses(host: string, lookup: LookupAll = systemLookup): Promise<{ address: string; family: number }[]> {
  const literal = host.replace(/^\[|\]$/g, "");
  if (net.isIP(literal)) {
    if (isPrivateAddress(literal)) throw new UnsafeUrlError("Links to private or local network addresses are refused.");
    return [{ address: literal, family: net.isIPv6(literal) ? 6 : 4 }];
  }
  let addresses: { address: string; family: number }[];
  try { addresses = await lookup(host); } catch { throw new UnsafeUrlError(`${host} could not be found.`); }
  if (!addresses.length) throw new UnsafeUrlError(`${host} could not be found.`);
  if (addresses.some(entry => isPrivateAddress(entry.address))) throw new UnsafeUrlError(`${host} points to a private or local network address; it is refused.`);
  return addresses;
}

export interface SafeResponse { status: number; headers: IncomingHttpHeaders; body: Readable; url: string }
export type RequestOnce = (url: URL, options: { method: "GET" | "HEAD"; headers: Record<string, string>; signal?: AbortSignal; lookup: LookupAll }) => Promise<SafeResponse>;

/** One HTTPS request whose socket connects only to an address `publicAddresses` accepted. */
export const httpsRequestOnce: RequestOnce = (url, options) => new Promise((resolve, reject) => {
  const request = https.request(url, {
    method: options.method,
    headers: options.headers,
    signal: options.signal,
    timeout: 30_000,
    // Node asks for every address (all: true) when it races IPv4/IPv6; answer in the shape it asked for.
    lookup: ((hostname: string, opts: { all?: boolean }, callback: (...args: unknown[]) => void) => {
      publicAddresses(hostname, options.lookup).then(
        addresses => (opts?.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family)),
        error => callback(error),
      );
    }) as never,
  }, response => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response, url: url.toString() }));
  request.on("timeout", () => request.destroy(new Error("TimeoutError")));
  request.on("error", reject);
  request.end();
});

/**
 * GET or HEAD `raw`, following redirects by hand; every hop is shape-checked and resolved to public addresses only.
 * The caller reads (or discards) `body`.
 */
export async function safeFetch(raw: string, options: {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  signal?: AbortSignal;
  lists?: HostLists;
  lookup?: LookupAll;
  requestOnce?: RequestOnce;
} = {}): Promise<SafeResponse> {
  const requestOnce = options.requestOnce ?? httpsRequestOnce;
  const lookup = options.lookup ?? systemLookup;
  let url = checkUrlShape(raw, options.lists);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await publicAddresses(url.hostname, lookup);
    const response = await requestOnce(url, {
      method: options.method ?? "GET",
      headers: { "user-agent": SOURCE_USER_AGENT, "accept-encoding": "identity", ...options.headers },
      signal: options.signal,
      lookup,
    });
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      response.body.resume();
      const location = response.headers.location;
      if (!location) throw new UnsafeUrlError("The site redirected without saying where to.");
      let next: string;
      try { next = new URL(location, url).toString(); } catch { throw new UnsafeUrlError("The site redirected to an address that could not be read."); }
      try { url = checkUrlShape(next, options.lists); } catch (error) {
        throw new UnsafeUrlError(`The site redirected to an address that is refused: ${(error as Error).message}`);
      }
      continue;
    }
    return { ...response, url: url.toString() };
  }
  throw new UnsafeUrlError(`The site redirected more than ${MAX_REDIRECTS} times.`);
}
