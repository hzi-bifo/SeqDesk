function fail(message, details) {
  throw new Error(details ? `${message}\n${details}` : message);
}

function summarizeBody(body) {
  if (!body) return "";
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length <= 1000 ? compact : `${compact.slice(0, 997)}...`;
}

export function assertPipelineSyncPayload(payload, context = "Pipeline run sync") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(`${context} returned a non-object payload`, JSON.stringify(payload));
  }
  if (payload.success !== true) {
    fail(
      `${context} did not report success`,
      JSON.stringify(payload, null, 2),
    );
  }
  if (typeof payload.synced !== "boolean") {
    fail(
      `${context} returned no boolean synced state`,
      JSON.stringify(payload, null, 2),
    );
  }
  if (
    Object.hasOwn(payload, "status") &&
    (typeof payload.status !== "string" || payload.status.trim().length === 0)
  ) {
    fail(
      `${context} returned an invalid status`,
      JSON.stringify(payload, null, 2),
    );
  }
  if (Object.hasOwn(payload, "error")) {
    fail(
      `${context} returned an error payload despite HTTP success`,
      JSON.stringify(payload, null, 2),
    );
  }
  return payload;
}

export async function syncPipelineRunFailClosed(
  client,
  runId,
  { context = `Sync pipeline run ${runId}` } = {},
) {
  const response = await client.request(
    `/api/pipelines/runs/${encodeURIComponent(runId)}/sync`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    fail(`${context} failed (${response.status})`, summarizeBody(body));
  }

  let payload;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch (error) {
    fail(
      `${context} returned invalid JSON`,
      error instanceof Error
        ? `${error.message}\n${summarizeBody(body)}`
        : summarizeBody(body),
    );
  }
  return assertPipelineSyncPayload(payload, context);
}
