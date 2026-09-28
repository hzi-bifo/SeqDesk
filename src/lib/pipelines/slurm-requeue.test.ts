import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { NEXTFLOW_NAME_FLAG, NEXTFLOW_REQUEUE_ARGS, nextflowRequeueBlock, refuseRequeueBlock } from './slurm-requeue';

const bash = (script: string, env: Record<string, string> = {}) => {
  try { return { out: execFileSync('bash', ['-c', `set -euo pipefail\n${script}`], { encoding: 'utf8', env: { ...process.env, ...env } }), code: 0 }; }
  catch (e) { return { out: String((e as { stdout?: string }).stdout ?? ''), code: (e as { status?: number }).status ?? 1 }; }
};

describe('a SLURM job that SLURM requeued', () => {
  const nextflow = `STDOUT_LOG=/dev/null\n${nextflowRequeueBlock("MAG-001-abc")}\nprintf '%s\\n' run x ${NEXTFLOW_NAME_FLAG} ${NEXTFLOW_REQUEUE_ARGS}`;
  it('Nextflow: the first run is unchanged; a restart resumes under a name of its own (one -name only)', () => {
    expect(bash(nextflow, { SLURM_JOB_ID: '99' }).out.trim().split('\n')).toEqual(['run', 'x', '-name', 'MAG-001-abc']);
    expect(bash(nextflow, { SLURM_JOB_ID: '99', SLURM_RESTART_COUNT: '2' }).out.trim().split('\n')).toEqual(['run', 'x', '-name', 'MAG-001-abc-j99-q2', '-resume']);
  });
  it('an ENA submission is never started twice', () => {
    const script = `STDERR_LOG=/dev/stdout\n${refuseRequeueBlock('the ENA submission')}\necho submitting`;
    expect(bash(script)).toEqual({ out: 'submitting\n', code: 0 });
    const again = bash(script, { SLURM_RESTART_COUNT: '1' });
    expect(again.code).toBe(75);
    expect(again.out).toMatch(/^SLURM requeued this job \(restart 1\); the ENA submission is not started again/);
    expect(again.out).not.toMatch(/submitting/);
  });
});
