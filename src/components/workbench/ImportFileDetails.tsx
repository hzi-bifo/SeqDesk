"use client";
import { useState } from "react";
export interface ImportFileInfo { filename: string; url?: string; bytes?: number; sourceMd5?: string; etag?: string; localSha256?: string; verifiedMd5?: string }
export function safeSourceUrl(value?: string) {
  try { const url = new URL(value || ""); return ["https:", "http:", "ftp:"].includes(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; }
}
export function ImportFileDetails({ file }: { file: ImportFileInfo }) {
  const [copyStatus, setCopyStatus] = useState("");
  const url = safeSourceUrl(file.url);
  const md5 = /^[a-f0-9]{32}$/i.test(file.sourceMd5 ?? "") ? file.sourceMd5 : undefined;
  const sha = /^[a-f0-9]{64}$/i.test(file.localSha256 ?? "") ? file.localSha256 : undefined;
  const matched = md5 && file.verifiedMd5?.toLowerCase() === md5.toLowerCase();
  return <details className="rounded-lg border bg-muted/20 p-3 text-xs open:bg-card">
    <summary className="cursor-pointer break-words rounded leading-relaxed text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 motion-reduce:transition-none">File details · {file.filename}{typeof file.bytes === "number" ? " · " + (file.bytes / 1024 ** 2).toFixed(1) + " MiB" : ""}{url ? " · " + url.hostname + " · " + url.protocol.slice(0, -1).toUpperCase() : ""}</summary>
    <div className="mt-3 space-y-2 break-all border-t pt-3 leading-relaxed">
      {url && <><a href={url.href} className="block underline" target="_blank" rel="noreferrer">{url.href}</a><button type="button" className="underline" onClick={async () => { try { await navigator.clipboard.writeText(url.href); setCopyStatus("URL copied"); } catch { setCopyStatus("Could not copy; select the URL above."); } }}>Copy source URL</button>{copyStatus && <p role="status">{copyStatus}</p>}</>}
      <p>{md5 ? "Repository MD5: " + md5 : "Repository checksum: not provided"}</p>
      {file.etag && <p>Source version (ETag): {file.etag} — not treated as an MD5 checksum</p>}
      {sha && <p>Locally calculated SHA-256: {sha}</p>}
      {matched ? <p>Repository MD5 match verified after download.</p> : md5 && file.verifiedMd5 ? <p>Warning: recorded MD5 does not match the repository checksum.</p> : sha ? <p>Local digest recorded; no repository checksum match established.</p> : md5 ? <p>Repository checksum will be checked during download.</p> : null}
    </div>
  </details>;
}
