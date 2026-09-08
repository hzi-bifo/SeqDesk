import { describe, expect, it } from "vitest";
import { generateInnerScript, generateLocalRunScript, generateSlurmRunScript, shellQuote } from "./run-script";

const base = {
  runId: "clrun1",
  runFolder: "/data/pipeline_runs/explore/EXP-20260904-001--id-clrun1",
  language: "python" as const,
  entrypoint: "analysis.py",
  environmentPrefix: "/net/conda/explore-environments/seqdesk-explore-python-abc",
  condaPath: "/opt/conda",
  helperLibDir: "/srv/seqdesk/explore/lib",
};

describe("explore run scripts", () => {
  it("writes the exit marker and starts the inner script with an empty environment", () => {
    const script = generateLocalRunScript(base);
    expect(script).toContain("Pipeline completed with exit code: $EXIT_CODE");
    expect(script).toContain('env -i PATH="/usr/bin:/bin"');
    expect(script).toContain('/bin/bash "$RUN_DIR/control/analysis.sh"');
    expect(script).toContain("Sandbox: none (sandboxing is switched off)");
    expect(script).toContain("logs/pipeline.out");
    expect(script).not.toContain("python analysis.py");
  });

  it("runs the analysis from the inner script with the environment prefix and the helper library", () => {
    const inner = generateInnerScript(base);
    expect(inner).toContain('export PATH="$ENV_PREFIX/bin:${PATH:-/usr/bin:/bin}"');
    expect(inner).toContain('exec python analysis.py --run-dir "$RUN_DIR"');
    expect(inner).toContain("PYTHONPATH=\"$HELPER_LIB/python");
    expect(inner).toContain('export HOME="$RUN_DIR/home"');
    expect(inner).not.toContain("DATABASE_URL");
  });

  it("confines the run with bubblewrap and refuses to run without it when required", () => {
    const sandbox = { kind: "bubblewrap" as const, mode: "required" as const, args: ["--unshare-net", "--ro-bind", "/usr", "/usr", "--bind", base.runFolder, base.runFolder], planHash: "abc123" };
    const script = generateLocalRunScript({ ...base, sandbox, timeLimitHours: 2 });
    expect(script).toContain('"$BWRAP" \\');
    expect(script.replace(/ \\\n\s+/g, " ")).toContain("--unshare-net --ro-bind /usr /usr --bind");
    expect(script).toContain("Sandbox: bubblewrap (plan abc123)");
    expect(script).toContain("exit 127");
    expect(script).toContain('LIMIT="$(command -v timeout) --signal=TERM --kill-after=60 2h"');
    const auto = generateLocalRunScript({ ...base, sandbox: { ...sandbox, mode: "auto" } });
    expect(auto).toContain("Sandbox: none (bubblewrap not installed");
    expect(auto).not.toContain("exit 127");
  });

  it("confines the run with sandbox-exec on macOS", () => {
    const script = generateLocalRunScript({ ...base, sandbox: { kind: "seatbelt", mode: "auto", profilePath: `${base.runFolder}/control/sandbox.sb`, planHash: "def456" } });
    expect(script).toContain("sandbox-exec -f");
    expect(script).toContain("Sandbox: seatbelt (plan def456)");
  });

  it("uses Rscript for R analyses", () => {
    expect(generateInnerScript({ ...base, language: "r", entrypoint: "analysis.R" })).toContain('exec Rscript analysis.R --run-dir "$RUN_DIR"');
  });

  it("writes an sbatch header with hour-based time limit and sanitized options", () => {
    const script = generateSlurmRunScript({
      ...base,
      slurm: { slurmQueue: "cpu", slurmCores: 4, slurmMemory: "32GB", slurmTimeLimit: 2, slurmOptions: "--job-name=evil --gres=gpu:1" },
    });
    expect(script).toContain("#SBATCH -t 2:0:0");
    expect(script).toContain("#SBATCH -c 4");
    expect(script).toContain("#SBATCH --mem='32GB'");
    expect(script).toContain("#SBATCH --job-name=seqdesk-clrun1");
    expect(script).toContain("#SBATCH --gres=gpu:1");
    expect(script).not.toContain("evil");
    expect(script).toContain("copy_slurm_logs; exit $EXIT_CODE");
  });

  it("falls back to safe defaults for malformed scheduler settings", () => {
    const script = generateSlurmRunScript({
      ...base,
      slurm: { slurmQueue: "bad queue;rm", slurmCores: -1, slurmMemory: "lots", slurmTimeLimit: 0.5, slurmOptions: "a\nb" },
    });
    expect(script).toContain("#SBATCH -p cpu");
    expect(script).toContain("#SBATCH -c 2");
    expect(script).toContain("#SBATCH --mem='16GB'");
    expect(script).toContain("#SBATCH -t 4:0:0");
    expect(script).not.toContain("#SBATCH a");
  });

  it("refuses run folders that could break out of the script", () => {
    expect(() => generateLocalRunScript({ ...base, runFolder: "/tmp/x'; rm -rf /" })).toThrow(/unsupported/);
    expect(() => generateLocalRunScript({ ...base, runFolder: "relative/path" })).toThrow(/unsupported/);
  });

  it("shell-quotes unusual values", () => {
    expect(shellQuote("plain-value_1")).toBe("plain-value_1");
    expect(shellQuote("has space")).toBe("'has space'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});
