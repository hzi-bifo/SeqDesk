import { db } from "@/lib/db";
import { resolveDataBasePathFromStoredValue } from "./data-base-path";

export interface SequencingFilesConfig {
  allowedExtensions: string[];
  scanDepth: number;
  ignorePatterns: string[];
  allowSingleEnd: boolean;
  autoAssign: boolean;
  simulationMode: "auto" | "synthetic" | "template";
  simulationTemplateDir: string;
}

const DEFAULT_CONFIG: SequencingFilesConfig = {
  allowedExtensions: [".fastq.gz", ".fq.gz", ".fastq", ".fq"],
  scanDepth: 2,
  ignorePatterns: ["**/tmp/**", "**/undetermined/**"],
  allowSingleEnd: true,
  autoAssign: false,
  simulationMode: "auto",
  simulationTemplateDir: "",
};

export async function getSequencingFilesConfig(): Promise<{
  dataBasePath: string | null;
  config: SequencingFilesConfig;
}> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { dataBasePath: true, extraSettings: true },
  });

  let config: SequencingFilesConfig = { ...DEFAULT_CONFIG };
  if (settings?.extraSettings) {
    try {
      const extra = JSON.parse(settings.extraSettings);
      if (extra.sequencingFiles) {
        config = {
          ...DEFAULT_CONFIG,
          ...extra.sequencingFiles,
          allowSingleEnd: true,
        };
      }
    } catch {
      // ignore parse errors
    }
  }

  const resolvedPath = resolveDataBasePathFromStoredValue(settings?.dataBasePath);

  return {
    dataBasePath: resolvedPath.dataBasePath,
    config,
  };
}
