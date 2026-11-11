/* Local synthetic infrastructure ONLY. Never reads .env or accepts a datasource URL. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { calculateLedgerStockBalance } = require('../lib/inventory/reconciliationService.ts');
const { redactText } = require('../lib/log-redaction.ts');
if (process.env.BENAA_LOCAL_RUNTIME_AUDIT !== 'true') throw new Error('Local audit opt-in required');
const folder = '/audit-state';
const password = 'Synthetic-runtime-audit-only-012345';
let replica, client, db, redis, server;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function parse(buffer, offset = 0) {
  const end = buffer.indexOf('\r\n', offset); if (end < 0) return null;
  const type = String.fromCharCode(buffer[offset]), value = buffer.toString('utf8', offset + 1, end);
  let cursor = end + 2;
  if (type === '+') return { value, cursor };
  if (type === '-') throw new Error('Local Redis command rejected');
  if (type === ':') return { value: Number(value), cursor };
  if (type === '$') {
    const length = Number(value); if (length < 0) return { value: null, cursor };
    if (buffer.length < cursor + length + 2) return null;
    return { value: buffer.toString('utf8', cursor, cursor + length), cursor: cursor + length + 2 };
  }
  if (type === '*') {
    const result = [];
    for (let index = 0; index < Number(value); index++) { const item = parse(buffer, cursor); if (!item) return null; result.push(item.value); cursor = item.cursor; }
    return { value: result, cursor };
  }
  throw new Error('Unexpected local Redis response');
}
function redisCommand(command) {
  return new Promise((resolve, reject) => {
    const parts = command.map(item => Buffer.from(String(item)));
    const payload = Buffer.concat([Buffer.from(`*${parts.length}\r\n`), ...parts.flatMap(item => [Buffer.from(`$${item.length}\r\n`), item, Buffer.from('\r\n')])]);
    const socket = net.connect(6379, '127.0.0.1'); let received = Buffer.alloc(0);
    socket.setTimeout(10000, () => { socket.destroy(); reject(new Error('Local Redis timeout')); });
    socket.on('error', reject); socket.on('connect', () => socket.write(payload));
    socket.on('data', chunk => { try { received = Buffer.concat([received, chunk]); const result = parse(received); if (result) { socket.end(); resolve(result.value); } } catch (error) { socket.destroy(); reject(error); } });
  });
}
async function reconcile(state) {
  const productIds = state.employees.map(employee => employee.productId);
  const [products, allocations, movements, transfers, reservations, operations, invoices, legacyOrders, paymentReceipts, status] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } } }), db.stockAllocation.findMany({ where: { productId: { in: productIds } } }),
    db.stockMovement.findMany({ where: { productId: { in: productIds } } }), db.stockTransfer.findMany({ where: { productId: { in: productIds } } }),
    db.stockReservationItem.findMany({ where: { productId: { in: productIds }, reservation: { status: { in: ['ACTIVE','PARTIALLY_FULFILLED'] } } } }),
    db.inventoryOperation.count(), db.invoice.count(), db.order.count(), db.inventoryOperation.count({ where: { operationKey: { startsWith: 'stripe-payment:' } } }), client.db('admin').command({ serverStatus: 1 }),
  ]);
  const failures = [], rows = [];
  for (const product of products) {
    const physical = allocations.filter(row => row.productId === product.id).reduce((sum,row) => sum + row.quantity, 0);
    const transit = transfers.filter(row => row.productId === product.id).reduce((sum,row) => sum + row.inTransitQuantity, 0);
    const ledger = calculateLedgerStockBalance(movements.filter(row => row.productId === product.id));
    const salesReserved = reservations.filter(row => row.productId === product.id).reduce((sum,row) => sum + row.remainingQuantity, 0);
    const allocationReserved = allocations.filter(row => row.productId === product.id).reduce((sum,row) => sum + row.reservedQuantity, 0);
    if (Math.abs(physical + transit - 100) > 1e-8 || Math.abs(product.quantity - physical) > 1e-8 || Math.abs(ledger - physical) > 1e-8 || salesReserved + allocationReserved > physical + 1e-8) failures.push(product.id);
    rows.push({ productId: product.id, physical, transit, ledger, salesReserved, allocationReserved });
  }
  if (invoices || legacyOrders || paymentReceipts) failures.push('unexpected-financial-records');
  const directions = new Set();
  for (const movement of movements.filter(row => ['TRANSFER_IN','TRANSFER_OUT'].includes(row.movementType))) {
    const key = `${movement.referenceId}:${movement.movementType}`;
    if (directions.has(key)) failures.push('duplicate-transfer-movement'); directions.add(key);
  }
  return { status: failures.length ? 'FAIL' : 'PASS', failures, rows, operations, invoices, legacyOrders, paymentReceipts,
    mongoConnections: status.connections, scope: '50 known synthetic products in newly owned loopback replica; no production data' };
}

(async () => {
  fs.mkdirSync(folder, { recursive: true });
  if (fs.existsSync(path.join(folder, 'state.json'))) throw new Error('Refusing to overwrite an existing audit fixture identity');
  process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
  replica = await MongoMemoryReplSet.create({ binary: { systemBinary: '/audit-tools/mongodb/bin/mongod', version: '8.2.6' }, replSet: { count: 1, ip: '127.0.0.1' } });
  const name = `benaa_audit_runtime_${Date.now()}`;
  const uri = replica.getUri(name);
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/benaa_audit_runtime_\d+\?/.test(uri)) throw new Error('Non-owned database target rejected');
  client = await MongoClient.connect(uri); const mongo = client.db(name);
  if ((await mongo.listCollections().toArray()).length) throw new Error('Fixture database is not empty');
  const schema = fs.readFileSync(path.resolve('prisma/schema.prisma'));
  const manifest = JSON.parse(fs.readFileSync(path.resolve('prisma/inventory-index-manifest.json'), 'utf8'));
  if (manifest.schemaSha256 !== createHash('sha256').update(schema).digest('hex')) throw new Error('Stale index manifest');
  for (const model of manifest.models) {
    await mongo.createCollection(model.collection);
    for (const index of model.indexes) {
      if (index.primary) continue;
      if (index.unique && index.nullableFields.length && !(model.model === 'User' && index.name === 'User_username_key')) throw new Error('Unreviewed nullable unique policy');
      await mongo.collection(model.collection).createIndex(index.key, { name: index.name, unique: index.unique,
        ...(index.unique && index.nullableFields.length ? { partialFilterExpression: { username: { $type: 'string' } } } : {}) });
    }
  }
  const databaseUrl = uri + '&maxPoolSize=10&minPoolSize=0&maxIdleTimeMS=60000&serverSelectionTimeoutMS=10000';
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } }); await db.$connect();
  const hash = await bcrypt.hash(password, 12);
  const ownerId = new ObjectId().toHexString();
  await db.user.create({ data: { id: ownerId, username: 'load-admin', email: 'load-admin@isolated.invalid', name: 'Synthetic load administrator', password: hash,
    role: 'SUPER_ADMIN', status: true, sessionVersion: 0, warehouseIds: [], permissions: [], createdAt: new Date() } });
  const warehouses = [];
  for (let index=0; index<3; index++) warehouses.push(await db.warehouse.create({ data: { code: `LOAD-${index}`, name: `Synthetic warehouse ${index}`, userId: ownerId, createdBy: ownerId } }));
  const supplier = await db.supplier.create({ data: { name: 'Synthetic load supplier', userId: ownerId, createdBy: ownerId } });
  const unit = await db.unit.create({ data: { code: 'AUDIT-PCS', name: 'Synthetic piece', symbol: 'PCS', type: 'count', isBaseUnit: true, active: true } });
  const customer = await db.customer.create({ data: { customerCode: 'AUDIT-LOAD', name: 'Synthetic load customer', createdBy: ownerId } });
  const employees = [];
  for (let index=0; index<50; index++) {
    const username = `load-${String(index).padStart(3,'0')}`;
    const employee = await db.user.create({ data: { username, email: `${username}@isolated.invalid`, name: `Synthetic employee ${index}`, password: hash,
      role: 'WAREHOUSE_MANAGER', status: true, sessionVersion: 0, primaryWarehouseId: warehouses[0].id, warehouseIds: [warehouses[0].id, warehouses[1].id], permissions: [], createdAt: new Date() } });
    const product = await db.product.create({ data: { name: `Synthetic product ${index}`, sku: `AUDIT-LOAD-${index}`, price: 10, quantity: 100, status: 'IN_STOCK', unitId: unit.id,
      supplierId: supplier.id, userId: ownerId, createdBy: ownerId } });
    await db.stockAllocation.create({ data: { productId: product.id, warehouseId: warehouses[0].id, quantity: 100, reservedQuantity: 0, userId: ownerId } });
    await db.stockMovement.create({ data: { movementNumber: `AUDIT-OPEN-${index}`, productId: product.id, warehouseId: warehouses[0].id,
      quantity: 100, quantityInBaseUnit: 100, movementType: 'OPENING_BALANCE', previousStock: 0, newStock: 100, unitId: unit.id, performedBy: ownerId } });
    employees.push({ id: employee.id, username, productId: product.id });
  }
  redis = spawn('redis-server', ['--bind','127.0.0.1','--port','6379','--save','','--appendonly','no'], { stdio: 'ignore' });
  for (let attempt=0; ; attempt++) { try { if (await redisCommand(['PING']) === 'PONG') break; } catch { if (attempt>=50) throw new Error('Local Redis did not start'); await pause(100); } }
  const state = { databaseName: name, databaseUrl, sourceWarehouseId: warehouses[0].id, destinationWarehouseId: warehouses[1].id,
    forbiddenWarehouseId: warehouses[2].id, unitId: unit.id, customerId: customer.id, employees, indexCount: manifest.indexCount,
    scope: 'disposable Linux loopback fixture; not Atlas or a reviewed release candidate' };
  server = http.createServer(async (request,response) => {
    try {
      response.setHeader('Content-Type','application/json');
      if (request.method === 'GET' && request.url === '/audit/reconcile') { response.end(JSON.stringify(await reconcile(state))); return; }
      if (request.headers.authorization !== 'Bearer synthetic-audit-redis-only') { response.writeHead(401); response.end('{"error":"unauthorized"}'); return; }
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length>2000000) throw new Error('Oversized local Redis command'); }
      const command = JSON.parse(body);
      if (request.url === '/pipeline' || request.url === '/multi-exec') response.end(JSON.stringify(await Promise.all(command.map(async args => ({ result: await redisCommand(args) })))));
      else response.end(JSON.stringify({ result: await redisCommand(command) }));
    } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.name || 'Local service error' })); }
  });
  await new Promise(resolve => server.listen(8089,'127.0.0.1',resolve));
  fs.writeFileSync(path.join(folder,'state.json'), JSON.stringify(state,null,2), { flag:'wx' });
  fs.writeFileSync(path.join(folder,'initial-reconciliation.json'), JSON.stringify(await reconcile(state),null,2), { flag:'wx' });
  process.stdout.write(JSON.stringify({ status:'READY', databaseName:name, employees:employees.length, products:employees.length, indexes:manifest.indexCount })+'\n');
})().catch(async error => { process.stderr.write(`Local audit infrastructure failed: ${error.name}: ${redactText(error.message)}\n`); await shutdown(1); });
async function shutdown(exitCode=0) { server?.close(); redis?.kill('SIGTERM'); await db?.$disconnect(); await client?.close(); await replica?.stop(); process.exit(exitCode); }
process.once('SIGTERM',shutdown); process.once('SIGINT',shutdown);
