import { expect, it } from 'vitest';
import { effectivePermissions, hasPermission } from './permissions';
it('restricts an employee to an explicit subset of the existing role', () => {
  const actor = { role: 'WAREHOUSE_MANAGER', permissionsRestricted: true, permissions: ['SALES_ORDER_VIEW', 'SALES_ORDER_CREATE'] };
  expect(hasPermission(actor, 'SALES_ORDER_CREATE')).toBe(true);
  expect(hasPermission(actor, 'STOCK_TRANSFER')).toBe(false);
  expect(hasPermission(actor, 'USER_MANAGE')).toBe(false);
  expect(effectivePermissions(actor)).toEqual(['SALES_ORDER_VIEW', 'SALES_ORDER_CREATE']);
});
it('cannot escalate a role with forged custom permission names', () => {
  expect(hasPermission({ role: 'VIEWER', permissionsRestricted: true, permissions: ['PRODUCT_DELETE', 'USER_MANAGE'] }, 'USER_MANAGE')).toBe(false);
});
it('treats an explicitly empty subset as no permissions', () => {
  expect(effectivePermissions({ role: 'STOREKEEPER', permissionsRestricted: true, permissions: [] })).toEqual([]);
});
it('preserves historical role-based grants until explicit administrator restriction', () => {
  expect(hasPermission({ role: 'STOREKEEPER', permissions: ['LEGACY-ALIAS'], permissionsRestricted: null }, 'STOCK_OUT')).toBe(true);
});
it('keeps the administrator role authoritative for company administration', () => {
  expect(hasPermission({ role: 'SUPER_ADMIN', permissionsRestricted: true, permissions: [] }, 'USER_MANAGE')).toBe(true);
});
