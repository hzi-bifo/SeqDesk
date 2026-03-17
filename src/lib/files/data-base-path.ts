import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { db } from "@/lib/db";
import { loadConfig } from "@/lib/config/loader";
import type { ConfigSource } from "@/lib/config/types";

export type DataBasePathSource = ConfigSource | "local-dev" | "none";

export interface ResolvedDataBasePath {
  dataBasePath: string | null;
  source: DataBasePathSource;
  isImplicit: boolean;
}

function resolveLocalDevDataBasePath(): string | null {
  if (os.platform() !== "darwin") {
    return null;
  }

  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  const candidates = [
    process.env.SEQDESK_LOCAL_TESTDATA_PATH?.trim(),
    path.join(os.homedir(), "testdata"),
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.length > 0));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Ignore invalid local fallback candidates.
    }
  }

  return null;
}

export function resolveDataBasePathFromStoredValue(
  storedDataBasePath: string | null | undefined
): ResolvedDataBasePath {
  const loadedConfig = loadConfig();
  const configured = loadedConfig.config.site?.dataBasePath?.trim();
  const configuredSource = loadedConfig.sources["site.dataBasePath"] ?? "default";

  if (configured && (configuredSource === "env" || configuredSource === "file")) {
    return {
      dataBasePath: configured,
      source: configuredSource,
      isImplicit: false,
    };
  }

  const stored = storedDataBasePath?.trim();
  if (stored) {
    return {
      dataBasePath: stored,
      source: "database",
      isImplicit: false,
    };
  }

  const localDev = resolveLocalDevDataBasePath();
  if (localDev) {
    return {
      dataBasePath: localDev,
      source: "local-dev",
      isImplicit: true,
    };
  }

  return {
    dataBasePath: null,
    source: "none",
    isImplicit: false,
  };
}

export async function getResolvedDataBasePath(): Promise<ResolvedDataBasePath> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { dataBasePath: true },
  });

  return resolveDataBasePathFromStoredValue(settings?.dataBasePath);
}
