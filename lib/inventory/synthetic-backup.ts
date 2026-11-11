import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { serialize, deserialize } from "bson";

function isolated(client: any, name: string, allowed: readonly string[]) {
  const hosts = client.options.hosts || [];
  if (!/^benaa_(audit|remediation|restore)_[a-zA-Z0-9_]+$/.test(name) || !allowed.includes(name) ||
      client.options.srvHost || !hosts.length || hosts.some((h: any) => !["127.0.0.1", "localhost", "::1"].includes(h.host))) {
    throw new Error("Backup/restore is restricted to exact disposable local database identifiers");
  }
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Consistent BSON snapshot for synthetic staging only, including indexes and
 * native ObjectId/Date types. It never reads .env and cannot target Atlas. */
export async function backupSyntheticDatabase(client: any, name: string, directory: string, allowed: readonly string[]) {
  isolated(client, name, allowed);
  await fs.mkdir(directory, { recursive: false });
  const db = client.db(name);
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).filter((c: any) => !c.name.startsWith("system."));
  const manifest: any = { format: "BENAA-SYNTHETIC-BSON-v1", sourceDatabase: name, createdAt: new Date().toISOString(), collections: [] };
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      manifest.collections = [];
      for (const collection of collections) {
        if (!/^[a-zA-Z0-9_]+$/.test(collection.name)) throw new Error("Unsupported collection name");
        const documents = await db.collection(collection.name).find({}, { session }).sort({ _id: 1 }).toArray();
        const bytes = serialize({ documents });
        const file = `${collection.name}.bson`;
        await fs.writeFile(path.join(directory, file), bytes);
        const indexes = await db.collection(collection.name).indexes();
        manifest.collections.push({ name: collection.name, file, count: documents.length, sha256: hash(bytes), indexes });
      }
    }, { readConcern: { level: "snapshot" } });
  } finally { await session.endSession(); }
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function restoreSyntheticDatabase(client: any, name: string, directory: string, allowed: readonly string[]) {
  isolated(client, name, allowed);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.format !== "BENAA-SYNTHETIC-BSON-v1" || manifest.sourceDatabase === name) throw new Error("Restore requires a distinct empty disposable database");
  const db = client.db(name);
  if ((await db.listCollections().toArray()).length) throw new Error("Restore refuses to overwrite an existing database");
  // Verify every archive before creating any target collection.
  const prepared = [];
  for (const entry of manifest.collections) {
    if (!/^[a-zA-Z0-9_]+$/.test(entry.name) || entry.file !== `${entry.name}.bson`) throw new Error("Invalid backup manifest path");
    const bytes = await fs.readFile(path.join(directory, entry.file));
    if (hash(bytes) !== entry.sha256) throw new Error("Backup integrity check failed");
    const documents = deserialize(bytes).documents;
    if (!Array.isArray(documents) || documents.length !== entry.count) throw new Error("Backup record count mismatch");
    prepared.push({ entry, documents });
  }
  for (const { entry, documents } of prepared) {
    await db.createCollection(entry.name);
    if (documents.length) await db.collection(entry.name).insertMany(documents);
    for (const index of entry.indexes) {
      if (index.name === "_id_") continue;
      const { key, name: indexName, unique, sparse, expireAfterSeconds, partialFilterExpression } = index;
      await db.collection(entry.name).createIndex(key, { name: indexName, ...(unique !== undefined ? { unique } : {}), ...(sparse !== undefined ? { sparse } : {}),
        ...(expireAfterSeconds !== undefined ? { expireAfterSeconds } : {}), ...(partialFilterExpression ? { partialFilterExpression } : {}) });
    }
    const restored = await db.collection(entry.name).find().sort({ _id: 1 }).toArray();
    if (hash(serialize({ documents: restored })) !== entry.sha256) throw new Error("Restored BSON records do not match backup");
  }
  return { restoredDatabase: name, collections: prepared.length, records: prepared.reduce((n, item) => n + item.documents.length, 0), hashesVerified: true };
}
