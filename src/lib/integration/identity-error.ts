export class IntegrationAccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
