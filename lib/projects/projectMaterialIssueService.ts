import { createHash, randomUUID } from "node:crypto";
import { inventoryTransaction } from "@/lib/inventory/transaction";
import { executeStockMutationInTx } from "@/lib/inventory/stockService";
import { getStockAvailabilityInTx } from "@/lib/inventory/availability";
import { addStock, stockUnits } from "@/lib/inventory/quantity";
import { canAccessInventoryWarehouse, isInventoryAdmin } from "@/lib/auth/inventory-route-access";
import { hasPermission } from '@/lib/auth/permissions';

export class ProjectIssueError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const objectId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
function quantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new ProjectIssueError("Quantity must be positive and finite");
  try { stockUnits(value); } catch { throw new ProjectIssueError("Quantity must use supported base-unit precision"); }
  return value;
}
const manager = (actor: any) => isInventoryAdmin(actor) || actor.role === "WAREHOUSE_MANAGER";
const operator = (actor: any) => manager(actor) || actor.role === "STOREKEEPER";
async function currentActor(tx: any, actor: any) {
  const current = await tx.user.findUnique({ where: { id: actor.id } });
  const now = new Date();
  if (!current?.status || (current.subscriptionStartDate && current.subscriptionStartDate > now) || (current.subscriptionEndDate && current.subscriptionEndDate < now)) throw new ProjectIssueError("Account access revoked", 403);
  if (!operator(current)) throw new ProjectIssueError("Project material operation requires an authorized warehouse employee", 403);
  if (!hasPermission(current, 'STOCK_VIEW')) throw new ProjectIssueError('Project stock visibility revoked', 403);
  return current;
}
function scope(actor: any, project: any, warehouseId: string) {
  if (!project.warehouseIds.includes(warehouseId) || !canAccessInventoryWarehouse(actor, warehouseId)) throw new ProjectIssueError("Forbidden project warehouse", 403);
}
function approvalScope(actor: any, project: any) {
  if (!manager(actor) || (!isInventoryAdmin(actor) && project.assignedManagerId && project.assignedManagerId !== actor.id)) throw new ProjectIssueError("Project approval requires its assigned warehouse manager", 403);
}
function operationIdentity(actor: any, action: string, body: any, headerKey?: string | null) {
  const key = headerKey || body.idempotencyKey;
  if (typeof key !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(key)) throw new ProjectIssueError("A stable Idempotency-Key is required");
  const canonical = { action, issueId: body.issueId || null, projectId: body.projectId || null, warehouseId: body.warehouseId || null,
    items: body.items || null, quantities: body.quantities || null, recipientName: body.recipientName || null,
    notes: body.notes || null, reason: body.reason || null, code: body.code || null, name: body.name || null,
    location: body.location || null, status: body.status || null, assignedManagerId: body.assignedManagerId || null, warehouseIds: body.warehouseIds || null };
  return { operationKey: `project-material:${actor.id}:${action}:${key}`, requestHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") };
}
async function persist(tx: any, actor: any, identity: any, response: any, details: any) {
  await tx.auditLog.create({ data: { userId: actor.id, action: `project_material_${response.action.toLowerCase()}`, entityType: response.project ? "Project" : "ProjectMaterialIssue", entityId: response.project?.id || response.issue.id,
    details: { ...details, operationKey: identity.operationKey, actorRole: actor.role, actorName: actor.name } } });
  const saved = JSON.parse(JSON.stringify(response));
  await tx.inventoryOperation.create({ data: { ...identity, actorId: actor.id, response: saved } });
  return saved;
}

export async function applyProjectManagement(db: any, actor: any, body: any, headerKey?: string | null) {
  const action = body.projectId ? "UPDATE_PROJECT" : "CREATE_PROJECT";
  const identity = operationIdentity(actor, action, body, headerKey);
  return inventoryTransaction(db, async (tx: any) => {
    const current = await currentActor(tx, actor);
    if (!manager(current)) throw new ProjectIssueError("Project management requires a warehouse manager", 403);
    if (!hasPermission(current, 'STOCK_TRANSFER')) throw new ProjectIssueError('Project management permission revoked', 403);
    if (body.projectId && !objectId(body.projectId)) throw new ProjectIssueError("Invalid project ID");
    const previous = body.projectId ? await tx.project.findUnique({ where: { id: body.projectId } }) : null;
    if (body.projectId && !previous) throw new ProjectIssueError("Project not found", 404);
    if (previous) {
      for (const warehouseId of previous.warehouseIds) scope(current, previous, warehouseId);
      approvalScope(current, previous);
    }
    const warehouseIds = body.warehouseIds ?? previous?.warehouseIds;
    if (!Array.isArray(warehouseIds) || !warehouseIds.length || !warehouseIds.every(objectId) || new Set(warehouseIds).size !== warehouseIds.length) throw new ProjectIssueError("Distinct registered project warehouse IDs are required");
    for (const warehouseId of warehouseIds) {
      if (!canAccessInventoryWarehouse(current, warehouseId)) throw new ProjectIssueError("Forbidden project warehouse", 403);
      if (!(await tx.warehouse.findUnique({ where: { id: warehouseId } }))?.status) throw new ProjectIssueError("Active project warehouses are required");
    }
    const status = body.status ?? previous?.status ?? "ACTIVE";
    if (!["ACTIVE", "ON_HOLD", "CLOSED"].includes(status)) throw new ProjectIssueError("Invalid project status");
    const assignedManagerId = body.assignedManagerId ?? previous?.assignedManagerId ?? current.id;
    if (assignedManagerId) {
      if (!objectId(assignedManagerId)) throw new ProjectIssueError("Invalid assigned manager");
      const assigned = await tx.user.findUnique({ where: { id: assignedManagerId } });
      if (!assigned?.status || !manager(assigned) || warehouseIds.some((warehouseId: string) => !canAccessInventoryWarehouse(assigned, warehouseId))) throw new ProjectIssueError("Assigned manager must manage the project warehouses");
    }
    const replay = await tx.inventoryOperation.findUnique({ where: { operationKey: identity.operationKey } });
    if (replay) {
      if (replay.requestHash !== identity.requestHash) throw new ProjectIssueError("Idempotency key payload mismatch", 409);
      return { ...replay.response, replayed: true };
    }
    // Serialize a fresh mutation against employee reassignment/revocation.
    await tx.user.update({ where: { id: current.id }, data: { updatedAt: new Date() } });
    const code = String(body.code ?? previous?.code ?? "").trim();
    const name = String(body.name ?? previous?.name ?? "").trim();
    if (!code || code.length > 64 || !name || name.length > 200) throw new ProjectIssueError("Project code and name are required");
    const data = { code, name, location: body.location ?? previous?.location ?? null, status, assignedManagerId, warehouseIds, updatedAt: new Date() };
    const project = previous ? await tx.project.update({ where: { id: previous.id }, data }) : await tx.project.create({ data: { ...data, createdBy: current.id } });
    return persist(tx, current, identity, { success: true, action, project }, { before: previous, after: project });
  });
}

export async function applyProjectOperation(db: any, actor: any, body: any, headerKey?: string | null) {
  const action = body.action;
  if (!["CREATE", "REQUEST", "APPROVE", "REJECT", "RESERVE", "DISPATCH", "COMPLETE", "CANCEL", "RELEASE", "RETURN"].includes(action)) throw new ProjectIssueError("Invalid project material action");
  const identity = operationIdentity(actor, action, body, headerKey);
  return inventoryTransaction(db, async (tx: any) => {
    const current = await currentActor(tx, actor);
    const permission = action === 'RETURN' ? 'STOCK_IN' : ['APPROVE', 'REJECT'].includes(action) ? 'STOCK_TRANSFER' : 'STOCK_OUT';
    if (!hasPermission(current, permission)) throw new ProjectIssueError('Project material permission revoked', 403);
    let issue = action === "CREATE" ? null : objectId(body.issueId) ? await tx.projectMaterialIssue.findUnique({ where: { id: body.issueId }, include: { items: true } }) : null;
    if (action !== "CREATE" && !issue) throw new ProjectIssueError("Material issue not found", 404);
    const projectId = issue?.projectId || body.projectId;
    const warehouseId = issue?.warehouseId || body.warehouseId;
    if (!objectId(projectId) || !objectId(warehouseId)) throw new ProjectIssueError("Registered project and warehouse are required");
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) throw new ProjectIssueError("Project not found", 404);
    scope(current, project, warehouseId);
    if (["APPROVE", "REJECT"].includes(action)) approvalScope(current, project);
    if (!["RETURN", "CANCEL", "RELEASE"].includes(action) && project.status !== "ACTIVE") throw new ProjectIssueError("Project is not active", 409);
    const replay = await tx.inventoryOperation.findUnique({ where: { operationKey: identity.operationKey } });
    if (replay) {
      if (replay.requestHash !== identity.requestHash) throw new ProjectIssueError("Idempotency key payload mismatch", 409);
      return { ...replay.response, replayed: true };
    }
    // Mongo snapshot reads alone do not conflict with concurrent permission edits.
    // These activity writes fence fresh mutations; a conflict retries authority.
    await tx.user.update({ where: { id: current.id }, data: { updatedAt: new Date() } });
    await tx.project.update({ where: { id: project.id }, data: { updatedAt: new Date() } });
    const before = issue ? JSON.parse(JSON.stringify(issue)) : null;
    if (action === "CREATE") {
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 200) throw new ProjectIssueError("Material issue items are required");
      const items = [];
      for (const item of body.items) {
        if (!objectId(item.productId)) throw new ProjectIssueError("Registered product is required");
        const amount = quantity(item.quantity);
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product || product.deletedAt || product.isActive === false) throw new ProjectIssueError("Active product is required");
        if (item.unitId && item.unitId !== product.unitId) throw new ProjectIssueError("Material issue quantities must use the product base unit");
        if (!item.binId && await tx.stockLocationAllocation.count({ where: { productId: product.id, warehouseId } }) > 0) throw new ProjectIssueError("Location-tracked material requires a source bin");
        if (item.binId) {
          const bin = objectId(item.binId) ? await tx.warehouseBin.findUnique({ where: { id: item.binId } }) : null;
          if (!bin?.active || bin.warehouseId !== warehouseId) throw new ProjectIssueError("Invalid source bin");
        }
        if (["BATCH", "LOT", "HEAT"].includes(product.trackingMode) && !item.batchId) throw new ProjectIssueError("Tracked material requires a source batch");
        if (item.batchId) {
          const batch = objectId(item.batchId) ? await tx.inventoryBatch.findUnique({ where: { id: item.batchId } }) : null;
          if (!batch || batch.productId !== product.id || batch.warehouseId !== warehouseId || batch.status !== "ACTIVE") throw new ProjectIssueError("Invalid source batch");
        }
        items.push({ productId: product.id, productName: product.name, productSku: product.sku, unitId: product.unitId, warehouseId, binId: item.binId || null, batchId: item.batchId || null, quantity: amount });
      }
      if (!(await tx.warehouse.findUnique({ where: { id: warehouseId } }))?.status) throw new ProjectIssueError("Active source warehouse is required");
      issue = await tx.projectMaterialIssue.create({ data: { issueNumber: `PMI-${randomUUID()}`, projectId, warehouseId, recipientName: body.recipientName || null,
        notes: body.notes || null, createdBy: current.id, items: { create: items } }, include: { items: true } });
    } else {
      const allowed: Record<string, string[]> = { REQUEST: ["DRAFT"], APPROVE: ["REQUESTED"], REJECT: ["REQUESTED"], RESERVE: ["APPROVED"], DISPATCH: ["RESERVED", "DISPATCHED"], COMPLETE: ["DISPATCHED"],
        CANCEL: ["DRAFT", "REQUESTED", "APPROVED", "RESERVED", "DISPATCHED"], RELEASE: ["RESERVED", "DISPATCHED"], RETURN: ["DISPATCHED", "COMPLETED", "CANCELLED"] };
      if (!allowed[action]?.includes(issue.status)) throw new ProjectIssueError("Invalid material issue state transition", 409);
      // Header write serializes mutations of different issue lines and its audit trail.
      await tx.projectMaterialIssue.update({ where: { id: issue.id }, data: { updatedAt: new Date() } });
      const data: any = { updatedAt: new Date() };
      if (action === "REQUEST") Object.assign(data, { status: "REQUESTED", requestedBy: current.id });
      if (action === "APPROVE") Object.assign(data, { status: "APPROVED", approvedBy: current.id, approvedAt: new Date() });
      if (action === "REJECT") Object.assign(data, { status: "REJECTED", cancellationReason: body.reason || null });
      if (action === "RESERVE") {
        const demand = new Map<string, number>();
        for (const item of issue.items) {
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (!product || product.deletedAt || product.isActive === false || item.warehouseId !== warehouseId || (item.unitId || null) !== (product.unitId || null)) throw new ProjectIssueError("Issue product/base-unit scope requires reconciliation", 409);
          demand.set(item.productId, addStock(demand.get(item.productId) || 0, quantity(item.quantity)));
        }
        for (const [productId, amount] of [...demand].sort(([a], [b]) => a.localeCompare(b))) {
          await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
          const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
          if (!allocation) throw new ProjectIssueError("Insufficient stock", 409);
          await tx.stockAllocation.update({ where: { id: allocation.id }, data: { updatedAt: new Date() } });
          const available = await getStockAvailabilityInTx(tx, productId, warehouseId);
          if (!available.consistent || amount > available.availableStock) throw new ProjectIssueError("Insufficient uncommitted project stock", 409);
        }
        for (const item of issue.items) {
          if (item.batchId) {
            const batch = await tx.inventoryBatch.findUnique({ where: { id: item.batchId } });
            if (!batch || batch.status !== "ACTIVE" || batch.productId !== item.productId || batch.warehouseId !== warehouseId || addStock(batch.quantity, -batch.reservedQuantity) < item.quantity) throw new ProjectIssueError("Insufficient source batch", 409);
            await tx.inventoryBatch.update({ where: { id: batch.id }, data: { reservedQuantity: addStock(batch.reservedQuantity, item.quantity) } });
          }
          await tx.projectMaterialIssueItem.update({ where: { id: item.id }, data: { reservedQuantity: item.quantity, remainingQuantity: item.quantity } });
        }
        data.status = "RESERVED";
      }
      if (["DISPATCH", "RELEASE", "RETURN"].includes(action)) {
        if (!Array.isArray(body.quantities) || !body.quantities.length || new Set(body.quantities.map((q: any) => q.issueItemId)).size !== body.quantities.length) throw new ProjectIssueError("Distinct actual issue item quantities are required");
        for (const entry of body.quantities) {
          const amount = quantity(entry.quantity);
          const item = issue.items.find((i: any) => i.id === entry.issueItemId);
          if (!item) throw new ProjectIssueError("Issue item does not belong to this issue");
          if (item.warehouseId !== warehouseId) throw new ProjectIssueError("Issue item warehouse requires reconciliation", 409);
          if (action !== "RELEASE") {
            const product = await tx.product.findUnique({ where: { id: item.productId } });
            if (!product || (item.unitId || null) !== (product.unitId || null)) throw new ProjectIssueError("Issue base unit changed; reconciliation required", 409);
          }
          if (action === "RETURN") {
            if (amount > addStock(item.dispatchedQuantity, -item.returnedQuantity)) throw new ProjectIssueError("Return exceeds net issued material", 409);
            const movement = await executeStockMutationInTx(tx, { productId: item.productId, warehouseId, quantity: amount, unitId: item.unitId, destinationBinId: item.binId,
              batchId: item.batchId, movementType: "PROJECT_RETURN", referenceType: "ProjectMaterialIssue", referenceId: issue.id, performedBy: current.id, reason: body.reason || "Unused project material returned" });
            await tx.projectMaterialIssueItem.update({ where: { id: item.id }, data: { returnedQuantity: addStock(item.returnedQuantity, amount) } });
            await tx.projectMaterialIssueReturn.create({ data: { projectIssueId: issue.id, issueItemId: item.id, projectId, productId: item.productId, warehouseId,
              binId: item.binId, batchId: item.batchId, stockMovementId: movement.movementId, quantity: amount, reason: body.reason || null, receivedBy: current.id } });
          } else {
            if (amount > item.remainingQuantity || amount > item.reservedQuantity) throw new ProjectIssueError("Quantity exceeds outstanding project reservation", 409);
            if (item.batchId) {
              const batch = await tx.inventoryBatch.findUnique({ where: { id: item.batchId } });
              if (!batch || batch.reservedQuantity < amount) throw new ProjectIssueError("Batch reservation requires reconciliation", 409);
              await tx.inventoryBatch.update({ where: { id: batch.id }, data: { reservedQuantity: addStock(batch.reservedQuantity, -amount) } });
            }
            await tx.projectMaterialIssueItem.update({ where: { id: item.id }, data: { reservedQuantity: addStock(item.reservedQuantity, -amount), remainingQuantity: addStock(item.remainingQuantity, -amount),
              ...(action === "DISPATCH" ? { dispatchedQuantity: addStock(item.dispatchedQuantity, amount) } : { releasedQuantity: addStock(item.releasedQuantity, amount) }) } });
            if (action === "DISPATCH") await executeStockMutationInTx(tx, { productId: item.productId, warehouseId, quantity: amount, unitId: item.unitId, sourceBinId: item.binId,
              batchId: item.batchId, movementType: "PROJECT_ISSUE", referenceType: "ProjectMaterialIssue", referenceId: issue.id, performedBy: current.id, reason: `Project ${project.code}; issue ${issue.issueNumber}` });
          }
        }
        if (action === "DISPATCH") data.status = "DISPATCHED";
      }
      if (action === "COMPLETE") {
        if (issue.items.some((item: any) => item.remainingQuantity !== 0) || !issue.items.some((item: any) => item.dispatchedQuantity > 0)) throw new ProjectIssueError("Complete only after all reserved material is dispatched or released", 409);
        Object.assign(data, { status: "COMPLETED", completedBy: current.id, completedAt: new Date() });
      }
      if (action === "CANCEL") {
        for (const item of issue.items) {
          if (item.batchId && item.remainingQuantity > 0) {
            const batch = await tx.inventoryBatch.findUnique({ where: { id: item.batchId } });
            if (!batch || batch.reservedQuantity < item.remainingQuantity) throw new ProjectIssueError("Batch reservation requires reconciliation", 409);
            await tx.inventoryBatch.update({ where: { id: batch.id }, data: { reservedQuantity: addStock(batch.reservedQuantity, -item.remainingQuantity) } });
          }
          await tx.projectMaterialIssueItem.update({ where: { id: item.id }, data: { reservedQuantity: 0, remainingQuantity: 0, releasedQuantity: addStock(item.releasedQuantity, item.remainingQuantity) } });
        }
        Object.assign(data, { status: "CANCELLED", cancelledBy: current.id, cancellationReason: body.reason || null });
      }
      await tx.projectMaterialIssue.update({ where: { id: issue.id }, data });
      issue = await tx.projectMaterialIssue.findUnique({ where: { id: issue.id }, include: { items: true } });
    }
    return persist(tx, current, identity, { success: true, action, issue }, { projectId, warehouseId, before, after: issue, reason: body.reason || null, quantities: body.quantities || null });
  });
}

export async function listProjectRecords(db: any, actor: any, query: { issues?: boolean; projectId?: string | null; warehouseId?: string | null } = {}) {
  const current = await currentActor(db, actor);
  const warehouseIds = isInventoryAdmin(current) ? null : [...new Set([current.primaryWarehouseId, ...(current.warehouseIds || [])].filter(Boolean))];
  if (query.warehouseId && (!objectId(query.warehouseId) || !canAccessInventoryWarehouse(current, query.warehouseId))) throw new ProjectIssueError("Forbidden warehouse", 403);
  if (query.projectId && !objectId(query.projectId)) throw new ProjectIssueError("Invalid project ID");
  if (!query.issues) {
    const projects = await db.project.findMany({ where: { ...(query.projectId ? { id: query.projectId } : {}), ...(warehouseIds ? { warehouseIds: { hasSome: warehouseIds } } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
    return { success: true, projects };
  }
  const projects = await db.project.findMany({ where: { ...(query.projectId ? { id: query.projectId } : {}), ...(warehouseIds ? { warehouseIds: { hasSome: warehouseIds } } : {}) } });
  const permittedProjects = projects.filter((project: any) => !query.warehouseId || project.warehouseIds.includes(query.warehouseId));
  const issues = await db.projectMaterialIssue.findMany({ where: { projectId: { in: permittedProjects.map((project: any) => project.id) }, ...(query.warehouseId ? { warehouseId: query.warehouseId } : warehouseIds ? { warehouseId: { in: warehouseIds } } : {}) }, include: { items: true, returns: true, project: true }, orderBy: { createdAt: "desc" }, take: 200 });
  return { success: true, issues: issues.filter((issue: any) => issue.project.warehouseIds.includes(issue.warehouseId)) };
}
