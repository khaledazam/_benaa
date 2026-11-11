// Authorized isolated-target discovery only. Never opens the configured customer DB.
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const output = path.resolve(__dirname, '../../BENAA_CLIENT_DELIVERY/PRODUCTION_RELEASE/evidence');
fs.mkdirSync(output, { recursive: true });
async function main() {
  const raw = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
  const match = raw.match(/^\s*DATABASE_URL\s*=\s*["']?([^\r\n"']+)/m);
  if (!match) throw Object.assign(new Error(), { code: 'CONFIG_MISSING' });
  const source = new URL(match[1].trim());
  if (source.protocol !== 'mongodb+srv:' || source.hostname !== 'cluster0.kp7wfjx.mongodb.net') {
    throw Object.assign(new Error(), { code: 'UNEXPECTED_CLUSTER' });
  }
  const configuredDatabase = source.pathname.slice(1);
  const database = 'benaa_audit_final_20261030_9f6d2a8c4b10';
  if (database === configuredDatabase || !/^benaa_audit_final_20261030_[a-f0-9]{12}$/.test(database)) {
    throw Object.assign(new Error(), { code: 'TARGET_REJECTED' });
  }
  const handshakeOnly = process.argv.includes('--connection-only');
  source.pathname = handshakeOnly ? '/' : '/' + database;
  source.searchParams.set('retryWrites', 'true');
  const client = new MongoClient(source.toString(), { serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 10000, tls: true, tlsAllowInvalidCertificates: false,
    tlsAllowInvalidHostnames: false, maxPoolSize: 3 });
  const report = { host: source.hostname, configuredDatabase, isolatedDatabase: database,
    configuredDatabaseOpened: false, operation: 'ping isolated database only', mutations: false };
  if (handshakeOnly) {
    report.isolatedDatabase = null;
    report.operation = 'TLS authenticated cluster connection only; no application database command';
  }
  try {
    await client.connect();
    if (!handshakeOnly) await client.db(database).command({ ping: 1 });
    report.connectivity = 'PASS';
  } catch (error) {
    report.connectivity = 'BLOCKED';
    report.errorClass = error?.name || 'ConnectionFailure';
    report.errorCode = typeof error?.code === 'number' ? error.code : undefined;
    report.reason = /database.{0,80}name|38.{0,40}characters/i.test(error?.message || '')
      ? 'DATABASE_NAME_CONSTRAINT' : /bad auth|authentication failed/i.test(error?.message || '')
      ? 'AUTHENTICATION_FAILED' : /not authorized/i.test(error?.message || '')
      ? 'DATABASE_PERMISSION_DENIED' : 'SERVER_REJECTED_CONNECTION';
    // Deliberately exclude message, stack, connection URI and user identity.
    process.exitCode = 1;
  } finally { await client.close(); }
  fs.writeFileSync(path.join(output, handshakeOnly ? 'atlas-handshake.json' : 'atlas-connectivity.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
main().catch(() => { console.error('Isolated connectivity check failed; details withheld'); process.exitCode = 1; });
