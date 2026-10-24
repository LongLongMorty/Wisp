import {execFileSync} from 'node:child_process';
import {root} from './tools.mjs';
await import('./build.mjs');let passed=true;for(const [file,env]of [['scripts/sdk-smoke.mjs',{WISP_SDK_STAGE:'t012'}],['apps/extension/test/panel-browser.mjs',{}]]){try{execFileSync(process.execPath,[file],{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true,timeout:300000});}catch{passed=false;}}if(!passed)process.exitCode=1;
