import { NextResponse } from "next/server";
import { loadDefaultTechConfig } from "@/lib/sequencing-tech/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = loadDefaultTechConfig();

  const technologies = (config.technologies || [])
    .filter((tech) => tech.available && !tech.comingSoon)
    .sort((a, b) => a.order - b.order);

  const devices = (config.devices || [])
    .filter((device) => device.available && !device.comingSoon)
    .sort((a, b) => a.order - b.order);

  const flowCells = (config.flowCells || []).filter((cell) => cell.available);
  const kits = (config.kits || []).filter((kit) => kit.available);
  const software = (config.software || []).filter((tool) => tool.available);

  const featuredDevices = devices.slice(0, 4).map((device) => {
    const platformName =
      technologies.find((tech) => tech.id === device.platformId)?.name ||
      device.platformId ||
      "Unknown platform";
    return {
      id: device.id,
      name: device.name,
      platformId: device.platformId,
      platformName,
      manufacturer: device.manufacturer,
      shortDescription: device.shortDescription,
      image: device.image,
    };
  });

  return NextResponse.json({
    counts: {
      technologies: technologies.length,
      devices: devices.length,
      flowCells: flowCells.length,
      kits: kits.length,
      software: software.length,
    },
    featuredDevices,
    technologies: technologies.map((tech) => ({
      id: tech.id,
      name: tech.name,
      manufacturer: tech.manufacturer,
    })),
    updatedAt: new Date().toISOString(),
    source: "defaults",
  });
}
