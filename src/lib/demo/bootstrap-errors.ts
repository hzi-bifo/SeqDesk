export const DEMO_DATABASE_WAKING_CODE = "demo_database_waking";
export const DEMO_DATABASE_WAKING_MESSAGE =
  "The demo database is waking up. Please wait.";

const RETRYABLE_DATABASE_ERROR_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const code = error.errorCode ?? error.code;
  return typeof code === "string" ? code.toUpperCase() : undefined;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return typeof error === "string" ? error : "";
}

export function isRetryableDemoDatabaseError(error: unknown): boolean {
  const code = readErrorCode(error);
  if (code && RETRYABLE_DATABASE_ERROR_CODES.has(code)) {
    return true;
  }

  const message = readErrorMessage(error).toLowerCase();
  return (
    message.includes("can't reach database server") ||
    message.includes("cannot reach database server") ||
    (message.includes("database server") && message.includes("timed out")) ||
    message.includes("server has closed the connection") ||
    message.includes("timed out fetching a new connection") ||
    message.includes("connection terminated unexpectedly") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  );
}
