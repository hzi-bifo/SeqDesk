#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

function fail(message) {
  console.error(`serve-reviewer-candidate: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) {
      fail(`invalid argument near ${key}`);
    }
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = args.root ? path.resolve(args.root) : "";
const host = args.host || "127.0.0.1";
const port = Number(args.port);

if (!root || !fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  fail("--root must point to an existing directory");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail("--port must be an integer between 1 and 65535");
}

const contentTypes = new Map([
  [".json", "application/json; charset=utf-8"],
  [".sh", "text/x-shellscript; charset=utf-8"],
  [".gz", "application/gzip"],
  [".tgz", "application/gzip"],
  [".txt", "text/plain; charset=utf-8"],
]);

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", `http://${host}`).pathname);
  } catch {
    response.writeHead(400).end("bad request\n");
    return;
  }

  const relative = pathname.replace(/^\/+/, "");
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end("forbidden\n");
    return;
  }

  const stat = fs.statSync(target, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    response.writeHead(404).end("not found\n");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": stat.size,
    "content-type": contentTypes.get(path.extname(target)) || "application/octet-stream",
  });
  fs.createReadStream(target).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Serving reviewer candidate files from ${root} at http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; stopping reviewer candidate server`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
