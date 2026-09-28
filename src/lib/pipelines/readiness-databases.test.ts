import { describe, expect, it } from 'vitest';

import { PIPELINE_REGISTRY } from './registry';
import { databaseSettingWords, missingDatabaseSettings } from './readiness-databases';

const of = (id: string, storedConfig: Record<string, unknown> = {}) => {
  const definition = PIPELINE_REGISTRY[id];
  return missingDatabaseSettings({ pipelineId: id, configSchema: definition.configSchema, defaultConfig: definition.defaultConfig as Record<string, unknown>, storedConfig, executionMode: 'local' });
};

describe('databases a pipeline needs configured on the server', () => {
  it('Kraken2 without its database path is blocked, as the admin’s server page says (the study drawer offered Set up)', () => {
    const missing = of('kraken2-bracken');
    expect(missing).toEqual(['Kraken2 DB']);
    expect(databaseSettingWords(missing[0])).toBe('the Kraken2 database');
  });

  it('a pipeline without a database setting has none missing', () => {
    expect(of('fastqc')).toEqual([]);
    expect(of('reads-qc')).toEqual([]);
  });
});
