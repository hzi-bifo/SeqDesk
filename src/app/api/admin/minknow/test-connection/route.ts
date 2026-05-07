import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { promises as fs } from "fs";
import net from "net";
import { authOptions } from "@/lib/auth";

interface CheckResult {
  ok: boolean;
  detail: string;
}

async function checkOutputDir(outputRoot: string): Promise<CheckResult> {
  if (!outputRoot) {
    return { ok: false, detail: "Output root not configured" };
  }
  try {
    const stat = await fs.stat(outputRoot);
    if (!stat.isDirectory()) {
      return { ok: false, detail: `${outputRoot} exists but is not a directory` };
    }
    return { ok: true, detail: `Reachable: ${outputRoot}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `Cannot read ${outputRoot}: ${msg}` };
  }
}

async function checkTcpPort(host: string, port: number, timeoutMs = 3000): Promise<CheckResult> {
  return new Promise<CheckResult>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true, detail: `TCP connect to ${host}:${port} succeeded` }));
    socket.once("timeout", () => finish({ ok: false, detail: `TCP connect to ${host}:${port} timed out` }));
    socket.once("error", (err) => finish({ ok: false, detail: `TCP connect to ${host}:${port} failed: ${err.message}` }));
    socket.connect(port, host);
  });
}

async function checkCertPath(path: string): Promise<CheckResult> {
  if (!path) return { ok: true, detail: "TLS cert not configured (gRPC will use insecure or skip)" };
  try {
    await fs.access(path, fs.constants.R_OK);
    return { ok: true, detail: `TLS CA cert readable at ${path}` };
  } catch {
    return { ok: false, detail: `TLS CA cert not readable at ${path}` };
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const host = typeof body?.host === "string" && body.host.length > 0 ? body.host : "localhost";
  const grpcPort = Number(body?.grpcPort ?? 9501);
  const outputRoot = typeof body?.outputRoot === "string" ? body.outputRoot : "";
  const tlsCaCertPath = typeof body?.tlsCaCertPath === "string" ? body.tlsCaCertPath : "";

  const [outputCheck, portCheck, certCheck] = await Promise.all([
    checkOutputDir(outputRoot),
    checkTcpPort(host, grpcPort),
    checkCertPath(tlsCaCertPath),
  ]);

  return NextResponse.json({
    overallOk: outputCheck.ok && (portCheck.ok || certCheck.ok),
    checks: {
      outputDir: outputCheck,
      grpcPort: portCheck,
      tlsCert: certCheck,
    },
  });
}
