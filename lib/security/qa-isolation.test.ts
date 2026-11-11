import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { assertIsolatedQaEnvironment } = createRequire(import.meta.url)("../../scripts/qa-isolation.cjs");
const local = {
  BENAA_QA_ISOLATED: "1",
  DATABASE_URL: "mongodb://127.0.0.1:27017/benaa_cert_regression",
  BENAA_QA_SERVER_DATABASE_URL: "mongodb://127.0.0.1:27017/benaa_cert_regression",
  BENAA_QA_BASE_URL: "http://127.0.0.1:3017",
};

describe("Certification script isolation boundary", () => {
  it("blocks default and unacknowledged environments", () => {
    expect(() => assertIsolatedQaEnvironment({})).toThrow("QA blocked");
    expect(() => assertIsolatedQaEnvironment({ ...local, BENAA_QA_ISOLATED: "0" })).toThrow("QA blocked");
  });
  it("rejects Atlas and ordinary local databases", () => {
    for (const DATABASE_URL of ["mongodb+srv://example.invalid/benaa_cert_test", "mongodb://127.0.0.1/buildstock", "mongodb://remote.invalid/benaa_cert_test"]) {
      expect(() => assertIsolatedQaEnvironment({ ...local, DATABASE_URL, BENAA_QA_SERVER_DATABASE_URL: DATABASE_URL })).toThrow("QA blocked");
    }
  });
  it("rejects mismatched server database and remote API", () => {
    expect(() => assertIsolatedQaEnvironment({ ...local, BENAA_QA_SERVER_DATABASE_URL: "mongodb://127.0.0.1/benaa_cert_other" })).toThrow("QA blocked");
    expect(() => assertIsolatedQaEnvironment({ ...local, BENAA_QA_BASE_URL: "https://example.invalid" })).toThrow("QA blocked");
  });
  it("accepts explicit matching local certification targets", () => {
    expect(assertIsolatedQaEnvironment(local)).toEqual({ databaseUrl: local.DATABASE_URL, baseUrl: local.BENAA_QA_BASE_URL });
  });
});
