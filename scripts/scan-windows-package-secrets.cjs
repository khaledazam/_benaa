const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util');
const root=process.cwd(),target=path.resolve(root,'../BENAA_CLIENT_DELIVERY/PRODUCTION_RELEASE/windows-backend');
if(!fs.existsSync(path.join(target,'PACKAGE-MANIFEST.json')))throw new Error('Reviewed package required');
const local=parseEnv(fs.readFileSync(path.join(root,'.env'),'utf8'));
const values=Object.entries(local).filter(([name,value])=>/(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|DATABASE_URL)/.test(name) && value.length>=8).map(([,v])=>v);
try{const u=new URL(local.DATABASE_URL);if(u.password)values.push(decodeURIComponent(u.password));}catch{}
let files=0;const hits=[];
function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);if(entry.isDirectory()){scan(file);continue;}
  files++;const content=fs.readFileSync(file);
  if(/^(\.env(?:\..*)?|key\.properties|.*\.(?:jks|keystore|p12|pfx|key))$/i.test(entry.name) || values.some(secret=>content.includes(Buffer.from(secret))))hits.push(path.relative(target,file));
}}
scan(target);
const result={status:hits.length?'FAIL':'PASS',filesScanned:files,knownLocalSecretValuesChecked:values.length,affectedFiles:hits,
  scope:'Known local server credentials and forbidden private filenames; this does not establish that no unknown secret exists'};
fs.writeFileSync(path.resolve(target,'../evidence/windows-package-secret-scan.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(hits.length)process.exitCode=1;
