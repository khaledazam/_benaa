import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {configuration}=require('./start-backend.cjs');
it('does not accept an implicit config file or start with inherited secrets',()=>{
  expect(()=>configuration(undefined,()=>{})).toThrow('absolute');
  expect(()=>configuration('relative.env',()=>{})).toThrow('absolute');
});
it('validates the explicit shutdown credential, sentinel path and listener port',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'benaa-config-')),file=path.join(folder,'backend.env');
  const sentinel=path.join(folder,'disable-writes');
  const save=(port:string,token='a'.repeat(48))=>fs.writeFileSync(file,`PORT=${port}\nBENAA_SHUTDOWN_TOKEN=${token}\nBENAA_WRITE_DISABLE_FILE="${sentinel.replaceAll('\\','/')}"\n`);
  try{
    save('3217');expect(configuration(file,()=>{}).port).toBe(3217);
    save('80');expect(()=>configuration(file,()=>{})).toThrow('PORT');
    save('3217','short');expect(()=>configuration(file,()=>{})).toThrow('SHUTDOWN_TOKEN');
    save('3217');expect(()=>configuration(file,()=>{throw new Error('unsafe runtime');})).toThrow('unsafe runtime');
  }finally{fs.unlinkSync(file);fs.rmdirSync(folder);}
});
