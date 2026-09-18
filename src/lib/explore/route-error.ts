/** A status-carrying error for Explore request handling, shared by routes and services. */
export class ExploreRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
