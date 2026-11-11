import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ session: vi.fn(), findMany: vi.fn(), count: vi.fn() }));
vi.mock('@/utils/auth', () => ({ getSessionFromRequest: mocks.session }));
vi.mock('@/prisma/client', () => ({ prisma: { invoice: { findMany: mocks.findMany, count: mocks.count } } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/email/notifications', () => ({ sendInvoiceEmail: vi.fn() }));
vi.mock('@/lib/api/rate-limit', () => ({ withRateLimit: vi.fn(async () => null), defaultRateLimits: { standard: {} } }));
vi.mock('@/lib/cache', () => ({ scheduleInvalidateInvoiceCaches: vi.fn() }));
import { POST, GET } from './route';
beforeEach(() => { vi.stubEnv('INTERNAL_API_KEY', ''); mocks.session.mockResolvedValue(null); mocks.findMany.mockReset().mockResolvedValue([]); mocks.count.mockReset().mockResolvedValue(0); });
afterEach(() => vi.unstubAllEnvs());
it.each(['Bearer undefined', 'Bearer ', 'Bearer null'])('rejects missing-key authorization %s without datasource access', async authorization => {
  const result = await POST(new NextRequest('https://api.example.com/api/invoices/reminders', { method: 'POST', headers: { authorization } }));
  expect(result.status).toBe(401); expect(mocks.findMany).not.toHaveBeenCalled();
});
it('rejects short configured internal keys', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'short');
  expect((await POST(new NextRequest('https://api.example.com/api/invoices/reminders', { method: 'POST', headers: { authorization: 'Bearer short' } }))).status).toBe(401);
});
it('accepts an exact strong internal key', async () => {
  const key = 'Synthetic-Only-Internal-Key-0123456789abcdef'; vi.stubEnv('INTERNAL_API_KEY', key);
  expect((await POST(new NextRequest('https://api.example.com/api/invoices/reminders', { method: 'POST', headers: { authorization: `Bearer ${key}` } }))).status).toBe(200);
});
it('accepts current SUPER_ADMIN permission for reminder count', async () => {
  mocks.session.mockResolvedValue({ role: 'SUPER_ADMIN' }); expect((await GET(new NextRequest('https://api.example.com/api/invoices/reminders'))).status).toBe(200);
});
it('rejects a storekeeper before reading reminders', async () => {
  mocks.session.mockResolvedValue({ role: 'STOREKEEPER' }); expect((await GET(new NextRequest('https://api.example.com/api/invoices/reminders'))).status).toBe(401);
  expect(mocks.count).not.toHaveBeenCalled();
});
