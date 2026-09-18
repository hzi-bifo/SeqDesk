import { readFileSync } from 'node:fs';

export type IntegrationConfig = {
  installationId: string;
  name: string;
  collaborationOrigin: string;
  secret: string;
  webOrigins: string[];
  accounts: { workspaceId: string; memberId: string; userId: string }[];
  provisionAccounts?: boolean;
};

export function integrationOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Integration addresses must be HTTPS origins (HTTP is allowed on loopback).');
  }
  return url.origin;
}

/** Operator-controlled configuration. Nothing from discovery or a browser can
 * replace the identity authority, shared secret, or local account mapping. */
export function integrationConfig(): IntegrationConfig | null {
  const file = process.env.SEQDESK_INTEGRATION_CONFIG_FILE;
  const raw = file ? readFileSync(file, 'utf8') : process.env.SEQDESK_INTEGRATION_CONFIG;
  if (!raw) return null;
  const value = JSON.parse(raw) as IntegrationConfig;
  if (!value || typeof value.installationId !== 'string' || !value.installationId ||
    typeof value.name !== 'string' || typeof value.secret !== 'string' || value.secret.length < 32 ||
    (value.provisionAccounts !== undefined && typeof value.provisionAccounts !== 'boolean') ||
    !Array.isArray(value.webOrigins) || !value.webOrigins.length ||
    !Array.isArray(value.accounts) || !value.accounts.every(account => account &&
      typeof account.workspaceId === 'string' && account.workspaceId &&
      typeof account.memberId === 'string' && account.memberId &&
      typeof account.userId === 'string' && account.userId)) {
    throw new Error('Invalid SeqDesk integration configuration.');
  }
  const identities = value.accounts.map(account => JSON.stringify([account.workspaceId, account.memberId]));
  if (new Set(identities).size !== identities.length) throw new Error('Duplicate integration account mapping.');
  return { ...value, collaborationOrigin: integrationOrigin(value.collaborationOrigin),
    webOrigins: value.webOrigins.map(integrationOrigin) };
}
