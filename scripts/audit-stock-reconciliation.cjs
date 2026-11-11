const { calculateLedgerStockBalance } = require('../lib/inventory/reconciliationService.ts');
/** Read a consistent snapshot, including when an HTTP caller has timed out. */
async function auditStockSnapshot(db, mongoClient, state) {
  const ids = state.employees.map(row=>row.productId);
  const [snapshot, server] = await Promise.all([
    db.$transaction(async tx => Promise.all([
      tx.product.findMany({where:{id:{in:ids}}}), tx.stockAllocation.findMany({where:{productId:{in:ids}}}),
      tx.stockMovement.findMany({where:{productId:{in:ids}}}), tx.stockTransfer.findMany({where:{productId:{in:ids}}}),
      tx.stockReservationItem.findMany({where:{productId:{in:ids},reservation:{status:{in:['ACTIVE','PARTIALLY_FULFILLED']}}}}),
      tx.inventoryOperation.count(),tx.invoice.count(),tx.order.count(),
      tx.inventoryOperation.count({where:{operationKey:{startsWith:'stripe-payment:'}}}),
    ]),{maxWait:10000,timeout:20000}), mongoClient.db('admin').command({serverStatus:1}),
  ]);
  const [products,allocations,movements,transfers,reservations,operations,invoices,legacyOrders,paymentReceipts]=snapshot;
  const failures=[],rows=[],directions=new Set();
  for(const product of products){
    const physical=allocations.filter(row=>row.productId===product.id).reduce((sum,row)=>sum+row.quantity,0);
    const transit=transfers.filter(row=>row.productId===product.id).reduce((sum,row)=>sum+row.inTransitQuantity,0);
    const ledger=calculateLedgerStockBalance(movements.filter(row=>row.productId===product.id));
    const salesReserved=reservations.filter(row=>row.productId===product.id).reduce((sum,row)=>sum+row.remainingQuantity,0);
    const allocationReserved=allocations.filter(row=>row.productId===product.id).reduce((sum,row)=>sum+row.reservedQuantity,0);
    if(Math.abs(physical+transit-100)>1e-8||Math.abs(product.quantity-physical)>1e-8||Math.abs(ledger-physical)>1e-8||salesReserved+allocationReserved>physical+1e-8)failures.push(product.id);
    rows.push({productId:product.id,physical,transit,ledger,salesReserved,allocationReserved});
  }
  for(const movement of movements.filter(row=>['TRANSFER_IN','TRANSFER_OUT'].includes(row.movementType))){
    const key=movement.referenceId+':'+movement.movementType;
    if(directions.has(key))failures.push('duplicate-transfer-movement');directions.add(key);
  }
  if(invoices||legacyOrders||paymentReceipts)failures.push('unexpected-financial-records');
  return {status:failures.length?'FAIL':'PASS',failures,rows,operations,invoices,legacyOrders,paymentReceipts,
    mongoConnections:server.connections,scope:'Consistent snapshot of 50 known synthetic products in owned loopback database; not Atlas or production reconciliation'};
}
module.exports={auditStockSnapshot};
