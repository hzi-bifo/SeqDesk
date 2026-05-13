import { describe, expect, it } from 'vitest';

import { parsePipelineArgs } from '../../../scripts/pipeline-cli';

describe('parsePipelineArgs', () => {
  it('parses run command targets, config, samples, execution, and json flags', () => {
    const parsed = parsePipelineArgs([
      'run',
      'metaxpath',
      '--dir',
      '/opt/seqdesk',
      '--study',
      'study-1',
      '--samples',
      'sample-1,sample-2',
      '--config-json',
      '{"threads":4}',
      '--execution',
      'slurm',
      '--watch',
      '--json',
      '--user-email',
      'admin@example.org',
    ]);

    expect(parsed.command).toBe('run');
    expect(parsed.positionals).toEqual(['metaxpath']);
    expect(parsed.dir).toBe('/opt/seqdesk');
    expect(parsed.json).toBe(true);
    expect(parsed.values).toMatchObject({
      study: 'study-1',
      samples: 'sample-1,sample-2',
      config_json: '{"threads":4}',
      execution: 'slurm',
      watch: true,
      user_email: 'admin@example.org',
    });
  });

  it('parses status watch command with inline dir syntax', () => {
    const parsed = parsePipelineArgs([
      'status',
      'run-1',
      '--dir=/srv/seqdesk',
      '--watch',
    ]);

    expect(parsed.command).toBe('status');
    expect(parsed.positionals).toEqual(['run-1']);
    expect(parsed.dir).toBe('/srv/seqdesk');
    expect(parsed.values.watch).toBe(true);
  });

  it('rejects unknown pipeline commands', () => {
    expect(() => parsePipelineArgs(['remove', 'run-1'])).toThrow(
      'Unknown pipeline command: remove'
    );
  });

  it('rejects options without values', () => {
    expect(() => parsePipelineArgs(['run', 'metaxpath', '--study'])).toThrow(
      '--study requires a value'
    );
  });
});
