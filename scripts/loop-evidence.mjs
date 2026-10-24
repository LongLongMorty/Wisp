import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root} from './tools.mjs';
export async function loopHashes(){const files={};async function walk(dir){for(const e of await readdir(path.join(root,dir),{withFileTypes:true})){if(['dist','node_modules'].includes(e.name))continue;const file=path.posix.join(dir,e.name);if(e.isDirectory())await walk(file);else files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');}}for(const dir of ['packages/runtime','packages/models','packages/protocol','packages/browser-chrome','packages/policy','fixtures/web'])await walk(dir);for(const file of ['scripts/loop-smoke.mjs','scripts/loop-evidence.mjs','scripts/runtime-smoke.mjs','scripts/runtime-build.mjs','scripts/models-build.mjs','package.json','package-lock.json','tsconfig.base.json'])files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');return files;}
