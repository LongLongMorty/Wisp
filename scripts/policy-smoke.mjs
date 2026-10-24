import {execFileSync} from 'node:child_process';import {root} from './tools.mjs';
await import('./protocol-build.mjs');await import('./browser-build.mjs');await import('./policy-build.mjs');
let passed=true;
for(const [file,env]of [['packages/browser-chrome/test/observer-browser.mjs',{WISP_OBSERVER_REPORT:'t007-observer-browser.json'}],['packages/browser-chrome/test/control-browser.mjs',{WISP_CONTROL_REPORT:'t007-control-browser.json'}],['packages/policy/test/policy-browser.mjs',{}]]){try{execFileSync(process.execPath,[file],{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true,timeout:60000})}catch{passed=false}}
if(!passed)process.exitCode=1;
