function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type PipelineReadinessAction =
  | "install"
  | "sync"
  | "download-db"
  | "configure"
  | "configure-runtime"
  | "configure-storage"
  | "enable"
  | "review-outputs";

export interface GuidedSetupReadinessItem {
  id: string;
  label: string;
  status: "ready" | "warning" | "missing";
  detail?: string;
  action?: PipelineReadinessAction;
  href?: string;
  blocking?: boolean;
}

export function isNumericPipelineConfigType(type: string): boolean {
  return type === "number" || type === "integer";
}

export function parsePipelineConfigInputValue(
  type: string,
  value: string
): string | number | undefined {
  if (!isNumericPipelineConfigType(type)) return value;
  return value === "" ? undefined : Number(value);
}

const GUIDED_SETUP_ACTION_PRIORITY: Record<PipelineReadinessAction, number> = {
  install: 0,
  sync: 1,
  configure: 10,
  "configure-storage": 20,
  "download-db": 21,
  "configure-runtime": 30,
  enable: 40,
  "review-outputs": 50,
};

export function getNextGuidedSetupItem(readiness?: {
  items: GuidedSetupReadinessItem[];
}): GuidedSetupReadinessItem | null {
  if (!readiness) return null;

  return (
    readiness.items
      .filter(
        (
          item
        ): item is GuidedSetupReadinessItem & {
          action: PipelineReadinessAction;
        } =>
          (item.status === "missing" ||
            (item.status === "warning" && item.blocking === true) ||
            item.action === "enable") &&
          Boolean(item.action) &&
          item.action !== "review-outputs"
      )
      .sort(
        (left, right) =>
          GUIDED_SETUP_ACTION_PRIORITY[left.action] -
          GUIDED_SETUP_ACTION_PRIORITY[right.action]
      )[0] || null
  );
}

export function getGuidedSetupCatalog(
  catalogs: string[] | undefined,
  currentCatalog: "order" | "study"
): "order" | "study" {
  if (!catalogs || catalogs.length === 0 || catalogs.includes(currentCatalog)) {
    return currentCatalog;
  }
  return catalogs.includes("study") ? "study" : "order";
}

export function getPostInstallCatalogView(pipeline: {
  enabled: boolean;
  readiness?: {
    status: "ready" | "warning" | "missing";
    canEnable?: boolean;
  };
}): "installed" | "needs-setup" {
  if (
    !pipeline.enabled ||
    !pipeline.readiness ||
    pipeline.readiness.status === "missing" ||
    pipeline.readiness.canEnable === false
  ) {
    return "needs-setup";
  }
  return "installed";
}

export function getPrivatePackageUrl(source: {
  packageUrlDefault?: string;
  downloadUrl?: string;
}): string | undefined {
  return source.packageUrlDefault || source.downloadUrl;
}

export function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;

  const error =
    typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : null;
  const details =
    typeof payload.details === "string" && payload.details.trim()
      ? payload.details.trim()
      : Array.isArray(payload.details)
        ? payload.details
            .filter(
              (detail): detail is string =>
                typeof detail === "string" && detail.trim().length > 0
            )
            .map((detail) => detail.trim())
            .join("; ") || null
        : null;

  if (error && details && error !== details) {
    return `${error}: ${details}`;
  }

  return details || error || fallback;
}

export async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    const details =
      error instanceof Error && error.message.trim()
        ? `: ${error.message.trim()}`
        : "";
    throw new Error(`Request to ${url} failed${details}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    if (!response.ok) {
      throw new Error(
        `Request to ${url} failed (${status}): the server returned invalid JSON`
      );
    }
    throw new Error(`The server returned invalid JSON for ${url}`);
  }

  if (!response.ok) {
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    throw new Error(
      getApiErrorMessage(payload, `Request to ${url} failed (${status})`)
    );
  }

  return payload as T;
}
