import { describe, expect, it } from 'vitest';

import { PIPELINE_FILE_CSP, pipelineFileToken, readPipelineFileToken, withStorageShim } from './pipeline-file-link';

const SECRET = 's'.repeat(48);

describe('a link to one pipeline output file', () => {
  it('names one run and one file and expires', () => {
    const now = 1_790_000_000_000;
    const token = pipelineFileToken(SECRET, 'run1', 'art1', now);
    expect(readPipelineFileToken(SECRET, token, now + 60_000)).toEqual({ runId: 'run1', artifactId: 'art1' });
    expect(readPipelineFileToken(SECRET, token, now + 5 * 60_000 + 1)).toBeNull();
    // Another secret, another file, a changed expiry: refused.
    expect(readPipelineFileToken('t'.repeat(48), token, now)).toBeNull();
    const [run, , expires, sig] = token.split('.');
    expect(readPipelineFileToken(SECRET, `${run}.art2.${expires}.${sig}`, now)).toBeNull();
    expect(readPipelineFileToken(SECRET, `${run}.art1.${Number(expires) + 1}.${sig}`, now)).toBeNull();
    expect(readPipelineFileToken(SECRET, 'garbage', now)).toBeNull();
    expect(() => pipelineFileToken(SECRET, '../x', 'art1')).toThrow();
  });
  it('serves a report sandboxed, with an in-memory storage for its settings', () => {
    expect(PIPELINE_FILE_CSP).toMatch(/^sandbox allow-scripts allow-popups;/);
    expect(PIPELINE_FILE_CSP).not.toMatch(/allow-same-origin/);
    expect(withStorageShim('<html><head><title>MultiQC</title></head></html>')).toMatch(/^<html><head><script>\(function\(\)\{function S\(\)/);
  });
});
