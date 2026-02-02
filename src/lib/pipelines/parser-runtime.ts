/**
 * Parser Runtime
 *
 * Executes parsers defined in pipeline packages to extract structured data
 * from pipeline output files (TSV, CSV, JSON).
 *
 * Used by the generic adapter to enrich discovered outputs with metadata
 * (e.g., bin completeness from CheckM, taxonomy from GTDB-Tk).
 */

import fs from 'fs/promises';
import path from 'path';
import { getPackage, type ParserConfig } from './package-loader';

/**
 * Simple glob implementation for finding files matching a pattern
 * Supports ** for recursive matching and * for single directory level
 */
async function simpleGlob(pattern: string): Promise<string[]> {
  const matches: string[] = [];

  // Split pattern into directory and file parts
  const parts = pattern.split('/');
  const baseParts: string[] = [];
  let patternStart = 0;

  // Find the base directory (before any wildcards)
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].includes('*') || parts[i].includes('?') || parts[i].includes('{')) {
      patternStart = i;
      break;
    }
    baseParts.push(parts[i]);
    patternStart = i + 1;
  }

  const baseDir = baseParts.length > 0 ? baseParts.join('/') : '.';
  const filePattern = parts.slice(patternStart).join('/');

  // Convert glob pattern to regex
  const regexPattern = filePattern
    .replace(/\*\*/g, '{{RECURSIVE}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/{{RECURSIVE}}/g, '.*')
    // Expand brace patterns like {A,B} to regex alternation (A|B)
    .replace(/\{([^}]+)\}/g, (_, content) => `(${content.replace(/,/g, '|')})`);

  const regex = new RegExp(`^${regexPattern}$`);

  // Recursively find matching files
  async function findFiles(dir: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        const entryRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await findFiles(entryPath, entryRelative);
        } else if (regex.test(entryRelative)) {
          matches.push(entryPath);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  try {
    const baseStat = await fs.stat(baseDir);
    if (baseStat.isDirectory()) {
      await findFiles(baseDir);
    }
  } catch {
    // Base directory doesn't exist
  }

  return matches;
}

/**
 * A single parsed row with typed values
 */
export interface ParsedRow {
  [key: string]: string | number | boolean | null;
}

/**
 * Result of running a parser
 */
export interface ParsedData {
  /** Rows keyed by the first column value (typically the matchBy field) */
  rows: Map<string, ParsedRow>;
  /** Any errors encountered during parsing */
  errors: string[];
}

/**
 * Convert a string value to the specified type
 */
function convertValue(
  value: string,
  type?: 'string' | 'int' | 'float' | 'boolean'
): string | number | boolean | null {
  if (value === '' || value === 'NA' || value === 'N/A' || value === 'null') {
    return null;
  }

  switch (type) {
    case 'int': {
      const num = parseInt(value, 10);
      return isNaN(num) ? null : num;
    }
    case 'float': {
      const num = parseFloat(value);
      return isNaN(num) ? null : num;
    }
    case 'boolean': {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') return true;
      if (lower === 'false' || lower === '0' || lower === 'no') return false;
      return null;
    }
    case 'string':
    default:
      return value;
  }
}

/**
 * Parse a TSV file using the parser configuration
 */
async function parseTsv(
  filePath: string,
  config: ParserConfig
): Promise<ParsedData> {
  const rows = new Map<string, ParsedRow>();
  const errors: string[] = [];

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    const startLine = config.parser.skipHeader ? 1 : 0;

    for (let i = startLine; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      const row: ParsedRow = {};

      for (const column of config.parser.columns) {
        if (column.index < cols.length) {
          row[column.name] = convertValue(cols[column.index], column.type);
        } else {
          row[column.name] = null;
        }
      }

      // Key by the first column (usually the identifier like bin_name)
      const keyColumn = config.parser.columns[0];
      const key = cols[keyColumn.index] ?? `row_${i}`;
      rows.set(key, row);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Failed to parse TSV file ${filePath}: ${message}`);
  }

  return { rows, errors };
}

/**
 * Parse a CSV file using the parser configuration
 */
async function parseCsv(
  filePath: string,
  config: ParserConfig
): Promise<ParsedData> {
  const rows = new Map<string, ParsedRow>();
  const errors: string[] = [];

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    const startLine = config.parser.skipHeader ? 1 : 0;

    for (let i = startLine; i < lines.length; i++) {
      // Simple CSV parsing (doesn't handle quoted fields with commas)
      const cols = lines[i].split(',');
      const row: ParsedRow = {};

      for (const column of config.parser.columns) {
        if (column.index < cols.length) {
          row[column.name] = convertValue(cols[column.index], column.type);
        } else {
          row[column.name] = null;
        }
      }

      const keyColumn = config.parser.columns[0];
      const key = cols[keyColumn.index] ?? `row_${i}`;
      rows.set(key, row);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Failed to parse CSV file ${filePath}: ${message}`);
  }

  return { rows, errors };
}

/**
 * Parse a JSON file using the parser configuration
 */
async function parseJson(
  filePath: string,
  config: ParserConfig
): Promise<ParsedData> {
  const rows = new Map<string, ParsedRow>();
  const errors: string[] = [];

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Assume data is an array of objects
    const items = Array.isArray(data) ? data : [data];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row: ParsedRow = {};

      for (const column of config.parser.columns) {
        // For JSON, use column name as the key to look up
        const value = item[column.name];
        if (value !== undefined) {
          row[column.name] = convertValue(String(value), column.type);
        } else {
          row[column.name] = null;
        }
      }

      // Key by the first column value
      const keyColumn = config.parser.columns[0];
      const key = item[keyColumn.name] ?? `row_${i}`;
      rows.set(String(key), row);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Failed to parse JSON file ${filePath}: ${message}`);
  }

  return { rows, errors };
}

/**
 * Run a single parser on the pipeline output directory
 *
 * @param packageId - The pipeline package ID
 * @param parserId - The parser ID to run
 * @param outputDir - The pipeline output directory
 * @returns Parsed data with rows keyed by the first column
 */
export async function runParser(
  packageId: string,
  parserId: string,
  outputDir: string
): Promise<ParsedData> {
  const pkg = getPackage(packageId);
  if (!pkg) {
    return { rows: new Map(), errors: [`Package not found: ${packageId}`] };
  }

  const parserConfig = pkg.parsers.get(parserId);
  if (!parserConfig) {
    return { rows: new Map(), errors: [`Parser not found: ${parserId}`] };
  }

  // Find file matching the trigger pattern
  const pattern = parserConfig.parser.trigger.filePattern;
  const searchPath = path.join(outputDir, pattern);

  try {
    const matches = await simpleGlob(searchPath);

    if (matches.length === 0) {
      // No file found - this is not necessarily an error
      // (e.g., CheckM might not have run if bin QC was skipped)
      return { rows: new Map(), errors: [] };
    }

    // Use the first match
    const filePath = matches[0];

    // Parse based on type
    switch (parserConfig.parser.type) {
      case 'tsv':
        return parseTsv(filePath, parserConfig);
      case 'csv':
        return parseCsv(filePath, parserConfig);
      case 'json':
        return parseJson(filePath, parserConfig);
      default:
        return {
          rows: new Map(),
          errors: [`Unknown parser type: ${parserConfig.parser.type}`],
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { rows: new Map(), errors: [`Glob failed for ${pattern}: ${message}`] };
  }
}

/**
 * Run all parsers for a package on the output directory
 *
 * @param packageId - The pipeline package ID
 * @param outputDir - The pipeline output directory
 * @returns Map of parser ID to parsed data
 */
export async function runAllParsers(
  packageId: string,
  outputDir: string
): Promise<Map<string, ParsedData>> {
  const results = new Map<string, ParsedData>();

  const pkg = getPackage(packageId);
  if (!pkg) {
    return results;
  }

  // Run all parsers in parallel
  const parserIds = Array.from(pkg.parsers.keys());
  const parserPromises = parserIds.map(async (parserId) => {
    const data = await runParser(packageId, parserId, outputDir);
    return { parserId, data };
  });

  const parserResults = await Promise.all(parserPromises);

  for (const { parserId, data } of parserResults) {
    results.set(parserId, data);
  }

  return results;
}
