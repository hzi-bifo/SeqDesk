// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StudyCohort } from './StudyCohort';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('refreshes the parent analysis sample list after linking a control', async () => {
  const refreshStudy = vi.fn();
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    const value = url === '/api/samples' ? [{ id: 'control', sampleId: 'INTERNAL_CONTROL', orderId: 'import-entry' }] : init?.method === 'POST' ? { member: { sampleId: 'control' } } : { members: [] };
    return { ok: true, json: async () => value };
  });
  vi.stubGlobal('fetch', request);
  render(<StudyCohort studyId="analysis" onChange={refreshStudy} />);
  await screen.findByRole('option', { name: 'INTERNAL_CONTROL' });
  fireEvent.change(screen.getByLabelText('Cohort sample'), { target: { value: 'control' } });
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'control' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add / update membership' }));
  await waitFor(() => expect(refreshStudy).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledWith('/api/studies/analysis/cohort', expect.objectContaining({ method: 'POST', body: JSON.stringify({ sampleId: 'control', role: 'control', groupLabel: null }) }));
  expect(screen.queryByText(/connected later/)).toBeNull();
});
