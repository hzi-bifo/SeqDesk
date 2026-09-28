/**
 * The reference databases a pipeline needs configured on the server (a Kraken2 database path, a MetaPhlAn index):
 * settings of the "databases" group the admin sets once. The admin's server page lists them as "Database
 * configuration"; the study's readiness must say the same, or a member is offered "Set up" for a run that fails at
 * its first step for want of the database.
 */
import { extendConfigSchemaWithTechnologyAllowlist, extendDefaultConfigWithTechnologyAllowlist, validateManagedPipelineConfig } from './pipeline-readiness-service';
import type { PipelineConfigSchema } from './types';

export function missingDatabaseSettings(input: {
  pipelineId: string;
  configSchema: PipelineConfigSchema;
  defaultConfig: Record<string, unknown>;
  storedConfig: Record<string, unknown>;
  executionMode: 'local' | 'slurm';
}): string[] {
  const schema = extendConfigSchemaWithTechnologyAllowlist(input.configSchema);
  const config = { ...extendDefaultConfigWithTechnologyAllowlist(input.defaultConfig as never), ...input.storedConfig };
  const { missingFields } = validateManagedPipelineConfig({ pipelineId: input.pipelineId, schema, config, executionMode: input.executionMode });
  return missingFields.filter((label) => Object.entries(schema.properties).some(([key, property]) => (property.title || key) === label && property['x-seqdesk']?.group === 'databases'));
}

/** "Kraken2 DB" → "the Kraken2 database", for the readiness line. */
export const databaseSettingWords = (label: string) => `the ${label.replace(/\s+(?:DB|database)$/i, '')} database`;
