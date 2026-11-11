// Test the packaged Windows process using unreachable loopback MongoDB only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const output=path.resolve(process.cwd(),'../BENAA_CLIENT_DELIVERY/PRODUCTION_RELEASE');
const pkg=path.join(output,'windows-backend'),tag=crypto.randomBytes(6).toString('hex');
const config=path.join(output,'.runtime-smoke-'+tag+'.env'),sentinel=path.join(output,'.runtime-smoke-'+tag+'.disabled');
const token=crypto.randomBytes(32).toString('hex'),jwt=crypto.randomBytes(48).toString('hex');
const env={BENAA_WINDOWS_CONFIG:config};
for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramData'])if(process.env[key])env[key]=process.env[key];
const settings={NODE_ENV:'production',PORT:'3481',DATABASE_URL:'mongodb://127.0.0.1:1/benaa_test_runtime_smoke?directConnection=true&serverSelectionTimeoutMS=1000',
 JWT_SECRET:jwt,NEXT_PUBLIC_API_URL:'http://127.0.0.1:3481',NEXT_PUBLIC_APP_URL:'http://127.0.0.1:3481',BENAA_ALLOWED_ORIGINS:'http://127.0.0.1:3481',
 BENAA_DEPLOYMENT_ENV:'isolated',BENAA_ISOLATED_RUNTIME:'true',BENAA_DATABASE_HOST:'127.0.0.1',BENAA_DATABASE_NAME:'benaa_test_runtime_smoke',
 BENAA_WRITE_DISABLED:'true',BENAA_RATE_LIMIT_BACKEND:'mongodb',BENAA_WRITE_DISABLE_FILE:sentinel.replaceAll('\\','/'),BENAA_SHUTDOWN_TOKEN:token};
const results=[];let child;
const log=path.join(output,'evidence/windows-package-runtime.log');
function check(name,pass,evidence){results.push({name,status:pass?'PASS':'FAIL',evidence});if(!pass)throw new Error(name);}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(pathname,method='GET'){return fetch('http://127.0.0.1:3481'+pathname,{method,redirect:'manual',signal:AbortSignal.timeout(5000),headers:method==='POST'?{'Content-Type':'application/json'}:{},body:method==='POST'?'{}':undefined});}
async function stop(){await new Promise((resolve,reject)=>execFile(process.execPath,[path.join(pkg,'stop-backend.cjs')],{env,windowsHide:true,timeout:7000},error=>error?reject(error):resolve()));}
async function main(){
 fs.writeFileSync(config,Object.entries(settings).map(([k,v])=>k+'='+v).join('\n'),{flag:'wx'});
 child=spawn(process.execPath,[path.join(pkg,'start-backend.cjs')],{cwd:pkg,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',data=>fs.appendFileSync(log,data.toString().split(token).join('[REDACTED]').split(jwt).join('[REDACTED]')));
 let ready=false;
 for(let i=0;i<60;i++){try{if((await request('/api/livez')).status===200){ready=true;break;}}catch{}await pause(500);}
 check('Standalone package liveness',ready,{port:3481,bind:'127.0.0.1',database:'unreachable loopback; no Atlas'});
 let response=await request('/api/readyz');check('Readiness fails closed without database',response.status===503,{status:response.status});
 response=await request('/api/warehouses');check('Protected route rejects unauthenticated request',response.status===401,{status:response.status});
 response=await request('/api/warehouses','POST');check('Runtime business write disable',response.status===503,{status:response.status});
 fs.writeFileSync(sentinel,'Synthetic emergency test\n',{flag:'wx'});
 response=await request('/api/products','POST');check('Parent emergency sentinel write disable',response.status===503 && (await response.json()).code==='WRITES_DISABLED',{status:response.status});
 const exited=new Promise(resolve=>child.once('exit',(code)=>resolve(code)));
 await stop();const code=await Promise.race([exited,pause(15000).then(()=>-999)]);
 check('Authenticated local graceful stop',code===0,{exitCode:code});
}
main().catch(error=>{results.push({name:'Smoke execution',status:'FAIL',evidence:{message:error?.message || 'failed'}});process.exitCode=1;})
 .finally(async()=>{
   if(child && child.exitCode===null){try{await stop();}catch{}child.kill();}
   for(const file of [config,sentinel])if(fs.existsSync(file))fs.unlinkSync(file);
   const result={scope:'Local packaged process only; no Atlas access, service installation or deployment',results};
   fs.writeFileSync(path.join(output,'evidence/windows-package-smoke.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 });
