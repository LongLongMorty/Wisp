import {execFileSync} from 'node:child_process';import {root} from './tools.mjs';
await import('./protocol-build.mjs');await import('./browser-build.mjs');await import('./policy-build.mjs');await import('./runtime-build.mjs');
let passed=true;
const stage=['t010','t011','t012','t013'].includes(process.env.WISP_RUNTIME_STAGE)?process.env.WISP_RUNTIME_STAGE:'t008';
for(const [file,env]of [['packages/browser-chrome/test/observer-browser.mjs',{WISP_OBSERVER_REPORT:stage+'-observer-browser.json'}],['packages/browser-chrome/test/control-browser.mjs',{WISP_CONTROL_REPORT:stage+'-control-browser.json'}],['packages/policy/test/policy-browser.mjs',{WISP_POLICY_REPORT:stage+'-policy-browser.json'}],['packages/runtime/test/runtime-browser.mjs',{WISP_RUNTIME_REPORT:stage==='t008'?'t008-browser.json':stage+'-runtime-browser.json'}]]){try{execFileSync(process.execPath,[file],{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true,timeout:60000})}catch{passed=false}}
if(!passed)process.exitCode=1;
