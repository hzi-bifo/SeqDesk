import { db } from "@/lib/db";

export interface SequencingFilesConfig {
  allowedExtensions: string[];
  scanDepth: number;
  ignorePatterns: string[];
  allowSingleEnd: boolean;
  autoAssign: boolean;
}

const DEFAULT_CONFIG: SequencingFilesConfig = {
  allowedExtensions: [".fastq.gz", ".fq.gz", ".fastq", ".fq"],
  scanDepth: 2,
  ignorePatterns: ["**/tmp/**", "**/undetermined/**"],
  allowSingleEnd: true,
  autoAssign: false,
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

  return {
    dataBasePath: settings?.dataBasePath || null,
    config,
  };
}
