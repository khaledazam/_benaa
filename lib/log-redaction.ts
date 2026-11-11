/** Shared server/client sanitizer. No Node-only imports or datasource access. */
const privateKey = /password|secret|token|authorization|cookie|database.?url|connection.?string|private.?key|email|phone|address|customer.?name|client.?name|billing|payment.?data/i;
export function redactText(value: string): string {
  return value
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[DATABASE_REDACTED]')
    .replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[TOKEN_REDACTED]')
    .replace(/\b(?:sk|pk|rk)_(?:test|live)_[a-zA-Z0-9]+\b/g, '[KEY_REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]')
    .replace(/((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
export function redactLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactText(value).slice(0, 4000);
  if (value === null || typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
  if (depth > 5 || seen.has(value)) return '[TRUNCATED]';
  seen.add(value);
  if (value instanceof Error) return { name: value.name, message: redactText(value.message), stack: redactText(value.stack || '').slice(0, 8000) };
  if (Array.isArray(value)) return value.slice(0, 30).map(item => redactLogValue(item, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, privateKey.test(key) ? '[REDACTED]' : redactLogValue(item, depth + 1, seen)]));
}
export function sanitizedError(error: Error): Error {
  const safe = new Error(redactText(error.message));
  Object.defineProperty(safe, 'name', { value: error.name, configurable: true, writable: true });
  safe.stack = redactText(error.stack || '');
  return safe;
}
