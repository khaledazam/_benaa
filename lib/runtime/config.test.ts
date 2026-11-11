import { describe, expect, it } from 'vitest';
import { validateRuntimeConfiguration } from './config';

const valid = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'mongodb+srv://synthetic:unused@isolated.example.mongodb.net/benaa_staging',
  JWT_SECRET: 'Synthetic-Only-Audit-Key-0123456789abcdef',
  NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_APP_URL: 'https://app.example.com',
  BENAA_DEPLOYMENT_ENV: 'staging', BENAA_DATABASE_HOST: 'isolated.example.mongodb.net',
  BENAA_DATABASE_NAME: 'benaa_staging', BENAA_ALLOWED_ORIGINS: 'https://app.example.com',
  BENAA_WRITE_DISABLED: 'true', UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'Synthetic-Redis-Audit-Token-0123456789abcdef', BENAA_REDIS_HOST: 'redis.example.com',
});
describe('runtime safety gate (pure, no network)', () => {
  it('accepts a complete write-disabled staging declaration', () => expect(() => validateRuntimeConfiguration(valid())).not.toThrow());
  it.each(['DATABASE_URL','JWT_SECRET','NEXT_PUBLIC_API_URL','NEXT_PUBLIC_APP_URL','BENAA_DEPLOYMENT_ENV',
    'BENAA_DATABASE_HOST','BENAA_DATABASE_NAME','BENAA_ALLOWED_ORIGINS','BENAA_WRITE_DISABLED',
    'UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','BENAA_REDIS_HOST'])('rejects missing %s', name => {
    const env = valid(); delete env[name]; expect(() => validateRuntimeConfiguration(env)).toThrow();
  });
  it.each(['short', 'a'.repeat(64)])('rejects weak signing material', JWT_SECRET => {
    expect(() => validateRuntimeConfiguration({ ...valid(), JWT_SECRET })).toThrow('JWT_SECRET');
  });
  it.each(['http://api.example.com','https://localhost','https://api.example.com/api',
    'https://user:secret@api.example.com','https://api.example.com?token=hidden'])('rejects unsafe origin %s', NEXT_PUBLIC_API_URL => {
    expect(() => validateRuntimeConfiguration({ ...valid(), NEXT_PUBLIC_API_URL })).toThrow('NEXT_PUBLIC_API_URL');
  });
  it('rejects mismatched database identity without exposing the URI', () => {
    const env = { ...valid(), BENAA_DATABASE_NAME: 'other_database' };
    try { validateRuntimeConfiguration(env); throw new Error('gate accepted mismatch'); }
    catch (error) { expect(String(error)).toContain('DATABASE_URL identity'); expect(String(error)).not.toContain('synthetic:unused'); }
  });
  it('requires separate write activation approval', () => {
    const env = { ...valid(), BENAA_WRITE_DISABLED: 'false' };
    expect(() => validateRuntimeConfiguration(env)).toThrow('Write activation approval');
    expect(() => validateRuntimeConfiguration({ ...env, BENAA_STAGING_WRITES_APPROVED: 'true' })).not.toThrow();
    expect(() => validateRuntimeConfiguration({ ...env, BENAA_DEPLOYMENT_ENV: 'production', BENAA_STAGING_WRITES_APPROVED: 'true' })).toThrow();
  });
  it('rejects partial payment configuration', () => expect(() => validateRuntimeConfiguration({ ...valid(), STRIPE_API_KEY: 'synthetic' })).toThrow('STRIPE_WEBHOOK_SECRET'));
  it('rejects insecure or mismatched Redis target configuration', () => {
    expect(() => validateRuntimeConfiguration({ ...valid(), UPSTASH_REDIS_REST_URL: 'http://redis.example.com' })).toThrow('Redis HTTPS target identity');
    expect(() => validateRuntimeConfiguration({ ...valid(), BENAA_REDIS_HOST: 'other.example.com' })).toThrow('Redis HTTPS target identity');
  });
  it('rejects conflicting legacy aliases that could redirect staging cache writes', () => {
    expect(() => validateRuntimeConfiguration({ ...valid(), UPSTASH_REDIS_URL: 'https://other.example.com' })).toThrow('Conflicting Redis URL aliases');
    expect(() => validateRuntimeConfiguration({ ...valid(), UPSTASH_REDIS_TOKEN: 'Other-Redis-Audit-Token-0123456789abcdef' })).toThrow('Conflicting Redis token aliases');
  });
  it('requires a strong reminder key when enabled', () => expect(() => validateRuntimeConfiguration({ ...valid(), BENAA_REMINDERS_ENABLED: 'true' })).toThrow('INTERNAL_API_KEY'));
  it('allows only explicitly isolated, audit-named loopback databases', () => {
    const env = { ...valid(), BENAA_DEPLOYMENT_ENV: 'isolated', BENAA_ISOLATED_RUNTIME: 'true',
      DATABASE_URL: 'mongodb://127.0.0.1:27017/benaa_linux_fixture', BENAA_DATABASE_HOST: '127.0.0.1', BENAA_DATABASE_NAME: 'benaa_linux_fixture',
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3217', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3217', BENAA_ALLOWED_ORIGINS: 'http://127.0.0.1:3217' };
    expect(() => validateRuntimeConfiguration(env)).not.toThrow();
    expect(() => validateRuntimeConfiguration({ ...env, BENAA_ISOLATED_RUNTIME: 'false' })).toThrow();
    expect(() => validateRuntimeConfiguration({ ...env, DATABASE_URL: 'mongodb://127.0.0.1/customer', BENAA_DATABASE_NAME: 'customer' })).toThrow();
  });
});
