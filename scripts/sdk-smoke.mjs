import {execFileSync} from 'node:child_process';
import {root} from './tools.mjs';
await import('./sdk-build.mjs');
const stage=['t012','t013'].includes(process.env.WISP_SDK_STAGE)?process.env.WISP_SDK_STAGE:'t011';
let passed=true;for(const [file,env]of [['scripts/loop-smoke.mjs',{WISP_LOOP_STAGE:stage}],['packages/sdk/test/sdk-browser.mjs',{WISP_SDK_REPORT:stage+'-sdk-browser.json'}]]){try{execFileSync(process.execPath,[file],{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true,timeout:300000});}catch{passed=false;}}if(!passed)process.exitCode=1;
