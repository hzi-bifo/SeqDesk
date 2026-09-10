import { db } from "@/lib/db";
import { parseTechConfig } from "@/lib/sequencing-tech/config";
import { parseSequencingMetadata } from "./input-metadata";

export async function loadSequencingTechnologyMap() {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });
  const extraSettings = parseSequencingMetadata(settings?.extraSettings);
  const config = parseTechConfig(extraSettings.sequencingTechConfig);
  return new Map(config.technologies.map((technology) => [technology.id, technology]));
}
