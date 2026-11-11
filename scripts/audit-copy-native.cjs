/* Initialize a new owned Linux volume from the exact source-only audit manifest. */
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
if(process.env.BENAA_LOCAL_RUNTIME_AUDIT!=='true')throw new Error('Local audit opt-in required');
if(fs.readdirSync('/app').length)throw new Error('Native audit volume must be empty');
const manifest=JSON.parse(fs.readFileSync('/source/benaa-source-manifest.json','utf8'));
let bytes=0;
for(const [name,expected] of Object.entries(manifest.files)){
  const source=path.resolve('/source',name), target=path.resolve('/app',name);
  if(!source.startsWith('/source/')||!target.startsWith('/app/')||name.split('/').some(part=>part.startsWith('.')))throw new Error('Invalid source manifest path');
  if(fs.lstatSync(source).isSymbolicLink())throw new Error('Source manifest must not contain symlinks');
  const data=fs.readFileSync(source);
  if(createHash('sha256').update(data).digest('hex')!==expected)throw new Error('Source manifest integrity mismatch');
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data,{flag:'wx'});bytes+=data.length;
}
fs.writeFileSync('/app/benaa-source-manifest.json',JSON.stringify(manifest,null,2),{flag:'wx'});
process.stdout.write(JSON.stringify({status:'SOURCE_COPIED',files:Object.keys(manifest.files).length,bytes,sourceManifestSha256:manifest.sourceManifestSha256})+'\n');
