import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, "..");
const nextBin = path.join(repoDir, "node_modules", "next", "dist", "bin", "next");

const child = spawn(
  process.execPath,
  [nextBin, "dev", "--webpack", "-p", process.env.PORT || "3101"],
  {
    cwd: repoDir,
    stdio: "inherit",
    env: { ...process.env },
  }
);

child.on("exit", (code) => process.exit(code ?? 0));
