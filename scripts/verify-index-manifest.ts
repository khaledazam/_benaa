import type { Db } from 'mongodb';

export interface RequiredIndexManifest {
  schemaSha256: string;
  models: { model: string; collection: string; indexes: {
    name: string; key: Record<string, number>; unique: boolean; primary: boolean; nullableFields: string[];
  }[] }[];
}
/** Explicit fresh-database policy; never apply blindly to historical usernames. */
export function expectedPartialIndex(model: string, index: RequiredIndexManifest['models'][number]['indexes'][number]) {
  if (!index.unique || !index.nullableFields.length) return undefined;
  if (model !== 'User' || JSON.stringify(index.key) !== JSON.stringify({ username: 1 })) throw new Error('Nullable unique policy requires review');
  return { username: { $type: 'string' } };
}
/** Read-only verification. Does not create collections, write records or alter indexes. */
export async function verifyIndexManifest(db: Db, manifest: RequiredIndexManifest) {
  const collections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name));
  const failures: { collection: string; index?: string; reason: string }[] = [];
  let checked = 0;
  for (const model of manifest.models) {
    if (!collections.has(model.collection)) { failures.push({ collection: model.collection, reason: 'Missing collection' }); continue; }
    const actual = await db.collection(model.collection).listIndexes().toArray();
    for (const expected of model.indexes) {
      checked++;
      const found = actual.find(index => JSON.stringify(index.key) === JSON.stringify(expected.key));
      if (!found) { failures.push({ collection: model.collection, index: expected.name, reason: 'Missing key definition' }); continue; }
      if (!expected.primary && !!found.unique !== expected.unique) failures.push({ collection: model.collection, index: expected.name, reason: 'Unique setting mismatch' });
      const partial = expectedPartialIndex(model.model, expected);
      if (JSON.stringify(found.partialFilterExpression) !== JSON.stringify(partial)) failures.push({ collection: model.collection, index: expected.name, reason: 'Partial-filter mismatch' });
      if (found.sparse) failures.push({ collection: model.collection, index: expected.name, reason: 'Unexpected sparse index' });
      if (found.collation && found.collation.locale !== 'simple') failures.push({ collection: model.collection, index: expected.name, reason: 'Unexpected collation' });
    }
  }
  return { status: failures.length ? 'FAIL' : 'PASS', schemaSha256: manifest.schemaSha256, checkedIndexes: checked, failures };
}
