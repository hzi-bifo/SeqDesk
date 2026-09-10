/** Client-safe JSON requests with explicit HTTP/session failures. */
export async function pipelinePageRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your session has expired. Sign in again, then retry.");
    throw new Error(typeof payload?.error === "string" ? payload.error : "The server could not complete this request. Please retry.");
  }
  if (payload === null) throw new Error("The server returned an unreadable response. Please retry.");
  return payload as T;
}
