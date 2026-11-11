/** Synthetic fixtures only: a new empty explicit loopback benaa_cert_* database. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { executeStockMutationInTx } from "../lib/inventory/stockService";
export function assertPilotTarget(value: string | undefined) {
 const target = new URL(value || "invalid:");
 if(target.protocol!=="mongodb:" || target.hostname!=="127.0.0.1" || !/^\/benaa_cert_[a-z0-9_]+$/i.test(target.pathname) || target.username || target.password) throw Error("Explicit disposable loopback benaa_cert_* database required");
 return target.toString();
}
export async function seedPilot(db: PrismaClient, password: string) {
 if(password.length<12)throw Error("Explicit synthetic password of at least 12 characters required");
 const collections:any=await db.$runCommandRaw({listCollections:1,nameOnly:true});
 for(const c of collections.cursor.firstBatch){const count:any=await db.$runCommandRaw({count:c.name,query:{}});if(count.n!==0)throw Error("Synthetic seed refuses any existing records");}
 const data=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../docs/PRODUCTION_CERTIFICATION/BENAA_PILOT_SYNTHETIC_DATASET.json"),"utf8"));
 const passwordHash=await bcrypt.hash(password,12),adminId=data.roles[0].id;
 return db.$transaction(async tx=>{
  for(const e of data.roles)await tx.user.create({data:{id:e.id,email:e.email,name:e.name,role:e.role,password:passwordHash,status:true,createdAt:new Date(),warehouseIds:e.warehouseIds,primaryWarehouseId:e.primaryWarehouseId,permissions:e.permissions}});
  const bins=new Map<string,string>();
  for(const w of data.warehouses){
   await tx.warehouse.create({data:{id:w.id,code:w.code,name:w.name,address:w.location,userId:adminId,createdBy:adminId}});
   const z=await tx.warehouseZone.create({data:{warehouseId:w.id,code:"Z01",name:"Synthetic zone"}});
   const r=await tx.warehouseRack.create({data:{warehouseId:w.id,zoneId:z.id,code:"R01",name:"Synthetic rack"}});
   const sh=await tx.warehouseShelf.create({data:{warehouseId:w.id,rackId:r.id,code:"S01",name:"Synthetic shelf"}});
   for(const b of w.bins){const bin=await tx.warehouseBin.create({data:{warehouseId:w.id,shelfId:sh.id,code:b.code,name:b.name}});bins.set(w.id+":"+b.code,bin.id);}
  }
  const supplier=await tx.supplier.create({data:{name:"Synthetic supplier",email:"supplier@example.invalid",userId:adminId,createdBy:adminId}});
  for(const p of data.catalog){
   const unit=await tx.unit.create({data:{code:p.sku,name:p.unit,symbol:p.unit,type:p.unit}});
   const cat=await tx.category.create({data:{name:p.category,userId:adminId,createdBy:adminId}});
   await tx.product.create({data:{id:p.id,sku:p.sku,name:p.name,barcode:p.barcode,price:p.sellingPrice,purchasePrice:p.costPrice,unitId:unit.id,categoryId:cat.id,supplierId:supplier.id,trackingMode:p.trackingMode,quantity:0,status:"OUT_OF_STOCK",userId:adminId,createdBy:adminId}});
   for(const a of p.allocations){
    if(a.reservedQuantity!==0)throw Error("Opening seed cannot invent reservations");
    const bin=bins.get(a.warehouseId+":"+a.bin);if(!bin)throw Error("Opening bin missing");
    const batch=p.trackingMode==="NONE"?null:await tx.inventoryBatch.create({data:{productId:p.id,warehouseId:a.warehouseId,batchNumber:"SYNTHETIC-OPENING",quantity:0}});
    await executeStockMutationInTx(tx,{productId:p.id,warehouseId:a.warehouseId,quantity:a.openingQuantity,unitId:unit.id,destinationBinId:bin,batchId:batch?.id,movementType:"OPENING_BALANCE",performedBy:adminId,reason:"Synthetic acceptance opening stock"});
   }
  }
  const c=data.customer;await tx.customer.create({data:{id:c.id,customerCode:c.customerNumber,name:c.name,email:c.email,phone:c.phone,taxNumber:c.taxNumber,createdBy:adminId}});
  const p=data.project;await tx.project.create({data:{id:p.id,code:p.code,name:p.name,location:p.location,assignedManagerId:p.assignedManagerId,warehouseIds:p.warehouseIds,status:"ACTIVE",createdBy:adminId}});
  return {users:data.roles.length,warehouses:data.warehouses.length,products:data.catalog.length};
 },{timeout:60000});
}
async function main(){
 if(process.env.BENAA_QA_ISOLATED!=="1")throw Error("Isolated-test acknowledgement required");
 const url=assertPilotTarget(process.env.BENAA_QA_DATABASE_URL);
 const db=new PrismaClient({datasources:{db:{url}}});
 try{console.log(await seedPilot(db,process.env.BENAA_QA_PASSWORD||""));}finally{await db.$disconnect();}
}
if(require.main===module)main().catch(()=>{console.error("Synthetic seeding refused or failed; no credentials logged");process.exitCode=1;});
