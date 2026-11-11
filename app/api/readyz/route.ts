import { NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import {rateLimitCollection} from '@/lib/cache/mongo-rate-limit';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET() {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    await Promise.race([
      prisma.$runCommandRaw({ping:1}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('readiness timeout')),3000);}),
    ]);
    if(process.env.BENAA_RATE_LIMIT_BACKEND==='mongodb') {
      const indexes:any=await prisma.$runCommandRaw({listIndexes:rateLimitCollection()});
      if(!indexes?.cursor?.firstBatch?.some((i:any)=>i.key?.expiresAt===1 && i.expireAfterSeconds===0)) {
        return NextResponse.json({status:'not_ready'}, {status:503,headers:{'Cache-Control':'no-store'}});
      }
    }
    return NextResponse.json({status:'ready'}, {headers:{'Cache-Control':'no-store'}});
  }catch{
    return NextResponse.json({status:'not_ready'}, {status:503,headers:{'Cache-Control':'no-store'}});
  }finally{if(timer)clearTimeout(timer);}
}
