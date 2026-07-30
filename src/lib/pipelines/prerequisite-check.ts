// Pipeline Prerequisite Checker
// Validates system requirements before running nf-core pipelines

import { exec } from 'child_process';
import { constants as fsConstants } from 'fs';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import {
  buildCondaRunArgs,
  resolveCondaEnvironmentReference,
} from './conda-environment';
import { detectRuntimePlatform, isMacOsArmRuntime } from './runtime-platform';

const execAsync = promisify(exec);

export interface PrerequisiteCheck {
  id: string;
  name: string;
  description: string;
  status: 'pass' | 'fail' | 'warning' | 'unchecked';
  message: string;
  details?: string;
  required: boolean;
}

export interface PrerequisiteResult {
  allPassed: boolean;
  requiredPassed: boolean;
  checks: PrerequisiteCheck[];
  summary: string;
}

interface ExecutionSettings {
  useSlurm: boolean;
  slurmQueue?: string;
  runtimeMode?: 'conda';
  condaPath?: string;
  condaEnv?: string;
  nextflowProfile?: string;
  pipelineRunDir: string;
  weblogUrl?: string;
  weblogSecret?: string;
}

const PIPELINE_RUNTIME_PREREQUISITE_TTL_MS = 15_000;
const pipelineRuntimePrerequisiteCache = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<PrerequisiteCheck[]>;
  }
>();

function getPipelineRuntimePrerequisiteCacheKey(
  executionSettings: ExecutionSettings
): string {
  return JSON.stringify({
    mode: executionSettings.useSlurm ? 'slurm' : 'local',
    slurmQueue: executionSettings.useSlurm
      ? executionSettings.slurmQueue?.trim() || ''
      : '',
    condaPath: executionSettings.condaPath?.trim() || '',
    condaEnv: resolveCondaEnvName(executionSettings.condaEnv),
  });
}

function resolveCondaEnvName(condaEnv?: string): string {
  return resolveCondaEnvironmentReference(condaEnv).value;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildCondaRunCommand(
  condaBin: string,
  condaEnv: string | undefined,
  command: readonly string[]
): string {
  return [
    shellQuote(condaBin),
    ...buildCondaRunArgs(condaEnv, command).map(shellQuote),
  ].join(' ');
}

function buildCondaActivationProbeCommand(
  condaBase: string,
  condaInitScript: string,
  condaEnv: string
): string {
  // Match the generated run.sh bootstrap in an isolated Bash process. All
  // user-configured values are positional arguments so neither a path nor an
  // environment prefix can be interpreted as shell syntax.
  const probeScript = [
    'set -euo pipefail',
    'export CONDA_BASE="$1"',
    'CONDA_SH="$2"',
    'CONDA_ENV="$3"',
    'export PATH="$CONDA_BASE/bin:$PATH"',
    'source "$CONDA_SH"',
    'conda activate "$CONDA_ENV"',
    'conda --version',
  ].join('; ');
  return [
    '/bin/bash',
    '-c',
    shellQuote(probeScript),
    'seqdesk-conda-readiness',
    shellQuote(condaBase),
    shellQuote(condaInitScript),
    shellQuote(condaEnv),
  ].join(' ');
}

function hasCondaEnv(envListOutput: string, envName: string): boolean {
  const reference = resolveCondaEnvironmentReference(envName);
  if (reference.kind === 'prefix') {
    const escapedPrefix = reference.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escapedPrefix}(\\s|$)`, 'm').test(
      envListOutput
    );
  }
  const escapedName = envName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const envNameRegex = new RegExp(`(^|\\s)${escapedName}(\\s|$)`, 'm');
  const envPathRegex = new RegExp(`[\\\\/]envs[\\\\/]${escapedName}(\\s|$)`, 'm');
  return envNameRegex.test(envListOutput) || envPathRegex.test(envListOutput);
}

async function condaEnvironmentExists(
  condaBin: string,
  condaEnv?: string
): Promise<boolean> {
  const reference = resolveCondaEnvironmentReference(condaEnv);
  if (reference.kind === 'prefix') {
    try {
      await fs.access(path.join(reference.value, 'conda-meta'));
      return true;
    } catch {
      // A prefix can still be registered by Conda even when the direct metadata
      // probe is unavailable to the current process. Fall through to env list.
    }
  }

  try {
    const { stdout } = await execAsync(`${shellQuote(condaBin)} env list`, {
      timeout: 10000,
    });
    return hasCondaEnv(stdout, reference.value);
  } catch {
    return false;
  }
}

async function resolveCondaBinary(condaPath?: string): Promise<string | null> {
  if (condaPath) {
    const possiblePaths = [
      path.join(condaPath, 'condabin', 'conda'),
      path.join(condaPath, 'bin', 'conda'),
    ];
    for (const candidate of possiblePaths) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Try next
      }
    }
  }

  try {
    await execAsync('which conda', { timeout: 5000 });
    return 'conda';
  } catch {
    return null;
  }
}

function extractExecErrorDetails(error: unknown): string {
  const err = error as { stdout?: string; stderr?: string; message?: string };
  return [err.stderr, err.stdout, err.message]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join('\n');
}

async function checkCondaTermsOfService(condaPath?: string): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'conda_tos',
    name: 'Conda Terms',
    description: 'Non-interactive runs require accepted Terms of Service for defaults channels',
    status: 'unchecked',
    message: '',
    required: false,
  };

  const condaBin = await resolveCondaBinary(condaPath);
  if (!condaBin) {
    check.status = 'warning';
    check.message = 'Conda not found';
    check.details = 'Cannot verify channel Terms of Service acceptance';
    return check;
  }

  const probeCommand = `${shellQuote(condaBin)} create --yes --quiet --dry-run --override-channels -c defaults python=3.11`;

  try {
    await execAsync(probeCommand, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    check.status = 'pass';
    check.message = 'Terms accepted for defaults channels';
    return check;
  } catch (error) {
    const details = extractExecErrorDetails(error);
    if (
      /CondaToSNonInteractiveError/i.test(details) ||
      /Terms of Service have not been accepted/i.test(details)
    ) {
      check.status = 'warning';
      check.message = 'Defaults channel blocked by Terms of Service';
      check.details = [
        'SeqDesk now configures Nextflow to use only conda-forge + bioconda.',
        'If you want to remove defaults globally, run:',
        `${condaBin} config --remove channels defaults`,
        `${condaBin} config --add channels conda-forge`,
        `${condaBin} config --add channels bioconda`,
      ].join('\n');
      return check;
    }

    if (
      /timed out|temporary failure|network|could not resolve|name or service not known|ssl|connection/i.test(
        details
      )
    ) {
      check.status = 'warning';
      check.message = 'Unable to verify Conda Terms (network issue)';
      check.details = details;
      return check;
    }

    check.status = 'warning';
    check.message = 'Unable to verify Conda Terms';
    check.details = details || 'Unknown error';
    return check;
  }
}

async function checkCondaChannels(condaPath?: string): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'conda_channels',
    name: 'Conda Channels',
    description: 'nf-core requires conda-forge before bioconda',
    status: 'unchecked',
    message: '',
    required: false,
  };

  // Resolve conda binary
  let condaBin = '';
  if (condaPath) {
    const possiblePaths = [
      path.join(condaPath, 'condabin', 'conda'),
      path.join(condaPath, 'bin', 'conda'),
    ];
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        condaBin = p;
        break;
      } catch {
        // Try next
      }
    }
  }

  if (!condaBin) {
    try {
      await execAsync('which conda', { timeout: 5000 });
      condaBin = 'conda';
    } catch {
      check.status = 'warning';
      check.message = 'Conda not found';
      check.details = 'Cannot verify channel order';
      return check;
    }
  }

  try {
    const { stdout } = await execAsync(
      `${shellQuote(condaBin)} config --show channels`,
      { timeout: 10000 }
    );
    const lines = stdout.split('\n');
    const channels: string[] = [];
    let inChannels = false;
    for (const line of lines) {
      if (line.trim().startsWith('channels:')) {
        inChannels = true;
        continue;
      }
      if (inChannels) {
        const match = line.match(/-\s+(\S+)/);
        if (match) {
          channels.push(match[1]);
        } else if (line.trim() && !line.startsWith(' ')) {
          break;
        }
      }
    }

    if (channels.length === 0) {
      check.status = 'warning';
      check.message = 'No conda channels found';
      check.details = 'Run: conda config --add channels conda-forge; conda config --add channels bioconda';
      return check;
    }

    const ok = channels[0] === 'conda-forge' && channels[1] === 'bioconda';
    check.status = ok ? 'pass' : 'warning';
    check.message = ok ? 'Channel order looks good' : 'Channel order should be conda-forge, bioconda';
    check.details = `Current order: ${channels.join(', ')}\nFix: conda config --add channels conda-forge; conda config --add channels bioconda`;
    return check;
  } catch (error) {
    check.status = 'warning';
    check.message = 'Could not read conda channels';
    check.details = (error as Error).message;
    return check;
  }
}

async function checkCondaPlatform(
  useSlurm: boolean,
  condaPath?: string
): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'conda_platform',
    name: 'Conda Platform Support',
    description: 'nf-core conda envs may not resolve on macOS ARM',
    status: 'unchecked',
    message: '',
    required: false,
  };

  const runtimePlatform = await detectRuntimePlatform(condaPath);
  const detected = `${runtimePlatform.raw} (${runtimePlatform.source})`;

  if (useSlurm) {
    check.status = 'pass';
    check.message = 'Handled by SLURM execution';
    check.details = `SLURM is enabled. Detected runtime: ${detected}`;
    return check;
  }

  if (isMacOsArmRuntime(runtimePlatform)) {
    check.status = 'fail';
    check.message = 'Conda envs for nf-core often fail on macOS ARM';
    check.details = `Detected runtime: ${detected}. Use a Linux/SLURM server instead.`;
    return check;
  }

  check.status = 'pass';
  check.message = `Platform compatible (${runtimePlatform.raw})`;
  check.details = `Detected runtime: ${detected}`;
  return check;
}

/**
 * Check if Nextflow is installed and get version
 */
async function checkNextflow(): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'nextflow',
    name: 'Nextflow',
    description: 'Workflow engine required to run nf-core pipelines',
    status: 'unchecked',
    message: '',
    required: true,
  };

  try {
    const { stdout, stderr } = await execAsync('nextflow -version', { timeout: 10000 });
    const output = stdout || stderr;

    // Parse version from output like "nextflow version 24.04.2.5914"
    const versionMatch = output.match(/version\s+(\d+\.\d+\.\d+)/i);

    if (versionMatch) {
      check.status = 'pass';
      check.message = `Installed (v${versionMatch[1]})`;
      check.details = output.trim();
    } else {
      check.status = 'pass';
      check.message = 'Installed';
      check.details = output.trim();
    }
  } catch (error) {
    const err = error as { code?: string; message?: string };
    if (err.code === 'ENOENT' || err.message?.includes('not found')) {
      check.status = 'fail';
      check.message = 'Not installed';
      check.details = 'Install Nextflow: curl -s https://get.nextflow.io | bash';
    } else {
      check.status = 'fail';
      check.message = 'Error checking Nextflow';
      check.details = err.message || 'Unknown error';
    }
  }

  return check;
}

/**
 * Check if Java is installed (required by Nextflow)
 */
async function checkJava(condaPath?: string, condaEnv?: string): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'java',
    name: 'Java Runtime',
    description: 'SeqDesk pipeline runtime (Java 17 or later)',
    status: 'unchecked',
    message: '',
    required: true,
  };

  const envName = resolveCondaEnvName(condaEnv);

  // Find conda executable
  let condaBin = '';
  if (condaPath) {
    const possiblePaths = [
      path.join(condaPath, 'condabin', 'conda'),
      path.join(condaPath, 'bin', 'conda'),
    ];
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        condaBin = p;
        break;
      } catch {
        // Try next
      }
    }
  }

  // If no conda path configured, try system conda
  if (!condaBin) {
    try {
      await execAsync('which conda', { timeout: 5000 });
      condaBin = 'conda';
    } catch {
      // No conda available
    }
  }

  // Check in conda environment first
  if (condaBin) {
    try {
      if (await condaEnvironmentExists(condaBin, envName)) {
        try {
          const { stdout, stderr } = await execAsync(
            `${buildCondaRunCommand(condaBin, envName, ['java', '-version'])} 2>&1`,
            { timeout: 20000 }
          );
          const output = stdout || stderr;
          const versionMatch = output.match(/version\s+"?(\d+)(?:\.(\d+))?/i);

          if (versionMatch) {
            const majorVersion = parseInt(versionMatch[1], 10);
            if (majorVersion >= 17) {
              check.status = 'pass';
              check.message = `Installed in conda env (Java ${majorVersion})`;
            } else {
              check.status = 'warning';
              check.message = `Java ${majorVersion} in conda env (17+ required)`;
            }
            check.details = output.trim().split('\n')[0];
            return check;
          } else if (output && output.trim()) {
            check.status = 'pass';
            check.message = 'Installed in conda env';
            check.details = output.trim().split('\n')[0];
            return check;
          }
        } catch {
          // Fall through to system check
        }
      }
    } catch {
      // Fall through to system check
    }
  }

  // Fall back to system PATH
  try {
    const { stdout, stderr } = await execAsync('java -version 2>&1', { timeout: 10000 });
    const output = stdout || stderr;

    // Parse version from output like "openjdk version "17.0.1""
    const versionMatch = output.match(/version\s+"?(\d+)(?:\.(\d+))?/i);

    if (versionMatch) {
      const majorVersion = parseInt(versionMatch[1], 10);
      if (majorVersion >= 17) {
        check.status = 'pass';
        check.message = `Installed (Java ${majorVersion})`;
      } else {
        check.status = 'warning';
        check.message = `Java ${majorVersion} found (17+ required)`;
      }
      check.details = output.trim().split('\n')[0];
    } else {
      check.status = 'pass';
      check.message = 'Installed';
      check.details = output.trim().split('\n')[0];
    }
  } catch {
    check.status = 'fail';
    check.message = 'Not installed';
    check.details = 'Install Java 17 or later';
  }

  return check;
}

/**
 * Check if Conda is available.
 *
 * The generated Nextflow configuration deliberately uses Conda
 * (`useMamba = false`), so Mamba by itself must never satisfy a required
 * runtime check.
 */
async function checkConda(
  condaPath?: string,
  condaEnv?: string,
  requireConfiguredRuntime = false
): Promise<PrerequisiteCheck> {
  const configuredCondaPath = condaPath?.trim();
  const check: PrerequisiteCheck = {
    id: 'conda',
    name: 'Conda',
    description: 'Package manager for pipeline dependencies',
    status: 'unchecked',
    message: '',
    required: true,
  };

  // Check configured conda path first. Probe both condabin/conda and
  // bin/conda to match every other conda resolver in this module, so
  // condabin-only installs are still detected.
  if (configuredCondaPath) {
    const condaCandidates = [
      path.join(configuredCondaPath, 'condabin', 'conda'),
      path.join(configuredCondaPath, 'bin', 'conda'),
    ];
    const mambaCandidates = [
      path.join(configuredCondaPath, 'condabin', 'mamba'),
      path.join(configuredCondaPath, 'bin', 'mamba'),
    ];

    for (const condaBin of condaCandidates) {
      try {
        await fs.access(condaBin);
        const { stdout } = await execAsync(
          `${shellQuote(condaBin)} --version`,
          { timeout: 10000 }
        );

        if (requireConfiguredRuntime) {
          const condaInitScript = path.join(
            configuredCondaPath,
            'etc',
            'profile.d',
            'conda.sh'
          );
          try {
            await fs.access(condaInitScript, fsConstants.R_OK);
          } catch {
            check.status = 'fail';
            check.message = 'Configured Conda runtime cannot be initialized';
            check.details =
              `Run scripts require a readable activation script: ${condaInitScript}`;
            return check;
          }

          const environment = resolveCondaEnvironmentReference(condaEnv);
          if (!(await condaEnvironmentExists(condaBin, environment.value))) {
            check.status = 'fail';
            check.message = `Configured Conda environment not found: ${environment.value}`;
            check.details =
              `Run scripts activate this environment from ${configuredCondaPath} before launching Nextflow.`;
            return check;
          }

          try {
            await execAsync(
              buildCondaActivationProbeCommand(
                configuredCondaPath,
                condaInitScript,
                environment.value
              ),
              { timeout: 20_000, maxBuffer: 1024 * 1024 }
            );
          } catch (error) {
            const details = extractExecErrorDetails(error);
            check.status = 'fail';
            check.message =
              `Configured Conda environment cannot be activated: ${environment.value}`;
            check.details = [
              `The run.sh bootstrap failed while sourcing ${condaInitScript}.`,
              details,
            ]
              .filter(Boolean)
              .join('\n');
            return check;
          }
        }

        check.status = 'pass';
        check.message = `Found at configured path`;
        check.details = requireConfiguredRuntime
          ? `${configuredCondaPath}\nEnvironment: ${resolveCondaEnvName(condaEnv)}\n${stdout.trim()}`
          : `${configuredCondaPath}\n${stdout.trim()}`;
        return check;
      } catch {
        // Try next candidate
      }
    }

    if (requireConfiguredRuntime) {
      check.status = 'fail';
      check.message = 'Configured Conda runtime cannot be initialized';
      check.details =
        `Run scripts require Conda at ${condaCandidates.join(' or ')}.`;
      return check;
    }

    for (const mambaBin of mambaCandidates) {
      try {
        await fs.access(mambaBin);
        const { stdout } = await execAsync(
          `${shellQuote(mambaBin)} --version`,
          { timeout: 10000 }
        );
        check.status = 'pass';
        check.message = `Mamba found at configured path`;
        check.details = `${configuredCondaPath}\n${stdout.trim()}`;
        return check;
      } catch {
        // Try next candidate
      }
    }

    check.status = 'warning';
    check.message = `Configured path invalid: ${configuredCondaPath}`;
    check.details = 'Conda not found at the configured path';
  }

  // Check system Conda. Local/managed execution cannot use Mamba as a
  // substitute because the generated Nextflow config has useMamba disabled.
  try {
    const { stdout } = await execAsync('conda --version', { timeout: 10000 });
    check.status = configuredCondaPath ? 'warning' : 'pass';
    check.message = configuredCondaPath ? 'Found in PATH (not configured path)' : 'Available in PATH';
    check.details = stdout.trim();
    return check;
  } catch {
    if (requireConfiguredRuntime) {
      check.status = 'fail';
      check.message = 'Conda not found';
      check.details =
        'Local and managed pipeline runs require Conda; a Mamba-only runtime is not supported.';
      return check;
    }

    // For a non-required application-host check (for example SLURM without a
    // configured local runtime), report Mamba as informational only.
    try {
      const { stdout } = await execAsync('mamba --version', { timeout: 10000 });
      check.status = configuredCondaPath ? 'warning' : 'pass';
      check.message = configuredCondaPath ? 'Mamba found in PATH (not configured path)' : 'Mamba available in PATH';
      check.details = stdout.trim();
      return check;
    } catch {
      check.status = 'fail';
      check.message = 'Not found';
      check.details = 'Install Conda to run pipelines';
    }
  }

  return check;
}


/**
 * Check if SLURM is available (when configured)
 */
async function checkSlurm(
  useSlurm: boolean,
  slurmQueue?: string
): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'slurm',
    name: 'SLURM',
    description: 'HPC job scheduler',
    status: 'unchecked',
    message: '',
    required: useSlurm,
  };

  if (!useSlurm) {
    check.status = 'pass';
    check.message = 'Not required (local execution)';
    return check;
  }

  const requiredCommands = [
    'sinfo',
    'sbatch',
    'squeue',
    'sacct',
    'scontrol',
    'scancel',
  ];
  const commandResults = await Promise.all(
    requiredCommands.map(async (command) => {
      try {
        const { stdout, stderr } = await execAsync(`${command} --version`, {
          timeout: 10000,
        });
        return {
          command,
          available: true,
          version: (stdout || stderr).trim(),
        };
      } catch {
        return { command, available: false, version: '' };
      }
    })
  );
  const missingCommands = commandResults
    .filter((result) => !result.available)
    .map((result) => result.command);

  if (missingCommands.length > 0) {
    check.status = 'fail';
    check.message = 'Not available';
    check.details = `Missing required SLURM command${
      missingCommands.length === 1 ? '' : 's'
    }: ${missingCommands.join(', ')}. Disable SLURM in settings to run locally.`;
    return check;
  }

  const queue = slurmQueue?.trim();
  const queueCommand = queue
    ? `sinfo -h -p ${shellQuote(queue)} -o "%P %a"`
    : 'sinfo -h -o "%P %a"';
  try {
    const { stdout: queueInfo } = await execAsync(queueCommand, {
      timeout: 10000,
    });
    const partitions = queueInfo.trim();
    if (!partitions) {
      check.status = 'fail';
      check.message = queue
        ? `Partition ${queue} is not available`
        : 'No SLURM partitions are available';
      check.details = queue
        ? `sinfo returned no entry for configured partition ${queue}.`
        : 'sinfo returned no available partitions.';
      return check;
    }

    const hasAvailablePartition = partitions
      .split(/\r?\n/)
      .some((line) => /\s+up\s*$/i.test(line.trim()));
    if (!hasAvailablePartition) {
      check.status = 'fail';
      check.message = queue
        ? `Partition ${queue} is down`
        : 'No active SLURM partition is available';
      check.details = partitions;
      return check;
    }

    check.status = 'pass';
    check.message = queue
      ? `Partition ${queue} is available`
      : 'Available';
    check.details = [
      ...commandResults.map(
        (result) => `${result.command}: ${result.version || 'available'}`
      ),
      '',
      `${queue ? 'Configured partition' : 'Available partitions'}:`,
      partitions,
    ].join('\n');
  } catch (error) {
    check.status = 'fail';
    check.message = 'Cannot inspect SLURM partitions';
    check.details = extractExecErrorDetails(error);
  }

  return check;
}

/**
 * Check if pipeline run directory is writable
 */
async function probeWritableRunDirectory(
  requestedPath: string,
  canonicalPath: string
): Promise<void> {
  let probeDirectory: string | null = null;
  try {
    probeDirectory = await fs.mkdtemp(
      path.join(canonicalPath, '.seqdesk-readiness-')
    );
    const probeDirectoryStat = await fs.lstat(probeDirectory);
    const canonicalProbeDirectory = await fs.realpath(probeDirectory);
    if (
      probeDirectoryStat.isSymbolicLink() ||
      !probeDirectoryStat.isDirectory() ||
      path.dirname(canonicalProbeDirectory) !== canonicalPath
    ) {
      throw new Error('Readiness probe escaped the configured directory.');
    }

    const probeFile = path.join(probeDirectory, 'write-probe');
    await fs.writeFile(probeFile, 'seqdesk readiness\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    const probeFileStat = await fs.lstat(probeFile);
    if (probeFileStat.isSymbolicLink() || !probeFileStat.isFile()) {
      throw new Error('Readiness probe file has an unsafe type.');
    }
    await fs.unlink(probeFile);
    await fs.rmdir(probeDirectory);
    probeDirectory = null;

    if ((await fs.realpath(requestedPath)) !== canonicalPath) {
      throw new Error(
        'Configured pipeline run directory changed during its readiness probe.'
      );
    }
  } finally {
    if (probeDirectory) {
      try {
        const resolvedProbeDirectory = path.resolve(probeDirectory);
        if (
          path.dirname(resolvedProbeDirectory) === canonicalPath &&
          path
            .basename(resolvedProbeDirectory)
            .startsWith('.seqdesk-readiness-')
        ) {
          const probeStat = await fs.lstat(resolvedProbeDirectory);
          if (probeStat.isSymbolicLink()) {
            await fs.unlink(resolvedProbeDirectory);
          } else {
            await fs.rm(resolvedProbeDirectory, {
              recursive: true,
              force: true,
            });
          }
        }
      } catch {
        // Best-effort cleanup of the uniquely named readiness probe.
      }
    }
  }
}

async function checkRunDirectory(pipelineRunDir: string): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'run_directory',
    name: 'Pipeline Run Directory',
    description: 'Directory where pipeline outputs are stored',
    status: 'unchecked',
    message: '',
    required: true,
  };

  if (!pipelineRunDir) {
    check.status = 'fail';
    check.message = 'Not configured';
    check.details = 'Set pipelineRunDir in Admin → Settings → Pipelines → Execution';
    return check;
  }

  let created = false;
  try {
    let entry;
    try {
      entry = await fs.lstat(pipelineRunDir);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') throw error;
      try {
        await fs.mkdir(pipelineRunDir, { recursive: true });
        created = true;
        entry = await fs.lstat(pipelineRunDir);
      } catch {
        check.status = 'fail';
        check.message = 'Cannot create directory';
        check.details = `${pipelineRunDir}\nCreate this directory manually or choose a different path`;
        return check;
      }
    }

    const stats = entry.isSymbolicLink()
      ? await fs.stat(pipelineRunDir)
      : entry;
    if (!stats.isDirectory()) {
      check.status = 'fail';
      check.message = 'Configured path is not a directory';
      check.details = pipelineRunDir;
      return check;
    }

    const canonicalPath = await fs.realpath(pipelineRunDir);
    if (canonicalPath === path.parse(canonicalPath).root) {
      check.status = 'fail';
      check.message = 'Filesystem root cannot be used';
      check.details = pipelineRunDir;
      return check;
    }

    await fs.access(
      pipelineRunDir,
      fsConstants.R_OK | fsConstants.W_OK
    );
    await probeWritableRunDirectory(pipelineRunDir, canonicalPath);

    check.status = 'pass';
    check.message = created ? 'Created successfully' : 'Exists and writable';
    check.details = pipelineRunDir;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EACCES') {
      check.status = 'fail';
      check.message = 'Permission denied';
      check.details = `${pipelineRunDir}\nCheck directory permissions`;
    } else {
      check.status = 'fail';
      check.message = 'Error checking directory';
      check.details = pipelineRunDir;
    }
  }

  return check;
}

/**
 * Check if data base path is configured
 */
async function checkDataBasePath(dataBasePath?: string): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'data_base_path',
    name: 'Data Base Path',
    description: 'Root directory for sequencing data files',
    status: 'unchecked',
    message: '',
    required: true,
  };

  if (!dataBasePath) {
    check.status = 'fail';
    check.message = 'Not configured';
    check.details = 'Set dataBasePath in Admin → Settings → General';
    return check;
  }

  try {
    const stats = await fs.stat(dataBasePath);
    if (!stats.isDirectory()) {
      check.status = 'fail';
      check.message = 'Configured path is not a directory';
      check.details = dataBasePath;
      return check;
    }
    await fs.access(dataBasePath, fsConstants.R_OK);
    check.status = 'pass';
    check.message = 'Configured and accessible';
    check.details = dataBasePath;
  } catch {
    check.status = 'fail';
    check.message = 'Directory not accessible';
    check.details = `${dataBasePath}\nEnsure the directory exists and is readable`;
  }

  return check;
}

/**
 * Check nf-core tools availability (optional but helpful)
 */
async function checkNfcoreTools(condaPath?: string, condaEnv?: string): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'nfcore_tools',
    name: 'nf-core Tools',
    description: 'Helper tools for nf-core pipelines',
    status: 'unchecked',
    message: '',
    required: false,
  };

  const envName = resolveCondaEnvName(condaEnv);
  let envExists = false;
  let envInstallHint = '';
  let envErrorDetails = '';

  // Find conda executable
  let condaBin = '';
  if (condaPath) {
    const possiblePaths = [
      path.join(condaPath, 'condabin', 'conda'),
      path.join(condaPath, 'bin', 'conda'),
    ];
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        condaBin = p;
        break;
      } catch {
        // Try next
      }
    }
  }

  // If no conda path configured, try system conda
  if (!condaBin) {
    try {
      await execAsync('which conda', { timeout: 5000 });
      condaBin = 'conda';
    } catch {
      // No conda available
    }
  }
  if (condaBin) {
    const reference = resolveCondaEnvironmentReference(envName);
    envInstallHint = `Install with: ${shellQuote(condaBin)} install ${reference.selector} ${shellQuote(reference.value)} -c conda-forge -c bioconda nf-core`;
  }

  // Check in conda environment first
  if (condaBin) {
    try {
      envExists = await condaEnvironmentExists(condaBin, envName);
      if (envExists) {
        const commands = [
          `${buildCondaRunCommand(condaBin, envName, [
            'nf-core',
            '--version',
          ])} 2>&1`,
          `${buildCondaRunCommand(condaBin, envName, [
            'python',
            '-m',
            'nf_core',
            '--version',
          ])} 2>&1`,
          `${buildCondaRunCommand(condaBin, envName, [
            'python',
            '-c',
            "import nf_core as n; print(getattr(n, '__version__', 'installed'))",
          ])} 2>&1`,
        ];

        for (const command of commands) {
          try {
            const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
            const output = (stdout || stderr).trim();
            if (!output) {
              continue;
            }
            check.status = 'pass';
            check.message = 'Installed in conda env';
            check.details = output;
            return check;
          } catch (error) {
            envErrorDetails = (error as Error).message;
          }
        }
      }
    } catch (error) {
      envErrorDetails = (error as Error).message;
    }
  }

  // Fall back to system PATH
  try {
    const { stdout, stderr } = await execAsync('nf-core --version 2>&1', { timeout: 15000 });
    const output = (stdout || stderr).trim();

    if (envExists) {
      check.status = 'warning';
      check.message = 'Installed in PATH only';
      check.details = [
        output || 'nf-core available in PATH',
        `nf-core was not detected in conda env "${envName}".`,
        envInstallHint,
      ]
        .filter(Boolean)
        .join('\n');
      return check;
    }

    check.status = 'pass';
    check.message = 'Installed';
    check.details = output || 'nf-core available in PATH';
  } catch {
    check.status = 'warning';
    if (envExists) {
      check.message = `Not installed in conda env (${envName})`;
      check.details = [
        envInstallHint,
        envErrorDetails ? `Last error: ${envErrorDetails}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      check.message = 'Not installed';
      check.details = 'Install with: pip install nf-core (optional but helpful)';
    }
  }

  return check;
}

/**
 * Run all prerequisite checks
 */
export async function checkAllPrerequisites(
  executionSettings: ExecutionSettings,
  dataBasePath?: string
): Promise<PrerequisiteResult> {
  const checks: PrerequisiteCheck[] = [];

  // Run checks in parallel for speed
  // Use conda-aware checks for Nextflow and Java
  const [
    nextflowCheck,
    javaCheck,
    condaCheck,
    condaTosCheck,
    slurmCheck,
    runDirCheck,
    dataPathCheck,
    nfcoreCheck,
    condaChannelsCheck,
    condaPlatformCheck,
  ] = await Promise.all([
    checkNextflowInConda(executionSettings.condaPath, executionSettings.condaEnv),
    checkJava(executionSettings.condaPath, executionSettings.condaEnv),
    checkConda(
      executionSettings.condaPath,
      executionSettings.condaEnv,
      true
    ),
    checkCondaTermsOfService(executionSettings.condaPath),
    checkSlurm(executionSettings.useSlurm, executionSettings.slurmQueue),
    checkRunDirectory(executionSettings.pipelineRunDir),
    checkDataBasePath(dataBasePath),
    checkNfcoreTools(executionSettings.condaPath, executionSettings.condaEnv),
    checkCondaChannels(executionSettings.condaPath),
    checkCondaPlatform(executionSettings.useSlurm, executionSettings.condaPath),
  ]);

  checks.push(
    nextflowCheck,
    javaCheck,
    condaCheck,
    condaTosCheck,
    slurmCheck,
    runDirCheck,
    dataPathCheck,
    nfcoreCheck,
    condaChannelsCheck,
    condaPlatformCheck
  );

  condaCheck.required = true;
  if (condaCheck.status === 'warning') {
    condaCheck.status = 'fail';
  }

  // Calculate results
  const requiredChecks = checks.filter(c => c.required);
  const requiredPassed = requiredChecks.every(c => c.status === 'pass');
  const allPassed = checks.every(c => c.status === 'pass');

  const failedRequired = requiredChecks.filter(c => c.status === 'fail');
  const warnings = checks.filter(c => c.status === 'warning');

  let summary: string;
  if (requiredPassed) {
    if (warnings.length > 0) {
      summary = `Ready to run (${warnings.length} warning${warnings.length > 1 ? 's' : ''})`;
    } else {
      summary = 'All checks passed - ready to run pipelines';
    }
  } else {
    const failedNames = failedRequired.map(c => c.name).join(', ');
    summary = `Missing required: ${failedNames}`;
  }

  return {
    allPassed,
    requiredPassed,
    checks,
    summary,
  };
}

/**
 * Run only the live runtime checks that gate pipeline execution.
 *
 * The pipeline settings page uses this smaller check set for readiness. It
 * deliberately follows the generated run script: every run needs Conda because
 * SeqDesk always adds the Nextflow Conda profile and disables Mamba. SLURM runs
 * additionally need the scheduler commands. When condaPath is configured,
 * run.sh also sources that base and activates condaEnv before launching
 * Nextflow. Nextflow and Java are required in both modes because SeqDesk
 * launches the Nextflow process on the application/scheduler host.
 */
async function runPipelineRuntimePrerequisiteChecks(
  executionSettings: ExecutionSettings
): Promise<PrerequisiteCheck[]> {
  const runtimeCheckPromises: Promise<PrerequisiteCheck>[] = [];
  if (executionSettings.useSlurm) {
    runtimeCheckPromises.push(
      checkSlurm(true, executionSettings.slurmQueue)
    );
  }
  runtimeCheckPromises.push(
    checkConda(
      executionSettings.condaPath,
      executionSettings.condaEnv,
      true
    )
  );

  const [nextflowCheck, javaCheck, ...runtimeChecks] = await Promise.all([
    checkNextflowInConda(executionSettings.condaPath, executionSettings.condaEnv),
    checkJava(executionSettings.condaPath, executionSettings.condaEnv),
    ...runtimeCheckPromises,
  ]);

  return [nextflowCheck, javaCheck, ...runtimeChecks];
}

export function clearPipelineRuntimePrerequisiteCache(): void {
  pipelineRuntimePrerequisiteCache.clear();
}

export async function checkPipelineRuntimePrerequisites(
  executionSettings: ExecutionSettings
): Promise<PrerequisiteCheck[]> {
  const cacheKey = getPipelineRuntimePrerequisiteCacheKey(executionSettings);
  const now = Date.now();
  const cached = pipelineRuntimePrerequisiteCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = runPipelineRuntimePrerequisiteChecks(executionSettings);
  pipelineRuntimePrerequisiteCache.set(cacheKey, {
    // Keep the in-flight probe shared even when a slow command exceeds the
    // eventual TTL. The real expiry is assigned after the probe settles.
    expiresAt: Number.POSITIVE_INFINITY,
    promise,
  });

  try {
    const checks = await promise;
    const current = pipelineRuntimePrerequisiteCache.get(cacheKey);
    if (current?.promise === promise) {
      current.expiresAt = Date.now() + PIPELINE_RUNTIME_PREREQUISITE_TTL_MS;
    }
    return checks;
  } catch (error) {
    const current = pipelineRuntimePrerequisiteCache.get(cacheKey);
    if (current?.promise === promise) {
      pipelineRuntimePrerequisiteCache.delete(cacheKey);
    }
    throw error;
  }
}

/**
 * Check if Nextflow is available in conda environment
 */
async function checkNextflowInConda(condaPath?: string, condaEnv?: string): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'nextflow',
    name: 'Nextflow',
    description: 'Workflow engine required to run nf-core pipelines',
    status: 'unchecked',
    message: '',
    required: true,
  };

  const envName = resolveCondaEnvName(condaEnv);

  // Find conda executable
  let condaBin = '';
  if (condaPath) {
    const possiblePaths = [
      path.join(condaPath, 'condabin', 'conda'),
      path.join(condaPath, 'bin', 'conda'),
    ];
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        condaBin = p;
        break;
      } catch {
        // Try next
      }
    }
  }

  // If no conda path configured, try system conda
  if (!condaBin) {
    try {
      await execAsync('which conda', { timeout: 5000 });
      condaBin = 'conda';
    } catch {
      // No conda available
    }
  }

  // Check in conda environment first
  if (condaBin) {
    // First verify the environment exists
    try {
      if (!(await condaEnvironmentExists(condaBin, envName))) {
        console.log(`[checkNextflowInConda] Environment ${envName} not found`);
        // Fall through to system check
      } else {
        // Environment exists, check for nextflow inside it
        try {
          const { stdout, stderr } = await execAsync(
            `${buildCondaRunCommand(condaBin, envName, [
              'nextflow',
              '-version',
            ])} 2>&1`,
            { timeout: 30000 }
          );
          const output = stdout || stderr;
          const versionMatch = output.match(/version\s+(\d+\.\d+\.\d+)/i);
          if (versionMatch) {
            check.status = 'pass';
            check.message = `Installed in conda env (v${versionMatch[1]})`;
            check.details = output.trim();
            return check;
          }
          // If we got output but no version match, still consider it a pass
          if (output && output.trim()) {
            check.status = 'pass';
            check.message = 'Installed in conda env';
            check.details = output.trim();
            return check;
          }
        } catch (error) {
          // Log error for debugging but fall through to system check
          console.log('[checkNextflowInConda] Conda env check failed:', (error as Error).message);
        }
      }
    } catch (error) {
      console.log('[checkNextflowInConda] Conda env list failed:', (error as Error).message);
    }
  }

  // Fall back to system PATH
  return checkNextflow();
}

/**
 * Quick check if system is ready (for UI status indicators)
 */
export async function quickPrerequisiteCheck(
  executionSettings: ExecutionSettings,
  dataBasePath?: string
): Promise<{ ready: boolean; summary: string }> {
  try {
    const [runtimeChecks, runDir, dataPath] = await Promise.all([
      checkPipelineRuntimePrerequisites(executionSettings),
      checkRunDirectory(executionSettings.pipelineRunDir),
      checkDataBasePath(dataBasePath),
    ]);
    const criticalChecks = [...runtimeChecks, runDir, dataPath];
    const criticalPassed = criticalChecks.every(
      (check) => !check.required || check.status === 'pass'
    );

    if (criticalPassed) {
      return { ready: true, summary: 'Ready to run pipelines' };
    }

    const failed = criticalChecks.filter(
      (check) => check.required && check.status !== 'pass'
    );
    return {
      ready: false,
      summary: `Missing: ${failed.map(c => c.name).join(', ')}`
    };
  } catch {
    return { ready: false, summary: 'Error checking prerequisites' };
  }
}

/**
 * Test a specific setting (for inline testing in admin UI)
 */
export async function testSetting(
  setting: 'pipelineRunDir' | 'condaPath' | 'nextflow' | 'nfcore' | 'weblogUrl' | 'slurm',
  value?: string
): Promise<{ success: boolean; message: string; details?: string; version?: string }> {
  switch (setting) {
    case 'pipelineRunDir': {
      if (!value) {
        return { success: false, message: 'No path provided' };
      }
      const check = await checkRunDirectory(value);
      return {
        success: check.status === 'pass',
        message: check.message,
        details: check.details,
      };
    }

    case 'condaPath': {
      if (!value) {
        // Check system conda
        try {
          const { stdout } = await execAsync('conda --version', { timeout: 10000 });
          const tosCheck = await checkCondaTermsOfService();
          return {
            success: true,
            message:
              tosCheck.status === 'warning'
                ? 'Available in PATH (defaults channel not usable without ToS)'
                : 'Available in PATH',
            version: stdout.trim(),
            details: tosCheck.details,
          };
        } catch {
          return { success: false, message: 'Conda not found in PATH' };
        }
      }

      // Check specific path
      const condaBin = path.join(value, 'bin', 'conda');
      const condabinConda = path.join(value, 'condabin', 'conda');

      for (const bin of [condaBin, condabinConda]) {
        try {
          await fs.access(bin);
          const { stdout } = await execAsync(
            `${shellQuote(bin)} --version`,
            { timeout: 10000 }
          );
          const tosCheck = await checkCondaTermsOfService(value);
          return {
            success: true,
            message:
              tosCheck.status === 'warning'
                ? 'Found and working (defaults channel not usable without ToS)'
                : 'Found and working',
            version: stdout.trim(),
            details: tosCheck.details ? `${bin}\n${tosCheck.details}` : bin,
          };
        } catch {
          // Try next path
        }
      }

      return {
        success: false,
        message: 'Conda not found at path',
        details: `Tried: ${condaBin}, ${condabinConda}`,
      };
    }

    case 'slurm': {
      const check = await checkSlurm(true);
      return {
        success: check.status === 'pass',
        message: check.message,
        details: check.details,
      };
    }

    case 'nextflow': {
      const check = await checkNextflow();
      return {
        success: check.status === 'pass',
        message: check.message,
        details: check.details,
        version: check.message.includes('v') ? check.message.match(/v([\d.]+)/)?.[1] : undefined,
      };
    }

    case 'nfcore': {
      const check = await checkNfcoreTools();
      let version: string | undefined;
      if (check.details) {
        // Parse version from "nf-core, version 2.14.1"
        const match = check.details.match(/version\s+([\d.]+)/i);
        if (match) version = match[1];
      }
      return {
        success: check.status === 'pass',
        message: check.message,
        details: check.details,
        version,
      };
    }

    case 'weblogUrl': {
      if (!value) {
        return { success: false, message: 'No URL provided' };
      }

      let url = value;
      let secret: string | undefined;
      try {
        if (value.trim().startsWith('{')) {
          const parsed = JSON.parse(value) as { url?: string; secret?: string };
          if (parsed.url) url = parsed.url;
          if (parsed.secret) secret = parsed.secret;
        }
      } catch {
        // Ignore JSON parse errors, treat value as URL
      }

      let requestUrl: URL;
      try {
        requestUrl = new URL(url);
      } catch {
        return { success: false, message: 'Invalid URL' };
      }

      requestUrl.searchParams.set('runId', 'weblog-test');
      if (secret) {
        requestUrl.searchParams.set('token', secret);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const res = await fetch(requestUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'weblog_test',
            timestamp: new Date().toISOString(),
          }),
          signal: controller.signal,
        });

        if (res.status === 403) {
          return { success: false, message: 'Unauthorized (token mismatch?)' };
        }

        if (res.status === 404) {
          return { success: true, message: 'Endpoint reachable (run not found)' };
        }

        if (res.ok) {
          return { success: true, message: 'Endpoint reachable' };
        }

        return { success: false, message: `Unexpected response (${res.status})` };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Request failed';
        return { success: false, message: `Request failed: ${msg}` };
      } finally {
        clearTimeout(timeout);
      }
    }

    default:
      return { success: false, message: 'Unknown setting' };
  }
}

/**
 * Detect installed tool versions
 */
export async function detectVersions(condaPath?: string, condaEnv?: string): Promise<{
  nextflow?: string;
  nfcore?: string;
  conda?: string;
  java?: string;
  condaEnv?: string;
}> {
  const versions: {
    nextflow?: string;
    nfcore?: string;
    conda?: string;
    java?: string;
    condaEnv?: string;
  } = {};

  // Find conda executable
  let condaBin = 'conda';
  if (condaPath) {
    const possiblePaths = [
      path.join(condaPath, 'condabin', 'conda'),
      path.join(condaPath, 'bin', 'conda'),
    ];
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        condaBin = p;
        break;
      } catch {
        // Try next
      }
    }
  }

  // Conda version (from base)
  try {
    const { stdout } = await execAsync(
      `${shellQuote(condaBin)} --version`,
      { timeout: 10000 }
    );
    const match = stdout.match(/conda\s+([\d.]+)/i);
    if (match) versions.conda = match[1];
  } catch {
    // Not installed
  }

  // Check if seqdesk-pipelines environment exists
  const envName = resolveCondaEnvName(condaEnv);
  const hasEnv = await condaEnvironmentExists(condaBin, envName);
  if (hasEnv) {
    versions.condaEnv = envName;
  }

  // If we have the environment, check versions inside it
  if (hasEnv) {
    // Nextflow version
    try {
      const { stdout } = await execAsync(
        buildCondaRunCommand(condaBin, envName, ['nextflow', '-version']),
        { timeout: 15000 }
      );
      const match = stdout.match(/version\s+(\d+\.\d+\.\d+)/i);
      if (match) versions.nextflow = match[1];
    } catch {
      // Not installed in env
    }

    // nf-core version
    try {
      const { stdout } = await execAsync(
        buildCondaRunCommand(condaBin, envName, ['nf-core', '--version']),
        { timeout: 15000 }
      );
      const match = stdout.match(/version\s+([\d.]+)/i);
      if (match) versions.nfcore = match[1];
    } catch {
      // Not installed in env
    }

    // Java version
    try {
      const { stdout, stderr } = await execAsync(
        `${buildCondaRunCommand(condaBin, envName, [
          'java',
          '-version',
        ])} 2>&1`,
        { timeout: 15000 }
      );
      const output = stdout || stderr;
      const match = output.match(/version\s+"?(\d+)/i);
      if (match) versions.java = match[1];
    } catch {
      // Not installed in env
    }
  } else {
    // Fall back to system PATH
    try {
      const { stdout } = await execAsync('nextflow -version', { timeout: 10000 });
      const match = stdout.match(/version\s+(\d+\.\d+\.\d+)/i);
      if (match) versions.nextflow = match[1];
    } catch {
      // Not installed
    }

    try {
      const { stdout } = await execAsync('nf-core --version', { timeout: 10000 });
      const match = stdout.match(/version\s+([\d.]+)/i);
      if (match) versions.nfcore = match[1];
    } catch {
      // Not installed
    }

    try {
      const { stdout, stderr } = await execAsync('java -version 2>&1', { timeout: 10000 });
      const output = stdout || stderr;
      const match = output.match(/version\s+"?(\d+)/i);
      if (match) versions.java = match[1];
    } catch {
      // Not installed
    }
  }

  return versions;
}
