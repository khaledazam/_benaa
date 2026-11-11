import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { inventoryTransaction } from '@/lib/inventory/transaction';
import { generateToken, isAccountAccessAllowed } from '@/utils/auth';

const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');
const fail = (): never => { throw Object.assign(new Error('Mobile session unavailable; sign in again'), { status: 401 }); };
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function response(id: string, user: any, secret: string) {
  return { sessionId: generateToken(user.id, user.sessionVersion ?? 0, { sessionId: id }),
    refreshToken: `${id}.${secret}`, expiresIn: 900 };
}

/** Password verification remains in the existing login route. Recheck the exact
 * verified hash/version and account status inside the grant transaction. */
export async function issueMobileSession(db: any, verified: any) {
  const id = randomBytes(12).toString('hex'), secret = randomBytes(32).toString('base64url');
  return inventoryTransaction(db, async tx => {
    const current = await tx.user.findUnique({ where: { id: verified.id } });
    if (!current || !isAccountAccessAllowed(current) || current.password !== verified.password ||
        (current.sessionVersion ?? 0) !== (verified.sessionVersion ?? 0)) fail();
    await tx.user.update({ where: { id: current.id }, data: { updatedAt: new Date() } });
    await tx.mobileSession.create({ data: { id, userId: current.id,
      sessionVersion: current.sessionVersion ?? 0, refreshDigest: digest(secret), usedDigests: [],
      expiresAt: new Date(Date.now() + 30 * 86400000) } });
    await tx.auditLog.create({ data: { userId: current.id, action: 'mobile_session_started',
      entityType: 'MobileSession', entityId: id } });
    return response(id, current, secret);
  });
}

/** Rotation is single-use and atomic. A lost refresh acknowledgment requires a
 * fresh password login, not automatic replay of a consumed refresh credential. */
export async function rotateMobileSession(db: any, token: string) {
  const match = /^([a-f0-9]{24})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) fail();
  const id = match![1]!, presented = match![2]!, presentedDigest = digest(presented);
  const nextSecret = randomBytes(32).toString('base64url');
  const result = await inventoryTransaction<any>(db, async tx => {
    const grant = await tx.mobileSession.findUnique({ where: { id } });
    if (!grant || grant.revokedAt || grant.expiresAt <= new Date()) return null;
    const user = await tx.user.findUnique({ where: { id: grant.userId } });
    if (!user || !isAccountAccessAllowed(user) || (user.sessionVersion ?? 0) !== grant.sessionVersion) return null;
    if (!same(grant.refreshDigest, presentedDigest)) {
      if (grant.usedDigests.includes(presentedDigest)) {
        await tx.mobileSession.update({ where: { id }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({ data: { userId: user.id, action: 'mobile_refresh_reuse_rejected',
          entityType: 'MobileSession', entityId: id } });
      }
      return null; // commit reuse revocation before rejecting outside the TX
    }
    if (grant.usedDigests.length >= 512) return null;
    await tx.user.update({ where: { id: user.id }, data: { updatedAt: new Date() } });
    await tx.mobileSession.update({ where: { id }, data: {
      refreshDigest: digest(nextSecret), usedDigests: { push: presentedDigest } } });
    return response(id, user, nextSecret);
  });
  if (!result) fail();
  return result;
}
