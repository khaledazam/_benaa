// Packaging only; never installs a service, creates a tunnel or opens a DB.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ts=require('typescript');
const source=path.resolve(__dirname,'../..');
const output=process.argv[2] || 'windows-backend';
if(!/^windows-backend(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(output) || process.argv.length>3)throw new Error('Invalid Windows package directory name');
const target=path.resolve(source,'../BENAA_CLIENT_DELIVERY/PRODUCTION_RELEASE',output);
const buildDir=process.env.BENAA_LOCAL_AUDIT_DIST_DIR || '.next';
if(buildDir!=='.next' && !/^\.next-codex-[a-z0-9-]+$/.test(buildDir))throw new Error('Invalid build directory');
const standalone=path.join(source,buildDir,'standalone');
if(!fs.existsSync(path.join(standalone,'server.js')))throw new Error('A fresh verified standalone production build is required');
if(fs.existsSync(target))throw new Error('Package directory already exists; preserve prior artifacts');
fs.mkdirSync(target,{recursive:true});
const forbidden=/^(\.env(?:\..*)?|key\.properties|.*\.(?:jks|keystore|p12|pfx|key))$/i;
const safeFile=file=>{
  if(forbidden.test(path.basename(file)))return false;
  if(fs.lstatSync(file).isSymbolicLink())throw new Error('Non-relocatable link in build; not a portable Windows package');
  return true;
};
fs.cpSync(standalone,target,{recursive:true,filter:safeFile});
for(const dir of ['public',buildDir+'/static'])if(fs.existsSync(path.join(source,dir)))fs.cpSync(path.join(source,dir),path.join(target,dir),{recursive:true,filter:safeFile});
for(const name of ['start-backend.cjs','stop-backend.cjs','service-lifecycle.cjs','backend.env.example','BENAA-Service.xml.example','cloudflared.yml.example'])fs.copyFileSync(path.join(__dirname,name),path.join(target,name));
const config=fs.readFileSync(path.join(source,'lib/runtime/config.ts'),'utf8');
fs.writeFileSync(path.join(target,'runtime-config.cjs'),ts.transpileModule(config,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
const hashes=[];
function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);if(entry.isDirectory()){scan(file);continue;}
  if(forbidden.test(entry.name))throw new Error('Forbidden private file in package');
  hashes.push({file:path.relative(target,file).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
}}
scan(target);fs.writeFileSync(path.join(target,'PACKAGE-MANIFEST.json'),JSON.stringify({productionApproved:false,files:hashes},null,2));
console.log(JSON.stringify({package:target,files:hashes.length,installed:false,productionApproved:false}));
