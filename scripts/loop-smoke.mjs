import {execFileSync} from 'node:child_process';
import {root} from './tools.mjs';
await import('./protocol-build.mjs');await import('./browser-build.mjs');await import('./policy-build.mjs');await import('./runtime-build.mjs');
let passed=true;const stage=['t011','t012','t013'].includes(process.env.WISP_LOOP_STAGE)?process.env.WISP_LOOP_STAGE:'t010';
for(const [script,env] of [['scripts/runtime-smoke.mjs',{WISP_RUNTIME_STAGE:stage}],['packages/runtime/test/loop-browser.mjs',{WISP_LOOP_REPORT:stage+'-loop-browser.json'}]]){try{execFileSync(process.execPath,[script],{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true,timeout:300000});}catch{passed=false;}}
if(!passed)process.exitCode=1;
