/** Read ONLY IDs acknowledged in the audit manifest. No cleanup or migrations. */
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {MongoClient,ObjectId} from 'mongodb';

async function main(){
  const root=path.resolve(process.cwd(),'../BENAA_CLIENT_DELIVERY/PRODUCTION_RELEASE/evidence');
  const active=JSON.parse(fs.readFileSync(path.join(root,'active-test-run.json'),'utf8'));
  if(!/^20261030_[a-f0-9]{6}$/.test(active.runId))throw new Error('Run declaration required');
  const registry=JSON.parse(fs.readFileSync(active.registry,'utf8'));
  if(registry.runId!==active.runId)throw new Error('Registry mismatch');
  const env=parseEnv(fs.readFileSync('.env','utf8')),uri=new URL(env.DATABASE_URL || '');
  if(uri.protocol!=='mongodb+srv:' || uri.hostname!=='cluster0.kp7wfjx.mongodb.net' || uri.pathname!=='/buildstock_db')throw new Error('Target mismatch');
  const client=new MongoClient(uri.toString(),{tls:true,serverSelectionTimeoutMS:15000,maxPoolSize:2});
  try{
    await client.connect();const db=client.db('buildstock_db');
    const diagnosticRuns:any[]=[];
    for(const name of fs.readdirSync(root).filter(n=>/^test-records-20261030_[a-f0-9]{6}\.json$/.test(n))){
      const prior=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
      if(prior.runId===active.runId)continue;
      const run=/^test-records-(20261030_[a-f0-9]{6})\.json$/.exec(name)![1]!;
      if(prior.runId!==run)throw new Error('Diagnostic manifest mismatch');
      const registered=prior.records.map((r:any)=>({model:r.model,id:r.id}));
      const counts:any={};
      for(const model of [...new Set<string>(registered.map((r:any)=>r.model))]){
        if(!/^[A-Za-z][A-Za-z0-9]*$/.test(model))throw new Error('Invalid model');
        counts[model]=await db.collection(model).countDocuments({_id:{$in:registered.filter((r:any)=>r.model===model).map((r:any)=>new ObjectId(r.id))}});
      }
      const collection=`BENAA_TEST_${run}_RateLimitBucket`;
      diagnosticRuns.push({runId:run,registered,counts,supportCollection:{name:collection,ids:(await db.collection(collection).find({},{projection:{_id:1}}).toArray()).map(r=>r._id)}});
    }
    fs.writeFileSync(path.join(root,'atlas-diagnostic-records.json'),JSON.stringify({mutations:false,diagnosticRuns},null,2));
    const ids=(model:string)=>registry.records.filter((r:any)=>r.model===model).map((r:any)=>new ObjectId(r.id));
    const counts:any={};
    for(const model of [...new Set<string>(registry.records.map((r:any)=>r.model))]){
      if(!/^[A-Za-z][A-Za-z0-9]*$/.test(model))throw new Error('Invalid model');
      counts[model]={registered:ids(model).length,persisted:await db.collection(model).countDocuments({_id:{$in:ids(model)}})};
    }
    const products=await db.collection('Product').find({_id:{$in:ids('Product')}},{projection:{_id:1,name:1,quantity:1,reservedQuantity:1}}).toArray();
    const allocations=await db.collection('StockAllocation').find({_id:{$in:ids('StockAllocation')}},{projection:{_id:1,productId:1,warehouseId:1,quantity:1,reservedQuantity:1}}).toArray();
    const movements=await db.collection('StockMovement').find({_id:{$in:ids('StockMovement')}},{projection:{_id:1,productId:1,warehouseId:1,referenceId:1,movementNumber:1,quantityInBaseUnit:1,previousStock:1,newStock:1,movementType:1}}).toArray();
    const result={runId:active.runId,readScope:'Only manifest IDs and the new run-specific rate-limit collection',mutations:false,
      counts,products,allocations,movements,
      reconciliation:products.length===1 && products[0]!.quantity===100 && allocations.length===1 && allocations[0]!.quantity===100 &&
        movements.length===1 && movements[0]!.quantityInBaseUnit===100 && movements[0]!.previousStock===0 && movements[0]!.newStock===100 ? 'PASS':'FAIL',
      financialRecordsCreated:ids('Invoice').length+ids('Order').length+ids('Payment').length,
      supportCollection:{name:active.prefix+'RateLimitBucket',ids:(await db.collection(active.prefix+'RateLimitBucket').find({},{projection:{_id:1}}).toArray()).map(r=>r._id)},
      note:'No existing customer records read for a before/after comparison. Containment is demonstrated by owned-ID predicates and the tested server fence. Internal movement number from this first run is system-generated; its exact owned ID is retained; immutable ledger was not renamed.'};
    fs.writeFileSync(path.join(root,`atlas-reconciliation-${active.runId}.json`),JSON.stringify(result,null,2));
    process.stdout.write(JSON.stringify({runId:active.runId,reconciliation:result.reconciliation,counts,financialRecordsCreated:result.financialRecordsCreated})+'\n');
  }finally{await client.close();}
}
main().catch(error=>{process.stdout.write(JSON.stringify({failed:true,class:error?.name,code:typeof error?.code==='number'?error.code:undefined})+'\n');process.exitCode=1;});
