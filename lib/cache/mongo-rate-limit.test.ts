import { expect,it } from 'vitest';
import { checkMongoRateLimit } from './mongo-rate-limit';
it('concurrent admissions have a shared atomic cap and roll into a fresh time bucket',async()=>{
  const rows=new Map<string,number>();
  const db={$runCommandRaw:async(command:any)=>{
    const key=command.query._id,count=rows.get(key)||0;
    if(count>=command.query.count.$lt)throw {code:11000};
    rows.set(key,count+1);return {value:{count:count+1}};
  }};
  const results=await Promise.all(Array.from({length:20},()=>checkMongoRateLimit(db,{identifier:'auth:fixture',limit:5,window:60},120000)));
  expect(results.filter(r=>r.allowed)).toHaveLength(5);
  expect([...rows.keys()][0]).not.toContain('fixture');
  expect((await checkMongoRateLimit(db,{identifier:'auth:fixture',limit:5,window:60},180000)).allowed).toBe(true);
});
it('database and malformed-response failures deny admission rather than silently permitting',async()=>{
  await expect(checkMongoRateLimit({$runCommandRaw:async()=>{throw new Error('offline');}},
    {identifier:'auth',limit:5,window:60})).rejects.toThrow('RATE_LIMIT_UNAVAILABLE');
  await expect(checkMongoRateLimit({$runCommandRaw:async()=>({value:{count:999}})},
    {identifier:'auth',limit:5,window:60})).rejects.toThrow('RATE_LIMIT_UNAVAILABLE');
});
