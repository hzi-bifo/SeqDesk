import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const STORE_BASE_URL = process.env.SEQDESK_PIPELINE_STORE_URL || 'https://seqdesk.com';
const REGISTRY_URL =
  process.env.SEQDESK_PIPELINE_REGISTRY_URL || `${STORE_BASE_URL}/api/registry`;
const BROWSE_URL =
  process.env.SEQDESK_PIPELINE_BROWSE_URL || `${STORE_BASE_URL}/pipelines`;

interface RegistryPipeline {
  id: string;
  name?: string;
  shortDescription?: string;
  description?: string;
  category?: string;
  tags?: string[];
  author?: string;
  provider?: string;
  latestVersion?: string;
  version?: string;
  versions?: Array<{ version: string; downloadUrl?: string }>;
  downloads?: number;
  rating?: number;
  verified?: boolean;
  icon?: string;
  featured?: boolean;
  downloadUrl?: string;
  isPrivate?: boolean;
  licenseRequired?: boolean;
  privateInstall?: {
    requiresKey?: boolean;
    packageUrlDefault?: string;
    keyLabel?: string;
  };
}

interface StorePipelineResponse {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  latestVersion: string;
  versions: Array<{ version: string; downloadUrl?: string }>;
  author: string;
  downloads: number;
  rating?: number;
  verified: boolean;
  icon: string;
  featured: boolean;
  downloadUrl?: string;
  tags: string[];
  isPrivate: boolean;
  licenseRequired: boolean;
  privateInstall?: {
    requiresKey?: boolean;
    packageUrlDefault?: string;
    keyLabel?: string;
  };
}

interface StoreCategoryResponse {
  id: string;
  name: string;
  description?: string;
}

function normalizePipeline(pipeline: RegistryPipeline): StorePipelineResponse {
  return {
    id: pipeline.id,
    name: pipeline.name || pipeline.id,
    description: pipeline.shortDescription || pipeline.description || '',
    category: pipeline.category || 'analysis',
    version: pipeline.latestVersion || pipeline.version || pipeline.versions?.[0]?.version || 'unknown',
    latestVersion: pipeline.latestVersion || pipeline.version || pipeline.versions?.[0]?.version || 'unknown',
    versions: pipeline.versions || [],
    author: pipeline.author || pipeline.provider || 'unknown',
    downloads: pipeline.downloads || 0,
    rating: pipeline.rating,
    verified: pipeline.verified || false,
    icon: pipeline.icon || 'pipeline',
    featured: pipeline.featured || false,
    downloadUrl: pipeline.downloadUrl,
    tags: pipeline.tags || [],
    isPrivate: pipeline.isPrivate === true,
    licenseRequired: pipeline.licenseRequired === true,
    privateInstall: pipeline.privateInstall,
  };
}

export async function GET(_request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'FACILITY_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const res = await fetch(REGISTRY_URL, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch pipeline registry', status: res.status },
        { status: 502 }
      );
    }

    const data = await res.json();
    const pipelines: StorePipelineResponse[] = Array.isArray(data?.pipelines)
      ? data.pipelines.map(normalizePipeline)
      : [];
    const categories: StoreCategoryResponse[] = Array.isArray(data?.categories)
      ? data.categories
          .filter(
            (category: unknown): category is StoreCategoryResponse =>
              typeof category === 'object' &&
              category !== null &&
              'id' in category &&
              typeof (category as { id?: unknown }).id === 'string' &&
              'name' in category &&
              typeof (category as { name?: unknown }).name === 'string'
          )
          .map((category: StoreCategoryResponse) => ({
            id: category.id,
            name: category.name,
            description: category.description,
          }))
      : [];

    return NextResponse.json({
      storeBaseUrl: STORE_BASE_URL,
      registryUrl: REGISTRY_URL,
      browseUrl: BROWSE_URL,
      pipelines,
      categories,
      lastUpdated: data?.lastUpdated,
      version: data?.version,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch pipeline registry', details: message },
      { status: 500 }
    );
  }
}
