import {expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {authorizedAtlasFence} from './authorized-atlas-fence';

async function fixture(work:(f:any)=>Promise<void>) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'benaa-fence-'));
  const file=path.join(folder,'registry.json'),run='20261030_a1b2c3';
  const own='100000000000000000000001',existing='200000000000000000000001';
  const count='100000000000000000000002',product='100000000000000000000003';
  fs.writeFileSync(file,JSON.stringify({runId:run,records:[
    {model:'User',id:own},{model:'InventoryCount',id:count},{model:'Product',id:product},
  ]}));
  const mutations:any[]=[],reads:any[]=[];
  const db:any={user:{
    update:async(args:any)=>{mutations.push(args);return {id:args.where.id};},
    updateMany:async(args:any)=>{mutations.push(args);return {count:1};},
    deleteMany:async(args:any)=>{mutations.push(args);return {count:1};},
    create:async(args:any)=>{mutations.push(args);return args.data;},
    findMany:async(args:any)=>{reads.push(args);return[];},
    findUnique:async()=>({id:existing,name:'Existing customer'}),
  },inventoryCount:{update:async(args:any)=>{mutations.push(args);return args.data;}},$runCommandRaw:async(c:any)=>c};
  db.$transaction=async(fn:any)=>fn(db);
  const model=[{name:'User',fields:[{name:'name',kind:'scalar'},{name:'username',kind:'scalar'}]},
    {name:'InventoryCount',fields:[]},{name:'InventoryCountItem',fields:[{name:'productId',kind:'scalar'}]}];
  try {await work({db:authorizedAtlasFence(db,model,file,run),mutations,reads,own,existing,count,product,file});}
  finally {fs.unlinkSync(file);fs.rmdirSync(folder);} // exact files owned by this fixture; no recursive cleanup
}
it('blocks existing customer IDs and broad/OR/bulk writes before reaching the driver',()=>fixture(async f=>{
  await expect(f.db.user.update({where:{id:f.existing},data:{name:'changed'}})).rejects.toThrow('BENAA_TEST_FENCE');
  await expect(f.db.user.updateMany({where:{OR:[{id:f.own},{name:'Existing customer'}]},data:{status:false}})).rejects.toThrow('BENAA_TEST_FENCE');
  await expect(f.db.user.deleteMany({where:{}})).rejects.toThrow('BENAA_TEST_FENCE');
  expect(f.mutations).toHaveLength(0);
}));
it('scopes list reads, hides non-owned unique results, and permits only acknowledged new records',()=>fixture(async f=>{
  await f.db.user.findMany({where:{status:true}});
  expect(f.reads[0].where.AND[1]).toEqual({id:{in:[f.own]}});
  expect(await f.db.user.findUnique({where:{id:f.existing}})).toBeNull();
  const created=await f.db.user.create({data:{name:'Employee',username:'worker'}});
  expect(created.name).toMatch(/^BENAA_TEST_20261030_a1b2c3_/);
  await f.db.user.update({where:{id:created.id},data:{status:false}});
  expect(JSON.parse(fs.readFileSync(f.file,'utf8')).records).toContainEqual({model:'User',id:created.id});
}));
it('wraps callback transactions and denies arbitrary raw commands',()=>fixture(async f=>{
  await f.db.$transaction(async(tx:any)=>{
    await expect(tx.user.update({where:{id:f.existing},data:{status:false}})).rejects.toThrow('BENAA_TEST_FENCE');
    await tx.user.update({where:{id:f.own},data:{status:true}});
  });
  expect(f.mutations).toHaveLength(1);
  expect(()=>f.db.$runCommandRaw({dropDatabase:1})).toThrow('BENAA_TEST_FENCE');
  expect(()=>f.db.$runCommandRaw({findAndModify:'RateLimitBucket'})).toThrow('BENAA_TEST_FENCE');
}));
it('keeps search filters valid while scoping generated test document numbers',()=>fixture(async f=>{
  await f.db.user.findMany({where:{name:{contains:'Employee',mode:'insensitive'},
    countNumber:{startsWith:'CNT-2026-'}}});
  expect(f.reads[0].where.AND[0]).toEqual({
    name:{contains:'Employee',mode:'insensitive'},
    countNumber:{startsWith:'BENAA_TEST_20261030_a1b2c3_CNT-2026-'},
  });
  expect(f.reads[0].where.AND[1]).toEqual({id:{in:[f.own]}});
}));
it('registers new snapshot rows only on a count and product owned by the run',()=>fixture(async f=>{
  const start=(id:string,items:unknown)=>f.db.inventoryCount.update({where:{id},data:{status:'IN_PROGRESS',items}});
  await expect(start(f.existing,{create:[{productId:f.product}]})).rejects.toThrow('BENAA_TEST_FENCE');
  await expect(start(f.count,{create:[{productId:f.existing}]})).rejects.toThrow('BENAA_TEST_FENCE');
  await expect(start(f.count,{connect:[{id:f.existing}]})).rejects.toThrow('BENAA_TEST_FENCE');
  const result=await start(f.count,{create:[{productId:f.product}]});
  expect(JSON.parse(fs.readFileSync(f.file,'utf8')).records).toContainEqual({
    model:'InventoryCountItem',id:result.items.create[0].id,
  });
  expect(f.mutations).toHaveLength(1);
}));
