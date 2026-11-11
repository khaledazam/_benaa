"use strict";

// A local HTTP server alone does not prove its database is isolated. These legacy
// scripts must be pointed at a separately provisioned certification server.
function assertIsolatedQaEnvironment(env = process.env) {
  if (env.BENAA_QA_ISOLATED !== "1") {
    throw new Error("QA blocked: provision isolated fixtures and set BENAA_QA_ISOLATED=1.");
  }
  let database;
  let api;
  try {
    database = new URL(env.DATABASE_URL);
    api = new URL(env.BENAA_QA_BASE_URL);
  } catch {
    throw new Error("QA blocked: explicit database and API targets are required.");
  }
  const local = (host) => ["127.0.0.1", "localhost", "[::1]"].includes(host);
  if (database.protocol !== "mongodb:" || !local(database.hostname) ||
      !/^\/benaa_cert_[a-z0-9_]+$/i.test(database.pathname) ||
      database.username || database.password ||
      env.BENAA_QA_SERVER_DATABASE_URL !== env.DATABASE_URL) {
    throw new Error("QA blocked: database must be a dedicated local benaa_cert_* database matching the isolated server target.");
  }
  if (api.protocol !== "http:" || !local(api.hostname) || api.username || api.password ||
      api.pathname !== "/" || api.search || api.hash) {
    throw new Error("QA blocked: API must be an explicit local HTTP origin.");
  }
  return { databaseUrl: env.DATABASE_URL, baseUrl: api.origin };
}

module.exports = { assertIsolatedQaEnvironment };
