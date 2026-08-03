import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface DownloadEnaFileOptions {
  url: string;
  destination: string;
  expectedMd5: string;
  fetchImpl?: FetchLike;
}

export async function downloadEnaFile({
  url,
  destination,
  expectedMd5,
  fetchImpl = fetch,
}: DownloadEnaFileOptions): Promise<{ bytes: number; md5: string }> {
  const normalizedExpected = expectedMd5.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalizedExpected)) {
    throw new Error(`Invalid expected ENA MD5 for ${url}: ${expectedMd5}`);
  }

  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  const contents = Buffer.from(await response.arrayBuffer());
  if (contents.length === 0) {
    throw new Error(`Downloaded 0 bytes from ${url}`);
  }

  const actualMd5 = createHash("md5").update(contents).digest("hex");
  if (actualMd5 !== normalizedExpected) {
    throw new Error(
      `ENA MD5 mismatch for ${url}: expected ${normalizedExpected}, got ${actualMd5}`,
    );
  }

  // Do not place a corrupt or truncated response at the fixture path. The
  // caller stages into a fresh directory and archives only verified files.
  await fs.writeFile(destination, contents);
  return { bytes: contents.length, md5: actualMd5 };
}
