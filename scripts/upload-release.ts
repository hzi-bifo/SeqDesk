#!/usr/bin/env npx tsx
/**
 * Upload a SeqDesk release to Vercel Blob storage and publish to seqdesk.com
 *
 * Usage:
 *   npx tsx scripts/upload-release.ts <version> [options]
 *
 * Options:
 *   --title "Title"           Release title
 *   --notes "Release notes"   Short release notes
 *   --changelog "item1" "item2"  Detailed changelog items
 *
 * Examples:
 *   npx tsx scripts/upload-release.ts 0.1.5
 *   npx tsx scripts/upload-release.ts 0.1.5 --title "Update System" --notes "Bug fixes and improvements"
 *   npx tsx scripts/upload-release.ts 0.1.5 --changelog "Added feature X" "Fixed bug Y" "Improved Z"
 *
 * Requires in .env:
 *   BLOB_READ_WRITE_TOKEN - Vercel Blob token
 *   ADMIN_SECRET - Admin secret for publishing
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

// Load .env file if exists
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([^#=]+)=["']?(.+?)["']?$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  }
}

interface ReleaseOptions {
  version: string;
  title?: string;
  notes?: string;
  changelog?: string[];
}

function getTarballPackageVersion(tarballPath: string, expectedVersion: string): string {
  const packageJsonPath = `seqdesk-${expectedVersion}/package.json`;
  const command = `tar -xOzf ${JSON.stringify(tarballPath)} ${JSON.stringify(packageJsonPath)}`;

  let packageJson: string;
  try {
    packageJson = execSync(command, { encoding: "utf8" });
  } catch (error) {
    throw new Error(
      `Could not read package.json from tarball: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  try {
    const parsed = JSON.parse(packageJson);
    const packageVersion = typeof parsed.version === "string" ? parsed.version : "";
    if (!packageVersion) {
      throw new Error("package.json is missing a version field");
    }
    return packageVersion;
  } catch (error) {
    throw new Error(
      `Invalid package.json in tarball: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

function parseArgs(): ReleaseOptions {
  const args = process.argv.slice(2);
  const options: ReleaseOptions = {
    version: "",
    changelog: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const flag = arg.slice(2);
      if (flag === "title" && args[i + 1]) {
        options.title = args[++i];
      } else if (flag === "notes" && args[i + 1]) {
        options.notes = args[++i];
      } else if (flag === "changelog") {
        // Collect all following args until next flag
        i++;
        while (i < args.length && !args[i].startsWith("--")) {
          options.changelog!.push(args[i]);
          i++;
        }
        continue;
      }
    } else if (!options.version) {
      options.version = arg;
    }
    i++;
  }

  return options;
}

async function uploadToBlob(
  filePath: string,
  blobPath: string,
  token: string
): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);

  const response = await fetch(`https://blob.vercel-storage.com/${blobPath}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/gzip",
      "x-api-version": "7",
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${response.status} ${text}`);
  }

  const result = await response.json();
  return result.url;
}

async function publishRelease(
  release: {
    version: string;
    downloadUrl: string;
    checksum: string;
    size: number;
    title?: string;
    releaseNotes?: string;
    changelog?: string[];
  },
  adminSecret: string
): Promise<void> {
  const response = await fetch("https://www.seqdesk.com/api/releases/publish", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: release.version,
      channel: "stable",
      releaseDate: new Date().toISOString().split("T")[0],
      downloadUrl: release.downloadUrl,
      checksum: `sha256:${release.checksum}`,
      minNodeVersion: "18.0.0",
      title: release.title || `SeqDesk v${release.version}`,
      releaseNotes: release.releaseNotes || `SeqDesk v${release.version}`,
      changelog: release.changelog || [],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Publish failed: ${response.status} ${text}`);
  }

  const result = await response.json();
  console.log(`  Published: ${result.blobUrl || "success"}`);
}

async function main() {
  loadEnv();

  const options = parseArgs();

  if (!options.version) {
    console.error("Usage: npx tsx scripts/upload-release.ts <version> [options]");
    console.error("");
    console.error("Options:");
    console.error('  --title "Title"           Release title');
    console.error('  --notes "Release notes"   Short release notes');
    console.error('  --changelog "item1" "item2"  Detailed changelog items');
    console.error("");
    console.error("Example:");
    console.error(
      '  npx tsx scripts/upload-release.ts 0.1.6 --title "Bug Fixes" --changelog "Fixed X" "Improved Y"'
    );
    process.exit(1);
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error("Error: BLOB_READ_WRITE_TOKEN not found");
    console.error("Add it to your .env file or set it as an environment variable");
    process.exit(1);
  }

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    console.error("Error: ADMIN_SECRET not found");
    console.error("Add it to your .env file for publishing to seqdesk.com");
    process.exit(1);
  }

  const tarballPath = `seqdesk-${options.version}.tar.gz`;
  if (!fs.existsSync(tarballPath)) {
    console.error(`Error: ${tarballPath} not found`);
    console.error("Build the release first with: npm run build");
    process.exit(1);
  }

  // Calculate checksum
  const fileBuffer = fs.readFileSync(tarballPath);
  const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const size = fs.statSync(tarballPath).size;
  const tarballVersion = getTarballPackageVersion(tarballPath, options.version);

  if (tarballVersion !== options.version) {
    throw new Error(
      `Tarball version mismatch: expected ${options.version}, found ${tarballVersion}. Rebuild the tarball before publishing.`
    );
  }

  console.log(`Uploading SeqDesk v${options.version}`);
  console.log(`  File: ${tarballPath}`);
  console.log(`  Size: ${(size / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  Checksum: ${checksum}`);
  if (options.title) console.log(`  Title: ${options.title}`);
  if (options.changelog?.length)
    console.log(`  Changelog: ${options.changelog.length} items`);
  console.log("");

  try {
    // Upload tarball
    console.log("Uploading tarball to Vercel Blob...");
    const downloadUrl = await uploadToBlob(
      tarballPath,
      `releases/seqdesk-${options.version}.tar.gz`,
      token
    );
    console.log(`  Uploaded to: ${downloadUrl}`);

    // Publish to seqdesk.com
    console.log("Publishing to seqdesk.com...");
    await publishRelease(
      {
        version: options.version,
        downloadUrl,
        checksum,
        size,
        title: options.title,
        releaseNotes: options.notes,
        changelog: options.changelog,
      },
      adminSecret
    );

    console.log("");
    console.log(`Successfully released SeqDesk v${options.version}`);
    console.log(`Download URL: ${downloadUrl}`);
  } catch (error) {
    console.error("Upload failed:", error);
    process.exit(1);
  }
}

main();
