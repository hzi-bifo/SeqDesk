/** A status-carrying error for Explore request handling, shared by routes and services. */
export class ExploreRouteError extends Error {
  status: number;
  /** Machine-readable code for the Flow API (`revision_conflict`, `run_active`, ...). */
  code?: string;
  /** Extra fields sent next to `error` and `code`. */
  extra?: Record<string, unknown>;

  constructor(status: number, message: string, code?: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    if (code) this.code = code;
    if (extra) this.extra = extra;
  }
}
