import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), revoked: vi.fn() }));
vi.mock('@/prisma/client', () => ({ prisma: { user: { findUnique: mocks.findUnique }, revokedSession: { findUnique: mocks.revoked } } }));
import { generateToken, getSessionFromRequest, verifyToken } from '@/utils/auth';
const id = '0123456789abcdef01234567';
beforeEach(() => { vi.stubEnv('JWT_SECRET', 'Synthetic-Only-Audit-Key-0123456789abcdef'); mocks.findUnique.mockReset(); mocks.revoked.mockReset().mockResolvedValue(null); });
afterEach(() => vi.unstubAllEnvs());
const request = (token: string) => ({ headers: new Headers({ authorization: `Bearer ${token}` }) });
it('rejects a previously issued token after a password reset increments session version', async () => {
  const token = generateToken(id, 0); mocks.findUnique.mockResolvedValue({ id, status: true, sessionVersion: 1 });
  expect(await getSessionFromRequest(request(token))).toBeNull();
  expect(await getSessionFromRequest(request(generateToken(id, 1)))).toMatchObject({ id });
});
it('rejects deactivated accounts on every authenticated request', async () => {
  mocks.findUnique.mockResolvedValue({ id, status: false, sessionVersion: 0 });
  expect(await getSessionFromRequest(request(generateToken(id)))).toBeNull();
});
it('issues distinct tokens to simultaneous devices and rejects a revoked token', async () => {
  const first = generateToken(id); const second = generateToken(id); expect(first).not.toBe(second);
  mocks.findUnique.mockResolvedValue({ id, status: true, sessionVersion: 0 });
  mocks.revoked.mockResolvedValueOnce({ id: 'revocation' }).mockResolvedValueOnce(null);
  expect(await getSessionFromRequest(request(first))).toBeNull();
  expect(await getSessionFromRequest(request(second))).toMatchObject({ id });
});
it('resolves current warehouse and role rather than stale token permissions', async () => {
  const current = { id, status: true, sessionVersion: 0, role: 'VIEWER', warehouseIds: ['new-warehouse'] };
  mocks.findUnique.mockResolvedValue(current);
  expect(await getSessionFromRequest(request(generateToken(id)))).toEqual(current);
});
it('preserves legacy tokens only until versioned revocation', async () => {
  const legacy = jwt.sign({ userId: id }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1d' });
  mocks.findUnique.mockResolvedValue({ id, status: true, sessionVersion: null });
  expect(await getSessionFromRequest(request(legacy))).toMatchObject({ id });
  mocks.findUnique.mockResolvedValue({ id, status: true, sessionVersion: 1 });
  expect(await getSessionFromRequest(request(legacy))).toBeNull();
});
it('rejects expired and incorrectly signed tokens before querying users', async () => {
  const expired = jwt.sign({ userId: id }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: -1 });
  expect(verifyToken(expired)).toBeNull();
  expect(verifyToken(jwt.sign({ userId: id }, 'other-signing-key', { expiresIn: '1d' }))).toBeNull();
  expect(mocks.findUnique).not.toHaveBeenCalled();
});
