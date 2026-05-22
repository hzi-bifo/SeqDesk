import { spawn } from 'child_process';
import type { DiscoverOutputsResult, SamplesheetResult } from './adapters/types';
import type { PipelineTarget } from './types';

export interface DiscoverOutputsScriptPayload {
  packageId: string;
  runId: string;
  outputDir: string;
  target?: PipelineTarget;
  samples: Array<{
    id: string;
    sampleId: string;
  }>;
}

export interface SamplesheetScriptPayload {
  packageId: string;
  target?: PipelineTarget;
  dataBasePath: string;
  config: Record<string, unknown>;
  samples: Array<{
    id: string;
    sampleId: string;
    reads: Array<{
      id: string;
      file1: string | null;
      file2: string | null;
      dataClass?: string | null;
      isActive?: boolean | null;
    }>;
    order?: {
      id?: string | null;
      platform?: string | null;
      customFields?: string | null;
    } | null;
  }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDiscoverOutputsResult(value: unknown): value is DiscoverOutputsResult {
  if (!isObject(value)) return false;
  if (!Array.isArray(value.files) || !Array.isArray(value.errors) || !isObject(value.summary)) {
    return false;
  }

  return (
    typeof value.summary.assembliesFound === 'number' &&
    typeof value.summary.binsFound === 'number' &&
    typeof value.summary.artifactsFound === 'number' &&
    typeof value.summary.reportsFound === 'number'
  );
}

function isSamplesheetResult(value: unknown): value is SamplesheetResult {
  return (
    isObject(value) &&
    typeof value.content === 'string' &&
    typeof value.sampleCount === 'number' &&
    Array.isArray(value.errors)
  );
}

export async function runDiscoverOutputsScript(
  scriptPath: string,
  payload: DiscoverOutputsScriptPayload
): Promise<DiscoverOutputsResult> {
  return new Promise<DiscoverOutputsResult>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Discover outputs script failed with exit code ${code}: ${stderr.trim() || stdout.trim() || 'No output'}`
          )
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as unknown;
        if (!isDiscoverOutputsResult(parsed)) {
          reject(new Error('Discover outputs script returned an invalid payload'));
          return;
        }

        resolve(parsed);
      } catch (error) {
        reject(
          new Error(
            `Failed to parse discover outputs script response: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          )
        );
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function runSamplesheetScript(
  scriptPath: string,
  payload: SamplesheetScriptPayload
): Promise<SamplesheetResult> {
  return new Promise<SamplesheetResult>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Samplesheet script failed with exit code ${code}: ${stderr.trim() || stdout.trim() || 'No output'}`
          )
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as unknown;
        if (!isSamplesheetResult(parsed)) {
          reject(new Error('Samplesheet script returned an invalid payload'));
          return;
        }

        resolve(parsed);
      } catch (error) {
        reject(
          new Error(
            `Failed to parse samplesheet script response: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          )
        );
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
