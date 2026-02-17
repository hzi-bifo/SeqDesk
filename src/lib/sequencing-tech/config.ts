import fs from "fs";
import path from "path";
import {
  DEFAULT_TECH_CONFIG,
  FlowCell,
  SequencingDevicesFile,
  SequencingKit,
  SequencingSoftware,
  SequencerDevice,
  SequencingTechConfig,
} from "@/types/sequencing-technology";

const DEFAULTS_PATH = path.join(
  process.cwd(),
  "data",
  "sequencing-technologies",
  "defaults.json"
);
const DEVICES_DIR = path.join(process.cwd(), "data", "sequencing-devices");
const USE_LOCAL_DEFAULTS = process.env.SEQDESK_USE_LOCAL_TECH_DEFAULTS === "true";

function mergeById<T extends { id: string }>(
  base: T[],
  incoming: T[],
  label: string
): T[] {
  const map = new Map<string, T>();
  for (const item of base) {
    map.set(item.id, item);
  }
  for (const item of incoming) {
    if (map.has(item.id)) {
      console.warn(`Duplicate ${label} id '${item.id}' in sequencing devices defaults.`);
    }
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

function loadDevicesFromFiles(): {
  devices: SequencerDevice[];
  flowCells: FlowCell[];
  kits: SequencingKit[];
  software: SequencingSoftware[];
} {
  if (!fs.existsSync(DEVICES_DIR)) {
    return { devices: [], flowCells: [], kits: [], software: [] };
  }

  const devices: SequencerDevice[] = [];
  const flowCells: FlowCell[] = [];
  const kits: SequencingKit[] = [];
  const software: SequencingSoftware[] = [];

  const files = fs
    .readdirSync(DEVICES_DIR)
    .filter((file) => file.endsWith(".json"));

  for (const file of files) {
    const filePath = path.join(DEVICES_DIR, file);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as SequencingDevicesFile;
      const platformId = parsed.platformId;

      const fileDevices = (parsed.devices || []).map((device) => ({
        ...device,
        platformId: device.platformId || platformId,
      }));

      devices.push(...fileDevices);
      flowCells.push(...(parsed.flowCells || []));
      kits.push(...(parsed.kits || []));
      software.push(...(parsed.software || []));
    } catch (error) {
      console.warn(`Failed to parse sequencing devices file: ${filePath}`, error);
    }
  }

  return { devices, flowCells, kits, software };
}

export function normalizeTechConfig(
  config: SequencingTechConfig,
  defaults: SequencingTechConfig = DEFAULT_TECH_CONFIG
): SequencingTechConfig {
  return {
    ...defaults,
    ...config,
    technologies: Array.isArray(config.technologies)
      ? config.technologies
      : defaults.technologies,
    devices: Array.isArray(config.devices)
      ? config.devices
      : defaults.devices || [],
    flowCells: Array.isArray(config.flowCells)
      ? config.flowCells
      : defaults.flowCells || [],
    kits: Array.isArray(config.kits) ? config.kits : defaults.kits || [],
    software: Array.isArray(config.software)
      ? config.software
      : defaults.software || [],
    categories: config.categories ?? defaults.categories,
    version: config.version ?? defaults.version,
  };
}

export function loadDefaultTechConfig(): SequencingTechConfig {
  if (!USE_LOCAL_DEFAULTS) {
    return { ...DEFAULT_TECH_CONFIG };
  }

  let baseConfig: SequencingTechConfig = DEFAULT_TECH_CONFIG;

  try {
    const fileContent = fs.readFileSync(DEFAULTS_PATH, "utf-8");
    baseConfig = JSON.parse(fileContent) as SequencingTechConfig;
  } catch (error) {
    console.error("Error loading defaults file:", error);
  }

  const normalizedBase = normalizeTechConfig(baseConfig);
  const deviceData = loadDevicesFromFiles();

  return normalizeTechConfig({
    ...normalizedBase,
    devices: mergeById(normalizedBase.devices || [], deviceData.devices, "device"),
    flowCells: mergeById(normalizedBase.flowCells || [], deviceData.flowCells, "flow cell"),
    kits: mergeById(normalizedBase.kits || [], deviceData.kits, "kit"),
    software: mergeById(normalizedBase.software || [], deviceData.software, "software"),
  });
}

export function parseTechConfig(
  configJson: unknown
): SequencingTechConfig {
  const defaults = loadDefaultTechConfig();
  if (!configJson) {
    return defaults;
  }
  try {
    if (typeof configJson === "string") {
      const parsed = JSON.parse(configJson) as SequencingTechConfig;
      return normalizeTechConfig(parsed, defaults);
    }

    if (typeof configJson === "object" && configJson !== null) {
      const parsed = configJson as SequencingTechConfig;
      return normalizeTechConfig(parsed, defaults);
    }

    return defaults;
  } catch {
    return defaults;
  }
}
