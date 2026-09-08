/** Display only: retain the original identifier for storage, links and search. */
export function formatSequencingIdentifier(identifier: string): string {
  return identifier.length > 24
    ? `${identifier.slice(0, 12)}…${identifier.slice(-6)}`
    : identifier;
}
