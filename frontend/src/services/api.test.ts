import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => vi.unstubAllGlobals());

it.each(['CONFIRMATION_PENDING', 'UNRESOLVED'])('preserves HTTP 202 %s as unresolved', async (status) => {
  const body = { transactionHash: '0xhash', status, metadataStatus: 'NOT_UPDATED' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 202 })));
  expect(await api.issuance.submitIssueTx('draft', '0xhash')).toEqual(body);
});

it('retains receipt and retry evidence in HTTP 503 errors', async () => {
  const body = { transactionHash: '0xhash', status: 'CONFIRMED', metadataStatus: 'RECONCILIATION_REQUIRED', reason: 'DATABASE_UNAVAILABLE', retry: { transactionHash: '0xhash' } };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 503 })));
  const error = await api.certificates.revokeTransaction('id', '0xhash').catch(e => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.status).toBe(503);
  expect(error.payload).toEqual(body);
});
