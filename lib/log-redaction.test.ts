import { expect, it } from 'vitest';
import { redactLogValue, redactText, sanitizedError } from './log-redaction';
it('removes credentials and customer contact fields recursively', () => {
  const serialized = JSON.stringify(redactLogValue({ authorization: 'private-auth', nested: { password: 'private-pass', clientEmail: 'user@example.com', billingAddress: 'private-address' }, count: 3 }));
  for (const secret of ['private-auth','private-pass','user@example.com','private-address']) expect(serialized).not.toContain(secret);
  expect(serialized).toContain('"count":3');
});
it('sanitizes embedded database URIs, bearer tokens and email text', () => {
  const text = redactText('failed mongodb+srv://user:pass@cluster.example.net/db Bearer private-token user@example.com');
  for (const secret of ['user:pass', 'private-token', 'user@example.com']) expect(text).not.toContain(secret);
});
it('drops arbitrary error request/context properties and redacts stack', () => {
  const error = Object.assign(new Error('mongodb://user:pass@127.0.0.1/database'), { request: { password: 'private-pass' } });
  const safe = sanitizedError(error); expect(safe).not.toHaveProperty('request'); expect(safe.stack).not.toContain('user:pass');
});
it('handles circular context safely', () => { const cycle: any = {}; cycle.self = cycle; expect(() => JSON.stringify(redactLogValue(cycle))).not.toThrow(); });
