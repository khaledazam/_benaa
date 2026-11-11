import crypto from 'node:crypto';
import fs from 'node:fs';

/** Real HTTP acceptance. Secrets are generated and retained in the runner only. */
export async function runAuthorizedAtlasAcceptance(context:{prefix:string;runId:string;output:string;
  api:(method:string,path:string,body?:any,who?:string,key?:string)=>Promise<{status:number;data:any}>;
  login:(who:string,username:string,password:string)=>Promise<{status:number;userId?:string}>;
}) {
  const {api,prefix,login}=context;
  const results:any[]=[];
  const file=context.output;
  function record(name:string,pass:boolean,evidence:any){
    results.push({name,status:pass?'PASS':'FAIL',evidence});
    fs.writeFileSync(file,JSON.stringify({runId:context.runId,prefix,transport:'real HTTP -> Next.js -> Atlas buildstock_db',
      androidDeviceTest:'NOT EXECUTED',remoteInternetTest:'NOT EXECUTED',results},null,2));
    if(!pass)throw new Error('Acceptance gate failed: '+name);
  }
  async function post(path:string,body:any,expected=201){
    const result=await api('POST',path,body);
    record('POST '+path,result.status===expected,{status:result.status,id:result.data?.id,error:result.data?.error});return result.data;
  }
  const a=await post('/api/warehouses',{name:prefix+'WAREHOUSE_A'});
  const b=await post('/api/warehouses',{name:prefix+'WAREHOUSE_B'});
  const password=crypto.randomBytes(18).toString('hex'),username=(prefix+'viewer').toLowerCase();
  const created=await post('/api/admin/employees',{name:prefix+'VIEWER',username,password,role:'VIEWER',
    primaryWarehouseId:a.id,additionalWarehouseIds:[]});
  const employee=created.employee;
  const signIn=await login('employee',username,password);
  record('New employee password login using separate HTTP session',signIn.status===200 && signIn.userId===employee.id,{status:signIn.status,userId:signIn.userId});
  let response=await api('GET','/api/warehouses',undefined,'employee');
  record('Warehouse A assignment excludes Warehouse B',response.status===200 && Array.isArray(response.data) && response.data.length===1 && response.data[0].id===a.id,
    {status:response.status,warehouseIds:Array.isArray(response.data)?response.data.map((w:any)=>w.id):[]});
  response=await api('GET','/api/admin/employees',undefined,'employee');
  record('Viewer cannot administer employees',response.status===403,{status:response.status});
  const supplier=await post('/api/suppliers',{name:prefix+'SUPPLIER'});
  const category=await post('/api/categories',{name:prefix+'CATEGORY'});
  const unit=await post('/api/units',{name:prefix+'UNIT',code:prefix+'EA',symbol:'ea',type:'COUNT',isBaseUnit:true});
  const product=await post('/api/products',{name:prefix+'PRODUCT',sku:prefix+'SKU',price:10,quantity:0,
    supplierId:supplier.id,categoryId:category.id,unitId:unit.id,status:'out_of_stock'});
  const po=await post('/api/purchase-orders',{supplierId:supplier.id,warehouseId:a.id,
    items:[{productId:product.id,unitId:unit.id,orderedQuantity:100,unitPrice:5}],notes:prefix+'OPENING_TEST_PURCHASE'});
  await post(`/api/purchase-orders/${po.id}/submit`,{},200);
  await post(`/api/purchase-orders/${po.id}/approve`,{},200);
  const receipt=await post('/api/goods-receipts',{purchaseOrderId:po.id,
    items:[{purchaseOrderItemId:po.items[0].id,productId:product.id,receivedQuantity:100,unitId:unit.id}],notes:prefix+'RECEIPT'});
  const posts=await Promise.all([api('POST',`/api/goods-receipts/${receipt.id}/post`,{}),api('POST',`/api/goods-receipts/${receipt.id}/post`,{})]);
  record('Concurrent receipt posting succeeds idempotently',posts.every(r=>r.status===200),{statuses:posts.map(r=>r.status),receiptId:receipt.id});
  response=await api('GET',`/api/inventory/availability?productId=${product.id}&warehouseId=${a.id}`,undefined,'employee');
  record('Employee observes centrally posted stock once',response.status===200 && response.data.physicalStock===100 && response.data.availableStock===100,
    {status:response.status,availability:response.data});
  const before=await api('GET',`/api/inventory/availability?productId=${product.id}&warehouseId=${b.id}`,undefined,'employee');
  record('Cross-warehouse inventory read denied',before.status===403 || before.status===404,{status:before.status});
  response=await api('PUT','/api/admin/employees',{id:employee.id,primaryWarehouseId:b.id,additionalWarehouseIds:[]});
  record('Administrator reassigns employee',response.status===200,{status:response.status,employeeId:employee.id});
  response=await api('GET','/api/warehouses',undefined,'employee');
  record('Existing session immediately observes warehouse reassignment',response.status===200 && response.data.length===1 && response.data[0].id===b.id,
    {status:response.status,warehouseIds:Array.isArray(response.data)?response.data.map((w:any)=>w.id):[]});
  response=await api('PUT','/api/admin/employees',{id:employee.id,status:false});
  record('Administrator revokes test employee',response.status===200,{status:response.status,employeeId:employee.id});
  response=await api('GET','/api/warehouses',undefined,'employee');
  record('Old session rejected after revocation',[401,403].includes(response.status),{status:response.status});
  const revokedLogin=await login('revoked',username,password);
  record('Revoked password login rejected',[401,403].includes(revokedLogin.status),{status:revokedLogin.status});
  return {results,productId:product.id,warehouseId:a.id,receiptId:receipt.id,employeeId:employee.id};
}
