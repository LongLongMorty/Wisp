import {readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {root} from './tools.mjs';
const files=[];
for(const relative of ['packages/protocol/test','packages/browser-chrome/test','packages/policy/test','packages/runtime/test','packages/models/test','packages/sdk/test','apps/extension/test','fixtures/web/test']){
 const directory=path.join(root,relative);
 files.push(...(await readdir(directory)).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>path.join(directory,name)));
}
if(!files.length)throw new Error('No tests found');
execFileSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit',windowsHide:true});
