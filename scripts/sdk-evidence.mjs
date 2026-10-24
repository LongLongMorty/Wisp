import {loopHashes} from './loop-evidence.mjs';
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root} from './tools.mjs';
export async function sdkHashes(){const files=await loopHashes();async function walk(dir){for(const e of await readdir(path.join(root,dir),{withFileTypes:true})){if(['dist','node_modules'].includes(e.name))continue;const file=path.posix.join(dir,e.name);if(e.isDirectory())await walk(file);else files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');}}await walk('packages/sdk');for(const file of ['scripts/sdk-build.mjs','scripts/sdk-smoke.mjs','scripts/sdk-evidence.mjs'])files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');return files;}
