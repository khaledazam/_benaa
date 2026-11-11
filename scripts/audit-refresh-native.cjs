const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
if(process.env.BENAA_LOCAL_RUNTIME_AUDIT!=='true'||!fs.existsSync('/app/benaa-source-manifest.json')||fs.existsSync('/app/.next'))throw new Error('Only an unbuilt owned audit workspace can be refreshed');
const manifest=JSON.parse(fs.readFileSync('/source/benaa-source-manifest.json','utf8'));let changed=0;
for(const [name,expected]of Object.entries(manifest.files)){
 const source=path.resolve('/source',name),target=path.resolve('/app',name);
 if(!source.startsWith('/source/')||!target.startsWith('/app/')||name.split('/').some(part=>part.startsWith('.')))throw new Error('Invalid manifest path');
 const data=fs.readFileSync(source);if(createHash('sha256').update(data).digest('hex')!==expected)throw new Error('Source integrity mismatch');
 if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw new Error('Unexpected source symlink');
 if(!fs.existsSync(target)||createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==expected){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);changed++;}
}
fs.writeFileSync('/app/benaa-source-manifest.json',JSON.stringify(manifest,null,2));
const probe='/app/.audit-case-probe';fs.writeFileSync(probe,'owned-probe',{flag:'wx'});
const caseSensitive=!fs.existsSync('/app/.AUDIT-CASE-PROBE');fs.unlinkSync(probe);
if(!caseSensitive)throw new Error('Native audit filesystem must be case sensitive');
process.stdout.write(JSON.stringify({status:'PASS',caseSensitive,changedFiles:changed,sourceManifestSha256:manifest.sourceManifestSha256})+'\n');
