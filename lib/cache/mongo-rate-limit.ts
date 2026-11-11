import { createHash } from 'node:crypto';
import type { RateLimitResult } from './rate-limit';
export function rateLimitCollection() {
  const run=process.env.BENAA_TEST_RUN_ID;
  if(run && !/^[0-9]{8}_[a-f0-9]{6}$/.test(run))throw new Error('Invalid test run');
  return run ? `BENAA_TEST_${run}_RateLimitBucket` : 'RateLimitBucket';
}

/** Atomic fixed-window admission for one or many Windows API processes.
 * Namespace is owned by BENAA; _id is unique. No token/email is stored.
 * Operator initialization must create expiresAt TTL index (expireAfterSeconds=0).
 */
export async function checkMongoRateLimit(db: any, config: {
  identifier:string; limit:number; window:number;
}, now=Date.now()): Promise<RateLimitResult> {
  if (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > 100000 ||
      !Number.isInteger(config.window) || config.window < 1 || config.window > 86400 ||
      !config.identifier || config.identifier.length > 500) throw new Error('RATE_LIMIT_UNAVAILABLE');
  const windowMs=config.window*1000, bucket=Math.floor(now/windowMs);
  const id=createHash('sha256').update(config.identifier).digest('hex')+':'+bucket;
  const reset=Math.max(1,Math.ceil(((bucket+1)*windowMs-now)/1000));
  try {
    const result=await db.$runCommandRaw({findAndModify:rateLimitCollection(),
      query:{_id:id,count:{$lt:config.limit}},
      update:{$inc:{count:1},$setOnInsert:{expiresAt:{$date:new Date((bucket+2)*windowMs).toISOString()}}},
      upsert:true,new:true});
    const count=result?.value?.count;
    if (!Number.isInteger(count) || count < 1 || count > config.limit) throw new Error('RATE_LIMIT_UNAVAILABLE');
    return {allowed:true,current:count,limit:config.limit,reset};
  } catch (error:any) {
    // Saturated buckets cannot match query; upsert hits the unique _id instead.
    if (String(error?.code)==='11000' || String(error?.meta?.code)==='11000') {
      return {allowed:false,current:config.limit,limit:config.limit,reset};
    }
    throw new Error('RATE_LIMIT_UNAVAILABLE'); // never fail open on DB outage
  }
}
