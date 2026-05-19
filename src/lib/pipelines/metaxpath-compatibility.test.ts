import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { LoadedPackage } from './package-loader';
import {
  checkMetaxPathPackageCompatibility,
  comparePackageVersions,
  getMetaxPathRuntimeWarnings,
} from './metaxpath-compatibility';

function makePackage(basePath: string, version: string): LoadedPackage {
  return {
    id: 'metaxpath',
    basePath,
    manifest: {
      package: {
        id: 'metaxpath',
        name: 'MetaxPath',
        version,
        description: 'Test package',
      },
      files: {
        definition: 'definition.json',
        registry: 'registry.json',
        samplesheet: 'samplesheet.yaml',
        parsers: [],
      },
      inputs: [],
      execution: {
        type: 'nextflow',
        pipeline: './workflow',
        version: 'Nextflow',
        profiles: ['conda'],
        defaultParams: {},
      },
      outputs: [],
    },
    definition: {
      pipeline: 'metaxpath',
      name: 'MetaxPath',
      description: 'Test package',
      version,
      steps: [],
      inputs: [],
      outputs: [],
    },
    registry: {
      id: 'metaxpath',
      name: 'MetaxPath',
      description: 'Test package',
      category: 'analysis',
      version,
      requires: {
        reads: true,
        assemblies: false,
        bins: false,
        checksums: false,
        studyAccession: false,
        sampleMetadata: false,
      },
      outputs: [],
      visibility: {
        showToUser: true,
        userCanStart: true,
      },
      input: {
        supportedScopes: ['study', 'samples'],
        minSamples: 1,
        perSample: {
          reads: true,
          pairedEnd: false,
          assemblies: false,
          bins: false,
        },
      },
      samplesheet: {
        format: 'csv',
        generator: 'internal',
      },
      configSchema: {
        type: 'object',
        properties: {},
      },
      defaultConfig: {},
      icon: 'beaker',
    },
    samplesheet: null,
    parsers: new Map(),
  };
}

describe('metaxpath compatibility', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaxpath-compat-'));
    await fs.mkdir(path.join(tempDir, 'workflow'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('compares semantic package versions', () => {
    expect(comparePackageVersions('0.1.0', '0.1.1')).toBeLessThan(0);
    expect(comparePackageVersions('v0.1.1', '0.1.1')).toBe(0);
    expect(comparePackageVersions('0.1.10', '0.1.1')).toBeGreaterThan(0);
    expect(comparePackageVersions('unknown', '0.1.1')).toBeNull();
  });

  it('blocks stale MetaxPath package versions and removed CLI flags', async () => {
    await fs.writeFile(
      path.join(tempDir, 'workflow', 'main.nf'),
      'metax profile \\\n  --chunk-breadth 0 \\\n',
      'utf8'
    );

    const result = await checkMetaxPathPackageCompatibility(
      makePackage(tempDir, '0.1.0')
    );

    expect(result.compatible).toBe(false);
    expect(result.issues).toEqual([
      expect.stringContaining('older than required 0.1.1'),
      expect.stringContaining('--chunk-breadth'),
    ]);
  });

  it('allows MetaxPath package 0.1.1 without removed CLI flags', async () => {
    await fs.writeFile(
      path.join(tempDir, 'workflow', 'main.nf'),
      'metax profile \\\n  -b 0 \\\n',
      'utf8'
    );

    const result = await checkMetaxPathPackageCompatibility(
      makePackage(tempDir, '0.1.1')
    );

    expect(result.compatible).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('allows packages that declare order support when starting order runs', async () => {
    await fs.writeFile(
      path.join(tempDir, 'workflow', 'main.nf'),
      'metax profile \\\n  -b 0 \\\n',
      'utf8'
    );
    const pkg = makePackage(tempDir, '0.1.1');
    pkg.registry.input.supportedScopes = ['order'];

    const result = await checkMetaxPathPackageCompatibility(pkg, {
      requiredTarget: 'order',
    });

    expect(result.compatible).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('blocks packages that do not declare the requested run target', async () => {
    await fs.writeFile(
      path.join(tempDir, 'workflow', 'main.nf'),
      'metax profile \\\n  -b 0 \\\n',
      'utf8'
    );
    const pkg = makePackage(tempDir, '0.1.1');
    pkg.registry.input.supportedScopes = ['order'];

    const result = await checkMetaxPathPackageCompatibility(pkg, {
      requiredTarget: 'study',
    });

    expect(result.compatible).toBe(false);
    expect(result.issues).toEqual([
      expect.stringContaining('does not declare study target support'),
    ]);
  });
});

describe('metaxpath runtime warnings', () => {
  it('warns for stale packages, unmapped PlusPF, and low PRED_VFS_AMRS memory', () => {
    const pkg = makePackage('/tmp/metaxpath', '0.1.3');
    const warnings = getMetaxPathRuntimeWarnings({
      manifest: pkg.manifest,
      config: {
        kraken2Db: '/shared/dbs/kraken2_pluspf_20230314',
        kraken2MemoryMapping: false,
        predVfsAmrsMemory: '64 GB',
      },
    });

    expect(warnings).toEqual([
      expect.stringContaining('predates the Kraken2 safe defaults in 0.1.4'),
      expect.stringContaining('PlusPF is configured without memory mapping'),
      expect.stringContaining('PRED_VFS_AMRS memory is 64 GB'),
    ]);
  });

  it('detects PlusPF and memory mapping from params file content', () => {
    const pkg = makePackage('/tmp/metaxpath', '0.1.4');
    const warnings = getMetaxPathRuntimeWarnings({
      manifest: pkg.manifest,
      config: {
        predVfsAmrsMemory: '96 GB',
      },
      paramsFileContent: [
        'kraken2_db: /shared/dbs/kraken2_pluspf_20230314',
        'kraken2_memory_mapping: false',
      ].join('\n'),
    });

    expect(warnings).toEqual([
      expect.stringContaining('PlusPF is configured without memory mapping'),
    ]);
  });

  it('does not warn for safe MetaxPath runtime defaults', () => {
    const pkg = makePackage('/tmp/metaxpath', '0.1.4');
    const warnings = getMetaxPathRuntimeWarnings({
      manifest: pkg.manifest,
      config: {
        kraken2Db: '/shared/dbs/kraken2_pluspf_20230314',
        kraken2MemoryMapping: true,
        predVfsAmrsMemory: '96 GB',
      },
    });

    expect(warnings).toEqual([]);
  });
});
