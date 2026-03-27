import { spawn } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const scriptPath = path.join(
  process.cwd(),
  "pipelines",
  "reads-qc",
  "workflow",
  "bin",
  "extract_seqkit_stats.awk"
);

async function runAwk(input: string) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("awk", ["-f", scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      reject(new Error(stderr || `awk exited with code ${code}`));
    });

    child.stdin.end(input);
  });
}

describe("extract_seqkit_stats.awk", () => {
  it("extracts fields by header name when seqkit includes N50_num", async () => {
    const input = [
      "file\tformat\ttype\tnum_seqs\tsum_len\tmin_len\tavg_len\tmax_len\tQ1\tQ2\tQ3\tsum_gap\tN50\tN50_num\tQ20(%)\tQ30(%)\tAvgQual\tGC(%)\tsum_n",
      "/tmp/sample.fastq.gz\tFASTQ\tDNA\t1000\t150000\t150\t150.0\t150\t150\t150\t150\t0\t150\t1\t99\t94\t31.44\t51.33\t0",
      "",
    ].join("\n");

    const { stdout, stderr } = await runAwk(input);

    expect(stderr).toBe("");
    expect(stdout).toBe("1000\t150000\t150\t150.0\t150\t150\t99\t94\t31.44");
  });

  it("also supports older seqkit output without N50_num", async () => {
    const input = [
      "file\tformat\ttype\tnum_seqs\tsum_len\tmin_len\tavg_len\tmax_len\tQ1\tQ2\tQ3\tsum_gap\tN50\tQ20(%)\tQ30(%)\tAvgQual\tGC(%)\tsum_n",
      "/tmp/sample.fastq.gz\tFASTQ\tDNA\t500\t75000\t150\t150.0\t150\t150\t150\t150\t0\t150\t98\t93\t30.55\t50.10\t0",
      "",
    ].join("\n");

    const { stdout, stderr } = await runAwk(input);

    expect(stderr).toBe("");
    expect(stdout).toBe("500\t75000\t150\t150.0\t150\t150\t98\t93\t30.55");
  });
});
