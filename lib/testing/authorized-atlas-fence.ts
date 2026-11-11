import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

type Entry={model:string;id:string};
type Registry={runId:string;records:Entry[]};
const deny=():never=>{throw new Error('BENAA_TEST_FENCE: operation outside this authorized test run');};
const labels=new Set(['name','code','sku','poNumber','purchaseOrderNumber','receiptNumber','goodsReceiptNumber','grnNumber','transferNumber',
  'invoiceNumber','orderNumber','movementNumber','salesOrderNumber','issueNumber','projectCode','batchNumber','dispatchNumber','pickListNumber',
  'reservationNumber','countNumber','adjustmentNumber']);
const prefixedFilters=new Set(['equals','in','notIn','startsWith','not','set']);

/** This fence is ONLY an additional containment control for explicitly approved
 * tests in an existing database. It is not application RBAC or a stock engine.
 * Register only IDs of successful creates; never adopt an existing customer ID.
 */
export function authorizedAtlasFence(client:any, models:readonly any[], file:string, runId:string) {
  if(!/^[0-9]{8}_[a-f0-9]{6}$/.test(runId) || !path.isAbsolute(file))deny();
  const prefix=`BENAA_TEST_${runId}_`;
  function prefixed(value:any,key=''):any {
    if(value==null || value instanceof Date)return value;
    if(typeof value==='string' && labels.has(key) && !value.startsWith(prefix))return prefix+value;
    if(Array.isArray(value))return value.map(v=>prefixed(v,key));
    if(typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>
      [k,prefixed(v,labels.has(key)&&prefixedFilters.has(k)?key:k)]));
    return value;
  }
  const metadata=new Map(models.map(m=>[m.name,m]));
  let registry:Registry=JSON.parse(fs.readFileSync(file,'utf8'));
  if(registry.runId!==runId)deny();
  function reload(){const next=JSON.parse(fs.readFileSync(file,'utf8'));if(next.runId!==runId)deny();registry=next;}
  function owns(id:unknown){return typeof id==='string' && registry.records.some(r=>r.id===id);}
  function refs(value:any,key='') {
    if(value==null || value instanceof Date)return;
    if(typeof value==='string' && /(?:Id|Ids|^id)$/.test(key) && /^[a-f0-9]{24}$/i.test(value) && !owns(value))deny();
    if(Array.isArray(value)){for(const v of value)refs(v,key);return;}
    if(typeof value==='object')for(const [k,v]of Object.entries(value))refs(v,k);
  }
  function anchor(where:any):boolean {
    if(!where || typeof where!=='object')return false;
    for(const [k,v] of Object.entries(where)) {
      if(k==='OR' && Array.isArray(v) && v.length && v.every(anchor))return true;
      if(k==='AND' && (Array.isArray(v)?v:[v]).some(anchor))return true;
      if(k==='NOT')continue;
      if(/(?:Id|Ids|^id)$/.test(k)) {
        if(owns(v))return true;
        if(v && typeof v==='object') {
          if(owns((v as any).equals))return true;
          if(Array.isArray((v as any).in) && (v as any).in.length && (v as any).in.every(owns))return true;
        }
      }
      if(k!=='OR' && k!=='NOT' && v && typeof v==='object' && anchor(v))return true;
    }
    return false;
  }
  function add(entries:Entry[]) {
    reload();for(const row of entries)if(!registry.records.some(r=>r.model===row.model&&r.id===row.id))registry.records.push(row);
    const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(registry,null,2));fs.renameSync(temporary,file);
  }
  function create(model:string,data:any,entries:Entry[]):any {
    if(!data || Array.isArray(data) || typeof data!=='object')deny();
    const result={...data,id:data.id || randomBytes(12).toString('hex')};
    if(!/^[a-f0-9]{24}$/i.test(result.id) || owns(result.id))deny();
    for(const field of metadata.get(model)?.fields || []) {
      const value=result[field.name];if(value==null)continue;
      if(field.kind==='object') {
        if(value.connect || value.set)refs(value.connect || value.set);
        if(value.connectOrCreate || value.upsert || value.update || value.updateMany || value.delete || value.deleteMany)deny();
        if(value.create)result[field.name]={...value,create:Array.isArray(value.create)
          ?value.create.map((v:any)=>create(field.type,v,entries)):create(field.type,value.create,entries)};
        if(value.createMany) {
          if(value.createMany.skipDuplicates)deny();
          result[field.name]={...value,createMany:{...value.createMany,
            data:value.createMany.data.map((v:any)=>create(field.type,v,entries))}};
        }
      } else if(typeof value==='string' && labels.has(field.name) && !value.startsWith(prefix)) {
        result[field.name]=prefix+value;
      } else if(field.name==='username' && typeof value==='string' && !value.startsWith(prefix.toLowerCase())) {
        result[field.name]=prefix.toLowerCase()+value;
      }
    }
    // Foreign keys must already belong to a committed/acknowledged test create.
    for(const [key,value]of Object.entries(result))if(key!=='id' && /(?:Id|Ids)$/.test(key))refs(value,key);
    entries.push({model,id:result.id});return result;
  }
  const caches=new WeakMap<object,any>();
  function wrap(db:any):any {
    if(caches.has(db))return caches.get(db);
    const proxy=new Proxy(db,{get(target,property){
      if(property==='__benaaTestFenceRunId')return runId;
      if(property==='$transaction')return (work:any,options:any)=>{
        if(typeof work!=='function')deny();
        return target.$transaction((tx:any)=>work(wrap(tx)),options);
      };
      if(property==='$runCommandRaw')return (command:any)=>{
        if(Object.keys(command).length===1 && (command.ping===1 || typeof command.listIndexes==='string'))return target.$runCommandRaw(command);
        if(command.findAndModify===prefix+'RateLimitBucket')return target.$runCommandRaw(command);
        deny();
      };
      if(typeof property==='string' && property.startsWith('$') && !['$connect','$disconnect'].includes(property))return deny;
      const value=target[property];
      const model=models.find(m=>m.name[0].toLowerCase()+m.name.slice(1)===property)?.name;
      if(!model)return typeof value==='function'?value.bind(target):value;
      return new Proxy(value,{get(delegate,operation){
        if(typeof delegate[operation]!=='function')return delegate[operation];
        return async(args:any={})=>{
          reload();args={...args};if(args.where)args.where=prefixed(args.where);const op=String(operation),entries:Entry[]=[];
          if(['findMany','findFirst','findFirstOrThrow','count','aggregate','groupBy'].includes(op)) {
            args.where={AND:[args.where || {},{id:{in:registry.records.filter(r=>r.model===model).map(r=>r.id)}}]};
          } else if(op==='findUnique' || op==='findUniqueOrThrow' || op==='findFirstOrThrow') {
            // Scoped alternate-key reads may locate receipts; result ownership
            // is checked before it is returned to the caller.
          } else if(op==='create')args.data=create(model,args.data,entries);
          else if(op==='createMany') {
            if(args.skipDuplicates)deny();
            args.data=(Array.isArray(args.data)?args.data:[args.data]).map((d:any)=>create(model,d,entries));
          } else if(['update','updateMany','delete','deleteMany','upsert'].includes(op)) {
            refs(args.where);if(!anchor(args.where))deny();refs(args.data || args.update);
            if(args.data)args.data=prefixed(args.data);
            if(args.update)args.update=prefixed(args.update);
            if(op==='upsert')args.create=create(model,args.create,entries);
            // Starting an owned count snapshots fresh item rows in the same
            // update. Check every new row before letting Prisma create it.
            const countItems=model==='InventoryCount' && op==='update' && owns(args.where?.id) && args.data?.items;
            if(countItems) {
              if(Object.keys(countItems).length!==1 || !Array.isArray(countItems.create))deny();
              const fields=new Set((metadata.get('InventoryCountItem')?.fields || [])
                .filter((field:any)=>field.kind!=='object').map((field:any)=>field.name));
              args.data.items={create:countItems.create.map((row:any)=>{
                if(!row || Object.keys(row).some(key=>!fields.has(key)))deny();
                return create('InventoryCountItem',row,entries);
              })};
            }
            if(args.data && Object.entries(args.data).some(([key,v]:[string,any])=>
              !(countItems && key==='items') && v && typeof v==='object' &&
              ['create','createMany','connect','connectOrCreate','delete','deleteMany','disconnect','set','update','updateMany','upsert']
                .some(k=>k in v)))deny();
          } else deny();
          const result=await delegate[operation](args);
          if(op.startsWith('findUnique') || op==='findFirstOrThrow') {
            if(result && !owns(args.where?.id) && !registry.records.some(r=>r.model===model && r.id===result.id))return null;
          }
          if(entries.length && (op!=='upsert' || result?.id===args.create.id))add(entries);
          return result;
        };
      }});
    }});
    caches.set(db,proxy);return proxy;
  }
  return wrap(client);
}
