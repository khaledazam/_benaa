import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getRedis: vi.fn(), eval: vi.fn() }));
vi.mock('./redis', () => ({ getRedis: mocks.getRedis }));
import { checkRateLimit } from './rate-limit';
const config = { limit: 10, window: 60, identifier: 'synthetic-user' };
beforeEach(() => { vi.stubEnv('NODE_ENV', 'production'); mocks.getRedis.mockReturnValue({ eval: mocks.eval }); mocks.eval.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe('distributed request admission', () => {
  it('fails closed without Redis', async () => { mocks.getRedis.mockReturnValue(null); await expect(checkRateLimit(config)).rejects.toThrow('RATE_LIMIT_UNAVAILABLE'); });
  it('fails closed on Redis outage', async () => { mocks.eval.mockRejectedValue(new Error('offline')); await expect(checkRateLimit(config)).rejects.toThrow('RATE_LIMIT_UNAVAILABLE'); });
  it.each([null, [], [1, 'invalid', 60], [3, 0, 60]])('fails closed on malformed admission result %j', async result => {
    mocks.eval.mockResolvedValue(result); await expect(checkRateLimit(config)).rejects.toThrow('RATE_LIMIT_UNAVAILABLE');
  });
  it('admits and rejects according to one atomic server-side result', async () => {
    mocks.eval.mockResolvedValueOnce([1, 10, 60]).mockResolvedValueOnce([0, 10, 60]);
    expect((await checkRateLimit(config)).allowed).toBe(true); expect((await checkRateLimit(config)).allowed).toBe(false);
    const [script, keys, args] = mocks.eval.mock.calls[0]!;
    expect(script).toContain('ZREMRANGEBYSCORE'); expect(script).toContain('PEXPIRE');
    expect(keys).toEqual(['rate-limit:synthetic-user']); expect(args.slice(1, 3)).toEqual([60000, 10]);
    expect(mocks.eval.mock.calls[1]![2][3]).not.toBe(args[3]);
  });
});
