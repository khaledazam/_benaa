/** Full index creation is restricted to this newly owned, empty loopback fixture. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isolatedTestMongod } from './isolated-test-mongod';
import { expectedPartialIndex, verifyIndexManifest, type RequiredIndexManifest } from './verify-index-manifest';

let replica: MongoMemoryReplSet | undefined;
let client: MongoClient;
let db: ReturnType<MongoClient['db']>;
const manifest: RequiredIndexManifest = JSON.parse(fs.readFileSync(path.resolve('prisma/inventory-index-manifest.json'), 'utf8'));
beforeAll(async () => {
  expect(manifest.schemaSha256).toBe(createHash('sha256').update(fs.readFileSync(path.resolve('prisma/schema.prisma'))).digest('hex'));
  process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
  replica = await MongoMemoryReplSet.create({ binary: { systemBinary: isolatedTestMongod(), version: '8.2.6' }, replSet: { count: 1, ip: '127.0.0.1' } });
  const databaseName = `benaa_audit_indexes_${Date.now()}`;
  const uri = replica.getUri(databaseName);
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/benaa_audit_indexes_\d+\?/.test(uri)) throw new Error('Non-owned fixture target');
  client = await MongoClient.connect(uri); db = client.db(databaseName);
  if ((await db.listCollections().toArray()).length) throw new Error('Index initialization requires a fresh empty fixture');
  for (const model of manifest.models) {
    await db.createCollection(model.collection);
    for (const index of model.indexes) {
      if (index.primary) continue;
      const partial = expectedPartialIndex(model.model, index);
      await db.collection(model.collection).createIndex(index.key as any, { name: index.name, unique: index.unique,
        ...(partial ? { partialFilterExpression: partial } : {}) });
    }
  }
}, 60000);
afterAll(async () => { await client?.close(); await replica?.stop(); });
it('verifies every schema-derived index on a real disposable replica set', async () => {
  const result = await verifyIndexManifest(db, manifest);
  expect(result.status).toBe('PASS'); expect(result.failures).toEqual([]);
  expect(result.checkedIndexes).toBe(manifest.models.reduce((sum, model) => sum + model.indexes.length, 0));
  fs.mkdirSync(path.resolve('../docs/PRODUCTION_CERTIFICATION/evidence'), { recursive: true });
  fs.writeFileSync(path.resolve('../docs/PRODUCTION_CERTIFICATION/evidence/render-index-verification.json'), JSON.stringify({ ...result,
    scope: 'fresh disposable loopback database only; no Atlas verification', collections: manifest.models.length }, null, 2));
});
it('allows multiple missing historical usernames but rejects duplicate registered usernames', async () => {
  const users = db.collection('User');
  await users.insertMany([{ email: 'first@isolated.test' }, { email: 'second@isolated.test' }]);
  await users.insertOne({ email: 'third@isolated.test', username: 'unique-employee' });
  await expect(users.insertOne({ email: 'fourth@isolated.test', username: 'unique-employee' })).rejects.toMatchObject({ code: 11000 });
  expect(await users.countDocuments()).toBe(3);
});
it('read-only verification reports a missing required index without repairing it', async () => {
  // This deliberate defect belongs exclusively to the owned disposable fixture.
  const index = manifest.models.find(model => model.model === 'RevokedSession')!.indexes.find(index => !index.primary && !index.unique)!;
  await db.collection('RevokedSession').dropIndex(index.name);
  const result = await verifyIndexManifest(db, manifest);
  expect(result.status).toBe('FAIL'); expect(result.failures).toContainEqual({ collection: 'RevokedSession', index: index.name, reason: 'Missing key definition' });
  expect((await db.collection('RevokedSession').listIndexes().toArray()).some(row => row.name === index.name)).toBe(false);
});
