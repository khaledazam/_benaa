import { inventoryTransaction } from '@/lib/inventory/transaction';

/** Never store or audit a bearer token itself. */
export async function sessionTokenDigest(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

/** Caller must verify signature, expiry and user ID before entering this service. */
export async function recordSessionRevocation(db: any, token: string, userId: string, expiresAt: Date, mobileSessionId?: string) {
  const tokenDigest = await sessionTokenDigest(token);
  return inventoryTransaction(db, async tx => {
    if (mobileSessionId && /^[a-f0-9]{24}$/i.test(mobileSessionId)) {
      await tx.mobileSession.updateMany({ where: { id: mobileSessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    const existing = await tx.revokedSession.findUnique({ where: { tokenDigest } });
    if (existing) return;
    const receipt = await tx.revokedSession.create({ data: { tokenDigest, userId, expiresAt } });
    await tx.auditLog.create({ data: { userId, action: 'session_revoked', entityType: 'RevokedSession', entityId: receipt.id,
      details: { scope: 'presented-token' } } });
  });
}
