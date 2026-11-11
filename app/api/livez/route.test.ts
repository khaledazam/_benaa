import { afterEach, expect, it, vi } from 'vitest';
import { GET } from './route';
afterEach(() => vi.unstubAllEnvs());
it('returns process liveness with no datasource requirement', async () => {
  vi.stubEnv('DATABASE_URL', ''); vi.stubEnv('BENAA_RELEASE_SHA', '');
  const response = GET(); expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ status: 'alive', build: 'unidentified' });
});
it('exposes only a valid commit identifier', async () => {
  vi.stubEnv('BENAA_RELEASE_SHA', 'a'.repeat(40)); expect((await GET().json()).build).toBe('a'.repeat(40));
  vi.stubEnv('BENAA_RELEASE_SHA', 'private configuration'); expect((await GET().json()).build).toBe('unidentified');
});
