import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { explainCondaFailure, explainLines, failedCondaCommand } from './conda-explain';

const FIXTURES = path.join(__dirname, '__fixtures__', 'elektra-slurm');
const run = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'runs.json'), 'utf8'))['conda-failed'];
// micromamba 2.9 on elektra, dry run of the same specs: its own words for why.
const solver = fs.readFileSync(path.join(FIXTURES, 'micromamba-dry-run-missing-package.txt'), 'utf8');

describe('why a conda environment could not be built', () => {
  it('finds the failed command in Nextflow’s log (whose message is empty: micromamba ran with --quiet)', () => {
    expect(failedCondaCommand(run.outputTail)).toEqual({ tool: 'micromamba', channels: ['conda-forge', 'bioconda'], specs: ['bioconda::fastqc=0.12.1', 'bioconda::no-such-package-seqdesk=9.9'] });
    expect(failedCondaCommand('ERROR ~ something else')).toBeNull();
  });
  it('keeps the solver’s reason lines', () => {
    expect(explainLines(solver)).toEqual(['The following package could not be installed', 'no-such-package-seqdesk =9.9 * does not exist (perhaps a typo or a missing channel).']);
  });
  it('asks the solver once as a dry run and keeps the answer next to the run', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'conda-explain-'));
    const calls: string[][] = [];
    const exec = async (file: string, args: string[]) => { calls.push([file, ...args]); return { stdout: '', stderr: solver }; };
    const lines = await explainCondaFailure(folder, run.outputTail, exec);
    expect(lines[1]).toMatch(/does not exist/);
    expect(calls[0].slice(0, 4)).toEqual(['micromamba', 'create', '--dry-run', '--yes']);
    expect(await explainCondaFailure(folder, run.outputTail, exec)).toEqual(lines);
    expect(calls).toHaveLength(1);
  });
});
