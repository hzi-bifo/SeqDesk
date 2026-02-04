// Pipeline Prerequisite Checker
// Validates system requirements before running nf-core pipelines

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

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

function resolveCondaEnvName(condaEnv?: string): string {
  return condaEnv?.trim() || 'seqdesk-pipelines';
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
    const { stdout } = await execAsync(`${condaBin} config --show channels`, { timeout: 10000 });
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

async function checkCondaPlatform(): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'conda_platform',
    name: 'Conda Platform Support',
    description: 'nf-core conda envs may not resolve on macOS ARM',
    status: 'unchecked',
    message: '',
    required: false,
  };

  if (process.platform === 'darwin' && process.arch === 'arm64') {
    check.status = 'fail';
    check.message = 'Conda envs for nf-core often fail on macOS ARM';
    check.details = 'Use a Linux/SLURM server instead.';
    return check;
  }

  check.status = 'pass';
  check.message = 'Platform compatible';
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
    description: 'Required by Nextflow (Java 11 or later)',
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
      const { stdout: envList } = await execAsync(`${condaBin} env list`, { timeout: 10000 });
      if (envList.includes(envName)) {
        try {
          const { stdout, stderr } = await execAsync(`${condaBin} run -n ${envName} java -version 2>&1`, { timeout: 20000 });
          const output = stdout || stderr;
          const versionMatch = output.match(/version\s+"?(\d+)(?:\.(\d+))?/i);

          if (versionMatch) {
            const majorVersion = parseInt(versionMatch[1], 10);
            if (majorVersion >= 11) {
              check.status = 'pass';
              check.message = `Installed in conda env (Java ${majorVersion})`;
            } else {
              check.status = 'warning';
              check.message = `Java ${majorVersion} in conda env (11+ recommended)`;
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
      if (majorVersion >= 11) {
        check.status = 'pass';
        check.message = `Installed (Java ${majorVersion})`;
      } else {
        check.status = 'warning';
        check.message = `Java ${majorVersion} found (11+ recommended)`;
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
    check.details = 'Install Java 11 or later';
  }

  return check;
}

/**
 * Check if Conda/Mamba is available
 */
async function checkConda(condaPath?: string): Promise<PrerequisiteCheck> {
  const check: PrerequisiteCheck = {
    id: 'conda',
    name: 'Conda/Mamba',
    description: 'Package manager for pipeline dependencies',
    status: 'unchecked',
    message: '',
    required: true,
  };

  // Check configured conda path first
  if (condaPath) {
    const condaBin = path.join(condaPath, 'bin', 'conda');
    const mambaBin = path.join(condaPath, 'bin', 'mamba');

    try {
      await fs.access(condaBin);
      const { stdout } = await execAsync(`${condaBin} --version`, { timeout: 10000 });
      check.status = 'pass';
      check.message = `Found at configured path`;
      check.details = `${condaPath}\n${stdout.trim()}`;
      return check;
    } catch {
      // Try mamba
      try {
        await fs.access(mambaBin);
        const { stdout } = await execAsync(`${mambaBin} --version`, { timeout: 10000 });
        check.status = 'pass';
        check.message = `Mamba found at configured path`;
        check.details = `${condaPath}\n${stdout.trim()}`;
        return check;
      } catch {
        check.status = 'warning';
        check.message = `Configured path invalid: ${condaPath}`;
        check.details = 'Conda/Mamba not found at the configured path';
      }
    }
  }

  // Check system conda/mamba
  try {
    const { stdout } = await execAsync('conda --version', { timeout: 10000 });
    check.status = condaPath ? 'warning' : 'pass';
    check.message = condaPath ? 'Found in PATH (not configured path)' : 'Available in PATH';
    check.details = stdout.trim();
    return check;
  } catch {
    // Try mamba
    try {
      const { stdout } = await execAsync('mamba --version', { timeout: 10000 });
      check.status = condaPath ? 'warning' : 'pass';
      check.message = condaPath ? 'Mamba found in PATH (not configured path)' : 'Mamba available in PATH';
      check.details = stdout.trim();
      return check;
    } catch {
      check.status = 'fail';
      check.message = 'Not found';
      check.details = 'Install Conda/Mamba to run pipelines';
    }
  }

  return check;
}


/**
 * Check if SLURM is available (when configured)
 */
async function checkSlurm(useSlurm: boolean): Promise<PrerequisiteCheck> {
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

  try {
    const { stdout } = await execAsync('sinfo --version', { timeout: 10000 });
    check.status = 'pass';
    check.message = 'Available';
    check.details = stdout.trim();

    // Also check queue status
    try {
      const { stdout: queueInfo } = await execAsync('sinfo -h -o "%P %a"', { timeout: 10000 });
      check.details += `\n\nAvailable partitions:\n${queueInfo.trim()}`;
    } catch {
      // Queue info is optional
    }
  } catch {
    check.status = 'fail';
    check.message = 'Not available';
    check.details = 'SLURM commands not found. Disable SLURM in settings to run locally.';
  }

  return check;
}

/**
 * Check if pipeline run directory is writable
 */
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

  try {
    // Check if directory exists
    await fs.access(pipelineRunDir);

    // Check if writable by creating a test file
    const testFile = path.join(pipelineRunDir, '.seqdesk-test');
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);

    check.status = 'pass';
    check.message = 'Exists and writable';
    check.details = pipelineRunDir;
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === 'ENOENT') {
      // Try to create the directory
      try {
        await fs.mkdir(pipelineRunDir, { recursive: true });
        check.status = 'pass';
        check.message = 'Created successfully';
        check.details = pipelineRunDir;
      } catch {
        check.status = 'fail';
        check.message = 'Cannot create directory';
        check.details = `${pipelineRunDir}\nCreate this directory manually or choose a different path`;
      }
    } else if (err.code === 'EACCES') {
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
    await fs.access(dataBasePath);
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
      const { stdout: envList } = await execAsync(`${condaBin} env list`, { timeout: 10000 });
      if (envList.includes(envName)) {
        try {
          const { stdout } = await execAsync(`${condaBin} run -n ${envName} nf-core --version 2>&1`, { timeout: 20000 });
          check.status = 'pass';
          check.message = 'Installed in conda env';
          check.details = stdout.trim();
          return check;
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
    const { stdout } = await execAsync('nf-core --version', { timeout: 10000 });
    check.status = 'pass';
    check.message = 'Installed';
    check.details = stdout.trim();
  } catch {
    check.status = 'warning';
    check.message = 'Not installed';
    check.details = 'Install with: pip install nf-core (optional but helpful)';
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
    slurmCheck,
    runDirCheck,
    dataPathCheck,
    nfcoreCheck,
    condaChannelsCheck,
    condaPlatformCheck,
  ] = await Promise.all([
    checkNextflowInConda(executionSettings.condaPath, executionSettings.condaEnv),
    checkJava(executionSettings.condaPath, executionSettings.condaEnv),
    checkConda(executionSettings.condaPath),
    checkSlurm(executionSettings.useSlurm),
    checkRunDirectory(executionSettings.pipelineRunDir),
    checkDataBasePath(dataBasePath),
    checkNfcoreTools(executionSettings.condaPath, executionSettings.condaEnv),
    checkCondaChannels(executionSettings.condaPath),
    checkCondaPlatform(),
  ]);

  checks.push(
    nextflowCheck,
    javaCheck,
    condaCheck,
    slurmCheck,
    runDirCheck,
    dataPathCheck,
    nfcoreCheck,
    condaChannelsCheck,
    condaPlatformCheck
  );

  condaCheck.required = true;
  if (condaCheck.status === 'warning') condaCheck.status = 'fail';

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
      const { stdout: envList } = await execAsync(`${condaBin} env list`, { timeout: 10000 });
      if (!envList.includes(envName)) {
        console.log(`[checkNextflowInConda] Environment ${envName} not found`);
        // Fall through to system check
      } else {
        // Environment exists, check for nextflow inside it
        try {
          const { stdout, stderr } = await execAsync(`${condaBin} run -n ${envName} nextflow -version 2>&1`, { timeout: 30000 });
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
    // Just check the critical requirements
    const baseChecks = await Promise.all([
      checkNextflowInConda(executionSettings.condaPath, executionSettings.condaEnv),
      checkRunDirectory(executionSettings.pipelineRunDir),
      checkDataBasePath(dataBasePath),
    ]);
    const runtimeCheck = await checkConda(executionSettings.condaPath);

    const [nextflow, runDir, dataPath] = baseChecks;

    const criticalPassed =
      nextflow.status === 'pass' &&
      runDir.status === 'pass' &&
      dataPath.status === 'pass' &&
      runtimeCheck.status === 'pass';

    if (criticalPassed) {
      return { ready: true, summary: 'Ready to run pipelines' };
    }

    const failed = [nextflow, runDir, dataPath].filter(c => c.status === 'fail');
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
          return {
            success: true,
            message: 'Available in PATH',
            version: stdout.trim(),
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
          const { stdout } = await execAsync(`${bin} --version`, { timeout: 10000 });
          return {
            success: true,
            message: 'Found and working',
            version: stdout.trim(),
            details: bin,
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
    const { stdout } = await execAsync(`${condaBin} --version`, { timeout: 10000 });
    const match = stdout.match(/conda\s+([\d.]+)/i);
    if (match) versions.conda = match[1];
  } catch {
    // Not installed
  }

  // Check if seqdesk-pipelines environment exists
  const envName = resolveCondaEnvName(condaEnv);
  let hasEnv = false;
  try {
    const { stdout } = await execAsync(`${condaBin} env list`, { timeout: 10000 });
    if (stdout.includes(envName)) {
      hasEnv = true;
      versions.condaEnv = envName;
    }
  } catch {
    // Ignore
  }

  // If we have the environment, check versions inside it
  if (hasEnv) {
    // Nextflow version
    try {
      const { stdout } = await execAsync(`${condaBin} run -n ${envName} nextflow -version`, { timeout: 15000 });
      const match = stdout.match(/version\s+(\d+\.\d+\.\d+)/i);
      if (match) versions.nextflow = match[1];
    } catch {
      // Not installed in env
    }

    // nf-core version
    try {
      const { stdout } = await execAsync(`${condaBin} run -n ${envName} nf-core --version`, { timeout: 15000 });
      const match = stdout.match(/version\s+([\d.]+)/i);
      if (match) versions.nfcore = match[1];
    } catch {
      // Not installed in env
    }

    // Java version
    try {
      const { stdout, stderr } = await execAsync(`${condaBin} run -n ${envName} java -version 2>&1`, { timeout: 15000 });
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
