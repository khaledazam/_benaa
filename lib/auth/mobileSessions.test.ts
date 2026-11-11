import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
vi.mock('@/utils/auth', () => ({
  generateToken: (id: string, version: number, mobile: any) => `access:${id}:${version}:${mobile.sessionId}`,
  isAccountAccessAllowed: (u: any) => u.status !== false,
}));
import { issueMobileSession, rotateMobileSession } from './mobileSessions';

function fixture() {
  const user = { id: '100000000000000000000001', password: randomBytes(32).toString('hex'), status: true, sessionVersion: 0 };
  const grants = new Map<string, any>(), audit: any[] = [];
  const tx = { user: { findUnique: async () => user, update: async () => user },
    mobileSession: {
      create: async ({ data }: any) => { grants.set(data.id, { ...data, revokedAt: null }); return grants.get(data.id); },
      findUnique: async ({ where }: any) => grants.get(where.id),
      update: async ({ where, data }: any) => {
        const old = grants.get(where.id);
        grants.set(where.id, { ...old, ...data,
          usedDigests: data.usedDigests ? [...old.usedDigests, data.usedDigests.push] : old.usedDigests });
        return grants.get(where.id);
      },
    }, auditLog: { create: async ({ data }: any) => { audit.push(data); return data; } } };
  return { user, grants, audit, db: { $transaction: async (work: any) => work(tx) } };
}
describe('rotating server-side mobile sessions', () => {
  it('stores hashes only and rotates once; reuse commits revocation of the whole grant', async () => {
    const f = fixture();
    const first = await issueMobileSession(f.db, f.user);
    const second = await rotateMobileSession(f.db, first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    const stored = JSON.stringify([...f.grants.values(), ...f.audit]);
    expect(stored).not.toContain(first.refreshToken.split('.')[1]);
    expect(stored).not.toContain(second.refreshToken.split('.')[1]);
    await expect(rotateMobileSession(f.db, first.refreshToken)).rejects.toMatchObject({ status: 401 });
    expect([...f.grants.values()][0].revokedAt).toBeInstanceOf(Date);
    await expect(rotateMobileSession(f.db, second.refreshToken)).rejects.toMatchObject({ status: 401 });
    expect(f.audit.some(a => a.action === 'mobile_refresh_reuse_rejected')).toBe(true);
  });
  it('a random incorrect secret cannot revoke another employee session', async () => {
    const f = fixture(), issued = await issueMobileSession(f.db, f.user);
    const forged = issued.refreshToken.split('.')[0] + '.' + randomBytes(32).toString('base64url');
    await expect(rotateMobileSession(f.db, forged)).rejects.toMatchObject({ status: 401 });
    expect([...f.grants.values()][0].revokedAt).toBeNull();
    await expect(rotateMobileSession(f.db, issued.refreshToken)).resolves.toHaveProperty('sessionId');
  });
  it.each(['disabled', 'version', 'expired'])('rejects %s employee/grant without issuing a new credential', async mode => {
    const f = fixture(), issued = await issueMobileSession(f.db, f.user);
    if (mode === 'disabled') f.user.status = false;
    if (mode === 'version') f.user.sessionVersion++;
    if (mode === 'expired') [...f.grants.values()][0].expiresAt = new Date(0);
    await expect(rotateMobileSession(f.db, issued.refreshToken)).rejects.toMatchObject({ status: 401 });
    expect([...f.grants.values()][0].usedDigests).toHaveLength(0);
  });
  it('rejects a password changed between verification and grant issuance', async () => {
    const f = fixture(), verified = { ...f.user };
    f.user.password = randomBytes(32).toString('hex');
    await expect(issueMobileSession(f.db, verified)).rejects.toMatchObject({ status: 401 });
    expect(f.grants.size).toBe(0);
  });
});
