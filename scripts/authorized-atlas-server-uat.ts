/** Explicitly authorized existing-Atlas test runner. Creates NEW prefixed User
 * only, starts the real fenced Next API, keeps credentials in RAM, never cleans
 * up records. Does not reset collections, modify Atlas users or touch old rows. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {parseEnv} from 'node:util';
import {MongoClient,ObjectId} from 'mongodb';
import bcrypt from 'bcryptjs';
import {BuildStockPermissions} from '../lib/auth/permissions';
import {runAuthorizedAtlasAcceptance} from './lib/authorized-atlas-acceptance';

const base=process.cwd(),output=path.resolve(base,'../BENAA_CLIENT_DELIVERY/PRODUCTION_RELEASE/evidence');
fs.mkdirSync(output,{recursive:true});
const runId='20261030_'+crypto.randomBytes(3).toString('hex'),prefix=`BENAA_TEST_${runId}_`;
const registryFile=path.join(output,`test-records-${runId}.json`);
const password=crypto.randomBytes(18).toString('hex'),jwt=crypto.randomBytes(48).toString('hex');
const credentials:Record<string,{password:string;token?:string}>={admin:{password}};
const origin='http://127.0.0.1:3471';
let child:ReturnType<typeof spawn>|undefined,client:MongoClient|undefined;
const sessions:Record<string,string>={};
const local=parseEnv(fs.readFileSync(path.join(base,'.env'),'utf8'));
const uri=new URL(local.DATABASE_URL || '');
if(uri.protocol!=='mongodb+srv:' || uri.hostname!=='cluster0.kp7wfjx.mongodb.net' || uri.pathname!=='/buildstock_db')throw new Error('Approved Atlas target mismatch');
const secrets=[local.DATABASE_URL!,decodeURIComponent(uri.password),decodeURIComponent(uri.username),password,jwt];
const redact=(text:string)=>secrets.filter(Boolean).reduce((s,v)=>s.split(v).join('[REDACTED]'),text)
  .replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/g,'[REDACTED_MONGODB_URI]')
  .replace(/http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_=-]+\//g,'http://127.0.0.1:[PORT]/[DEBUG_TOKEN]/');
function emit(value:any){process.stdout.write(JSON.stringify(value)+'\n');}
async function api(method:string,url:string,body?:any,who='admin',key?:string) {
  const response=await fetch(origin+url,{method,redirect:'manual',headers:{'Content-Type':'application/json',
    ...(sessions[who]?{Authorization:`Bearer ${sessions[who]}`}:{}) ,...(key?{'Idempotency-Key':key}:{})},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  let data:any;try{data=await response.json();}catch{data={};}
  return {status:response.status,data};
}
async function login(who:string,username:string,password:string){
  const response=await fetch(origin+'/api/auth/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','X-Benaa-Client':'android'},
    body:JSON.stringify({email:username,password}),signal:AbortSignal.timeout(60000)});
  const body:any=await response.json();if(response.ok)sessions[who]=body.sessionId;
  return {status:response.status,userId:body.userId,mobileGrant:typeof body.refreshToken==='string'};
}
async function main(){
  client=new MongoClient(uri.toString(),{tls:true,tlsAllowInvalidCertificates:false,tlsAllowInvalidHostnames:false,serverSelectionTimeoutMS:15000,maxPoolSize:3});
  await client.connect();const db=client.db('buildstock_db');
  const id=new ObjectId(),name=prefix+'ADMIN',username=(prefix+'admin').toLowerCase();
  // insertOne only: a collision can fail but can never overwrite an old user.
  await db.collection('User').insertOne({_id:id,createdAt:new Date(),email:username+'@benaa.invalid',name,username,
    password:await bcrypt.hash(password,12),status:true,role:'SUPER_ADMIN',sessionVersion:0,
    primaryWarehouseId:null,warehouseIds:[],permissions:Object.values(BuildStockPermissions),permissionsRestricted:false,
    subscriptionStartDate:null,subscriptionEndDate:null});
  fs.writeFileSync(registryFile,JSON.stringify({runId,prefix,records:[{model:'User',id:id.toHexString()}]},null,2));
  fs.writeFileSync(path.join(output,'active-test-run.json'),JSON.stringify({runId,prefix,registry:registryFile,ownerId:id.toHexString(),ownerUsername:username,origin},null,2));
  const env:NodeJS.ProcessEnv={NODE_ENV:'development'};
  for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramData'])if(process.env[key])env[key]=process.env[key];
  Object.assign(env,{NODE_ENV:'development',DATABASE_URL:local.DATABASE_URL,JWT_SECRET:jwt,
    BENAA_TEST_RUN_ID:runId,BENAA_TEST_REGISTRY:registryFile,BENAA_TEST_EXISTING_DATABASE_APPROVED:'true',
    BENAA_LOCAL_AUDIT_DIST_DIR:'.next-codex-online-atlas',BENAA_RATE_LIMIT_BACKEND:'mongodb',BENAA_WRITE_DISABLED:'false',
    NEXT_PUBLIC_API_URL:origin,NEXT_PUBLIC_APP_URL:origin,BENAA_ALLOWED_ORIGINS:origin,
    NEXT_TELEMETRY_DISABLED:'1',NARA_API_KEY:'',STRIPE_API_KEY:'',STRIPE_WEBHOOK_SECRET:'',BREVO_API_KEY:'',
    SENTRY_DSN:'',NEXT_PUBLIC_SENTRY_DSN:'',UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_URL:'',UPSTASH_REDIS_REST_TOKEN:'',UPSTASH_REDIS_TOKEN:''});
  child=spawn(process.execPath,[path.join(base,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3471'],
    {cwd:base,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream?.on('data',bytes=>fs.appendFileSync(path.join(output,'atlas-backend-runtime.log'),redact(bytes.toString())));
  emit({started:true,runId,prefix,ownerUsername:username,ownerId:id.toHexString(),credentials:'RAM only',productionRecordsModified:false});
  for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})){
    try {
      const command=JSON.parse(line);
      if(command.op==='quit')break;
      if(command.op==='login'){
        emit({op:'login',...await login('admin',username,password)});
      }else if(command.op==='acceptance'){
        const result=await runAuthorizedAtlasAcceptance({api,login,runId,prefix,output:path.join(output,`atlas-acceptance-${runId}.json`)});
        emit({op:'acceptance',passed:result.results.filter(r=>r.status==='PASS').length,...result});
      }else if(command.op==='get'){
        const result=await api('GET',command.path,undefined,command.who);
        emit({op:'get',path:command.path,status:result.status,data:result.data});
      }else if(command.op==='post'){
        // Test caller may only submit data prefixed or referring to registered
        // test IDs. The server's fence independently enforces this condition.
        const result=await api('POST',command.path,command.body,command.who);
        const clean=JSON.parse(JSON.stringify(result.data,(key,value)=>['password','sessionId','refreshToken','accessToken'].includes(key)?'[REDACTED]':value));
        emit({op:'post',path:command.path,status:result.status,data:clean});
      }else emit({error:'Unsupported test command'});
    }catch{emit({error:'Test command failed; sensitive error details withheld'});}
  }
}
main().catch(error=>emit({fatal:true,class:error?.name,code:typeof error?.code==='number'?error.code:undefined}))
 .finally(async()=>{child?.kill();await client?.close();});
