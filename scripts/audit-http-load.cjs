/* Real HTTP business workload against owned loopback Linux fixtures only. */
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { PrismaClient } = require('@prisma/client');
const { MongoClient } = require('mongodb');
const { auditStockSnapshot } = require('./audit-stock-reconciliation.cjs');
if (process.env.BENAA_LOCAL_RUNTIME_AUDIT !== 'true') throw new Error('Local audit opt-in required');
const state = JSON.parse(fs.readFileSync('/audit-state/state.json','utf8'));
if (!/^benaa_audit_runtime_\d+$/.test(state.databaseName) || !state.databaseUrl.startsWith('mongodb://127.0.0.1:')) throw new Error('Non-owned fixture rejected');
const base = 'http://127.0.0.1:3217';
const password = 'Synthetic-runtime-audit-only-012345';
const run = Date.now().toString();
const db = new PrismaClient({datasources:{db:{url:state.databaseUrl}}});
const mongo = new MongoClient(state.databaseUrl);
const report = { startedUtc: new Date().toISOString(), scope: 'Real HTTP, synthetic loopback MongoDB/Redis; app capped separately at 512000000 bytes / 0.1 CPU. Not Render-hosted capacity.', cases: [] };
const percentile = (values,p) => values[Math.max(0,Math.ceil(values.length*p)-1)];
async function reconcile() {
  return await auditStockSnapshot(db,mongo,state);
}
async function scenario(concurrency) {
  const records = [], flows = []; const started = performance.now();
  async function call(path, token, body, expected=[200,201], idempotencyKey) {
    const begin = performance.now();
    try {
      const response = await fetch(base+path, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type':'application/json', ...(token ? { Authorization:'Bearer '+token } : {}), ...(idempotencyKey ? { 'Idempotency-Key':idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
      const row = { path: path.split('?')[0], status: response.status, milliseconds: performance.now()-begin, expected: expected.includes(response.status) };
      records.push(row); const data = await response.json().catch(() => null);
      if (!row.expected) throw Object.assign(new Error('Unexpected HTTP result'), { stage: row.path, status: row.status });
      return data;
    } catch (error) {
      if (error.message !== 'Unexpected HTTP result') records.push({ path:path.split('?')[0], status:0, milliseconds:performance.now()-begin, expected:false, errorType:error.name });
      throw error;
    }
  }
  await Promise.all(state.employees.slice(0,concurrency).map(async (employee,index) => {
    let stage = 'login';
    try {
      const login = await call('/api/auth/login',null,{ email: employee.username, password });
      if (!login?.sessionId) throw new Error('Missing confirmed session'); const token = login.sessionId;
      stage='product-list'; await call('/api/products',token);
      stage='inventory-read'; await call(`/api/inventory/availability?productId=${employee.productId}&warehouseId=${state.sourceWarehouseId}`,token);
      stage='warehouse-denial'; await call(`/api/inventory/availability?productId=${employee.productId}&warehouseId=${state.forbiddenWarehouseId}`,token,undefined,[403]);
      stage='sales-create';
      const key = `load:${run}:${concurrency}:${index}`;
      const order = await call('/api/sales-orders',token,{ customerId:state.customerId, warehouseId:state.sourceWarehouseId,
        items:[{ productId:employee.productId, unitId:state.unitId, orderedQuantity:1, unitPrice:10 }], discount:0, tax:0 },[201],key+':sale');
      if (!order?.id) throw new Error('Missing confirmed sales order');
      stage='sales-submit'; await call(`/api/sales-orders/${order.id}/submit`,token,{});
      stage='sales-approve'; await call(`/api/sales-orders/${order.id}/approve`,token,{});
      stage='reservation'; await call('/api/reservations',token,{ salesOrderId:order.id },[201]);
      stage='transfer-request';
      const requested = await call('/api/inventory/transfers/lifecycle',token,{ action:'REQUEST', productId:employee.productId,
        fromWarehouseId:state.sourceWarehouseId, toWarehouseId:state.destinationWarehouseId, quantity:1, idempotencyKey:key+':request' },[201]);
      const transferId = requested?.transfer?.id; if (!transferId) throw new Error('Missing confirmed transfer');
      stage='transfer-approve'; await call('/api/inventory/transfers/lifecycle',token,{ action:'APPROVE', transferId });
      const dispatch = { action:'DISPATCH', transferId, idempotencyKey:key+':dispatch' };
      stage='transfer-dispatch'; await call('/api/inventory/transfers/lifecycle',token,dispatch);
      stage='transfer-receive'; await call('/api/inventory/transfers/lifecycle',token,{ action:'RECEIVE', transferId, receivedQuantity:1, idempotencyKey:key+':receive' });
      stage='dispatch-replay'; await call('/api/inventory/transfers/lifecycle',token,dispatch);
      stage='dispatch-conflict'; await call('/api/inventory/transfers/lifecycle',token,{ ...dispatch, quantity:2 },[409]);
      stage='data-refresh'; await call(`/api/inventory/availability?productId=${employee.productId}&warehouseId=${state.sourceWarehouseId}`,token);
      flows.push({ index, completed:true });
    } catch (error) { flows.push({ index, completed:false, stage, status:error.status||0, errorType:error.name }); }
  }));
  const milliseconds = performance.now()-started;
  const latency = records.map(row=>row.milliseconds).sort((a,b)=>a-b);
  const result = { concurrency, requestTimeoutMs:30000, attemptedRequests:records.length,
    completedWorkflows:flows.filter(row=>row.completed).length, incompleteWorkflows:flows.filter(row=>!row.completed),
    unexpectedResponses:records.filter(row=>!row.expected), elapsedMs:milliseconds, requestsPerSecond:records.length*1000/milliseconds,
    unexpectedResponseRate:records.filter(row=>!row.expected).length/records.length,
    latencyMs:{ p50:percentile(latency,.5), p95:percentile(latency,.95), p99:percentile(latency,.99) },
    expectedWarehouseDenials:records.filter(row=>row.path==='/api/inventory/availability'&&row.status===403).length,
    expectedIdempotencyConflicts:records.filter(row=>row.path==='/api/inventory/transfers/lifecycle'&&row.status===409&&row.expected).length };
  result.reconciliation = await reconcile();
  report.cases.push(result);
  fs.writeFileSync('/audit-state/load-progress.json',JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify({ concurrency, completedWorkflows:result.completedWorkflows, unexpectedResponses:result.unexpectedResponses.length,
    reconciliation:result.reconciliation.status, p95Ms:result.latencyMs.p95 })+'\n');
  return result.reconciliation.status==='PASS' && !records.some(row=>row.path==='/api/inventory/availability'&&row.status===200&&row.expected===false);
}
(async()=>{
  await mongo.connect(); await db.$connect();
  for (const concurrency of [1,5,10,20,50]) if (!await scenario(concurrency)) { report.stoppedForCriticalInvariant=true; break; }
  report.finishedUtc=new Date().toISOString(); report.finalReconciliation=await reconcile();
  report.status=report.finalReconciliation.status==='PASS' && report.cases.every(row=>row.completedWorkflows===row.concurrency&&row.unexpectedResponses.length===0) ? 'PASS' : 'FAIL';
  fs.writeFileSync(`/audit-state/load-results-${run}.json`,JSON.stringify(report,null,2),{flag:'wx'});
  process.stdout.write(JSON.stringify({ status:report.status, finalReconciliation:report.finalReconciliation.status, cases:report.cases.length })+'\n');
})().catch(error=>{ process.stderr.write('Isolated load harness failed: '+error.name+'\n'); process.exitCode=1; })
 .finally(async()=>{await db.$disconnect();await mongo.close();});
