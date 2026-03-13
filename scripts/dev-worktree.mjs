import { spawn } from "child_process";

const child = spawn(
  process.execPath,
  ["/Users/pmu15/Documents/github.com/hzi-bifo/SeqDesk/node_modules/next/dist/bin/next", "dev", "--webpack", "-p", process.env.PORT || "3101"],
  {
    cwd: "/Users/pmu15/Documents/github.com/hzi-bifo/SeqDesk",
    stdio: "inherit",
    env: { ...process.env },
  }
);

child.on("exit", (code) => process.exit(code ?? 0));
