import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({parse:vi.fn(),createHistory:vi.fn(),updateHistory:vi.fn()}));
vi.mock('@/utils/auth',()=>({getSessionFromRequest:async()=>({id:'actor',role:'SUPER_ADMIN'})}));
vi.mock('@/lib/api/rate-limit',()=>({withRateLimit:async()=>null,defaultRateLimits:{standard:{}}}));
vi.mock('@/lib/logger',()=>({logger:{error:vi.fn()}}));
vi.mock('@/lib/import',async()=>({...await vi.importActual('@/lib/import'),parseFile:mocks.parse}));
vi.mock('@/prisma/import-history',()=>({createImportHistory:mocks.createHistory,updateImportHistory:mocks.updateHistory}));
vi.mock('@/lib/cache',()=>({scheduleInvalidateImportCaches:async()=>{}}));
vi.mock('@/lib/email/notifications',()=>({checkAndSendStockAlerts:async()=>{}}));
vi.mock('@/prisma/client',()=>({prisma:{category:{findMany:vi.fn()},supplier:{findMany:vi.fn()},product:{findUnique:vi.fn(),create:vi.fn(),findMany:vi.fn()}}}));
import { prisma } from '@/prisma/client';
import { POST } from './route';
const row=(data:Record<string,string|number>={},rowNumber=2)=>({rowNumber,isHeader:false,data:{'Product Name':'Synthetic product',SKU:'TEST-IMPORT',Price:'10',Quantity:'0',Status:'Available',Category:'Category',Supplier:'Supplier',...data}});
function request(file:File|string=new File(['fixture'],'test.csv')){
 const req=new NextRequest('http://isolated.invalid/api/products/import',{method:'POST'});
 const form=new FormData();form.set('file',file);vi.spyOn(req,'formData').mockResolvedValue(form);return req;
}
beforeEach(()=>{
 vi.clearAllMocks();mocks.createHistory.mockResolvedValue({id:'history'});
 mocks.parse.mockResolvedValue([row()]);
 vi.mocked(prisma.category.findMany).mockResolvedValue([{id:'category',name:'Category'}] as never);
 vi.mocked(prisma.supplier.findMany).mockResolvedValue([{id:'supplier',name:'Supplier'}] as never);
 vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
 vi.mocked(prisma.product.findMany).mockResolvedValue([]);
});
it('imports valid zero-stock metadata using resolved IDs and authenticated identity',async()=>{
 const response=await POST(request());const result=await response.json();
 expect(response.status).toBe(200);expect(result).toMatchObject({success:true,totalRows:1,successRows:1,failedRows:0});
 expect(prisma.product.create).toHaveBeenCalledWith({data:expect.objectContaining({quantity:0,userId:'actor',createdBy:'actor',categoryId:'category',supplierId:'supplier'})});
});
it.each(['1','0.9'])('rejects nonzero stock %s without truncation or inventory creation',async(quantity)=>{
 mocks.parse.mockResolvedValue([row({Quantity:quantity})]);const result=await (await POST(request())).json();
 expect(result).toMatchObject({success:false,successRows:0,failedRows:1});expect(prisma.product.create).not.toHaveBeenCalled();
});
it('counts invalid rows once, does not persist raw uploaded data, and records failure',async()=>{
 mocks.parse.mockResolvedValue([row({'Product Name':'x'.repeat(101),SKU:'invalid!'})]);
 const result=await (await POST(request())).json();expect(result).toMatchObject({success:false,successRows:0,failedRows:1});
 expect(result.errors.length).toBeGreaterThan(1);expect(result.errors.every((e:any)=>!('rowData' in e))).toBe(true);
 expect(mocks.updateHistory).toHaveBeenCalledWith('history',expect.objectContaining({status:'failed',failedRows:1}));
});
it('reports partial results without claiming every row succeeded',async()=>{
 mocks.parse.mockResolvedValue([row(),row({SKU:'invalid!'},3)]);
 expect(await (await POST(request())).json()).toMatchObject({success:false,partial:true,totalRows:2,successRows:1,failedRows:1});
});
it('rejects empty imports before creating history',async()=>{
 mocks.parse.mockResolvedValue([]);expect((await POST(request())).status).toBe(400);expect(mocks.createHistory).not.toHaveBeenCalled();
});
it('rejects malformed multipart without a server error',async()=>{
 const req=request();vi.mocked(req.formData).mockRejectedValue(new TypeError('truncated'));
 expect((await POST(req)).status).toBe(400);expect(mocks.createHistory).not.toHaveBeenCalled();
});
it('rejects a non-file field before parsing',async()=>{
 expect((await POST(request('not a file'))).status).toBe(400);expect(mocks.parse).not.toHaveBeenCalled();
});
it('rejects files above 10 MiB with 413 before parsing or writes',async()=>{
 expect((await POST(request(new File([new Uint8Array(10*1024*1024+1)],'too-large.csv')))).status).toBe(413);
 expect(mocks.parse).not.toHaveBeenCalled();expect(mocks.createHistory).not.toHaveBeenCalled();
});
