/**
 * Settings › Data sources for the collaboration web app (sheet S-124), through the integration API.
 *
 *   GET  importers/sources             every source: status word, what it needs, limits, who, on/off, last test
 *   GET  importers/sources/history     the audit: every change and every test, newest first
 *   POST importers/sources/settings    { maxBytes?, askAboveBytes?, sources?: { id: { enabled?, who?, maxBytes?, askAboveBytes? } } }
 *   POST importers/sources/secrets     { secret: "ncbi-key", apiKey } | { secret: "dryad-account", clientId, clientSecret } ("" removes)
 *   POST importers/sources/test        { source? } one source, or all of them
 *
 * Anyone who may use the Workbench reads; only SeqDesk admins (system.settings.manage) write or test.
 */
import { NextResponse } from 'next/server';
import { decideCapability } from '@/lib/authorization';
import { getServerDeploymentProfile } from '@/lib/deployment-profile/server';
import { authorizeWorkbenchRequest } from '@/lib/workbench/server';
import { requireRawReadImporter } from '@/lib/modules/input-modules.server';
import { getWorkbenchImporter } from '@/lib/workbench/importers/registry';
import {
  applySettingsChange, DATA_SOURCES, DataSourcesError, dataSourcesHistory, dataSourcesStatus, parseSettingsChange, setSecret, sourceById, testSources,
} from '@/lib/workbench/data-sources';
import type { IntegrationSession } from './identity';

export const isDataSourcesAdmin = (session: IntegrationSession) => decideCapability(session, 'system.settings.manage', getServerDeploymentProfile()).allowed;

const actor = (session: IntegrationSession) => {
  const user = session.user as { name?: string | null; email?: string | null; id: string };
  return user.name || user.email || user.id;
};

export async function handleDataSourcesRequest(request: Request, session: IntegrationSession, path: string[], headers: Headers, fetcher: typeof fetch = fetch): Promise<Response> {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
  const access = authorizeWorkbenchRequest(session, 'workbench.use');
  if (!access.allowed) return json({ error: 'Your SeqDesk account cannot see data sources.' }, access.response.status);
  const admin = isDataSourcesAdmin(session);
  const method = request.method;
  const route = path.slice(2).join('/');
  try {
    if (route === '' && method === 'GET') {
      return json(await dataSourcesStatus({
        moduleEnabled: async (id) => { try { await requireRawReadImporter(id); return true; } catch { return false; } },
        preflight: async (id) => (await getWorkbenchImporter(id)?.preflight()) ?? null,
      }, admin));
    }
    if (route === 'history' && method === 'GET') return json({ history: await dataSourcesHistory() });
    if (method !== 'POST') return json({ error: 'Unknown data sources route.' }, 404);
    if (!admin) return json({ error: 'Only SeqDesk admins can change data sources.' }, 403);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (route === 'settings') {
      await applySettingsChange(parseSettingsChange(body), actor(session));
      return json({ ok: true });
    }
    if (route === 'secrets') {
      const secret = body?.secret;
      if (secret !== 'ncbi-key' && secret !== 'dryad-account') return json({ error: 'Name the secret: ncbi-key or dryad-account.' }, 400);
      const text = (v: unknown) => (typeof v === 'string' ? v : '');
      await setSecret(secret, { apiKey: text(body?.apiKey), clientId: text(body?.clientId), clientSecret: text(body?.clientSecret) }, actor(session));
      return json({ ok: true });
    }
    if (route === 'test') {
      const one = typeof body?.source === 'string' ? body.source : null;
      if (one && !sourceById(one)) return json({ error: `There is no data source called ${one}.` }, 404);
      return json({ results: await testSources(one ? [one] : DATA_SOURCES.map((s) => s.id), actor(session), fetcher) });
    }
    return json({ error: 'Unknown data sources route.' }, 404);
  } catch (error) {
    if (error instanceof DataSourcesError) return json({ error: error.message }, error.status);
    // Never echo a request here: a secrets call carries the key.
    return json({ error: 'The data source settings could not be saved.' }, 500);
  }
}
