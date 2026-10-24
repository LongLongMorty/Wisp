import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const dir=path.dirname(fileURLToPath(import.meta.url));
const fixture=await readFile(path.join(dir,'fixture.html'));
const server=createServer((req,res)=>{
  const url=req.url||'/';
  if(url.startsWith('/vendor/')){
    const file=path.join(dir,'vendor',path.basename(url));
    readFile(file).then(buffer=>{res.setHeader('Content-Type','application/javascript; charset=utf-8');res.end(buffer)}).catch(()=>{res.statusCode=404;res.end('not found')});
    return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const artifacts=path.join(dir,'artifacts');await mkdir(artifacts,{recursive:true});
const profile=await mkdtemp(path.join(artifacts,'profile-'));
const executable=process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const child=spawn(executable,['--headless=new','--disable-gpu','--disable-software-rasterizer','--no-first-run','--no-default-browser-check','--enable-unsafe-extension-debugging','--remote-debugging-pipe','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe'],windowsHide:true});
let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-8000)});
let next=0,buffer='',pending=new Map();
child.stdio[4].on('data',b=>{buffer+=b;let end;while((end=buffer.indexOf('\0'))>=0){const raw=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!raw)continue;const m=JSON.parse(raw);if(m.id && pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}}});
child.once('exit',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Chrome exited'))}pending.clear()});
child.once('error',error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error)}pending.clear()});
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{if(child.exitCode!==null || child.killed){reject(Error('Chrome not running'));return;}const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout: '+method))},20000);pending.set(id,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0')})}
async function evaluate(sessionId,expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
const report={timestamp:new Date().toISOString(),node:process.version,platform:process.platform,profile,results:[]};
try{
  report.browser=await send('Browser.getVersion');console.error('Browser connected');
  const extension=await send('Extensions.loadUnpacked',{path:path.join(dir,'extension')});report.extensionId=extension.id;console.error('Extension loaded');
  await send('Target.createTarget',{url:origin+'/fixture'});
  const runner=await send('Target.createTarget',{url:'chrome-extension://'+extension.id+'/runner.html'});
  const {sessionId}=await send('Target.attachToTarget',{targetId:runner.targetId,flatten:true});
  await send('Runtime.enable',{},sessionId);
  let ready=false;for(let i=0;i<100;i++){try{ready=await evaluate(sessionId,'typeof chrome.runtime?.sendMessage === "function"')}catch(error){throw Error('Runner initialization: '+error.message)}if(ready)break;await new Promise(r=>setTimeout(r,50))}if(!ready)throw Error('Runner not ready');
  console.error('Runner ready');const response=await evaluate(sessionId,'chrome.runtime.sendMessage('+JSON.stringify({kind:'probe',origin})+')');
  if(!response.ok)throw Error(response.error);report.results.push(...response.data.results);if(response.data.error)throw Error(response.data.error);
  await send('ServiceWorker.enable',{},sessionId);await send('ServiceWorker.stopAllWorkers',{},sessionId);
  await new Promise(r=>setTimeout(r,250));
  const restored=await evaluate(sessionId,'chrome.runtime.sendMessage({kind:"checkpoint"})');
  report.results.push({name:'worker.restart',pass:restored.ok && restored.data.bootId!==response.data.bootId,detail:'new boot ID after stopAllWorkers'});
  report.results.push({name:'worker.unknownCheckpoint',pass:restored.ok && restored.data.checkpoint?.status==='dispatching' && restored.data.checkpoint?.actionId==='probe-unknown',detail:'checkpoint retained; no action replay implemented'});
  report.passed=report.results.every(r=>r.pass);
}catch(error){report.passed=false;report.error=error.message;report.stderr=stderr}
finally{
  await send('Browser.close').catch(()=>{});child.kill();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Browser closed'))}pending.clear();for(const stream of child.stdio)stream?.destroy();child.unref();server.close();
  await writeFile(path.join(artifacts,'latest.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
