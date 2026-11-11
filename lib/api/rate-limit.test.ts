import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ check: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/cache', () => ({ checkRateLimit: mocks.check }));
vi.mock('@/utils/auth', () => ({ verifyToken: mocks.verify }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
import { defaultRateLimits, withRateLimit } from './rate-limit';
beforeEach(() => { mocks.check.mockReset(); mocks.verify.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
it('ignores forged identity and IP headers', async () => {
  const request = new NextRequest('https://api.example.com/api/products', { headers: { 'x-user-id': 'admin', 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '2.3.4.5' } });
  expect(await defaultRateLimits.standard.getIdentifier(request)).toBe('public:/api/products');
});
it('uses a verified token identity', async () => {
  mocks.verify.mockReturnValue({ userId: 'employee' });
  const request = new NextRequest('https://api.example.com/api/products', { headers: { authorization: 'Bearer synthetic' } });
  expect(await defaultRateLimits.standard.getIdentifier(request)).toBe('user:employee'); expect(mocks.verify).toHaveBeenCalledWith('synthetic');
});
it('normalizes the login bucket and does not expose credentials in its key', async () => {
  const req = (email: string) => new NextRequest('https://api.example.com/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'private-password' }) });
  const first = await defaultRateLimits.auth.getIdentifier(req(' Employee '));
  expect(first).toBe(await defaultRateLimits.auth.getIdentifier(req('employee'))); expect(first).toMatch(/^login:[a-f0-9]{64}$/);
});
it('returns 503 on production protection outage', async () => {
  vi.stubEnv('NODE_ENV', 'production'); mocks.check.mockRejectedValue(new Error('offline'));
  const response = await withRateLimit(new NextRequest('https://api.example.com/api/products'), defaultRateLimits.standard);
  expect(response?.status).toBe(503); expect(response?.headers.get('Retry-After')).toBe('30');
});
it('admits a parsed login without attempting a second body read or clone',async()=>{
  mocks.check.mockResolvedValue({allowed:true,current:1,reset:60});
  const request=new NextRequest('https://api.example.com/api/auth/login',{method:'POST',body:JSON.stringify({email:'Employee',password:'private-password'})});
  const body=await request.json();
  vi.spyOn(request,'clone').mockImplementation(()=>{throw new Error('Body already consumed');});
  expect(await withRateLimit(request,defaultRateLimits.auth,undefined,body)).toBeNull();
  expect(mocks.check).toHaveBeenCalledTimes(2);
  expect(mocks.check.mock.calls[1]?.[0].identifier).toMatch(/^login:[a-f0-9]{64}$/);
});
