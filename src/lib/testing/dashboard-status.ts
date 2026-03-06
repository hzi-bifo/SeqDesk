import fs from "fs/promises";
import path from "path";
import type { DashboardStatus } from "./dashboard";

const DASHBOARD_DIR = path.join(process.cwd(), ".test-dashboard");

export function getDashboardDirectory(): string {
  return DASHBOARD_DIR;
}

export function getDashboardStatusFilePath(fileName: string = "status.json"): string {
  return path.join(DASHBOARD_DIR, fileName);
}

export async function readDashboardStatus(
  filePath: string = getDashboardStatusFilePath()
): Promise<DashboardStatus | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as DashboardStatus;
  } catch {
    return null;
  }
}

export async function writeDashboardStatus(
  status: DashboardStatus,
  filePath: string = getDashboardStatusFilePath()
): Promise<void> {
  await fs.mkdir(DASHBOARD_DIR, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(status, null, 2));
}

export async function clearDashboardStatus(
  filePath: string = getDashboardStatusFilePath()
): Promise<void> {
  await fs.rm(filePath, { force: true });
}
