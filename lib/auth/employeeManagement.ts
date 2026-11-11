import bcrypt from 'bcryptjs';
import { hasPermission, BuildStockPermissions, effectivePermissions } from './permissions';
import { employeeUsername, normalizeIdentity } from './identity';
import { inventoryTransaction } from '@/lib/inventory/transaction';

function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
/** Same company, no seat/device counter or automatic per-user expiry. */
export async function manageEmployee(db: any, actorId: string, body: any, update: boolean) {
  const password = update ? body.newPassword : body.password;
  if (password && Buffer.byteLength(password, 'utf8') > 72) fail('Password exceeds bcrypt byte limit');
  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
  return inventoryTransaction(db, async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (!actor || !actor.status || !hasPermission(actor, 'USER_MANAGE')) fail('Forbidden', 403);
    await tx.user.update({ where: { id: actorId }, data: { updatedAt: new Date() } });
    const existing = update ? await tx.user.findUnique({ where: { id: body.id } }) : null;
    if (update && !existing) fail('Employee not found', 404);
    const username = body.username !== undefined ? employeeUsername(body.username) : existing?.username || (!update ? employeeUsername((body.email || '').split('@')[0]) : undefined);
    const email = body.email !== undefined ? normalizeIdentity(body.email) : existing?.email || (username ? username + '@employees.benaa.invalid' : undefined);
    if (!update && (!body.name || !username || !passwordHash || !email)) fail('Name, username/email and password are required');
    if (username || email) {
      const collisions = await tx.user.findMany({ where: { OR: [
        ...(username ? [{ username: { equals: username, mode: 'insensitive' } }] : []),
        ...(email ? [{ email: { equals: email, mode: 'insensitive' } }, { username: { equals: email, mode: 'insensitive' } }] : []),
      ] }, take: 3 });
      if (collisions.some((u: any) => u.id !== existing?.id)) fail('Employee identity is already registered', 409);
    }
    const data: any = { updatedAt: new Date() };
    for (const name of ['name', 'role', 'status']) if (body[name] !== undefined) data[name] = body[name];
    if (body.username !== undefined || !update) data.username = username;
    if (body.email !== undefined || !update) data.email = email;
    if (body.permissions !== undefined) {
      if (body.permissions.some((p: string) => !Object.values(BuildStockPermissions).includes(p as any))) fail('Unknown permission');
      const targetRole = body.role || existing?.role || 'STOREKEEPER';
      if (body.permissions.some((p: any) => !hasPermission(targetRole, p))) fail('Permission exceeds assigned role');
      data.permissions = body.permissions;
      data.permissionsRestricted = true;
    }
    if (!update || body.primaryWarehouseId !== undefined || body.additionalWarehouseIds !== undefined) {
      const primary = body.primaryWarehouseId !== undefined ? body.primaryWarehouseId : existing?.primaryWarehouseId || null;
      const additional = body.additionalWarehouseIds ?? (existing?.warehouseIds || []).filter((id: string) => id !== existing?.primaryWarehouseId);
      const ids = [...new Set<string>([...(primary ? [primary] : []), ...additional])];
      const count = await tx.warehouse.count({ where: { id: { in: ids }, status: true } });
      if (count !== ids.length) fail('Warehouse assignment is invalid');
      data.primaryWarehouseId = primary;
      data.warehouseIds = ids;
    }
    if (update && ['SUPER_ADMIN', 'admin'].includes(existing.role) && (body.status === false || (body.role && !['SUPER_ADMIN', 'admin'].includes(body.role)))) {
      const admins = await tx.user.count({ where: { role: { in: ['SUPER_ADMIN', 'admin'] }, status: true } });
      if (admins <= 1) fail('The last active administrator must be retained', 409);
    }
    for (const field of ['subscriptionStartDate', 'subscriptionEndDate']) if (body[field] !== undefined) data[field] = body[field] ? new Date(body[field]) : null;
    if (passwordHash) data.password = passwordHash;
    if (update && (passwordHash || body.status === false)) data.sessionVersion = (existing.sessionVersion ?? 0) + 1;
    const result = update ? await tx.user.update({ where: { id: existing.id }, data }) : await tx.user.create({ data: {
      ...data, role: data.role || 'STOREKEEPER', status: data.status ?? true, sessionVersion: 0,
      warehouseIds: data.warehouseIds || [], permissions: data.permissions || [], createdAt: new Date(),
      subscriptionStartDate: data.subscriptionStartDate ?? null, subscriptionEndDate: data.subscriptionEndDate ?? null,
    } });
    await tx.auditLog.create({ data: { userId: actorId, action: update ? (passwordHash ? 'employee_password_reset' : 'employee_updated') : 'employee_created',
      entityType: 'User', entityId: result.id, details: { fields: Object.keys(body).filter(k => !['password','newPassword'].includes(k)), credentialsReset: !!passwordHash && update } } });
    // Do not return password hashes or session-version internals.
    const { password: _password, sessionVersion: _version, ...safe } = result;
    return { ...safe, effectivePermissions: effectivePermissions(result) };
  });
}
