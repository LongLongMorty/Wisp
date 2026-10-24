import {execFileSync} from 'node:child_process';
import {root} from './tools.mjs';
await import('./browser-build.mjs');
let passed=true;
for(const [file,env]of [['packages/browser-chrome/test/observer-browser.mjs',{WISP_OBSERVER_REPORT:'t006-observer-browser.json'}],['packages/browser-chrome/test/control-browser.mjs',{}]]){
 try{execFileSync(process.execPath,[file],{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true,timeout:60000})}catch{passed=false}
}
if(!passed)process.exitCode=1;
