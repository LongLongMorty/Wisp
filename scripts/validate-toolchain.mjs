import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root } from './tools.mjs';
import { modelHashes } from './models-evidence.mjs';
import { loopHashes } from './loop-evidence.mjs';
import {sdkHashes} from './sdk-evidence.mjs';
import {panelHashes} from './panel-evidence.mjs';
import {collectFaults,matches} from './faults-evidence.mjs';
import {collectRelease,writeRelease} from './release-evidence.mjs';
const stage=process.argv[2] ?? 't002b';
if(!['t002b','t003b','t004','t005','t006','t007','t008','t009','t010','t011','t012','t013','t014'].includes(stage))throw new Error('Unsupported validation stage');
const commands=[
  ['static',['scripts/static-check.mjs']],
  ['tests',['scripts/test.mjs']],
  ['typecheck',['scripts/typecheck.mjs']],
  ['build',['scripts/build.mjs']],
];
if(['t011','t012','t013','t014'].includes(stage))commands.push(['sdkExample',['packages/sdk/examples/minimal.mjs']]);
const report={timestamp:new Date().toISOString(),node:process.version,platform:process.platform,status:'pending',checks:[],files:{}};
for(const [name,args] of commands){
  try{
    const stdout=execFileSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:60000,windowsHide:true,stdio:['ignore','pipe','pipe']});
    report.checks.push({name,passed:true,stdout});console.log(name+': PASS');
  }catch(error){
    report.checks.push({name,passed:false,exitCode:error.status,stdout:String(error.stdout||''),stderr:String(error.stderr||error.message)});console.log(name+': FAIL');
  }
}
async function fingerprint(directory){
  for(const entry of await readdir(path.join(root,directory),{withFileTypes:true})){
    if(['node_modules','dist','.wxt','.output','.cache'].includes(entry.name))continue;
    const file=path.posix.join(directory,entry.name);
    if(entry.isDirectory())await fingerprint(file);
    else report.files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
  }
}
for(const directory of ['apps','packages','scripts','fixtures'])await fingerprint(directory);
for(const file of ['package.json','package-lock.json','tsconfig.base.json']){
  try{report.files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
const hasLock=Object.hasOwn(report.files,'package-lock.json');
report.status=report.checks.every(check=>check.passed)&&hasLock?'passed':'incomplete';
report.lockfilePresent=hasLock;
if(stage==='t004'){
 try{const browser=JSON.parse(await readFile(path.join(root,'specs/001-browser-agent/evidence/t004-browser.json'),'utf8'));report.browserSmoke={status:browser.status,timestamp:browser.timestamp};if(browser.status==='failed')report.status='incomplete';}
 catch(error){report.browserSmoke={status:'not-run'};report.status='incomplete';}
}
if(stage==='t005'){
 try{const browser=JSON.parse(await readFile(path.join(root,'specs/001-browser-agent/evidence/t005-browser.json'),'utf8'));report.browserSmoke={status:browser.status,timestamp:browser.timestamp};const current=Object.entries(browser.files||{}).every(([file,hash])=>report.files[file]===hash);report.browserSmoke.sourceHashesMatch=current;if(browser.status!=='passed'||!current||!browser.checks?.length)report.status='incomplete';}
 catch{report.browserSmoke={status:'not-run'};report.status='incomplete';}
}
if(stage==='t006'||stage==='t007'||stage==='t008'){
 for(const [key,name,min]of (stage==='t008'?[['observerRegression','t008-observer-browser',14],['browserControl','t008-control-browser',20],['browserPolicy','t008-policy-browser',17],['browserRuntime','t008-browser',24]]:stage==='t007'?[['observerRegression','t007-observer-browser',14],['browserControl','t007-control-browser',20],['browserPolicy','t007-browser',17]]:[['observerRegression','t006-observer-browser',14],['browserControl','t006-browser',20]])){
  try{const browser=JSON.parse(await readFile(path.join(root,'specs/001-browser-agent/evidence/'+name+'.json'),'utf8'));let current=Object.keys(browser.files||{}).length>0;for(const [file,hash]of Object.entries(browser.files||{})){const actual=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');if(actual!==hash)current=false;}report[key]={status:browser.status,timestamp:browser.timestamp,sourceHashesMatch:current};if(browser.status!=='passed'||!current||browser.checks?.length<min||!browser.checks?.every(c=>c.passed===true))report.status='incomplete';}
  catch{report[key]={status:'not-run'};report.status='incomplete';}
 }
}
if(stage==='t009'){
 try{const live=JSON.parse(await readFile(path.join(root,'specs/001-browser-agent/evidence/t009-model-live.json'),'utf8'));const expected=await modelHashes();const current=Object.keys(live.files??{}).length===Object.keys(expected).length&&Object.entries(expected).every(([file,hash])=>live.files?.[file]===hash);report.actualModel={status:live.status,sourceHashesMatch:current};if(live.kind!=='actual-model-endpoint'||live.status!=='passed'||!current||live.checks?.length!==2||!['decide','extract'].every(name=>live.checks.some(c=>c.name===name&&c.passed===true)))report.status='incomplete';}
 catch{report.actualModel={status:'not-run'};report.status='incomplete';}
}
if(['t010','t011','t012'].includes(stage)){
 const suites=[['observerRegression',stage+'-observer-browser',14],['browserControl',stage+'-control-browser',20],['browserPolicy',stage+'-policy-browser',17],['browserRuntime',stage+'-runtime-browser',24],['browserLoop',stage+'-loop-browser',10],...(['t011','t012'].includes(stage)?[['browserSdk',stage+'-sdk-browser',11]]:[]),...(stage==='t012'?[['browserPanel','t012-panel-browser',26]]:[])];
 for(const [key,file,min]of suites){
  try{const browser=JSON.parse(await readFile(path.join(root,'specs/001-browser-agent/evidence/'+file+'.json'),'utf8'));const expected=key==='browserLoop'?await loopHashes():key==='browserSdk'?await sdkHashes():key==='browserPanel'?await panelHashes():browser.files;const hashes=Object.entries(expected??{});let current=hashes.length>0;for(const [f,h]of hashes){if(browser.files?.[f]!==h||createHash('sha256').update(await readFile(path.join(root,f))).digest('hex')!==h)current=false;}if(['browserLoop','browserSdk','browserPanel'].includes(key)&&Object.keys(browser.files??{}).length!==hashes.length)current=false;report[key]={status:browser.status,sourceHashesMatch:current};if(browser.status!=='passed'||!current||browser.checks?.length<min||!browser.checks?.every(c=>c.passed===true))report.status='incomplete';}catch{report[key]={status:'not-run'};report.status='incomplete';}
 }
}
if(stage==='t012'){try{const manual=JSON.parse(await readFile(path.join(root,'specs/001-browser-agent/evidence/t012-manual.json'),'utf8')),expected=await panelHashes();const current=Object.keys(manual.files??{}).length===Object.keys(expected).length&&Object.entries(expected).every(([f,h])=>manual.files?.[f]===h);report.manualPanel={status:manual.status,sourceHashesMatch:current};if(manual.kind!=='human-review'||manual.status!=='passed'||!manual.reviewer||!current||manual.checks?.length!==5||!['permissions','layout','confirmation','takeover','privacy'].every(name=>manual.checks.some(c=>c.name===name&&c.passed===true)))report.status='incomplete';}catch{report.manualPanel={status:'not-run'};report.status='incomplete';}}
if(stage==='t013') {
 try {
  const saved=JSON.parse(await readFile(path.join(root,'specs/001-browser-agent/evidence/t013-faults.json'),'utf8')),current=await collectFaults();
  const bound=matches(saved.files,current.files)&&JSON.stringify(saved.suites)===JSON.stringify(current.suites)&&JSON.stringify(saved.checks)===JSON.stringify(current.checks);
  report.faultMatrix={status:current.status,sourceHashesMatch:bound,suites:current.suites,passed:current.checks.filter(c=>c.passed).length,total:current.checks.length};
  if(saved.status!=='passed'||current.status!=='passed'||!bound)report.status='incomplete';
 } catch(error) {report.faultMatrix={status:'not-run',error:error.code??error.message};report.status='incomplete';}
}
if(stage==='t014') {
 try {
  const release=await collectRelease();await writeRelease('acceptance',release);
  report.release={status:release.status,suites:release.suites,checks:release.checks};
  if(release.status!=='passed')report.status='incomplete';
 }catch(error){report.release={status:'not-run',error:error.code??'INVALID_EVIDENCE'};report.status='incomplete';}
}
await writeFile(path.join(root,'specs/001-browser-agent/evidence/'+stage+'-checks.json'),JSON.stringify(report,null,2)+'\n');
console.log('Report: specs/001-browser-agent/evidence/'+stage+'-checks.json');
if(report.status!=='passed')process.exitCode=1;
