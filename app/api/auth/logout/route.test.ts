import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock('@/utils/auth', () => ({ revokePresentedSession: mocks.revoke }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
import { POST } from './route';
beforeEach(() => { mocks.revoke.mockReset().mockResolvedValue(undefined); });
it('clears the cookie only after server-side revocation succeeds', async () => {
  const request = new NextRequest('https://api.example.com/api/auth/logout', { method: 'POST' });
  const response = await POST(request); expect(response.status).toBe(200);
  expect(mocks.revoke).toHaveBeenCalledWith(request); expect(response.cookies.get('session_id')?.value).toBe('');
});
it('never reports confirmed logout when revocation storage fails', async () => {
  mocks.revoke.mockRejectedValue(new Error('isolated unavailable store'));
  const response = await POST(new NextRequest('https://api.example.com/api/auth/logout', { method: 'POST' }));
  expect(response.status).toBe(500); expect((await response.json()).success).not.toBe(true);
});
