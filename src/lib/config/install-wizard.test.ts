import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const wizardPath = path.join(repoRoot, "scripts", "install-wizard.mjs");

describe("installation port choice", () => {
  it("presents the recommended port as a default-yes confirmation", () => {
    const source = readFileSync(wizardPath, "utf8");

    expect(source).toContain(
      "message: `Use recommended app port ${defaults.port}?`"
    );
    expect(source).toContain(
      "`Use recommended app port ${defaults.port}?`,\n      true"
    );
    expect(source).toContain('message: "Custom app port"');
    expect(source).not.toContain('message: "App port"');
    expect(source).not.toContain('ask(rl, "App port", defaults.port)');

    for (const installer of ["scripts/install.sh", "scripts/install-dist.sh"]) {
      const installerSource = readFileSync(path.join(repoRoot, installer), "utf8");
      expect(installerSource).toContain(
        'read_input "Use recommended app port 8000? [Y/n]: "'
      );
      expect(installerSource).not.toContain(
        'prompt_value SEQDESK_PORT "App port" "8000"'
      );
    }
  });

  it("keeps port 8000 automatically in non-interactive installs", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "seqdesk-wizard-"));
    const outputPath = path.join(tempDir, "wizard.env");

    try {
      const result = spawnSync(process.execPath, [wizardPath], {
        encoding: "utf8",
        env: {
          ...process.env,
          SEQDESK_YES: "1",
          SEQDESK_WIZARD_OUT: outputPath,
          SEQDESK_WIZARD_DEFAULT_PORT: "8000",
          SEQDESK_PORT: "",
        },
      });

      expect(result.status).toBe(0);
      expect(readFileSync(outputPath, "utf8")).toContain(
        'SEQDESK_PORT="8000"'
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
