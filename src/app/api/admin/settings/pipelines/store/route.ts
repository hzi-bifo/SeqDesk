import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const STORE_BASE_URL = process.env.SEQDESK_PIPELINE_STORE_URL || 'https://seqdesk.com';
const REGISTRY_URL =
  process.env.SEQDESK_PIPELINE_REGISTRY_URL || `${STORE_BASE_URL}/api/registry`;
const BROWSE_URL =
  process.env.SEQDESK_PIPELINE_BROWSE_URL || `${STORE_BASE_URL}/pipelines`;
const PRIVATE_METAXPATH_ID = 'metaxpath';
const PRIVATE_METAXPATH_ENABLED = process.env.SEQDESK_METAXPATH_LISTING !== 'false';
const PRIVATE_METAXPATH_VERSION = process.env.SEQDESK_METAXPATH_VERSION || '0.1.0';
const DEFAULT_METAXPATH_PACKAGE_URL = 'https://www.seqdesk.com/private/metaxpath-0.1.0.tar.gz';
const PRIVATE_METAXPATH_PACKAGE_URL =
  process.env.SEQDESK_METAXPATH_PACKAGE_URL ||
  process.env.METAXPATH_PACKAGE_URL ||
  DEFAULT_METAXPATH_PACKAGE_URL;

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

    if (PRIVATE_METAXPATH_ENABLED && !pipelines.some((entry) => entry.id === PRIVATE_METAXPATH_ID)) {
      pipelines.push({
        id: PRIVATE_METAXPATH_ID,
        name: 'MetaxPath',
        description:
          'Private licensed metagenomic pathogen and resistance workflow package. Installation requires an access key.',
        category: 'metagenomics',
        version: PRIVATE_METAXPATH_VERSION,
        latestVersion: PRIVATE_METAXPATH_VERSION,
        versions: [{ version: PRIVATE_METAXPATH_VERSION }],
        author: 'hzi-bifo',
        downloads: 0,
        verified: true,
        icon: 'Dna',
        featured: false,
        tags: ['private', 'licensed', 'metagenomics'],
        isPrivate: true,
        licenseRequired: true,
        privateInstall: {
          requiresKey: true,
          packageUrlDefault: PRIVATE_METAXPATH_PACKAGE_URL || undefined,
          keyLabel: 'MetaxPath access key',
        },
      });

      if (!categories.some((category) => category?.id === 'metagenomics')) {
        categories.push({
          id: 'metagenomics',
          name: 'Metagenomics',
        });
      }
    }

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
