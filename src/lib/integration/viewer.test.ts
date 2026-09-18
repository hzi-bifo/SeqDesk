import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ scopeFindFirst: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { integrationExploreScope: { findFirst: mocks.scopeFindFirst } } }));
import { viewerAllowed, viewerCookie, viewerCookieValid } from './viewer';
import type { IntegrationConfig } from './config';

const config: IntegrationConfig = { installationId: 'inst', name: 'Local', collaborationOrigin: 'https://collab.example', secret: 's'.repeat(40), webOrigins: ['https://desk.example'], accounts: [] };

describe('named report viewers', () => {
  it('admits an invited reader or a member of a lab the report is linked to, and nobody else', async () => {
    const report = { id: 'r1', targetKey: 'project:p1' };
    expect(await viewerAllowed(config, { reportId: 'r1', invited: true, workspaceIds: [] }, report)).toBe(true);
    expect(await viewerAllowed(config, { reportId: 'other', invited: true, workspaceIds: [] }, report)).toBe(false);
    mocks.scopeFindFirst.mockResolvedValue(null);
    expect(await viewerAllowed(config, { reportId: 'r1', invited: false, workspaceIds: ['ws-b'] }, report)).toBe(false);
    mocks.scopeFindFirst.mockResolvedValue({ id: 'link' });
    expect(await viewerAllowed(config, { reportId: 'r1', invited: false, workspaceIds: ['ws-a'] }, report)).toBe(true);
    expect(mocks.scopeFindFirst.mock.calls.at(-1)?.[0].where).toEqual({ authority: 'https://collab.example', targetKey: 'project:p1', workspaceId: { in: ['ws-a'] } });
    expect(await viewerAllowed(config, { reportId: 'r1', invited: false, workspaceIds: [] }, report)).toBe(false);
  });
  it('keeps an admitted reader in with a cookie bound to the report and the secret', () => {
    const cookie = viewerCookie(config, 'r1');
    expect(cookie.name).toBe('seqdesk_report_r1');
    expect(viewerCookieValid(config, 'r1', cookie.value)).toBe(true);
    expect(viewerCookieValid(config, 'r2', cookie.value)).toBe(false);
    expect(viewerCookieValid({ ...config, secret: 'x'.repeat(40) }, 'r1', cookie.value)).toBe(false);
    expect(viewerCookieValid(config, 'r1', cookie.value.replace(/\.[^.]+$/, '.tampered'))).toBe(false);
    expect(viewerCookieValid(config, 'r1', undefined)).toBe(false);
  });
});
