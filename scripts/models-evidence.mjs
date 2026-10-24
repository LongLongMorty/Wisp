import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root} from './tools.mjs';
export async function modelHashes(){
 const files={};
 async function walk(dir){for(const entry of await readdir(path.join(root,dir),{withFileTypes:true})){if(['dist','node_modules'].includes(entry.name))continue;const file=path.posix.join(dir,entry.name);if(entry.isDirectory())await walk(file);else files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');}}
 await walk('packages/models');await walk('packages/protocol/src');
 for(const file of ['scripts/models-build.mjs','scripts/models-live.mjs','scripts/models-evidence.mjs','package.json','package-lock.json','tsconfig.base.json'])files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
 return files;
}
