import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getPipelineRegistrySources,
  normalizeRegistryPipeline,
  type RegistryApiResponse,
  type RegistryCategoryEntry,
  type StorePipelineResponse,
} from "@/lib/pipelines/store-sources";

export async function GET(_request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const registrySources = getPipelineRegistrySources();

  try {
    const responses = await Promise.all(
      registrySources.map(async (registry) => {
        const res = await fetch(registry.registryUrl, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Failed to fetch pipeline registry ${registry.registryUrl} (${res.status})`);
        }
        const data = (await res.json()) as RegistryApiResponse;
        return {
          registry,
          data,
        };
      })
    );

    const pipelines: StorePipelineResponse[] = [];
    const categoryMap = new Map<string, RegistryCategoryEntry>();

    for (const { registry, data } of responses) {
      for (const pipeline of data.pipelines || []) {
        pipelines.push(normalizeRegistryPipeline(pipeline, registry));
      }
      for (const category of data.categories || []) {
        if (!categoryMap.has(category.id)) {
          categoryMap.set(category.id, category);
        }
      }
    }

    return NextResponse.json({
      registries: registrySources,
      pipelines,
      categories: Array.from(categoryMap.values()),
      lastUpdated: responses
        .map((entry) => entry.data.lastUpdated)
        .filter((value): value is string => typeof value === "string")
        .sort()
        .at(-1),
      version: responses
        .map((entry) => entry.data.version)
        .filter((value): value is string => typeof value === "string")
        .at(0),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch pipeline registry", details: message },
      { status: 500 }
    );
  }
}
