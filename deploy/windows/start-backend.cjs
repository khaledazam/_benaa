// Windows service entry. No credential values are written to stdout/files.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { parseEnv } = require('node:util');

function configuration(file, validate) {
  if (!file || !path.isAbsolute(file)) throw new Error('An absolute BENAA_WINDOWS_CONFIG path is required');
  const env = parseEnv(fs.readFileSync(file, 'utf8'));
  validate({ ...env, NODE_ENV:'production' });
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(env.BENAA_SHUTDOWN_TOKEN || '')) throw new Error('BENAA_SHUTDOWN_TOKEN required');
  if (!path.isAbsolute(env.BENAA_WRITE_DISABLE_FILE || '')) throw new Error('Absolute BENAA_WRITE_DISABLE_FILE required');
  const port = Number(env.PORT || 3217);
  if (!Number.isInteger(port) || port < 1024 || port > 65533) throw new Error('Invalid PORT');
  return { env, port };
}
function main() {
  const base = __dirname;
  const { validateRuntimeConfiguration } = require('./runtime-config.cjs');
  const { env, port } = configuration(process.env.BENAA_WINDOWS_CONFIG, validateRuntimeConfiguration);
  if (!fs.existsSync(path.join(base,'server.js'))) throw new Error('Verified standalone server package required');
  const childEnv = {};
  for (const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramData']) {
    if (process.env[key]) childEnv[key] = process.env[key];
  }
  Object.assign(childEnv,env,{ NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port+1),NEXT_TELEMETRY_DISABLED:'1' });
  // No .env copy, inherited DATABASE_URL, NODE_OPTIONS or shell interpolation.
  const child = spawn(process.execPath,['--require',path.join(base,'service-lifecycle.cjs'),path.join(base,'server.js')],
    { cwd:base,env:childEnv,windowsHide:true,stdio:['ignore','inherit','inherit','ipc'] });
  const log = (event,fields={}) => process.stdout.write(JSON.stringify({ time:new Date().toISOString(),event,...fields })+'\n');
  let stopping=false;
  const server = http.createServer((request,response) => {
    const id=crypto.randomUUID(),begin=Date.now();
    const pathname=(request.url || '/').split('?')[0];
    response.setHeader('X-Benaa-Request-Id',id);
    if (stopping || (fs.existsSync(env.BENAA_WRITE_DISABLE_FILE) &&
        !['GET','HEAD','OPTIONS'].includes(request.method) &&
        !['/api/auth/login','/api/auth/logout','/api/auth/refresh'].includes(pathname))) {
      response.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':'60'});
      response.end(JSON.stringify({error:'Business writes disabled',code:'WRITES_DISABLED'}));return;
    }
    const approved=new URL(env.NEXT_PUBLIC_API_URL);
    const upstream=http.request({hostname:'127.0.0.1',port:port+1,method:request.method,path:request.url,
      headers:{...request.headers,host:approved.host,'x-forwarded-host':approved.host,
        'x-forwarded-proto':'https','x-benaa-request-id':id}},incoming => {
      response.writeHead(incoming.statusCode || 502,incoming.headers);incoming.pipe(response);
    });
    upstream.on('error',() => {if(!response.headersSent) response.writeHead(503,{'Content-Type':'application/json'});response.end('{"error":"Backend unavailable"}');});
    request.on('aborted',() => upstream.destroy());request.pipe(upstream);
    response.on('finish',() => log('request',{id,method:request.method,status:response.statusCode,durationMs:Date.now()-begin}));
  });
  server.requestTimeout=120000;server.headersTimeout=15000;
  const shutdown=() => {
    if(stopping)return;stopping=true;log('shutdown_started');
    server.close();control.close();
    // The child emits SIGTERM within its own process, allowing Next to drain on Windows.
    child.send({type:'benaa-shutdown'});
    const timeout=setTimeout(() => {log('shutdown_deadline');child.kill();},45000);timeout.unref();
  };
  const control=net.createServer(socket => {
    let input='';socket.setTimeout(3000,() => socket.destroy());
    socket.on('data',chunk => {
      input+=chunk.toString();if(input.length>256){socket.destroy();return;}
      if(!input.includes('\n'))return;
      const supplied=Buffer.from(input.trim()),expected=Buffer.from(env.BENAA_SHUTDOWN_TOKEN);
      if(supplied.length===expected.length && crypto.timingSafeEqual(supplied,expected)) {
        socket.end('accepted\n');shutdown();
      } else socket.destroy();
    });
  });
  control.on('error',() => {log('control_unavailable');child.kill();process.exitCode=1;server.close();});
  control.listen('\\\\.\\pipe\\BENAA-ERP-'+port);
  server.listen(port,'127.0.0.1',() => log('listener_started',{loopbackOnly:true,port}));
  child.on('exit',code => {log('backend_exit',{code});server.close();control.close();process.exitCode=stopping ? 0 : (code || 1);});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,shutdown);
}
module.exports={configuration};
if(require.main===module) {try{main();}catch{process.stderr.write('{"event":"startup_rejected","action":"Check required configuration names and package integrity"}\n');process.exitCode=1;}}
