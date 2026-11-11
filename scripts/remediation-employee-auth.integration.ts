/** Disposable loopback replica only. No .env loading, Atlas access or db push. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import { manageEmployee } from '@/lib/auth/employeeManagement';
import { recordSessionRevocation, sessionTokenDigest } from '@/lib/auth/sessionRevocation';
import { applyTransferOperation } from '@/lib/inventory/transferLifecycle';

let replica: MongoMemoryReplSet | undefined;
let db: PrismaClient;
let actor: any;
let warehouse: any;
const password = 'Synthetic-employee-password-123';
beforeAll(async () => {
  const binary = process.platform === 'win32'
    ? path.join(process.env.USERPROFILE || '', '.cache', 'mongodb-binaries', 'mongod-x64-win32-8.2.6.exe')
    : process.env.BENAA_TEST_MONGOD;
  if (!binary || !path.isAbsolute(binary) || !fs.existsSync(binary)) throw new Error('Explicit local test mongod required');
  process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
  replica = await MongoMemoryReplSet.create({ binary: { systemBinary: binary, version: '8.2.6' }, replSet: { count: 1, ip: '127.0.0.1' } });
  const uri = replica.getUri(`benaa_audit_${Date.now()}`);
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/benaa_audit_\d+\?/.test(uri)) throw new Error('Non-isolated target rejected');
  db = new PrismaClient({ datasources: { db: { url: uri } } });
  await db.$connect();
  await db.$runCommandRaw({ createIndexes: 'User', indexes: [
    { key: { email: 1 }, name: 'audit_email_unique', unique: true },
    { key: { username: 1 }, name: 'audit_username_unique', unique: true, partialFilterExpression: { username: { $type: 'string' } } },
  ] });
  await db.$runCommandRaw({ createIndexes: 'RevokedSession', indexes: [
    { key: { tokenDigest: 1 }, name: 'audit_token_digest_unique', unique: true },
  ] });
  actor = await db.user.create({ data: { email: 'admin@isolated.test', username: 'audit-admin', password: 'unused', name: 'Audit Admin', role: 'SUPER_ADMIN', status: true, warehouseIds: [], permissions: [], createdAt: new Date() } });
  warehouse = await db.warehouse.create({ data: { code: 'AUTH-TEST', name: 'Isolated warehouse', userId: actor.id, createdBy: actor.id } });
}, 60000);
afterAll(async () => { await db?.$disconnect(); await replica?.stop(); });
describe('transactional employee administration', () => {
  it('creates independent username credentials without expiry, customer debt or financial records', async () => {
    const employee = await manageEmployee(db, actor.id, { name: 'Synthetic employee', username: ' Employee-01 ', password, primaryWarehouseId: warehouse.id }, false);
    expect(employee.username).toBe('employee-01'); expect(employee.subscriptionEndDate).toBeNull();
    expect(employee.warehouseIds).toEqual([warehouse.id]); expect(employee).not.toHaveProperty('password');
    const stored = await db.user.findUniqueOrThrow({ where: { id: employee.id } });
    expect(await bcrypt.compare(password, stored.password!)).toBe(true);
    expect(stored.password).not.toBe(password);
    expect(await db.invoice.count()).toBe(0); expect(await db.salesOrder.count()).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: employee.id, action: 'employee_created' } });
    expect(JSON.stringify(audit)).not.toContain(password);
  });
  it('rejects a concurrent duplicate identity with exactly one committed account', async () => {
    const body = { name: 'Duplicate', username: 'concurrent-user', password };
    const results = await Promise.allSettled([manageEmployee(db, actor.id, body, false), manageEmployee(db, actor.id, body, false)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.user.count({ where: { username: 'concurrent-user' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'employee_created', entityId: (results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value.id } })).toBe(1);
  });
  it('rejects inactive warehouse assignment atomically', async () => {
    const before = await db.user.count(); const auditBefore = await db.auditLog.count();
    await expect(manageEmployee(db, actor.id, { name: 'Invalid', username: 'invalid-warehouse', password, primaryWarehouseId: 'ffffffffffffffffffffffff' }, false)).rejects.toThrow('Warehouse assignment');
    expect(await db.user.count()).toBe(before); expect(await db.auditLog.count()).toBe(auditBefore);
  });
  it('resets a password and deactivates without leaking the new credential', async () => {
    const employee = await db.user.findUniqueOrThrow({ where: { username: 'employee-01' } });
    const nextPassword = 'Replacement-audit-password-456';
    const response = await manageEmployee(db, actor.id, { id: employee.id, newPassword: nextPassword }, true);
    expect(response).not.toHaveProperty('password');
    const reset = await db.user.findUniqueOrThrow({ where: { id: employee.id } });
    expect(reset.sessionVersion).toBe(1); expect(await bcrypt.compare(nextPassword, reset.password!)).toBe(true);
    await manageEmployee(db, actor.id, { id: employee.id, status: false }, true);
    expect((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).sessionVersion).toBe(2);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { entityId: employee.id } }))).not.toContain(nextPassword);
  });
  it('preserves explicit historical access dates when changing warehouse scope', async () => {
    const employee = await db.user.findUniqueOrThrow({ where: { username: 'concurrent-user' } });
    const date = new Date('2031-01-01T00:00:00Z');
    await db.user.update({ where: { id: employee.id }, data: { subscriptionEndDate: date } });
    await manageEmployee(db, actor.id, { id: employee.id, primaryWarehouseId: warehouse.id }, true);
    expect((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).subscriptionEndDate).toEqual(date);
  });
  it('prevents removal of the last active administrator', async () => {
    await expect(manageEmployee(db, actor.id, { id: actor.id, status: false }, true)).rejects.toThrow('last active administrator');
    expect((await db.user.findUniqueOrThrow({ where: { id: actor.id } })).status).toBe(true);
  });
  it('reauthorizes the actor inside the transaction', async () => {
    const employee = await db.user.findUniqueOrThrow({ where: { username: 'concurrent-user' } });
    await expect(manageEmployee(db, employee.id, { id: actor.id, status: false }, true)).rejects.toThrow('Forbidden');
    expect((await db.user.findUniqueOrThrow({ where: { id: actor.id } })).status).toBe(true);
  });
  it('records one concurrent logout receipt and audit without retaining the bearer token', async () => {
    const token = 'synthetic-verified-token';
    const expiry = new Date(Date.now() + 3600000);
    await Promise.all([recordSessionRevocation(db, token, actor.id, expiry), recordSessionRevocation(db, token, actor.id, expiry)]);
    expect(await db.revokedSession.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'session_revoked' } })).toBe(1);
    const receipt = await db.revokedSession.findUniqueOrThrow({ where: { tokenDigest: await sessionTokenDigest(token) } });
    expect(receipt.expiresAt).toEqual(expiry); expect(JSON.stringify(receipt)).not.toContain(token);
  });
  it('reauthorizes explicit permission changes before replaying an already dispatched transfer', async () => {
    const destination = await db.warehouse.create({ data: { code: 'AUTH-DEST', name: 'Synthetic destination', userId: actor.id, createdBy: actor.id } });
    const employee = await manageEmployee(db, actor.id, { name: 'Restricted manager', username: 'restricted-manager', password, role: 'WAREHOUSE_MANAGER',
      primaryWarehouseId: warehouse.id, additionalWarehouseIds: [destination.id], permissions: ['STOCK_VIEW', 'STOCK_TRANSFER'] }, false);
    const product = await db.product.create({ data: { name: 'Permission fixture', sku: 'AUTH-PERMISSION', price: 1, quantity: 100, status: 'IN_STOCK', supplierId: actor.id, userId: actor.id, createdBy: actor.id } });
    await db.stockAllocation.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 100, reservedQuantity: 0, userId: actor.id } });
    await db.stockMovement.create({ data: { movementNumber: 'AUTH-OPENING', productId: product.id, warehouseId: warehouse.id,
      quantity: 100, quantityInBaseUnit: 100, movementType: 'OPENING_BALANCE', previousStock: 0, newStock: 100, performedBy: actor.id } });
    const created = await applyTransferOperation(db, employee, { action: 'REQUEST', productId: product.id, fromWarehouseId: warehouse.id, toWarehouseId: destination.id, quantity: 10, idempotencyKey: 'permission-request' });
    await applyTransferOperation(db, employee, { action: 'APPROVE', transferId: created.transfer.id });
    const payload = { action: 'DISPATCH', transferId: created.transfer.id, idempotencyKey: 'permission-dispatch' };
    await applyTransferOperation(db, employee, payload);
    await manageEmployee(db, actor.id, { id: employee.id, permissions: ['STOCK_VIEW'] }, true);
    await expect(applyTransferOperation(db, employee, payload)).rejects.toThrow('permission revoked');
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(90);
    expect((await db.stockTransfer.findUniqueOrThrow({ where: { id: created.transfer.id } })).inTransitQuantity).toBe(10);
    expect(await db.stockMovement.count({ where: { productId: product.id, movementType: 'TRANSFER_OUT' } })).toBe(1);
  });
  it('rejects role escalation through custom permissions with no partial employee or audit record', async () => {
    const users = await db.user.count(); const audits = await db.auditLog.count();
    await expect(manageEmployee(db, actor.id, { name: 'Forbidden', username: 'forged-permission', password, role: 'STOREKEEPER', permissions: ['USER_MANAGE'] }, false)).rejects.toThrow('exceeds assigned role');
    expect(await db.user.count()).toBe(users); expect(await db.auditLog.count()).toBe(audits);
  });
  it('rolls back a logout receipt when its immutable audit cannot be written', async () => {
    const failingDb = { $transaction: (work: any, options: any) => db.$transaction(async tx => work({
      revokedSession: tx.revokedSession, auditLog: { create: async () => { throw new Error('synthetic audit failure'); } },
    }), options) };
    const token = 'synthetic-audit-rollback-token';
    await expect(recordSessionRevocation(failingDb, token, actor.id, new Date(Date.now() + 3600000))).rejects.toThrow('synthetic audit failure');
    expect(await db.revokedSession.findUnique({ where: { tokenDigest: await sessionTokenDigest(token) } })).toBeNull();
  });
});
