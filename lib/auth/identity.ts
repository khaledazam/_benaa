/** New employee handles are canonical ASCII; historical records are never rewritten. */
export function normalizeIdentity(value: string): string { return value.normalize('NFKC').trim().toLowerCase(); }
export function employeeUsername(value: string): string {
  const normalized = normalizeIdentity(value);
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(normalized)) throw new Error('Invalid employee username');
  return normalized;
}
