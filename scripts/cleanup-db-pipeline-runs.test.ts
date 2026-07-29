import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cleanupScript = path.join(
  process.cwd(),
  "scripts",
  "cleanup-db-pipeline-runs.sh"
);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((tempRoot) =>
      fs.rm(tempRoot, { recursive: true, force: true })
    )
  );
});

async function writeExecutable(
  directory: string,
  name: string,
  contents: string
): Promise<void> {
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, contents, "utf8");
  await fs.chmod(filePath, 0o700);
}

async function createFakeScheduler(): Promise<{
  tempRoot: string;
  binDir: string;
  runRoot: string;
  runFolder: string;
  stateFile: string;
  cancelLog: string;
}> {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "seqdesk-cleanup-marker-")
  );
  tempRoots.push(tempRoot);
  const binDir = path.join(tempRoot, "bin");
  const runRoot = path.join(tempRoot, "runs");
  const runFolder = path.join(runRoot, "run-1");
  const stateFile = path.join(tempRoot, "slurm-active");
  const cancelLog = path.join(tempRoot, "scancel.log");
  await fs.mkdir(binDir);
  await fs.mkdir(runFolder, { recursive: true });
  await fs.writeFile(stateFile, "active\n", "utf8");

  await writeExecutable(
    binDir,
    "realpath",
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const target = process.argv[process.argv.length - 1];
try {
  process.stdout.write(fs.realpathSync(target) + "\\n");
} catch {
  process.stdout.write(path.resolve(target) + "\\n");
}
`
  );
  await writeExecutable(
    binDir,
    "psql",
    `#!/usr/bin/env bash
if [ "\${SEQDESK_TEST_PSQL_FAIL:-0}" = 1 ]; then
  exit 1
fi
exit 0
`
  );
  await writeExecutable(
    binDir,
    "squeue",
    `#!/usr/bin/env bash
if [ -f "$SEQDESK_TEST_SLURM_STATE" ]; then
  printf '123\\n'
fi
`
  );
  await writeExecutable(
    binDir,
    "scontrol",
    `#!/usr/bin/env bash
printf 'JobId=123 JobName=seqdesk-run-1 WorkDir=%s\\n' "$SEQDESK_TEST_RUN_FOLDER"
`
  );
  await writeExecutable(
    binDir,
    "scancel",
    `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$SEQDESK_TEST_CANCEL_LOG"
rm -f "$SEQDESK_TEST_SLURM_STATE"
`
  );

  return {
    tempRoot,
    binDir,
    runRoot,
    runFolder,
    stateFile,
    cancelLog,
  };
}

function schedulerEnvironment(fixture: Awaited<ReturnType<typeof createFakeScheduler>>) {
  return {
    ...process.env,
    PATH: `${fixture.binDir}:${process.env.PATH || ""}`,
    SEQDESK_TEST_SLURM_STATE: fixture.stateFile,
    SEQDESK_TEST_RUN_FOLDER: fixture.runFolder,
    SEQDESK_TEST_CANCEL_LOG: fixture.cancelLog,
  };
}

describe("cleanup-db-pipeline-runs launch marker recovery", () => {
  it("cancels an owned SLURM job whose queue id was never persisted", async () => {
    const fixture = await createFakeScheduler();
    await fs.writeFile(
      path.join(fixture.runFolder, ".seqdesk-launch-identity"),
      "slurm|123|seqdesk-run-1\n",
      { encoding: "utf8", mode: 0o600 }
    );

    await execFileAsync(
      "bash",
      [cleanupScript, "seqdesk-test", fixture.runRoot],
      {
        env: schedulerEnvironment(fixture),
        timeout: 5_000,
      }
    );

    await expect(fs.readFile(fixture.cancelLog, "utf8")).resolves.toBe("123\n");
    await expect(fs.stat(fixture.stateFile)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails closed without signaling when a launch marker is malformed", async () => {
    const fixture = await createFakeScheduler();
    await fs.writeFile(
      path.join(fixture.runFolder, ".seqdesk-launch-identity"),
      "slurm|123|not-a-seqdesk-job\n",
      "utf8"
    );

    await expect(
      execFileAsync(
        "bash",
        [cleanupScript, "seqdesk-test", fixture.runRoot],
        {
          env: schedulerEnvironment(fixture),
          timeout: 5_000,
        }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "refusing malformed pipeline launch marker contents"
      ),
    });
    await expect(fs.stat(fixture.cancelLog)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails closed when a launch marker was replaced by a symlink", async () => {
    const fixture = await createFakeScheduler();
    const outsideMarker = path.join(fixture.tempRoot, "outside-marker");
    await fs.writeFile(
      outsideMarker,
      "slurm|123|seqdesk-run-1\n",
      "utf8"
    );
    await fs.symlink(
      outsideMarker,
      path.join(fixture.runFolder, ".seqdesk-launch-identity")
    );

    await expect(
      execFileAsync(
        "bash",
        [cleanupScript, "seqdesk-test", fixture.runRoot],
        {
          env: schedulerEnvironment(fixture),
          timeout: 5_000,
        }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "refusing unscoped pipeline launch marker"
      ),
    });
    await expect(fs.stat(fixture.cancelLog)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("still cancels a marker-owned job when PostgreSQL is unavailable", async () => {
    const fixture = await createFakeScheduler();
    await fs.writeFile(
      path.join(fixture.runFolder, ".seqdesk-launch-identity"),
      "slurm|123|seqdesk-run-1\n",
      { encoding: "utf8", mode: 0o600 }
    );

    await expect(
      execFileAsync(
        "bash",
        [cleanupScript, "seqdesk-test", fixture.runRoot],
        {
          env: {
            ...schedulerEnvironment(fixture),
            SEQDESK_TEST_PSQL_FAIL: "1",
          },
          timeout: 5_000,
        }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "could not query PipelineRun queue identities"
      ),
    });
    await expect(fs.readFile(fixture.cancelLog, "utf8")).resolves.toBe("123\n");
    await expect(fs.stat(fixture.stateFile)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
