import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createGunzip } from 'node:zlib';
import { extract } from 'tar-stream';
import type { PipelineResource } from './resource-schema';

type Asset = PipelineResource['assets'][number];
export type ResourceFiles = Record<string, { bytes: number; sha256?: string }>;

/** A narrow public IPv4 transport, pinned to the validated DNS result. No redirects. */
export function isPublicResourceAddress(address: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) return false;
  const [a, b, c, d] = address.split('.').map(Number);
  if ([a, b, c, d].some(n => n > 255)) return false;
  return a > 0 && a < 224 && ![10, 127].includes(a) &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113);
}

export async function openResourceDownload(url: string, signal: AbortSignal): Promise<Readable> {
  const source = new URL(url);
  if (source.protocol !== 'https:' || source.username || source.password || source.hash || (source.port && source.port !== '443')) throw new Error('Resource requires public HTTPS');
  const addresses = await Promise.race([
    lookup(source.hostname, { all: true, family: 4 }),
    delay(15_000, undefined, { signal, ref: false }).then(() => { throw new Error('Resource DNS lookup timed out'); }),
  ]);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(entry => !isPublicResourceAddress(entry.address))) throw new Error('Resource host resolved to a non-public address');
  return new Promise((resolve, reject) => {
    const request = https.get(source, {
      signal,
      headers: { 'Accept-Encoding': 'identity' },
      // Disable connection reuse: the connection must use this validated address.
      agent: false,
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [addresses[0]]);
        else callback(null, addresses[0].address, 4);
      },
    }, response => {
      if (response.statusCode !== 200 || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        response.destroy(); reject(new Error(`Resource server returned unsupported HTTP ${response.statusCode} or encoding`)); return;
      }
      resolve(response);
    });
    const connectTimer = setTimeout(() => request.destroy(new Error('Resource connection timed out')), 30_000);
    request.once('response', () => clearTimeout(connectTimer));
    request.once('close', () => clearTimeout(connectTimer));
    request.setTimeout(120_000, () => request.destroy(new Error('Resource transfer timed out')));
    request.on('error', reject);
  });
}

export async function saveResourceAsset(
  source: Readable, asset: Asset, destination: string, signal: AbortSignal,
  progress: (bytes: number) => void, bytesPerSecond?: number,
) {
  let bytes = 0;
  const checksum = createHash(asset.checksum.algorithm), sha256 = createHash('sha256');
  const started = Date.now();
  async function* verifiedChunks() {
    for await (const chunk of source) {
      signal.throwIfAborted();
      bytes += chunk.length;
      if (bytes > asset.bytes) throw new Error(`Resource size exceeds manifest: ${asset.fileName}`);
      checksum.update(chunk); sha256.update(chunk);
      if (bytesPerSecond) {
        const pause = bytes / bytesPerSecond * 1000 - (Date.now() - started);
        if (pause > 0) await delay(pause, undefined, { signal });
      }
      progress(bytes);
      yield chunk;
    }
  }
  try {
    await pipeline(verifiedChunks(), createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
    if (bytes !== asset.bytes) throw new Error(`Truncated resource: ${asset.fileName} (${bytes}/${asset.bytes} bytes)`);
    if (checksum.digest('hex') !== asset.checksum.value.toLowerCase()) throw new Error(`Checksum mismatch: ${asset.fileName}`);
    return { fileName: asset.fileName, bytes, sha256: sha256.digest('hex'), checksum: asset.checksum };
  } finally { source.destroy(); }
}

/** Never use archive names as paths. Only exact declared root files are written. */
export async function extractResourceAsset(
  archive: string, asset: Asset, resource: PipelineResource, destination: string,
  signal: AbortSignal, files: ResourceFiles, budget: { bytes: number },
) {
  const tar = extract();
  let header = Buffer.alloc(0), remaining = 0, entries = 0, zeroBlocks = 0;
  const names = new Set<string>();
  const guard = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    try {
      budget.bytes += chunk.length;
      if (budget.bytes > resource.maxExtractedBytes) throw new Error('Resource expanded size exceeds manifest limit');
      let offset = 0;
      while (offset < chunk.length) {
        if (remaining) { const skip = Math.min(remaining, chunk.length - offset); remaining -= skip; offset += skip; continue; }
        const take = Math.min(512 - header.length, chunk.length - offset);
        header = Buffer.concat([header, chunk.subarray(offset, offset + take)]); offset += take;
        if (header.length !== 512) continue;
        if (header.some(byte => byte !== 0)) {
          if (zeroBlocks) throw new Error('Unexpected data after tar end marker');
          if (++entries > 10_000 || ![0, 48, 53].includes(header[156])) throw new Error('Unsupported tar extension or special entry');
          const field = header.subarray(124, 136);
          let size: number;
          if (field[0] === 128) {
            const value = BigInt('0x' + field.subarray(1).toString('hex'));
            size = value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : Infinity;
          } else {
            const octal = field.toString('ascii');
            if (field.some(byte => byte > 127) || !/^ *[0-7]+[ \0]*$/.test(octal)) throw new Error('Unsupported tar size');
            size = parseInt(octal.trim(), 8);
          }
          if (!Number.isSafeInteger(size) || size > resource.maxExtractedBytes || (header[156] === 53 && size !== 0)) throw new Error('Invalid tar size');
          remaining = Math.ceil(size / 512) * 512;
        } else zeroBlocks++;
        header = Buffer.alloc(0);
      }
      callback(null, chunk);
    } catch (error) { callback(error as Error); }
  } });
  tar.on('entry', (entry, stream, next) => {
    void (async () => {
      const name = entry.name.replace(/^(\.\/)+/, '');
      if (name.startsWith('/') || name.includes('\\') || /[\x00-\x1f:]/.test(name) || name.split('/').includes('..') ||
          !['file', 'directory'].includes(entry.type) || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Unsafe resource archive entry');
      const key = name.normalize('NFC').toLowerCase();
      if (names.has(key)) throw new Error('Duplicate resource archive entry');
      names.add(key);
      if (resource.requiredFiles.includes(name)) {
        if (entry.type !== 'file' || entry.size === 0 || Object.hasOwn(files, name)) throw new Error(`Invalid or duplicate resource file: ${name}`);
        if (resource.fileSizes?.[name] !== undefined && entry.size !== resource.fileSizes[name]) throw new Error(`Resource file size does not match manifest: ${name}`);
        const hash = createHash('sha256');
        const meter = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } });
        await pipeline(stream, meter, createWriteStream(path.join(destination, name), { flags: 'wx', mode: 0o600 }), { signal });
        files[name] = { bytes: entry.size, sha256: hash.digest('hex') };
      } else {
        // Drain ancillary data without writing it to disk.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of stream) signal.throwIfAborted();
      }
    })().then(() => next(), error => tar.destroy(error as Error));
  });
  if (asset.format === 'tar.gz') await pipeline(createReadStream(archive), createGunzip(), guard, tar, { signal });
  else await pipeline(createReadStream(archive), guard, tar, { signal });
  if (remaining || header.length || zeroBlocks < 2) throw new Error('Truncated resource archive');
}

export async function validateResourceDirectory(resource: PipelineResource, directory: string): Promise<{ bytes: number; files: ResourceFiles }> {
  if (!path.isAbsolute(directory) || /[\x00-\x1f]/.test(directory)) throw new Error('Resource directory must be an absolute path');
  directory = path.resolve(directory);
  const root = await fs.lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Resource path must be a real directory, not an archive or symlink');
  let bytes = 0;
  const files: ResourceFiles = {};
  for (const name of resource.requiredFiles) {
    const file = await fs.lstat(path.join(directory, name)).catch(() => null);
    if (!file?.isFile() || file.isSymbolicLink() || file.size <= 0) throw new Error(`Missing or invalid resource file: ${name}`);
    if (resource.fileSizes?.[name] !== undefined && file.size !== resource.fileSizes[name]) throw new Error(`Incomplete or wrong-version resource file: ${name} (${file.size}/${resource.fileSizes[name]} bytes)`);
    bytes += file.size; files[name] = { bytes: file.size };
  }
  if (bytes > resource.maxExtractedBytes) throw new Error('Resource directory exceeds manifest size limit');
  return { bytes, files };
}
